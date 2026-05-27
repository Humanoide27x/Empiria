const fs   = require("fs");
const path = require("path");
const pool = require("../../db/pool");
const { getPersonnel, updatePersonnel } = require("../../data/personnel");
const { getUsers } = require("../../data/users");
const { getPayrollConfig } = require("../../data/payroll_config");
const { calculatePayrollDeductionBase } = require("../../utils/payroll-deductions");

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads", "novedades");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function saveBase64Document(base64String, noveltyId) {
  if (!base64String || !base64String.startsWith("data:")) return "";
  try {
    const match = base64String.match(/^data:([a-z0-9/+]+);base64,(.+)$/i);
    if (!match) return "";
    const mimeToExt = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
    const ext  = mimeToExt[match[1]] || ".bin";
    const buf  = Buffer.from(match[2], "base64");
    const name = `novedad-${noveltyId}-${Date.now()}${ext}`;
    const dest = path.join(UPLOADS_DIR, name);
    fs.writeFileSync(dest, buf);
    return `/uploads/novedades/${name}`;
  } catch {
    return "";
  }
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toBigIntOrNull(value) {
  try {
    const n = BigInt(value);
    return n > 0n ? String(n) : null;
  } catch {
    return null;
  }
}

function safeString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeLegacyPayrollLine(line) {
  if (!line || typeof line !== "object") return line;

  const baseSalary = Number(line.baseSalary ?? line.base_salary ?? line.baseEarned ?? 0);
  const totalDevengado = Number(line.totalDevengado ?? line.total_devengado ?? 0);
  const novedadDescuento = Number(line.novedadDescuento ?? line.novedad_descuento ?? 0);
  const deduccionSalud = calculatePayrollDeductionBase(baseSalary);
  const deduccionPension = calculatePayrollDeductionBase(baseSalary);
  const totalDeducciones = deduccionSalud + deduccionPension;
  const netoPagar = Math.round(totalDevengado - totalDeducciones - novedadDescuento);

  return {
    ...line,
    deduccionSalud,
    deduccionPension,
    totalDeducciones,
    netoPagar,
  };
}

const NOVELTY_TYPES = Object.freeze([
  "INCAPACIDAD",
  "PERMISO_CITA_MEDICA",
  "VACACIONES",
  "LICENCIA_REMUNERADA",
  "LICENCIA_NO_REMUNERADA",
  "SUSPENSION",
  "AUSENCIA",
  "CAMBIO_CARGO",
  "CAMBIO_SALARIO",
  "RETIRO",
  "OTRO",
]);

const NOVELTY_STATUSES = Object.freeze([
  "PENDIENTE",
  "APROBADA",
  "RECHAZADA",
  "ANULADA",
]);

function findPersonnelById(id) {
  const personnel = getPersonnel();
  return personnel.find((e) => String(e.id) === String(id)) || null;
}

function findUserById(id) {
  const users = getUsers();
  return users.find((u) => String(u.id) === String(id)) || null;
}

function getPersonName(employee) {
  return (
    employee.fullName ||
    employee.full_name ||
    employee.nombre_completo ||
    ""
  );
}

function getPersonDocument(employee) {
  return (
    employee.documentNumber ||
    employee.document_number ||
    employee.numero_documento ||
    ""
  );
}

function mapNovelty(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name || "",
    documentNumber: row.document_number || "",
    companyId: row.company_id,
    contractId: row.contract_id,
    noveltyType: row.novelty_type,
    startDate: row.start_date,
    endDate: row.end_date,
    days: row.days,
    observations: row.observations || "",
    supportDocumentUrl: row.support_document_url || "",
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedByUserId: row.reviewed_by_user_id || null,
    reviewedByName: row.reviewed_by_name || "",
    reviewedAt: row.reviewed_at || null,
    reviewNotes: row.review_notes || "",
  };
}

// ─────────────────────────────────────────────
// LISTAR NOVEDADES
// ─────────────────────────────────────────────
async function listNovelties(filters = {}) {
  const conditions = [];
  const values = [];

  if (filters.companyId) {
    values.push(Number(filters.companyId));
    conditions.push(`company_id = $${values.length}`);
  }

  if (filters.contractId) {
    values.push(Number(filters.contractId));
    conditions.push(`contract_id = $${values.length}`);
  }

  if (filters.employeeId) {
    values.push(String(filters.employeeId));
    conditions.push(`employee_id::text = $${values.length}`);
  }

  if (filters.noveltyType) {
    values.push(safeString(filters.noveltyType).toUpperCase());
    conditions.push(`novelty_type = $${values.length}`);
  }

  if (filters.status) {
    values.push(safeString(filters.status).toUpperCase());
    conditions.push(`status = $${values.length}`);
  }

  if (filters.startDateFrom) {
    values.push(filters.startDateFrom);
    conditions.push(`start_date >= $${values.length}`);
  }

  if (filters.startDateTo) {
    values.push(filters.startDateTo);
    conditions.push(`start_date <= $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `SELECT * FROM payroll_novelties ${where} ORDER BY created_at DESC`,
    values
  );

  return result.rows.map(mapNovelty);
}

// ─────────────────────────────────────────────
// OBTENER NOVEDAD POR ID
// ─────────────────────────────────────────────
async function getNoveltyById(id) {
  const result = await pool.query(
    `SELECT * FROM payroll_novelties WHERE id = $1`,
    [Number(id)]
  );

  return result.rows[0] ? mapNovelty(result.rows[0]) : null;
}

// ─────────────────────────────────────────────
// CREAR NOVEDAD
// ─────────────────────────────────────────────
async function createNovelty(data, userId) {
  const noveltyType = safeString(data.noveltyType || data.novelty_type).toUpperCase();

  if (!NOVELTY_TYPES.includes(noveltyType)) {
    throw new Error(
      `Tipo de novedad inválido. Valores permitidos: ${NOVELTY_TYPES.join(", ")}`
    );
  }

  const rawEmployeeId = data.employeeId || data.employee_id;
  if (!rawEmployeeId) {
    throw new Error("El empleado es obligatorio");
  }

  if (!data.startDate && !data.start_date) {
    throw new Error("La fecha de inicio es obligatoria");
  }

  let employee = findPersonnelById(rawEmployeeId);
  let employeeId, employeeName, documentNumber, companyId, contractId;

  if (employee) {
    employeeId    = String(employee.id);
    employeeName  = getPersonName(employee);
    documentNumber = getPersonDocument(employee);
    companyId  = toNumberOrNull(data.companyId || data.company_id || employee.companyId || employee.company_id) || null;
    contractId = toNumberOrNull(data.contractId || data.contract_id || employee.contractId || employee.contract_id) || null;
  } else {
    // Frontend sends PG serial IDs; look up by PG id and store legacy_json_id for payroll calculations
    const pgRes = await pool.query(
      `SELECT e.*, m.name AS municipality_name
         FROM employees e
         LEFT JOIN municipalities m ON m.id = e.municipality_id
        WHERE e.id = $1`,
      [Number(rawEmployeeId)]
    );
    if (!pgRes.rows[0]) throw new Error("Empleado no encontrado");
    const row = pgRes.rows[0];
    employeeId     = row.legacy_json_id ? String(row.legacy_json_id) : String(row.id);
    employeeName   = row.full_name || "";
    documentNumber = row.document_number || "";
    companyId  = toNumberOrNull(data.companyId || data.company_id || row.company_id) || null;
    contractId = toNumberOrNull(data.contractId || data.contract_id || row.contract_id) || null;
  }

  const creator = findUserById(userId);
  const creatorName = creator ? (creator.name || creator.username || "") : "";

  // Insert to get ID first, then save file if base64
  const rawDocUrl = safeString(data.supportDocumentUrl || data.support_document_url);
  const result = await pool.query(
    `
    INSERT INTO payroll_novelties (
      employee_id, employee_name, document_number,
      company_id, contract_id, novelty_type,
      start_date, end_date, days, observations,
      support_document_url, status,
      created_by_user_id, created_by_name
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDIENTE',$12,$13)
    RETURNING id
    `,
    [
      employeeId, employeeName, documentNumber,
      companyId, contractId, noveltyType,
      data.startDate || data.start_date,
      data.endDate || data.end_date || null,
      toNumberOrNull(data.days) || null,
      safeString(data.observations),
      rawDocUrl.startsWith("data:") ? "PENDING_UPLOAD" : rawDocUrl,
      toNumberOrNull(userId), creatorName,
    ]
  );

  const insertedId = result.rows[0].id;

  // Save base64 file to disk, update URL
  if (rawDocUrl.startsWith("data:")) {
    const fileUrl = saveBase64Document(rawDocUrl, insertedId);
    if (fileUrl) {
      await pool.query(`UPDATE payroll_novelties SET support_document_url=$1 WHERE id=$2`, [fileUrl, insertedId]);
    } else {
      await pool.query(`UPDATE payroll_novelties SET support_document_url='' WHERE id=$1`, [insertedId]);
    }
  }

  const novedad = await getNoveltyById(insertedId);

  if (noveltyType === "RETIRO") {
    try {
      updatePersonnel(employeeId, {
        terminationDate: data.startDate || data.start_date,
        status: "INACTIVO",
      });
    } catch { /* no bloquear si falla el side effect */ }
  }

  return novedad;
}

// ─────────────────────────────────────────────
// ACTUALIZAR ESTADO (aprobar / rechazar / anular)
// ─────────────────────────────────────────────
async function updateNoveltyStatus(id, status, reviewNotes, reviewerUserId) {
  const normalizedStatus = safeString(status).toUpperCase();

  if (!NOVELTY_STATUSES.includes(normalizedStatus)) {
    throw new Error(
      `Estado inválido. Valores permitidos: ${NOVELTY_STATUSES.join(", ")}`
    );
  }

  const current = await pool.query(
    `SELECT status FROM payroll_novelties WHERE id = $1`,
    [Number(id)]
  );

  if (!current.rows[0]) {
    throw new Error("Novedad no encontrada");
  }

  if (current.rows[0].status === "ANULADA") {
    throw new Error("Una novedad anulada no puede modificarse");
  }

  const reviewer = findUserById(reviewerUserId);
  const reviewerName = reviewer ? (reviewer.name || reviewer.username || "") : "";

  const result = await pool.query(
    `
    UPDATE payroll_novelties SET
      status              = $2,
      review_notes        = $3,
      reviewed_by_user_id = $4,
      reviewed_by_name    = $5,
      reviewed_at         = CURRENT_TIMESTAMP,
      updated_at          = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING id
    `,
    [
      Number(id),
      normalizedStatus,
      safeString(reviewNotes),
      toNumberOrNull(reviewerUserId),
      reviewerName,
    ]
  );

  return getNoveltyById(result.rows[0].id);
}

// ─────────────────────────────────────────────
// RESUMEN (para dashboard de nómina)
// ─────────────────────────────────────────────
async function getPayrollSummary(filters = {}) {
  const conditions = [];
  const values = [];

  if (filters.companyId) {
    values.push(Number(filters.companyId));
    conditions.push(`company_id = $${values.length}`);
  }

  if (filters.contractId) {
    values.push(Number(filters.contractId));
    conditions.push(`contract_id = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `
    SELECT
      novelty_type,
      status,
      COUNT(*) AS total
    FROM payroll_novelties
    ${where}
    GROUP BY novelty_type, status
    ORDER BY novelty_type, status
    `,
    values
  );

  const byType = {};
  for (const row of result.rows) {
    if (!byType[row.novelty_type]) {
      byType[row.novelty_type] = { total: 0, byStatus: {} };
    }
    byType[row.novelty_type].byStatus[row.status] = Number(row.total);
    byType[row.novelty_type].total += Number(row.total);
  }

  return { byType };
}

// ─────────────────────────────────────────────
// CLASSIFY EMPLOYEE BY MODALITY
// ─────────────────────────────────────────────
function classifyEmployee(employee, allPersonnel) {
  const mod = String(
    employee.educationalModality || employee.modalidad || employee.modality || ""
  ).toUpperCase().trim();
  const wt = String(
    employee.workTimeType || employee.work_time_type || employee.tipo_tiempo || ""
  ).toUpperCase().trim();

  if (mod === "RI") return "RI";

  if (mod.includes("CAARES")) {
    const instKey = `${String(employee.institution || employee.institucion_educativa || "").toUpperCase()}_${String(employee.site || employee.sede_educativa || "").toUpperCase()}`;
    const peers = allPersonnel.filter(p => {
      const pKey = `${String(p.institution || p.institucion_educativa || "").toUpperCase()}_${String(p.site || p.sede_educativa || "").toUpperCase()}`;
      return pKey === instKey && String(p.status || "").toUpperCase() === "ACTIVO";
    });
    const tcCount = peers.filter(p =>
      String(p.workTimeType || p.work_time_type || "").toUpperCase() === "TC"
    ).length;
    if (wt === "TC") return tcCount <= 1 ? "CAARES1" : "CAARES3";
    return tcCount <= 1 ? "CAARES2" : "CAARES4";
  }

  if (mod.includes("CAA") || mod === "CAA") {
    return wt === "TC" ? "CAA1" : "CAA2";
  }

  return wt === "TC" ? "CAA1" : "CAA2";
}

// ─────────────────────────────────────────────
// PAYROLL CALCULATION ENGINE
// ─────────────────────────────────────────────
const NOVELTY_LABELS_MAP = {
  INCAPACIDAD: "Incapacidad",
  VACACIONES: "Vacaciones",
  LICENCIA_REMUNERADA: "Licencia remunerada",
  LICENCIA_NO_REMUNERADA: "Licencia no remunerada",
  SUSPENSION: "Suspensión",
  AUSENCIA: "Ausencia injustificada",
  CAMBIO_CARGO: "Cambio de cargo",
  CAMBIO_SALARIO: "Cambio de salario",
  RETIRO: "Retiro",
  OTRO: "Otro",
};

function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return `${dt.getDate().toString().padStart(2,"0")}/${(dt.getMonth()+1).toString().padStart(2,"0")}/${dt.getFullYear()}`;
}

async function calculatePayroll({ period, companyId, contractId } = {}) {
  const config = getPayrollConfig();
  const [yearStr, monthStr] = (period || "").split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error("Período inválido. Formato requerido: YYYY-MM");
  }

  const DAYS_PER_MONTH = 30;
  const periodEndDay = new Date(year, month, 0).getDate();
  const periodStartStr = `${year}-${String(month).padStart(2,"0")}-01`;
  const periodEndStr   = `${year}-${String(month).padStart(2,"0")}-${String(periodEndDay).padStart(2,"0")}`;

  const allPersonnel = getPersonnel();
  let scopedPersonnel = allPersonnel.filter(p => {
    const s = String(p.status || "").toUpperCase();
    return s === "ACTIVO" || s === "NOVEDAD";
  });
  if (companyId)  scopedPersonnel = scopedPersonnel.filter(p => Number(p.companyId)  === Number(companyId));
  if (contractId) scopedPersonnel = scopedPersonnel.filter(p => Number(p.contractId) === Number(contractId));

  // Also include recently retired employees who were active during the period
  const retiradosEnPeriodo = allPersonnel.filter(p => {
    if (String(p.status || "").toUpperCase() !== "INACTIVO") return false;
    const td = p.terminationDate || p.fecha_retiro || "";
    if (!td) return false;
    return td >= periodStartStr && td <= periodEndStr;
  });
  for (const r of retiradosEnPeriodo) {
    if (!scopedPersonnel.find(x => String(x.id) === String(r.id))) scopedPersonnel.push(r);
  }

  // Get novelties for the period
  const novConditions = ["(start_date <= $1 AND (end_date >= $2 OR end_date IS NULL OR start_date >= $2))"];
  const novValues = [periodEndStr, periodStartStr];
  if (companyId)  { novValues.push(Number(companyId));  novConditions.push(`company_id = $${novValues.length}`); }
  if (contractId) { novValues.push(Number(contractId)); novConditions.push(`contract_id = $${novValues.length}`); }

  const novResult = await pool.query(
    `SELECT * FROM payroll_novelties WHERE ${novConditions.join(" AND ")} ORDER BY start_date`,
    novValues
  );
  const allNovelties = novResult.rows.map(mapNovelty);

  const payrollLines = [];
  const alerts = [];

  for (const emp of scopedPersonnel) {
    const empId = String(emp.id);
    const empNovelties  = allNovelties.filter(n => String(n.employeeId) === empId && n.status === "APROBADA");
    const empPending    = allNovelties.filter(n => String(n.employeeId) === empId && n.status === "PENDIENTE");

    const retiroNov = empNovelties.find(n => n.noveltyType === "RETIRO");
    const ingresoDateStr = emp.coverageStartDate || emp.coverage_start_date || emp.fecha_inicio_cobertura || "";

    // --- Determine worked days in this period ---
    let startDay = 1;
    let endDay   = DAYS_PER_MONTH;
    const observations = [];

    if (ingresoDateStr) {
      const ing = new Date(ingresoDateStr);
      if (ing.getFullYear() === year && ing.getMonth() + 1 === month) {
        startDay = Math.min(ing.getDate(), DAYS_PER_MONTH);
        observations.push(`Ingreso desde el día ${startDay}/${month}/${year}`);
      } else if (ing > new Date(periodEndStr)) {
        continue; // not started yet
      }
    }

    let isRetiro = false;
    let liquidacion = null;
    if (retiroNov) {
      const retDate = new Date(retiroNov.startDate);
      if (retDate.getFullYear() === year && retDate.getMonth() + 1 === month) {
        endDay   = Math.min(retDate.getDate(), DAYS_PER_MONTH);
        isRetiro = true;
        observations.push(`Retiro efectivo el día ${fmtDate(retiroNov.startDate)}`);
      }
    }

    const workedDays = Math.max(0, endDay - startDay + 1);
    if (workedDays <= 0) continue;

    // --- Salary & classification ---
    const modalityClass = classifyEmployee(emp, allPersonnel);
    const baseSalaryFull = config.modalitySalaries?.[modalityClass] ?? config.smlmv;
    const dailySalary    = baseSalaryFull / DAYS_PER_MONTH;
    let salarioBase      = dailySalary * workedDays;

    // Handle CAMBIO_SALARIO / CAMBIO_CARGO within period (split calculation)
    const salChangeNov = empNovelties.find(n =>
      (n.noveltyType === "CAMBIO_SALARIO" || n.noveltyType === "CAMBIO_CARGO") &&
      n.observations && n.observations.toLowerCase().includes("salario")
    );
    if (salChangeNov && salChangeNov.startDate) {
      const changeDate = new Date(salChangeNov.startDate);
      if (changeDate.getFullYear() === year && changeDate.getMonth() + 1 === month) {
        const changeDay = Math.min(changeDate.getDate(), DAYS_PER_MONTH);
        if (changeDay > startDay && changeDay <= endDay) {
          observations.push(`Cambio de salario/modalidad efectivo desde ${fmtDate(salChangeNov.startDate)}`);
        }
      }
    }

    // --- Transport allowance ---
    const maxTransportSalary = config.smlmv * (config.maxTransportSalarySmlmv || 2);
    const dailyTransport = config.transportAllowance / DAYS_PER_MONTH;
    let auxTransporte = salarioBase <= maxTransportSalary ? dailyTransport * workedDays : 0;

    // --- Process novelties ---
    let novedadAdicional = 0;
    let novedadDescuento = 0;

    for (const nov of empNovelties) {
      if (nov.noveltyType === "RETIRO") continue;

      const novDays = Math.min(nov.days || 0, workedDays);
      const novDescuento = dailySalary * novDays;
      const novTransDescuento = auxTransporte > 0 ? dailyTransport * novDays : 0;
      const novLabel = NOVELTY_LABELS_MAP[nov.noveltyType] || nov.noveltyType;

      switch (nov.noveltyType) {
        case "LICENCIA_NO_REMUNERADA":
          novedadDescuento += novDescuento + novTransDescuento;
          observations.push(`Se descuenta ${novDays} día(s) por ${novLabel} desde ${fmtDate(nov.startDate)}`);
          break;

        case "AUSENCIA":
          novedadDescuento += novDescuento;
          observations.push(`Se descuenta ${novDays} día(s) por ${novLabel} el ${fmtDate(nov.startDate)}`);
          break;

        case "SUSPENSION":
          novedadDescuento += novDescuento;
          observations.push(`Se descuenta ${novDays} día(s) por ${novLabel} desde ${fmtDate(nov.startDate)}`);
          break;

        case "INCAPACIDAD":
          if (novDays <= 3) {
            const descuento13 = novDescuento * (1 / 3);
            novedadDescuento += descuento13;
            observations.push(`${novLabel} ${novDays} día(s) — primeros 3 días, empresa paga 2/3. Descuento: $${Math.round(descuento13).toLocaleString("es-CO")}`);
          } else {
            const eps23 = novDescuento * (2 / 3);
            novedadDescuento += novDescuento;
            novedadAdicional += eps23;
            observations.push(`${novLabel} ${novDays} día(s) — desde día 4, EPS reconoce 2/3 ($${Math.round(eps23).toLocaleString("es-CO")})`);
          }
          break;

        case "VACACIONES":
          observations.push(`${novLabel} ${novDays} día(s) aprobadas — período ${fmtDate(nov.startDate)}`);
          break;

        case "LICENCIA_REMUNERADA":
          observations.push(`${novLabel} ${novDays} día(s) — período ${fmtDate(nov.startDate)}`);
          break;

        case "CAMBIO_CARGO":
        case "CAMBIO_SALARIO":
          observations.push(`${novLabel} aprobado desde ${fmtDate(nov.startDate)}`);
          break;

        default:
          if (nov.observations) {
            observations.push(`${novLabel}: ${nov.observations}`);
          }
      }
    }

    // --- Totals ---
    const totalDevengado  = salarioBase + auxTransporte + novedadAdicional;
    const deduccionSalud  = calculatePayrollDeductionBase(salarioBase);
    const deduccionPension = calculatePayrollDeductionBase(salarioBase);
    const totalDeducciones = deduccionSalud + deduccionPension;
    const netoPagar = totalDevengado - totalDeducciones - novedadDescuento;

    let hasAlert = false;

    if (empPending.length > 0) {
      hasAlert = true;
      alerts.push({
        employeeId: empId,
        employeeName: safeString(emp.fullName),
        message: `${empPending.length} novedad(es) pendiente(s) de aprobación — resultados pueden variar`,
        type: "PENDING_NOVELTY",
        severity: "warning",
      });
    }

    if (netoPagar < 0) {
      hasAlert = true;
      alerts.push({
        employeeId: empId,
        employeeName: safeString(emp.fullName),
        message: `Neto a pagar negativo ($${Math.round(netoPagar).toLocaleString("es-CO")}). Revise las novedades manualmente.`,
        type: "NEGATIVE_NET",
        severity: "error",
      });
    }

    if (isRetiro) {
      const ingresoForLiq = ingresoDateStr || emp.createdAt;
      const diasTotales = estimateTotalDays(ingresoForLiq, retiroNov.startDate);
      liquidacion = calcularLiquidacion(baseSalaryFull, diasTotales);
      alerts.push({
        employeeId: empId,
        employeeName: safeString(emp.fullName),
        message: `Retiro registrado. Genere liquidación final. Días totales: ${diasTotales}.`,
        type: "LIQUIDACION",
        severity: "info",
        liquidacion,
      });
    }

    payrollLines.push({
      employeeId: empId,
      employeeName:    safeString(emp.fullName),
      documentNumber:  safeString(emp.documentNumber || emp.numero_documento),
      municipality:    safeString(emp.educationalMunicipality || emp.municipio_institucional || emp.municipality || ""),
      institution:     safeString(emp.institution || emp.institucion_educativa || ""),
      site:            safeString(emp.site || emp.sede_educativa || ""),
      modality:        safeString(emp.educationalModality || emp.modalidad || ""),
      modalityClass,
      workTimeType:    safeString(emp.workTimeType || ""),
      workedDays,
      baseSalary:       Math.round(salarioBase),
      transportAllowance: Math.round(auxTransporte),
      otherEarnings:   Math.round(novedadAdicional),
      totalDevengado:  Math.round(totalDevengado),
      deduccionSalud,
      deduccionPension,
      totalDeducciones,
      novedadDescuento: Math.round(novedadDescuento),
      netoPagar:       Math.round(netoPagar),
      observations,
      hasAlert,
      isRetiro,
      liquidacion,
    });
  }

  const totals = payrollLines.reduce((acc, l) => {
    acc.totalDevengado  += l.totalDevengado;
    acc.totalDeducciones += l.totalDeducciones;
    acc.netoPagar       += l.netoPagar;
    acc.employees       += 1;
    return acc;
  }, { totalDevengado: 0, totalDeducciones: 0, netoPagar: 0, employees: 0 });

  return { period, payrollLines, totals, alerts, config };
}

function estimateTotalDays(ingresoDateStr, retiroDateStr) {
  const start = ingresoDateStr ? new Date(ingresoDateStr) : new Date("2020-01-01");
  const end   = retiroDateStr  ? new Date(retiroDateStr)  : new Date();
  const diff  = end - start;
  return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
}

function calcularLiquidacion(baseSalary, totalDays) {
  // Colombian severance formulas
  const cesantias       = Math.round(baseSalary * totalDays / 360);
  const intCesantias    = Math.round(cesantias * 0.12 * (totalDays / 360));
  const prima           = Math.round(baseSalary * totalDays / 360);
  const vacaciones      = Math.round(baseSalary * totalDays / 720);
  return {
    cesantias,
    intCesantias,
    prima,
    vacaciones,
    total: cesantias + intCesantias + prima + vacaciones,
    diasTotales: totalDays,
  };
}

// ─────────────────────────────────────────────
// PERÍODOS DE NÓMINA
// ─────────────────────────────────────────────

function isoDate(val) {
  if (!val) return null;
  return new Date(val).toISOString().substring(0, 10);
}

function mapPeriod(row) {
  return {
    id:          row.id,
    companyId:   row.company_id,
    contractId:  row.contract_id,
    periodStart: isoDate(row.period_start),
    periodEnd:   isoDate(row.period_end),
    label:       row.label,
    status:      row.status,
    closedBy:    row.closed_by,
    closedAt:    row.closed_at,
    createdBy:   row.created_by,
    createdAt:   row.created_at,
  };
}

async function listPeriods(filters = {}) {
  const conditions = [];
  const values = [];

  if (filters.companyId) {
    values.push(Number(filters.companyId));
    conditions.push(`company_id = $${values.length}`);
  }
  if (filters.contractId) {
    values.push(Number(filters.contractId));
    conditions.push(`contract_id = $${values.length}`);
  }
  if (filters.status) {
    values.push(String(filters.status).toUpperCase());
    conditions.push(`status = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT * FROM payroll_periods ${where} ORDER BY period_start DESC, id DESC`,
    values
  );
  return result.rows.map(mapPeriod);
}

async function getPeriodById(id) {
  const r = await pool.query(`SELECT * FROM payroll_periods WHERE id = $1`, [Number(id)]);
  return r.rows[0] ? mapPeriod(r.rows[0]) : null;
}

async function createPeriod(data, userId) {
  const companyId  = toNumberOrNull(data.companyId  || data.company_id);
  const contractId = toNumberOrNull(data.contractId || data.contract_id) || null;

  if (!companyId) throw new Error("company_id es obligatorio");
  if (!data.periodStart && !data.period_start) throw new Error("period_start es obligatorio");
  if (!data.periodEnd && !data.period_end)     throw new Error("period_end es obligatorio");

  const periodStart = data.periodStart || data.period_start;
  const periodEnd   = data.periodEnd   || data.period_end;
  const label       = safeString(data.label) ||
    `Nómina ${new Date(periodStart).toLocaleDateString("es-CO", { month: "long", year: "numeric" })}`;

  const r = await pool.query(
    `INSERT INTO payroll_periods (company_id, contract_id, period_start, period_end, label, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [companyId, contractId, periodStart, periodEnd, label, toNumberOrNull(userId)]
  );
  return mapPeriod(r.rows[0]);
}

async function calculateAndSavePeriod(periodId, userId) {
  const period = await getPeriodById(periodId);
  if (!period) throw new Error("Período no encontrado");
  if (period.status === "CERRADO") throw new Error("El período ya está cerrado y no puede recalcularse");

  const periodStr = String(period.periodStart).substring(0, 7); // YYYY-MM

  const { payrollLines, totals, alerts, config } = await calculatePayroll({
    period:     periodStr,
    companyId:  period.companyId,
    contractId: period.contractId,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Delete old results for this period
    await client.query(`DELETE FROM payroll_results WHERE period_id = $1`, [periodId]);

    // Insert new results
    for (const line of payrollLines) {
      await client.query(
        `INSERT INTO payroll_results (
          period_id, employee_id, employee_name, document_number,
          company_id, contract_id, municipality, institution, site,
          modality, modality_class, work_time_type,
          worked_days, base_salary, transport_allowance, other_earnings,
          total_devengado, deduccion_salud, deduccion_pension, total_deducciones,
          novedad_descuento, neto_pagar, observations
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [
          periodId,
          String(line.employeeId),
          line.employeeName,
          line.documentNumber,
          period.companyId,
          period.contractId,
          line.municipality,
          line.institution,
          line.site,
          line.modality,
          line.modalityClass,
          line.workTimeType,
          line.workedDays,
          line.baseSalary,
          line.transportAllowance,
          line.otherEarnings,
          line.totalDevengado,
          line.deduccionSalud,
          line.deduccionPension,
          line.totalDeducciones,
          line.novedadDescuento,
          line.netoPagar,
          line.observations.join(" | "),
        ]
      );
    }

    // Update period status to CALCULADO
    await client.query(
      `UPDATE payroll_periods SET status = 'CALCULADO' WHERE id = $1`,
      [periodId]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { periodId, period: { ...period, status: "CALCULADO" }, payrollLines, totals, alerts, config };
}

async function getPeriodResults(periodId) {
  const period = await getPeriodById(periodId);
  if (!period) throw new Error("Período no encontrado");

  const r = await pool.query(
    `SELECT * FROM payroll_results WHERE period_id = $1 ORDER BY employee_name`,
    [Number(periodId)]
  );

  const lines = r.rows.map(row => {
    const snapshot = row.salary_snapshot && typeof row.salary_snapshot === "object" && !Array.isArray(row.salary_snapshot)
      ? row.salary_snapshot
      : {};
    const breakdown = snapshot.payrollBreakdown && typeof snapshot.payrollBreakdown === "object" && !Array.isArray(snapshot.payrollBreakdown)
      ? snapshot.payrollBreakdown
      : {};
    const transportAllowance = Number(row.transport_allowance || 0);
    const otherEarnings      = Number(row.other_earnings || 0);
    return normalizeLegacyPayrollLine({
      id:                 row.id,
      periodId:           row.period_id,
      employeeId:         row.employee_id,
      employeeName:       row.employee_name,
      documentNumber:     row.document_number,
      municipality:       row.municipality,
      institution:        row.institution,
      site:               row.site,
      modality:           row.modality,
      modalityClass:      row.modality_class,
      workTimeType:       row.work_time_type,
      workedDays:         Number(row.worked_days),
      baseSalary:         Number(row.base_salary),
      baseSalaryMonthly:  Number(breakdown.baseSalaryMonthly || breakdown.salaryBaseMonthly || Number(row.base_salary)),
      dailySalary:        Number(breakdown.dailySalary || 0),
      baseEarned:         Number(breakdown.baseEarned || row.base_salary || 0),
      extraShiftAmount:   Number(breakdown.extraShiftAmount || 0),
      transportAllowance: Number(row.transport_allowance),
      otherEarnings:      Number(row.other_earnings),
      otherEarningsTotal: Number(breakdown.otherEarnings ?? (transportAllowance + otherEarnings)),
      turnos:             Array.isArray(breakdown.turnos) ? breakdown.turnos : [],
      totalDevengado:     Number(row.total_devengado),
      deduccionSalud:     Number(row.deduccion_salud),
      deduccionPension:   Number(row.deduccion_pension),
      totalDeducciones:   Number(row.total_deducciones),
      novedadDescuento:   Number(row.novedad_descuento),
      netoPagar:          Number(row.neto_pagar),
      observations:       row.observations || "",
      calculatedAt:       row.calculated_at,
    });
  });

  const totals = lines.reduce((acc, l) => {
    acc.employees       += 1;
    acc.totalDevengado  += l.totalDevengado;
    acc.totalDeducciones += l.totalDeducciones;
    acc.netoPagar       += l.netoPagar;
    return acc;
  }, { employees: 0, totalDevengado: 0, totalDeducciones: 0, netoPagar: 0 });

  return { period, lines, totals };
}

async function closePeriod(periodId, userId) {
  const period = await getPeriodById(periodId);
  if (!period) throw new Error("Período no encontrado");
  if (period.status === "CERRADO") throw new Error("El período ya está cerrado");
  if (period.status === "BORRADOR") throw new Error("Debe calcular la nómina antes de cerrar el período");

  const r = await pool.query(
    `UPDATE payroll_periods
     SET status = 'CERRADO', closed_by = $2, closed_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [Number(periodId), toNumberOrNull(userId)]
  );
  return mapPeriod(r.rows[0]);
}

async function getPaySlip(periodId, employeeId) {
  const period = await getPeriodById(periodId);
  if (!period) throw new Error("Período no encontrado");

  const r = await pool.query(
    `SELECT * FROM payroll_results WHERE period_id = $1 AND employee_id = $2 LIMIT 1`,
    [Number(periodId), String(employeeId)]
  );

  if (!r.rows[0]) throw new Error("Desprendible no encontrado para este empleado y período");

  const row = r.rows[0];
  const snapshot = row.salary_snapshot && typeof row.salary_snapshot === "object" && !Array.isArray(row.salary_snapshot)
    ? row.salary_snapshot
    : {};
  const breakdown = snapshot.payrollBreakdown && typeof snapshot.payrollBreakdown === "object" && !Array.isArray(snapshot.payrollBreakdown)
    ? snapshot.payrollBreakdown
    : {};
  const transportAllowance = Number(row.transport_allowance || 0);
  const otherEarnings      = Number(row.other_earnings || 0);

  return {
    period,
    slip: normalizeLegacyPayrollLine({
      employeeId:         row.employee_id,
      employeeName:       row.employee_name,
      documentNumber:     row.document_number,
      municipality:       row.municipality,
      institution:        row.institution,
      site:               row.site,
      modality:           row.modality,
      modalityClass:      row.modality_class,
      workTimeType:       row.work_time_type,
      workedDays:         Number(row.worked_days),
      baseSalary:         Number(row.base_salary),
      baseSalaryMonthly:  Number(breakdown.baseSalaryMonthly || breakdown.salaryBaseMonthly || Number(row.base_salary)),
      dailySalary:        Number(breakdown.dailySalary || 0),
      baseEarned:         Number(breakdown.baseEarned || row.base_salary || 0),
      extraShiftAmount:   Number(breakdown.extraShiftAmount || 0),
      transportAllowance: Number(row.transport_allowance),
      otherEarnings:      Number(row.other_earnings),
      otherEarningsTotal: Number(breakdown.otherEarnings ?? (transportAllowance + otherEarnings)),
      turnos:             Array.isArray(breakdown.turnos) ? breakdown.turnos : [],
      totalDevengado:     Number(row.total_devengado),
      deduccionSalud:     Number(row.deduccion_salud),
      deduccionPension:   Number(row.deduccion_pension),
      totalDeducciones:   Number(row.total_deducciones),
      novedadDescuento:   Number(row.novedad_descuento),
      netoPagar:          Number(row.neto_pagar),
      observations:       row.observations || "",
      calculatedAt:       row.calculated_at,
    }),
  };
}

module.exports = {
  listNovelties,
  getNoveltyById,
  createNovelty,
  updateNoveltyStatus,
  getPayrollSummary,
  calculatePayroll,
  classifyEmployee,
  getPayrollConfig,
  NOVELTY_TYPES,
  NOVELTY_STATUSES,
  // Period management
  listPeriods,
  getPeriodById,
  createPeriod,
  calculateAndSavePeriod,
  getPeriodResults,
  closePeriod,
  getPaySlip,
};
