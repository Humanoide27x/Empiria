const pool = require("./pool");
const { normalizeText } = require("../utils/text");

// ─── Mapper ───────────────────────────────────────────────────────────────────
// Columnas reales de employee_documents:
//   id, employee_id, document_type_id, employee_contract_id,
//   file_url, file_name, status, uploaded_at, expiration_date,
//   validated, validated_by_user_id, validated_at, observations, created_at,
//   uploaded_by
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
    uploadedBy: row.uploaded_by || null,
    uploadedByName: row.uploaded_by_name || "Sistema",
    validated: Boolean(row.validated),
    validatedByUserId: row.validated_by_user_id || null,
    validatedBy: row.validated_by_name || null,
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
    e.company_id AS company_id,
    COALESCE(vu.full_name, vu.username, vu.email, 'Sistema') AS uploaded_by_name,
    COALESCE(rv.full_name, rv.username, rv.email) AS validated_by_name
  FROM employee_documents ed
  LEFT JOIN document_types dt ON dt.id  = ed.document_type_id
  JOIN  employees          e  ON e.id   = ed.employee_id
  LEFT JOIN users          vu ON vu.id  = ed.uploaded_by
  LEFT JOIN users          rv ON rv.id  = ed.validated_by_user_id
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
       expiration_date, validated, uploaded_at, uploaded_by
     ) VALUES ($1,$2,$3,$4,'pendiente',$5,false,CURRENT_TIMESTAMP,$6)
     RETURNING *`,
    [
      pgEmployeeId,
      docTypeId ?? null,
      fileKey,
      fileName,
      expiryDate ?? null,
      uploadedBy ?? null,
    ]
  );

  // Re-query con JOINs para devolver el mapDocument completo
  return getDocumentById(result.rows[0].id, companyId);
}

async function documentExistsByFileKey(fileKey, companyId) {
  if (!fileKey) return false;
  const result = await pool.query(
    `SELECT ed.id
     FROM employee_documents ed
     JOIN employees e ON e.id = ed.employee_id
     WHERE ed.file_url = $1
       AND e.company_id = $2
     LIMIT 1`,
    [fileKey, companyId]
  );
  return Boolean(result.rows.length);
}

async function getDocumentDiagnostics(companyId) {
  const result = await pool.query(
    `SELECT
       COUNT(ed.id)::int AS total_records,
       COUNT(ed.id) FILTER (WHERE e.id IS NOT NULL)::int AS linked_to_employees,
       COUNT(ed.id) FILTER (WHERE e.id IS NULL)::int AS orphan_records,
       COUNT(ed.id) FILTER (WHERE ed.document_type_id IS NULL)::int AS without_document_type,
       COUNT(ed.id) FILTER (WHERE ed.document_type_id IS NOT NULL AND dt.id IS NULL)::int AS invalid_document_type,
       COUNT(DISTINCT ed.file_url) FILTER (WHERE ed.file_url IS NOT NULL AND ed.file_url <> '')::int AS distinct_file_keys,
       (COUNT(ed.id) - COUNT(DISTINCT ed.file_url) FILTER (WHERE ed.file_url IS NOT NULL AND ed.file_url <> ''))::int AS duplicate_file_keys
     FROM employee_documents ed
     LEFT JOIN employees e ON e.id = ed.employee_id AND e.company_id = $1
     LEFT JOIN document_types dt ON dt.id = ed.document_type_id`,
    [companyId]
  );
  return result.rows[0] || {};
}

async function getInvalidDocumentRelations(companyId) {
  const result = await pool.query(
    `SELECT
       ed.id,
       ed.employee_id,
       ed.document_type_id,
       ed.employee_contract_id,
       ed.file_url,
       ed.file_name,
       CASE
         WHEN e.id IS NULL THEN 'EMPLOYEE_NOT_FOUND_OR_OTHER_COMPANY'
         WHEN ed.document_type_id IS NULL THEN 'DOCUMENT_TYPE_NULL'
         WHEN ed.document_type_id IS NOT NULL AND dt.id IS NULL THEN 'DOCUMENT_TYPE_NOT_FOUND'
         ELSE 'OK'
       END AS relation_status
     FROM employee_documents ed
     LEFT JOIN employees e ON e.id = ed.employee_id AND e.company_id = $1
     LEFT JOIN document_types dt ON dt.id = ed.document_type_id
     WHERE e.id IS NULL
        OR ed.document_type_id IS NULL
        OR (ed.document_type_id IS NOT NULL AND dt.id IS NULL)
     ORDER BY ed.created_at DESC, ed.id DESC
     LIMIT 1000`,
    [companyId]
  );
  return result.rows;
}

async function getExistingDocumentFileKeys(companyId) {
  const result = await pool.query(
    `SELECT ed.file_url
     FROM employee_documents ed
     JOIN employees e ON e.id = ed.employee_id
     WHERE e.company_id = $1
       AND ed.file_url IS NOT NULL
       AND ed.file_url <> ''`,
    [companyId]
  );
  return new Set(result.rows.map((row) => row.file_url));
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
  documentExistsByFileKey,
  getDocumentDiagnostics,
  getInvalidDocumentRelations,
  getExistingDocumentFileKeys,
  updateDocumentStatus,
  deleteDocument,
  getDocumentAlerts,
  getDocumentTypes,
  getEmployeesForDocumentMatching,
};
