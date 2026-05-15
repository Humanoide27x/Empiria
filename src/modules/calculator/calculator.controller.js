"use strict";

const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { requireAuth }                    = require("../auth/auth.helpers");
const { readJsonBody }                   = require("../../http/request");
const { ROLES }                          = require("../../auth/permissions");
const { calculate, saveAuditLog, listAuditLogs } = require("./calculator.repository");

const VALID_MODALITIES = ["CAA", "CAARES", "RI"];

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}

function isAdminOrTH(user) {
  return user.role === ROLES.ADMINISTRATOR || user.role === ROLES.HUMAN_RESOURCES;
}

async function handleCalculate(req, res, url, user) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }

  let body;
  try { body = await readJsonBody(req); } catch { body = {}; }

  const modality = String(body.modality || "").toUpperCase().trim();
  const cupos    = parseInt(body.cupos, 10);

  if (!VALID_MODALITIES.includes(modality)) {
    sendJson(res, 400, { ok: false, message: "Modalidad inválida. Use CAA, CAARES o RI." });
    return;
  }
  if (isNaN(cupos) || cupos < 0) {
    sendJson(res, 400, { ok: false, message: "El número de cupos debe ser un entero no negativo." });
    return;
  }

  const { raw, fullTime, halfTime } = calculate(modality, cupos);

  try {
    await saveAuditLog({
      userId:   user.id,
      username: user.username,
      userRole: user.role,
      modality,
      cupos,
      raw,
      fullTime,
      halfTime,
      ip: getClientIp(req),
    });
  } catch (auditErr) {
    console.warn("[calculator] No se pudo guardar audit log:", auditErr.message);
  }

  sendJson(res, 200, {
    ok: true,
    data: { modality, cupos, raw, fullTime, halfTime },
  });
}

async function handleAuditLog(req, res, url, user) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  if (!isAdminOrTH(user)) {
    sendJson(res, 403, { ok: false, message: "Solo Administrador o Talento Humano pueden consultar el historial." });
    return;
  }

  const modality = url.searchParams.get("modality") || "";
  const limit    = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
  const offset   = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  const logs = await listAuditLogs({
    modality: VALID_MODALITIES.includes(modality.toUpperCase()) ? modality.toUpperCase() : null,
    limit,
    offset,
  });

  sendJson(res, 200, { ok: true, data: logs });
}

module.exports = { handleCalculate, handleAuditLog };
