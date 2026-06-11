"use strict";

const pool = require("../../db/pool");

let cachedColumns = new Map();

async function getTableColumns(tableName) {
  const key = String(tableName || "").toLowerCase();
  if (cachedColumns.has(key)) return cachedColumns.get(key);

  const result = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1`,
    [key]
  );

  const columns = new Set(result.rows.map((row) => String(row.column_name || "").trim().toLowerCase()));
  cachedColumns.set(key, columns);
  return columns;
}

function quoteIdent(identifier) {
  return `"${String(identifier || "").replace(/"/g, '""')}"`;
}

function normalizeSqlText(columnSql) {
  return `regexp_replace(COALESCE(NULLIF(BTRIM(${columnSql}), ''), ''), '[^0-9]', '', 'g')`;
}

async function listCatalogDocumentTypes() {
  const result = await pool.query(
    `SELECT id, code, name, phase, required, visible_to_auditor, active,
            master_document_type_id, master_code
     FROM (
       SELECT DISTINCT ON (UPPER(TRIM(dt.name)))
              dt.id,
              dt.code,
              dt.name,
              dt.phase,
              dt.required,
              dt.visible_to_auditor,
              dt.active,
              dt.master_document_type_id,
              mdt.code AS master_code
       FROM document_types dt
       LEFT JOIN master_document_types mdt ON mdt.id = dt.master_document_type_id
       WHERE COALESCE(dt.active, true) = true
       ORDER BY UPPER(TRIM(dt.name)), dt.id DESC
     ) deduped
     ORDER BY name ASC`
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    code: String(row.code || "").trim().toUpperCase(),
    name: String(row.name || "").trim(),
    phase: row.phase || null,
    required: Boolean(row.required),
    visibleToAuditor: Boolean(row.visible_to_auditor),
    active: Boolean(row.active),
    masterDocumentTypeId: row.master_document_type_id || null,
    masterCode: row.master_code || null,
  }));
}

async function getDocumentTypeByCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return null;

  const result = await pool.query(
    `SELECT
       dt.id,
       dt.code,
       dt.name,
       dt.phase,
       dt.required,
       dt.visible_to_auditor,
       dt.active,
       dt.master_document_type_id
     FROM document_types dt
     WHERE UPPER(BTRIM(dt.code)) = $1
     LIMIT 1`,
    [normalized]
  );

  return result.rows[0] || null;
}

async function findEmployeeByDocumentNumber(documentNumber) {
  const normalized = String(documentNumber || "").trim();
  if (!normalized) return null;

  const columns = await getTableColumns("employees");
  const candidateColumns = ["document_number"];
  const available = candidateColumns.filter((column) => columns.has(column));

  if (!available.length) {
    return null;
  }

  const conditions = available.map((column) => `${normalizeSqlText(`e.${quoteIdent(column)}`)} = $1`);
  const result = await pool.query(
    `SELECT
       e.id,
       e.full_name,
       e.document_number,
       e.company_id,
       e.contract_id,
       e.municipality_id,
       e.position,
       e.cargo,
       e.real_position
     FROM employees e
     WHERE ${conditions.join(" OR ")}
     ORDER BY e.id ASC
     LIMIT 1`,
    [normalized]
  );

  return result.rows[0] || null;
}

async function listEmployeesForDocumentCenter() {
  const result = await pool.query(
    `SELECT
       e.id,
       e.full_name,
       e.document_number,
       e.company_id,
       e.contract_id,
       e.municipality_id
     FROM employees e
     ORDER BY e.full_name ASC NULLS LAST, e.id ASC`
  );
  return result.rows;
}

async function getExistingDocumentsIndex() {
  const result = await pool.query(
    `SELECT DISTINCT ON (ed.employee_id, COALESCE(NULLIF(BTRIM(ed.document_type), ''), dt.code))
       ed.id,
       ed.employee_id,
       COALESCE(NULLIF(BTRIM(ed.document_type), ''), dt.code) AS document_type_code,
       ed.document_type_id,
       ed.version,
       ed.status,
       ed.replaced_document_id,
       ed.stored_filename,
       ed.file_path,
       ed.original_file_name,
       ed.uploaded_at
     FROM employee_documents ed
     LEFT JOIN document_types dt ON dt.id = ed.document_type_id
     ORDER BY
       ed.employee_id,
       COALESCE(NULLIF(BTRIM(ed.document_type), ''), dt.code),
       COALESCE(ed.version, 1) DESC,
       ed.uploaded_at DESC NULLS LAST,
       ed.id DESC`
  );

  const index = new Map();
  for (const row of result.rows) {
    const key = `${Number(row.employee_id)}:${String(row.document_type_code || "").trim().toUpperCase()}`;
    index.set(key, row);
  }
  return index;
}

async function getNextDocumentVersion(employeeId, documentTypeId, documentTypeCode) {
  const params = [Number(employeeId), Number(documentTypeId), String(documentTypeCode || "").trim().toUpperCase()];
  const result = await pool.query(
    `SELECT COALESCE(MAX(COALESCE(ed.version, 1)), 0)::int AS current_version
       FROM employee_documents ed
       LEFT JOIN document_types dt ON dt.id = ed.document_type_id
      WHERE ed.employee_id = $1
        AND (
          ed.document_type_id = $2
          OR UPPER(COALESCE(NULLIF(BTRIM(ed.document_type), ''), dt.code, '')) = $3
        )`,
    params
  );
  return Number(result.rows[0]?.current_version || 0) + 1;
}

async function createUploadBatch({ batchName, documentType, uploadMode, totalFiles = 0, createdBy = null, summaryJson = {} }) {
  const result = await pool.query(
    `INSERT INTO document_upload_batches (
       batch_name,
       document_type,
       upload_mode,
       total_files,
       created_by,
       status,
       summary_json
     ) VALUES ($1, $2, $3, $4, $5, 'PREVIEWED', $6::jsonb)
     RETURNING *`,
    [
      batchName,
      documentType || null,
      uploadMode,
      Number(totalFiles) || 0,
      createdBy,
      JSON.stringify(summaryJson || {}),
    ]
  );
  return result.rows[0];
}

async function updateUploadBatch(batchId, patch = {}) {
  const fields = [];
  const values = [];
  const allowed = {
    batch_name: "batch_name",
    document_type: "document_type",
    upload_mode: "upload_mode",
    total_files: "total_files",
    ready_count: "ready_count",
    not_found_count: "not_found_count",
    duplicate_count: "duplicate_count",
    error_count: "error_count",
    confirmed_at: "confirmed_at",
    status: "status",
    summary_json: "summary_json",
  };

  for (const [key, column] of Object.entries(allowed)) {
    if (patch[key] === undefined) continue;
    fields.push(`${column} = $${values.length + 1}`);
    values.push(key === "summary_json" ? JSON.stringify(patch[key]) : patch[key]);
  }

  if (!fields.length) {
    return getBatchById(batchId);
  }

  values.push(batchId);
  const result = await pool.query(
    `UPDATE document_upload_batches
        SET ${fields.join(", ")}
      WHERE id = $${values.length}
      RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

async function getBatchById(batchId) {
  const result = await pool.query(
    `SELECT *
       FROM document_upload_batches
      WHERE id = $1
      LIMIT 1`,
    [batchId]
  );
  return result.rows[0] || null;
}

async function listBatches({ limit = 50, offset = 0 } = {}) {
  const result = await pool.query(
    `SELECT *
       FROM document_upload_batches
      ORDER BY created_at DESC, id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}

async function getBatchItems(batchId) {
  const result = await pool.query(
    `SELECT *
       FROM document_upload_batch_items
      WHERE batch_id = $1
      ORDER BY id ASC`,
    [batchId]
  );
  return result.rows;
}

async function insertBatchItem(item) {
  const result = await pool.query(
    `INSERT INTO document_upload_batch_items (
       batch_id,
       original_filename,
       stored_filename,
       detected_document_number,
       employee_id,
       employee_name,
       document_type,
       status,
       reason,
       action,
       employee_document_id,
       temp_file_path
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      item.batch_id,
      item.original_filename,
      item.stored_filename || null,
      item.detected_document_number || null,
      item.employee_id || null,
      item.employee_name || null,
      item.document_type || null,
      item.status,
      item.reason || null,
      item.action || null,
      item.employee_document_id || null,
      item.temp_file_path || null,
    ]
  );
  return result.rows[0];
}

async function updateBatchItem(itemId, patch = {}) {
  const allowed = {
    stored_filename: "stored_filename",
    employee_id: "employee_id",
    document_type: "document_type",
    status: "status",
    reason: "reason",
    action: "action",
    employee_document_id: "employee_document_id",
  };
  const fields = [];
  const values = [];

  for (const [key, column] of Object.entries(allowed)) {
    if (patch[key] === undefined) continue;
    fields.push(`${column} = $${values.length + 1}`);
    values.push(patch[key]);
  }

  if (!fields.length) {
    return getBatchItemsById(itemId);
  }

  values.push(itemId);
  const result = await pool.query(
    `UPDATE document_upload_batch_items
        SET ${fields.join(", ")}
      WHERE id = $${values.length}
      RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

async function getBatchItemsById(itemId) {
  const result = await pool.query(
    `SELECT *
       FROM document_upload_batch_items
      WHERE id = $1
      LIMIT 1`,
    [itemId]
  );
  return result.rows[0] || null;
}

async function insertEmployeeDocument(data) {
  const columns = await getTableColumns("employee_documents");
  const insertColumns = [];
  const values = [];
  const push = (column, value) => {
    if (!columns.has(column)) return;
    insertColumns.push(column);
    values.push(value);
  };

  push("employee_id", data.employee_id);
  push("document_type_id", data.document_type_id);
  push("document_type", data.document_type);
  push("original_file_name", data.original_file_name);
  push("stored_filename", data.stored_filename);
  push("file_name", data.stored_filename);
  push("file_path", data.file_path);
  push("file_url", data.file_path);
  push("file_size", data.file_size);
  push("mime_type", data.mime_type);
  push("checksum", data.checksum);
  push("status", data.status || "cargado");
  push("uploaded_by", data.uploaded_by || null);
  push("uploaded_at", data.uploaded_at || new Date());
  push("replaced_document_id", data.replaced_document_id || null);
  push("batch_id", data.batch_id || null);
  push("version", data.version || 1);
  push("master_document_type_id", data.master_document_type_id || null);

  const placeholders = insertColumns.map((_, index) => `$${index + 1}`);
  const result = await pool.query(
    `INSERT INTO employee_documents (${insertColumns.join(", ")})
     VALUES (${placeholders.join(", ")})
     RETURNING *`,
    values
  );
  return result.rows[0];
}

async function getEmployeeDocumentsByEmployee(employeeId) {
  const result = await pool.query(
    `SELECT
       ed.*,
       dt.code AS document_type_code,
       dt.name AS document_type_name,
       e.full_name AS employee_name,
       e.document_number
     FROM employee_documents ed
     JOIN employees e ON e.id = ed.employee_id
     LEFT JOIN document_types dt ON dt.id = ed.document_type_id
     WHERE ed.employee_id = $1
     ORDER BY COALESCE(ed.version, 1) DESC, ed.uploaded_at DESC NULLS LAST, ed.id DESC`,
    [employeeId]
  );
  return result.rows;
}

async function markEmployeeDocumentReplaced(documentId, replacedByDocumentId) {
  const result = await pool.query(
    `UPDATE employee_documents
        SET status = 'REPLACED',
            replaced_document_id = COALESCE(replaced_document_id, $2)
      WHERE id = $1
      RETURNING *`,
    [documentId, replacedByDocumentId || null]
  );
  return result.rows[0] || null;
}

async function searchRepositoryDocuments(filters = {}) {
  const values = [];
  const where = [];

  if (filters.documentNumber) {
    values.push(String(filters.documentNumber).trim());
    where.push(`regexp_replace(COALESCE(NULLIF(BTRIM(e.document_number), ''), ''), '[^0-9]', '', 'g') = $${values.length}`);
  }

  if (filters.name) {
    values.push(`%${String(filters.name).trim().toLowerCase()}%`);
    where.push(`LOWER(COALESCE(e.full_name, '')) LIKE $${values.length}`);
  }

  if (filters.documentType) {
    values.push(String(filters.documentType).trim().toUpperCase());
    where.push(`UPPER(COALESCE(NULLIF(BTRIM(ed.document_type), ''), dt.code, '')) = $${values.length}`);
  }

  if (filters.municipality) {
    values.push(`%${String(filters.municipality).trim().toLowerCase()}%`);
    where.push(`LOWER(COALESCE(m.name, e.municipality_name, '')) LIKE $${values.length}`);
  }

  if (filters.contract) {
    values.push(`%${String(filters.contract).trim().toLowerCase()}%`);
    where.push(`LOWER(COALESCE(c.name, c.code, '')) LIKE $${values.length}`);
  }

  if (filters.company) {
    values.push(`%${String(filters.company).trim().toLowerCase()}%`);
    where.push(`LOWER(COALESCE(co.name, '')) LIKE $${values.length}`);
  }

  if (filters.batchId) {
    values.push(Number(filters.batchId));
    where.push(`ed.batch_id = $${values.length}`);
  }

  const limit = Number(filters.limit || 100);
  const offset = Number(filters.offset || 0);
  values.push(limit);
  values.push(offset);

  const result = await pool.query(
    `SELECT
       ed.id,
       ed.employee_id,
       ed.document_type_id,
       COALESCE(NULLIF(BTRIM(ed.document_type), ''), dt.code) AS document_type,
       COALESCE(NULLIF(BTRIM(ed.document_type), ''), dt.code) AS document_type_code,
       dt.name AS document_type_name,
       ed.original_file_name,
       ed.stored_filename,
       ed.file_path,
       ed.file_size,
       ed.mime_type,
       ed.checksum,
       ed.status,
       ed.uploaded_by,
       ed.uploaded_at,
       ed.replaced_document_id,
       ed.batch_id,
       ed.version,
       e.full_name AS employee_name,
       e.document_number,
       m.name AS municipality_name,
       c.name AS company_name,
       co.name AS contract_name
     FROM employee_documents ed
     JOIN employees e ON e.id = ed.employee_id
     LEFT JOIN document_types dt ON dt.id = ed.document_type_id
     LEFT JOIN municipalities m ON m.id = e.municipality_id
     LEFT JOIN companies co ON co.id = e.company_id
     LEFT JOIN contracts c ON c.id = e.contract_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ed.uploaded_at DESC NULLS LAST, ed.id DESC
     LIMIT $${values.length - 1}
     OFFSET $${values.length}`,
    values
  );

  return result.rows;
}

async function logDocumentAudit({
  userId,
  userName,
  action,
  employeeId = null,
  employeeName = null,
  documentType = null,
  fileName = null,
  ip = null,
  payload = {},
}) {
  const columns = await getTableColumns("audit_logs").catch(() => new Set());
  const insertColumns = [];
  const values = [];
  const push = (column, value) => {
    if (!columns.has(column)) return false;
    insertColumns.push(column);
    values.push(value);
    return true;
  };

  push("module", "documents");
  push("entity_type", "employee_document");
  push("entity_id", employeeId ? String(employeeId) : null);
  push("entity_name", employeeName || documentType || fileName || "documento");
  push("action", action);
  push("user_id", userId || null);
  push("user_name", userName || "Sistema");
  push("reason", null);
  push("payload", {
    employeeId,
    employeeName,
    documentType,
    fileName,
    ip,
    ...payload,
  });

  if (!insertColumns.length) return null;

  const placeholders = insertColumns.map((_, index) => `$${index + 1}`);
  const result = await pool.query(
    `INSERT INTO audit_logs (${insertColumns.join(", ")})
     VALUES (${placeholders.join(", ")})`,
    values
  );
  return result.rowCount || 0;
}

module.exports = {
  getTableColumns,
  listCatalogDocumentTypes,
  getDocumentTypeByCode,
  findEmployeeByDocumentNumber,
  listEmployeesForDocumentCenter,
  getExistingDocumentsIndex,
  getNextDocumentVersion,
  createUploadBatch,
  updateUploadBatch,
  getBatchById,
  listBatches,
  getBatchItems,
  insertBatchItem,
  updateBatchItem,
  insertEmployeeDocument,
  getEmployeeDocumentsByEmployee,
  markEmployeeDocumentReplaced,
  searchRepositoryDocuments,
  logDocumentAudit,
};
