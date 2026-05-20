/**
 * EMPIRIA V1 — Express Application
 *
 * Capas de middleware (en orden de ejecución):
 *   1. requestId   — X-Request-ID para trazabilidad
 *   2. logger      — Log de requests estructurado (JSON en prod, pretty en dev)
 *   3. cors        — CORS restrictivo (allow-list en prod)
 *   4. helmet      — Cabeceras de seguridad HTTP
 *   5. rate limit  — Protección contra fuerza bruta y abuso
 *   6. body parse  — JSON + urlencoded
 *   7. static      — Archivos públicos
 *   8. documents   — Router Express nativo (R2, multipart)
 *   9. legacy      — Puente al requestHandler de server.js
 *  10. 404 / error — Handlers finales
 */

"use strict";

const express   = require("express");
const helmet    = require("helmet");
const rateLimit = require("express-rate-limit");
const path      = require("path");
const { URL }   = require("url");

const { requestHandler }      = require("./server");
const { createDocumentsRouter } = require("./modules/documents/documents.router");
const { requestId }           = require("./middleware/request-id");
const { requestLogger, emit } = require("./middleware/logger");
const { corsMiddleware }      = require("./middleware/cors");

const IS_PROD  = process.env.NODE_ENV === "production";
const app      = express();

// ── Trust proxy (Railway, Nginx, etc.) ───────────────────────────────────────
// Necesario para que req.ip refleje la IP real del cliente (no la del proxy).
app.set("trust proxy", 1);

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

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

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
app.use(express.static(PUBLIC_DIR, {
  index:      "index.html",
  maxAge:     IS_PROD ? "1d" : 0,
  etag:       true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (/\.(js|mjs)$/.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
}));

// ── Módulos Express nativos ───────────────────────────────────────────────────
app.use("/documents", createDocumentsRouter());

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
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
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
