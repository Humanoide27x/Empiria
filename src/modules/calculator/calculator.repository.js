"use strict";

const pool = require("../../db/pool");

// ── Formulas ──────────────────────────────────────────────────────────────────

function calcRaw(modality, cupos) {
  if (modality === "CAA") {
    return 1 + (cupos - 60) / 120;
  }
  if (modality === "CAARES") {
    return 1 + ((cupos * 4) - 60) / 120;
  }
  if (modality === "RI") {
    if (cupos <= 100) return 0;
    if (cupos <= 300) return 1;
    if (cupos <= 500) return 2;
    if (cupos <= 800) return 3;
    return 4;
  }
  throw new Error("Modalidad no válida: " + modality);
}

// Rounding rule:
//   decimal < 0.25   → no extra (round down)
//   0.25 ≤ dec ≤ 0.50 → add half time
//   dec > 0.50       → round up to next integer
function applyRounding(raw) {
  const safeRaw = Math.max(0, raw);
  const floor = Math.floor(safeRaw);
  const dec = parseFloat((safeRaw - floor).toFixed(6));

  if (dec < 0.25)  return { fullTime: floor, halfTime: 0 };
  if (dec <= 0.50) return { fullTime: floor, halfTime: 1 };
  return { fullTime: floor + 1, halfTime: 0 };
}

function calculate(modality, cupos) {
  const raw = calcRaw(modality, cupos);
  if (modality === "RI") {
    return { raw, fullTime: raw, halfTime: 0 };
  }
  const { fullTime, halfTime } = applyRounding(raw);
  return { raw, fullTime, halfTime };
}

// ── Audit persistence ─────────────────────────────────────────────────────────

async function saveAuditLog({ userId, username, userRole, modality, cupos, raw, fullTime, halfTime, ip }) {
  const result = await pool.query(
    `INSERT INTO calculator_audit
       (user_id, username, user_role, modality, cupos, raw_result, full_time, half_time, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, calculated_at`,
    [
      userId   || null,
      username,
      userRole || null,
      modality,
      cupos,
      raw      !== null && raw !== undefined ? raw : null,
      fullTime,
      halfTime,
      ip       || null,
    ]
  );
  return result.rows[0];
}

async function listAuditLogs({ modality, userId, limit = 100, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (modality) {
    params.push(modality);
    conditions.push(`modality = $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    conditions.push(`user_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT id, user_id, username, user_role, modality, cupos,
            raw_result, full_time, half_time, ip_address, calculated_at
     FROM calculator_audit
     ${where}
     ORDER BY calculated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

module.exports = { calculate, saveAuditLog, listAuditLogs };
