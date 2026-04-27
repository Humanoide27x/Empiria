const { handleGetContracts } = require("./contracts.controller");

async function handleContractsRoutes(req, res, url) {
  if (req.method === "GET" && url.pathname === "/contracts") {
    await handleGetContracts(req, res, url);
    return true;
  }

  return false;
}

module.exports = {
  handleContractsRoutes,
};
