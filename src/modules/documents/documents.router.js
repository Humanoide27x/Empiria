/**
 * Express Router para gestión documental con Cloudflare R2.
 *
 * Montado en /documents desde app.js, toma precedencia sobre el handler legacy.
 * Los endpoints heredados (JSON base64) siguen respondiendo mientras el frontend
 * no migre completamente.
 */

const { Router } = require("express");
const fs = require("fs");
const path = require("path");
const { requireAuth } = require("../auth/auth.helpers");
const { sendJson } = require("../../http/response");
const { readJsonBody } = require("../../http/request");
const { upload, normalizeUploadedFile } = require("../../middleware/upload");
const { getPrivateUrl, deleteFile, isR2Configured } = require("../../config/storage");
const {
  getDocumentsByEmployee,
  getDocumentById,
  createDocument,
  updateDocumentStatus,
  deleteDocument,
  getDocumentAlerts,
  getDocumentTypes,
  getEmployeesForDocumentMatching,
  documentExistsByFileKey,
  getDocumentDiagnostics,
  getInvalidDocumentRelations,
  getExistingDocumentFileKeys,
} = require("../../db/documents.repository");
const { buildBulkReviewRow } = require("./bulk-match.service");

// Backward compat: JSON-based document data source
const legacyDocs = require("../../data/documents");

// ─── Auth middleware Express-compatible ───────────────────────────────────────

function authMiddleware(req, res, next) {
  const auth = requireAuth(req, res);
  if (!auth) return; // requireAuth ya envió 401
  req.user = auth.user;
  next();
}

function requireRole(...roles) {
  return function (req, res, next) {
    const auth = requireAuth(req, res);
    if (!auth) return;
    req.user = auth.user;
    if (roles.length && !roles.includes(req.user.role)) {
      return sendJson(res, 403, { ok: false, message: "No tienes permiso para esta acción" });
    }
    next();
  };
}

// ─── Helper: obtener companyId del contexto ───────────────────────────────────

function resolveCompanyId(req) {
  return (
    req.user?.companyId ||
    Number(req.query.companyId || req.body?.companyId) ||
    null
  );
}

const BULK_ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".docx"]);

function getBulkFileExt(fileName) {
  return path.extname(String(fileName || "")).toLowerCase();
}

function summarizeBulkRows(rows) {
  return rows.reduce((acc, row) => {
    acc.processed += 1;
    if (row.status === "MATCHED") acc.matched += 1;
    if (row.status === "NO_MATCH") acc.unmatched += 1;
    if (row.status === "DUPLICATE" || row.isDuplicateFileName) acc.duplicates += 1;
    if (row.status === "ERROR" || row.status === "INVALID_EXTENSION" || row.status === "NEEDS_REVIEW") acc.errors += 1;
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

async function buildDocumentFileUrl(doc) {
  if (!doc?.fileKey) return "";

  if (!isR2Configured()) {
    return `/uploads/documents/${doc.fileKey.split("/").pop()}`;
  }

  return getPrivateUrl(doc.fileKey, 3600);
}

async function mapDbDocumentForLegacyClient(doc) {
  const fileUrl = await buildDocumentFileUrl(doc);
  const status = doc.status === "aprobado"
    ? "VALIDADO"
    : doc.status === "rechazado"
      ? "RECHAZADO"
      : "PENDIENTE_VALIDACION";

  return {
    id: doc.id,
    employeeId: doc.employeeId,
    documentType: doc.docTypeName || "",
    documentTypeId: doc.docTypeId || null,
    issueDate: "",
    expirationDate: doc.expiryDate || "",
    fileName: doc.fileName || "",
    fileUrl,
    validationStatus: status,
    status: doc.status || "pendiente",
    uploadedBy: doc.uploadedByName || "Sistema",
    validatedBy: doc.validatedBy || "",
    validatedAt: doc.validatedAt || "",
    rejectionReason: doc.observations || "",
    createdAt: doc.createdAt || doc.uploadedAt || "",
    uploadedAt: doc.uploadedAt || "",
    source: "postgres",
  };
}

async function getDocumentsForEmployeeResponse(employeeId, companyId) {
  const legacyData = legacyDocs.getDocumentsByEmployee(employeeId);
  if (!companyId) return legacyData;

  const dbDocs = await getDocumentsByEmployee(employeeId, companyId);
  const mappedDbDocs = await Promise.all(dbDocs.map(mapDbDocumentForLegacyClient));
  return [...mappedDbDocs, ...legacyData];
}

// ─── Error handler de multer ──────────────────────────────────────────────────

function multerErrorHandler(err, req, res, next) {
  if (err.code === "LIMIT_FILE_SIZE") {
    return sendJson(res, 400, { ok: false, message: "El archivo excede el límite de 10 MB" });
  }
  if (err.status === 400 || err.code === "LIMIT_UNEXPECTED_FILE") {
    return sendJson(res, 400, { ok: false, message: err.message });
  }
  next(err);
}

// ─── Router ───────────────────────────────────────────────────────────────────

function createDocumentsRouter() {
  const router = Router();

  // ── GET /documents/alerts ─────────────────────────────────────────────────
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

  // ── POST /documents/upload — subir archivo a R2 ───────────────────────────
  const uploadMiddleware = upload("documents");

  router.post("/bulk-preview", authMiddleware, async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }

      const body = await readJsonBody(req);
      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length) {
        return sendJson(res, 400, { ok: false, message: "Debes enviar archivos para validar" });
      }

      const [employees, documentTypes] = await Promise.all([
        getEmployeesForDocumentMatching(companyId),
        getDocumentTypes(),
      ]);

      const rows = markFileNameDuplicates(files.map((file) => {
        const fileObj = typeof file === "string" ? { originalname: file } : file;
        const fileName = fileObj.originalname || fileObj.fileName || fileObj.name || "";
        const ext = getBulkFileExt(fileName);
        if (!BULK_ALLOWED_EXT.has(ext)) {
          return {
            fileName,
            documentTypeCode: "",
            documentTypeId: null,
            documentTypeName: "",
            extractedName: "",
            normalizedName: "",
            documentNumber: "",
            format: "INVALID_EXTENSION",
            employeeId: null,
            detectedEmployee: null,
            candidates: [],
            status: "INVALID_EXTENSION",
            confidence: 0,
            canAutoAssign: false,
            error: `Extension no permitida: ${ext || "(sin extension)"}`,
          };
        }
        return buildBulkReviewRow(fileObj, employees, documentTypes);
      }));

      const summary = summarizeBulkRows(rows);

      return sendJson(res, 200, { ok: true, data: { rows, summary } });
    } catch (err) {
      console.error("[documents] POST /bulk-preview:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error prevalidando documentos" });
    }
  });

  router.post(
    "/bulk-upload",
    authMiddleware,
    uploadMiddleware.array("files", 500),
    async (req, res) => {
      try {
        const companyId = resolveCompanyId(req);
        if (!companyId) {
          return sendJson(res, 400, { ok: false, message: "companyId requerido" });
        }

        const files = Array.isArray(req.files) ? req.files : [];
        if (!files.length) {
          return sendJson(res, 400, { ok: false, message: "Debes adjuntar archivos" });
        }

        const assignments = (() => {
          try { return JSON.parse(req.body.assignments || "{}"); } catch { return {}; }
        })();

        const [employees, documentTypes] = await Promise.all([
          getEmployeesForDocumentMatching(companyId),
          getDocumentTypes(),
        ]);

        const rows = markFileNameDuplicates(files.map((file) =>
          buildBulkReviewRow(file, employees, documentTypes)
        ));
        const details = [];

        for (const [index, row] of rows.entries()) {
          const file = files[index];
          const normalized = normalizeUploadedFile(file);
          const assignment = assignments[row.fileName] || assignments[String(index)] || {};
          const employeeId = assignment.employeeId || row.employeeId || null;
          const docTypeId = assignment.documentTypeId || row.documentTypeId || null;
          const detail = {
            ...row,
            stored: Boolean(normalized?.key),
            fileKey: normalized?.key || "",
            employeeId,
            documentTypeId: docTypeId,
            linked: false,
            documentId: null,
            error: "",
          };

          try {
            if (row.isDuplicateFileName) {
              detail.error = "Nombre de archivo duplicado en la carga";
            } else if (!employeeId) {
              detail.error = "Sin coincidencia de empleado";
            } else if (!docTypeId) {
              detail.error = "Tipo de documento no identificado";
            } else if (await documentExistsByFileKey(normalized.key, companyId)) {
              detail.status = "DUPLICATE";
              detail.error = "El archivo ya tiene registro en documentos";
            } else {
              const doc = await createDocument({
                employeeId,
                docTypeId: Number(docTypeId),
                companyId,
                fileKey: normalized.key,
                fileName: normalized.fileName,
                uploadedBy: req.user.id || null,
                expiryDate: null,
              });
              detail.linked = Boolean(doc?.id);
              detail.documentId = doc?.id || null;
              detail.status = detail.linked ? "MATCHED" : "ERROR";
            }
          } catch (err) {
            detail.status = "ERROR";
            detail.error = err.message;
          }

          details.push(detail);
        }

        const summary = {
          processed: details.length,
          stored: details.filter((row) => row.stored).length,
          linked: details.filter((row) => row.linked).length,
          unmatched: details.filter((row) => !row.linked && row.error === "Sin coincidencia de empleado").length,
          duplicates: details.filter((row) => row.status === "DUPLICATE" || row.isDuplicateFileName).length,
          errors: details.filter((row) => !row.linked && row.error && row.error !== "Sin coincidencia de empleado").length,
        };

        return sendJson(res, 201, {
          ok: true,
          data: { rows: details, summary },
          message: `Archivos procesados: ${summary.processed}. Vinculados correctamente: ${summary.linked}. Sin coincidencia: ${summary.unmatched}. Duplicados: ${summary.duplicates}. Errores: ${summary.errors}.`,
        });
      } catch (err) {
        console.error("[documents] POST /bulk-upload:", err.message);
        return sendJson(res, 500, { ok: false, message: "Error cargando documentos masivos" });
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
      const [employees, documentTypes] = await Promise.all([
        getEmployeesForDocumentMatching(companyId),
        getDocumentTypes(),
      ]);
      const rows = markFileNameDuplicates(missing.map((file) => ({
        ...buildBulkReviewRow({ originalname: file.fileName }, employees, documentTypes),
        fileKey: file.fileKey,
      })));

      return sendJson(res, 200, {
        ok: true,
        data: { rows, summary: summarizeBulkRows(rows) },
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
              uploadedBy: req.user.id || null,
              expiryDate: null,
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
          uploadedBy: req.user.id || null,
          expiryDate: expiryDate || null,
        });

        // Generar URL firmada para devolverla al frontend inmediatamente
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

  // ── GET /documents/employee/:employeeId ───────────────────────────────────
  router.get("/employee/:employeeId", authMiddleware, async (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      if (!companyId) {
        return sendJson(res, 400, { ok: false, message: "companyId requerido" });
      }

      const docs = await getDocumentsByEmployee(req.params.employeeId, companyId);

      // No devolver fileKey — el cliente obtiene URLs via GET /:id/url
      const safeData = docs.map(({ fileKey, ...rest }) => rest);

      return sendJson(res, 200, { ok: true, data: safeData });
    } catch (err) {
      console.error("[documents] GET /employee/:id:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error obteniendo documentos" });
    }
  });

  // ── GET /documents/:id/url — URL firmada ──────────────────────────────────
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
      if (!isR2Configured() || !doc.fileKey) {
        // fallback: URL local
        const fileName = doc.fileKey ? doc.fileKey.split("/").pop() : doc.fileName;
        url = `/uploads/documents/${fileName}`;
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

  // ── PATCH /documents/:id/status — aprobar / rechazar ─────────────────────
  router.patch(
    "/:id/status",
    requireRole("administrador", "talento_humano"),
    async (req, res) => {
      try {
        const companyId = resolveCompanyId(req);
        if (!companyId) {
          return sendJson(res, 400, { ok: false, message: "companyId requerido" });
        }

        const { status, reviewNotes } = req.body;
        if (!status) {
          return sendJson(res, 400, { ok: false, message: "status requerido" });
        }

        const updated = await updateDocumentStatus(
          Number(req.params.id),
          companyId,
          {
            status,
            reviewedBy: req.user.id || null,
            reviewNotes: reviewNotes || null,
          }
        );

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
    }
  );

  // ── DELETE /documents/:id ─────────────────────────────────────────────────
  router.delete(
    "/:id",
    requireRole("administrador", "talento_humano"),
    async (req, res) => {
      try {
        const companyId = resolveCompanyId(req);
        if (!companyId) {
          return sendJson(res, 400, { ok: false, message: "companyId requerido" });
        }

        const doc = await deleteDocument(Number(req.params.id), companyId);
        if (!doc) {
          return sendJson(res, 404, { ok: false, message: "Documento no encontrado" });
        }

        // Borrar de R2 (no falla si ya no existe)
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
    }
  );

  // ── Rutas heredadas (backward compat — JSON/base64) ───────────────────────

  // GET /documents y GET /documents?employeeId=xxx
  router.get("/", authMiddleware, async (req, res) => {
    const employeeId = req.query.employeeId;
    const employeeIds = String(req.query.employeeIds || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    try {
      const companyId = resolveCompanyId(req);
      const data = employeeId
        ? await getDocumentsForEmployeeResponse(employeeId, companyId)
        : employeeIds.length
          ? legacyDocs.getDocumentsByEmployees(employeeIds)
        : legacyDocs.getAllDocuments();
      return sendJson(res, 200, { ok: true, data });
    } catch (err) {
      console.error("[documents] GET /:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error obteniendo documentos" });
    }
  });

  // POST /documents (base64 PDF, flujo anterior)
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
        return sendJson(res, 400, { ok: false, message: "Debes subir un archivo PDF válido" });
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

  // PUT /documents/validate
  router.put("/validate", authMiddleware, async (req, res) => {
    try {
      const body = await readJsonBody(req);
      if (!body.id) return sendJson(res, 400, { ok: false, message: "id es requerido" });

      const document = legacyDocs.validateDocument(body.id, body.userName || "Usuario");
      if (!document) {
        const companyId = resolveCompanyId(req);
        if (!companyId) return sendJson(res, 400, { ok: false, message: "companyId requerido" });

        const updated = await updateDocumentStatus(Number(body.id), companyId, {
          status: "aprobado",
          reviewedBy: req.user.id || null,
          reviewNotes: null,
        });
        if (!updated) return sendJson(res, 404, { ok: false, message: "Documento no encontrado" });

        const data = await mapDbDocumentForLegacyClient(updated);
        return sendJson(res, 200, { ok: true, data, message: "Documento validado correctamente" });
      }

      return sendJson(res, 200, { ok: true, data: document, message: "Documento validado correctamente" });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: err.message });
    }
  });

  // PUT /documents/reject
  router.put("/reject", authMiddleware, async (req, res) => {
    try {
      const body = await readJsonBody(req);
      if (!body.id) return sendJson(res, 400, { ok: false, message: "id es requerido" });

      const document = legacyDocs.rejectDocument(body.id, body.reason || "", body.userName || "Usuario");
      if (!document) {
        const companyId = resolveCompanyId(req);
        if (!companyId) return sendJson(res, 400, { ok: false, message: "companyId requerido" });

        const updated = await updateDocumentStatus(Number(body.id), companyId, {
          status: "rechazado",
          reviewedBy: req.user.id || null,
          reviewNotes: body.reason || "",
        });
        if (!updated) return sendJson(res, 404, { ok: false, message: "Documento no encontrado" });

        const data = await mapDbDocumentForLegacyClient(updated);
        return sendJson(res, 200, { ok: true, data, message: "Documento rechazado correctamente" });
      }

      return sendJson(res, 200, { ok: true, data: document, message: "Documento rechazado correctamente" });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: err.message });
    }
  });

  // Error handler al final del router
  router.use(multerErrorHandler);

  return router;
}

module.exports = { createDocumentsRouter };
