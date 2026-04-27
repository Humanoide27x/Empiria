const { ROLES, normalizeRole } = require("../../auth/permissions");
const { getSession } = require("../../auth/tokens");
const { findUserById } = require("../../data/users");
const { createAccessLog } = require("../../data/accessLogin");
const { getBearerToken } = require("../../http/request");
const { sendJson } = require("../../http/response");
const { getBlockConfig } = require("../../data/loginAttempts");

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const realIp = req.headers["x-real-ip"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }

  return req.socket?.remoteAddress || req.connection?.remoteAddress || "";
}

function createSafeAccessLog(payload) {
  try {
    createAccessLog(payload);
  } catch (error) {
    console.error("No fue posible guardar el access log:", error.message);
  }
}

function getAuthenticatedUser(req) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return null;
    }

    const session = getSession(token);

    if (!session || !session.userId) {
      return null;
    }

    const user = findUserById(session.userId);

    if (!user) {
      return null;
    }

    return {
      token,
      session,
      user,
    };
  } catch (error) {
    console.error("Error obteniendo usuario autenticado:", error.message);
    return null;
  }
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

  const role = normalizeRole(auth.user.role);

  if (role !== ROLES.ADMINISTRATOR) {
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