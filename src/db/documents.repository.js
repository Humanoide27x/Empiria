const pool = require("./pool");
const { normalizeText } = require("../utils/text");

// ─── Mapper ───────────────────────────────────────────────────────────────────
// Columnas reales de employee_documents:
//   id, employee_id, document_type_id, employee_contract_id,
//   file_url, file_name, status, uploaded_at, expiration_date,
//   validated, validated_by_user_id, validated_at, observations, created_at
//
// company_id no existe en la tabla — se obtiene via JOIN con employees.

function mapDocument(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name || null,
    docTypeId: row.document_type_id,
    docTypeName: row.doc_type_name || null,
    companyId: row.company_id || null,
    status: row.status || "pendiente",
    // fileKey: clave interna (R2 key o ruta local) — NO exponer en respuestas
    fileKey: row.file_url,
    fileName: row.file_name,
    validated: Boolean(row.validated),
    validatedByUserId: row.validated_by_user_id || null,
    validatedAt: row.validated_at || null,
    observations: row.observations || null,
    expiryDate: row.expiration_date || null,
    uploadedAt: row.uploaded_at || null,
    createdAt: row.created_at || null,
  };
}

// ─── Helper: resolver PG id de empleado ──────────────────────────────────────

async function resolveEmployeePgId(employeeId) {
  const numId = Number(employeeId);
  if (!Number.isFinite(numId) || numId <= 0) return null;

  // legacy_json_id supera el rango INTEGER
  if (numId > 2147483647) {
    const r = await pool.query(
      "SELECT id FROM employees WHERE legacy_json_id = $1 LIMIT 1",
      [numId]
    );
    return r.rows[0]?.id ?? null;
  }
  return numId;
}

// ─── SELECT base ──────────────────────────────────────────────────────────────

const BASE_SELECT = `
  SELECT
    ed.*,
    dt.name      AS doc_type_name,
    e.full_name  AS employee_name,
    e.company_id AS company_id
  FROM employee_documents ed
  LEFT JOIN document_types dt ON dt.id  = ed.document_type_id
  JOIN  employees          e  ON e.id   = ed.employee_id
`;

// ─── Funciones públicas ───────────────────────────────────────────────────────

async function getDocumentsByEmployee(employeeId, companyId) {
  const pgId = await resolveEmployeePgId(employeeId);
  if (!pgId) return [];

  const result = await pool.query(
    `${BASE_SELECT}
     WHERE ed.employee_id = $1 AND e.company_id = $2
     ORDER BY ed.created_at DESC`,
    [pgId, companyId]
  );
  return result.rows.map(mapDocument);
}

async function getDocumentById(id, companyId) {
  const result = await pool.query(
    `${BASE_SELECT} WHERE ed.id = $1 AND e.company_id = $2`,
    [id, companyId]
  );
  return result.rows[0] ? mapDocument(result.rows[0]) : null;
}

async function createDocument({
  employeeId,
  docTypeId,
  companyId,
  fileKey,
  fileName,
  uploadedBy,
  expiryDate,
}) {
  const pgEmployeeId = await resolveEmployeePgId(employeeId);
  if (!pgEmployeeId) throw new Error("Empleado no encontrado");

  // Verificar que el empleado pertenece a la empresa
  if (companyId) {
    const check = await pool.query(
      "SELECT id FROM employees WHERE id = $1 AND company_id = $2",
      [pgEmployeeId, companyId]
    );
    if (!check.rows.length) throw new Error("Empleado no pertenece a la empresa");
  }

  const result = await pool.query(
    `INSERT INTO employee_documents (
       employee_id, document_type_id, file_url, file_name, status,
       expiration_date, validated, uploaded_at
     ) VALUES ($1,$2,$3,$4,'pendiente',$5,false,CURRENT_TIMESTAMP)
     RETURNING *`,
    [
      pgEmployeeId,
      docTypeId ?? null,
      fileKey,
      fileName,
      expiryDate ?? null,
    ]
  );

  // Re-query con JOINs para devolver el mapDocument completo
  return getDocumentById(result.rows[0].id, companyId);
}

async function updateDocumentStatus(id, companyId, { status, reviewedBy, reviewNotes }) {
  const valid = ["pendiente", "cargado", "aprobado", "rechazado", "vencido"];
  if (!valid.includes(status)) throw new Error(`Estado inválido: "${status}"`);

  const isApproved = status === "aprobado";

  const result = await pool.query(
    `UPDATE employee_documents
     SET status               = $3,
         validated            = $4,
         validated_by_user_id = $5,
         validated_at         = CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE validated_at END,
         observations         = $6
     WHERE id = $1
       AND employee_id IN (SELECT id FROM employees WHERE company_id = $2)
     RETURNING id`,
    [id, companyId, status, isApproved, reviewedBy ?? null, reviewNotes ?? null]
  );

  return result.rows[0] ? getDocumentById(id, companyId) : null;
}

/**
 * Elimina el registro PG y devuelve el documento (con fileKey)
 * para que el llamador pueda borrar el archivo de R2.
 */
async function deleteDocument(id, companyId) {
  const doc = await getDocumentById(id, companyId);
  if (!doc) return null;

  await pool.query(
    `DELETE FROM employee_documents
     WHERE id = $1
       AND employee_id IN (SELECT id FROM employees WHERE company_id = $2)`,
    [id, companyId]
  );
  return doc;
}

/**
 * Documentos vencidos o por vencer en los próximos daysAhead días.
 * Filtra por company_id via JOIN con employees.
 */
async function getDocumentAlerts(companyId, daysAhead = 30) {
  const result = await pool.query(
    `${BASE_SELECT}
     WHERE e.company_id = $1
       AND ed.status NOT IN ('rechazado')
       AND ed.expiration_date IS NOT NULL
       AND ed.expiration_date <= CURRENT_DATE + ($2 * INTERVAL '1 day')
     ORDER BY ed.expiration_date ASC`,
    [companyId, daysAhead]
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return result.rows.map((row) => {
    const expiry = new Date(row.expiration_date);
    expiry.setHours(0, 0, 0, 0);
    const daysUntilExpiry = Math.round((expiry - today) / 86400000);

    return {
      ...mapDocument(row),
      daysUntilExpiry,
      isExpired: daysUntilExpiry < 0,
    };
  });
}

async function getDocumentTypes() {
  const result = await pool.query(
    `SELECT id, code, name
     FROM document_types
     WHERE COALESCE(active, true) = true
     ORDER BY name`
  );
  return result.rows.map((row) => ({
    id: row.id,
    code: row.code || "",
    name: row.name || "",
  }));
}

async function getEmployeesForDocumentMatching(companyId) {
  const values = [];
  const conditions = [];

  if (companyId) {
    values.push(companyId);
    conditions.push(`company_id = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT id, full_name, normalized_full_name, document_type, document_number
     FROM employees
     ${where}
     ORDER BY full_name`,
    values
  );

  return result.rows.map((row) => ({
    id: row.id,
    fullName: row.full_name || "",
    normalizedFullName: row.normalized_full_name || normalizeText(row.full_name),
    documentType: row.document_type || "",
    documentNumber: row.document_number || "",
  }));
}

module.exports = {
  getDocumentsByEmployee,
  getDocumentById,
  createDocument,
  updateDocumentStatus,
  deleteDocument,
  getDocumentAlerts,
  getDocumentTypes,
  getEmployeesForDocumentMatching,
};
