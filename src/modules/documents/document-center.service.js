"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");

const { isR2Configured, putFile } = require("../../config/storage");
const {
  PREVIEW_STATUS,
  DUPLICATE_STRATEGY,
  UPLOAD_MODE,
  buildEmployeeNumberIndex,
  classifyPreviewFile,
  summarizePreviewRows,
  buildFinalSummary,
} = require("./document-center.logic");
const repo = require("./document-center.repository");

const FINAL_UPLOAD_ROOT = path.resolve(process.cwd(), "uploads", "documents");
const PREVIEW_TEMP_ROOT = path.join(os.tmpdir(), "empiria-document-center");

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

ensureDirSync(FINAL_UPLOAD_ROOT);
ensureDirSync(PREVIEW_TEMP_ROOT);

function getBatchTempDir(batchId) {
  return path.join(PREVIEW_TEMP_ROOT, String(batchId));
}

async function readFileBuffer(filePath) {
  return fs.promises.readFile(filePath);
}

function getUserDisplayName(user) {
  return user?.name || user?.full_name || user?.fullName || user?.username || user?.email || "Sistema";
}

function getUploadedById(user) {
  return user?.id || null;
}

function resolveUploadMode(uploadMode) {
  const mode = String(uploadMode || "").trim().toUpperCase();
  return Object.values(UPLOAD_MODE).includes(mode) ? mode : null;
}

function buildBatchName(uploadMode, documentType) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const typeLabel = documentType || uploadMode;
  return `Carga masiva ${typeLabel} ${stamp}`;
}

function generateFinalStoredFilename({ employeeId, documentType, version, checksum, originalName }) {
  const ext = path.extname(String(originalName || "")).toLowerCase() || ".pdf";
  const hashPart = String(checksum || "").slice(0, 12);
  return `${String(employeeId)}_${String(documentType)}_v${Number(version)}_${hashPart}${ext}`;
}

function getFinalStorageKey(storedFilename) {
  return `documents/${storedFilename}`;
}

async function persistFinalFile({ buffer, storedFilename, mimeType }) {
  const localPath = path.join(FINAL_UPLOAD_ROOT, storedFilename);
  if (!isR2Configured()) {
    await fs.promises.writeFile(localPath, buffer);
    return {
      filePath: `/uploads/documents/${storedFilename}`,
      storedFilename,
      localPath,
    };
  }

  const key = getFinalStorageKey(storedFilename);
  await putFile(key, buffer, mimeType || "application/pdf");
  return {
    filePath: key,
    storedFilename,
    localPath: null,
  };
}

async function deleteTempFile(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // ignore cleanup errors
  }
}

async function getCatalogDocumentTypes() {
  return repo.listCatalogDocumentTypes();
}

async function previewBatch({
  files = [],
  uploadMode,
  documentType,
  batchName,
  user = null,
  ip = null,
}) {
  const resolvedUploadMode = resolveUploadMode(uploadMode);
  if (!resolvedUploadMode) {
    throw Object.assign(new Error("upload_mode invalido"), { statusCode: 400 });
  }

  if (!Array.isArray(files) || !files.length) {
    throw Object.assign(new Error("Debes adjuntar al menos un archivo PDF"), { statusCode: 400 });
  }

  const [employees, catalogTypes, existingDocumentsIndex] = await Promise.all([
    repo.listEmployeesForDocumentCenter(),
    repo.listCatalogDocumentTypes(),
    repo.getExistingDocumentsIndex(),
  ]);

  // Validate document_type against the live DB catalog (not a hardcoded list)
  let selectedDocumentType = null;
  if (resolvedUploadMode === UPLOAD_MODE.CATEGORY) {
    const normalized = String(documentType || "").trim().toUpperCase();
    const found = catalogTypes.find((t) => t.code.toUpperCase() === normalized);
    if (!found) {
      throw Object.assign(new Error("document_type invalido o ausente"), { statusCode: 400 });
    }
    selectedDocumentType = found.code;
  }
  const employeeIndex = buildEmployeeNumberIndex(employees);
  const catalogTypeMap = new Map(catalogTypes.map((item) => [item.code, item]));

  const previewRows = files.map((file) => {
    const row = classifyPreviewFile({
      file,
      uploadMode: resolvedUploadMode,
      selectedDocumentType,
      employeeIndex,
      existingDocumentsIndex,
    });

    const catalogRecord = row.document_type ? catalogTypeMap.get(row.document_type) || null : null;
    return {
      ...row,
      document_type_id: catalogRecord?.id || null,
      original_filename: String(file.originalname || file.originalName || ""),
      stored_filename: path.basename(String(file.filename || file.path || row.original_filename || "")),
      temp_file_path: file.path || null,
      action: row.action || "REVIEW",
    };
  });

  const summary = summarizePreviewRows(previewRows);
  const createdBatch = await repo.createUploadBatch({
    batchName: batchName || buildBatchName(resolvedUploadMode, selectedDocumentType),
    documentType: selectedDocumentType,
    uploadMode: resolvedUploadMode,
    totalFiles: previewRows.length,
    createdBy: getUploadedById(user),
    summaryJson: {
      summary,
      uploadMode: resolvedUploadMode,
      documentType: selectedDocumentType,
      createdBy: getUserDisplayName(user),
      ip,
      previewedAt: new Date().toISOString(),
    },
  });

  const batchTempDir = getBatchTempDir(createdBatch.id);
  ensureDirSync(batchTempDir);

  const items = [];
  for (const row of previewRows) {
    const inserted = await repo.insertBatchItem({
      batch_id: createdBatch.id,
      original_filename: row.original_filename,
      stored_filename: row.stored_filename,
      detected_document_number: row.detected_document_number || null,
      employee_id: row.employee_id || null,
      employee_name: row.employee_name || null,
      document_type: row.document_type || null,
      status: row.status,
      reason: row.reason || null,
      action: row.action || null,
      employee_document_id: null,
      temp_file_path: row.temp_file_path || null,
    });
    items.push(inserted);
  }

  await repo.updateUploadBatch(createdBatch.id, {
    total_files: summary.total_files,
    ready_count: summary.ready_count,
    not_found_count: summary.not_found_count,
    duplicate_count: summary.duplicate_count,
    error_count: summary.error_count,
    status: "PREVIEWED",
    summary_json: {
      ...createdBatch.summary_json,
      batchId: createdBatch.id,
      summary,
      rows: previewRows.length,
    },
  });

  return {
    batch: await repo.getBatchById(createdBatch.id),
    summary,
    rows: previewRows,
    items,
    catalogTypes,
  };
}

async function confirmBatch({
  batchId,
  duplicateStrategy,
  user = null,
  ip = null,
}) {
  const batch = await repo.getBatchById(batchId);
  if (!batch) {
    throw Object.assign(new Error("Batch no encontrado"), { statusCode: 404 });
  }
  if (String(batch.status || "").toUpperCase() === "CONFIRMED") {
    throw Object.assign(new Error("El batch ya fue confirmado"), { statusCode: 400 });
  }

  const strategy = Object.values(DUPLICATE_STRATEGY).includes(String(duplicateStrategy || "").toUpperCase())
    ? String(duplicateStrategy).toUpperCase()
    : DUPLICATE_STRATEGY.SKIP;

  const items = await repo.getBatchItems(batch.id);
  const [catalogTypes, existingDocumentsIndex] = await Promise.all([
    repo.listCatalogDocumentTypes(),
    repo.getExistingDocumentsIndex(),
  ]);
  const catalogTypeMap = new Map(catalogTypes.map((item) => [item.code, item]));

  const results = [];
  let savedCount = 0;
  let omittedCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;

  for (const item of items) {
    const originalFilename = String(item.original_filename || "");
    const tempFilePath = item.temp_file_path || path.join(getBatchTempDir(batch.id), item.stored_filename || "");
    const documentTypeCode = String(item.document_type || "").trim().toUpperCase();
    const catalogRecord = catalogTypeMap.get(documentTypeCode) || null;
    const baseRow = {
      original_filename: originalFilename,
      detected_document_number: item.detected_document_number || "",
      employee_id: item.employee_id || null,
      employee_name: item.employee_name || null,
      document_type: documentTypeCode,
      status: item.status,
      reason: item.reason || "",
      action: item.action || "",
      employee_document_id: null,
      version: null,
      stored_filename: item.stored_filename || "",
    };

    if (item.status === PREVIEW_STATUS.NOT_FOUND || item.status === PREVIEW_STATUS.INVALID_FILENAME || item.status === PREVIEW_STATUS.TYPE_UNRECOGNIZED || item.status === PREVIEW_STATUS.ERROR) {
      results.push({
        ...baseRow,
        action: "OMIT",
        reason: item.reason || "Archivo omitido por validacion previa.",
      });
      omittedCount += 1;
      continue;
    }

    if (!catalogRecord || !item.employee_id || !documentTypeCode || !fs.existsSync(tempFilePath)) {
      const reason = !catalogRecord
        ? "Tipo documental no reconocido en el catalogo."
        : !item.employee_id
          ? "Empleado no encontrado."
          : !documentTypeCode
            ? "Tipo documental vacio."
            : "No se encontro el archivo temporal del lote.";
      results.push({
        ...baseRow,
        status: PREVIEW_STATUS.ERROR,
        reason,
        action: "OMIT",
      });
      errorCount += 1;
      continue;
    }

    const existing = existingDocumentsIndex.get(`${Number(item.employee_id)}:${documentTypeCode}`) || null;
    const isDuplicate = item.status === PREVIEW_STATUS.DUPLICATE || existing !== null;

    if (isDuplicate) {
      duplicateCount += 1;
      if (strategy === DUPLICATE_STRATEGY.SKIP) {
        results.push({
          ...baseRow,
          action: "SKIP",
          reason: "Duplicado omitido por estrategia SKIP.",
        });
        omittedCount += 1;
        continue;
      }
    }

    try {
      const buffer = await readFileBuffer(tempFilePath);
      const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
      const version = await repo.getNextDocumentVersion(item.employee_id, catalogRecord.id, documentTypeCode);
      const storedFilename = generateFinalStoredFilename({
        employeeId: item.employee_id,
        documentType: documentTypeCode,
        version,
        checksum,
        originalName: originalFilename,
      });
      const mimeType = "application/pdf";
      const storage = await persistFinalFile({
        buffer,
        storedFilename,
        mimeType,
      });

      if (existing && strategy === DUPLICATE_STRATEGY.REPLACE) {
        await repo.markEmployeeDocumentReplaced(existing.id, null);
      }

      const inserted = await repo.insertEmployeeDocument({
        employee_id: item.employee_id,
        document_type_id: catalogRecord.id,
        document_type: documentTypeCode,
        original_file_name: originalFilename,
        stored_filename: storedFilename,
        file_path: storage.filePath,
        file_size: buffer.length,
        mime_type: mimeType,
        checksum,
        status: "cargado",
        uploaded_by: getUploadedById(user),
        uploaded_at: new Date(),
        replaced_document_id: existing?.id || null,
        batch_id: batch.id,
        version,
        master_document_type_id: catalogRecord.master_document_type_id || null,
      });

      if (existing) {
        await repo.markEmployeeDocumentReplaced(existing.id, inserted.id);
      }

      await repo.updateBatchItem(item.id, {
        stored_filename: storedFilename,
        status: item.status,
        action: existing && strategy === DUPLICATE_STRATEGY.REPLACE
          ? "REPLACE"
          : strategy === DUPLICATE_STRATEGY.KEEP_BOTH && existing
            ? "KEEP_BOTH"
            : "UPLOAD",
        employee_document_id: inserted.id,
      });

      await repo.logDocumentAudit({
        userId: getUploadedById(user),
        userName: getUserDisplayName(user),
        action: existing && strategy === DUPLICATE_STRATEGY.REPLACE ? "REPLACE" : "UPLOAD",
        employeeId: item.employee_id,
        employeeName: item.employee_name || null,
        documentType: documentTypeCode,
        fileName: originalFilename,
        ip,
        payload: {
          batchId: batch.id,
          version,
          duplicateStrategy: strategy,
          documentId: inserted.id,
          checksum,
        },
      });

      results.push({
        ...baseRow,
        employee_name: item.employee_name || null,
        employee_document_id: inserted.id,
        stored_filename: storedFilename,
        version,
        status: item.status,
        action: existing && strategy === DUPLICATE_STRATEGY.REPLACE
          ? "REPLACE"
          : strategy === DUPLICATE_STRATEGY.KEEP_BOTH && existing
            ? "KEEP_BOTH"
            : "UPLOAD",
        reason: existing
          ? (strategy === DUPLICATE_STRATEGY.REPLACE
              ? "Documento reemplazado conservando historial."
              : "Documento cargado conservando historial.")
          : "Documento guardado correctamente.",
      });
      savedCount += 1;
      existingDocumentsIndex.set(`${Number(item.employee_id)}:${documentTypeCode}`, {
        id: inserted.id,
        version,
      });
    } catch (error) {
      results.push({
        ...baseRow,
        action: "OMIT",
        status: PREVIEW_STATUS.ERROR,
        reason: error.message || "No fue posible guardar el documento.",
      });
      errorCount += 1;
    } finally {
      await deleteTempFile(tempFilePath);
    }
  }

  const finalSummary = buildFinalSummary(results);
  const confirmedBatch = await repo.updateUploadBatch(batch.id, {
    status: "CONFIRMED",
    confirmed_at: new Date(),
    total_files: finalSummary.total_files,
    ready_count: finalSummary.ready_count,
    not_found_count: finalSummary.not_found_count,
    duplicate_count: finalSummary.duplicate_count,
    error_count: finalSummary.error_count,
    summary_json: {
      ...(batch.summary_json || {}),
      confirmedAt: new Date().toISOString(),
      duplicateStrategy: strategy,
      results,
      summary: finalSummary,
    },
  });

  return {
    batch: confirmedBatch,
    summary: finalSummary,
    rows: results,
    savedCount,
    omittedCount,
    duplicateCount,
    errorCount,
  };
}

async function getBatches({ limit = 50, offset = 0 } = {}) {
  const rows = await repo.listBatches({ limit, offset });
  return rows.map((row) => ({
    ...row,
    summary_json: row.summary_json || {},
  }));
}

async function getBatchDetail(batchId) {
  const batch = await repo.getBatchById(batchId);
  if (!batch) return null;
  const items = await repo.getBatchItems(batchId);
  return {
    batch: {
      ...batch,
      summary_json: batch.summary_json || {},
    },
    items,
  };
}

function buildBatchExportWorkbook(batch, items = [], results = []) {
  const byItemId = new Map(results.map((row) => [String(row.employee_document_id || row.original_filename || ""), row]));
  const header = [
    "archivo original",
    "documento detectado",
    "empleado",
    "employee_id",
    "tipo documental",
    "estado",
    "motivo",
    "accion",
  ];

  const rows = items.map((item) => {
    const result = byItemId.get(String(item.employee_document_id || item.original_filename || "")) || {};
    return [
      item.original_filename || "",
      item.detected_document_number || "",
      item.employee_name || item.employee_id || "",
      item.employee_id || "",
      item.document_type || "",
      result.status || item.status || "",
      result.reason || item.reason || "",
      result.action || item.action || "",
    ];
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, "Auditoria");
  const metaWs = XLSX.utils.aoa_to_sheet([
    ["batch_id", batch.id],
    ["batch_name", batch.batch_name],
    ["status", batch.status],
    ["upload_mode", batch.upload_mode],
    ["document_type", batch.document_type || ""],
    ["total_files", batch.total_files],
    ["ready_count", batch.ready_count],
    ["not_found_count", batch.not_found_count],
    ["duplicate_count", batch.duplicate_count],
    ["error_count", batch.error_count],
  ]);
  XLSX.utils.book_append_sheet(wb, metaWs, "Resumen");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
}

async function getRepositoryDocuments(filters = {}) {
  return repo.searchRepositoryDocuments(filters);
}

async function getEmployeeRepositoryDocuments(employeeId) {
  return repo.getEmployeeDocumentsByEmployee(employeeId);
}

module.exports = {
  PREVIEW_TEMP_ROOT,
  FINAL_UPLOAD_ROOT,
  getBatchTempDir,
  getCatalogDocumentTypes,
  previewBatch,
  confirmBatch,
  getBatches,
  getBatchDetail,
  buildBatchExportWorkbook,
  getRepositoryDocuments,
  getEmployeeRepositoryDocuments,
  logDocumentAudit: repo.logDocumentAudit,
};
