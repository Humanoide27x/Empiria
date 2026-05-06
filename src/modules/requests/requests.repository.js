const pool = require("../../db/pool");
const { getPersonnel } = require("../../data/personnel");
const { getUsers } = require("../../data/users");

function safeString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function toBigIntOrNull(value) {
  try {
    const n = BigInt(value);
    return n > 0n ? String(n) : null;
  } catch {
    return null;
  }
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const REQUEST_TYPES = Object.freeze([
  "CERTIFICADO_LABORAL",
  "CARTA_PRESENTACION",
  "DESPRENDIBLE_PAGO",
  "PAZ_Y_SALVO",
  "PERMISO",
  "VACACIONES",
  "CAMBIO_DATOS_PERSONALES",
  "SOLICITUD_DOCUMENTOS",
  "QUEJA_RECLAMO",
  "OTRO",
]);

const REQUEST_STATUSES = Object.freeze([
  "PENDIENTE",
  "EN_PROCESO",
  "RESUELTA",
  "RECHAZADA",
  "CANCELADA",
]);

function findPersonnelById(id) {
  const personnel = getPersonnel();
  return personnel.find((e) => String(e.id) === String(id)) || null;
}

function findUserById(id) {
  const users = getUsers();
  return users.find((u) => String(u.id) === String(id)) || null;
}

function getPersonName(emp) {
  return emp.fullName || emp.full_name || emp.nombre_completo || "";
}

function getPersonDocument(emp) {
  return emp.documentNumber || emp.document_number || emp.numero_documento || "";
}

function mapRequest(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name || "",
    documentNumber: row.document_number || "",
    companyId: row.company_id,
    contractId: row.contract_id,
    requestType: row.request_type,
    description: row.description || "",
    responseText: row.response_text || "",
    attachmentUrl: row.attachment_url || "",
    status: row.status,
    priority: row.priority || "NORMAL",
    createdByUserId: row.created_by_user_id || null,
    createdByName: row.created_by_name || "",
    assignedToUserId: row.assigned_to_user_id || null,
    assignedToName: row.assigned_to_name || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at || null,
  };
}

async function listRequests(filters = {}) {
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
    conditions.push(`employee_id = $${values.length}`);
  }

  if (filters.requestType) {
    values.push(safeString(filters.requestType).toUpperCase());
    conditions.push(`request_type = $${values.length}`);
  }

  if (filters.status) {
    values.push(safeString(filters.status).toUpperCase());
    conditions.push(`status = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `SELECT * FROM employee_requests
     ${where}
     ORDER BY
       CASE priority WHEN 'ALTA' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
       created_at DESC`,
    values
  );

  return result.rows.map(mapRequest);
}

async function getRequestById(id) {
  const result = await pool.query(
    `SELECT * FROM employee_requests WHERE id = $1`,
    [Number(id)]
  );
  return result.rows[0] ? mapRequest(result.rows[0]) : null;
}

async function createRequest(data, userId) {
  const requestType = safeString(data.requestType || data.request_type).toUpperCase();
  if (!REQUEST_TYPES.includes(requestType)) {
    throw new Error(`Tipo de solicitud inválido. Valores permitidos: ${REQUEST_TYPES.join(", ")}`);
  }

  const employeeId = toBigIntOrNull(data.employeeId || data.employee_id);
  if (!employeeId) {
    throw new Error("El empleado es obligatorio");
  }

  if (!safeString(data.description)) {
    throw new Error("La descripción de la solicitud es obligatoria");
  }

  const employee = findPersonnelById(employeeId);
  if (!employee) {
    throw new Error("Empleado no encontrado");
  }

  const priority = safeString(data.priority || "NORMAL").toUpperCase();
  const allowedPriorities = ["ALTA", "NORMAL", "BAJA"];

  let createdByName = "";
  if (userId) {
    const creator = findUserById(userId);
    if (creator) createdByName = creator.name || creator.username || "";
  }

  const result = await pool.query(
    `INSERT INTO employee_requests (
       employee_id, employee_name, document_number,
       company_id, contract_id,
       request_type, description, attachment_url,
       priority, status,
       created_by_user_id, created_by_name
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDIENTE',$10,$11)
     RETURNING id`,
    [
      employeeId,
      getPersonName(employee),
      getPersonDocument(employee),
      toNumberOrNull(data.companyId || data.company_id || employee.companyId || employee.company_id),
      toNumberOrNull(data.contractId || data.contract_id || employee.contractId || employee.contract_id),
      requestType,
      safeString(data.description),
      safeString(data.attachmentUrl || data.attachment_url),
      allowedPriorities.includes(priority) ? priority : "NORMAL",
      toNumberOrNull(userId),
      createdByName,
    ]
  );

  return getRequestById(result.rows[0].id);
}

async function updateRequest(id, data, userId) {
  const current = await pool.query(
    `SELECT status FROM employee_requests WHERE id = $1`,
    [Number(id)]
  );

  if (!current.rows[0]) {
    throw new Error("Solicitud no encontrada");
  }

  if (["RESUELTA", "CANCELADA"].includes(current.rows[0].status)) {
    throw new Error(
      `Una solicitud ${current.rows[0].status.toLowerCase()} no puede modificarse`
    );
  }

  const fields = [];
  const values = [Number(id)];

  if (data.status) {
    const status = safeString(data.status).toUpperCase();
    if (!REQUEST_STATUSES.includes(status)) {
      throw new Error(`Estado inválido. Valores permitidos: ${REQUEST_STATUSES.join(", ")}`);
    }
    values.push(status);
    fields.push(`status = $${values.length}`);
    if (status === "RESUELTA") {
      fields.push(`resolved_at = CURRENT_TIMESTAMP`);
    }
  }

  if (data.responseText !== undefined || data.response_text !== undefined) {
    values.push(safeString(data.responseText || data.response_text));
    fields.push(`response_text = $${values.length}`);
  }

  if (data.assignedToUserId !== undefined || data.assigned_to_user_id !== undefined) {
    const assignId = toNumberOrNull(data.assignedToUserId || data.assigned_to_user_id);
    values.push(assignId);
    fields.push(`assigned_to_user_id = $${values.length}`);

    if (assignId) {
      const assignee = findUserById(assignId);
      const assignName = assignee ? (assignee.name || assignee.username || "") : "";
      values.push(assignName);
      fields.push(`assigned_to_name = $${values.length}`);
    }
  }

  if (!fields.length) {
    throw new Error("No se enviaron campos para actualizar");
  }

  fields.push(`updated_at = CURRENT_TIMESTAMP`);

  await pool.query(
    `UPDATE employee_requests SET ${fields.join(", ")} WHERE id = $1`,
    values
  );

  return getRequestById(id);
}

async function getRequestsSummary(filters = {}) {
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
    `SELECT status, request_type, COUNT(*) AS total
     FROM employee_requests
     ${where}
     GROUP BY status, request_type
     ORDER BY status, request_type`,
    values
  );

  const byStatus = {};
  for (const row of result.rows) {
    if (!byStatus[row.status]) byStatus[row.status] = 0;
    byStatus[row.status] += Number(row.total);
  }

  return { byStatus, detail: result.rows };
}

module.exports = {
  listRequests,
  getRequestById,
  createRequest,
  updateRequest,
  getRequestsSummary,
  REQUEST_TYPES,
  REQUEST_STATUSES,
};
