const { handlePersonnel } = require("./employees.controller");

async function handleEmployeesRoutes(req, res, url) {
  if (
    url.pathname === "/personnel" ||
    /^\/personnel\/\d+$/.test(url.pathname) ||
    /^\/personnel\/\d+\/status$/.test(url.pathname)
  ) {
    await handlePersonnel(req, res, url);
    return true;
  }

  return false;
}

module.exports = { handleEmployeesRoutes };