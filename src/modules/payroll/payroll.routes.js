const {
  handleNovelties,
  handleNoveltyById,
  handleNoveltyStatus,
  handlePayrollSummary,
  handleNoveltyTypes,
} = require("./payroll.controller");

async function handlePayrollRoutes(req, res, url) {
  const { pathname } = url;

  if (pathname === "/payroll/summary") {
    await handlePayrollSummary(req, res, url);
    return true;
  }

  if (pathname === "/payroll/novelty-types") {
    handleNoveltyTypes(req, res);
    return true;
  }

  // PATCH /payroll/novelties/:id/status
  if (/^\/payroll\/novelties\/\d+\/status$/.test(pathname)) {
    await handleNoveltyStatus(req, res, url);
    return true;
  }

  // GET /payroll/novelties/:id
  if (/^\/payroll\/novelties\/\d+$/.test(pathname)) {
    await handleNoveltyById(req, res, url);
    return true;
  }

  // GET /payroll/novelties  |  POST /payroll/novelties
  if (pathname === "/payroll/novelties") {
    await handleNovelties(req, res, url);
    return true;
  }

  return false;
}

module.exports = { handlePayrollRoutes };
