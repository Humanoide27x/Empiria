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
const { sendJson } = require("../../http/response");
const { readJsonBody } = require("../../http/request");
const { upload, normalizeUploadedFile } = require("../../middleware/upload");
const { getPrivateUrl, deleteFile, isR2Configured } = require("../../config/storage");
const {
  getDocumentsByEmployee,
  getDocumentsByEmployees,
  getDocumentById,
  createDocument,
  updateDocumentStatus,
  appendDocumentObservation,
  getLatestDocumentsIndex,
  deleteDocument,
  getDocumentAlerts,
  getDocumentTypes,
  getEmployeesForDocumentMatching,
  documentExistsByFileKey,
  getDocumentDiagnostics,
  getInvalidDocumentRelations,
  getExistingDocumentFileKeys,
} = require("../../db/documents.repository");
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
    fileSize: BULK_ZIP_LIMIT,
    files: BULK_TOTAL_FILES_LIMIT + 1,
  },
});

function mapPgStatusToLegacy(status, validated) {
  if (validated || status === "aprobado") return "VALIDADO";
  if (status === "rechazado") return "RECHAZADO";
  if (status === "vencido") return "VENCIDO";
  return "PENDIENTE_VALIDACION";
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

function createDocumentsRouter() {
  const router = Router();
  const uploadMiddleware = upload("documents");

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
    bulkUpload.fields([
      { name: "documents", maxCount: BULK_TOTAL_FILES_LIMIT },
      { name: "zipFile", maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        const companyId = resolveCompanyId(req);
        if (!companyId) {
          return sendJson(res, 400, { ok: false, message: "companyId requerido" });
        }

        const [employees, documentTypes, existingIndex] = await Promise.all([
          getEmployeesForDocumentMatching(companyId),
          getDocumentTypes(),
          getLatestDocumentsIndex(companyId),
        ]);

        const sources = await extractRequestSources({
          documentFiles: req.files?.documents || [],
          zipFiles: req.files?.zipFile || [],
        });

        if (!sources.length) {
          return sendJson(res, 400, { ok: false, message: "Debes adjuntar archivos o un ZIP" });
        }

        const rows = sources.map((source) =>
          buildBulkReviewRow(source, employees, documentTypes, existingIndex)
        );
        const summary = normalizePreviewCounts(summarizePreviewRows(rows));

        return sendJson(res, 200, {
          ok: true,
          data: {
            rows,
            summary,
            documentTypes,
            limits: {
              maxFileSizeMb: Math.floor(BULK_PER_FILE_LIMIT / (1024 * 1024)),
              maxZipSizeMb: Math.floor(BULK_ZIP_LIMIT / (1024 * 1024)),
              maxTotalFiles: BULK_TOTAL_FILES_LIMIT,
              maxTotalSizeMb: Math.floor(BULK_TOTAL_LIMIT / (1024 * 1024)),
            },
          },
        });
      } catch (err) {
        console.error("[documents] POST /bulk/preview:", err.message);
        return sendJson(res, 400, { ok: false, message: err.message || "Error prevalidando documentos" });
      } finally {
        await cleanupUploadedFiles(req.files);
      }
    },
    multerErrorHandler
  );

  router.post(
    "/bulk/commit",
    authMiddleware,
    bulkUpload.fields([
      { name: "documents", maxCount: BULK_TOTAL_FILES_LIMIT },
      { name: "zipFile", maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        const companyId = resolveCompanyId(req);
        if (!companyId) {
          return sendJson(res, 400, { ok: false, message: "companyId requerido" });
        }

        const rows = JSON.parse(String(req.body?.rows || "[]"));
        if (!Array.isArray(rows) || !rows.length) {
          return sendJson(res, 400, { ok: false, message: "No se recibieron filas para confirmar" });
        }

        const [employees, documentTypes, existingIndex] = await Promise.all([
          getEmployeesForDocumentMatching(companyId),
          getDocumentTypes(),
          getLatestDocumentsIndex(companyId),
        ]);

        const employeeMap = new Map(employees.map((item) => [String(item.id), item]));
        const documentTypeMap = new Map(documentTypes.map((item) => [String(item.id), item]));
        const sources = await extractRequestSources({
          documentFiles: req.files?.documents || [],
          zipFiles: req.files?.zipFile || [],
        });
        const sourceMap = new Map(sources.map((source) => [source.sourceKey, source]));
        const today = new Date().toISOString().slice(0, 10);

        const summary = {
          totalReceived: rows.length,
          associatedCorrectly: 0,
          pendingReview: 0,
          notFound: 0,
          errors: 0,
          omitted: 0,
        };
        const reportRows = [];

        for (const rawRow of rows) {
          const source = sourceMap.get(rawRow.sourceKey);
          const employeeId = rawRow.employeeId ? Number(rawRow.employeeId) : null;
          const documentTypeId = rawRow.documentTypeId ? Number(rawRow.documentTypeId) : null;
          const employee = employeeId ? employeeMap.get(String(employeeId)) : null;
          const documentType = documentTypeId ? documentTypeMap.get(String(documentTypeId)) : null;
          const duplicateStrategy = Object.values(DUPLICATE_STRATEGY).includes(rawRow.duplicateStrategy)
            ? rawRow.duplicateStrategy
            : DUPLICATE_STRATEGY.KEEP_BOTH;
          const reportRow = {
            fileName: rawRow.fileName || source?.originalName || "",
            documentTypeName: documentType?.name || rawRow.documentTypeName || "",
            employeeName: employee?.fullName || "",
            employeeDocumentNumber: employee?.documentNumber || "",
            status: rawRow.status || PREVIEW_STATUS.REQUIRES_REVIEW,
            result: "",
            duplicateStrategy,
            message: "",
          };

          if (rawRow.omit === true || rawRow.action === "omit") {
            summary.omitted += 1;
            reportRow.status = PREVIEW_STATUS.OMITTED;
            reportRow.result = "OMITIDO";
            reportRow.message = "Archivo omitido manualmente";
            reportRows.push(reportRow);
            await logBulkAudit({ req, action: "BULK_DOCUMENT_OMITTED", context: reportRow });
            continue;
          }

          if (!source || source.errorMessage) {
            summary.errors += 1;
            reportRow.status = PREVIEW_STATUS.ERROR;
            reportRow.result = "ERROR";
            reportRow.message = source?.errorMessage || "No se encontro el archivo confirmado";
            reportRows.push(reportRow);
            await logBulkAudit({ req, action: "BULK_DOCUMENT_ERROR", context: reportRow });
            continue;
          }

          if (!employeeId || !employee) {
            if (rawRow.status === PREVIEW_STATUS.NOT_FOUND) summary.notFound += 1;
            else summary.pendingReview += 1;
            reportRow.result = "PENDIENTE";
            reportRow.message = "Trabajador sin resolver";
            reportRows.push(reportRow);
            await logBulkAudit({ req, action: "BULK_DOCUMENT_PENDING", context: reportRow });
            continue;
          }

          if (!documentTypeId || !documentType) {
            summary.pendingReview += 1;
            reportRow.status = PREVIEW_STATUS.TYPE_UNRECOGNIZED;
            reportRow.result = "PENDIENTE";
            reportRow.message = "Tipo documental sin resolver";
            reportRows.push(reportRow);
            await logBulkAudit({ req, action: "BULK_DOCUMENT_PENDING", context: reportRow });
            continue;
          }

          try {
            const existing = existingIndex.get(`${employeeId}:${documentTypeId}`) || null;
            const version = existing ? Number(existing.version || 1) + 1 : 1;
            const stored = await storeFinalDocument({
              source,
              companyId,
              employeeDocumentNumber: employee.documentNumber,
              documentTypeCode: documentType.code || documentType.name,
              dateString: today,
              version,
            });

            const created = await createDocument({
              employeeId,
              docTypeId: documentTypeId,
              companyId,
              fileKey: stored.fileKey,
              fileName: stored.fileName,
              originalFileName: source.originalName,
              uploadedBy: req.user?.id || null,
              expiryDate: null,
              version,
              status: "cargado",
            });

            existingIndex.set(`${employeeId}:${documentTypeId}`, created);

            if (existing && duplicateStrategy !== DUPLICATE_STRATEGY.KEEP_BOTH) {
              const note = duplicateStrategy === DUPLICATE_STRATEGY.REPLACE
                ? `Reemplazado por carga masiva el ${today}. Nuevo documento #${created.id}.`
                : `Nueva version generada por carga masiva el ${today}. Nuevo documento #${created.id}.`;
              await appendDocumentObservation(existing.id, companyId, note).catch(() => null);
            }

            summary.associatedCorrectly += 1;
            reportRow.status = PREVIEW_STATUS.READY;
            reportRow.result = "CARGADO";
            reportRow.message = existing
              ? `Documento guardado como version ${version}`
              : "Documento guardado correctamente";
            reportRows.push(reportRow);
            await logBulkAudit({
              req,
              action: "BULK_DOCUMENT_UPLOADED",
              entityId: created.id,
              context: {
                ...reportRow,
                employeeId,
                documentTypeId,
                originalFileName: source.originalName,
                storedFileName: stored.fileName,
              },
            });
          } catch (err) {
            summary.errors += 1;
            reportRow.status = PREVIEW_STATUS.ERROR;
            reportRow.result = "ERROR";
            reportRow.message = err.message || "No fue posible guardar el documento";
            reportRows.push(reportRow);
            await logBulkAudit({ req, action: "BULK_DOCUMENT_ERROR", context: reportRow });
          }
        }

        return sendJson(res, 200, {
          ok: true,
          data: {
            summary,
            rows: reportRows,
            reportCsvBase64: buildCommitCsv(reportRows),
          },
          message: "Carga masiva procesada",
        });
      } catch (err) {
        console.error("[documents] POST /bulk/commit:", err.message);
        return sendJson(res, 400, { ok: false, message: err.message || "Error guardando carga masiva" });
      } finally {
        await cleanupUploadedFiles(req.files);
      }
    },
    multerErrorHandler
  );

  router.get("/bulk-audit", authMiddleware, async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }

      const physicalFiles = listLocalDocumentFiles();
      const existingKeys = await getExistingDocumentFileKeys(companyId);
      const db = await getDocumentDiagnostics(companyId);
      const invalidRelations = await getInvalidDocumentRelations(companyId);
      const missingDbRows = physicalFiles.filter((file) => !existingKeys.has(file.fileKey));
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
          summary: {
            totalPhysicalFiles: physicalFiles.length,
            totalDocumentRecords: Number(db.total_records || 0),
            totalLinkedToEmployees: Number(db.linked_to_employees || 0),
            totalOrphans: Number(db.orphan_records || 0),
            totalWithoutDocumentType: Number(db.without_document_type || 0),
            totalInvalidDocumentType: Number(db.invalid_document_type || 0),
            totalPhysicalWithoutDbRecord: missingDbRows.length,
          },
        },
      });
    } catch (err) {
      console.error("[documents] GET /bulk-audit:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error generando auditoria documental" });
    }
  });

  router.post("/bulk-repair/preview", authMiddleware, async (req, res) => {
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
      })));

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

  router.post("/bulk-repair/apply", requireRole("administrador", "talento_humano"), async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }

      const body = await readJsonBody(req);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const details = [];

      for (const row of rows) {
        const detail = {
          fileName: row.fileName || "",
          fileKey: row.fileKey || "",
          employeeId: row.employeeId || null,
          documentTypeId: row.documentTypeId || row.documentType_id || null,
          linked: false,
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
              companyId,
              fileKey: detail.fileKey,
              fileName: detail.fileName || path.basename(detail.fileKey),
              originalFileName: detail.fileName || path.basename(detail.fileKey),
              uploadedBy: req.user?.id || null,
              expiryDate: null,
              version: 1,
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

      const summary = {
        processed: details.length,
        linked: details.filter((row) => row.linked).length,
        errors: details.filter((row) => !row.linked).length,
      };
      return sendJson(res, 200, { ok: true, data: { rows: details, summary } });
    } catch (err) {
      console.error("[documents] POST /bulk-repair/apply:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error aplicando reparacion documental" });
    }
  });

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

        if (!req.file) {
          return sendJson(res, 400, { ok: false, message: "Debes adjuntar un archivo" });
        }

        const { employeeId, docTypeId, expiryDate } = req.body;
        if (!employeeId) {
          return sendJson(res, 400, { ok: false, message: "employeeId requerido" });
        }

        const normalized = normalizeUploadedFile(req.file);
        const doc = await createDocument({
          employeeId,
          docTypeId: docTypeId ? Number(docTypeId) : null,
          companyId,
          fileKey: normalized.key,
          fileName: normalized.fileName,
          originalFileName: normalized.fileName,
          uploadedBy: req.user.id || null,
          expiryDate: expiryDate || null,
          version: 1,
          status: "cargado",
        });

        const signedUrl = normalized.isLocal
          ? `/uploads/documents/${normalized.key.split("/").pop()}`
          : await getPrivateUrl(normalized.key, 3600);

        return sendJson(res, 201, {
          ok: true,
          data: { ...doc, fileKey: undefined, signedUrl },
          message: "Documento subido correctamente",
        });
      } catch (err) {
        console.error("[documents] POST /upload:", err.message);
        return sendJson(res, 500, { ok: false, message: err.message });
      }
    },
    multerErrorHandler
  );

  router.get("/employee/:employeeId", authMiddleware, async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }

      const docs = await getDocumentsByEmployee(req.params.employeeId, companyId);
      const safeData = docs.map(({ fileKey, ...rest }) => rest);
      return sendJson(res, 200, { ok: true, data: safeData });
    } catch (err) {
      console.error("[documents] GET /employee/:id:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error obteniendo documentos" });
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

  router.delete("/:id", requireRole("administrador", "talento_humano"), async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }

      const doc = await deleteDocument(Number(req.params.id), companyId);
      if (!doc) {
        return sendJson(res, 404, { ok: false, message: "Documento no encontrado" });
      }

      if (doc.fileKey && isR2Configured()) {
        await deleteFile(doc.fileKey).catch((e) =>
          console.warn("[documents] R2 delete error:", e.message)
        );
      }

      return sendJson(res, 200, {
        ok: true,
        message: "Documento eliminado correctamente",
      });
    } catch (err) {
      console.error("[documents] DELETE /:id:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error eliminando documento" });
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

      if (!body.employeeId) {
        return sendJson(res, 400, { ok: false, message: "employeeId es requerido" });
      }
      if (!body.documentType) {
        return sendJson(res, 400, { ok: false, message: "documentType es requerido" });
      }
      if (!body.fileBase64 || !body.fileBase64.startsWith("data:application/pdf")) {
        return sendJson(res, 400, { ok: false, message: "Debes subir un archivo PDF valido" });
      }

      const document = legacyDocs.saveDocument(body);
      return sendJson(res, 201, {
        ok: true,
        data: document,
        message: "Documento guardado correctamente",
      });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: err.message });
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
