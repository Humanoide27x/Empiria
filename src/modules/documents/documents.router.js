/**
 * Express Router para gestión documental con Cloudflare R2.
 *
 * Montado en /documents desde app.js, toma precedencia sobre el handler legacy.
 * Los endpoints heredados (JSON base64) siguen respondiendo mientras el frontend
 * no migre completamente.
 */

const { Router } = require("express");
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

      const rows = files.map((file) =>
        buildBulkReviewRow(
          typeof file === "string" ? { originalname: file } : file,
          employees,
          documentTypes
        )
      );

      const summary = rows.reduce((acc, row) => {
        acc.total += 1;
        acc[row.status] = (acc[row.status] || 0) + 1;
        if (row.canAutoAssign) acc.assignable += 1;
        return acc;
      }, { total: 0, assignable: 0 });

      return sendJson(res, 200, { ok: true, data: { rows, summary } });
    } catch (err) {
      console.error("[documents] POST /bulk-preview:", err.message);
      return sendJson(res, 500, { ok: false, message: "Error prevalidando documentos" });
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
  router.get("/", authMiddleware, (req, res) => {
    const employeeId = req.query.employeeId;
    const data = employeeId
      ? legacyDocs.getDocumentsByEmployee(employeeId)
      : legacyDocs.getAllDocuments();
    return sendJson(res, 200, { ok: true, data });
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
      if (!document) return sendJson(res, 404, { ok: false, message: "Documento no encontrado" });

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
      if (!document) return sendJson(res, 404, { ok: false, message: "Documento no encontrado" });

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
