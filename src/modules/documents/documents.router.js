/**
 * Express Router para gestion documental con Cloudflare R2.
 *
 * Montado en /documents desde app.js, toma precedencia sobre el handler legacy.
 * Los endpoints heredados (JSON base64) siguen respondiendo mientras el frontend
 * no migre completamente.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const multer = require("multer");
const { Router } = require("express");

const pool = require("../../db/pool");
const { requireAuth } = require("../auth/auth.helpers");
const { createViewToken, consumeViewToken } = require("../../auth/tokens");
const { sendJson } = require("../../http/response");
const { readJsonBody } = require("../../http/request");
const { upload, normalizeUploadedFile } = require("../../middleware/upload");
const { getPrivateUrl, deleteFile, isR2Configured, fileExists } = require("../../config/storage");
const { getEmployeeDossier } = require("../employees/employee-dossier.service");
const {
  getDocumentsByEmployee,
  getActiveDocumentsByEmployee,
  getDocumentsByEmployees,
  getDocumentsByCompany,
  getDocumentById,
  getDocumentByEmployeeAndType,
  createDocument,
  updateDocumentStatus,
  appendDocumentObservation,
  getLatestDocumentsIndex,
  deleteDocument,
  getDocumentAlerts,
  getDocumentTypes,
  getDocumentTypeById,
  resolveDocumentType,
  getNextDocumentVersion,
  getEmployeesForDocumentMatching,
  documentExistsByFileKey,
  getDocumentDiagnostics,
  getInvalidDocumentRelations,
  getExistingDocumentFileKeys,
  getDocumentsMissingMasterDocumentType,
  backfillMasterDocumentTypes,
  softDeleteEmployeeDocument,
} = require("../../db/documents.repository");
const {
  markEmployeeDocumentReplaced,
  findEmployeeByDocumentNumber,
} = require("./document-center.repository");
const {
  PREVIEW_TEMP_ROOT,
  previewBatch,
  confirmBatch,
  getBatches,
  getBatchDetail,
  buildBatchExportWorkbook,
  getRepositoryDocuments,
  getEmployeeRepositoryDocuments,
  logDocumentAudit,
} = require("./document-center.service");
const legacyDocs = require("../../data/documents");
const {
  PREVIEW_STATUS,
  DUPLICATE_STRATEGY,
  BULK_TOTAL_FILES_LIMIT,
  BULK_TOTAL_LIMIT,
  BULK_PER_FILE_LIMIT,
  BULK_ZIP_LIMIT,
  buildBulkReviewRow,
  summarizePreviewRows,
  buildCommitCsv,
  extractRequestSources,
  storeFinalDocument,
  cleanupUploadedFiles,
} = require("./bulk-upload.service");

function authMiddleware(req, res, next) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  req.user = auth.user;
  next();
}

const DOCUMENT_BULK_DIAG = process.env.DIAGNOSE_DOCUMENT_BULK === "1";

function logDocumentDiag(scope, message, extra = undefined) {
  if (!DOCUMENT_BULK_DIAG) return;
  const suffix = extra === undefined ? "" : ` ${JSON.stringify(extra)}`;
  console.log(`[documents][diag][${scope}] ${message}${suffix}`);
}

function attachRouteDiagnostics(scope) {
  return function routeDiagnostics(req, res, next) {
    if (!DOCUMENT_BULK_DIAG) return next();

    const startedAt = Date.now();
    const meta = {
      method: req.method,
      url: req.originalUrl || req.url,
    };

    logDocumentDiag(scope, "request_received", meta);
    req.on("aborted", () => {
      logDocumentDiag(scope, "request_aborted", { ...meta, elapsedMs: Date.now() - startedAt });
    });
    req.on("close", () => {
      logDocumentDiag(scope, "request_close", { ...meta, elapsedMs: Date.now() - startedAt });
    });
    res.on("finish", () => {
      logDocumentDiag(scope, "response_finish", {
        ...meta,
        statusCode: res.statusCode,
        elapsedMs: Date.now() - startedAt,
      });
    });
    res.on("close", () => {
      logDocumentDiag(scope, "response_close", {
        ...meta,
        statusCode: res.statusCode,
        elapsedMs: Date.now() - startedAt,
      });
    });

    next();
  };
}

function requireRole(...roles) {
  return function (req, res, next) {
    const auth = requireAuth(req, res);
    if (!auth) return;
    req.user = auth.user;
    if (roles.length && !roles.includes(req.user.role)) {
      return sendJson(res, 403, { ok: false, message: "No tienes permiso para esta accion" });
    }
    next();
  };
}

function resolveCompanyId(req) {
  return (
    req.user?.companyId ||
    Number(req.query.companyId || req.body?.companyId) ||
    null
  );
}

function multerErrorHandler(err, req, res, next) {
  if (err.code === "LIMIT_FILE_SIZE") {
    return sendJson(res, 400, { ok: false, message: "El archivo excede el limite permitido" });
  }
  if (err.status === 400 || err.code === "LIMIT_UNEXPECTED_FILE") {
    return sendJson(res, 400, { ok: false, message: err.message });
  }
  next(err);
}

const bulkTempRoot = path.join(os.tmpdir(), "empiria-bulk-documents");
if (!fs.existsSync(bulkTempRoot)) fs.mkdirSync(bulkTempRoot, { recursive: true });
const SINGLE_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

const bulkUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      cb(null, bulkTempRoot);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const safeBase = path.basename(file.originalname || "file", ext).replace(/[^A-Za-z0-9_-]+/g, "_");
      cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}_${safeBase}${ext}`);
    },
  }),
  limits: {
    fileSize: SINGLE_UPLOAD_MAX_BYTES,
    files: 5000,
  },
});

const documentCenterPreviewUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      cb(null, PREVIEW_TEMP_ROOT);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const safeBase = path.basename(file.originalname || "file", ext).replace(/[^A-Za-z0-9_-]+/g, "_");
      cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}_${safeBase}${ext}`);
    },
  }),
  limits: {
    fileSize: SINGLE_UPLOAD_MAX_BYTES,
    files: 5000,
  },
});

function collectPreviewFiles(files = {}) {
  return [
    ...(files.files || []),
    ...(files["files[]"] || []),
    ...(files.documents || []),
    ...(files["documents[]"] || []),
  ];
}

function mapPgStatusToLegacy(status, validated) {
  if (validated || status === "aprobado") return "VALIDADO";
  if (status === "rechazado") return "RECHAZADO";
  if (status === "vencido") return "VENCIDO";
  return "PENDIENTE_VALIDACION";
}

function compactDocumentNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeDocumentTypeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function isSameDocumentType(doc, documentType) {
  if (!doc || !documentType) return false;
  const targetCode = normalizeDocumentTypeKey(documentType.code || documentType.name || "");
  const currentCode = normalizeDocumentTypeKey(doc.docTypeCode || doc.docTypeName || doc.document_type || "");
  return Number(doc.docTypeId || 0) === Number(documentType.id || 0) || (targetCode && currentCode === targetCode);
}

function parseBase64FilePayload(fileBase64, fallbackName = "documento.pdf") {
  const raw = String(fileBase64 || "").trim();
  const match = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw Object.assign(new Error("Debes adjuntar un archivo valido en base64."), {
      stepFailed: "file_decode",
      errorDetail: "El archivo no tiene un encabezado data: válido.",
      httpStatus: 400,
    });
  }

  const mimeType = String(match[1] || "").toLowerCase();
  const base64Data = match[2] || "";
  const extensionByMime = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  const extension = extensionByMime[mimeType];
  if (!extension) {
    throw Object.assign(new Error("El archivo tiene un formato no permitido."), {
      stepFailed: "file_validation",
      errorDetail: `Formato no permitido: ${mimeType}.`,
      httpStatus: 400,
    });
  }

  const buffer = Buffer.from(base64Data, "base64");
  if (!buffer.length) {
    throw Object.assign(new Error("El archivo enviado esta vacio."), {
      stepFailed: "file_validation",
      errorDetail: "El archivo decodificado tiene tamaño 0.",
      httpStatus: 400,
    });
  }
  if (buffer.length > SINGLE_UPLOAD_MAX_BYTES) {
    throw Object.assign(new Error("El archivo excede el tamaño maximo permitido de 10 MB."), {
      stepFailed: "file_validation",
      errorDetail: "El archivo base64 supera el límite de 10 MB.",
      httpStatus: 400,
    });
  }

  const sanitizedName = path.basename(String(fallbackName || `documento${extension}`)).trim() || `documento${extension}`;
  return {
    buffer,
    mimeType,
    extension,
    originalName: sanitizedName.endsWith(extension) ? sanitizedName : `${sanitizedName}${extension}`,
    size: buffer.length,
  };
}

async function ensureEmployeeContext(employeeId, companyId) {
  if (!employeeId) {
    throw Object.assign(new Error("Debes seleccionar un colaborador antes de subir el documento."), {
      stepFailed: "employee_validation",
      errorDetail: "employeeId es obligatorio.",
      httpStatus: 400,
    });
  }

  const numericEmployeeId = Number(employeeId);
  const employeeResult = await pool.query(
    `SELECT id, full_name, document_number, company_id, contract_id
       FROM employees
      WHERE id = $1
         OR legacy_json_id = $1
      LIMIT 1`,
    [numericEmployeeId]
  );
  const employee = employeeResult.rows[0] || null;
  if (!employee?.id) {
    throw Object.assign(new Error(`El colaborador ${employeeId} no existe.`), {
      stepFailed: "employee_validation",
      errorDetail: "No se encontró el empleado en la base de datos.",
      httpStatus: 404,
    });
  }

  if (companyId && Number(employee.company_id || 0) !== Number(companyId)) {
    throw Object.assign(new Error("El archivo se subió, pero no se pudo asociar al colaborador."), {
      stepFailed: "employee_validation",
      errorDetail: "El empleado no pertenece a la empresa activa.",
      httpStatus: 400,
    });
  }

  return {
    id: employee.id,
    fullName: employee.full_name || "",
    documentNumber: employee.document_number || "",
    companyId: employee.company_id || null,
    contractId: employee.contract_id || null,
  };
}

async function ensureDocumentTypeContext(docTypeId, documentTypeInput) {
  const resolved = docTypeId
    ? await getDocumentTypeById(Number(docTypeId))
    : await resolveDocumentType(documentTypeInput);

  if (!resolved?.id) {
    throw Object.assign(new Error("El tipo documental no existe o no está configurado."), {
      stepFailed: "document_type_validation",
      errorDetail: "No fue posible resolver el tipo documental suministrado.",
      httpStatus: 400,
    });
  }

  return resolved;
}

function getLocalDocumentPath(fileKey) {
  const safeName = path.basename(String(fileKey || ""));
  if (!safeName) return null;

  // Ruta canónica: uploads/documents/<nombre>
  const canonical = path.resolve(process.cwd(), "uploads", "documents", safeName);
  if (fs.existsSync(canonical)) return canonical;

  // Fallback: el key incluye la carpeta ("documents/<nombre>", "novedades/<nombre>", etc.)
  // Intentar uploads/<carpeta>/<nombre> tal como el middleware lo guardó originalmente.
  const parts = String(fileKey || "").replace(/\\/g, "/").split("/");
  if (parts.length >= 2) {
    const folder = parts[parts.length - 2];
    if (folder && folder !== "documents") {
      const alt = path.resolve(process.cwd(), "uploads", folder, safeName);
      if (fs.existsSync(alt)) return alt;
    }
  }

  return canonical; // devuelve ruta canónica aunque no exista (el llamador verifica)
}

async function storedDocumentFileExists(fileKey) {
  if (!fileKey) return false;
  if (isR2Configured()) return fileExists(fileKey);

  try {
    const stat = await fs.promises.stat(getLocalDocumentPath(fileKey));
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function removeStoredDocumentFile(fileKey) {
  if (!fileKey) return;
  if (isR2Configured()) {
    await deleteFile(fileKey).catch(() => null);
    return;
  }

  try {
    await fs.promises.unlink(getLocalDocumentPath(fileKey));
  } catch {
    // best effort cleanup
  }
}

async function verifyDocumentPersistence({ document, companyId, checkDossier = false }) {
  const dbRecord = document?.id ? await getDocumentById(document.id, companyId) : null;
  const employeeDocuments = document?.employeeId
    ? await getDocumentsByEmployee(document.employeeId, companyId)
    : [];
  let dossier = null;
  let dossierCheckError = "";
  if (checkDossier && document?.employeeId) {
    try {
      dossier = await getEmployeeDossier(document.employeeId);
    } catch (error) {
      dossierCheckError = error.message || "No fue posible consultar el dossier.";
    }
  }
  const dossierItems = Array.isArray(dossier?.documents?.items) ? dossier.documents.items : [];
  const visibleInProfile = employeeDocuments.some((item) => Number(item.id) === Number(document?.id));

  return {
    file_exists: await storedDocumentFileExists(document?.fileKey),
    db_record_exists: Boolean(dbRecord?.id),
    visible_in_employee_profile: visibleInProfile,
    visible_in_dossier: checkDossier
      ? (dossierCheckError
        ? visibleInProfile
        : dossierItems.some((item) => Number(item.employeeDocumentId) === Number(document?.id)))
      : null,
    dossier_check_error: dossierCheckError || null,
  };
}

function buildUploadSuccessPayload(document, verification, message) {
  const payload = {
    id: document.id,
    employee_id: document.employeeId,
    employee_name: document.employeeName || "",
    document_type: document.docTypeName || document.docTypeCode || "Documento",
    original_filename: document.originalFileName || "",
    stored_filename: document.storedFileName || document.fileName || "",
    file_path: document.filePath || document.fileKey || "",
    uploaded_at: document.uploadedAt || document.createdAt || null,
    status: document.status || "cargado",
  };

  return {
    ok: true,
    success: true,
    message,
    data: {
      document: payload,
      verification,
    },
    document: payload,
    verification,
  };
}

function buildUploadFailurePayload(error, fallbackMessage = "No se pudo guardar el documento") {
  return {
    ok: false,
    success: false,
    message: error?.message || fallbackMessage,
    error_detail: error?.errorDetail || error?.message || fallbackMessage,
    step_failed: error?.stepFailed || "unknown",
  };
}

async function persistEmployeeDocument({
  companyId,
  employee,
  documentType,
  uploadedBy,
  expiryDate,
  source,
  requireDossierVisibility = false,
}) {
  const version = await getNextDocumentVersion(employee.id, documentType.id);
  const dateString = new Date().toISOString().slice(0, 10);

  const stored = await storeFinalDocument({
    source,
    companyId,
    employeeDocumentNumber: employee.documentNumber || employee.numero_documento || "",
    documentTypeCode: documentType.code || documentType.name,
    dateString,
    version,
  });

  const storedFileKey = stored.fileKey;
  try {
    const created = await createDocument({
      employeeId: employee.id,
      docTypeId: documentType.id,
      docTypeCode: documentType.code || documentType.name,
      companyId,
      fileKey: stored.fileKey,
      fileName: stored.fileName,
      originalFileName: source.originalName,
      storedFileName: stored.fileName,
      fileSize: source.size || 0,
      mimeType: source.mimeType || "application/octet-stream",
      uploadedBy,
      uploadedAt: new Date(),
      expiryDate: expiryDate || null,
      version,
      masterDocumentTypeId: documentType.master_document_type_id || null,
      status: "cargado",
    });

    const verification = await verifyDocumentPersistence({
      document: created,
      companyId,
      checkDossier: requireDossierVisibility,
    });
    if (!verification.file_exists) {
      await deleteDocument(created.id, companyId).catch(() => null);
      throw Object.assign(new Error("El archivo fue registrado pero no quedó guardado físicamente."), {
        stepFailed: "file_storage",
        errorDetail: "El registro existe en base de datos, pero el archivo no fue encontrado en storage.",
        httpStatus: 500,
      });
    }
    if (!verification.db_record_exists) {
      throw Object.assign(new Error("El archivo fue guardado pero no quedó registrado en base de datos."), {
        stepFailed: "database_insert",
        errorDetail: "No se pudo recuperar el registro recién creado en employee_documents.",
        httpStatus: 500,
      });
    }
    if (!verification.visible_in_employee_profile) {
      await deleteDocument(created.id, companyId).catch(() => null);
      throw Object.assign(new Error("El archivo se subió, pero no se pudo asociar al colaborador."), {
        stepFailed: "visibility_check",
        errorDetail: "El documento no aparece al consultar el expediente del colaborador.",
        httpStatus: 500,
      });
    }
    if (requireDossierVisibility && verification.visible_in_dossier !== true) {
      await deleteDocument(created.id, companyId).catch(() => null);
      throw Object.assign(new Error("El documento fue cargado, pero no quedó visible en el checklist del expediente."), {
        stepFailed: "visibility_check",
        errorDetail: "La consulta del dossier no devolvió el documento recién cargado.",
        httpStatus: 500,
      });
    }

    return {
      document: created,
      verification,
      stored,
    };
  } catch (error) {
    await removeStoredDocumentFile(storedFileKey);
    throw error;
  }
}

async function buildFileUrlFromDocument(doc) {
  if (!doc?.fileKey) return "";
  if (!isR2Configured()) {
    return `/uploads/documents/${path.basename(doc.fileKey)}`;
  }
  return getPrivateUrl(doc.fileKey, 3600);
}

async function toLegacyDocumentShape(doc) {
  const fileUrl = await buildFileUrlFromDocument(doc);
  return {
    id: doc.id,
    employeeId: doc.employeeId,
    documentType: doc.docTypeName || doc.docTypeCode || "Documento",
    documentTypeId: doc.docTypeId || null,
    issueDate: "",
    expirationDate: doc.expiryDate ? String(doc.expiryDate).slice(0, 10) : "",
    fileName: doc.originalFileName || doc.fileName || "",
    storedFileName: doc.fileName || "",
    fileUrl,
    validationStatus: mapPgStatusToLegacy(doc.status, doc.validated),
    status: doc.status || "pendiente",
    uploadedBy: doc.uploadedByName || doc.uploadedBy || "Sistema",
    validatedBy: doc.validatedByName || doc.validatedBy || "",
    validatedAt: doc.validatedAt || "",
    rejectionReason: doc.status === "rechazado" ? (doc.observations || "") : "",
    createdAt: doc.createdAt || doc.uploadedAt || null,
    updatedAt: doc.validatedAt || doc.uploadedAt || null,
    source: "pg",
  };
}

async function getMergedDocumentsForQuery({ companyId, employeeId, employeeIds }) {
  const legacyData = employeeId
    ? legacyDocs.getDocumentsByEmployee(employeeId)
    : employeeIds.length
      ? legacyDocs.getDocumentsByEmployees(employeeIds)
      : legacyDocs.getAllDocuments();

  if (!companyId || (!employeeId && !employeeIds.length)) {
    return legacyData;
  }

  const pgDocs = employeeId
    ? await getDocumentsByEmployee(employeeId, companyId)
    : await getDocumentsByEmployees(employeeIds, companyId);

  const mappedPg = await Promise.all(pgDocs.map((doc) => toLegacyDocumentShape(doc)));
  return [...mappedPg, ...legacyData].sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
}

async function logBulkAudit({ req, action, context, entityId }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (module, entity_type, entity_id, action, user_id, user_name, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        "documents",
        "employee_document_bulk_upload",
        entityId ? String(entityId) : null,
        action,
        req.user?.id || null,
        req.user?.name || req.user?.email || "Usuario",
        JSON.stringify(context || {}),
      ]
    );
  } catch (err) {
    console.warn("[documents] bulk audit skipped:", err.message);
  }
}

function normalizePreviewCounts(summary) {
  return {
    total: summary.total || 0,
    ready: summary.ready || 0,
    withConflicts: summary.withConflicts || 0,
    statuses: {
      [PREVIEW_STATUS.READY]: summary.statuses?.[PREVIEW_STATUS.READY] || 0,
      [PREVIEW_STATUS.REQUIRES_REVIEW]: summary.statuses?.[PREVIEW_STATUS.REQUIRES_REVIEW] || 0,
      [PREVIEW_STATUS.NOT_FOUND]: summary.statuses?.[PREVIEW_STATUS.NOT_FOUND] || 0,
      [PREVIEW_STATUS.TYPE_UNRECOGNIZED]: summary.statuses?.[PREVIEW_STATUS.TYPE_UNRECOGNIZED] || 0,
      [PREVIEW_STATUS.ERROR]: summary.statuses?.[PREVIEW_STATUS.ERROR] || 0,
    },
  };
}

function summarizeLegacyBulkRows(rows) {
  return rows.reduce((acc, row) => {
    acc.processed += 1;
    if (row.status === PREVIEW_STATUS.READY || row.status === "MATCHED") acc.matched += 1;
    if (row.status === PREVIEW_STATUS.NOT_FOUND || row.status === "NO_MATCH") acc.unmatched += 1;
    if (row.status === "DUPLICATE" || row.isDuplicateFileName) acc.duplicates += 1;
    if (
      row.status === PREVIEW_STATUS.ERROR ||
      row.status === PREVIEW_STATUS.REQUIRES_REVIEW ||
      row.status === PREVIEW_STATUS.TYPE_UNRECOGNIZED ||
      row.status === "DOCUMENT_TYPE_NULL" ||
      row.status === "DOCUMENT_TYPE_NOT_FOUND" ||
      row.status === "EMPLOYEE_NOT_FOUND_OR_OTHER_COMPANY" ||
      row.status === "PHYSICAL_WITHOUT_DB"
    ) {
      acc.errors += 1;
    }
    if (row.canAutoAssign) acc.assignable += 1;
    return acc;
  }, {
    processed: 0,
    matched: 0,
    unmatched: 0,
    duplicates: 0,
    errors: 0,
    assignable: 0,
  });
}

function listLocalDocumentFiles() {
  const root = path.resolve(process.cwd(), "uploads", "documents");
  if (!fs.existsSync(root)) return [];

  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = path.relative(path.resolve(process.cwd(), "uploads"), abs).replace(/\\/g, "/");
      const stat = fs.statSync(abs);
      out.push({
        fileKey: rel,
        fileName: entry.name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  };
  walk(root);
  return out;
}

function markFileNameDuplicates(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = String(row.fileName || "").trim().toUpperCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return rows.map((row) => {
    const key = String(row.fileName || "").trim().toUpperCase();
    const isDuplicateFileName = counts.get(key) > 1;
    return isDuplicateFileName
      ? { ...row, status: "DUPLICATE", isDuplicateFileName, canAutoAssign: false }
      : row;
  });
}

const DOCUMENT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const DOCUMENT_UPLOAD_MIME = "application/pdf";

function normalizeDocumentTypeCode(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function extractDocumentNumberFromFilename(filename) {
  const normalized = String(filename || "").replace(/\D/g, "");
  return normalized.length >= 5 ? normalized : "";
}

function buildAttachmentName(doc) {
  const fileName = String(doc?.originalFileName || doc?.storedFileName || doc?.fileName || "documento.pdf").trim();
  return fileName.replace(/["\\]/g, "_");
}

async function getDocumentFileUrl(doc, { download = false } = {}) {
  if (!doc?.fileKey) return null;
  if (!isR2Configured()) return null;
  const disposition = download
    ? `attachment; filename="${buildAttachmentName(doc)}"`
    : `inline; filename="${buildAttachmentName(doc)}"`;
  return getPrivateUrl(doc.fileKey, {
    expiresIn: 3600,
    responseContentDisposition: disposition,
    responseContentType: DOCUMENT_UPLOAD_MIME,
  });
}

async function persistStableDocumentUpload({
  req,
  employee,
  documentType,
  file,
  companyId,
  replaceDocumentId = null,
}) {
  const normalizedFile = normalizeUploadedFile(file);
  if (!normalizedFile?.key) {
    throw Object.assign(new Error("No se pudo resolver el archivo cargado."), {
      stepFailed: "file_validation",
      errorDetail: "El middleware no devolvió una key de almacenamiento.",
      httpStatus: 400,
    });
  }

  const activePrevious = replaceDocumentId
    ? await getDocumentById(Number(replaceDocumentId), companyId)
    : await getDocumentByEmployeeAndType(employee.id, documentType.code || documentType.name, companyId);

  console.log("[documents][upload] archivo recibido", {
    originalName: file.originalname,
    storedFileName: normalizedFile.storedFileName,
    storagePath: normalizedFile.key,
    size: file.size,
  });
  console.log("[documents][upload] empleado encontrado", {
    employeeId: employee.id,
    fullName: employee.fullName,
    documentNumber: employee.documentNumber,
  });

  const created = await createDocument({
    employeeId: employee.id,
    docTypeId: documentType.id,
    docTypeCode: documentType.code || documentType.name,
    companyId,
    fileKey: normalizedFile.key,
    fileName: normalizedFile.storedFileName || path.basename(normalizedFile.key),
    originalFileName: file.originalname || normalizedFile.fileName || normalizedFile.storedFileName,
    storedFileName: normalizedFile.storedFileName || path.basename(normalizedFile.key),
    fileSize: file.size || normalizedFile.fileSize || 0,
    mimeType: file.mimetype || DOCUMENT_UPLOAD_MIME,
    uploadedBy: req.user?.id || null,
    uploadedAt: new Date(),
    expiryDate: null,
    version: 1,
    masterDocumentTypeId: documentType.master_document_type_id || null,
    employeeContractId: employee.contractId || null,
    status: "uploaded",
  });

  if (activePrevious?.id && Number(activePrevious.id) !== Number(created.id)) {
    await markEmployeeDocumentReplaced(activePrevious.id, created.id);
  }

  console.log("[documents][upload] documento insertado/actualizado", {
    documentId: created.id,
    replacedDocumentId: activePrevious?.id || null,
  });
  console.log("[documents][upload] ruta guardada", {
    storagePath: created.filePath || created.fileKey,
    storedFileName: created.storedFileName || normalizedFile.storedFileName,
  });

  return {
    document: created,
    previousDocument: activePrevious || null,
    normalizedFile,
  };
}

function createDocumentsRouter() {
  const router = Router();
  const uploadMiddleware = upload("documents", {
    allowedExtensions: [".pdf"],
    maxSize: DOCUMENT_UPLOAD_MAX_BYTES,
  });
  const bulkUploadMiddleware = upload("documents", {
    allowedExtensions: [".pdf"],
    maxSize: DOCUMENT_UPLOAD_MAX_BYTES,
  });

  const respondWithDocument = async (req, res, doc, { download = false } = {}) => {
    if (!doc) {
      return sendJson(res, 404, { ok: false, message: "Documento no encontrado" });
    }

    if (!isR2Configured()) {
      const resolvedKey = doc.fileKey || doc.filePath || doc.storedFileName || doc.fileName;
      const localPath = getLocalDocumentPath(resolvedKey);
      if (!localPath || !fs.existsSync(localPath)) {
        const missing = path.basename(String(resolvedKey || "")) || "desconocido";
        console.warn("[documents][view] archivo no encontrado id=%s key=%s path=%s", doc.id, resolvedKey, localPath);
        return sendJson(res, 404, { ok: false, message: `Archivo no encontrado: ${missing}` });
      }
      if (download) {
        return res.download(localPath, buildAttachmentName(doc));
      }
      return res.sendFile(localPath);
    }

    const signedUrl = await getDocumentFileUrl(doc, { download });
    if (!signedUrl) {
      return sendJson(res, 500, { ok: false, message: "No fue posible generar la URL del documento" });
    }
    return res.redirect(signedUrl);
  };

  router.post(
    "/upload",
    authMiddleware,
    uploadMiddleware.single("file"),
    async (req, res) => {
      try {
        const companyId = resolveCompanyId(req);
        if (!companyId) {
          return sendJson(res, 400, { ok: false, message: "companyId requerido" });
        }

        const employeeId = req.body.employee_id || req.body.employeeId;
        const documentTypeKey = req.body.document_type_key || req.body.documentTypeKey || req.body.documentType;
        const file = req.file;

        if (!employeeId) {
          return sendJson(res, 400, { ok: false, message: "employee_id requerido" });
        }
        if (!documentTypeKey) {
          return sendJson(res, 400, { ok: false, message: "document_type_key requerido" });
        }
        if (!file) {
          return sendJson(res, 400, { ok: false, message: "file requerido" });
        }

        const employee = await ensureEmployeeContext(employeeId, companyId);
        const documentType = await ensureDocumentTypeContext(null, documentTypeKey);
        const result = await persistStableDocumentUpload({
          req,
          employee,
          documentType,
          file,
          companyId,
        });

        return sendJson(res, 201, {
          ok: true,
          document: {
            id: result.document.id,
            employee_id: result.document.employeeId,
            document_type_key: result.document.docTypeCode || normalizeDocumentTypeCode(documentTypeKey),
            file_name: result.document.storedFileName || result.document.fileName,
            storage_path: result.document.filePath || result.document.fileKey,
            status: result.document.status || "uploaded",
          },
          data: {
            document: {
              id: result.document.id,
              employee_id: result.document.employeeId,
              document_type_key: result.document.docTypeCode || normalizeDocumentTypeCode(documentTypeKey),
              file_name: result.document.storedFileName || result.document.fileName,
              storage_path: result.document.filePath || result.document.fileKey,
              status: result.document.status || "uploaded",
            },
          },
          message: "El documento fue cargado correctamente.",
        });
      } catch (err) {
        console.error("[documents] POST /upload:", err.message);
        return sendJson(res, err.httpStatus || 400, {
          ok: false,
          message: err.message || "No se pudo guardar el documento",
        });
      }
    }
  );

  router.put(
    "/:id/replace",
    authMiddleware,
    uploadMiddleware.single("file"),
    async (req, res) => {
      try {
        const companyId = resolveCompanyId(req);
        if (!companyId) {
          return sendJson(res, 400, { ok: false, message: "companyId requerido" });
        }

        const file = req.file;
        if (!file) {
          return sendJson(res, 400, { ok: false, message: "file requerido" });
        }

        const existing = await getDocumentById(Number(req.params.id), companyId);
        if (!existing) {
          return sendJson(res, 404, { ok: false, message: "Documento no encontrado" });
        }

        const employee = await ensureEmployeeContext(existing.employeeId, companyId);
        const documentType = await ensureDocumentTypeContext(existing.docTypeId, req.body.document_type_key || req.body.documentTypeKey || existing.docTypeCode || existing.docTypeName);
        const result = await persistStableDocumentUpload({
          req,
          employee,
          documentType,
          file,
          companyId,
          replaceDocumentId: existing.id,
        });

        return sendJson(res, 200, {
          ok: true,
          document: {
            id: result.document.id,
            employee_id: result.document.employeeId,
            document_type_key: result.document.docTypeCode || documentType.code || "",
            file_name: result.document.storedFileName || result.document.fileName,
            storage_path: result.document.filePath || result.document.fileKey,
            status: result.document.status || "uploaded",
          },
          message: "El documento fue reemplazado correctamente.",
        });
      } catch (err) {
        console.error("[documents] PUT /:id/replace:", err.message);
        return sendJson(res, err.httpStatus || 400, {
          ok: false,
          message: err.message || "No se pudo reemplazar el documento",
        });
      }
    }
  );

  router.get("/employee/:employeeId", authMiddleware, async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }

      const docs = await getActiveDocumentsByEmployee(req.params.employeeId, companyId);
      return sendJson(res, 200, {
        ok: true,
        data: docs.map((doc) => ({
          id: doc.id,
          employee_id: doc.employeeId,
          document_type_key: doc.docTypeCode || normalizeDocumentTypeCode(doc.docTypeName || ""),
          document_type_name: doc.docTypeName || doc.docTypeCode || "",
          original_filename: doc.originalFileName || doc.fileName || "",
          stored_filename: doc.storedFileName || "",
          storage_path: doc.filePath || doc.fileKey || "",
          mime_type: doc.mimeType || "",
          size_bytes: doc.fileSize || 0,
          status: doc.status || "uploaded",
          uploaded_at: doc.uploadedAt || doc.createdAt || null,
          replaced_by_document_id: doc.replacedByDocumentId || null,
        })),
      });
    } catch (err) {
      console.error("[documents] GET /employee/:employeeId:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error obteniendo documentos del empleado" });
    }
  });

  // Genera un token temporal (60 s, un solo uso) para abrir el documento
  // en una pestaña nueva sin necesitar el header Authorization.
  router.post("/:id/view-token", authMiddleware, async (req, res) => {
    try {
      const docId = Number(req.params.id);
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }
      const token = createViewToken({ docId, companyId, userId: req.user?.id });
      return sendJson(res, 200, { ok: true, token });
    } catch (err) {
      console.error("[documents] POST /:id/view-token:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error generando token" });
    }
  });

  router.get("/:id/view", async (req, res) => {
    try {
      // Acepta Bearer token (petición AJAX) o ?vt= (pestaña nueva)
      let companyId = null;
      const vt = req.query.vt;
      if (vt) {
        const vtData = consumeViewToken(vt);
        if (!vtData || vtData.docId !== Number(req.params.id)) {
          return sendJson(res, 401, { ok: false, message: "Token de vista inválido o expirado" });
        }
        companyId = vtData.companyId;
      } else {
        const auth = requireAuth(req, res);
        if (!auth) return;
        req.user = auth.user;
        companyId = resolveCompanyId(req);
      }
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }
      const doc = await getDocumentById(Number(req.params.id), companyId);
      return respondWithDocument(req, res, doc, { download: false });
    } catch (err) {
      console.error("[documents] GET /:id/view:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error abriendo documento" });
    }
  });

  router.get("/:id/download", async (req, res) => {
    try {
      let companyId = null;
      const vt = req.query.vt;
      if (vt) {
        const vtData = consumeViewToken(vt);
        if (!vtData || vtData.docId !== Number(req.params.id)) {
          return sendJson(res, 401, { ok: false, message: "Token de descarga inválido o expirado" });
        }
        companyId = vtData.companyId;
      } else {
        const auth = requireAuth(req, res);
        if (!auth) return;
        req.user = auth.user;
        companyId = resolveCompanyId(req);
      }
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }
      const doc = await getDocumentById(Number(req.params.id), companyId);
      return respondWithDocument(req, res, doc, { download: true });
    } catch (err) {
      console.error("[documents] GET /:id/download:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error descargando documento" });
    }
  });

  router.delete("/:id", authMiddleware, async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }
      const deleted = await softDeleteEmployeeDocument(Number(req.params.id), companyId, req.user?.id || null);
      if (!deleted) {
        return sendJson(res, 404, { ok: false, message: "Documento no encontrado" });
      }
      return sendJson(res, 200, { ok: true, message: "Documento eliminado correctamente" });
    } catch (err) {
      console.error("[documents] DELETE /:id:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error eliminando documento" });
    }
  });

  router.post(
    "/bulk-upload",
    authMiddleware,
    requireRole("administrador", "talento_humano"),
    bulkUploadMiddleware.array("files", 500),
    async (req, res) => {
      try {
        const companyId = resolveCompanyId(req);
        if (!companyId) {
          return sendJson(res, 400, { ok: false, message: "companyId requerido" });
        }

        const files = Array.isArray(req.files) ? req.files : [];
        if (!files.length) {
          return sendJson(res, 400, { ok: false, message: "Debes adjuntar al menos un PDF." });
        }

        const defaultTypeKey = req.body.document_type_key || req.body.documentTypeKey || "cedula_ciudadania";
        const report = { cargados: [], no_encontrados: [], errores: [], duplicados_reemplazados: [] };

        for (const file of files) {
          try {
            const originalName = String(file.originalname || "");
            const documentNumber = extractDocumentNumberFromFilename(originalName);
            if (!documentNumber) {
              report.errores.push({ file: originalName, error: "No se pudo detectar la cédula en el nombre del archivo" });
              continue;
            }

            const employee = await findEmployeeByDocumentNumber(documentNumber);
            if (!employee?.id) {
              report.no_encontrados.push({ file: originalName, document_number: documentNumber });
              continue;
            }

            const documentType = await ensureDocumentTypeContext(null, defaultTypeKey);
            const result = await persistStableDocumentUpload({
              req,
              employee: {
                id: employee.id,
                fullName: employee.full_name || employee.fullName || "",
                documentNumber: employee.document_number || employee.documentNumber || documentNumber,
                contractId: employee.contract_id || employee.contractId || null,
              },
              documentType,
              file,
              companyId,
            });

            if (result.previousDocument?.id) {
              report.duplicados_reemplazados.push({
                previous_document_id: result.previousDocument.id,
                new_document_id: result.document.id,
                employee_id: employee.id,
                document_number: documentNumber,
              });
            }

            report.cargados.push({
              id: result.document.id,
              employee_id: employee.id,
              document_type_key: result.document.docTypeCode || normalizeDocumentTypeCode(defaultTypeKey),
              file_name: result.document.storedFileName || result.document.fileName,
              storage_path: result.document.filePath || result.document.fileKey,
              status: result.document.status || "uploaded",
            });
          } catch (error) {
            report.errores.push({ file: file.originalname || "", error: error.message || "Error inesperado" });
          }
        }

        return sendJson(res, 200, {
          ok: true,
          report,
          summary: {
            cargados: report.cargados.length,
            no_encontrados: report.no_encontrados.length,
            errores: report.errores.length,
            duplicados_reemplazados: report.duplicados_reemplazados.length,
          },
        });
      } catch (err) {
        console.error("[documents] POST /bulk-upload:", err.message);
        return sendJson(res, 500, { ok: false, message: "Error procesando la carga masiva" });
      }
    }
  );

  router.get("/alerts", authMiddleware, async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }

      const daysAhead = Number(req.query.daysAhead) || 30;
      const alerts = await getDocumentAlerts(companyId, daysAhead);
      return sendJson(res, 200, { ok: true, data: alerts, total: alerts.length });
    } catch (err) {
      console.error("[documents] GET /alerts:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error obteniendo alertas" });
    }
  });

  router.post(
    "/bulk/preview",
    authMiddleware,
    requireRole("administrador"),
    attachRouteDiagnostics("document-center/preview"),
    documentCenterPreviewUpload.fields([
      { name: "files", maxCount: 5000 },
      { name: "files[]", maxCount: 5000 },
      { name: "documents", maxCount: 5000 },
      { name: "documents[]", maxCount: 5000 },
    ]),
    async (req, res) => {
      try {
        const files = collectPreviewFiles(req.files);
        const uploadMode = String(req.body?.upload_mode || req.body?.uploadMode || "CATEGORY").toUpperCase();
        const documentType = String(req.body?.document_type || req.body?.documentType || "").trim();
        const batchName = String(req.body?.batch_name || req.body?.batchName || "").trim();
        const payload = await previewBatch({
          files,
          uploadMode,
          documentType,
          batchName,
          user: req.user,
          ip: req.ip,
        });

        return sendJson(res, 200, {
          ok: true,
          data: {
            batch: payload.batch,
            summary: payload.summary,
            rows: payload.rows,
            catalog: payload.documentCatalog,
          },
        });
      } catch (err) {
        console.error("[documents] POST /bulk/preview:", err.message);
        return sendJson(res, err.statusCode || 400, { ok: false, message: err.message || "Error previsualizando documentos" });
      }
    },
    multerErrorHandler
  );

  router.post("/bulk/confirm", authMiddleware, requireRole("administrador"), async (req, res) => {
    try {
      const body = await readJsonBody(req);
      const batchId = Number(body.batch_id || body.batchId);
      if (!batchId) {
        return sendJson(res, 400, { ok: false, message: "batch_id requerido" });
      }

      const payload = await confirmBatch({
        batchId,
        duplicateStrategy: body.duplicate_strategy || body.duplicateStrategy || DUPLICATE_STRATEGY.SKIP,
        user: req.user,
        ip: req.ip,
      });

      return sendJson(res, 200, {
        ok: true,
        data: payload,
        message: "Carga confirmada correctamente",
      });
    } catch (err) {
      console.error("[documents] POST /bulk/confirm:", err.message);
      return sendJson(res, err.statusCode || 400, { ok: false, message: err.message || "Error confirmando carga" });
    }
  });

  router.post("/bulk/commit", authMiddleware, requireRole("administrador"), async (req, res) => {
    try {
      const body = await readJsonBody(req);
      const batchId = Number(body.batch_id || body.batchId);
      if (!batchId) {
        return sendJson(res, 400, { ok: false, message: "batch_id requerido" });
      }

      const payload = await confirmBatch({
        batchId,
        duplicateStrategy: body.duplicate_strategy || body.duplicateStrategy || DUPLICATE_STRATEGY.SKIP,
        user: req.user,
        ip: req.ip,
      });

      return sendJson(res, 200, {
        ok: true,
        data: payload,
        message: "Carga confirmada correctamente",
      });
    } catch (err) {
      console.error("[documents] POST /bulk/commit:", err.message);
      return sendJson(res, err.statusCode || 400, { ok: false, message: err.message || "Error confirmando carga" });
    }
  });

  router.get("/bulk/batches", authMiddleware, requireRole("administrador"), async (req, res) => {
    try {
      const limit = Number(req.query.limit || 50);
      const offset = Number(req.query.offset || 0);
      const batches = await getBatches({ limit, offset });
      return sendJson(res, 200, { ok: true, data: batches });
    } catch (err) {
      console.error("[documents] GET /bulk/batches:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error obteniendo el historial de cargas" });
    }
  });

  router.get("/bulk/batches/:id", authMiddleware, requireRole("administrador"), async (req, res) => {
    try {
      const detail = await getBatchDetail(Number(req.params.id));
      if (!detail) {
        return sendJson(res, 404, { ok: false, message: "Batch no encontrado" });
      }
      return sendJson(res, 200, { ok: true, data: detail });
    } catch (err) {
      console.error("[documents] GET /bulk/batches/:id:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error obteniendo el batch" });
    }
  });

  router.get("/bulk/batches/:id/export", authMiddleware, requireRole("administrador"), async (req, res) => {
    try {
      const detail = await getBatchDetail(Number(req.params.id));
      if (!detail) {
        return sendJson(res, 404, { ok: false, message: "Batch no encontrado" });
      }
      const buffer = buildBatchExportWorkbook(detail.batch, detail.items, detail.batch.summary_json?.results || []);
      const fileName = `document-center-batch-${detail.batch.id}.xlsx`;
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      });
      return res.end(buffer);
    } catch (err) {
      console.error("[documents] GET /bulk/batches/:id/export:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error exportando el batch" });
    }
  });

  router.get("/repository", authMiddleware, requireRole("administrador"), async (req, res) => {
    try {
      const rows = await getRepositoryDocuments({
        documentNumber: req.query.document_number || req.query.documentNumber || "",
        name: req.query.name || "",
        documentType: req.query.document_type || req.query.documentType || "",
        municipality: req.query.municipality || "",
        contract: req.query.contract || "",
        company: req.query.company || "",
        batchId: req.query.batch_id || req.query.batchId || "",
        limit: req.query.limit || 100,
        offset: req.query.offset || 0,
      });
      await logDocumentAudit({
        userId: req.user?.id || null,
        userName: req.user?.name || req.user?.email || "Sistema",
        action: "VIEW",
        ip: req.ip,
        payload: { scope: "repository", filters: req.query || {} },
      }).catch(() => null);
      return sendJson(res, 200, { ok: true, data: rows });
    } catch (err) {
      console.error("[documents] GET /repository:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error consultando el repositorio documental" });
    }
  });

  router.get("/repository/:employeeId", authMiddleware, requireRole("administrador"), async (req, res) => {
    try {
      const rows = await getEmployeeRepositoryDocuments(Number(req.params.employeeId));
      await logDocumentAudit({
        userId: req.user?.id || null,
        userName: req.user?.name || req.user?.email || "Sistema",
        action: "VIEW",
        ip: req.ip,
        employeeId: Number(req.params.employeeId),
        payload: { scope: "repository_employee" },
      }).catch(() => null);
      return sendJson(res, 200, { ok: true, data: rows });
    } catch (err) {
      console.error("[documents] GET /repository/:employeeId:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error consultando el repositorio del empleado" });
    }
  });

  router.get(["/bulk-audit", "/audit"], authMiddleware, async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }

      const physicalFiles = listLocalDocumentFiles();
      const existingKeys = await getExistingDocumentFileKeys(companyId);
      const db = await getDocumentDiagnostics(companyId);
      const invalidRelations = await getInvalidDocumentRelations(companyId);
      const companyDocuments = await getDocumentsByCompany(companyId);
      const missingMasterDocumentType = await getDocumentsMissingMasterDocumentType(companyId);
      const missingDbRows = physicalFiles.filter((file) => !existingKeys.has(file.fileKey));
      const dbWithoutPhysical = [];
      for (const doc of companyDocuments) {
        if (await storedDocumentFileExists(doc.fileKey)) continue;
        dbWithoutPhysical.push({
          id: doc.id,
          employeeId: doc.employeeId,
          employeeName: doc.employeeName || "",
          documentTypeId: doc.docTypeId || null,
          documentTypeName: doc.docTypeName || doc.docTypeCode || "",
          fileKey: doc.fileKey || "",
          fileName: doc.storedFileName || doc.fileName || "",
          status: doc.status || "",
        });
      }
      const physicalDuplicates = physicalFiles.reduce((acc, file) => {
        const key = file.fileName.toUpperCase();
        acc.set(key, (acc.get(key) || 0) + 1);
        return acc;
      }, new Map());

      return sendJson(res, 200, {
        ok: true,
        data: {
          storage: isR2Configured() ? "r2" : "local",
          physical: {
            total: physicalFiles.length,
            storedFiles: physicalFiles,
            duplicates: [...physicalDuplicates.entries()]
              .filter(([, count]) => count > 1)
              .map(([fileName, count]) => ({ fileName, count })),
            missingDbRows,
          },
          database: db,
          relations: invalidRelations,
          anomalies: {
            dbWithoutPhysical,
            missingMasterDocumentType: missingMasterDocumentType.map((row) => ({
              id: row.id,
              employeeId: row.employee_id,
              employeeName: row.employee_name,
              documentTypeId: row.document_type_id,
              documentTypeName: row.document_type_name,
              masterDocumentTypeId: row.master_document_type_id,
              fileKey: row.file_url,
              fileName: row.file_name,
              uploadedAt: row.uploaded_at,
              error: "MASTER_DOCUMENT_TYPE_NULL",
            })),
          },
          summary: {
            totalPhysicalFiles: physicalFiles.length,
            totalDocumentRecords: Number(db.total_records || 0),
            totalLinkedToEmployees: Number(db.linked_to_employees || 0),
            totalOrphans: Number(db.orphan_records || 0),
            totalWithoutDocumentType: Number(db.without_document_type || 0),
            totalInvalidDocumentType: Number(db.invalid_document_type || 0),
            totalPhysicalWithoutDbRecord: missingDbRows.length,
            totalDbWithoutPhysical: dbWithoutPhysical.length,
            totalWithoutMasterDocumentType: missingMasterDocumentType.length,
          },
        },
      });
    } catch (err) {
      console.error("[documents] GET /audit:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error generando auditoria documental" });
    }
  });

  router.post(["/bulk-repair/preview", "/repair/preview"], authMiddleware, async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }

      const body = await readJsonBody(req);
      const physicalFiles = Array.isArray(body.files) && body.files.length
        ? body.files.map((file) => ({
            fileKey: file.fileKey || `documents/${file.fileName || file.name || file}`,
            fileName: file.fileName || file.name || file,
          }))
        : listLocalDocumentFiles();
      const existingKeys = await getExistingDocumentFileKeys(companyId);
      const missing = physicalFiles.filter((file) => !existingKeys.has(file.fileKey));
      const missingMasterDocumentType = await getDocumentsMissingMasterDocumentType(companyId);
      const [employees, documentTypes, existingIndex] = await Promise.all([
        getEmployeesForDocumentMatching(companyId),
        getDocumentTypes(),
        getLatestDocumentsIndex(companyId),
      ]);
      const rows = markFileNameDuplicates(missing.map((file, index) => ({
        ...buildBulkReviewRow({
          sourceKey: file.fileKey || `repair:${index}`,
          sourceType: "repair",
          originalName: file.fileName,
          archiveName: "",
          archiveEntryName: "",
          extension: path.extname(file.fileName || "").toLowerCase(),
          size: 0,
        }, employees, documentTypes, existingIndex),
        fileKey: file.fileKey,
        repairAction: "LINK_PHYSICAL_FILE",
      }))).concat(
        missingMasterDocumentType.map((row) => ({
          sourceKey: `repair-master:${row.id}`,
          sourceType: "repair",
          fileName: row.file_name,
          fileKey: row.file_url,
          employeeId: row.employee_id,
          employeeName: row.employee_name,
          documentTypeId: row.document_type_id,
          documentTypeName: row.document_type_name,
          status: "MASTER_DOCUMENT_TYPE_NULL",
          confidence: 100,
          canAutoAssign: true,
          error: "El documento existe pero no tiene master_document_type_id.",
          repairAction: "BACKFILL_MASTER_DOCUMENT_TYPE",
          documentId: row.id,
        }))
      );

      return sendJson(res, 200, {
        ok: true,
        data: {
          rows,
          summary: summarizeLegacyBulkRows(rows),
          documentTypes,
        },
      });
    } catch (err) {
      console.error("[documents] POST /bulk-repair/preview:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error previsualizando reparacion documental" });
    }
  });

  router.post(["/bulk-repair/apply", "/repair/apply"], requireRole("administrador", "talento_humano"), async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }

      const body = await readJsonBody(req);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const details = [];
      const masterBackfillIds = [];

      for (const row of rows) {
        if (row.repairAction === "BACKFILL_MASTER_DOCUMENT_TYPE" && row.documentId) {
          details.push({
            fileName: row.fileName || row.file_name || "",
            fileKey: row.fileKey || row.file_url || "",
            employeeId: row.employeeId || row.employee_id || null,
            documentTypeId: row.documentTypeId || row.document_type_id || null,
            linked: false,
            repaired: false,
            repairAction: "BACKFILL_MASTER_DOCUMENT_TYPE",
            documentId: Number(row.documentId),
            error: "",
          });
          masterBackfillIds.push(Number(row.documentId));
          continue;
        }

        const detail = {
          fileName: row.fileName || "",
          fileKey: row.fileKey || "",
          employeeId: row.employeeId || null,
          documentTypeId: row.documentTypeId || row.documentType_id || null,
          linked: false,
          repaired: false,
          repairAction: row.repairAction || "LINK_PHYSICAL_FILE",
          documentId: null,
          error: "",
        };
        try {
          if (!detail.fileKey) throw new Error("fileKey requerido");
          if (!detail.employeeId) throw new Error("employeeId requerido");
          if (!detail.documentTypeId) throw new Error("documentTypeId requerido");
          if (await documentExistsByFileKey(detail.fileKey, companyId)) {
            detail.error = "El archivo ya tiene registro en documentos";
          } else {
            const doc = await createDocument({
              employeeId: detail.employeeId,
              docTypeId: Number(detail.documentTypeId),
              docTypeCode: row.documentTypeCode || row.documentTypeName || "",
              companyId,
              fileKey: detail.fileKey,
              fileName: detail.fileName || path.basename(detail.fileKey),
              originalFileName: detail.fileName || path.basename(detail.fileKey),
              storedFileName: detail.fileName || path.basename(detail.fileKey),
              fileSize: row.fileSize || 0,
              mimeType: row.mimeType || "application/octet-stream",
              uploadedBy: req.user?.id || null,
              uploadedAt: new Date(),
              expiryDate: null,
              version: 1,
              masterDocumentTypeId: null,
              status: "cargado",
            });
            detail.linked = Boolean(doc?.id);
            detail.documentId = doc?.id || null;
          }
        } catch (err) {
          detail.error = err.message;
        }
        details.push(detail);
      }

      if (masterBackfillIds.length) {
        const repairedRows = await backfillMasterDocumentTypes(companyId, masterBackfillIds);
        const repairedIds = new Set(repairedRows.map((row) => Number(row.id)));
        details.forEach((detail) => {
          if (detail.repairAction !== "BACKFILL_MASTER_DOCUMENT_TYPE") return;
          detail.repaired = repairedIds.has(Number(detail.documentId));
          if (!detail.repaired && !detail.error) {
            detail.error = "No fue posible asignar master_document_type_id.";
          }
        });
      }

      const summary = {
        processed: details.length,
        linked: details.filter((row) => row.linked).length,
        repaired: details.filter((row) => row.repaired).length,
        errors: details.filter((row) => !row.linked && !row.repaired).length,
      };
      return sendJson(res, 200, { ok: true, data: { rows: details, summary } });
    } catch (err) {
      console.error("[documents] POST /bulk-repair/apply:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error aplicando reparacion documental" });
    }
  });

  router.get("/:id/url", authMiddleware, async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }

      const doc = await getDocumentById(Number(req.params.id), companyId);
      if (!doc) {
        return sendJson(res, 404, { ok: false, message: "Documento no encontrado" });
      }

      let url;
      if (!isR2Configured()) {
        url = `/uploads/documents/${path.basename(doc.fileKey || doc.fileName || "")}`;
      } else {
        const expiresIn = Number(req.query.expiresIn) || 3600;
        url = await getPrivateUrl(doc.fileKey, expiresIn);
      }

      return sendJson(res, 200, {
        ok: true,
        data: {
          id: doc.id,
          fileName: doc.fileName,
          url,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      });
    } catch (err) {
      console.error("[documents] GET /:id/url:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error generando URL" });
    }
  });

  router.patch("/:id/status", requireRole("administrador", "talento_humano"), async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }

      const { status, reviewNotes } = req.body;
      if (!status) {
        return sendJson(res, 400, { ok: false, message: "status requerido" });
      }

      const updated = await updateDocumentStatus(Number(req.params.id), companyId, {
        status,
        reviewedBy: req.user.id || null,
        reviewNotes: reviewNotes || null,
      });

      if (!updated) {
        return sendJson(res, 404, { ok: false, message: "Documento no encontrado" });
      }

      const { fileKey, ...safeDoc } = updated;
      return sendJson(res, 200, {
        ok: true,
        data: safeDoc,
        message: `Documento ${status} correctamente`,
      });
    } catch (err) {
      console.error("[documents] PATCH /:id/status:", err.message);
      return sendJson(res, 400, { ok: false, message: err.message });
    }
  });

  router.get("/", authMiddleware, async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      const employeeId = req.query.employeeId;
      const employeeIds = String(req.query.employeeIds || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      const data = await getMergedDocumentsForQuery({
        companyId,
        employeeId,
        employeeIds,
      });
      return sendJson(res, 200, { ok: true, data });
    } catch (err) {
      console.error("[documents] GET /:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error obteniendo documentos" });
    }
  });

  router.post("/", authMiddleware, async (req, res) => {
    try {
      const body = await readJsonBody(req);
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, buildUploadFailurePayload({
          message: "No se pudo guardar el documento",
          errorDetail: "companyId requerido",
          stepFailed: "company_validation",
        }));
      }

      const employee = await ensureEmployeeContext(body.employeeId, companyId);
      const documentType = await ensureDocumentTypeContext(body.docTypeId || body.documentTypeId, body.documentType);
      const base64File = parseBase64FilePayload(body.fileBase64, body.fileName || "documento.pdf");
      const persisted = await persistEmployeeDocument({
        companyId,
        employee,
        documentType,
        uploadedBy: req.user?.id || null,
        expiryDate: body.expirationDate || null,
        requireDossierVisibility: true,
        source: {
          sourceKey: `BASE64:${Date.now()}:${base64File.originalName}`,
          sourceType: "BASE64",
          originalName: base64File.originalName,
          extension: base64File.extension,
          mimeType: base64File.mimeType,
          size: base64File.size,
          buffer: base64File.buffer,
        },
      });

      const signedUrl = await buildFileUrlFromDocument(persisted.document);
      const payload = buildUploadSuccessPayload(
        persisted.document,
        persisted.verification,
        "El documento fue cargado correctamente y ya está visible en el expediente."
      );
      payload.data.document.url = signedUrl;
      payload.document.url = signedUrl;
      return sendJson(res, 201, payload);
    } catch (err) {
      return sendJson(res, err.httpStatus || 400, buildUploadFailurePayload(err));
    }
  });

  router.put("/validate", authMiddleware, async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      const body = await readJsonBody(req);
      if (!body.id) return sendJson(res, 400, { ok: false, message: "id es requerido" });

      const pgDoc = companyId ? await getDocumentById(Number(body.id), companyId) : null;
      if (pgDoc) {
        const document = await updateDocumentStatus(Number(body.id), companyId, {
          status: "aprobado",
          reviewedBy: req.user?.id || null,
          reviewNotes: null,
        });
        return sendJson(res, 200, {
          ok: true,
          data: await toLegacyDocumentShape(document),
          message: "Documento validado correctamente",
        });
      }

      const legacyDocument = legacyDocs.validateDocument(body.id, body.userName || "Usuario");
      if (!legacyDocument) return sendJson(res, 404, { ok: false, message: "Documento no encontrado" });
      return sendJson(res, 200, {
        ok: true,
        data: legacyDocument,
        message: "Documento validado correctamente",
      });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: err.message });
    }
  });

  router.put("/reject", authMiddleware, async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      const body = await readJsonBody(req);
      if (!body.id) return sendJson(res, 400, { ok: false, message: "id es requerido" });

      const pgDoc = companyId ? await getDocumentById(Number(body.id), companyId) : null;
      if (pgDoc) {
        const document = await updateDocumentStatus(Number(body.id), companyId, {
          status: "rechazado",
          reviewedBy: req.user?.id || null,
          reviewNotes: body.reason || "",
        });
        return sendJson(res, 200, {
          ok: true,
          data: await toLegacyDocumentShape(document),
          message: "Documento rechazado correctamente",
        });
      }

      const legacyDocument = legacyDocs.rejectDocument(body.id, body.reason || "", body.userName || "Usuario");
      if (!legacyDocument) return sendJson(res, 404, { ok: false, message: "Documento no encontrado" });
      return sendJson(res, 200, {
        ok: true,
        data: legacyDocument,
        message: "Documento rechazado correctamente",
      });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: err.message });
    }
  });

  router.use(multerErrorHandler);
  return router;
}

module.exports = { createDocumentsRouter };
