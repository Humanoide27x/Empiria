"use strict";

const { withModuleProtection }          = require("../../http/protection");
const { MODULES, ACTIONS }              = require("../../auth/permissions");
const { handleCalculate, handleAuditLog } = require("./calculator.controller");

async function handleCalculatorRoutes(req, res, url) {
  const p = url.pathname;

  if (p === "/calculator/calculate") {
    await withModuleProtection(
      MODULES.CALCULATOR,
      ACTIONS.CREATE,
      async (r, rs, u, user) => handleCalculate(r, rs, u, user)
    )(req, res, url);
    return true;
  }

  if (p === "/calculator/audit") {
    await withModuleProtection(
      MODULES.CALCULATOR,
      ACTIONS.VIEW,
      async (r, rs, u, user) => handleAuditLog(r, rs, u, user)
    )(req, res, url);
    return true;
  }

  return false;
}

module.exports = { handleCalculatorRoutes };
