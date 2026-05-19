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
const { handleRequirementRoutes } = require("./modules/requirements/requirements.routes");
const { handleCoverageRoutes } = require("./modules/coverage/coverage.routes");
const { handlePayrollRoutes } = require("./modules/payroll/payroll.routes");
const { handleEmployeeRequestsRoutes } = require("./modules/requests/requests.routes");
const { handleEducationRoutes } = require("./modules/education/education.routes");
const { handleNovedades } = require("./modules/novedades/novedades.controller");
const { handleCalculatorRoutes } = require("./modules/calculator/calculator.routes");
const { handleModuleConfigRoutes } = require("./modules/config/module_config.routes");
const { handleClientsRoutes }      = require("./modules/config/clients/clients.routes");
const { handleNominaRoutes }       = require("./modules/nomina/nomina.routes");

const { requireAuth } = require("./modules/auth/auth.helpers");
const { handleSaveDraft } = require("./modules/employees/drafts.controller");
const { getDraftsByEmployee } = require("./modules/employees/drafts.repository");

const { withModuleProtection } = require("./http/protection");
const { readJsonBody } = require("./http/request");
const {
  sendJson,
  sendMethodNotAllowed,
  sendNotFound,
} = require("./http/response");

const { ACTIONS, MODULES } = require("./auth/permissions");
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
  ".pdf": "application/pdf",
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

  fs.createReadStream(filePath).pipe(res);
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

function tryServeUploadedDocument(req, res, url) {
  if (req.method !== "GET") {
    return false;
  }

  const UPLOAD_DIRS = {
    "/uploads/documents/": path.resolve(process.cwd(), "uploads", "documents"),
    "/uploads/novedades/":  path.resolve(process.cwd(), "uploads", "novedades"),
  };

  const matchedPrefix = Object.keys(UPLOAD_DIRS).find(p => url.pathname.startsWith(p));
  if (!matchedPrefix) return false;

  const uploadsRoot = UPLOAD_DIRS[matchedPrefix];
  const requestedFile = decodeURIComponent(url.pathname.replace(matchedPrefix, ""));
  const safeFileName  = path.basename(requestedFile);
  const filePath      = path.resolve(uploadsRoot, safeFileName);

  if (!filePath.startsWith(uploadsRoot)) {
    sendNotFound(res);
    return true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendNotFound(res);
    return true;
  }

  const ext = path.extname(safeFileName).toLowerCase();
  const mimeMap = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const contentType = mimeMap[ext] || "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Disposition": `inline; filename="${safeFileName}"`,
  });

  fs.createReadStream(filePath).pipe(res);
  return true;
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
        message: "Debes enviar el nombre del módulo",
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

const protectedModuleRoutes = [
  {
    method: "GET",
    path: "/documents",
    moduleKey: MODULES.EMPLOYEE_FILES,
    action: ACTIONS.VIEW,
    label: "Módulo de gestión documental disponible para este usuario",
  },
  {
    method: "GET",
    path: "/coverage",
    moduleKey: MODULES.COVERAGE,
    action: ACTIONS.VIEW,
    label: "Módulo de cobertura disponible para este usuario",
  },
  {
    method: "POST",
    path: "/payroll-changes",
    moduleKey: MODULES.PAYROLL,
    action: ACTIONS.REGISTER,
    label: "Registro de novedades de nómina permitido para este usuario",
  },
];

async function requestHandler(req, res) {
  const baseUrl = `http://${req.headers.host || "localhost:3000"}`;
  const url = new URL(req.url, baseUrl);

  if (tryServePublicAsset(req, res, url)) {
    return;
  }

  if (tryServeUploadedDocument(req, res, url)) {
    return;
  }

  const authHandled = await handleAuthRoutes(req, res, url);
  if (authHandled) return;

  const adminHandled = await handleAdminRoutes(req, res, url);
  if (adminHandled) return;

  const educationHandled = await handleEducationRoutes(req, res, url);
  if (educationHandled) return;

  if (req.method === "POST" && url.pathname === "/employee-drafts") {
    await withModuleProtection(
      MODULES.PERSONNEL,
      ACTIONS.CREATE,
      async (innerReq, innerRes, innerUrl, user) => {
        await handleSaveDraft(innerReq, innerRes, user);
      }
    )(req, res, url);

    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/employee-drafts/")) {
    await withModuleProtection(
      MODULES.PERSONNEL,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl) => {
        const employeeId = innerUrl.pathname.split("/")[2];
        const drafts = await getDraftsByEmployee(employeeId);

        sendJson(innerRes, 200, {
          ok: true,
          data: drafts,
        });
      }
    )(req, res, url);

    return;
  }

  const requirementsHandled = await handleRequirementRoutes(req, res, url);
  if (requirementsHandled) return;

  const coverageHandled = await handleCoverageRoutes(req, res, url);
  if (coverageHandled) return;

  if (url.pathname.startsWith("/novedades")) {
    await handleNovedades(req, res, url);
    return;
  }

  const payrollHandled = await handlePayrollRoutes(req, res, url);
  if (payrollHandled) return;

  const employeeRequestsHandled = await handleEmployeeRequestsRoutes(req, res, url);
  if (employeeRequestsHandled) return;

  const calculatorHandled = await handleCalculatorRoutes(req, res, url);
  if (calculatorHandled) return;

  const moduleConfigHandled = await handleModuleConfigRoutes(req, res, url);
  if (moduleConfigHandled) return;

  const nominaHandled = await handleNominaRoutes(req, res, url);
  if (nominaHandled) return;

  const clientsHandled = await handleClientsRoutes(req, res, url);
  if (clientsHandled) return;

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
    await withModuleProtection(
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
  requestHandler,
};

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}