const {
  handleLogin,
  handleLogout,
  handleMe,
  handleRoles,
  handleMfaSetup,
  handleMfaConfirm,
} = require("./auth.controller");

async function handleAuthRoutes(req, res, url) {
  if (url.pathname === "/login") {
    await handleLogin(req, res);
    return true;
  }

  if (url.pathname === "/logout") {
    handleLogout(req, res);
    return true;
  }

  if (url.pathname === "/me") {
    handleMe(req, res);
    return true;
  }

  if (url.pathname === "/roles") {
    await handleRoles(req, res);
    return true;
  }

  if (url.pathname === "/mfa/setup") {
    await handleMfaSetup(req, res);
    return true;
  }

  if (url.pathname === "/mfa/confirm") {
    await handleMfaConfirm(req, res);
    return true;
  }

  return false;
}

module.exports = { handleAuthRoutes };