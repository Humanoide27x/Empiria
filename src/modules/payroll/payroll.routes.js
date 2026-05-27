const {
  handleNovelties,
  handleNoveltyById,
  handleNoveltyStatus,
  handlePayrollSummary,
  handleNoveltyTypes,
  handleCalculatePayroll,
  handlePayrollConfig,
  handleExportPayroll,
  handlePeriods,
  handlePeriodById,
  handlePeriodNovelties,
  handlePeriodCalculate,
  handlePeriodResults,
  handlePeriodExport,
  handlePeriodClose,
  handleMunicipalityStatus,
  handleConfirmAndSend,
  handlePaySlip,
  handleOperationalPeriods,
  handleOperationalGroups,
  handleOperationalGroupById,
  handleOperationalGroupCalculate,
  handleOperationalItemNovelties,
  handleOperationalNoveltyPatch,
  handleOperationalNoveltyReviewed,
  handleOperationalNoveltyCover,
  handleOperationalSupports,
  handleSalaryCategories,
  handleOfficialNoveltyTypes,
  handleItemPayslip,
  handleChargeAccountHtml,
  handleCambioOperativo,
  handleItemReviewed,
  handleDeleteNovelty,
  handleGroupExport,
  handleGroupClose,
  handleGroupTurns,
} = require("./payroll.controller");

async function handlePayrollRoutes(req, res, url) {
  const { pathname } = url;

  // ── Nuevas rutas (033) ──────────────────────────────────────────────────────
  if (pathname === "/payroll/salary-categories") {
    await handleSalaryCategories(req, res, url); return true;
  }
  if (pathname === "/payroll/official-novelty-types") {
    await handleOfficialNoveltyTypes(req, res, url); return true;
  }
  if (/^\/payroll\/items\/\d+\/slip$/.test(pathname)) {
    await handleItemPayslip(req, res, url); return true;
  }
  if (/^\/payroll\/items\/\d+\/reviewed$/.test(pathname)) {
    await handleItemReviewed(req, res, url); return true;
  }
  if (/^\/payroll\/items\/\d+\/cambio-operativo$/.test(pathname)) {
    await handleCambioOperativo(req, res, url); return true;
  }
  if (/^\/payroll\/turn-covers\/\d+\/charge-account$/.test(pathname)) {
    await handleChargeAccountHtml(req, res, url); return true;
  }

  if (pathname === "/payroll/periods") {
    await handleOperationalPeriods(req, res, url); return true;
  }
  if (/^\/payroll\/\d+\/groups\/\d+$/.test(pathname)) {
    await handleOperationalGroupById(req, res, url); return true;
  }
  if (/^\/payroll\/\d+\/groups$/.test(pathname)) {
    await handleOperationalGroups(req, res, url); return true;
  }
  if (/^\/payroll\/groups\/\d+\/export$/.test(pathname)) {
    await handleGroupExport(req, res, url); return true;
  }
  if (/^\/payroll\/groups\/\d+\/turns$/.test(pathname)) {
    await handleGroupTurns(req, res, url); return true;
  }
  if (/^\/payroll\/groups\/\d+\/close$/.test(pathname)) {
    await handleGroupClose(req, res, url); return true;
  }
  if (/^\/payroll\/groups\/\d+\/calculate$/.test(pathname)) {
    await handleOperationalGroupCalculate(req, res, url); return true;
  }
  if (/^\/payroll\/items\/\d+\/novelties$/.test(pathname)) {
    await handleOperationalItemNovelties(req, res, url); return true;
  }
  if (/^\/payroll\/novelties\/\d+\/reviewed$/.test(pathname)) {
    await handleOperationalNoveltyReviewed(req, res, url); return true;
  }
  if (/^\/payroll\/novelties\/\d+\/cover$/.test(pathname)) {
    await handleOperationalNoveltyCover(req, res, url); return true;
  }
  if (/^\/payroll\/novelties\/\d+$/.test(pathname) && req.method === "DELETE") {
    await handleDeleteNovelty(req, res, url); return true;
  }
  if (/^\/payroll\/novelties\/\d+$/.test(pathname) && (req.method === "PATCH" || req.method === "PUT")) {
    await handleOperationalNoveltyPatch(req, res, url); return true;
  }
  if (pathname === "/payroll/supports") {
    await handleOperationalSupports(req, res, url); return true;
  }

  // ── Rutas de períodos (más específicas primero) ─────────────────────────────
  // POST /payroll/periods/:id/calculate
  if (/^\/payroll\/periods\/\d+\/calculate$/.test(pathname)) {
    await handlePeriodCalculate(req, res, url); return true;
  }
  // GET /payroll/periods/:id/results
  if (/^\/payroll\/periods\/\d+\/results$/.test(pathname)) {
    await handlePeriodResults(req, res, url); return true;
  }
  // GET /payroll/periods/:id/export
  if (/^\/payroll\/periods\/\d+\/export$/.test(pathname)) {
    await handlePeriodExport(req, res, url); return true;
  }
  // POST /payroll/periods/:id/close
  if (/^\/payroll\/periods\/\d+\/close$/.test(pathname)) {
    await handlePeriodClose(req, res, url); return true;
  }
  // GET/POST /payroll/periods/:id/municipality-status
  if (/^\/payroll\/periods\/\d+\/municipality-status$/.test(pathname)) {
    await handleMunicipalityStatus(req, res, url); return true;
  }
  // POST /payroll/periods/:id/confirm-and-send
  if (/^\/payroll\/periods\/\d+\/confirm-and-send$/.test(pathname)) {
    await handleConfirmAndSend(req, res, url); return true;
  }
  // GET/POST /payroll/periods/:id/novelties
  if (/^\/payroll\/periods\/\d+\/novelties$/.test(pathname)) {
    await handlePeriodNovelties(req, res, url); return true;
  }
  // GET /payroll/periods/:id
  if (/^\/payroll\/periods\/\d+$/.test(pathname)) {
    await handlePeriodById(req, res, url); return true;
  }
  // GET/POST /payroll/periods
  if (pathname === "/payroll/periods") {
    await handlePeriods(req, res, url); return true;
  }

  // ── Desprendible de pago ────────────────────────────────────────────────────
  // GET /payroll/employees/:employeeId/slip
  if (/^\/payroll\/employees\/[^/]+\/slip$/.test(pathname)) {
    await handlePaySlip(req, res, url); return true;
  }

  // ── Rutas legacy ────────────────────────────────────────────────────────────
  if (pathname === "/payroll/summary") {
    await handlePayrollSummary(req, res, url); return true;
  }
  if (pathname === "/payroll/novelty-types") {
    handleNoveltyTypes(req, res); return true;
  }
  if (pathname === "/payroll/calculate") {
    await handleCalculatePayroll(req, res, url); return true;
  }
  if (pathname === "/payroll/export") {
    await handleExportPayroll(req, res, url); return true;
  }
  if (pathname === "/payroll/config") {
    await handlePayrollConfig(req, res, url); return true;
  }
  // PATCH /payroll/novelties/:id/status
  if (/^\/payroll\/novelties\/\d+\/status$/.test(pathname)) {
    await handleNoveltyStatus(req, res, url); return true;
  }
  // GET /payroll/novelties/:id
  if (/^\/payroll\/novelties\/\d+$/.test(pathname)) {
    await handleNoveltyById(req, res, url); return true;
  }
  // GET /payroll/novelties | POST /payroll/novelties
  if (pathname === "/payroll/novelties") {
    await handleNovelties(req, res, url); return true;
  }

  return false;
}

module.exports = { handlePayrollRoutes };
