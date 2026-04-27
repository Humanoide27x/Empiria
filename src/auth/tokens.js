const crypto = require("crypto");

const activeSessions = new Map();

const SESSION_DURATION_MS = 1000 * 60 * 60 * 8; // 8 horas

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function createSession(user) {
  const token = createToken();

  const now = Date.now();

  activeSessions.set(token, {
    userId: user.id,
    createdAt: now,
    expiresAt: now + SESSION_DURATION_MS,
  });

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
}

// limpieza automática de sesiones expiradas
setInterval(() => {
  const now = Date.now();

  for (const [token, session] of activeSessions.entries()) {
    if (session.expiresAt && session.expiresAt < now) {
      activeSessions.delete(token);
    }
  }
}, 1000 * 60 * 10); // cada 10 minutos

module.exports = {
  createSession,
  getSession,
  removeSession,
};