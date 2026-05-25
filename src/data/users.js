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
let _refreshInFlight = null;
const REFRESH_INTERVAL = 60_000; // 60 segundos

function normalizeUser(user) {
  if (!user) return null;
  return {
    ...user,
    role: user.role_code || user.role || (user.role_from_table ? String(user.role_from_table).toLowerCase() : null),
    companyId: user.company_id ?? user.companyId ?? null,
    contractId: user.contract_id ?? user.contractId ?? null,
    mfaEnabled: user.mfa_enabled ?? user.mfaEnabled ?? false,
    mfaSecret: user.mfa_secret ?? user.mfaSecret ?? null,
    name: user.full_name || user.name || null,
  };
}

function upsertCachedUser(user) {
  const normalized = normalizeUser(user);
  if (!normalized?.id) return null;
  const index = _cache.findIndex((item) => Number(item.id) === Number(normalized.id));
  if (index >= 0) {
    _cache[index] = normalized;
  } else {
    _cache.push(normalized);
  }
  return normalized;
}

async function refreshCache() {
  if (_refreshInFlight) return _refreshInFlight;

  _refreshInFlight = (async () => {
    try {
      const users = await repo.getUsers();
      _cache = users.map(normalizeUser).filter(Boolean);
      _lastRefresh = Date.now();
      return true;
    } catch (err) {
      console.warn("[users.js] No se pudo refrescar caché de usuarios; EMPIRIA continuará con la caché actual:", err.message);
      return false;
    } finally {
      _refreshInFlight = null;
    }
  })();

  return _refreshInFlight;
}

function scheduleRefresh(delayMs = 5_000) {
  const timer = setTimeout(() => {
    refreshCache().catch((err) => {
      console.warn("[users.js] Refresh diferido de usuarios falló:", err.message);
    });
  }, delayMs);
  timer.unref?.();
}

function startBackgroundRefresh() {
  if (startBackgroundRefresh.started) return;
  startBackgroundRefresh.started = true;
  scheduleRefresh();
  setInterval(() => {
    refreshCache().catch((err) => {
      console.warn("[users.js] Refresh periódico de usuarios falló:", err.message);
    });
  }, REFRESH_INTERVAL).unref();
}
startBackgroundRefresh.started = false;

async function findUserByCredentialsAsync(username, password) {
  const cached = findUserByCredentials(username, password);
  if (cached) return cached;

  try {
    const user = await repo.findUserByCredentials(username, password);
    return upsertCachedUser(user);
  } catch (err) {
    console.warn("[users.js] No se pudo validar usuario contra PostgreSQL:", err.message);
    const error = new Error("No fue posible validar credenciales en este momento");
    error.code = "USER_LOOKUP_FAILED";
    throw error;
  }
}

// El refresh de usuarios es diferido para no bloquear ni tumbar el arranque.
startBackgroundRefresh();

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
  findUserByCredentialsAsync,
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
