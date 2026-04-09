const { ACTIONS, MODULES } = require("../../auth/permissions");
const { createSession, removeSession } = require("../../auth/tokens");
const {
  describeUserAccess,
  evaluateModuleAccess,
} = require("../../auth/access");

const {
  getUsers,
  enableMfaForUser,
  findUserByCredentials,
  findUserById,
  resetMfaForUser,
  sanitizeUser,
  saveMfaSecret,
} = require("../../data/users");

const {
  clearFailedAttempts,
  isUserBlocked,
  registerFailedAttempt,
} = require("../../data/loginAttempts");

const { getRolesFromDb } = require("../../db/queries");

const {
  generateMfaSecret,
  generateQrCode,
  verifyMfaToken,
} = require("../../auth/mfa");

const { readJsonBody } = require("../../http/request");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");

const {
  getClientIp,
  createSafeAccessLog,
  getAuthenticatedUser,
  getBlockedMessage,
  requireAuth,
  requireAdministrator,
} = require("./auth.helpers");

async function handleLogin(req, res) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return;
  }

  try {
    const body = await readJsonBody(req);
    const username = body.username || "";
    const normalizedUsername = String(username || "").trim().toLowerCase();
    const ip = getClientIp(req);
    const userAgent = req.headers["user-agent"] || "";

    const blockState = isUserBlocked(normalizedUsername);

    if (blockState.blocked) {
      createSafeAccessLog({
        username,
        success: false,
        status: "failed",
        reason: "account_temporarily_blocked",
        ip,
        userAgent,
      });

      sendJson(res, 423, {
        ok: false,
        blocked: true,
        blockedUntil: blockState.blockedUntil,
        message: getBlockedMessage(blockState.blockedUntil),
      });
      return;
    }

    const user = findUserByCredentials(body.username, body.password);

    if (!user) {
      const attempt = registerFailedAttempt(normalizedUsername);

      createSafeAccessLog({
        username,
        success: false,
        status: "failed",
        reason: attempt?.blockedUntil
          ? "invalid_credentials_account_blocked"
          : "invalid_credentials",
        ip,
        userAgent,
      });

      if (attempt?.blockedUntil) {
        sendJson(res, 423, {
          ok: false,
          blocked: true,
          blockedUntil: attempt.blockedUntil,
          message: getBlockedMessage(attempt.blockedUntil),
        });
        return;
      }

      sendJson(res, 401, {
        ok: false,
        message: "Usuario o contrasena invalidos",
      });
      return;
    }

    const existingUserBlockState = isUserBlocked(user.username);

    if (existingUserBlockState.blocked) {
      createSafeAccessLog({
        username: user.username,
        userId: user.id,
        role: user.role,
        success: false,
        status: "failed",
        reason: "account_temporarily_blocked",
        ip,
        userAgent,
      });

      sendJson(res, 423, {
        ok: false,
        blocked: true,
        blockedUntil: existingUserBlockState.blockedUntil,
        message: getBlockedMessage(existingUserBlockState.blockedUntil),
      });
      return;
    }

    if (user.mfaEnabled) {
      if (!body.mfaCode) {
        createSafeAccessLog({
          username: user.username,
          userId: user.id,
          role: user.role,
          success: false,
          status: "pending_mfa",
          reason: "mfa_required",
          ip,
          userAgent,
        });

        sendJson(res, 200, {
          ok: false,
          requiresMfa: true,
          message: "Debes ingresar el codigo MFA",
        });
        return;
      }

      const isValidMfa = verifyMfaToken(user.mfaSecret, body.mfaCode);

      if (!isValidMfa) {
        const attempt = registerFailedAttempt(user.username);

        createSafeAccessLog({
          username: user.username,
          userId: user.id,
          role: user.role,
          success: false,
          status: "failed",
          reason: attempt?.blockedUntil
            ? "invalid_mfa_account_blocked"
            : "invalid_mfa",
          ip,
          userAgent,
        });

        if (attempt?.blockedUntil) {
          sendJson(res, 423, {
            ok: false,
            blocked: true,
            blockedUntil: attempt.blockedUntil,
            message: getBlockedMessage(attempt.blockedUntil),
          });
          return;
        }

        sendJson(res, 401, {
          ok: false,
          requiresMfa: true,
          message: "Codigo MFA invalido",
        });
        return;
      }
    }

    clearFailedAttempts(user.username);

    const token = createSession(user);

    createSafeAccessLog({
      username: user.username,
      userId: user.id,
      role: user.role,
      success: true,
      status: "success",
      reason: user.mfaEnabled ? "login_success_mfa" : "login_success",
      ip,
      userAgent,
    });

    sendJson(res, 200, {
      ok: true,
      message: "Inicio de sesion exitoso",
      token,
      user: sanitizeUser(user),
      access: describeUserAccess(user),
    });
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      message: error.message,
    });
  }
}

function handleLogout(req, res) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = getAuthenticatedUser(req);

  if (!auth || !auth.user) {
    sendJson(res, 401, {
      ok: false,
      message: "Token invalido o ausente",
    });
    return;
  }

  removeSession(auth.token);

  sendJson(res, 200, {
    ok: true,
    message: "Sesion cerrada correctamente",
  });
}

function handleMe(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAuth(req, res);

  if (!auth) return;

  sendJson(res, 200, {
    ok: true,
    user: sanitizeUser(auth.user),
    access: describeUserAccess(auth.user),
  });
}

async function handleRoles(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  try {
    const roles = await getRolesFromDb();

    sendJson(res, 200, {
      ok: true,
      roles,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message: "No fue posible consultar los roles",
      detail: error.message,
    });
  }
}

async function handleMfaSetup(req, res) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) return;

  const user = auth.user;

  try {
    const { secret, otpauth_url } = generateMfaSecret(user.username);
    const qr = await generateQrCode(otpauth_url);

    saveMfaSecret(user.id, secret);

    sendJson(res, 200, {
      ok: true,
      qr,
      message: "Escanea este QR con tu app autenticadora",
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message: "Error generando MFA",
      detail: error.message,
    });
  }
}

async function handleMfaConfirm(req, res) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) return;

  try {
    const body = await readJsonBody(req);
    const currentUser = findUserById(auth.user.id);

    if (!body.token) {
      sendJson(res, 400, { ok: false, message: "Debes enviar el codigo MFA" });
      return;
    }

    if (!currentUser || !currentUser.mfaSecret) {
      sendJson(res, 400, { ok: false, message: "Primero genera el secreto MFA" });
      return;
    }

    const isValid = verifyMfaToken(currentUser.mfaSecret, body.token);

    if (!isValid) {
      sendJson(res, 400, { ok: false, message: "Codigo invalido" });
      return;
    }

    enableMfaForUser(currentUser.id);

    sendJson(res, 200, {
      ok: true,
      message: "MFA activado correctamente",
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message: "Error confirmando MFA",
      detail: error.message,
    });
  }
}

module.exports = {
  handleLogin,
  handleLogout,
  handleMe,
  handleRoles,
  handleMfaSetup,
  handleMfaConfirm,
};