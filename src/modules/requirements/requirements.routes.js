const { withModuleProtection } = require("../../http/protection");
const { MODULES, ACTIONS } = require("../../auth/permissions");
const { handleRequirements } = require("./requirements.controller");

function getAction(method) {
  switch (String(method || "GET").toUpperCase()) {
    case "GET":
      return ACTIONS.VIEW;
    case "POST":
      return ACTIONS.CREATE;
    case "PUT":
    case "PATCH":
      return ACTIONS.UPDATE;
    case "DELETE":
      return ACTIONS.DELETE;
    default:
      return ACTIONS.VIEW;
  }
}

function matchesRequirementsRoute(pathname) {
  return (
    pathname === "/contract-positions" ||
    /^\/contract-positions\/\d+$/.test(pathname) ||
    /^\/contract-positions\/\d+\/documents$/.test(pathname) ||
    pathname === "/document-types" ||
    /^\/personnel\/\d+\/document-requirements$/.test(pathname)
  );
}

async function handleRequirementRoutes(req, res, url) {
  const pathname = url.pathname;

  if (!matchesRequirementsRoute(pathname)) {
    return false;
  }

  const moduleKey = pathname.startsWith("/personnel/")
    ? MODULES.EMPLOYEE_FILES
    : MODULES.ADMIN_SETTINGS;

  await withModuleProtection(moduleKey, getAction(req.method), handleRequirements)(req, res, url);
  return true;
}

module.exports = { handleRequirementRoutes };
