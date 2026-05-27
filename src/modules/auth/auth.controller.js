const { createSession, removeSession } = require("../../auth/tokens");
const { describeUserAccess } = require("../../auth/access");
const pool = require("../../db/pool");

// Modules only the global admin can see (users with no contractId/companyId)
const GLOBAL_ADMIN_ONLY = new Set(["administracion_configuraciones"]);

// Modules whose visibility can be toggled per-contract in the config panel
const CONFIGURABLE_MODULES = new Set([
  "gestion_personal",
  "nomina_novedades",
  "cobertura_calculadora",
  "calculadora_personal",
]);

async function applyContractModules(access, user) {
  const contractId = user?.contractId ?? user?.contract_id ?? null;
  if (!contractId) return access;

  // Strip modules that are exclusively for the global admin
  let modules = access.modules.filter((m) => !GLOBAL_ADMIN_ONLY.has(m.module));

  // Feature flags controlled per-contract — enabled by default, disabled only when explicitly set to false
  const features = { equipo_minimo: true };

  try {
    const result = await pool.query(
      "SELECT modules FROM contract_settings WHERE contract_id = $1 LIMIT 1",
      [contractId]
    );
    const contractModules = result.rows[0]?.modules;
    if (contractModules && typeof contractModules === "object") {
      modules = modules.filter((m) => {
        if (CONFIGURABLE_MODULES.has(m.module)) {
          return contractModules[m.module] !== false;
        }
        return true;
      });
      // Sub-feature flags — opt-out: disable only when explicitly set to false
      if (contractModules.equipo_minimo === false) features.equipo_minimo = false;
    }
  } catch {
    // fall back — global-admin-only modules are still stripped
  }

  return { ...access, modules, features };
}

const {
  enableMfaForUser,
  findUserByCredentialsAsync,
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

let _rolesCache = null;
let _rolesCacheTs = 0;
const ROLES_CACHE_TTL_MS = 5 * 60 * 1000;

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

    const user = await findUserByCredentialsAsync(username, password);

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

    const access = await applyContractModules(describeUserAccess(user), user);

    sendJson(res, 200, {
      ok: true,
      message: "Inicio de sesion exitoso",
      token,
      user: sanitizeUser(user),
      access,
    });
  } catch (error) {
    console.error("Error en login:", error);

    if (error.code === "USER_LOOKUP_FAILED") {
      sendJson(res, 503, {
        ok: false,
        message: "No fue posible validar credenciales en este momento",
      });
      return;
    }

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

async function handleMe(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAuth(req, res);

  if (!auth) {
    return;
  }

  const access = await applyContractModules(describeUserAccess(auth.user), auth.user);

  sendJson(res, 200, {
    ok: true,
    user: sanitizeUser(auth.user),
    access,
  });
}

async function handleRoles(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  try {
    let roles = _rolesCache;
    let cached = Boolean(roles && Date.now() - _rolesCacheTs <= ROLES_CACHE_TTL_MS);
    if (!roles || Date.now() - _rolesCacheTs > ROLES_CACHE_TTL_MS) {
      roles = await getRolesFromDb();
      _rolesCache = roles;
      _rolesCacheTs = Date.now();
      cached = false;
    }

    sendJson(res, 200, {
      ok: true,
      cached,
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
