const { handleGetContracts, handleGetContractPositions } = require("./contracts.controller");

async function handleContractsRoutes(req, res, url) {
  const p = url.pathname;

  const posMatch = p.match(/^\/contracts\/(\d+)\/positions$/);
  if (posMatch && req.method === "GET") {
    await handleGetContractPositions(req, res, Number(posMatch[1]));
    return true;
  }

  if (req.method === "GET" && p === "/contracts") {
    await handleGetContracts(req, res, url);
    return true;
  }

  return false;
}

module.exports = {
  handleContractsRoutes,
};
