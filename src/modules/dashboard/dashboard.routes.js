const { handleDashboardSummary } = require("./dashboard.controller");

async function handleDashboardRoutes(req, res, url) {
  if (req.method === "GET" && url.pathname === "/dashboard-summary") {
    handleDashboardSummary(req, res, url);
    return true;
  }

  return false;
}

module.exports = {
  handleDashboardRoutes,
};