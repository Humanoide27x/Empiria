const { handleGetCompanies } = require("./companies.controller");

async function handleCompaniesRoutes(req, res, url) {
  if (req.method === "GET" && url.pathname === "/companies") {
    await handleGetCompanies(req, res);
    return true;
  }

  return false;
}

module.exports = {
  handleCompaniesRoutes,
};