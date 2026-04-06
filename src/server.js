const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const {
  ACTIONS,
  MODULES,
  ROLES,
  getRolePermissions,
} = require("./auth/permissions");

const { createSession, getSession, removeSession } = require("./auth/tokens");

const {
  describeUserAccess,
  evaluateModuleAccess,
  matchesUserScope,
} = require("./auth/access");

const {
  createUser,
  enableMfaForUser,
  findUserByCredentials,
  findUserById,
  getCompanies,
  getContracts,
  getUsers,
  resetMfaForUser,
  sanitizeUser,
  saveMfaSecret,
  updateUser,
} = require("./data/users");

const { createPersonnel, getPersonnel } = require("./data/personnel");
const { getResumeDocuments } = require("./data/resumes");

const {
  createTraining,
  getAttendance,
  getTrainings,
  markAttendance,
} = require("./data/trainings");

const { createReport, getReports } = require("./data/reports");
const { createAccessLog, getAccessLogs } = require("./data/accessLogin");

const { getBearerToken, readJsonBody } = require("./http/request");

const {
  sendJson,
  sendMethodNotAllowed,
  sendNotFound,
} = require("./http/response");

const { getRolesFromDb, getCompaniesFromDb } = require("./db/queries");

const {
  generateMfaSecret,
  generateQrCode,
  verifyMfaToken,
} = require("./auth/mfa");

const {
  clearFailedAttempts,
  getBlockConfig,
  isUserBlocked,
  registerFailedAttempt,
} = require("./data/loginAttempts");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_TYPES[extension] || "application/octet-stream";
}

function serveStaticFileByPath(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendNotFound(res);
    return;
  }

  res.writeHead(200, {
    "Content-Type": getContentType(filePath),
  });

  res.end(fs.readFileSync(filePath));
}

function tryServePublicAsset(req, res, url) {
  if (req.method !== "GET") {
    return false;
  }

  const rawPath = decodeURIComponent(url.pathname);

  const requestedPath =
    rawPath === "/" || rawPath === ""
      ? "index.html"
      : rawPath.replace(/^[/\\]+/, "");

  const safePath = path.normalize(requestedPath);
  const filePath = path.join(PUBLIC_DIR, safePath);

  const resolvedPublicDir = path.resolve(PUBLIC_DIR);
  const resolvedFilePath = path.resolve(filePath);

  if (!resolvedFilePath.startsWith(resolvedPublicDir)) {
    sendNotFound(res);
    return true;
  }

  if (fs.existsSync(resolvedFilePath) && fs.statSync(resolvedFilePath).isFile()) {
    serveStaticFileByPath(res, resolvedFilePath);
    return true;
  }

  return false;
}

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
  const until = blockedUntil ? new Date(blockedUntil).toLocaleString("es-CO") : "más tarde";

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

function parseResourceFromRequest(url) {
  const companyId = url.searchParams.get("companyId");
  const contractId = url.searchParams.get("contractId");
  const municipality = url.searchParams.get("municipality");

  return {
    companyId: companyId ? Number(companyId) : null,
    contractId: contractId ? Number(contractId) : null,
    municipality: municipality || null,
  };
}

function getDefaultResourceForUser(user) {
  return {
    companyId: user.companyId ?? null,
    contractId: user.contractId ?? null,
    municipality: user.assignedMunicipalities?.[0] || null,
  };
}

function getScopedPersonnel(user) {
  return getPersonnel().filter((record) =>
    matchesUserScope(user, {
      companyId: record.companyId,
      contractId: record.contractId,
      municipality: record.municipality,
    }),
  );
}

function getVisibleResumeRecords(user, filters = {}) {
  const rolePermissions = getRolePermissions(user.role);
  const visibleFields = rolePermissions?.modules?.[MODULES.RESUME_VIEW]?.fields || [];
  const documentsByPersonnelId = new Map(
    getResumeDocuments().map((item) => [item.personnelId, item]),
  );

  return getScopedPersonnel(user)
    .filter((record) => {
      if (filters.site && record.site !== filters.site) {
        return false;
      }

      if (filters.institution && record.institution !== filters.institution) {
        return false;
      }

      if (filters.modality && record.modality !== filters.modality) {
        return false;
      }

      return true;
    })
    .map((record) => {
      const documents = documentsByPersonnelId.get(record.id) || {};

      const visibleDocuments = visibleFields.reduce((accumulator, field) => {
        accumulator[field] = documents[field] || "No cargado";
        return accumulator;
      }, {});

      return {
        personnelId: record.id,
        fullName: record.fullName,
        documentNumber: record.documentNumber,
        position: record.position,
        municipality: record.municipality,
        site: record.site || "Sin sede",
        institution: record.institution || "Sin institucion",
        modality: record.modality || "Sin modalidad",
        documents: visibleDocuments,
      };
    });
}

function getScopedTrainings(user) {
  return getTrainings().filter((training) =>
    matchesUserScope(user, {
      companyId: training.companyId,
      contractId: training.contractId,
      municipality: training.municipality,
    }),
  );
}

function getVisibleTrainingAttendance(user) {
  const visibleTrainings = getScopedTrainings(user);
  const visibleTrainingIds = new Set(visibleTrainings.map((item) => item.id));
  const scopedPersonnel = getScopedPersonnel(user);
  const personnelMap = new Map(scopedPersonnel.map((item) => [item.id, item]));

  return visibleTrainings.map((training) => {
    const attendanceRows = getAttendance()
      .filter((item) => visibleTrainingIds.has(item.trainingId) && item.trainingId === training.id)
      .map((item) => ({
        ...item,
        personnel: personnelMap.get(item.personnelId) || null,
      }));

    return {
      ...training,
      attendance: attendanceRows,
    };
  });
}

function getScopedReports(user) {
  return getReports().filter((report) =>
    matchesUserScope(user, {
      companyId: report.companyId,
      contractId: report.contractId,
      municipality: null,
    }),
  );
}

function getAvailableReportTemplates(user) {
  const rolePermissions = getRolePermissions(user.role);
  const features = rolePermissions?.modules?.[MODULES.REPORTS]?.features || [];

  const templates = [
    {
      id: "resumen_general",
      title: "Resumen general",
      description: "Resume el personal visible, activos y novedades del alcance del usuario.",
    },
  ];

  if (features.includes("20_por_ciento_madres_cabeza_familia")) {
    templates.push({
      id: "madres_cabeza_familia",
      title: "20% madres cabeza de familia",
      description: "Calcula el porcentaje visible de madres cabeza de familia en el personal.",
    });
  }

  if (features.includes("cambio_personal_carta_solicitud")) {
    templates.push({
      id: "cambio_personal",
      title: "Cambio de personal",
      description:
        "Resume el personal con novedades y deja nota de carta de solicitud y hoja de vida anexa.",
    });
  }

  return templates;
}

function buildReportContent(user, template) {
  const scopedPersonnel = getScopedPersonnel(user);
  const totalPersonnel = scopedPersonnel.length;
  const activePersonnel = scopedPersonnel.filter((item) => item.status === "activo").length;
  const noveltyPersonnel = scopedPersonnel.filter((item) => item.status === "novedad").length;
  const headOfHouseholdCount = scopedPersonnel.filter((item) => item.headOfHousehold).length;
  const headOfHouseholdPercent = totalPersonnel
    ? Number(((headOfHouseholdCount / totalPersonnel) * 100).toFixed(2))
    : 0;

  if (template === "madres_cabeza_familia") {
    return {
      summary: "Reporte del porcentaje de madres cabeza de familia dentro del personal visible.",
      metrics: {
        totalPersonnel,
        headOfHouseholdCount,
        headOfHouseholdPercent,
      },
      notes: ["Este reporte usa los registros visibles para el rol actual."],
    };
  }

  if (template === "cambio_personal") {
    return {
      summary: "Reporte de novedades y cambios de personal.",
      metrics: {
        totalPersonnel,
        noveltyPersonnel,
      },
      notes: [
        "Adjuntar carta de solicitud cuando aplique.",
        "Adjuntar PDF con hoja de vida del reemplazo cuando corresponda.",
      ],
      people: scopedPersonnel
        .filter((item) => item.status === "novedad" || item.status === "retiro")
        .map((item) => ({
          fullName: item.fullName,
          position: item.position,
          municipality: item.municipality,
          status: item.status,
        })),
    };
  }

  return {
    summary: "Reporte general del alcance visible para este usuario.",
    metrics: {
      totalPersonnel,
      activePersonnel,
      noveltyPersonnel,
    },
    notes: ["Este resumen se genera con el personal visible para el usuario actual."],
  };
}

function withModuleProtection(moduleKey, action, handler) {
  return async (req, res, url) => {
    const auth = requireAuth(req, res);

    if (!auth) {
      return;
    }

    const requestedResource = parseResourceFromRequest(url);

    const hasExplicitScope =
      requestedResource.companyId !== null ||
      requestedResource.contractId !== null ||
      requestedResource.municipality !== null;

    const resource = hasExplicitScope
      ? requestedResource
      : getDefaultResourceForUser(auth.user);

    const access = evaluateModuleAccess(auth.user, moduleKey, action, resource);

    if (!access.allowed) {
      sendJson(res, 403, {
        ok: false,
        message: access.reason,
      });
      return;
    }

    await handler(req, res, url, auth.user, resource);
  };
}

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
        reason: attempt?.blockedUntil ? "invalid_credentials_account_blocked" : "invalid_credentials",
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
          reason: attempt?.blockedUntil ? "invalid_mfa_account_blocked" : "invalid_mfa",
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

  if (!auth) {
    return;
  }

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

  if (!auth) {
    return;
  }

  try {
    const body = await readJsonBody(req);
    const currentUser = findUserById(auth.user.id);

    if (!body.token) {
      sendJson(res, 400, {
        ok: false,
        message: "Debes enviar el codigo MFA",
      });
      return;
    }

    if (!currentUser || !currentUser.mfaSecret) {
      sendJson(res, 400, {
        ok: false,
        message: "Primero debes generar el secreto MFA",
      });
      return;
    }

    const isValid = verifyMfaToken(currentUser.mfaSecret, body.token);

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
    sendJson(res, 500, {
      ok: false,
      message: "Error confirmando MFA",
      detail: error.message,
    });
  }
}

function handleAdminResetMfa(req, res, url) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAdministrator(req, res);

  if (!auth) {
    return;
  }

  readJsonBody(req)
    .then((body) => {
      const userId = Number(body.userId);

      if (!userId) {
        sendJson(res, 400, {
          ok: false,
          message: "Debes enviar el userId",
        });
        return;
      }

      const targetUser = findUserById(userId);

      if (!targetUser) {
        sendJson(res, 404, {
          ok: false,
          message: "Usuario no encontrado",
        });
        return;
      }

      const updatedUser = resetMfaForUser(userId);

      createSafeAccessLog({
        username: auth.user.username,
        userId: auth.user.id,
        role: auth.user.role,
        success: true,
        status: "success",
        reason: `admin_reset_mfa_for_user_${userId}`,
        ip: getClientIp(req),
        userAgent: req.headers["user-agent"] || "",
      });

      sendJson(res, 200, {
        ok: true,
        message: `MFA restablecido correctamente para ${targetUser.username}`,
        user: updatedUser,
      });
    })
    .catch((error) => {
      sendJson(res, 400, {
        ok: false,
        message: error.message,
      });
    });
}

function handleModules(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  sendJson(res, 200, {
    ok: true,
    modules: Object.values(MODULES),
    actions: Object.values(ACTIONS),
  });
}

function handleDemoUsers(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const demoPasswords = {
    admin: "admin123",
    talento1: "talento123",
    operacion1: "operacion123",
    calidad1: "calidad123",
    gestor1: "gestor123",
    auditor1: "auditor123",
    interventoria1: "interventoria123",
  };

  sendJson(res, 200, {
    ok: true,
    users: getUsers()
      .filter((user) => demoPasswords[user.username])
      .map((user) => ({
        ...sanitizeUser(user),
        demoPassword: demoPasswords[user.username],
      })),
  });
}

async function handleAccessCheck(req, res, url) {
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
    const moduleKey = body.module || url.searchParams.get("module");
    const action = body.action || url.searchParams.get("action") || ACTIONS.VIEW;
    const resource = body.resource || null;

    if (!moduleKey) {
      sendJson(res, 400, {
        ok: false,
        message: "Debes enviar el nombre del modulo",
      });
      return;
    }

    const result = evaluateModuleAccess(auth.user, moduleKey, action, resource);

    sendJson(res, 200, {
      ok: true,
      requested: {
        module: moduleKey,
        action,
        resource,
      },
      result,
    });
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      message: error.message,
    });
  }
}

function handleUsers(req, res) {
  if (req.method === "GET") {
    const auth = requireAdministrator(req, res);

    if (!auth) {
      return;
    }

    sendJson(res, 200, {
      ok: true,
      users: getUsers().map(sanitizeUser),
    });
    return;
  }

  if (req.method === "POST") {
    const auth = requireAdministrator(req, res);

    if (!auth) {
      return;
    }

    readJsonBody(req)
      .then((body) => {
        const created = createUser(body);

        sendJson(res, 201, {
          ok: true,
          message: "Usuario creado correctamente",
          user: created,
        });
      })
      .catch((error) => {
        sendJson(res, 400, {
          ok: false,
          message: error.message,
        });
      });

    return;
  }

  sendMethodNotAllowed(res);
}

function handleUserUpdate(req, res, url) {
  if (req.method !== "PATCH") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAdministrator(req, res);

  if (!auth) {
    return;
  }

  const userId = Number(url.pathname.split("/")[2]);

  readJsonBody(req)
    .then((body) => {
      const updated = updateUser(userId, body);

      sendJson(res, 200, {
        ok: true,
        message: "Usuario actualizado correctamente",
        user: updated,
      });
    })
    .catch((error) => {
      sendJson(res, 400, {
        ok: false,
        message: error.message,
      });
    });
}

async function handleCompanies(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAuth(req, res);

  if (!auth) {
    return;
  }

  try {
    const companies = await getCompaniesFromDb();

    sendJson(res, 200, {
      ok: true,
      companies,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message: "No fue posible consultar las empresas",
      detail: error.message,
    });
  }
}

function handleContracts(req, res) {
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
    contracts: getContracts(),
  });
}

function handleAccessLogs(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAdministrator(req, res);

  if (!auth) {
    return;
  }

  const username = (url.searchParams.get("username") || "").trim().toLowerCase();
  const successParam = (url.searchParams.get("success") || "").trim().toLowerCase();
  const reason = (url.searchParams.get("reason") || "").trim().toLowerCase();
  const status = (url.searchParams.get("status") || "").trim().toLowerCase();
  const ip = (url.searchParams.get("ip") || "").trim().toLowerCase();
  const from = (url.searchParams.get("from") || "").trim();
  const to = (url.searchParams.get("to") || "").trim();
  const limitParam = Number(url.searchParams.get("limit") || 100);

  let logs = getAccessLogs();

  if (username) {
    logs = logs.filter((item) =>
      String(item.username || "").toLowerCase().includes(username),
    );
  }

  if (successParam === "true") {
    logs = logs.filter((item) => item.success === true);
  }

  if (successParam === "false") {
    logs = logs.filter((item) => item.success === false);
  }

  if (reason) {
    logs = logs.filter((item) =>
      String(item.reason || "").toLowerCase().includes(reason),
    );
  }

  if (status) {
    logs = logs.filter((item) =>
      String(item.status || "").toLowerCase() === status,
    );
  }

  if (ip) {
    logs = logs.filter((item) =>
      String(item.ip || "").toLowerCase().includes(ip),
    );
  }

  if (from) {
    const fromDate = new Date(from);
    if (!Number.isNaN(fromDate.getTime())) {
      logs = logs.filter((item) => new Date(item.createdAt) >= fromDate);
    }
  }

  if (to) {
    const toDate = new Date(to);
    if (!Number.isNaN(toDate.getTime())) {
      logs = logs.filter((item) => new Date(item.createdAt) <= toDate);
    }
  }

  logs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const safeLimit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, 500)
    : 100;

  const filteredLogs = logs.slice(0, safeLimit);

  const summary = {
  total: filteredLogs.length,
  success: filteredLogs.filter((item) => item.status === "success").length,
  failed: filteredLogs.filter((item) => item.status === "failed").length,
  pendingMfa: filteredLogs.filter((item) => item.status === "pending_mfa").length,
  blocked: filteredLogs.filter((item) =>
    String(item.reason || "").includes("blocked")
  ).length,
};

  sendJson(res, 200, {
    ok: true,
    summary,
    total: filteredLogs.length,
    logs: filteredLogs,
  });
}

function handleDashboardSummary(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  withModuleProtection(
    MODULES.DASHBOARD,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user) => {
      const visiblePersonnel = getScopedPersonnel(user);
      const activeCount = visiblePersonnel.filter((item) => item.status === "activo").length;
      const noveltyCount = visiblePersonnel.filter((item) => item.status === "novedad").length;
      const municipalities = [...new Set(visiblePersonnel.map((item) => item.municipality))];

      sendJson(innerRes, 200, {
        ok: true,
        summary: {
          totalPersonnel: visiblePersonnel.length,
          activePersonnel: activeCount,
          noveltyPersonnel: noveltyCount,
          visibleMunicipalities: municipalities.length,
          visibleContracts: [...new Set(visiblePersonnel.map((item) => item.contractId))].length,
        },
        recentPersonnel: visiblePersonnel.slice(0, 5),
      });
    },
  )(req, res, url);
}

function handlePersonnel(req, res, url) {
  if (req.method === "GET") {
    withModuleProtection(
      MODULES.PERSONNEL,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user) => {
        sendJson(innerRes, 200, {
          ok: true,
          personnel: getScopedPersonnel(user),
          canCreate: evaluateModuleAccess(
            user,
            MODULES.PERSONNEL,
            ACTIONS.CREATE,
            getDefaultResourceForUser(user),
          ).allowed,
        });
      },
    )(req, res, url);
    return;
  }

  if (req.method === "POST") {
    withModuleProtection(
      MODULES.PERSONNEL,
      ACTIONS.CREATE,
      async (innerReq, innerRes, innerUrl, user) => {
        try {
          const body = await readJsonBody(innerReq);

          const record = {
            ...body,
            companyId: body.companyId ?? user.companyId,
            contractId: body.contractId ?? user.contractId,
          };

          const inScope = matchesUserScope(user, {
            companyId: Number(record.companyId),
            contractId: Number(record.contractId),
            municipality: record.municipality,
          });

          if (!inScope) {
            sendJson(innerRes, 403, {
              ok: false,
              message: "No puedes crear personal fuera de tu alcance",
            });
            return;
          }

          const created = createPersonnel(record);

          sendJson(innerRes, 201, {
            ok: true,
            message: "Personal creado correctamente",
            personnel: created,
          });
        } catch (error) {
          sendJson(innerRes, 400, {
            ok: false,
            message: error.message,
          });
        }
      },
    )(req, res, url);
    return;
  }

  sendMethodNotAllowed(res);
}

function handleResumeView(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  withModuleProtection(
    MODULES.RESUME_VIEW,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user) => {
      const filters = {
        site: innerUrl.searchParams.get("site") || "",
        institution: innerUrl.searchParams.get("institution") || "",
        modality: innerUrl.searchParams.get("modality") || "",
      };

      const records = getVisibleResumeRecords(user, filters);
      const rolePermissions = getRolePermissions(user.role);

      sendJson(innerRes, 200, {
        ok: true,
        filters,
        availableFilters: {
          sites: [...new Set(getScopedPersonnel(user).map((item) => item.site).filter(Boolean))],
          institutions: [
            ...new Set(getScopedPersonnel(user).map((item) => item.institution).filter(Boolean)),
          ],
          modalities: [
            ...new Set(getScopedPersonnel(user).map((item) => item.modality).filter(Boolean)),
          ],
        },
        visibleFields: rolePermissions?.modules?.[MODULES.RESUME_VIEW]?.fields || [],
        records,
      });
    },
  )(req, res, url);
}

function handleTrainings(req, res, url) {
  if (req.method === "GET") {
    withModuleProtection(
      MODULES.TRAININGS,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user) => {
        sendJson(innerRes, 200, {
          ok: true,
          trainings: getScopedTrainings(user),
          canCreate: evaluateModuleAccess(
            user,
            MODULES.TRAININGS,
            ACTIONS.CREATE,
            getDefaultResourceForUser(user),
          ).allowed,
        });
      },
    )(req, res, url);
    return;
  }

  if (req.method === "POST") {
    withModuleProtection(
      MODULES.TRAININGS,
      ACTIONS.CREATE,
      async (innerReq, innerRes, innerUrl, user) => {
        try {
          const body = await readJsonBody(innerReq);

          const training = {
            ...body,
            companyId: body.companyId ?? user.companyId,
            contractId: body.contractId ?? user.contractId,
            createdByRole: user.role,
          };

          const inScope = matchesUserScope(user, {
            companyId: Number(training.companyId),
            contractId: Number(training.contractId),
            municipality: training.municipality,
          });

          if (!inScope) {
            sendJson(innerRes, 403, {
              ok: false,
              message: "No puedes crear capacitaciones fuera de tu alcance",
            });
            return;
          }

          const created = createTraining(training);

          sendJson(innerRes, 201, {
            ok: true,
            message: "Capacitacion creada correctamente",
            training: created,
          });
        } catch (error) {
          sendJson(innerRes, 400, {
            ok: false,
            message: error.message,
          });
        }
      },
    )(req, res, url);
    return;
  }

  sendMethodNotAllowed(res);
}

function handleTrainingAttendance(req, res, url) {
  if (req.method === "GET") {
    withModuleProtection(
      MODULES.TRAINING_ATTENDANCE,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user) => {
        sendJson(innerRes, 200, {
          ok: true,
          trainings: getVisibleTrainingAttendance(user),
          personnel: getScopedPersonnel(user),
        });
      },
    )(req, res, url);
    return;
  }

  if (req.method === "POST") {
    withModuleProtection(
      MODULES.TRAINING_ATTENDANCE,
      ACTIONS.ATTENDANCE,
      async (innerReq, innerRes, innerUrl, user) => {
        try {
          const body = await readJsonBody(innerReq);

          const training = getScopedTrainings(user).find(
            (item) => item.id === Number(body.trainingId),
          );

          const personnel = getScopedPersonnel(user).find(
            (item) => item.id === Number(body.personnelId),
          );

          if (!training || !personnel) {
            sendJson(innerRes, 403, {
              ok: false,
              message: "No puedes marcar asistencia sobre registros fuera de tu alcance",
            });
            return;
          }

          const updated = markAttendance({
            trainingId: body.trainingId,
            personnelId: body.personnelId,
            status: body.status,
            markedByRole: user.role,
          });

          sendJson(innerRes, 200, {
            ok: true,
            message: "Asistencia actualizada correctamente",
            attendance: updated,
          });
        } catch (error) {
          sendJson(innerRes, 400, {
            ok: false,
            message: error.message,
          });
        }
      },
    )(req, res, url);
    return;
  }

  sendMethodNotAllowed(res);
}

function handleReports(req, res, url) {
  if (req.method === "GET") {
    withModuleProtection(
      MODULES.REPORTS,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user) => {
        sendJson(innerRes, 200, {
          ok: true,
          templates: getAvailableReportTemplates(user),
          reports: getScopedReports(user),
          defaults: {
            companyId: user.companyId,
            contractId: user.contractId,
          },
        });
      },
    )(req, res, url);
    return;
  }

  if (req.method === "POST") {
    withModuleProtection(
      MODULES.REPORTS,
      ACTIONS.CREATE,
      async (innerReq, innerRes, innerUrl, user) => {
        try {
          const body = await readJsonBody(innerReq);
          const templates = getAvailableReportTemplates(user);

          if (!templates.find((item) => item.id === body.template)) {
            sendJson(innerRes, 403, {
              ok: false,
              message: "Ese tipo de informe no esta permitido para este rol",
            });
            return;
          }

          const report = createReport({
            title: body.title,
            template: body.template,
            createdByRole: user.role,
            companyId: body.companyId ?? user.companyId,
            contractId: body.contractId ?? user.contractId,
            content: buildReportContent(user, body.template),
          });

          sendJson(innerRes, 201, {
            ok: true,
            message: "Informe creado correctamente",
            report,
          });
        } catch (error) {
          sendJson(innerRes, 400, {
            ok: false,
            message: error.message,
          });
        }
      },
    )(req, res, url);
    return;
  }

  sendMethodNotAllowed(res);
}

const protectedModuleRoutes = [
  {
    method: "GET",
    path: "/personnel",
    moduleKey: MODULES.PERSONNEL,
    action: ACTIONS.VIEW,
    label: "Modulo de personal disponible para este usuario",
  },
  {
    method: "GET",
    path: "/resume-view",
    moduleKey: MODULES.RESUME_VIEW,
    action: ACTIONS.VIEW,
    label: "Modulo de hoja de vida disponible para este usuario",
  },
  {
    method: "GET",
    path: "/reports",
    moduleKey: MODULES.REPORTS,
    action: ACTIONS.VIEW,
    label: "Modulo de informes disponible para este usuario",
  },
  {
    method: "GET",
    path: "/trainings",
    moduleKey: MODULES.TRAININGS,
    action: ACTIONS.VIEW,
    label: "Modulo de capacitaciones disponible para este usuario",
  },
  {
    method: "GET",
    path: "/documents",
    moduleKey: MODULES.DOCUMENT_MANAGEMENT,
    action: ACTIONS.VIEW,
    label: "Modulo de gestion documental disponible para este usuario",
  },
  {
    method: "GET",
    path: "/coverage",
    moduleKey: MODULES.COVERAGE_VERIFICATION,
    action: ACTIONS.VIEW,
    label: "Modulo de cobertura disponible para este usuario",
  },
  {
    method: "POST",
    path: "/payroll-changes",
    moduleKey: MODULES.PAYROLL_CHANGES_REGISTRATION,
    action: ACTIONS.REGISTER,
    label: "Registro de novedades de nomina permitido para este usuario",
  },
];

function requestHandler(req, res) {
  const url = new URL(req.url, "http://localhost:3000");

  if (tryServePublicAsset(req, res, url)) {
    return;
  }

  if (url.pathname === "/status") {
    sendJson(res, 200, {
      ok: true,
      message: "EMPIRIA backend activo",
    });
    return;
  }

  if (url.pathname === "/login") {
    handleLogin(req, res);
    return;
  }

  if (url.pathname === "/mfa/setup") {
    handleMfaSetup(req, res);
    return;
  }

  if (url.pathname === "/mfa/confirm") {
    handleMfaConfirm(req, res);
    return;
  }

  if (url.pathname === "/logout") {
    handleLogout(req, res);
    return;
  }

  if (url.pathname === "/me") {
    handleMe(req, res);
    return;
  }

  if (url.pathname === "/roles") {
    handleRoles(req, res);
    return;
  }

  if (url.pathname === "/modules") {
    handleModules(req, res);
    return;
  }

  if (url.pathname === "/demo-users") {
    handleDemoUsers(req, res);
    return;
  }

  if (url.pathname === "/access-check") {
    handleAccessCheck(req, res, url);
    return;
  }

  if (url.pathname === "/users") {
    handleUsers(req, res);
    return;
  }

  if (url.pathname.startsWith("/users/")) {
    handleUserUpdate(req, res, url);
    return;
  }

  if (url.pathname === "/companies") {
    handleCompanies(req, res);
    return;
  }

  if (url.pathname === "/contracts") {
    handleContracts(req, res);
    return;
  }

  if (url.pathname === "/access-logs") {
  handleAccessLogs(req, res, url);
  return;
  }

  if (url.pathname === "/dashboard-summary") {
    handleDashboardSummary(req, res, url);
    return;
  }

  if (url.pathname === "/personnel") {
    handlePersonnel(req, res, url);
    return;
  }

  if (url.pathname === "/resume-view") {
    handleResumeView(req, res, url);
    return;
  }

  if (url.pathname === "/trainings") {
    handleTrainings(req, res, url);
    return;
  }

  if (url.pathname === "/training-attendance") {
    handleTrainingAttendance(req, res, url);
    return;
  }

  if (url.pathname === "/reports") {
    handleReports(req, res, url);
    return;
  }

  if (url.pathname === "/access-logs") {
  handleAccessLogs(req, res, url);
  return;
  }

  if (url.pathname === "/admin/reset-mfa") {
  handleAdminResetMfa(req, res, url);
  return;
}

  const protectedRoute = protectedModuleRoutes.find(
    (route) => route.path === url.pathname && route.method === req.method,
  );

  if (protectedRoute) {
    withModuleProtection(
      protectedRoute.moduleKey,
      protectedRoute.action,
      async (innerReq, innerRes, innerUrl, user, resource) => {
        sendJson(innerRes, 200, {
          ok: true,
          message: protectedRoute.label,
          user: sanitizeUser(user),
          resource,
        });
      },
    )(req, res, url);
    return;
  }

  sendNotFound(res);
}

function createServer() {
  return http.createServer(requestHandler);
}

module.exports = {
  createServer,
};

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}