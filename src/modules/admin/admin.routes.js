const {
  handleAdminResetMfa,
  handleUsers,
  handleUserUpdate,
  handleAccessLogs,
} = require("./admin.controller");

function lazyRoute(modulePath, exportName) {
  let mod = null;
  return async (...args) => {
    if (!mod) mod = require(modulePath);
    return mod[exportName](...args);
  };
}

const handlePositionRoutes = lazyRoute("./positions/positions.routes", "handlePositionRoutes");
const handleContractualRoutes = lazyRoute("./contractual/contractual.routes", "handleContractualRoutes");
const handleClientsRoutes = lazyRoute("../config/clients/clients.routes", "handleClientsRoutes");

async function handleAdminRoutes(req, res, url) {
  // Configuración → Clientes / Contratos / Cargos / Documentos
  if (url.pathname.startsWith("/config/")) {
    const handled = await handleClientsRoutes(req, res, url);
    if (handled) return true;
  }

  // Positions module
  if (url.pathname.startsWith("/admin/positions") ||
      url.pathname.startsWith("/admin/position-payroll-values") ||
      url.pathname.startsWith("/admin/position-document-requirements") ||
      url.pathname === "/admin/document-types") {
    const handled = await handlePositionRoutes(req, res, url);
    if (handled) return true;
  }

  if (url.pathname.startsWith("/admin/contractual")) {
    const handled = await handleContractualRoutes(req, res, url);
    if (handled) return true;
  }

  if (url.pathname === "/admin/reset-mfa") {
    handleAdminResetMfa(req, res);
    return true;
  }

  if (url.pathname === "/users") {
    handleUsers(req, res);
    return true;
  }

  if (url.pathname === "/access-logs") {
    handleAccessLogs(req, res);
    return true;
  }

  if (url.pathname === "/users/update") {
    handleUserUpdate(req, res, url);
    return true;
  }

  if (/^\/users\/\d+$/.test(url.pathname) && (req.method === "PUT" || req.method === "PATCH")) {
    handleUserUpdate(req, res, url);
    return true;
  }

  return false;
}

module.exports = { handleAdminRoutes };
