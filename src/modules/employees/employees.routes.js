const { handlePersonnel, handleContractPositions } = require("./employees.controller");

async function handleEmployeesRoutes(req, res, url) {
  if (req.url.startsWith("/personnel")) {
    handlePersonnel(req, res);
    return true;
  }

  const posMatch = url.pathname.match(/^\/contracts\/(\d+)\/positions$/);
  if (posMatch && req.method === "GET") {
    await handleContractPositions(req, res, Number(posMatch[1]));
    return true;
  }

  return false;
}

module.exports = {
  handleEmployeesRoutes,
};