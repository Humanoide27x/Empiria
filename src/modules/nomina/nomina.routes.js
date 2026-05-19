"use strict";

const {
  handleGetEmployees,
  handleGetNoveltyTypes,
  handlePeriods,
  handleGetPeriod,
  handleSavePeriod,
  handleClosePeriod,
  handleExportPeriod,
} = require("./nomina.controller");

async function handleNominaRoutes(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === "/nomina/employees")      { await handleGetEmployees(req, res, url);    return true; }
  if (p === "/nomina/novelty-types")  { await handleGetNoveltyTypes(req, res);      return true; }
  if (p === "/nomina/periods")        { await handlePeriods(req, res, url);         return true; }

  const byId      = p.match(/^\/nomina\/periods\/(\d+)$/);
  const saveId    = p.match(/^\/nomina\/periods\/(\d+)\/save$/);
  const closeId   = p.match(/^\/nomina\/periods\/(\d+)\/close$/);
  const exportId  = p.match(/^\/nomina\/periods\/(\d+)\/export$/);

  if (byId)     { await handleGetPeriod(req, res, Number(byId[1]));      return true; }
  if (saveId)   { await handleSavePeriod(req, res, Number(saveId[1]));   return true; }
  if (closeId)  { await handleClosePeriod(req, res, Number(closeId[1])); return true; }
  if (exportId) { await handleExportPeriod(req, res, Number(exportId[1])); return true; }

  return false;
}

module.exports = { handleNominaRoutes };
