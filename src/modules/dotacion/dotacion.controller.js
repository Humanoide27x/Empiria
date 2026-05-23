const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { readJsonBody } = require("../../http/request");
const { withModuleProtection } = require("../../http/protection");
const { ACTIONS, MODULES } = require("../../auth/permissions");

const {
  getCatalogo,
  createCatalogoItem,
  updateCatalogoItem,
  getStock,
  upsertStock,
  adjustStock,
  getAsignaciones,
  getAsignacionById,
  createAsignacion,
  updateAsignacion,
  deleteAsignacion,
  getRemisiones,
  getRemisionById,
  createRemision,
  updateRemision,
  deleteRemision,
  getAsignacionesParaImportar,
  getMunicipiosConEmpleados,
  getInstitucionesByMunicipio,
  getSedesByInstitucion,
  getModalidadesDisponibles,
  getEmpleadasParaRemision,
  marcarEnviadoRecibido,
  getComprobante,
} = require("../../db/dotacion.repository");

// ── Catálogo ──────────────────────────────────────────────────────────────────

async function handleCatalogoList(req, res, url) {
  return withModuleProtection(MODULES.DOTACION, ACTIONS.VIEW, async (req, res, url, user, resource) => {
    const includeInactive = url.searchParams.get("includeInactive") === "true";
    const data = await getCatalogo({
      companyId: resource.companyId,
      contractId: resource.contractId,
      includeInactive,
    });
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

async function handleCatalogoCreate(req, res, url) {
  if (req.method !== "POST") return sendMethodNotAllowed(res);
  return withModuleProtection(MODULES.DOTACION, ACTIONS.CREATE, async (req, res, url, user, resource) => {
    const body = await readJsonBody(req);
    if (!body.nombre) {
      sendJson(res, 400, { ok: false, message: "El nombre del artículo es requerido" });
      return;
    }
    const data = await createCatalogoItem({ ...body, company_id: resource.companyId, contract_id: resource.contractId });
    sendJson(res, 201, { ok: true, data });
  })(req, res, url);
}

async function handleCatalogoUpdate(req, res, url, id) {
  if (req.method !== "PUT") return sendMethodNotAllowed(res);
  return withModuleProtection(MODULES.DOTACION, ACTIONS.UPDATE, async (req, res, url, user, resource) => {
    const body = await readJsonBody(req);
    const data = await updateCatalogoItem(id, body);
    if (!data) {
      sendJson(res, 404, { ok: false, message: "Artículo no encontrado" });
      return;
    }
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

// ── Stock ─────────────────────────────────────────────────────────────────────

async function handleStockList(req, res, url) {
  return withModuleProtection(MODULES.DOTACION, ACTIONS.VIEW, async (req, res, url, user, resource) => {
    const catalogoId = url.searchParams.get("catalogoId") ? Number(url.searchParams.get("catalogoId")) : null;
    const data = await getStock({
      companyId: resource.companyId,
      contractId: resource.contractId,
      catalogoId,
    });
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

async function handleStockUpsert(req, res, url) {
  if (req.method !== "POST") return sendMethodNotAllowed(res);
  return withModuleProtection(MODULES.DOTACION, ACTIONS.UPDATE, async (req, res, url, user, resource) => {
    const body = await readJsonBody(req);
    if (!body.catalogo_id) {
      sendJson(res, 400, { ok: false, message: "catalogo_id es requerido" });
      return;
    }
    const data = await upsertStock({ ...body, company_id: resource.companyId, contract_id: resource.contractId });
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

async function handleStockAdjust(req, res, url, id) {
  if (req.method !== "PATCH") return sendMethodNotAllowed(res);
  return withModuleProtection(MODULES.DOTACION, ACTIONS.UPDATE, async (req, res, url, user, resource) => {
    const body = await readJsonBody(req);
    const delta = Number(body.delta);
    if (!Number.isFinite(delta)) {
      sendJson(res, 400, { ok: false, message: "delta debe ser un número" });
      return;
    }
    const data = await adjustStock(id, delta);
    if (!data) {
      sendJson(res, 404, { ok: false, message: "Registro de stock no encontrado" });
      return;
    }
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

// ── Asignaciones ──────────────────────────────────────────────────────────────

async function handleAsignacionesList(req, res, url) {
  return withModuleProtection(MODULES.DOTACION, ACTIONS.VIEW, async (req, res, url, user, resource) => {
    const employeeId = url.searchParams.get("employeeId") ? Number(url.searchParams.get("employeeId")) : null;
    const estado = url.searchParams.get("estado") || null;
    const catalogoId = url.searchParams.get("catalogoId") ? Number(url.searchParams.get("catalogoId")) : null;
    const data = await getAsignaciones({
      companyId: resource.companyId,
      contractId: resource.contractId,
      employeeId,
      estado,
      catalogoId,
    });
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

async function handleAsignacionCreate(req, res, url) {
  if (req.method !== "POST") return sendMethodNotAllowed(res);
  return withModuleProtection(MODULES.DOTACION, ACTIONS.CREATE, async (req, res, url, user, resource) => {
    const body = await readJsonBody(req);
    if (!body.employee_id || !body.catalogo_id) {
      sendJson(res, 400, { ok: false, message: "employee_id y catalogo_id son requeridos" });
      return;
    }
    const data = await createAsignacion({
      ...body,
      company_id: resource.companyId,
      contract_id: resource.contractId,
      created_by: user?.id || null,
    });
    sendJson(res, 201, { ok: true, data });
  })(req, res, url);
}

async function handleAsignacionUpdate(req, res, url, id) {
  if (req.method !== "PUT") return sendMethodNotAllowed(res);
  return withModuleProtection(MODULES.DOTACION, ACTIONS.UPDATE, async (req, res, url, user, resource) => {
    const body = await readJsonBody(req);
    const data = await updateAsignacion(id, body);
    if (!data) {
      sendJson(res, 404, { ok: false, message: "Asignación no encontrada" });
      return;
    }
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

async function handleAsignacionDelete(req, res, url, id) {
  if (req.method !== "DELETE") return sendMethodNotAllowed(res);
  return withModuleProtection(MODULES.DOTACION, ACTIONS.DELETE, async (req, res, url, user, resource) => {
    const data = await deleteAsignacion(id);
    if (!data) {
      sendJson(res, 404, { ok: false, message: "Asignación no encontrada" });
      return;
    }
    sendJson(res, 200, { ok: true, message: "Asignación eliminada" });
  })(req, res, url);
}

async function handleAsignacionEvidencia(req, res, url, id) {
  if (req.method !== "GET") return sendMethodNotAllowed(res);
  return withModuleProtection(MODULES.DOTACION, ACTIONS.VIEW, async (req, res, url, user, resource) => {
    const row = await getAsignacionById(id);
    if (!row) {
      sendJson(res, 404, { ok: false, message: "Asignación no encontrada" });
      return;
    }
    sendJson(res, 200, { ok: true, evidencia: row.evidencia || null });
  })(req, res, url);
}

// ── Remisiones ────────────────────────────────────────────────────────────────

async function handleRemisionesList(req, res, url) {
  return withModuleProtection(MODULES.DOTACION, ACTIONS.VIEW, async (req, res, url, user, resource) => {
    const estado = url.searchParams.get("estado") || null;
    const data = await getRemisiones({ companyId: resource.companyId, contractId: resource.contractId, estado });
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

async function handleRemisionGet(req, res, url, id) {
  return withModuleProtection(MODULES.DOTACION, ACTIONS.VIEW, async (req, res, url, user, resource) => {
    const data = await getRemisionById(id);
    if (!data) { sendJson(res, 404, { ok: false, message: "Remisión no encontrada" }); return; }
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

async function handleRemisionCreate(req, res, url) {
  if (req.method !== "POST") return sendMethodNotAllowed(res);
  return withModuleProtection(MODULES.DOTACION, ACTIONS.CREATE, async (req, res, url, user, resource) => {
    const body = await readJsonBody(req);
    if (!body.numero || !body.fecha_envio) {
      sendJson(res, 400, { ok: false, message: "numero y fecha_envio son requeridos" });
      return;
    }
    const data = await createRemision(
      { ...body, company_id: resource.companyId, contract_id: resource.contractId, created_by: user?.id || null },
      body.items || []
    );
    sendJson(res, 201, { ok: true, data });
  })(req, res, url);
}

async function handleRemisionUpdate(req, res, url, id) {
  if (req.method !== "PUT") return sendMethodNotAllowed(res);
  return withModuleProtection(MODULES.DOTACION, ACTIONS.UPDATE, async (req, res, url, user, resource) => {
    const body = await readJsonBody(req);
    const data = await updateRemision(id, body, body.items);
    if (!data) { sendJson(res, 404, { ok: false, message: "Remisión no encontrada" }); return; }
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

async function handleRemisionDelete(req, res, url, id) {
  if (req.method !== "DELETE") return sendMethodNotAllowed(res);
  return withModuleProtection(MODULES.DOTACION, ACTIONS.DELETE, async (req, res, url, user, resource) => {
    const data = await deleteRemision(id);
    if (!data) { sendJson(res, 404, { ok: false, message: "Remisión no encontrada" }); return; }
    sendJson(res, 200, { ok: true, message: "Remisión eliminada" });
  })(req, res, url);
}

async function handleRemisionFoto(req, res, url, id) {
  if (req.method !== "PATCH") return sendMethodNotAllowed(res);
  return withModuleProtection(MODULES.DOTACION, ACTIONS.UPDATE, async (req, res, url, user, resource) => {
    const body = await readJsonBody(req);
    if (!body.foto_remision) { sendJson(res, 400, { ok: false, message: "foto_remision es requerida" }); return; }
    const data = await updateRemision(id, { foto_remision: body.foto_remision }, undefined);
    if (!data) { sendJson(res, 404, { ok: false, message: "Remisión no encontrada" }); return; }
    sendJson(res, 200, { ok: true, message: "Foto guardada" });
  })(req, res, url);
}

async function handleImportarAsignaciones(req, res, url) {
  return withModuleProtection(MODULES.DOTACION, ACTIONS.VIEW, async (req, res, url, user, resource) => {
    const modalidad = url.searchParams.get("modalidad") || null;
    const data = await getAsignacionesParaImportar({
      companyId: resource.companyId,
      contractId: resource.contractId,
      modalidad,
    });
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

async function handleFiltrosMunicipios(req, res, url) {
  return withModuleProtection(MODULES.DOTACION, ACTIONS.VIEW, async (req, res, url, user, resource) => {
    const data = await getMunicipiosConEmpleados({
      companyId: resource.companyId,
      contractId: resource.contractId,
      municipalityIds: resource.municipalityIds || null,
    });
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

async function handleFiltrosInstituciones(req, res, url) {
  return withModuleProtection(MODULES.DOTACION, ACTIONS.VIEW, async (req, res, url, user, resource) => {
    const municipioId = Number(url.searchParams.get("municipioId"));
    if (!municipioId) { sendJson(res, 400, { ok: false, message: "municipioId requerido" }); return; }
    const data = await getInstitucionesByMunicipio(municipioId, { companyId: resource.companyId, contractId: resource.contractId });
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

async function handleFiltrosSedes(req, res, url) {
  return withModuleProtection(MODULES.DOTACION, ACTIONS.VIEW, async (req, res, url, user, resource) => {
    const institucionId = Number(url.searchParams.get("institucionId"));
    if (!institucionId) { sendJson(res, 400, { ok: false, message: "institucionId requerido" }); return; }
    const data = await getSedesByInstitucion(institucionId, { companyId: resource.companyId, contractId: resource.contractId });
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

async function handleFiltrosModalidades(req, res, url) {
  return withModuleProtection(MODULES.DOTACION, ACTIONS.VIEW, async (req, res, url, user, resource) => {
    const municipioId   = url.searchParams.get("municipioId")   ? Number(url.searchParams.get("municipioId"))   : null;
    const institucionId = url.searchParams.get("institucionId") ? Number(url.searchParams.get("institucionId")) : null;
    const sedeId        = url.searchParams.get("sedeId")        ? Number(url.searchParams.get("sedeId"))        : null;
    const data = await getModalidadesDisponibles({ companyId: resource.companyId, contractId: resource.contractId, municipioId, institucionId, sedeId });
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

async function handleEmpleadasParaRemision(req, res, url) {
  return withModuleProtection(MODULES.DOTACION, ACTIONS.VIEW, async (req, res, url, user, resource) => {
    const municipioId   = url.searchParams.get("municipioId")   ? Number(url.searchParams.get("municipioId"))   : null;
    const institucionId = url.searchParams.get("institucionId") ? Number(url.searchParams.get("institucionId")) : null;
    const sedeId        = url.searchParams.get("sedeId")        ? Number(url.searchParams.get("sedeId"))        : null;
    const modalidad     = url.searchParams.get("modalidad")     || null;
    const data = await getEmpleadasParaRemision({
      companyId: resource.companyId,
      contractId: resource.contractId,
      municipalityIds: resource.municipalityIds || null,
      municipioId,
      institucionId,
      sedeId,
      modalidad,
    });
    sendJson(res, 200, { ok: true, data });
  })(req, res, url);
}

async function handleRemisionMarcar(req, res, url, id, tipo) {
  if (req.method === "PATCH") {
    return withModuleProtection(MODULES.DOTACION, ACTIONS.UPDATE, async (req, res, url, user, resource) => {
      const body = await readJsonBody(req);
      if (!body.fecha) { sendJson(res, 400, { ok: false, message: "fecha requerida" }); return; }
      const data = await marcarEnviadoRecibido(id, tipo, { fecha: body.fecha, comprobante: body.comprobante });
      if (!data) { sendJson(res, 404, { ok: false, message: "Remisión no encontrada" }); return; }
      sendJson(res, 200, { ok: true, data });
    })(req, res, url);
  }
  if (req.method === "GET") {
    return withModuleProtection(MODULES.DOTACION, ACTIONS.VIEW, async (req, res, url, user, resource) => {
      const comprobante = await getComprobante(id, tipo);
      if (!comprobante) { sendJson(res, 404, { ok: false, message: "Sin comprobante" }); return; }
      sendJson(res, 200, { ok: true, comprobante });
    })(req, res, url);
  }
  return sendMethodNotAllowed(res);
}

module.exports = {
  handleCatalogoList,
  handleCatalogoCreate,
  handleCatalogoUpdate,
  handleStockList,
  handleStockUpsert,
  handleStockAdjust,
  handleAsignacionesList,
  handleAsignacionCreate,
  handleAsignacionUpdate,
  handleAsignacionDelete,
  handleAsignacionEvidencia,
  handleRemisionesList,
  handleRemisionGet,
  handleRemisionCreate,
  handleRemisionUpdate,
  handleRemisionDelete,
  handleRemisionFoto,
  handleImportarAsignaciones,
  handleFiltrosMunicipios,
  handleFiltrosInstituciones,
  handleFiltrosSedes,
  handleFiltrosModalidades,
  handleEmpleadasParaRemision,
  handleRemisionMarcar,
};
