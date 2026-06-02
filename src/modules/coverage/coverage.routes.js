const {
  handleCoverageSummary,
  handleCoverageUpload,
  handleCoverageHistory,
  handleCoverageUploadRows,
  handleCoverageByContract,
  handleCoverageByMunicipality,
  handleCoverageEmployees,
  handleCoverageExclusions,
} = require("./coverage.controller");

async function handleCoverageRoutes(req, res, url) {
  const { pathname } = url;

  if (pathname === "/coverage/summary") {
    await handleCoverageSummary(req, res, url);
    return true;
  }

  if (pathname === "/coverage/upload") {
    await handleCoverageUpload(req, res, url);
    return true;
  }

  if (pathname === "/coverage/history") {
    await handleCoverageHistory(req, res, url);
    return true;
  }

  if (pathname.startsWith("/coverage/upload/")) {
    await handleCoverageUploadRows(req, res, url);
    return true;
  }

  if (pathname === "/coverage/by-contract") {
    await handleCoverageByContract(req, res, url);
    return true;
  }

  if (pathname === "/coverage/by-municipality") {
    await handleCoverageByMunicipality(req, res, url);
    return true;
  }

  if (pathname === "/coverage/employees") {
    await handleCoverageEmployees(req, res, url);
    return true;
  }

  if (pathname === "/coverage/exclusions") {
    await handleCoverageExclusions(req, res, url);
    return true;
  }

  return false;
}

module.exports = { handleCoverageRoutes };