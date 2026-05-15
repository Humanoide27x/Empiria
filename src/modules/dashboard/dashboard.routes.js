const {
  handleDashboardSummary,
  handleDashboardKpis,
  handleDashboardAlerts,
  handleDashboardCoverageMap,
  handleDashboardRecentActivity,
  handleDashboardStaffByCargo,
} = require("./dashboard.controller");

async function handleDashboardRoutes(req, res, url) {
  const p = url.pathname;

  // Legacy endpoint (backward compat)
  if (req.method === "GET" && p === "/dashboard-summary") {
    handleDashboardSummary(req, res, url);
    return true;
  }

  // Cockpit endpoints
  if (req.method === "GET" && p === "/dashboard/kpis") {
    handleDashboardKpis(req, res, url);
    return true;
  }
  if (req.method === "GET" && p === "/dashboard/alerts") {
    handleDashboardAlerts(req, res, url);
    return true;
  }
  if (req.method === "GET" && p === "/dashboard/coverage-map") {
    handleDashboardCoverageMap(req, res, url);
    return true;
  }
  if (req.method === "GET" && p === "/dashboard/recent-activity") {
    handleDashboardRecentActivity(req, res, url);
    return true;
  }
  if (req.method === "GET" && p === "/dashboard/staff-by-cargo") {
    handleDashboardStaffByCargo(req, res, url);
    return true;
  }

  return false;
}

module.exports = { handleDashboardRoutes };
