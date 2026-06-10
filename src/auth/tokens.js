const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");

const SESSIONS_FILE = path.join(__dirname, "../../data/sessions.json");
const SESSION_DURATION_MS = 1000 * 60 * 60 * 8; // 8 horas

// ── Persistencia en disco ─────────────────────────────────────────────────────
function _loadSessions() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return new Map();
    const raw  = fs.readFileSync(SESSIONS_FILE, "utf8");
    const arr  = JSON.parse(raw);
    const now  = Date.now();
    const map  = new Map();
    for (const [token, session] of arr) {
      if (session.expiresAt && session.expiresAt > now) map.set(token, session);
    }
    return map;
  } catch {
    return new Map();
  }
}

let _savePending = false;
function _persistSessions() {
  if (_savePending) return;
  _savePending = true;
  setImmediate(() => {
    _savePending = false;
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...activeSessions.entries()]), "utf8");
    } catch { /* non-fatal */ }
  });
}

const activeSessions = _loadSessions();

// Tokens de un solo uso para ver/descargar documentos desde una nueva pestaña.
// Expiran en 60 segundos y se consumen al primer uso.
const viewTokens = new Map();
const VIEW_TOKEN_DURATION_MS = 60 * 1000;

function createViewToken({ docId, companyId, userId, action = "view" }) {
  const token = crypto.randomBytes(32).toString("hex");
  viewTokens.set(token, {
    docId: Number(docId),
    companyId: Number(companyId),
    userId,
    action,
    expiresAt: Date.now() + VIEW_TOKEN_DURATION_MS,
  });
  return token;
}

function consumeViewToken(token) {
  if (!token) return null;
  const data = viewTokens.get(token);
  if (!data) return null;
  viewTokens.delete(token); // un solo uso
  if (data.expiresAt < Date.now()) return null;
  return data;
}

setInterval(() => {
  const now = Date.now();
  for (const [t, d] of viewTokens.entries()) {
    if (d.expiresAt < now) viewTokens.delete(t);
  }
}, 60 * 1000);

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function createSession(user) {
  const token = createToken();
  const now   = Date.now();

  activeSessions.set(token, {
    userId: user.id,
    createdAt: now,
    expiresAt: now + SESSION_DURATION_MS,
  });

  _persistSessions();
  return token;
}

function getSession(token) {
  if (!token) return null;

  const session = activeSessions.get(token);

  if (!session) return null;

  const now = Date.now();

  if (session.expiresAt && session.expiresAt < now) {
    activeSessions.delete(token);
    return null;
  }

  return session;
}

function removeSession(token) {
  if (!token) return;
  activeSessions.delete(token);
  _persistSessions();
}

// limpieza automática de sesiones expiradas
setInterval(() => {
  const now = Date.now();
  let removed = 0;

  for (const [token, session] of activeSessions.entries()) {
    if (session.expiresAt && session.expiresAt < now) {
      activeSessions.delete(token);
      removed++;
    }
  }

  if (removed > 0) _persistSessions();
}, 1000 * 60 * 10); // cada 10 minutos

module.exports = {
  createSession,
  getSession,
  removeSession,
  createViewToken,
  consumeViewToken,
};