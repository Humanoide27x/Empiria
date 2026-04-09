const { handleReports } = require("./reports.controller");

async function handleReportsRoutes(req, res, url) {
  if (url.pathname === "/reports") {
    handleReports(req, res, url);
    return true;
  }

  return false;
}

module.exports = {
  handleReportsRoutes,
};