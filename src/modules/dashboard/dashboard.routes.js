const {
  handleDashboardSummary,
  handleDashboardWorkspaceSummary,
  handleDashboardKpis,
  handleDashboardAlerts,
  handleDashboardCoverageMap,
  handleDashboardRecentActivity,
  handleDashboardStaffByCargo,
  handleDashboardBirthdays,
  handleDashboardEvents,
  handleDashboardEventDelete,
} = require("./dashboard.controller");

async function handleDashboardRoutes(req, res, url) {
  const p = url.pathname;

  // Legacy endpoint (backward compat)
  if (req.method === "GET" && p === "/dashboard-summary") {
    handleDashboardSummary(req, res, url);
    return true;
  }
  if (req.method === "GET" && p === "/dashboard/summary") {
    handleDashboardWorkspaceSummary(req, res, url);
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
  if (req.method === "GET" && p === "/dashboard/birthdays") {
    handleDashboardBirthdays(req, res, url);
    return true;
  }
  if ((req.method === "GET" || req.method === "POST") && p === "/dashboard/events") {
    handleDashboardEvents(req, res, url);
    return true;
  }
  const evtMatch = p.match(/^\/dashboard\/events\/(\d+)$/);
  if (evtMatch && req.method === "DELETE") {
    handleDashboardEventDelete(req, res, url, Number(evtMatch[1]));
    return true;
  }

  return false;
}

module.exports = { handleDashboardRoutes };
