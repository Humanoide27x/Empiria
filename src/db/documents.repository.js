const pool = require("./pool");
const { normalizeText } = require("../utils/text");
const {
  canonicalDocumentTypeKey,
  normalizeDocumentTypeText,
} = require("../modules/documents/document-type-normalizer");

let _employeeDocumentColumns = null;

async function getEmployeeDocumentColumns() {
  if (_employeeDocumentColumns) return _employeeDocumentColumns;

  const result = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'employee_documents'`
  );
  _employeeDocumentColumns = new Set(result.rows.map((row) => String(row.column_name || "").trim().toLowerCase()));
  return _employeeDocumentColumns;
}

async function hasEmployeeDocumentColumn(columnName) {
  const columns = await getEmployeeDocumentColumns();
  return columns.has(String(columnName || "").trim().toLowerCase());
}

async function getVersionOrderExpression(alias = "ed") {
  return (await hasEmployeeDocumentColumn("version"))
    ? `COALESCE(${alias}.version, 1)`
    : "1";
}

const USER_DISPLAY_NAME_SQL = "COALESCE(%ALIAS%.full_name, %ALIAS%.username, %ALIAS%.email)";
const UPLOADED_BY_NAME_SQL = `${USER_DISPLAY_NAME_SQL.replace(/%ALIAS%/g, "uu")}, 'Sistema'`;
const VALIDATED_BY_NAME_SQL = USER_DISPLAY_NAME_SQL.replace(/%ALIAS%/g, "vu");

function mapDocument(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name || null,
    docTypeId: row.document_type_id,
    docTypeCode: row.doc_type_code || null,
    docTypeName: row.doc_type_name || null,
    masterDocumentTypeId: row.master_document_type_id || row.doc_type_master_document_type_id || null,
    employeeContractId: row.employee_contract_id || null,
    companyId: row.company_id || null,
    status: row.status || "uploaded",
    fileKey: row.storage_path || row.file_url || row.file_path || null,
    fileName: row.original_file_name || row.original_filename || row.file_name || null,
    storedFileName: row.stored_file_name || row.stored_filename || row.file_name || null,
    filePath: row.storage_path || row.file_path || row.file_url || null,
    originalFileName: row.original_file_name || row.original_filename || row.file_name || null,
    fileSize: row.size_bytes || row.file_size || null,
    mimeType: row.mime_type || null,
    replacedByDocumentId: row.replaced_by_document_id || null,
    deletedAt: row.deleted_at || null,
    version: Number(row.version || 1),
    validated: Boolean(row.validated),
    validatedByUserId: row.validated_by_user_id || null,
    validatedByName: row.validated_by_name || null,
    validatedBy: row.validated_by_name || null,
    uploadedBy: row.uploaded_by || null,
    uploadedByName: row.uploaded_by_name || "Sistema",
    validatedAt: row.validated_at || null,
    observations: row.observations || null,
    expiryDate: row.expiration_date || null,
    uploadedAt: row.uploaded_at || null,
    createdAt: row.created_at || null,
  };
}

async function resolveEmployeePgId(employeeId) {
  const numId = Number(employeeId);
  if (!Number.isFinite(numId) || numId <= 0) return null;

  if (numId > 2147483647) {
    const r = await pool.query(
      "SELECT id FROM employees WHERE legacy_json_id = $1 LIMIT 1",
      [numId]
    );
    return r.rows[0]?.id ?? null;
  }
  return numId;
}

async function getBaseSelectSql() {
  const columns = await getEmployeeDocumentColumns();
  const uploadedByNameSql = columns.has("uploaded_by")
    ? `COALESCE(${UPLOADED_BY_NAME_SQL}) AS uploaded_by_name`
    : `'Sistema' AS uploaded_by_name`;
  const uploadedByJoin = columns.has("uploaded_by")
    ? `LEFT JOIN users uu ON uu.id = ed.uploaded_by`
    : "";

  return `
    SELECT
      ed.*,
      dt.code      AS doc_type_code,
      dt.name      AS doc_type_name,
      dt.master_document_type_id AS doc_type_master_document_type_id,
      e.full_name  AS employee_name,
      e.company_id AS company_id,
      ${VALIDATED_BY_NAME_SQL} AS validated_by_name,
      ${uploadedByNameSql}
    FROM employee_documents ed
    LEFT JOIN document_types dt ON dt.id = ed.document_type_id
    JOIN employees e ON e.id = ed.employee_id
    LEFT JOIN users vu ON vu.id = ed.validated_by_user_id
    ${uploadedByJoin}
  `;
}

async function getDocumentsByEmployee(employeeId, companyId) {
  const pgId = await resolveEmployeePgId(employeeId);
  if (!pgId) return [];
  const baseSelect = await getBaseSelectSql();
  const versionExpr = await getVersionOrderExpression("ed");

  const result = await pool.query(
    `${baseSelect}
     WHERE ed.employee_id = $1 AND e.company_id = $2
     ORDER BY ${versionExpr} DESC, ed.uploaded_at DESC NULLS LAST, ed.id DESC`,
    [pgId, companyId]
  );
  return result.rows.map(mapDocument);
}

async function getDocumentsByEmployees(employeeIds, companyId) {
  const ids = Array.isArray(employeeIds) ? employeeIds : [];
  if (!ids.length) return [];

  const resolved = await Promise.all(ids.map((employeeId) => resolveEmployeePgId(employeeId)));
  const numericIds = [...new Set(resolved.filter(Boolean))];
  if (!numericIds.length) return [];

  const baseSelect = await getBaseSelectSql();
  const versionExpr = await getVersionOrderExpression("ed");
  const result = await pool.query(
    `${baseSelect}
     WHERE ed.employee_id = ANY($1::int[]) AND e.company_id = $2
     ORDER BY ed.employee_id, ${versionExpr} DESC, ed.uploaded_at DESC NULLS LAST, ed.id DESC`,
    [numericIds, companyId]
  );
  return result.rows.map(mapDocument);
}

async function getDocumentById(id, companyId) {
  const baseSelect = await getBaseSelectSql();
  const params = [id];
  let where = "WHERE ed.id = $1";
  if (companyId) {
    params.push(companyId);
    where += " AND e.company_id = $2";
  }
  const result = await pool.query(
    `${baseSelect} ${where}`,
    params
  );
  return result.rows[0] ? mapDocument(result.rows[0]) : null;
}

async function getDocumentsByCompany(companyId) {
  if (!companyId) return [];
  const baseSelect = await getBaseSelectSql();
  const versionExpr = await getVersionOrderExpression("ed");

  const result = await pool.query(
    `${baseSelect}
     WHERE e.company_id = $1
     ORDER BY ed.employee_id, ${versionExpr} DESC, ed.uploaded_at DESC NULLS LAST, ed.id DESC`,
    [companyId]
  );
  return result.rows.map(mapDocument);
}

async function getDocumentTypeById(documentTypeId) {
  const id = Number(documentTypeId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const result = await pool.query(
    `SELECT id, code, name, master_document_type_id
       FROM document_types
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  return result.rows[0] || null;
}

async function resolveDocumentType(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    return getDocumentTypeById(Number(raw));
  }

  const rows = await pool.query(
    `SELECT id, code, name, master_document_type_id
       FROM document_types
      WHERE COALESCE(active, true) = true`
  );

  const normalizedInput = normalizeDocumentTypeText(raw);
  const canonicalInput = canonicalDocumentTypeKey(raw);

  return rows.rows.find((row) => {
    const code = normalizeDocumentTypeText(row.code);
    const name = normalizeDocumentTypeText(row.name);
    return (
      normalizedInput === code
      || normalizedInput === name
      || canonicalInput === code
      || canonicalInput === name.replace(/\s+/g, "_")
    );
  }) || null;
}

async function getNextDocumentVersion(employeeId, docTypeId) {
  if (!(await hasEmployeeDocumentColumn("version"))) {
    return 1;
  }

  const pgEmployeeId = await resolveEmployeePgId(employeeId);
  const normalizedDocTypeId = Number(docTypeId);
  if (!pgEmployeeId || !Number.isFinite(normalizedDocTypeId) || normalizedDocTypeId <= 0) {
    return 1;
  }

  const result = await pool.query(
    `SELECT COALESCE(MAX(version), 0)::int AS current_version
       FROM employee_documents
      WHERE employee_id = $1
        AND document_type_id = $2`,
    [pgEmployeeId, normalizedDocTypeId]
  );
  return Number(result.rows[0]?.current_version || 0) + 1;
}

async function createDocument({
  employeeId,
  docTypeId,
  docTypeCode,
  companyId,
  fileKey,
  fileName,
  originalFileName,
  storedFileName,
  fileSize,
  mimeType,
  uploadedBy,
  uploadedAt,
  expiryDate,
  version,
  masterDocumentTypeId,
  employeeContractId,
  replacedDocumentId,
  batchId,
  status = "pendiente",
}) {
  const pgEmployeeId = await resolveEmployeePgId(employeeId);
  if (!pgEmployeeId) throw new Error("Empleado no encontrado");

  if (companyId) {
    const check = await pool.query(
      "SELECT id FROM employees WHERE id = $1 AND company_id = $2",
      [pgEmployeeId, companyId]
    );
    if (!check.rows.length) throw new Error("Empleado no pertenece a la empresa");
  }

  const normalizedDocTypeId = Number(docTypeId);
  if (!Number.isFinite(normalizedDocTypeId) || normalizedDocTypeId <= 0) {
    throw new Error("El tipo documental no existe o no esta configurado.");
  }

  const documentType = await getDocumentTypeById(normalizedDocTypeId);
  if (!documentType) {
    throw new Error("El tipo documental no existe o no esta configurado.");
  }

  const columns = await getEmployeeDocumentColumns();
  const resolvedMasterDocumentTypeId =
    Number(masterDocumentTypeId) > 0
      ? Number(masterDocumentTypeId)
      : Number(documentType.master_document_type_id || 0) || null;
  const insertColumns = [
    "employee_id",
    "document_type_id",
    "file_url",
    "file_name",
    "status",
    "expiration_date",
    "validated",
    "uploaded_at",
  ];
  const insertValues = [
    pgEmployeeId,
    normalizedDocTypeId,
    fileKey,
    fileName,
    status,
    expiryDate ?? null,
    false,
    uploadedAt || { raw: "CURRENT_TIMESTAMP" },
  ];

  if (columns.has("original_file_name")) {
    insertColumns.push("original_file_name");
    insertValues.push(originalFileName || fileName);
  }
  if (columns.has("original_filename")) {
    insertColumns.push("original_filename");
    insertValues.push(originalFileName || fileName);
  }
  if (columns.has("stored_file_name")) {
    insertColumns.push("stored_file_name");
    insertValues.push(storedFileName || fileName);
  }
  if (columns.has("stored_filename")) {
    insertColumns.push("stored_filename");
    insertValues.push(storedFileName || fileName);
  }
  if (columns.has("storage_path")) {
    insertColumns.push("storage_path");
    insertValues.push(fileKey);
  }
  if (columns.has("uploaded_by")) {
    insertColumns.push("uploaded_by");
    insertValues.push(uploadedBy ?? null);
  }
  if (columns.has("file_size")) {
    insertColumns.push("file_size");
    insertValues.push(Number(fileSize) > 0 ? Number(fileSize) : null);
  }
  if (columns.has("mime_type")) {
    insertColumns.push("mime_type");
    insertValues.push(mimeType || null);
  }
  if (columns.has("size_bytes")) {
    insertColumns.push("size_bytes");
    insertValues.push(Number(fileSize) > 0 ? Number(fileSize) : null);
  }
  if (columns.has("document_type")) {
    insertColumns.push("document_type");
    insertValues.push(docTypeCode || null);
  }
  if (columns.has("version")) {
    insertColumns.push("version");
    insertValues.push(Number(version) > 0 ? Number(version) : 1);
  }
  if (columns.has("master_document_type_id")) {
    insertColumns.push("master_document_type_id");
    insertValues.push(resolvedMasterDocumentTypeId);
  }
  if (columns.has("employee_contract_id")) {
    insertColumns.push("employee_contract_id");
    insertValues.push(Number(employeeContractId) > 0 ? Number(employeeContractId) : null);
  }
  if (columns.has("replaced_document_id")) {
    insertColumns.push("replaced_document_id");
    insertValues.push(Number(replacedDocumentId) > 0 ? Number(replacedDocumentId) : null);
  }
  if (columns.has("replaced_by_document_id")) {
    insertColumns.push("replaced_by_document_id");
    insertValues.push(Number(replacedDocumentId) > 0 ? Number(replacedDocumentId) : null);
  }
  if (columns.has("deleted_at")) {
    insertColumns.push("deleted_at");
    insertValues.push(null);
  }
  if (columns.has("created_at")) {
    insertColumns.push("created_at");
    insertValues.push(uploadedAt || { raw: "CURRENT_TIMESTAMP" });
  }
  if (columns.has("updated_at")) {
    insertColumns.push("updated_at");
    insertValues.push(uploadedAt || { raw: "CURRENT_TIMESTAMP" });
  }
  if (columns.has("batch_id")) {
    insertColumns.push("batch_id");
    insertValues.push(Number(batchId) > 0 ? Number(batchId) : null);
  }

  const queryValues = [];
  const placeholders = insertValues.map((value) => {
    if (value && typeof value === "object" && value.raw) {
      return value.raw;
    }
    queryValues.push(value);
    return `$${queryValues.length}`;
  });

  const result = await pool.query(
    `INSERT INTO employee_documents (
       ${insertColumns.join(", ")}
     ) VALUES (${placeholders.join(", ")})
     RETURNING id`,
    queryValues
  );

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

async function getDocumentsMissingMasterDocumentType(companyId) {
  const result = await pool.query(
    `SELECT
       ed.id,
       ed.employee_id,
       e.full_name AS employee_name,
       ed.document_type_id,
       dt.name AS document_type_name,
       dt.master_document_type_id,
       ed.file_url,
       ed.file_name,
       ed.uploaded_at
     FROM employee_documents ed
     JOIN employees e ON e.id = ed.employee_id
     LEFT JOIN document_types dt ON dt.id = ed.document_type_id
     WHERE e.company_id = $1
       AND ed.master_document_type_id IS NULL
     ORDER BY ed.uploaded_at DESC NULLS LAST, ed.id DESC`,
    [companyId]
  );
  return result.rows;
}

async function backfillMasterDocumentTypes(companyId, documentIds = []) {
  const normalizedIds = Array.isArray(documentIds)
    ? documentIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const hasIds = normalizedIds.length > 0;

  const result = await pool.query(
    `UPDATE employee_documents ed
        SET master_document_type_id = dt.master_document_type_id
       FROM document_types dt
       JOIN employees e ON e.id = ed.employee_id
      WHERE ed.document_type_id = dt.id
        AND e.company_id = $1
        AND ed.master_document_type_id IS NULL
        AND dt.master_document_type_id IS NOT NULL
        AND ($2::boolean = false OR ed.id = ANY($3::int[]))
    RETURNING ed.id, ed.employee_id, ed.document_type_id, ed.master_document_type_id`,
    [companyId, hasIds, normalizedIds]
  );
  return result.rows;
}

async function updateDocumentStatus(id, companyId, { status, reviewedBy, reviewNotes }) {
  const valid = ["pendiente", "cargado", "aprobado", "rechazado", "vencido"];
  if (!valid.includes(status)) throw new Error(`Estado invalido: "${status}"`);

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

async function appendDocumentObservation(id, companyId, note) {
  if (!note) return null;
  const result = await pool.query(
    `UPDATE employee_documents
     SET observations = CASE
       WHEN observations IS NULL OR BTRIM(observations) = '' THEN $3
       ELSE observations || E'\n' || $3
     END
     WHERE id = $1
       AND employee_id IN (SELECT id FROM employees WHERE company_id = $2)
     RETURNING id`,
    [id, companyId, note]
  );
  return result.rows[0] ? getDocumentById(id, companyId) : null;
}

async function getLatestDocumentsIndex(companyId) {
  const columns = await getEmployeeDocumentColumns();
  const versionExpr = await getVersionOrderExpression("ed");
  const uploadedByNameSql = columns.has("uploaded_by")
    ? `COALESCE(${UPLOADED_BY_NAME_SQL}) AS uploaded_by_name`
    : `'Sistema' AS uploaded_by_name`;
  const uploadedByJoin = columns.has("uploaded_by")
    ? `LEFT JOIN users uu ON uu.id = ed.uploaded_by`
    : "";
  const result = await pool.query(
    `SELECT DISTINCT ON (ed.employee_id, ed.document_type_id)
       ed.*,
       dt.code      AS doc_type_code,
       dt.name      AS doc_type_name,
       e.full_name  AS employee_name,
       e.company_id AS company_id,
       ${VALIDATED_BY_NAME_SQL} AS validated_by_name,
       ${uploadedByNameSql}
     FROM employee_documents ed
     JOIN employees e ON e.id = ed.employee_id
     LEFT JOIN document_types dt ON dt.id = ed.document_type_id
     LEFT JOIN users vu ON vu.id = ed.validated_by_user_id
     ${uploadedByJoin}
     WHERE e.company_id = $1
     ORDER BY ed.employee_id, ed.document_type_id, ${versionExpr} DESC,
              ed.uploaded_at DESC NULLS LAST, ed.id DESC`,
    [companyId]
  );

  const index = new Map();
  result.rows.forEach((row) => {
    index.set(`${row.employee_id}:${row.document_type_id}`, mapDocument(row));
  });
  return index;
}

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

async function getActiveDocumentsByEmployee(employeeId, companyId) {
  const pgId = await resolveEmployeePgId(employeeId);
  if (!pgId) return [];
  const baseSelect = await getBaseSelectSql();
  const versionExpr = await getVersionOrderExpression("ed");
  const result = await pool.query(
    `${baseSelect}
     WHERE ed.employee_id = $1
       AND e.company_id = $2
       AND ed.deleted_at IS NULL
       AND COALESCE(ed.replaced_by_document_id, 0) = 0
       AND UPPER(TRIM(COALESCE(ed.status, ''))) NOT IN ('DELETED')
     ORDER BY ${versionExpr} DESC, ed.uploaded_at DESC NULLS LAST, ed.id DESC`,
    [pgId, companyId]
  );
  return result.rows.map(mapDocument);
}

async function getDocumentByEmployeeAndType(employeeId, documentTypeKey, companyId) {
  const pgId = await resolveEmployeePgId(employeeId);
  if (!pgId) return null;
  const key = String(documentTypeKey || "").trim().toUpperCase();
  if (!key) return null;
  const baseSelect = await getBaseSelectSql();
  const versionExpr = await getVersionOrderExpression("ed");
  const result = await pool.query(
    `${baseSelect}
     WHERE ed.employee_id = $1
       AND e.company_id = $2
       AND COALESCE(ed.deleted_at, NULL) IS NULL
       AND COALESCE(ed.replaced_by_document_id, 0) = 0
       AND UPPER(COALESCE(NULLIF(BTRIM(ed.document_type), ''), dt.code, COALESCE(ed.doc_type_code, ''))) = $3
     ORDER BY ${versionExpr} DESC, ed.uploaded_at DESC NULLS LAST, ed.id DESC
     LIMIT 1`,
    [pgId, companyId, key]
  );
  return result.rows[0] ? mapDocument(result.rows[0]) : null;
}

async function softDeleteEmployeeDocument(id, companyId, deletedBy = null) {
  const columns = await getEmployeeDocumentColumns();
  const sets = [];
  const values = [];
  const push = (sqlValue) => {
    values.push(sqlValue);
    return `$${values.length}`;
  };

  if (columns.has("deleted_at")) {
    sets.push("deleted_at = CURRENT_TIMESTAMP");
  }
  if (columns.has("updated_at")) {
    sets.push("updated_at = CURRENT_TIMESTAMP");
  }
  if (columns.has("status")) {
    sets.push(`status = ${push("deleted")}`);
  }
  if (columns.has("deleted_by")) {
    sets.push(`deleted_by = ${push(deletedBy || null)}`);
  }

  if (!sets.length) {
    return deleteDocument(id, companyId);
  }

  values.push(id);
  values.push(companyId);
  const result = await pool.query(
    `UPDATE employee_documents
        SET ${sets.join(", ")}
      WHERE id = $${values.length - 1}
        AND employee_id IN (SELECT id FROM employees WHERE company_id = $${values.length})
    RETURNING id`,
    values
  );
  return result.rows[0] ? getDocumentById(id, companyId) : null;
}

async function markEmployeeDocumentReplaced(documentId, replacedByDocumentId) {
  const columns = await getEmployeeDocumentColumns();
  const sets = [];
  const values = [];
  const push = (sqlValue) => {
    values.push(sqlValue);
    return `$${values.length}`;
  };

  if (columns.has("replaced_by_document_id")) {
    sets.push(`replaced_by_document_id = ${push(Number(replacedByDocumentId) > 0 ? Number(replacedByDocumentId) : null)}`);
  }
  if (columns.has("replaced_document_id")) {
    sets.push(`replaced_document_id = ${push(Number(replacedByDocumentId) > 0 ? Number(replacedByDocumentId) : null)}`);
  }
  if (columns.has("status")) {
    sets.push(`status = ${push("replaced")}`);
  }
  if (columns.has("updated_at")) {
    sets.push("updated_at = CURRENT_TIMESTAMP");
  }

  if (!sets.length) return null;

  values.push(documentId);
  const result = await pool.query(
    `UPDATE employee_documents
        SET ${sets.join(", ")}
      WHERE id = $${values.length}
      RETURNING id`,
    values
  );
  return result.rows[0] ? getDocumentById(documentId) : null;
}

async function getDocumentAlerts(companyId, daysAhead = 30) {
  const baseSelect = await getBaseSelectSql();
  const result = await pool.query(
    `${baseSelect}
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
    normalizedTokenName: normalizeText(row.full_name).split(" ").filter(Boolean).sort().join(" "),
    documentType: row.document_type || "",
    documentNumber: row.document_number || "",
  }));
}

module.exports = {
  getDocumentsByEmployee,
  getActiveDocumentsByEmployee,
  getDocumentsByEmployees,
  getDocumentsByCompany,
  getDocumentById,
  getDocumentByEmployeeAndType,
  getDocumentTypeById,
  resolveDocumentType,
  getNextDocumentVersion,
  createDocument,
  documentExistsByFileKey,
  getDocumentDiagnostics,
  getInvalidDocumentRelations,
  getExistingDocumentFileKeys,
  getDocumentsMissingMasterDocumentType,
  backfillMasterDocumentTypes,
  updateDocumentStatus,
  appendDocumentObservation,
  getLatestDocumentsIndex,
  deleteDocument,
  getDocumentAlerts,
  getDocumentTypes,
  getEmployeesForDocumentMatching,
  softDeleteEmployeeDocument,
  markEmployeeDocumentReplaced,
};
