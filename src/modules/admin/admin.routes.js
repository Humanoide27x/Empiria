const {
  handleAdminResetMfa,
  handleUsers,
  handleUserUpdate,
  handleAccessLogs,
} = require("./admin.controller");

async function handleAdminRoutes(req, res, url) {
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