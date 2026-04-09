const { ROLES } = require("../../auth/permissions");
const { getSession } = require("../../auth/tokens");
const { findUserById } = require("../../data/users");
const { createAccessLog } = require("../../data/accessLogin");
const { getBearerToken } = require("../../http/request");
const { sendJson } = require("../../http/response");
const { getBlockConfig } = require("../../data/loginAttempts");

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return (
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    req.headers["x-real-ip"] ||
    ""
  );
}

function createSafeAccessLog(payload) {
  try {
    createAccessLog(payload);
  } catch (error) {
    console.error("No fue posible guardar el access log:", error.message);
  }
}

function getAuthenticatedUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  const session = getSession(token);

  if (!session) {
    return null;
  }

  const user = findUserById(session.userId);

  if (!user) {
    return null;
  }

  return {
    token,
    user,
  };
}

function getBlockedMessage(blockedUntil) {
  const config = getBlockConfig();
  const until = blockedUntil
    ? new Date(blockedUntil).toLocaleString("es-CO")
    : "más tarde";

  return `Cuenta bloqueada temporalmente por demasiados intentos fallidos. Intenta de nuevo más tarde. Regla activa: ${config.maxFailedAttempts} intentos en ${config.windowMinutes} minutos. Bloqueado hasta: ${until}`;
}

function requireAuth(req, res) {
  const auth = getAuthenticatedUser(req);

  if (!auth || !auth.user) {
    sendJson(res, 401, {
      ok: false,
      message: "Debes iniciar sesion",
    });
    return null;
  }

  return auth;
}

function requireAdministrator(req, res) {
  const auth = requireAuth(req, res);

  if (!auth) {
    return null;
  }

  if (auth.user.role !== ROLES.ADMINISTRATOR) {
    sendJson(res, 403, {
      ok: false,
      message: "Solo el administrador puede hacer esta accion",
    });
    return null;
  }

  return auth;
}

module.exports = {
  getClientIp,
  createSafeAccessLog,
  getAuthenticatedUser,
  getBlockedMessage,
  requireAuth,
  requireAdministrator,
};