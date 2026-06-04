const pool = require("../../db/pool");
const { getEmployeeById } = require("../../db/employees.repository");
const {
  listEmployeeAssignmentHistory,
  listEmployeeDocumentCompliance,
  listEmployeeExperienceSummary,
  getEmployeeCoverageContext,
} = require("../admin/contractual/contractual.repository");

const REVIEW_PENDING_STATUSES = new Set(["PENDIENTE", "PENDING", "EN_REVISION", "EN REVISIÓN"]);
const CLOSED_NOVELTY_STATUSES = new Set(["ANULADA", "ANULADO", "RECHAZADA", "RECHAZADO", "CANCELADA", "CANCELADO"]);
let _auditLogColumns = null;

const NOVELTY_AFFECTS = {
  FECHA_INGRESO: ["Personal", "Nomina", "Cobertura"],
  FECHA_RETIRO: ["Personal", "Nomina", "Cobertura"],
  RETIRO: ["Personal", "Nomina", "Cobertura"],
  INCAPACIDAD_MEDICA: ["Nomina", "SST"],
  INCAPACIDAD_ACCIDENTE_LABORAL: ["Nomina", "SST"],
  CITA_MEDICA: ["Nomina", "SST"],
  CITA_MEDICA_FAMILIAR: ["Nomina"],
  CALAMIDAD_FAMILIAR: ["Nomina"],
  LICENCIA_MATERNIDAD_PATERNIDAD: ["Nomina", "SST"],
  SUSPENSION: ["Nomina"],
  PERMISOS_NO_REMUNERADOS: ["Nomina"],
  CITACIONES_OFICIALES: ["Nomina"],
  DIAS_NO_CLASE: ["Nomina"],
  CAMBIO_OPERATIVO_COBERTURA: ["Cobertura"],
  CAMBIO_CARGO: ["Personal", "Nomina", "Cobertura"],
  CAMBIO_SALARIO: ["Nomina"],
};

function n(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toIsoDate(value) {
  if (!value) return "";
  const raw = String(value).trim();
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function safeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map((item) => String(item).trim()))];
}

function pickFirstRow(rows = []) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function firstFilled(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return "";
}

function formatFieldLabel(fieldName) {
  return String(fieldName || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getAuditLogColumns() {
  if (_auditLogColumns) return _auditLogColumns;
  const result = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'audit_logs'`
  );
  _auditLogColumns = new Set(result.rows.map((row) => String(row.column_name || "").trim().toLowerCase()));
  return _auditLogColumns;
}

function getNoveltyAffects(code) {
  return NOVELTY_AFFECTS[safeUpper(code)] || ["Nomina"];
}

function isNoveltyActive(novelty, today = new Date()) {
  const status = safeUpper(novelty?.status);
  const code = safeUpper(novelty?.noveltyType || novelty?.novelty_type);
  if (CLOSED_NOVELTY_STATUSES.has(status)) return false;

  const start = novelty?.startDate || novelty?.start_date || null;
  const end = novelty?.endDate || novelty?.end_date || null;
  const created = novelty?.createdAt || novelty?.created_at || null;

  const todayIso = toIsoDate(today.toISOString());
  const startIso = toIsoDate(start);
  const endIso = toIsoDate(end);
  const oneShotCodes = new Set(["FECHA_INGRESO", "FECHA_RETIRO", "RETIRO", "CAMBIO_CARGO", "CAMBIO_SALARIO", "CAMBIO_OPERATIVO_COBERTURA"]);

  if (oneShotCodes.has(code)) return !!startIso && startIso === todayIso;

  if (startIso && endIso) return startIso <= todayIso && todayIso <= endIso;
  if (startIso && !endIso) return startIso <= todayIso;
  if (REVIEW_PENDING_STATUSES.has(status)) return true;
  if (created) return toIsoDate(created) === todayIso;
  return false;
}

function summarizeDocuments(documentRows = []) {
  const requiredRows = documentRows.filter((row) => row.required !== false);
  const totalRequired = requiredRows.length;
  const loaded = requiredRows.filter((row) => row.employeeDocumentId || row.fileUrl).length;
  const approved = requiredRows.filter((row) => row.validated || safeUpper(row.documentStatus) === "APROBADO").length;
  const missing = requiredRows.filter((row) => row.isMissing).length;
  const expired = requiredRows.filter((row) => row.isExpired).length;
  const expiringSoon = requiredRows.filter((row) => row.isExpiringSoon && !row.isExpired).length;
  const pendingReview = requiredRows.filter((row) => row.employeeDocumentId && !row.validated && safeUpper(row.documentStatus) !== "APROBADO").length;

  let status = "Sin matriz";
  if (totalRequired > 0) {
    if (missing > 0 || expired > 0) status = "Incompleta";
    else if (pendingReview > 0 || expiringSoon > 0) status = "En revision";
    else status = "Completa";
  }

  return {
    totalRequired,
    loaded,
    approved,
    missing,
    expired,
    expiringSoon,
    pendingReview,
    status,
    completionPct: totalRequired > 0 ? Math.round((loaded / totalRequired) * 100) : 0,
  };
}

function isWithinLaborValidity(employee, todayIso = toIsoDate(new Date().toISOString())) {
  const startIso = toIsoDate(
    firstFilled(
      employee?.laborStartDate,
      employee?.labor_start_date,
      employee?.startDate,
      employee?.start_date,
      employee?.fecha_ingreso
    )
  );
  const endIso = toIsoDate(
    firstFilled(
      employee?.laborEndDate,
      employee?.labor_end_date,
      employee?.terminationDate,
      employee?.fecha_retiro,
      employee?.retirement_date
    )
  );

  if (startIso && startIso > todayIso) return false;
  if (endIso && endIso < todayIso) return false;
  return true;
}

function summarizeCoverage(employee = {}, coverageRows = []) {
  if (!isWithinLaborValidity(employee)) {
    return {
      applies: false,
      status: "Fuera de vigencia",
      enabledAssignments: 0,
      matchedRules: 0,
      assignments: [],
    };
  }

  const uniqueAssignments = [];
  const seen = new Set();
  for (const row of Array.isArray(coverageRows) ? coverageRows : []) {
    const key = String(row.assignmentId || "");
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueAssignments.push(row);
  }

  const coverageSource = pickFirstRow(uniqueAssignments) || {};
  const institution = firstFilled(
    coverageSource.institutionName,
    employee?.institution,
    employee?.institutionName,
    employee?.institution_name,
    employee?.institucion_educativa
  );
  const site = firstFilled(
    coverageSource.siteName,
    employee?.site,
    employee?.siteName,
    employee?.site_name,
    employee?.sede_educativa
  );
  const modality = firstFilled(
    coverageSource.modalityName,
    coverageSource.modalityCode,
    employee?.modality,
    employee?.modalidad,
    employee?.educationalModality
  );
  const enabledAssignments = uniqueAssignments.filter((row) => row.coverageEnabled === true);
  const withRules = enabledAssignments.filter((row) => row.coverageRuleId);

  if (uniqueAssignments.length && !enabledAssignments.length) {
    return {
      applies: false,
      status: "No aplica para cobertura",
      enabledAssignments: 0,
      matchedRules: 0,
      assignments: uniqueAssignments,
    };
  }

  if (!institution) {
    return {
      applies: false,
      status: "Falta institucion",
      enabledAssignments: enabledAssignments.length,
      matchedRules: withRules.length,
      assignments: uniqueAssignments,
    };
  }

  if (!site) {
    return {
      applies: false,
      status: "Falta sede",
      enabledAssignments: enabledAssignments.length,
      matchedRules: withRules.length,
      assignments: uniqueAssignments,
    };
  }

  if (!modality) {
    return {
      applies: false,
      status: "Falta modalidad",
      enabledAssignments: enabledAssignments.length,
      matchedRules: withRules.length,
      assignments: uniqueAssignments,
    };
  }

  if (!uniqueAssignments.length) {
    return {
      applies: false,
      status: "No encontrado en cobertura",
      enabledAssignments: 0,
      matchedRules: 0,
      assignments: [],
    };
  }

  return {
    applies: enabledAssignments.length > 0,
    status: "Cuenta para cobertura",
    enabledAssignments: enabledAssignments.length,
    matchedRules: withRules.length,
    assignments: uniqueAssignments,
  };
}

function mapAuditEvent(row) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const label = payload.fieldLabel || formatFieldLabel(payload.fieldName || row.action);
  const previousValue = payload.previousValue ?? payload.oldValue ?? "";
  const newValue = payload.newValue ?? payload.value ?? "";

  return {
    id: `audit-${row.id}`,
    date: row.createdAt || row.created_at,
    category: "cambio",
    source: row.module || "personnel",
    title: label,
    description: previousValue || newValue
      ? `${previousValue || "Vacio"} -> ${newValue || "Vacio"}`
      : payload.summary || "Cambio registrado en el expediente.",
    affects: payload.scope === "fixed" ? ["Personal"] : uniqueStrings(payload.affects || ["Personal"]),
    meta: {
      action: row.action,
      userName: row.user_name || row.userName || "",
      scope: payload.scope || "",
    },
  };
}

function mapAssignmentEvent(row) {
  const action = String(row.actionType || row.action_type || "CAMBIO").trim();
  const fieldLabel = formatFieldLabel(row.fieldName || row.field_name || "Asignacion");
  const oldValue = row.oldValue || row.old_value || "";
  const newValue = row.newValue || row.new_value || "";

  return {
    id: `assignment-${row.id}`,
    date: row.createdAt || row.created_at,
    category: "asignacion",
    source: "coverage",
    title: `${action} de ${fieldLabel}`,
    description: oldValue || newValue
      ? `${oldValue || "Vacio"} -> ${newValue || "Vacio"}`
      : row.notes || "Actualizacion de asignacion operativa.",
    affects: ["Cobertura", "Personal"],
    meta: {
      userName: row.changedByUserName || row.changed_by_user_name || "",
      notes: row.notes || "",
    },
  };
}

function mapNoveltyEvent(row) {
  const code = safeUpper(row.noveltyType || row.novelty_type);
  return {
    id: `novelty-${row.id}`,
    date: row.eventDate || row.startDate || row.start_date || row.createdAt || row.created_at,
    category: "novedad",
    source: "payroll",
    title: row.noveltyName || row.novelty_name || code || "Novedad",
    description: [
      row.startDate ? `Desde ${toIsoDate(row.startDate)}` : "",
      row.endDate ? `hasta ${toIsoDate(row.endDate)}` : "",
      row.days ? `${row.days} dia(s)` : "",
      row.periodLabel ? `Periodo ${row.periodLabel}` : "",
    ].filter(Boolean).join(" · ") || (row.observations || "Novedad registrada en el expediente."),
    affects: getNoveltyAffects(code),
    meta: {
      code,
      status: row.status || "",
      reviewed: row.reviewed === true,
      supportRequired: row.supportRequired === true,
      supportStatus: row.supportStatus || "",
    },
  };
}

function buildTimeline({ employee, audits, assignmentHistory, novelties, latestPayroll }) {
  const events = [];

  if (employee?.laborStartDate || employee?.labor_start_date || employee?.startDate || employee?.start_date) {
    events.push({
      id: `milestone-start-${employee.id}`,
      date: employee.laborStartDate || employee.labor_start_date || employee.startDate || employee.start_date,
      category: "hito",
      source: "personnel",
      title: "Inicio de vinculacion laboral",
      description: "Registro base del empleado en la relacion laboral.",
      affects: ["Personal", "Nomina", "Cobertura"],
      meta: {},
    });
  }

  if (employee?.laborEndDate || employee?.labor_end_date || employee?.terminationDate || employee?.fecha_retiro) {
    events.push({
      id: `milestone-end-${employee.id}`,
      date: employee.laborEndDate || employee.labor_end_date || employee.terminationDate || employee.fecha_retiro,
      category: "hito",
      source: "personnel",
      title: "Retiro laboral registrado",
      description: employee.terminationReason || employee.termination_reason || "Fin de la vinculacion laboral.",
      affects: ["Personal", "Nomina", "Cobertura"],
      meta: {},
    });
  }

  for (const row of audits || []) events.push(mapAuditEvent(row));
  for (const row of assignmentHistory || []) events.push(mapAssignmentEvent(row));
  for (const row of novelties || []) events.push(mapNoveltyEvent(row));

  if (latestPayroll?.periodLabel) {
    events.push({
      id: `payroll-${latestPayroll.itemId}`,
      date: latestPayroll.periodEnd || latestPayroll.updatedAt,
      category: "nomina",
      source: "payroll",
      title: `Nomina ${latestPayroll.periodLabel}`,
      description: `Neto ${n(latestPayroll.netPay)}`,
      affects: ["Nomina"],
      meta: {
        periodId: latestPayroll.periodId,
        itemId: latestPayroll.itemId,
        netPay: n(latestPayroll.netPay),
      },
    });
  }

  return events
    .filter((event) => event.date)
    .sort((a, b) => {
      const dateA = String(a.date || "");
      const dateB = String(b.date || "");
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      return String(b.id || "").localeCompare(String(a.id || ""));
    });
}

async function listEmployeeNovelties(employeeId) {
  const result = await pool.query(
    `SELECT
       pn.id,
       pn.novelty_type AS "noveltyType",
       pnt.name AS "noveltyName",
       pn.start_date AS "startDate",
       pn.end_date AS "endDate",
       pn.days,
       pn.status,
       pn.observations,
       pn.reviewed,
       pn.support_required AS "supportRequired",
       pn.support_status AS "supportStatus",
       pn.created_at AS "createdAt",
       COALESCE(pn.start_date, pn.end_date, pn.created_at::date) AS "eventDate",
       pp.id AS "periodId",
       pp.label AS "periodLabel",
       pp.period_start AS "periodStart",
       pp.period_end AS "periodEnd"
     FROM payroll_novelties pn
     LEFT JOIN payroll_novelty_types pnt ON pnt.code = pn.novelty_type
     LEFT JOIN payroll_periods pp ON pp.id = pn.payroll_period_id
     WHERE pn.employee_id = $1
     ORDER BY COALESCE(pn.start_date, pn.end_date, pn.created_at::date) DESC, pn.id DESC`,
    [employeeId]
  );
  return result.rows;
}

async function getLatestPayrollItem(employeeId) {
  const result = await pool.query(
    `SELECT
       pi.id AS "itemId",
       pi.period_id AS "periodId",
       pi.employee_id AS "employeeId",
       pi.salary_category AS "salaryCategory",
       pi.modality,
       pi.operational_position AS "operationalPosition",
       pi.municipality_name AS "municipalityName",
       pi.institution_name AS "institutionName",
       pi.site_name AS "siteName",
       pi.total_devengado AS "totalEarned",
       pi.total_deducciones AS "totalDeductions",
       pi.neto_pagar AS "netPay",
       pi.reviewed,
       pi.updated_at AS "updatedAt",
       pp.label AS "periodLabel",
       pp.period_start AS "periodStart",
       pp.period_end AS "periodEnd"
     FROM payroll_items pi
     JOIN payroll_periods pp ON pp.id = pi.period_id
     WHERE pi.employee_id = $1
     ORDER BY pp.period_end DESC, pi.id DESC
     LIMIT 1`,
    [employeeId]
  );
  return result.rows[0] || null;
}

async function listEmployeeAuditTrail(employeeId) {
  const columns = await getAuditLogColumns().catch(() => new Set());
  const moduleSelect = columns.has("module") ? "module" : "NULL::text AS module";
  const result = await pool.query(
    `SELECT
       id,
       ${moduleSelect},
       entity_type AS "entityType",
       entity_id AS "entityId",
       action,
       user_id AS "userId",
       user_name AS "userName",
       reason,
       payload,
       created_at AS "createdAt"
     FROM audit_logs
     WHERE entity_type = 'employee'
       AND entity_id = $1
     ORDER BY created_at DESC, id DESC`,
    [String(employeeId)]
  );
  return result.rows;
}

async function getEmployeeDossier(employeeReference) {
  const employee = await getEmployeeById(employeeReference);
  if (!employee) return null;

  const employeeId = Number(employee.id);
  const [
    assignmentHistory,
    documentCompliance,
    experienceSummary,
    coverageContext,
    novelties,
    latestPayroll,
    audits,
  ] = await Promise.all([
    listEmployeeAssignmentHistory(employeeId).catch(() => []),
    listEmployeeDocumentCompliance(employeeId).catch(() => []),
    listEmployeeExperienceSummary(employeeId).catch(() => ({ summary: [], records: [] })),
    getEmployeeCoverageContext(employeeId).catch(() => []),
    listEmployeeNovelties(employeeId).catch(() => []),
    getLatestPayrollItem(employeeId).catch(() => null),
    listEmployeeAuditTrail(employeeId).catch(() => []),
  ]);

  const documents = summarizeDocuments(documentCompliance);
  const coverage = summarizeCoverage(employee, coverageContext);
  const currentAssignment = pickFirstRow(coverage.assignments) || null;
  const activeNovelties = novelties.filter((row) => isNoveltyActive(row));
  const pendingNoveltySupports = novelties.filter((row) => row.supportRequired === true && safeUpper(row.supportStatus) !== "VALIDADO");
  const pendingNoveltyReview = novelties.filter((row) => row.reviewed !== true);

  const alerts = [];
  if (documents.missing > 0) alerts.push({ kind: "documents_missing", label: `${documents.missing} documento(s) obligatorios faltantes`, count: documents.missing });
  if (documents.expired > 0) alerts.push({ kind: "documents_expired", label: `${documents.expired} documento(s) vencidos`, count: documents.expired });
  if (documents.expiringSoon > 0) alerts.push({ kind: "documents_expiring", label: `${documents.expiringSoon} documento(s) proximos a vencer`, count: documents.expiringSoon });
  if (pendingNoveltySupports.length > 0) alerts.push({ kind: "novelty_supports", label: `${pendingNoveltySupports.length} novedad(es) sin soporte validado`, count: pendingNoveltySupports.length });
  if (pendingNoveltyReview.length > 0) alerts.push({ kind: "novelty_review", label: `${pendingNoveltyReview.length} novedad(es) pendientes de revision`, count: pendingNoveltyReview.length });
  if (coverage.status === "No encontrado en cobertura") alerts.push({ kind: "coverage_missing", label: "Empleado vigente sin cruce en cobertura", count: 1 });

  const timeline = buildTimeline({
    employee,
    audits,
    assignmentHistory,
    novelties,
    latestPayroll,
  });

  return {
    employee,
    currentAssignment: currentAssignment
      ? {
          assignmentId: currentAssignment.assignmentId || null,
          contractId: currentAssignment.contractId || employee.contractId || null,
          contractName: currentAssignment.contractName || "",
          position: currentAssignment.contractPositionName || employee.cargo_real || employee.position || "",
          modality: currentAssignment.modalityName || currentAssignment.modalityCode || employee.modality || "",
          municipalityName: currentAssignment.municipalityName || employee.municipalityName || "",
          institutionName: currentAssignment.institutionName || employee.institution || "",
          siteName: currentAssignment.siteName || employee.site || "",
          coverageEnabled: currentAssignment.coverageEnabled === true,
        }
      : {
          assignmentId: null,
          contractId: employee.contractId || null,
          contractName: "",
          position: employee.cargo_real || employee.position || "",
          modality: employee.modality || "",
          municipalityName: employee.municipalityName || "",
          institutionName: employee.institution || "",
          siteName: employee.site || "",
          coverageEnabled: false,
        },
    documents: {
      summary: documents,
      compliance: documentCompliance,
    },
    coverage: {
      summary: coverage,
      context: coverageContext,
    },
    payroll: {
      latest: latestPayroll,
      novelties,
      activeNoveltiesCount: activeNovelties.length,
      pendingReviewCount: pendingNoveltyReview.length,
      pendingSupportCount: pendingNoveltySupports.length,
    },
    experience: experienceSummary,
    audit: audits,
    assignmentHistory,
    alerts,
    indicators: {
      documentsStatus: documents.status,
      documentsCompletionPct: documents.completionPct,
      activeNovelties: activeNovelties.length,
      coverageStatus: coverage.status,
      latestPayrollLabel: latestPayroll?.periodLabel || "",
      latestPayrollNet: n(latestPayroll?.netPay || 0),
      alerts: alerts.length,
    },
    timeline,
  };
}

module.exports = {
  getEmployeeDossier,
};
