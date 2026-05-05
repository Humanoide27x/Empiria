const pool = require("../../db/pool");
const { getPersonnel } = require("../../data/personnel");
const { getUsers } = require("../../data/users");

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

const NOVELTY_TYPES = Object.freeze([
  "INCAPACIDAD",
  "VACACIONES",
  "LICENCIA_REMUNERADA",
  "LICENCIA_NO_REMUNERADA",
  "SUSPENSION",
  "AUSENCIA",
  "CAMBIO_CARGO",
  "CAMBIO_SALARIO",
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

  const employee = findPersonnelById(rawEmployeeId);
  if (!employee) {
    throw new Error("Empleado no encontrado");
  }

  const creator = findUserById(userId);
  const creatorName = creator ? (creator.name || creator.username || "") : "";

  const employeeId = String(rawEmployeeId);
  const employeeName = getPersonName(employee);
  const documentNumber = getPersonDocument(employee);
  const companyId = toNumberOrNull(data.companyId || data.company_id || employee.companyId || employee.company_id) || null;
  const contractId = toNumberOrNull(data.contractId || data.contract_id || employee.contractId || employee.contract_id) || null;

  const result = await pool.query(
    `
    INSERT INTO payroll_novelties (
      employee_id,
      employee_name,
      document_number,
      company_id,
      contract_id,
      novelty_type,
      start_date,
      end_date,
      days,
      observations,
      support_document_url,
      status,
      created_by_user_id,
      created_by_name
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDIENTE', $12, $13)
    RETURNING id
    `,
    [
      employeeId,
      employeeName,
      documentNumber,
      companyId,
      contractId,
      noveltyType,
      data.startDate || data.start_date,
      data.endDate || data.end_date || null,
      toNumberOrNull(data.days) || null,
      safeString(data.observations),
      safeString(data.supportDocumentUrl || data.support_document_url),
      toNumberOrNull(userId),
      creatorName,
    ]
  );

  return getNoveltyById(result.rows[0].id);
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

module.exports = {
  listNovelties,
  getNoveltyById,
  createNovelty,
  updateNoveltyStatus,
  getPayrollSummary,
  NOVELTY_TYPES,
  NOVELTY_STATUSES,
};
