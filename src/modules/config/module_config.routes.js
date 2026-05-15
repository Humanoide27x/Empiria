"use strict";

const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { requireAuth } = require("../auth/auth.helpers");
const {
  getDashboardConfig,
  getModuleFieldsConfig,
} = require("./module_config.repository");

function resolveContractId(user) {
  return user?.contractId ?? user?.contract_id ?? null;
}

async function handleModuleConfigRoutes(req, res, url) {
  const p = url.pathname;

  // GET /module-config/dashboard
  if (p === "/module-config/dashboard" && req.method === "GET") {
    const auth = requireAuth(req, res);
    if (!auth) return true;
    const contractId = resolveContractId(auth.user);
    const data = await getDashboardConfig(contractId);
    sendJson(res, 200, { ok: true, data });
    return true;
  }

  // GET /module-config/fields/:slug
  const fieldsMatch = p.match(/^\/module-config\/fields\/([a-z_]+)$/);
  if (fieldsMatch && req.method === "GET") {
    const auth = requireAuth(req, res);
    if (!auth) return true;
    const contractId = resolveContractId(auth.user);
    const slug       = fieldsMatch[1];
    const data       = await getModuleFieldsConfig(contractId, slug);
    sendJson(res, 200, { ok: true, data });
    return true;
  }

  return false;
}

module.exports = { handleModuleConfigRoutes };
