const { createSession, removeSession } = require("../../auth/tokens");
const { describeUserAccess } = require("../../auth/access");

const {
  enableMfaForUser,
  findUserByCredentials,
  findUserById,
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
} = require("./auth.helpers");

async function handleLogin(req, res) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return;
  }

  try {
    const body = await readJsonBody(req);

    const username = String(body.username || "").trim();
    const normalizedUsername = username.toLowerCase();
    const password = String(body.password || "");
    const mfaCode = String(body.mfaCode || "").trim();

    const ip = getClientIp(req);
    const userAgent = req.headers["user-agent"] || "";

    if (!username || !password) {
      sendJson(res, 400, {
        ok: false,
        message: "Debes enviar usuario y contrasena",
      });
      return;
    }

    const blockState = isUserBlocked(normalizedUsername);

    if (blockState?.blocked) {
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

    const user = findUserByCredentials(username, password);

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

    const existingUserBlockState = isUserBlocked(
      String(user.username || "").trim().toLowerCase()
    );

    if (existingUserBlockState?.blocked) {
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
      if (!mfaCode) {
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

      const isValidMfa = verifyMfaToken(user.mfaSecret, mfaCode);

      if (!isValidMfa) {
        const attempt = registerFailedAttempt(
          String(user.username || "").trim().toLowerCase()
        );

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

    clearFailedAttempts(String(user.username || "").trim().toLowerCase());

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
    console.error("Error en login:", error);

    sendJson(res, 500, {
      ok: false,
      message: "Error interno iniciando sesion",
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

  if (!auth) {
    return;
  }

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
    console.error("Error consultando roles:", error);

    sendJson(res, 500, {
      ok: false,
      message: "No fue posible consultar los roles",
    });
  }
}

async function handleMfaSetup(req, res) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAuth(req, res);

  if (!auth) {
    return;
  }

  try {
    const { secret, otpauth_url } = generateMfaSecret(auth.user.username);
    const qr = await generateQrCode(otpauth_url);

    saveMfaSecret(auth.user.id, secret);

    sendJson(res, 200, {
      ok: true,
      qr,
      message: "Escanea este QR con tu app autenticadora",
    });
  } catch (error) {
    console.error("Error generando MFA:", error);

    sendJson(res, 500, {
      ok: false,
      message: "Error generando MFA",
    });
  }
}

async function handleMfaConfirm(req, res) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAuth(req, res);

  if (!auth) {
    return;
  }

  try {
    const body = await readJsonBody(req);
    const token = String(body.token || "").trim();
    const currentUser = findUserById(auth.user.id);

    if (!token) {
      sendJson(res, 400, {
        ok: false,
        message: "Debes enviar el codigo MFA",
      });
      return;
    }

    if (!currentUser || !currentUser.mfaSecret) {
      sendJson(res, 400, {
        ok: false,
        message: "Primero genera el secreto MFA",
      });
      return;
    }

    const isValid = verifyMfaToken(currentUser.mfaSecret, token);

    if (!isValid) {
      sendJson(res, 400, {
        ok: false,
        message: "Codigo invalido",
      });
      return;
    }

    enableMfaForUser(currentUser.id);

    sendJson(res, 200, {
      ok: true,
      message: "MFA activado correctamente",
    });
  } catch (error) {
    console.error("Error confirmando MFA:", error);

    sendJson(res, 500, {
      ok: false,
      message: "Error confirmando MFA",
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