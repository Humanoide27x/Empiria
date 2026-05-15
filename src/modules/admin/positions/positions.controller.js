"use strict";

const { sendJson, sendMethodNotAllowed } = require("../../../http/response");
const { readJsonBody } = require("../../../http/request");
const { requireAuth }  = require("../../auth/auth.helpers");
const {
  listPositions,
  getPositionById,
  createPosition,
  updatePosition,
  setPositionStatus,
  getProfile,
  upsertProfile,
  listPayrollValues,
  getPayrollValueById,
  createPayrollValue,
  updatePayrollValue,
  setPayrollValueStatus,
  listDocumentRequirements,
  upsertDocumentRequirement,
  removeDocumentRequirement,
  listDocumentTypes,
  VALID_CATEGORIES,
  VALID_SALARY_TYPES,
} = require("./positions.repository");

// ─────────────────────────────────────────────
// Auth helpers (manual — no withModuleProtection
// para evitar cambios en permissions.js)
// ─────────────────────────────────────────────

function getUser(req, res) {
  const auth = requireAuth(req, res);
  return auth ? auth.user : null;
}

function isAdmin(user) {
  return String(user?.role || "").toLowerCase() === "administrador";
}

function canView(user) {
  const r = String(user?.role || "").toLowerCase();
  return r === "administrador" || r === "talento_humano";
}

function guardView(req, res) {
  const user = getUser(req, res);
  if (!user) return null;
  if (!canView(user)) {
    sendJson(res, 403, { ok: false, message: "Acceso denegado a configuración de cargos" });
    return null;
  }
  return user;
}

function guardAdmin(req, res) {
  const user = getUser(req, res);
  if (!user) return null;
  if (!isAdmin(user)) {
    sendJson(res, 403, { ok: false, message: "Solo el Administrador puede realizar esta acción" });
    return null;
  }
  return user;
}

function parseId(pathname, prefix) {
  const seg = String(pathname || "").slice(prefix.length).split("/")[0];
  const n = parseInt(seg, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ─────────────────────────────────────────────
// GET  /admin/positions
// POST /admin/positions
// ─────────────────────────────────────────────

async function handlePositions(req, res, url) {
  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;
    try {
      const filters = {
        companyId:  url.searchParams.get("companyId")  || url.searchParams.get("company_id"),
        contractId: url.searchParams.get("contractId") || url.searchParams.get("contract_id"),
        area:       url.searchParams.get("area"),
        category:   url.searchParams.get("category"),
        search:     url.searchParams.get("search"),
      };
      const activeParam = url.searchParams.get("active");
      if (activeParam !== null) filters.active = activeParam !== "false" && activeParam !== "0";

      const data = await listPositions(filters);
      sendJson(res, 200, { ok: true, data, total: data.length });
    } catch (err) {
      sendJson(res, 500, { ok: false, message: err.message });
    }
    return;
  }

  if (req.method === "POST") {
    const user = guardAdmin(req, res);
    if (!user) return;
    try {
      const body = await readJsonBody(req);
      const position = await createPosition(body, user.id);
      sendJson(res, 201, { ok: true, data: position, message: "Cargo creado correctamente" });
    } catch (err) {
      sendJson(res, 400, { ok: false, message: err.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

// ─────────────────────────────────────────────
// GET /admin/positions/:id
// PUT /admin/positions/:id
// ─────────────────────────────────────────────

async function handlePositionById(req, res, url) {
  const id = parseId(url.pathname, "/admin/positions/");
  if (!id) { sendJson(res, 400, { ok: false, message: "ID de cargo inválido" }); return; }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;
    try {
      const data = await getPositionById(id);
      if (!data) { sendJson(res, 404, { ok: false, message: "Cargo no encontrado" }); return; }
      sendJson(res, 200, { ok: true, data });
    } catch (err) {
      sendJson(res, 500, { ok: false, message: err.message });
    }
    return;
  }

  if (req.method === "PUT" || req.method === "PATCH") {
    const user = guardAdmin(req, res);
    if (!user) return;
    try {
      const body = await readJsonBody(req);
      const data = await updatePosition(id, body);
      sendJson(res, 200, { ok: true, data, message: "Cargo actualizado" });
    } catch (err) {
      sendJson(res, 400, { ok: false, message: err.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

// ─────────────────────────────────────────────
// PATCH /admin/positions/:id/status
// ─────────────────────────────────────────────

async function handlePositionStatus(req, res, url) {
  if (req.method !== "PATCH" && req.method !== "PUT") { sendMethodNotAllowed(res); return; }
  const id = parseId(url.pathname, "/admin/positions/");
  if (!id) { sendJson(res, 400, { ok: false, message: "ID inválido" }); return; }
  const user = guardAdmin(req, res);
  if (!user) return;
  try {
    const body = await readJsonBody(req);
    if (typeof body.active !== "boolean" && body.active === undefined) {
      sendJson(res, 400, { ok: false, message: "Debes enviar 'active': true/false" }); return;
    }
    const active = body.active === true || body.active === "true" || body.active === 1;
    const data = await setPositionStatus(id, active);
    sendJson(res, 200, {
      ok: true, data,
      message: active ? "Cargo activado" : "Cargo inactivado",
    });
  } catch (err) {
    sendJson(res, 400, { ok: false, message: err.message });
  }
}

// ─────────────────────────────────────────────
// GET /admin/positions/:id/profile
// PUT /admin/positions/:id/profile
// ─────────────────────────────────────────────

async function handlePositionProfile(req, res, url) {
  const id = parseId(url.pathname, "/admin/positions/");
  if (!id) { sendJson(res, 400, { ok: false, message: "ID inválido" }); return; }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;
    try {
      const data = await getProfile(id);
      sendJson(res, 200, { ok: true, data });
    } catch (err) {
      sendJson(res, 500, { ok: false, message: err.message });
    }
    return;
  }

  if (req.method === "PUT" || req.method === "PATCH") {
    const user = guardAdmin(req, res);
    if (!user) return;
    try {
      const body = await readJsonBody(req);
      const data = await upsertProfile(id, body);
      sendJson(res, 200, { ok: true, data, message: "Perfil actualizado" });
    } catch (err) {
      sendJson(res, 400, { ok: false, message: err.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

// ─────────────────────────────────────────────
// GET  /admin/positions/:id/payroll-values
// POST /admin/positions/:id/payroll-values
// ─────────────────────────────────────────────

async function handlePositionPayrollValues(req, res, url) {
  const id = parseId(url.pathname, "/admin/positions/");
  if (!id) { sendJson(res, 400, { ok: false, message: "ID inválido" }); return; }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;
    try {
      const data = await listPayrollValues(id);
      sendJson(res, 200, { ok: true, data });
    } catch (err) {
      sendJson(res, 500, { ok: false, message: err.message });
    }
    return;
  }

  if (req.method === "POST") {
    const user = guardAdmin(req, res);
    if (!user) return;
    try {
      const body = await readJsonBody(req);
      const data = await createPayrollValue(id, body, user.id);
      sendJson(res, 201, { ok: true, data, message: "Valor de nómina creado" });
    } catch (err) {
      sendJson(res, 400, { ok: false, message: err.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

// ─────────────────────────────────────────────
// PUT   /admin/position-payroll-values/:id
// PATCH /admin/position-payroll-values/:id/status
// ─────────────────────────────────────────────

async function handlePayrollValueById(req, res, url) {
  const id = parseId(url.pathname, "/admin/position-payroll-values/");
  if (!id) { sendJson(res, 400, { ok: false, message: "ID inválido" }); return; }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;
    try {
      const data = await getPayrollValueById(id);
      if (!data) { sendJson(res, 404, { ok: false, message: "No encontrado" }); return; }
      sendJson(res, 200, { ok: true, data });
    } catch (err) {
      sendJson(res, 500, { ok: false, message: err.message });
    }
    return;
  }

  if (req.method === "PUT" || req.method === "PATCH") {
    // Check if it's a status update
    if (url.pathname.endsWith("/status")) {
      const user = guardAdmin(req, res);
      if (!user) return;
      try {
        const body = await readJsonBody(req);
        const active = body.active === true || body.active === "true" || body.active === 1;
        const data = await setPayrollValueStatus(id, active);
        sendJson(res, 200, { ok: true, data, message: active ? "Activado" : "Inactivado" });
      } catch (err) {
        sendJson(res, 400, { ok: false, message: err.message });
      }
      return;
    }

    const user = guardAdmin(req, res);
    if (!user) return;
    try {
      const body = await readJsonBody(req);
      const data = await updatePayrollValue(id, body);
      sendJson(res, 200, { ok: true, data, message: "Valor de nómina actualizado" });
    } catch (err) {
      sendJson(res, 400, { ok: false, message: err.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

// ─────────────────────────────────────────────
// GET  /admin/positions/:id/document-requirements
// POST /admin/positions/:id/document-requirements
// ─────────────────────────────────────────────

async function handleDocumentRequirements(req, res, url) {
  const id = parseId(url.pathname, "/admin/positions/");
  if (!id) { sendJson(res, 400, { ok: false, message: "ID inválido" }); return; }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;
    try {
      const data = await listDocumentRequirements(id);
      sendJson(res, 200, { ok: true, data });
    } catch (err) {
      sendJson(res, 500, { ok: false, message: err.message });
    }
    return;
  }

  if (req.method === "POST") {
    const user = guardAdmin(req, res);
    if (!user) return;
    try {
      const body = await readJsonBody(req);
      const data = await upsertDocumentRequirement(id, body.documentTypeId || body.document_type_id, body);
      sendJson(res, 200, { ok: true, data, message: "Requisito documental guardado" });
    } catch (err) {
      sendJson(res, 400, { ok: false, message: err.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

// ─────────────────────────────────────────────
// DELETE /admin/position-document-requirements/:id
// ─────────────────────────────────────────────

async function handleDeleteDocumentRequirement(req, res, url) {
  if (req.method !== "DELETE") { sendMethodNotAllowed(res); return; }
  const id = parseId(url.pathname, "/admin/position-document-requirements/");
  if (!id) { sendJson(res, 400, { ok: false, message: "ID inválido" }); return; }
  const user = guardAdmin(req, res);
  if (!user) return;
  try {
    const data = await removeDocumentRequirement(id);
    sendJson(res, 200, { ok: true, data, message: "Requisito eliminado" });
  } catch (err) {
    sendJson(res, 400, { ok: false, message: err.message });
  }
}

// GET /admin/document-types
async function handleDocumentTypes(req, res) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  const user = guardView(req, res);
  if (!user) return;
  try {
    const data = await listDocumentTypes();
    sendJson(res, 200, { ok: true, data });
  } catch (err) {
    sendJson(res, 500, { ok: false, message: err.message });
  }
}

// GET /admin/positions/meta — catálogos (para selects del frontend)
function handlePositionsMeta(req, res) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  const user = guardView(req, res);
  if (!user) return;
  sendJson(res, 200, {
    ok: true,
    categories:   VALID_CATEGORIES,
    salaryTypes:  VALID_SALARY_TYPES,
  });
}

module.exports = {
  handlePositions,
  handlePositionById,
  handlePositionStatus,
  handlePositionProfile,
  handlePositionPayrollValues,
  handlePayrollValueById,
  handleDocumentRequirements,
  handleDeleteDocumentRequirement,
  handleDocumentTypes,
  handlePositionsMeta,
};
