/**
 * src/data/users.js — Capa de compatibilidad con caché en memoria
 *
 * Mantiene la API SÍNCRONA original que necesitan auth.helpers.js y otros
 * módulos legacy, pero carga y escribe los datos desde/hacia PostgreSQL.
 *
 * Patrón:
 *  - Lee: sincrónico desde caché en RAM (refrescada cada 60 s desde PG)
 *  - Escribe: async a PG e invalida la caché inmediatamente
 */

const repo = require("../db/users.repository");

// ── Caché en memoria ──────────────────────────────────────────────────────────

let _cache = [];            // array de usuarios normalizados
let _lastRefresh = 0;       // timestamp del último refresh
const REFRESH_INTERVAL = 60_000; // 60 segundos

async function refreshCache() {
  try {
    const users = await repo.getUsers();
    _cache = users;
    _lastRefresh = Date.now();
  } catch (err) {
    console.error("[users.js] Error al refrescar caché de usuarios:", err.message);
  }
}

// Carga inicial al importar el módulo
refreshCache();

// Refresca cada 60 segundos
setInterval(refreshCache, REFRESH_INTERVAL).unref();

// ── API síncrona (para código legacy) ────────────────────────────────────────

function getUsers() {
  return _cache;
}

function findUserById(userId) {
  return _cache.find((u) => Number(u.id) === Number(userId)) || null;
}

function findUserByUsername(username) {
  const normalized = String(username || "").trim().toLowerCase();
  return _cache.find((u) => String(u.username || "").toLowerCase() === normalized) || null;
}

function hashPassword(password) {
  return repo.hashPassword(password);
}

function findUserByCredentials(username, password) {
  const hash = hashPassword(password);
  const normalized = String(username || "").trim().toLowerCase();
  return (
    _cache.find(
      (u) =>
        String(u.username || "").toLowerCase() === normalized &&
        u.password_hash === hash &&
        u.active !== false
    ) || null
  );
}

function sanitizeUser(user) {
  return repo.sanitizeUser(user);
}

function getCompanies() {
  // Mantenido para compatibilidad — retorna vacío (usar companies.repository.js)
  return [];
}

function getContracts() {
  // Mantenido para compatibilidad — retorna vacío (usar contracts.repository.js)
  return [];
}

// ── API async (para código nuevo) ────────────────────────────────────────────

async function saveMfaSecret(userId, secret) {
  await repo.saveMfaSecret(userId, secret);
  await refreshCache();
}

async function enableMfaForUser(userId) {
  await repo.enableMfaForUser(userId);
  await refreshCache();
}

async function disableMfaForUser(userId) {
  await repo.disableMfaForUser(userId);
  await refreshCache();
}

async function resetMfaForUser(userId) {
  await repo.resetMfaForUser(userId);
  await refreshCache();
}

async function createUser(payload) {
  const user = await repo.createUser(payload);
  await refreshCache();
  return user;
}

async function updateUser(userId, payload) {
  const user = await repo.updateUser(userId, payload);
  await refreshCache();
  return user;
}

module.exports = {
  createUser,
  disableMfaForUser,
  enableMfaForUser,
  findUserByCredentials,
  findUserById,
  findUserByUsername,
  getCompanies,
  getContracts,
  getUsers,
  hashPassword,
  sanitizeUser,
  saveMfaSecret,
  updateUser,
  resetMfaForUser,
  refreshCache,        // exportado para uso en tests y admin
};
