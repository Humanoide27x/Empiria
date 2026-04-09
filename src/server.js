const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const { handleAuthRoutes } = require("./modules/auth/auth.routes");
const { handleAdminRoutes } = require("./modules/admin/admin.routes");
const { handleEmployeesRoutes } = require("./modules/employees/employees.routes");
const { handleDocumentsRoutes } = require("./modules/documents/documents.routes");
const { handleCompaniesRoutes } = require("./modules/companies/companies.routes");
const { handleContractsRoutes } = require("./modules/contracts/contracts.routes");
const { handleDashboardRoutes } = require("./modules/dashboard/dashboard.routes");
const { handleTrainingsRoutes } = require("./modules/trainings/trainings.routes");
const { handleReportsRoutes } = require("./modules/reports/reports.routes");

const { requireAuth } = require("./modules/auth/auth.helpers");

const { withModuleProtection } = require("./http/protection");
const { readJsonBody } = require("./http/request");
const {
  sendJson,
  sendMethodNotAllowed,
  sendNotFound,
} = require("./http/response");

const {
  ACTIONS,
  MODULES,
  getRolePermissions,
} = require("./auth/permissions");

const { evaluateModuleAccess } = require("./auth/access");
const { getUsers, sanitizeUser } = require("./data/users");

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

  if (
    fs.existsSync(resolvedFilePath) &&
    fs.statSync(resolvedFilePath).isFile()
  ) {
    serveStaticFileByPath(res, resolvedFilePath);
    return true;
  }

  return false;
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
    const action =
      body.action || url.searchParams.get("action") || ACTIONS.VIEW;
    const resource = body.resource || null;

    if (!moduleKey) {
      sendJson(res, 400, {
        ok: false,
        message: "Debes enviar el nombre del modulo",
      });
      return;
    }

    const result = evaluateModuleAccess(
      auth.user,
      moduleKey,
      action,
      resource
    );

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

const protectedModuleRoutes = [
  {
    method: "GET",
    path: "/documents",
    moduleKey: MODULES.EMPLOYEE_FILES,
    action: ACTIONS.VIEW,
    label: "Modulo de gestion documental disponible para este usuario",
  },
  {
    method: "GET",
    path: "/coverage",
    moduleKey: MODULES.COVERAGE,
    action: ACTIONS.VIEW,
    label: "Modulo de cobertura disponible para este usuario",
  },
  {
    method: "POST",
    path: "/payroll-changes",
    moduleKey: MODULES.PAYROLL,
    action: ACTIONS.REGISTER,
    label: "Registro de novedades de nomina permitido para este usuario",
  },
];

async function requestHandler(req, res) {
  const url = new URL(req.url, "http://localhost:3000");

  if (tryServePublicAsset(req, res, url)) {
    return;
  }

  const authHandled = await handleAuthRoutes(req, res, url);
  if (authHandled) return;

  const adminHandled = await handleAdminRoutes(req, res, url);
  if (adminHandled) return;

  const employeesHandled = await handleEmployeesRoutes(req, res, url);
  if (employeesHandled) return;

  const documentsHandled = await handleDocumentsRoutes(req, res, url);
  if (documentsHandled) return;

  const companiesHandled = await handleCompaniesRoutes(req, res, url);
  if (companiesHandled) return;

  const contractsHandled = await handleContractsRoutes(req, res, url);
  if (contractsHandled) return;

  const dashboardHandled = await handleDashboardRoutes(req, res, url);
  if (dashboardHandled) return;

  const trainingsHandled = await handleTrainingsRoutes(req, res, url);
  if (trainingsHandled) return;

  const reportsHandled = await handleReportsRoutes(req, res, url);
  if (reportsHandled) return;

  if (url.pathname === "/status") {
    sendJson(res, 200, {
      ok: true,
      message: "EMPIRIA backend activo",
    });
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
    await handleAccessCheck(req, res, url);
    return;
  }

  const protectedRoute = protectedModuleRoutes.find(
    (route) => route.path === url.pathname && route.method === req.method
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
      }
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