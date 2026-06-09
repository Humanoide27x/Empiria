/**
 * EMPIRIA V1 — Express Application
 *
 * Capas de middleware (en orden de ejecución):
 *   1. compression — gzip nivel 6 para CSS/JS/JSON (threshold 1KB)
 *   2. requestId   — X-Request-ID para trazabilidad
 *   3. logger      — Log de requests estructurado (JSON en prod, pretty en dev)
 *   4. cors        — CORS restrictivo (allow-list en prod)
 *   5. helmet      — Cabeceras de seguridad HTTP
 *   6. rate limit  — Protección contra fuerza bruta y abuso
 *   7. body parse  — JSON + urlencoded
 *   8. static      — Archivos públicos (cache inmutable en prod vía ?v=HASH)
 *   9. documents   — Router Express nativo (R2, multipart)
 *  10. legacy      — Puente al requestHandler de server.js
 *  11. 404 / error — Handlers finales
 */

"use strict";

const express      = require("express");
const helmet       = require("helmet");
const compression  = require("compression");
const rateLimit    = require("express-rate-limit");
const path         = require("path");
const fs           = require("fs");
const { URL }      = require("url");
const { APP_VERSION } = require("./version");

const { requestHandler }        = require("./server");
const { createDocumentsRouter } = require("./modules/documents/documents.router");
const { requestId }             = require("./middleware/request-id");
const { requestLogger, emit }   = require("./middleware/logger");
const { corsMiddleware }        = require("./middleware/cors");
const { upload: mkUpload, normalizeUploadedFile } = require("./middleware/upload");
const { requireAuth }           = require("./modules/auth/auth.helpers");
const { ROLES, normalizeRole }  = require("./auth/permissions");
const { isR2Configured, getPrivateUrl } = require("./config/storage");
const { sendJson }              = require("./http/response");

const IS_PROD  = process.env.NODE_ENV === "production";
const app      = express();

// ── Trust proxy (Render, Railway, Nginx, etc.) ───────────────────────────────
app.set("trust proxy", 1);

// ── Compresión gzip (debe ir antes de cualquier respuesta) ───────────────────
app.use(compression({
  // No comprimir respuestas pequeñas (< 1KB) — overhead no vale la pena
  threshold: 1024,
  // Nivel 6: buen balance entre ratio y velocidad de CPU
  level: 6,
}));

// ── Trazabilidad ──────────────────────────────────────────────────────────────
app.use(requestId);
app.use(requestLogger);

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(corsMiddleware);

// ── Seguridad HTTP (Helmet) ───────────────────────────────────────────────────
app.use(
  helmet({
    // CSP desactivado hasta migrar el frontend a hash/nonce
    contentSecurityPolicy:   false,
    crossOriginEmbedderPolicy: false,
    // En producción forzar HTTPS
    hsts: IS_PROD
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
  })
);

app.disable("x-powered-by");
app.get("/health", (_req, res) => {
  sendJson(res, 200, { ok: true, status: "up" });
});

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use((req, res, next) => {
  const guardedPrefixes = ["/documents/bulk", "/document-center", "/document-audit"];
  const pathname = req.path || "";
  const isGuarded = guardedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (!isGuarded) {
    return next();
  }

  const auth = requireAuth(req, res);
  if (!auth) {
    return;
  }

  if (normalizeRole(auth.user.role) !== ROLES.ADMINISTRATOR) {
    sendJson(res, 403, { ok: false, message: "No tienes permiso para esta accion" });
    return;
  }

  next();
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             IS_PROD ? 10 : 50,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res) => {
    emit("warn", { msg: "rate_limit_login", ip: req.ip, requestId: req.requestId });
    res.status(429).json({ ok: false, message: "Demasiados intentos. Intenta en 15 minutos." });
  },
});

const apiLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             IS_PROD ? 300 : 1000,
  standardHeaders: true,
  legacyHeaders:   false,
  skip:            (req) => !req.path.startsWith("/") || req.path === "/status",
});

app.use("/login", loginLimiter);
app.use(apiLimiter);

// ── Archivos estáticos ────────────────────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// index.html: compilar una vez al arrancar con la versión inyectada
const _rawHtml    = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
const INDEX_HTML  = _rawHtml.replaceAll("__VER__", APP_VERSION);
const HTML_HEADERS = { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" };

// Servir index.html con versión inyectada (evita cache de 1 día en producción)
app.get(["/", "/index.html"], (_req, res) => {
  res.set(HTML_HEADERS).send(INDEX_HTML);
});

// Archivos estáticos: CSS/JS/imágenes con cache controlado por version param
app.use(express.static(PUBLIC_DIR, {
  index:        false,   // index.html lo manejamos arriba
  etag:         true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (/\.html$/.test(filePath)) {
      res.setHeader("Cache-Control", "no-store");
    } else if (/\.(css|js|mjs)$/.test(filePath)) {
      // URL incluye ?v=HASH → cache 1 año + immutable (se invalida en cada deploy)
      res.setHeader("Cache-Control", IS_PROD
        ? "public, max-age=31536000, immutable"
        : "no-cache");
    } else if (/\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|eot)$/.test(filePath)) {
      // Imágenes: 30 días (sin versión en URL, renovamos periódicamente)
      res.setHeader("Cache-Control", "public, max-age=2592000");
    }
  },
}));

// ── Módulos Express nativos ───────────────────────────────────────────────────
app.use("/documents", createDocumentsRouter());

// ── Subida de archivos para soportes de novedades ────────────────────────────
const _supUploadMw = mkUpload("soportes");
function _supAuthMw(req, res, next) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  req.user = auth.user;
  next();
}
app.post(
  "/payroll/supports/upload",
  _supAuthMw,
  _supUploadMw.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return sendJson(res, 400, { ok: false, message: "Archivo requerido" });
      const norm = normalizeUploadedFile(req.file);
      let url;
      if (norm.isLocal || !isR2Configured()) {
        url = `/uploads/soportes/${norm.key.split("/").pop()}`;
      } else {
        url = await getPrivateUrl(norm.key, 86400);
      }
      return sendJson(res, 200, { ok: true, data: { url, fileName: norm.fileName } });
    } catch (err) {
      return sendJson(res, 500, { ok: false, message: err.message });
    }
  },
  (err, req, res, _next) => {
    sendJson(res, err.status || 400, { ok: false, message: err.message });
  }
);

// ── Importación de plantilla mensual de novedades ────────────────────────────
const multerMemory = require("multer")({ storage: require("multer").memoryStorage() });
const { handleImportNoveltiesTemplate } = require("./modules/payroll/payroll.controller");
app.post(
  /^\/payroll\/periods\/\d+\/import-novelties-template$/,
  _supAuthMw,
  multerMemory.single("file"),
  async (req, res) => { await handleImportNoveltiesTemplate(req, res); },
  (err, req, res, _next) => {
    res.status(err.status || 400).json({ ok: false, message: err.message });
  }
);

// ── Puente hacia el handler legacy ───────────────────────────────────────────
app.use(async (req, res, next) => {
  try {
    const baseUrl = `http://${req.headers.host || "localhost"}`;
    const url     = new URL(req.url, baseUrl);
    const handled = await requestHandler(req, res, url);
    if (handled === false) next();
  } catch (err) {
    next(err);
  }
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.accepts("html")) {
    res.set(HTML_HEADERS).send(INDEX_HTML);
  } else {
    res.status(404).json({ ok: false, message: "Ruta no encontrada" });
  }
});

// ── Error handler global ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  emit("error", {
    msg:       "unhandled_error",
    error:     err.message,
    path:      req.path,
    requestId: req.requestId,
    stack:     IS_PROD ? undefined : err.stack?.split("\n").slice(0, 3).join(" | "),
  });

  if (res.headersSent) return;

  res.status(err.status || err.statusCode || 500).json({
    ok:      false,
    message: IS_PROD ? "Error interno del servidor" : err.message,
    requestId: req.requestId,
  });
});

module.exports = app;
