"use strict";

const {
  handleListClients, handleCreateClient, handleUpdateClient,
  handleCreateContract, handleUpdateContract,
  handleGetContractConfig, handleUpsertContractSettings,
  handleGetSalaryConfig, handleUpsertSalaryConfig,
  handleGetContractUsers, handleCreateContractUser,
  handleUpdateContractUser, handleDeactivateContractUser,
  handleGetDashboardConfig, handleUpsertDashboardConfig,
  handleGetModuleFields, handleUpsertModuleFields,
} = require("./clients.controller");

async function handleClientsRoutes(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  // ── Clients ──────────────────────────────────────────────────────────────────
  const byId = p.match(/^\/config\/clients\/(\d+)$/);
  if (byId) { await handleUpdateClient(req, res, Number(byId[1])); return true; }

  if (p === "/config/clients") {
    if (m === "GET")  { await handleListClients(req, res);  return true; }
    if (m === "POST") { await handleCreateClient(req, res); return true; }
  }

  // ── Contracts: config & settings ─────────────────────────────────────────────
  const ctConfig = p.match(/^\/config\/contracts\/(\d+)\/config$/);
  if (ctConfig) { await handleGetContractConfig(req, res, Number(ctConfig[1])); return true; }

  const ctSettings = p.match(/^\/config\/contracts\/(\d+)\/settings$/);
  if (ctSettings) { await handleUpsertContractSettings(req, res, Number(ctSettings[1])); return true; }

  const ctSalaryCfg = p.match(/^\/config\/contracts\/(\d+)\/salary-config$/);
  if (ctSalaryCfg) {
    if (m === "GET")               { await handleGetSalaryConfig(req, res,    Number(ctSalaryCfg[1])); return true; }
    if (m === "PUT" || m === "POST") { await handleUpsertSalaryConfig(req, res, Number(ctSalaryCfg[1])); return true; }
  }

  // ── Contracts: users ──────────────────────────────────────────────────────────
  const ctUsers = p.match(/^\/config\/contracts\/(\d+)\/users$/);
  if (ctUsers) {
    if (m === "GET")  { await handleGetContractUsers(req, res, Number(ctUsers[1]));    return true; }
    if (m === "POST") { await handleCreateContractUser(req, res, Number(ctUsers[1])); return true; }
  }

  // ── Users: update / deactivate ────────────────────────────────────────────────
  const userById = p.match(/^\/config\/users\/(\d+)$/);
  if (userById) {
    if (m === "PUT" || m === "PATCH") { await handleUpdateContractUser(req, res, Number(userById[1]));   return true; }
    if (m === "DELETE")               { await handleDeactivateContractUser(req, res, Number(userById[1])); return true; }
  }

  // ── Contracts: dashboard widget config ───────────────────────────────────────
  const ctDashboard = p.match(/^\/config\/contracts\/(\d+)\/dashboard-config$/);
  if (ctDashboard) {
    if (m === "GET")               { await handleGetDashboardConfig(req, res, Number(ctDashboard[1])); return true; }
    if (m === "PUT" || m === "POST") { await handleUpsertDashboardConfig(req, res, Number(ctDashboard[1])); return true; }
  }

  // ── Contracts: module fields config ──────────────────────────────────────────
  const ctFields = p.match(/^\/config\/contracts\/(\d+)\/module-fields\/([a-z_]+)$/);
  if (ctFields) {
    if (m === "GET")               { await handleGetModuleFields(req, res, Number(ctFields[1]), ctFields[2]); return true; }
    if (m === "PUT" || m === "POST") { await handleUpsertModuleFields(req, res, Number(ctFields[1]), ctFields[2]); return true; }
  }

  // ── Contracts: basic update ───────────────────────────────────────────────────
  const ctById = p.match(/^\/config\/contracts\/(\d+)$/);
  if (ctById) { await handleUpdateContract(req, res, Number(ctById[1])); return true; }

  if (p === "/config/contracts" && m === "POST") { await handleCreateContract(req, res); return true; }

  return false;
}

module.exports = { handleClientsRoutes };
