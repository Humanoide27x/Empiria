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

const fs = require("fs");
const path = require("path");
const repo = require("../db/users.repository");

const LEGACY_USERS_PATH = path.join(__dirname, "..", "..", "data", "users.json");
const IS_DIAG = process.env.EMPIRIA_DIAG === "1";

// ── Caché en memoria ──────────────────────────────────────────────────────────

let _cache = [];            // array de usuarios normalizados
let _lastRefresh = 0;       // timestamp del último refresh
let _refreshInFlight = null;
const REFRESH_INTERVAL = 60_000; // 60 segundos
let _legacyUsersMode = false;
let _warnedMissingUsersTable = false;

function isMissingUsersRelationError(err) {
  const msg = String(err?.message || "");
  return /relation\s+"?users"?\s+does\s+not\s+exist/i.test(msg);
}

function readLegacyUsersFile() {
  try {
    if (!fs.existsSync(LEGACY_USERS_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(LEGACY_USERS_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[users.js] No se pudo leer data/users.json:", err.message);
    return [];
  }
}

function writeLegacyUsersFile(users) {
  fs.writeFileSync(LEGACY_USERS_PATH, JSON.stringify(users, null, 2) + "\n", "utf8");
}

function syncCacheFromLegacy(reason = "", { warn = true, activateMode = true } = {}) {
  const legacyUsers = readLegacyUsersFile();
  _cache = legacyUsers.map(normalizeUser).filter(Boolean);
  _lastRefresh = Date.now();
  if (activateMode) _legacyUsersMode = true;

  if (warn && !_warnedMissingUsersTable) {
    const suffix = reason ? ` (${reason})` : "";
    console.warn(`[users.js] Tabla PostgreSQL "users" no disponible; usando data/users.json${suffix}`);
    _warnedMissingUsersTable = true;
  }

  return _cache.length > 0;
}

function normalizeUser(user) {
  if (!user) return null;
  const passwordHash = user.password_hash ?? user.passwordHash ?? null;
  const fullName = user.full_name || user.fullName || user.name || null;
  const roleCode = user.role_code || user.roleCode || user.role || null;
  return {
    ...user,
    password_hash: passwordHash,
    full_name: fullName,
    role_code: roleCode,
    role: roleCode || (user.role_from_table ? String(user.role_from_table).toLowerCase() : null),
    companyId: user.company_id ?? user.companyId ?? null,
    company_id: user.company_id ?? user.companyId ?? null,
    contractId: user.contract_id ?? user.contractId ?? null,
    contract_id: user.contract_id ?? user.contractId ?? null,
    mfaEnabled: user.mfa_enabled ?? user.mfaEnabled ?? false,
    mfa_enabled: user.mfa_enabled ?? user.mfaEnabled ?? false,
    mfaSecret: user.mfa_secret ?? user.mfaSecret ?? null,
    mfa_secret: user.mfa_secret ?? user.mfaSecret ?? null,
    name: fullName,
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
  if (IS_DIAG) return true;
  if (_refreshInFlight) return _refreshInFlight;

  _refreshInFlight = (async () => {
    try {
      const users = await repo.getUsers();
      _cache = users.map(normalizeUser).filter(Boolean);
      _lastRefresh = Date.now();
      _legacyUsersMode = false;
      return true;
    } catch (err) {
      if (isMissingUsersRelationError(err)) {
        return syncCacheFromLegacy(err.message);
      }
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
  if (IS_DIAG) return;
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
    if (isMissingUsersRelationError(err)) {
      syncCacheFromLegacy(err.message);
      return findUserByCredentials(username, password);
    }
    console.warn("[users.js] No se pudo validar usuario contra PostgreSQL:", err.message);
    const error = new Error("No fue posible validar credenciales en este momento");
    error.code = "USER_LOOKUP_FAILED";
    throw error;
  }
}

// El refresh de usuarios es diferido para no bloquear ni tumbar el arranque.
syncCacheFromLegacy("carga inicial", { warn: false, activateMode: false });
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
  if (_legacyUsersMode) {
    const users = readLegacyUsersFile();
    const user = users.find((item) => Number(item.id) === Number(userId));
    if (!user) throw new Error("Usuario no encontrado");
    user.mfaSecret = secret;
    user.mfaEnabled = false;
    user.mfaConfirmedAt = null;
    writeLegacyUsersFile(users);
    syncCacheFromLegacy("saveMfaSecret");
    return;
  }
  await repo.saveMfaSecret(userId, secret);
  await refreshCache();
}

async function enableMfaForUser(userId) {
  if (_legacyUsersMode) {
    const users = readLegacyUsersFile();
    const user = users.find((item) => Number(item.id) === Number(userId));
    if (!user) throw new Error("Usuario no encontrado");
    user.mfaEnabled = true;
    user.mfaConfirmedAt = new Date().toISOString();
    writeLegacyUsersFile(users);
    syncCacheFromLegacy("enableMfaForUser");
    return;
  }
  await repo.enableMfaForUser(userId);
  await refreshCache();
}

async function disableMfaForUser(userId) {
  if (_legacyUsersMode) {
    const users = readLegacyUsersFile();
    const user = users.find((item) => Number(item.id) === Number(userId));
    if (!user) throw new Error("Usuario no encontrado");
    user.mfaEnabled = false;
    user.mfaSecret = null;
    user.mfaConfirmedAt = null;
    writeLegacyUsersFile(users);
    syncCacheFromLegacy("disableMfaForUser");
    return;
  }
  await repo.disableMfaForUser(userId);
  await refreshCache();
}

async function resetMfaForUser(userId) {
  if (_legacyUsersMode) {
    await disableMfaForUser(userId);
    return;
  }
  await repo.resetMfaForUser(userId);
  await refreshCache();
}

async function createUser(payload) {
  if (_legacyUsersMode) {
    const users = readLegacyUsersFile();
    const username = String(payload.username || "").trim().toLowerCase();
    if (!username || !payload.password || !String(payload.name || "").trim() || !String(payload.role || "").trim()) {
      throw new Error("Faltan datos obligatorios del usuario");
    }
    if (users.some((item) => String(item.username || "").toLowerCase() === username)) {
      throw new Error("El nombre de usuario ya existe");
    }
    const nextId = users.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
    const created = {
      id: nextId,
      username,
      passwordHash: hashPassword(payload.password),
      name: String(payload.name || "").trim(),
      role: String(payload.role || "").trim().toLowerCase(),
      companyId: payload.companyId ? Number(payload.companyId) : null,
      contractId: payload.contractId ? Number(payload.contractId) : null,
      assignedMunicipalities: [],
      mfaEnabled: false,
      mfaSecret: null,
      mfaConfirmedAt: null,
    };
    users.push(created);
    writeLegacyUsersFile(users);
    syncCacheFromLegacy("createUser");
    return sanitizeUser(normalizeUser(created));
  }
  const user = await repo.createUser(payload);
  await refreshCache();
  return user;
}

async function updateUser(userId, payload) {
  if (_legacyUsersMode) {
    const users = readLegacyUsersFile();
    const user = users.find((item) => Number(item.id) === Number(userId));
    if (!user) throw new Error("Usuario no encontrado");

    if (payload.username !== undefined) user.username = String(payload.username || "").trim().toLowerCase();
    if (payload.name !== undefined) user.name = String(payload.name || "").trim();
    if (payload.password) user.passwordHash = hashPassword(payload.password);
    if (payload.role !== undefined) user.role = String(payload.role || "").trim().toLowerCase();
    if (payload.companyId !== undefined) user.companyId = payload.companyId ? Number(payload.companyId) : null;
    if (payload.contractId !== undefined) user.contractId = payload.contractId ? Number(payload.contractId) : null;
    if (payload.mfaEnabled !== undefined) user.mfaEnabled = Boolean(payload.mfaEnabled);

    writeLegacyUsersFile(users);
    syncCacheFromLegacy("updateUser");
    return sanitizeUser(normalizeUser(user));
  }
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
