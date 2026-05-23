"use strict";

const { sendJson, sendMethodNotAllowed } = require("../../../http/response");
const { readJsonBody }                   = require("../../../http/request");
const { requireAuth }                    = require("../../auth/auth.helpers");
const { refreshCache }                   = require("../../../data/users");
const {
  listClients, createClient, updateClient,
  createContract, updateContract,
  getContractConfig, upsertContractSettings,
  getSalaryConfig, upsertSalaryConfigOnly,
  getContractUsers, createContractUser, updateContractUser,
  getAllMunicipalities, getUserMunicipalities, setUserMunicipalities,
  getContractMunicipalityAssignments,
} = require("./clients.repository");

const {
  WIDGET_CATALOG,
  MODULO_FIELDS_CATALOG,
  getDashboardConfig,
  upsertDashboardConfig,
  getModuleFieldsConfig,
  upsertModuleFieldsConfig,
} = require("../module_config.repository");

function guardAdmin(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  const user = auth.user;
  if (String(user.role || "").toLowerCase() !== "administrador") {
    sendJson(res, 403, { ok: false, message: "Solo administradores pueden gestionar clientes" });
    return null;
  }
  // Contract-scoped admins (tied to a specific company/contract) cannot access global config
  if (user.companyId || user.contractId) {
    sendJson(res, 403, { ok: false, message: "Acceso no autorizado" });
    return null;
  }
  return user;
}

function guardAdminOrHR(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  const role = String(auth.user.role || "").toLowerCase();
  const allowed = ["administrador", "talento_humano"];
  if (!allowed.includes(role)) {
    sendJson(res, 403, { ok: false, message: "Sin permisos para configurar la calculadora" });
    return null;
  }
  return auth.user;
}

async function handleGetSalaryConfig(req, res, id) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  if (!requireAuth(req, res)) return;
  const data = await getSalaryConfig(id);
  sendJson(res, 200, { ok: true, data });
}

async function handleUpsertSalaryConfig(req, res, id) {
  if (req.method !== "PUT" && req.method !== "POST") { sendMethodNotAllowed(res); return; }
  if (!guardAdminOrHR(req, res)) return;
  const body = await readJsonBody(req);
  if (!body.salary_config || typeof body.salary_config !== "object") {
    sendJson(res, 400, { ok: false, message: "salary_config es requerido" }); return;
  }
  const data = await upsertSalaryConfigOnly(id, body.salary_config);
  sendJson(res, 200, { ok: true, data });
}

// ── Clients ───────────────────────────────────────────────────────────────────

async function handleListClients(req, res) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const clients = await listClients();
  sendJson(res, 200, { ok: true, data: clients });
}

async function handleCreateClient(req, res) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const body = await readJsonBody(req);
  if (!body.name?.trim()) {
    sendJson(res, 400, { ok: false, message: "El nombre de la empresa es requerido" });
    return;
  }
  const client = await createClient({ name: body.name, nit: body.nit || null });
  sendJson(res, 201, { ok: true, data: client });
}

async function handleUpdateClient(req, res, id) {
  if (req.method !== "PUT" && req.method !== "PATCH") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const body    = await readJsonBody(req);
  const updated = await updateClient(id, body);
  if (!updated) { sendJson(res, 404, { ok: false, message: "Cliente no encontrado" }); return; }
  sendJson(res, 200, { ok: true, data: updated });
}

// ── Contracts ─────────────────────────────────────────────────────────────────

async function handleCreateContract(req, res) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const body = await readJsonBody(req);
  if (!body.company_id || !body.name?.trim()) {
    sendJson(res, 400, { ok: false, message: "company_id y name son requeridos" });
    return;
  }
  const contract = await createContract({
    company_id: Number(body.company_id),
    name:       body.name,
    code:       body.code || null,
    start_date: body.start_date || null,
    end_date:   body.end_date   || null,
  });
  sendJson(res, 201, { ok: true, data: contract });
}

async function handleUpdateContract(req, res, id) {
  if (req.method !== "PUT" && req.method !== "PATCH") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const body    = await readJsonBody(req);
  const updated = await updateContract(id, body);
  if (!updated) { sendJson(res, 404, { ok: false, message: "Contrato no encontrado" }); return; }
  sendJson(res, 200, { ok: true, data: updated });
}

async function handleGetContractConfig(req, res, id) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const config = await getContractConfig(id);
  if (!config) { sendJson(res, 404, { ok: false, message: "Contrato no encontrado" }); return; }
  sendJson(res, 200, { ok: true, data: config });
}

async function handleUpsertContractSettings(req, res, id) {
  if (req.method !== "PUT" && req.method !== "POST") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const body     = await readJsonBody(req);
  const settings = await upsertContractSettings(id, {
    position_mode:    body.position_mode || "licitacion",
    modules:          body.modules       || {},
    positions:        Array.isArray(body.positions) ? body.positions : [],
    role_permissions: (body.role_permissions && typeof body.role_permissions === "object") ? body.role_permissions : {},
    salary_config:    (body.salary_config  && typeof body.salary_config  === "object") ? body.salary_config  : null,
  });
  sendJson(res, 200, { ok: true, data: settings });
}

// ── Contract users ─────────────────────────────────────────────────────────────

async function handleGetContractUsers(req, res, id) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const users = await getContractUsers(id);
  sendJson(res, 200, { ok: true, data: users });
}

async function handleCreateContractUser(req, res, id) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const body = await readJsonBody(req);
  if (!body.name?.trim() || !body.username?.trim() || !body.password || !body.role) {
    sendJson(res, 400, { ok: false, message: "name, username, password y role son requeridos" });
    return;
  }
  try {
    const user = await createContractUser(id, body);
    sendJson(res, 201, { ok: true, data: user });
  } catch (err) {
    sendJson(res, 400, { ok: false, message: err.message });
  }
}

async function handleUpdateContractUser(req, res, userId) {
  if (req.method !== "PUT" && req.method !== "PATCH") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const body    = await readJsonBody(req);
  const updated = await updateContractUser(userId, body);
  if (!updated) { sendJson(res, 404, { ok: false, message: "Usuario no encontrado" }); return; }
  sendJson(res, 200, { ok: true, data: updated });
}

async function handleDeactivateContractUser(req, res, userId) {
  if (req.method !== "DELETE") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const updated = await updateContractUser(userId, { active: false });
  if (!updated) { sendJson(res, 404, { ok: false, message: "Usuario no encontrado" }); return; }
  sendJson(res, 200, { ok: true, data: updated });
}

// ── Dashboard widget config ───────────────────────────────────────────────────

async function handleGetDashboardConfig(req, res, id) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const data = await getDashboardConfig(id);
  sendJson(res, 200, { ok: true, data, catalog: WIDGET_CATALOG });
}

async function handleUpsertDashboardConfig(req, res, id) {
  if (req.method !== "PUT" && req.method !== "POST") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const body = await readJsonBody(req);
  if (!Array.isArray(body.widgets)) {
    sendJson(res, 400, { ok: false, message: "widgets debe ser un array" });
    return;
  }
  const data = await upsertDashboardConfig(id, body.widgets);
  sendJson(res, 200, { ok: true, data });
}

// ── Module fields config ──────────────────────────────────────────────────────

async function handleGetModuleFields(req, res, id, slug) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const data    = await getModuleFieldsConfig(id, slug);
  const catalog = MODULO_FIELDS_CATALOG[slug] || [];
  sendJson(res, 200, { ok: true, data, catalog });
}

async function handleUpsertModuleFields(req, res, id, slug) {
  if (req.method !== "PUT" && req.method !== "POST") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  if (!MODULO_FIELDS_CATALOG[slug]) {
    sendJson(res, 400, { ok: false, message: `Módulo '${slug}' no existe en el catálogo` });
    return;
  }
  const body = await readJsonBody(req);
  if (!Array.isArray(body.campos)) {
    sendJson(res, 400, { ok: false, message: "campos debe ser un array" });
    return;
  }
  const data = await upsertModuleFieldsConfig(id, slug, body.campos);
  sendJson(res, 200, { ok: true, data });
}

// ── Municipalities ────────────────────────────────────────────────────────────

async function handleGetContractMunicipalityAssignments(req, res, contractId) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const data = await getContractMunicipalityAssignments(contractId);
  sendJson(res, 200, { ok: true, data });
}

async function handleGetAllMunicipalities(req, res) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  if (!requireAuth(req, res)) return;
  const data = await getAllMunicipalities();
  sendJson(res, 200, { ok: true, data });
}

async function handleGetUserMunicipalities(req, res, userId) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const ids = await getUserMunicipalities(userId);
  if (ids === null) { sendJson(res, 404, { ok: false, message: "Usuario no encontrado" }); return; }
  sendJson(res, 200, { ok: true, data: ids });
}

async function handleSetUserMunicipalities(req, res, userId) {
  if (req.method !== "PUT" && req.method !== "POST") { sendMethodNotAllowed(res); return; }
  if (!guardAdmin(req, res)) return;
  const body    = await readJsonBody(req);
  if (!Array.isArray(body.municipality_ids)) {
    sendJson(res, 400, { ok: false, message: "municipality_ids debe ser un array" }); return;
  }
  const updated = await setUserMunicipalities(userId, body.municipality_ids);
  if (!updated) { sendJson(res, 404, { ok: false, message: "Usuario no encontrado" }); return; }
  refreshCache().catch(() => {});
  sendJson(res, 200, { ok: true, data: updated });
}

module.exports = {
  handleListClients, handleCreateClient, handleUpdateClient,
  handleCreateContract, handleUpdateContract,
  handleGetContractConfig, handleUpsertContractSettings,
  handleGetSalaryConfig, handleUpsertSalaryConfig,
  handleGetContractUsers, handleCreateContractUser,
  handleUpdateContractUser, handleDeactivateContractUser,
  handleGetDashboardConfig, handleUpsertDashboardConfig,
  handleGetModuleFields, handleUpsertModuleFields,
  handleGetContractMunicipalityAssignments,
  handleGetAllMunicipalities, handleGetUserMunicipalities, handleSetUserMunicipalities,
};
