const XLSX = require("xlsx");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { readJsonBody } = require("../../http/request");
const { withModuleProtection, isDemoUser } = require("../../http/protection");
const { ACTIONS, MODULES, ROLES } = require("../../auth/permissions");

const {
  listNovelties,
  getNoveltyById,
  createNovelty,
  updateNoveltyStatus,
  getPayrollSummary,
  calculatePayroll,
  getPayrollConfig,
  NOVELTY_TYPES,
  NOVELTY_STATUSES,
  listPeriods,
  getPeriodById,
  createPeriod,
  calculateAndSavePeriod,
  getPeriodResults,
  closePeriod,
  getPaySlip,
} = require("./payroll.repository");

const operational = require("./payroll.operational.repository");
const { clearGroupCache } = operational;

// ── Salary categories ────────────────────────────────────────────────────────
async function handleSalaryCategories(req, res, url) {
  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user, resource) => {
        const contractId = innerUrl.searchParams.get("contractId") || resource.contractId;
        if (!contractId) {
          sendJson(innerRes, 400, { ok: false, message: "contractId requerido" });
          return;
        }
        const data = await operational.getSalaryCategories(Number(contractId));
        sendJson(innerRes, 200, { ok: true, data });
      }
    )(req, res, url);
  }

  if (req.method === "POST" || req.method === "PUT") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.UPDATE,
      async (innerReq, innerRes, innerUrl, user, resource) => {
        if (!isAdminOrTH(user)) {
          sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede configurar categorías salariales" });
          return;
        }
        const body = await readJsonBody(innerReq);
        const contractId = body.contractId || body.contract_id || resource.contractId;
        if (!contractId) {
          sendJson(innerRes, 400, { ok: false, message: "contractId requerido" });
          return;
        }
        try {
          // Acepta array [{category_code, base_salary, transport_allowance, other_recargos}] o objeto único
          const items = Array.isArray(body.categories) ? body.categories : [body];
          const results = [];
          for (const item of items) {
            const row = await operational.upsertSalaryCategory(contractId, item.category_code || item.categoryCode, item);
            results.push(row);
          }
          sendJson(innerRes, 200, { ok: true, data: results, message: "Categorías salariales actualizadas" });
        } catch (err) {
          sendJson(innerRes, 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// ── Tipos oficiales de novedades ─────────────────────────────────────────────
async function handleOfficialNoveltyTypes(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  try {
    const data = await operational.getOfficialNoveltyTypes();
    sendJson(res, 200, { ok: true, data });
  } catch (err) {
    sendJson(res, 500, { ok: false, message: err.message });
  }
}

// ── Desprendible por item ─────────────────────────────────────────────────────
async function handleItemPayslip(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  const itemId = parseNumericPart(url.pathname, 2);
  if (!itemId) { sendJson(res, 400, { ok: false, message: "ID de item invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes) => {
      try {
        const data = await operational.getItemPayslip(itemId);
        sendJson(innerRes, 200, { ok: true, data });
      } catch (err) {
        sendJson(innerRes, 404, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ── Cambio Operativo de Cobertura ─────────────────────────────────────────────
async function handleCambioOperativo(req, res, url) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }
  const itemId = parseNumericPart(url.pathname, 2);
  if (!itemId) { sendJson(res, 400, { ok: false, message: "ID de item invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, _url, user) => {
      try {
        const body = await readJsonBody(innerReq);
        const data = await operational.createCambioOperativo(itemId, body, user.id);
        sendJson(innerRes, 201, { ok: true, data, message: "Cambio operativo registrado" });
      } catch (err) {
        sendJson(innerRes, err.httpStatus || 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ── Edición bancaria de cobertura externa (sin desbloquear nómina) ───────────
async function handleTurnCoverBankInfo(req, res, url) {
  if (req.method !== "PATCH") { sendMethodNotAllowed(res); return; }
  const coverId = parseNumericPart(url.pathname, 2);
  if (!coverId) { sendJson(res, 400, { ok: false, message: "ID de cobertura inválido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, _url, user) => {
      const role = String(user?.role || "").toLowerCase();
      const allowed = role === ROLES.ADMINISTRATOR || role === ROLES.HUMAN_RESOURCES;
      if (!allowed) {
        sendJson(innerRes, 403, { ok: false, message: "No tiene permiso para editar datos bancarios." });
        return;
      }
      try {
        const body = await readJsonBody(innerReq);
        const result = await operational.updateTurnCoverBankInfo(coverId, body, user);
        sendJson(innerRes, 200, { ok: true, data: result });
      } catch (err) {
        sendJson(innerRes, err.httpStatus || 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ── PDF cuenta de cobro ───────────────────────────────────────────────────────
async function handleChargeAccountHtml(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  const coverId = parseNumericPart(url.pathname, 2);
  if (!coverId) { sendJson(res, 400, { ok: false, message: "ID de cobertura invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes) => {
      try {
        const html = await operational.buildChargeAccountHtml(coverId);
        innerRes.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        innerRes.end(html);
      } catch (err) {
        sendJson(innerRes, 404, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

function getIdFromPath(pathname, prefix) {
  const raw = String(pathname || "").replace(prefix, "").split("/").filter(Boolean)[0];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isAdminOrTH(user) {
  const r = String(user.role || "").toLowerCase();
  return r === ROLES.ADMINISTRATOR || r === ROLES.HUMAN_RESOURCES;
}

function parseNumericPart(pathname, index) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  const n = Number(parts[index]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function handleOperationalPeriods(req, res, url) {
  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user, resource) => {
        const filters = {
          companyId: innerUrl.searchParams.get("companyId") || resource.companyId,
          contractId: innerUrl.searchParams.get("contractId") || resource.contractId,
        };
        const data = await operational.listOperationalPeriods(filters);
        sendJson(innerRes, 200, { ok: true, data });
      }
    )(req, res, url);
  }

  if (req.method === "POST") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.CREATE,
      async (innerReq, innerRes, innerUrl, user) => {
        if (!isAdminOrTH(user)) {
          sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede crear periodos" });
          return;
        }
        const body = await readJsonBody(innerReq);
        if (user.companyId && !body.companyId && !body.company_id) body.companyId = user.companyId;
        if (user.contractId && !body.contractId && !body.contract_id) body.contractId = user.contractId;
        try {
          const data = await operational.createOperationalPeriod(body, user.id);
          sendJson(innerRes, 201, { ok: true, data, message: "Periodo creado correctamente" });
        } catch (err) {
          sendJson(innerRes, 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

async function handleOperationalGroups(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  const periodId = parseNumericPart(url.pathname, 1);
  if (!periodId) { sendJson(res, 400, { ok: false, message: "ID de periodo invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes) => {
      try {
        const data = await operational.listPayrollGroups(periodId);
        sendJson(innerRes, 200, { ok: true, data });
      } catch (err) {
        sendJson(innerRes, err.httpStatus || 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleOperationalGroupById(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  const periodId = parseNumericPart(url.pathname, 1);
  const groupId = parseNumericPart(url.pathname, 3);
  if (!periodId || !groupId) { sendJson(res, 400, { ok: false, message: "ID de grupo invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl) => {
      try {
        const qp = innerUrl.searchParams;
        const filters = {
          institution_id: qp.get("institution_id") ? Number(qp.get("institution_id")) : null,
          site_id:        qp.get("site_id")        ? Number(qp.get("site_id"))        : null,
          modality:       qp.get("modality")       || null,
          cargo:          qp.get("cargo")          || null,
          has_novelties:  qp.has("has_novelties")  ? qp.get("has_novelties") === "true" : null,
          reviewed:       qp.has("reviewed")       ? qp.get("reviewed") === "true"      : null,
          support_status: qp.get("support_status") || null,
          sort_by:        qp.get("sort_by")        || null,
          sort_dir:       qp.get("sort_dir")       || null,
        };
        const data = await operational.getPayrollGroupDetail(periodId, groupId, filters);
        sendJson(innerRes, 200, { ok: true, data });
      } catch (err) {
        sendJson(innerRes, 404, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleExternalWorkerDocs(req, res, url) {
  if (req.method !== "PATCH") { sendMethodNotAllowed(res); return; }
  const parts = url.pathname.split("/").filter(Boolean);
  const workerId = Number(parts[2]);
  if (!workerId) { sendJson(res, 400, { ok: false, message: "ID de trabajador inválido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes) => {
      try {
        const body = await readJsonBody(innerReq);
        await operational.updateExternalWorkerDocs(workerId, body);
        sendJson(innerRes, 200, { ok: true, message: "Documentos actualizados" });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleOperationalGroupCalculate(req, res, url) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }
  const groupId = parseNumericPart(url.pathname, 2);
  if (!groupId) { sendJson(res, 400, { ok: false, message: "ID de grupo invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, innerUrl, user) => {
      if (!isAdminOrTH(user)) {
        sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede calcular la nomina" });
        return;
      }
      try {
        const data = await operational.calculatePayrollGroup(groupId);
        sendJson(innerRes, 200, { ok: true, data, message: "Grupo calculado correctamente" });
      } catch (err) {
        sendJson(innerRes, err.httpStatus || 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleItemReviewed(req, res, url) {
  if (req.method !== "PATCH" && req.method !== "PUT") { sendMethodNotAllowed(res); return; }
  const itemId = parseNumericPart(url.pathname, 2);
  if (!itemId) { sendJson(res, 400, { ok: false, message: "ID de item invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, innerUrl, user) => {
      try {
        const body = await readJsonBody(innerReq);
        const data = await operational.setItemReviewed(itemId, body.reviewed !== false, body, user);
        sendJson(innerRes, 200, { ok: true, data, message: "Revision actualizada" });
      } catch (err) {
        sendJson(innerRes, err.httpStatus || 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleOperationalItemNovelties(req, res, url) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }
  const itemId = parseNumericPart(url.pathname, 2);
  if (!itemId) { sendJson(res, 400, { ok: false, message: "ID de item invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.REGISTER,
    async (innerReq, innerRes, innerUrl, user) => {
      try {
        const body = await readJsonBody(innerReq);
        const data = await operational.createNoveltyForItem(itemId, body, user.id);
        sendJson(innerRes, 201, { ok: true, data, message: "Novedad registrada correctamente" });
      } catch (err) {
        sendJson(innerRes, err.httpStatus || 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleDeleteNovelty(req, res, url) {
  if (req.method !== "DELETE") { sendMethodNotAllowed(res); return; }
  const noveltyId = parseNumericPart(url.pathname, 2);
  if (!noveltyId) { sendJson(res, 400, { ok: false, message: "ID de novedad invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, _innerUrl, user) => {
      try {
        const data = await operational.deleteNovelty(noveltyId, user);
        sendJson(innerRes, 200, { ok: true, data, message: "Novedad eliminada y nómina recalculada" });
      } catch (err) {
        sendJson(innerRes, err.httpStatus || 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleOperationalNoveltyPatch(req, res, url) {
  if (req.method !== "PATCH" && req.method !== "PUT") { sendMethodNotAllowed(res); return; }
  const noveltyId = parseNumericPart(url.pathname, 2);
  if (!noveltyId) { sendJson(res, 400, { ok: false, message: "ID de novedad invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, innerUrl, user) => {
      try {
        const body = await readJsonBody(innerReq);
        const data = await operational.patchNovelty(noveltyId, body, user.id);
        sendJson(innerRes, 200, { ok: true, data, message: "Novedad actualizada" });
      } catch (err) {
        sendJson(innerRes, err.httpStatus || 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleOperationalNoveltyReviewed(req, res, url) {
  if (req.method !== "PATCH" && req.method !== "PUT") { sendMethodNotAllowed(res); return; }
  const noveltyId = parseNumericPart(url.pathname, 2);
  if (!noveltyId) { sendJson(res, 400, { ok: false, message: "ID de novedad invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, innerUrl, user) => {
      try {
        const body = await readJsonBody(innerReq);
        const data = await operational.setNoveltyReviewed(noveltyId, body.reviewed !== false, body, user);
        sendJson(innerRes, 200, { ok: true, data, message: "Revision actualizada" });
      } catch (err) {
        sendJson(innerRes, err.httpStatus || 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleOperationalNoveltyCover(req, res, url) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }
  const noveltyId = parseNumericPart(url.pathname, 2);
  if (!noveltyId) { sendJson(res, 400, { ok: false, message: "ID de novedad invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.REGISTER,
    async (innerReq, innerRes, innerUrl, user) => {
      try {
        const body = await readJsonBody(innerReq);
        const data = await operational.createTurnCover(noveltyId, body, user.id);
        sendJson(innerRes, 201, { ok: true, data, message: "Cobertura registrada" });
      } catch (err) {
        sendJson(innerRes, err.httpStatus || 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleOperationalSupports(req, res, url) {
  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl) => {
        const data = await operational.listSupports({
          periodId: innerUrl.searchParams.get("periodId"),
          municipalityId: innerUrl.searchParams.get("municipalityId"),
          status: innerUrl.searchParams.get("status"),
        });
        sendJson(innerRes, 200, { ok: true, data });
      }
    )(req, res, url);
  }
  if (req.method === "POST") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.REGISTER,
      async (innerReq, innerRes, innerUrl, user) => {
        try {
          const body = await readJsonBody(innerReq);
          const data = await operational.createSupport(body, user.id);
          sendJson(innerRes, 201, { ok: true, data, message: "Soporte actualizado" });
        } catch (err) {
          sendJson(innerRes, 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }
  sendMethodNotAllowed(res);
}

// ─────────────────────────────────────────────
// GET  /payroll/novelties
// POST /payroll/novelties
// ─────────────────────────────────────────────
async function handleNovelties(req, res, url) {
  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user, resource) => {
        const filters = {
          companyId:    innerUrl.searchParams.get("companyId")    || resource.companyId,
          contractId:   innerUrl.searchParams.get("contractId")   || resource.contractId,
          employeeId:   innerUrl.searchParams.get("employeeId"),
          noveltyType:  innerUrl.searchParams.get("noveltyType"),
          status:       innerUrl.searchParams.get("status"),
          startDateFrom: innerUrl.searchParams.get("startDateFrom"),
          startDateTo:   innerUrl.searchParams.get("startDateTo"),
        };

        const data = await listNovelties(filters);
        sendJson(innerRes, 200, { ok: true, data });
      }
    )(req, res, url);
  }

  if (req.method === "POST") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.REGISTER,
      async (innerReq, innerRes, innerUrl, user, resource) => {
        const body = await readJsonBody(innerReq);
        try {
          const novelty = await createNovelty(body, user.id);
          sendJson(innerRes, 201, {
            ok: true,
            data: novelty,
            message: "Novedad registrada correctamente",
          });
        } catch (err) {
          sendJson(innerRes, 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// ─────────────────────────────────────────────
// GET    /payroll/novelties/:id
// ─────────────────────────────────────────────
async function handleNoveltyById(req, res, url) {
  const id = getIdFromPath(url.pathname, "/payroll/novelties/");

  if (!id) {
    sendJson(res, 400, { ok: false, message: "ID de novedad inválido" });
    return;
  }

  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes) => {
        const novelty = await getNoveltyById(id);
        if (!novelty) {
          sendJson(innerRes, 404, { ok: false, message: "Novedad no encontrada" });
          return;
        }
        sendJson(innerRes, 200, { ok: true, data: novelty });
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// PATCH /payroll/novelties/:id/status
async function handleNoveltyStatus(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const id = Number(parts[2]);

  if (!Number.isFinite(id) || id <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de novedad inválido" });
    return;
  }

  if (req.method !== "PATCH" && req.method !== "PUT") {
    sendMethodNotAllowed(res);
    return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, innerUrl, user) => {
      const body = await readJsonBody(innerReq);
      const { status, reviewNotes } = body;

      if (!status) {
        sendJson(innerRes, 400, { ok: false, message: "Debes enviar el campo 'status'" });
        return;
      }

      try {
        const updated = await updateNoveltyStatus(id, status, reviewNotes, user.id);
        sendJson(innerRes, 200, {
          ok: true,
          data: updated,
          message: "Estado de novedad actualizado",
        });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ─────────────────────────────────────────────
// GET /payroll/summary
// ─────────────────────────────────────────────
async function handlePayrollSummary(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user, resource) => {
      const filters = {
        companyId:  innerUrl.searchParams.get("companyId")  || resource.companyId,
        contractId: innerUrl.searchParams.get("contractId") || resource.contractId,
      };

      const data = await getPayrollSummary(filters);
      sendJson(innerRes, 200, { ok: true, data });
    }
  )(req, res, url);
}

// GET /payroll/novelty-types
function handleNoveltyTypes(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }
  sendJson(res, 200, { ok: true, data: NOVELTY_TYPES, statuses: NOVELTY_STATUSES });
}

// ─────────────────────────────────────────────
// GET /payroll/calculate?period=YYYY-MM (preview, sin guardar)
// ─────────────────────────────────────────────
async function handleCalculatePayroll(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user, resource) => {
      const period     = innerUrl.searchParams.get("period");
      const companyId  = innerUrl.searchParams.get("companyId")  || resource.companyId  || null;
      const contractId = innerUrl.searchParams.get("contractId") || resource.contractId || null;

      try {
        const result = await calculatePayroll({ period, companyId, contractId });
        sendJson(innerRes, 200, { ok: true, ...result });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ─────────────────────────────────────────────
// GET/PATCH /payroll/config
// ─────────────────────────────────────────────
async function handlePayrollConfig(req, res, url) {
  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (_req, _res) => {
        const cfg = getPayrollConfig();
        sendJson(_res, 200, { ok: true, data: cfg });
      }
    )(req, res, url);
  }

  if (req.method === "PATCH" || req.method === "PUT") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.UPDATE,
      async (innerReq, innerRes) => {
        const { updatePayrollConfig } = require("../../data/payroll_config");
        const body = await readJsonBody(innerReq);
        try {
          const updated = updatePayrollConfig(body);
          sendJson(innerRes, 200, { ok: true, data: updated, message: "Configuración de nómina actualizada" });
        } catch (err) {
          sendJson(innerRes, 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// ─────────────────────────────────────────────
// GET /payroll/export?period=YYYY-MM → CSV
// ─────────────────────────────────────────────
async function handleExportPayroll(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.EXPORT,
    async (innerReq, innerRes, innerUrl, user, resource) => {
      const period     = innerUrl.searchParams.get("period");
      const companyId  = innerUrl.searchParams.get("companyId")  || resource.companyId  || null;
      const contractId = innerUrl.searchParams.get("contractId") || resource.contractId || null;

      try {
        const { payrollLines, totals } = await calculatePayroll({ period, companyId, contractId });

        const headers = [
          "Empleado","Documento","Municipio","Institución","Sede","Modalidad","Clasificación","Tipo","Días",
          "Salario Base","Aux. Transporte","Otros Ingresos","Total Devengado",
          "Ded. Salud","Ded. Pensión","Total Deducciones","Desc. Novedades","Neto a Pagar","Observaciones",
        ];

        const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

        const rows = payrollLines.map(l => [
          escape(l.employeeName), escape(l.documentNumber),
          escape(l.municipality), escape(l.institution), escape(l.site),
          escape(l.modality), escape(l.modalityClass), escape(l.workTimeType),
          l.workedDays, l.baseSalary, l.transportAllowance, l.otherEarnings,
          l.totalDevengado, l.deduccionSalud, l.deduccionPension, l.totalDeducciones,
          l.novedadDescuento, l.netoPagar, escape(l.observations.join(" | ")),
        ].join(","));

        const totalRow = [
          escape("TOTAL"), "", "", "", "", "", "", "",
          "", totals.totalDevengado, "", "", totals.totalDevengado,
          "", "", totals.totalDeducciones, "", totals.netoPagar, "",
        ].join(",");

        const csv = [headers.join(","), ...rows, totalRow].join("\n");

        innerRes.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="nomina-${period || "periodo"}.csv"`,
        });
        innerRes.end("﻿" + csv);
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ═════════════════════════════════════════════
// FASE 7 — Gestión de Períodos
// ═════════════════════════════════════════════

// GET  /payroll/periods
// POST /payroll/periods
async function handlePeriods(req, res, url) {
  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user, resource) => {
        if (isDemoUser(user)) {
          sendJson(innerRes, 200, { ok: true, data: [] });
          return;
        }
        const filters = {
          companyId:  resource.companyId  || innerUrl.searchParams.get("companyId"),
          contractId: resource.contractId || innerUrl.searchParams.get("contractId"),
          status:     innerUrl.searchParams.get("status"),
        };
        const data = await listPeriods(filters);
        sendJson(innerRes, 200, { ok: true, data });
      }
    )(req, res, url);
  }

  if (req.method === "POST") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.CREATE,
      async (innerReq, innerRes, innerUrl, user) => {
        if (!isAdminOrTH(user)) {
          sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede crear períodos" });
          return;
        }
        const body = await readJsonBody(innerReq);
        // For contract-scoped users, inject their company/contract if not provided
        if (user.companyId  && !body.companyId  && !body.company_id)  body.companyId  = user.companyId;
        if (user.contractId && !body.contractId && !body.contract_id) body.contractId = user.contractId;
        try {
          const period = await createPeriod(body, user.id);
          sendJson(innerRes, 201, { ok: true, data: period, message: "Período creado correctamente" });
        } catch (err) {
          sendJson(innerRes, 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// GET /payroll/periods/:id
async function handlePeriodById(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  const id = getIdFromPath(url.pathname, "/payroll/periods/");
  if (!id) { sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return; }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes) => {
      const period = await getPeriodById(id);
      if (!period) {
        sendJson(innerRes, 404, { ok: false, message: "Período no encontrado" });
        return;
      }
      sendJson(innerRes, 200, { ok: true, data: period });
    }
  )(req, res, url);
}

// GET  /payroll/periods/:id/novelties  — novedades del rango de fechas del período
// POST /payroll/periods/:id/novelties  — registrar novedad vinculada al período
async function handlePeriodNovelties(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }

  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes) => {
        const period = await getPeriodById(periodId);
        if (!period) { sendJson(innerRes, 404, { ok: false, message: "Período no encontrado" }); return; }

        const data = await listNovelties({
          companyId:    period.companyId,
          contractId:   period.contractId,
          startDateFrom: new Date(period.periodStart).toISOString().substring(0, 10),
          startDateTo:   new Date(period.periodEnd).toISOString().substring(0, 10),
        });
        sendJson(innerRes, 200, { ok: true, data, period });
      }
    )(req, res, url);
  }

  if (req.method === "POST") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.REGISTER,
      async (innerReq, innerRes, innerUrl, user) => {
        const period = await getPeriodById(periodId);
        if (!period) { sendJson(innerRes, 404, { ok: false, message: "Período no encontrado" }); return; }
        if (period.status === "CERRADO") {
          sendJson(innerRes, 400, { ok: false, message: "No se pueden agregar novedades a un período cerrado" }); return;
        }

        const body = await readJsonBody(innerReq);
        body.companyId  = body.companyId  || period.companyId;
        body.contractId = body.contractId || period.contractId;

        try {
          const novelty = await createNovelty(body, user.id);
          sendJson(innerRes, 201, { ok: true, data: novelty, message: "Novedad registrada correctamente" });
        } catch (err) {
          sendJson(innerRes, 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// POST /payroll/periods/:id/calculate
async function handlePeriodCalculate(req, res, url) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }

  const parts = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user) => {
      if (!isAdminOrTH(user)) {
        sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede calcular la nómina" });
        return;
      }
      try {
        const result = await calculateAndSavePeriod(periodId, user.id);
        sendJson(innerRes, 200, {
          ok: true,
          message: `Nómina calculada: ${result.payrollLines.length} empleados`,
          data: {
            periodId,
            employees: result.payrollLines.length,
            totals: result.totals,
            alerts: result.alerts,
          },
        });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// GET /payroll/periods/:id/results
async function handlePeriodResults(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  const parts = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes) => {
      try {
        const data = await getPeriodResults(periodId);
        sendJson(innerRes, 200, { ok: true, data });
      } catch (err) {
        sendJson(innerRes, 404, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// GET /payroll/periods/:id/export → XLSX
async function handlePeriodExport(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  const parts = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.EXPORT,
    async (innerReq, innerRes) => {
      try {
        const { period, lines, totals } = await getPeriodResults(periodId);

        const headerRow = [
          "Empleado", "Cédula", "Municipio", "Institución", "Sede",
          "Modalidad", "Clasificación", "Tipo jornada", "Días trabajados",
          "Salario base", "Aux. transporte", "Otros ingresos", "Total devengado",
          "Ded. salud", "Ded. pensión", "Total deducciones",
          "Desc. novedades", "Neto a pagar", "Observaciones",
        ];

        const dataRows = lines.map(l => [
          l.employeeName ?? "", l.documentNumber ?? "",
          l.municipality ?? "", l.institution ?? "", l.site ?? "",
          l.modality ?? "", l.modalityClass ?? "", l.workTimeType ?? "",
          l.workedDays ?? 0,
          l.baseSalary ?? 0, l.transportAllowance ?? 0, l.otherEarnings ?? 0, l.totalDevengado ?? 0,
          l.deduccionSalud ?? 0, l.deduccionPension ?? 0, l.totalDeducciones ?? 0,
          l.novedadDescuento ?? 0, l.netoPagar ?? 0,
          l.observations ?? "",
        ]);

        const totalsRow = [
          "TOTAL", "", "", "", "", "", "", "",
          "", "", "", "", totals.totalDevengado ?? 0,
          "", "", totals.totalDeducciones ?? 0,
          "", totals.netoPagar ?? 0, "",
        ];

        const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows, totalsRow]);

        // Column widths
        ws["!cols"] = [
          {wch:32},{wch:14},{wch:22},{wch:30},{wch:22},
          {wch:10},{wch:14},{wch:14},{wch:8},
          {wch:14},{wch:14},{wch:14},{wch:16},
          {wch:12},{wch:12},{wch:16},
          {wch:16},{wch:14},{wch:30},
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Nómina");

        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
        const filename = `nomina-${period.label.replace(/[^a-z0-9]/gi, "-")}.xlsx`;

        innerRes.writeHead(200, {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": buf.length,
        });
        innerRes.end(buf);
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// POST /payroll/periods/:id/close
async function handlePeriodClose(req, res, url) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }

  const parts = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, innerUrl, user) => {
      if (!isAdminOrTH(user)) {
        sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede cerrar períodos" });
        return;
      }
      try {
        const period = await closePeriod(periodId, user.id);
        sendJson(innerRes, 200, { ok: true, data: period, message: "Período cerrado correctamente" });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// GET  /payroll/periods/:id/municipality-status
// POST /payroll/periods/:id/municipality-status
async function handleMunicipalityStatus(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }

  const pool = require("../../db/pool");

  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes) => {
        try {
          const { rows } = await pool.query(
            `SELECT municipality, is_complete, completed_by_name, completed_at, notes
             FROM payroll_municipality_status
             WHERE period_id = $1
             ORDER BY municipality ASC`,
            [periodId]
          );
          sendJson(innerRes, 200, { ok: true, data: rows });
        } catch (err) {
          sendJson(innerRes, 500, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  if (req.method === "POST") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.REGISTER,
      async (innerReq, innerRes, innerUrl, user) => {
        const body = await readJsonBody(innerReq);
        // Aceptar municipalityId (número) O municipality (nombre) para compatibilidad
        const municipalityId   = body.municipalityId != null ? Number(body.municipalityId) : null;
        const municipalityName = String(body.municipality || "").trim();
        if (!municipalityId && !municipalityName) {
          sendJson(innerRes, 400, { ok: false, message: "municipalityId o municipality requerido" }); return;
        }
        const isComplete = Boolean(body.isComplete !== false);
        const userName = user.username || user.name || "";
        const userId   = user.id || null;

        // Resolver nombre si solo se envió el ID (para auditoría y mensajes)
        let resolvedName = municipalityName;
        if (municipalityId && !resolvedName) {
          const { rows: mRows } = await pool.query(
            `SELECT name FROM municipalities WHERE id = $1`, [municipalityId]
          );
          resolvedName = mRows[0]?.name || "";
        }

        const upsertBase = `
               is_complete           = EXCLUDED.is_complete,
               completed_by_user_id  = CASE WHEN EXCLUDED.is_complete THEN $4
                                            ELSE payroll_municipality_status.completed_by_user_id END,
               completed_by_name     = CASE WHEN EXCLUDED.is_complete THEN $5
                                            ELSE payroll_municipality_status.completed_by_name END,
               completed_at          = CASE WHEN EXCLUDED.is_complete THEN NOW()
                                            ELSE payroll_municipality_status.completed_at END,
               unreviewed_by_user_id = CASE WHEN NOT EXCLUDED.is_complete THEN $4 ELSE NULL END,
               unreviewed_by_name    = CASE WHEN NOT EXCLUDED.is_complete THEN $5 ELSE NULL END,
               unreviewed_at         = CASE WHEN NOT EXCLUDED.is_complete THEN NOW() ELSE NULL END,
               notes      = COALESCE(EXCLUDED.notes, payroll_municipality_status.notes),
               updated_at = NOW()`;

        try {
          if (municipalityId) {
            // Inserción por ID — usa el índice único pms_period_muni_id_uk
            await pool.query(
              `INSERT INTO payroll_municipality_status
                 (period_id, municipality_id, municipality, is_complete,
                  completed_by_user_id, completed_by_name, completed_at,
                  unreviewed_by_user_id, unreviewed_by_name, unreviewed_at,
                  notes, updated_at)
               VALUES ($1, $2, $7, $3,
                 CASE WHEN $3 THEN $4 ELSE NULL END,
                 CASE WHEN $3 THEN $5 ELSE NULL END,
                 CASE WHEN $3 THEN NOW() ELSE NULL END,
                 CASE WHEN NOT $3 THEN $4 ELSE NULL END,
                 CASE WHEN NOT $3 THEN $5 ELSE NULL END,
                 CASE WHEN NOT $3 THEN NOW() ELSE NULL END,
                 $6, NOW())
               ON CONFLICT (period_id, municipality_id) WHERE municipality_id IS NOT NULL
               DO UPDATE SET ${upsertBase}`,
              [periodId, municipalityId, isComplete, userId, userName, body.notes || null, resolvedName]
            );
          } else {
            // Fallback: inserción por nombre (filas históricas sin id)
            await pool.query(
              `INSERT INTO payroll_municipality_status
                 (period_id, municipality, is_complete,
                  completed_by_user_id, completed_by_name, completed_at,
                  unreviewed_by_user_id, unreviewed_by_name, unreviewed_at,
                  notes, updated_at)
               VALUES ($1, $2, $3,
                 CASE WHEN $3 THEN $4 ELSE NULL END,
                 CASE WHEN $3 THEN $5 ELSE NULL END,
                 CASE WHEN $3 THEN NOW() ELSE NULL END,
                 CASE WHEN NOT $3 THEN $4 ELSE NULL END,
                 CASE WHEN NOT $3 THEN $5 ELSE NULL END,
                 CASE WHEN NOT $3 THEN NOW() ELSE NULL END,
                 $6, NOW())
               ON CONFLICT (period_id, municipality) DO UPDATE SET ${upsertBase}`,
              [periodId, resolvedName, isComplete, userId, userName, body.notes || null]
            );
          }
          sendJson(innerRes, 200, { ok: true, message: isComplete ? "Municipio marcado como revisado" : "Revisión removida — municipio reabierto" });
        } catch (err) {
          sendJson(innerRes, 500, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// POST /payroll/periods/:id/confirm-and-send
async function handleConfirmAndSend(req, res, url) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }

  const parts = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, innerUrl, user) => {
      if (!isAdminOrTH(user)) {
        sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede confirmar la nómina" });
        return;
      }

      const pool = require("../../db/pool");

      try {
        // Close the period
        const period = await closePeriod(periodId, user.id);

        // Get payslip results to count employees with emails
        let sent = 0, failed = 0;
        try {
          const { lines } = await getPeriodResults(periodId);
          // Email sending requires SMTP config — count employees with emails registered
          const { getPersonnel } = require("../../data/personnel");
          const personnel = getPersonnel();
          const emailMap = {};
          personnel.forEach(e => {
            if (e.email || e.correo) {
              const key = String(e.id || e.documentNumber || e.numero_documento || "");
              if (key) emailMap[key] = e.email || e.correo;
            }
          });
          for (const line of lines) {
            const empId = String(line.employeeId || "");
            const email = emailMap[empId] || emailMap[line.documentNumber || ""];
            if (email) sent++; else failed++;
          }
        } catch { /* non-fatal */ }

        sendJson(innerRes, 200, {
          ok: true,
          message: `Nómina confirmada. ${sent} desprendibles disponibles para envío.`,
          data: { period, employeesWithEmail: sent, employeesWithoutEmail: failed },
        });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// GET /payroll/employees/:employeeId/slip?periodId=X
async function handlePaySlip(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl) => {
      const parts = url.pathname.split("/").filter(Boolean);
      const employeeId = parts[2];
      const periodId   = Number(innerUrl.searchParams.get("periodId"));

      if (!employeeId) { sendJson(innerRes, 400, { ok: false, message: "employeeId inválido" }); return; }
      if (!Number.isFinite(periodId) || periodId <= 0) {
        sendJson(innerRes, 400, { ok: false, message: "periodId inválido" }); return;
      }

      try {
        const data = await getPaySlip(periodId, employeeId);
        sendJson(innerRes, 200, { ok: true, data });
      } catch (err) {
        sendJson(innerRes, 404, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /payroll/groups/:groupId/export → XLSX multi-hoja por municipio
// ─────────────────────────────────────────────────────────────────────────────
function buildGroupXlsx(options) {
  const { group, items, novelties, supports, totals, coverage } = options;
  const covers = options.covers || [];
  function n(v) { return Number(v || 0); }
  function s(v) { return String(v == null ? "" : v); }
  function computeNoveltyDeduction(item) {
    const calc = item.calculation || {};
    let deduction;
    if (calc.cambio_operativo) {
      deduction = n(calc.salary_discount) + n(calc.transport_discount);
    } else if (n(calc.full_base_salary) > 0) {
      const fullComp = n(calc.full_base_salary) + n(calc.full_transport) + n(calc.full_other);
      const effectiveComp = n(item.base_salary) + n(item.transport_allowance) +
        Math.max(0, n(item.other_earnings) - n(calc.internal_cover_value));
      deduction = Math.max(0, fullComp - effectiveComp);
    } else {
      deduction = n(calc.salary_discount) + n(calc.transport_discount) + n(calc.other_discount);
    }
    return deduction + n(calc.turn_cover_discount);
  }

  const hdrStyle = {
    font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
    fill: { fgColor: { rgb: "1E293B" }, type: "pattern", patternType: "solid" },
    alignment: { horizontal: "center", vertical: "center" },
  };
  const totStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: "DCFCE7" }, type: "pattern", patternType: "solid" },
  };
  const MONEY = "#,##0";

  function makeSheet(headers, rows, moneyCols = [], colWidths = []) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");

    // Header styles
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) ws[addr].s = { ...hdrStyle };
    }
    // Money format on data + total rows
    for (const c of moneyCols) {
      for (let r = 1; r <= range.e.r; r++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr] && typeof ws[addr].v === "number") ws[addr].z = MONEY;
      }
    }
    // Freeze first row
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    // AutoFilter spanning header row
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: range.e.c } }) };
    // Column widths
    if (colWidths.length) ws["!cols"] = colWidths.map((w) => ({ wch: w }));
    return ws;
  }

  // ── Hoja 1: Nómina ──────────────────────────────────────────────────────
  const nomHdr = [
    "Documento", "Empleado", "Cargo", "Municipio", "Institución", "Sede",
    "Modalidad", "Jornada", "Categoría salarial", "Días lab.", "Días SS",
    "Salario base", "Aux. transporte", "Otros recargos", "Reemplazo incapacidad", "Total devengado",
    "Salud (4%)", "Pensión (4%)", "Desc. turnos cubiertos", "Total deducciones",
    "Novedades", "Desc. salario", "Desc. transporte",
    "Neto a pagar", "Motivo retiro", "Req. reemplazo", "Reemplazo", "Revisada",
  ];
  const nomMonCols = [11,12,13,14,15,16,17,18,19,21,22,23];

  const nomRows = items.map((item) => {
    const calc = (item.calculation && typeof item.calculation === "object") ? item.calculation : {};
    const otros = Math.max(0, n(item.other_earnings) - n(calc.internal_cover_value));
    const motivoRetiro = { disminucion_cupos: "Disminución de cupos", renuncia: "Renuncia", terminacion_contrato: "Terminación de contrato" }[item.retirement_reason] || "";
    const reqReemplazo = item.requires_replacement === true ? "Sí" : item.requires_replacement === false ? "No" : "";
    const reemplazo = item.replacement_employee_name || (item.replacement_found === false ? "No encontrado" : "");
    return [
      s(item.document_number), s(item.employee_name), s(item.operational_position),
      s(item.municipality_name), s(item.institution_name), s(item.site_name),
      s(item.modality), s(item.work_time_type), s(item.salary_category),
      n(item.display_worked_days ?? item.worked_days), n(item.ss_days != null ? item.ss_days : 30),
      n(item.base_salary), n(item.transport_allowance), otros, n(calc.internal_cover_value), n(item.total_devengado),
      n(calc.deduccion_salud), n(calc.deduccion_pension), n(calc.turn_cover_discount), n(item.total_deducciones),
      n(item.novelty_count), n(calc.salary_discount), n(calc.transport_discount),
      n(item.neto_pagar), motivoRetiro, reqReemplazo, reemplazo, item.reviewed ? "Sí" : "No",
    ];
  });

  // Totals
  function otrosItem(i) {
    const c = i.calculation || {};
    return Math.max(0, n(i.other_earnings) - n(c.internal_cover_value));
  }
  const nomTotal = [
    "TOTAL", "", "", "", "", "", "", "", "",
    items.reduce((a, i) => a + n(i.display_worked_days ?? i.worked_days), 0),
    items.reduce((a, i) => a + n(i.ss_days != null ? i.ss_days : 30), 0),
    items.reduce((a, i) => a + n(i.base_salary), 0),
    items.reduce((a, i) => a + n(i.transport_allowance), 0),
    items.reduce((a, i) => a + otrosItem(i), 0),
    items.reduce((a, i) => a + n((i.calculation||{}).internal_cover_value), 0),
    totals.total_devengado,
    items.reduce((a, i) => a + n((i.calculation||{}).deduccion_salud), 0),
    items.reduce((a, i) => a + n((i.calculation||{}).deduccion_pension), 0),
    items.reduce((a, i) => a + n((i.calculation||{}).turn_cover_discount), 0),
    totals.total_deducciones,
    totals.novelties,
    items.reduce((a, i) => a + n((i.calculation||{}).salary_discount), 0),
    items.reduce((a, i) => a + n((i.calculation||{}).transport_discount), 0),
    totals.neto,
    "", "", "", `${totals.items_reviewed}/${totals.employees} rev.`,
  ];

  const wsNom = makeSheet(nomHdr, [...nomRows, nomTotal], nomMonCols,
    [14,32,22,20,28,20,10,10,10,5,7,14,14,12,18,15,12,12,15,15,7,13,13,14,18,10,20,8]);

  // Style the totals row
  const nomTotR = nomRows.length + 1;
  for (let c = 0; c < nomHdr.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: nomTotR, c });
    if (wsNom[addr]) { wsNom[addr].s = { ...totStyle }; if (typeof wsNom[addr].v === "number") wsNom[addr].z = MONEY; }
  }

  // ── Hoja 2: Novedades ───────────────────────────────────────────────────
  const SALARY_AFFECTING_XL    = new Set(["PERMISOS_NO_REMUNERADOS","SUSPENSION","FECHA_INGRESO","FECHA_RETIRO"]);
  const TRANSPORT_AFFECTING_XL = new Set(["DIAS_NO_CLASE","CITA_MEDICA","INCAPACIDAD_MEDICA","INCAPACIDAD_ACCIDENTE_LABORAL","CALAMIDAD_FAMILIAR","LUTO","CITACIONES_OFICIALES","LICENCIA_MATERNIDAD_PATERNIDAD"]);

  // Índice de cálculo e información de ubicación por item
  const itemCalcMap = new Map(items.map((i) => [String(i.id), i.calculation || {}]));
  const itemInfoMap = new Map(items.map((i) => [String(i.id), {
    municipality_name:    i.municipality_name    || "",
    institution_name:     i.institution_name     || "",
    site_name:            i.site_name            || "",
    operational_position: i.operational_position || "",
  }]));

  const novHdr = [
    "Municipio", "Institución", "Sede", "Empleado", "Documento", "Cargo",
    "Tipo de novedad", "Impacto",
    "Fecha inicio", "Fecha fin", "Días",
    "Desc. salario", "Desc. transporte", "Categoría turno", "Valor día turno", "Valor turno",
    "Soporte", "Estado", "Revisada",
  ];
  const uniqueNovelties = [...new Map(novelties.map((nov) => [nov.id, nov])).values()];
  const novRows2 = uniqueNovelties
    .filter((nov) => nov.novelty_type !== "CAMBIO_OPERATIVO_COBERTURA")
    // Ordenar: primero por nombre de colaborador (A→Z), luego por fecha de inicio (cronológico).
    // Mantiene una fila por novedad — solo mejora el orden para facilitar revisión y auditoría.
    .sort((a, b) => {
      const nameA = String(a.employee_name || "").toUpperCase();
      const nameB = String(b.employee_name || "").toUpperCase();
      if (nameA < nameB) return -1;
      if (nameA > nameB) return  1;
      const dateA = String(a.start_date || a.novelty_date || "");
      const dateB = String(b.start_date || b.novelty_date || "");
      return dateA < dateB ? -1 : dateA > dateB ? 1 : 0;
    })
    .map((nov) => {
      const code   = s(nov.novelty_type);
      const calc   = itemCalcMap.get(String(nov.payroll_item_id)) || {};
      const info   = itemInfoMap.get(String(nov.payroll_item_id)) || {};
      const days   = Math.min(n(nov.days), n(calc.worked_days) || 30);
      const isSal  = SALARY_AFFECTING_XL.has(code) && code !== "FECHA_INGRESO" && code !== "FECHA_RETIRO";
      const isTrans= TRANSPORT_AFFECTING_XL.has(code);
      const turnCategory = s(nov.origin_salary_category);
      const turnValueDay = n(nov.replacement_value_per_day);
      const turnValue = n(nov.replacement_amount);
      const descSal   = isSal   ? Math.round(n(calc.daily_salary    || 0) * days) : 0;
      const descTrans = isTrans ? Math.round(n(calc.daily_transport || 0) * days) : 0;
      const impact = turnValue
        ? "Turno cubierto"
        : isSal
          ? "Desc. salario"
          : isTrans
            ? "Desc. transporte"
            : "Sin impacto";
      return [
        s(info.municipality_name),
        s(info.institution_name),
        s(info.site_name),
        s(nov.employee_name), s(nov.document_number),
        s(info.operational_position),
        s(nov.novelty_name || nov.novelty_type), impact,
        s(nov.start_date ? s(nov.start_date).slice(0,10) : ""),
        s(nov.end_date   ? s(nov.end_date).slice(0,10)   : ""),
        n(nov.period_days ?? nov.days),
        descSal, descTrans,
        turnCategory, turnValueDay, turnValue,
        s(nov.support_status || "sin soporte"),
        s(nov.status || "PENDIENTE"),
        nov.reviewed ? "Sí" : "No",
      ];
    });
  const wsNov = makeSheet(novHdr, novRows2, [11,12,14,15],
    [20,28,20,28,14,22,26,16,12,12,5,13,13,14,14,13,13,14,12,8]);

  // ── Hoja 3: Resumen en matriz dinámica por municipio ─────────────────────
  // Las columnas se generan automáticamente según los municipios seleccionados.

  const turns = Array.isArray(options.turns) ? options.turns : [];

  // Totales globales (para la columna TOTAL GENERAL)
  const totalNoveltyDeductions = items.reduce((sum, item) => {
    return sum + computeNoveltyDeduction(item);
  }, 0);
  const totalNoveltyAdditions = items.reduce((sum, item) => sum + n((item.calculation || {}).internal_cover_value), 0);
  const totalExternalTurns    = turns.filter((t) => t.cover_type === "EXTERNA").reduce((sum, t) => sum + n(t.total_value), 0);

  // Municipios para las columnas: usar _municipalities si existe, si no crear uno desde los totales
  const munis = Array.isArray(group._municipalities) && group._municipalities.length > 0
    ? group._municipalities
    : [{
        name:               s(group.municipality_name) || "Municipio",
        period_id:          s(group.period_id),
        position:           s(group.operational_position),
        employees:          n(totals.employees),
        items_reviewed:     n(totals.items_reviewed),
        items_pending:      n(totals.items_pending),
        novelties:          n(totals.novelties),
        reviewed:           n(totals.reviewed),
        pending_supports:   n(totals.pending_supports),
        total_devengado:    n(totals.total_devengado),
        total_deducciones:  n(totals.total_deducciones),
        novelty_deductions: totalNoveltyDeductions,
        novelty_additions:  totalNoveltyAdditions,
        external_turns:     totalExternalTurns,
        neto:               n(totals.neto),
      }];

  const sumCol = (key) => munis.reduce((acc, m) => acc + n(m[key] || 0), 0);
  const TOTAL = "TOTAL GENERAL";

  // Estilos para la hoja Resumen
  const resMatHdrStyle = { font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 }, fill: { fgColor: { rgb: "1E293B" }, type: "pattern", patternType: "solid" }, alignment: { horizontal: "center", vertical: "center" } };
  const resSectStyle   = { font: { bold: true, color: { rgb: "334155" }, sz: 10 },  fill: { fgColor: { rgb: "F1F5F9" }, type: "pattern", patternType: "solid" } };
  const resTotStyle    = { font: { bold: true }, fill: { fgColor: { rgb: "DCFCE7" }, type: "pattern", patternType: "solid" } };

  // Construir encabezado y filas
  const resHdr  = ["Concepto", ...munis.map((m) => m.name.toUpperCase()), TOTAL];
  const resRows = [
    // ── Identificación ──
    ["Período",   ...munis.map((m) => s(m.period_id  || group.period_id)),          s(group.period_id)],
    ["Cargo",     ...munis.map((m) => s(m.position   || group.operational_position)), s(group.operational_position)],
    ["", ...munis.map(() => ""), ""],
    // ── Empleados ──
    ["── EMPLEADOS ──", ...munis.map(() => ""), ""],
    ["Total empleados",  ...munis.map((m) => n(m.employees)),      sumCol("employees")],
    ["Items revisados",  ...munis.map((m) => n(m.items_reviewed)), sumCol("items_reviewed")],
    ["Items pendientes", ...munis.map((m) => n(m.items_pending)),  sumCol("items_pending")],
    ["", ...munis.map(() => ""), ""],
    // ── Novedades ──
    ["── NOVEDADES ──", ...munis.map(() => ""), ""],
    ["Total novedades",     ...munis.map((m) => n(m.novelties)),       sumCol("novelties")],
    ["Novedades revisadas", ...munis.map((m) => n(m.reviewed)),        sumCol("reviewed")],
    ["Soportes pendientes", ...munis.map((m) => n(m.pending_supports)),sumCol("pending_supports")],
    ["", ...munis.map(() => ""), ""],
    // ── Valores ──
    ["── VALORES ──", ...munis.map(() => ""), ""],
    ["Total devengado",         ...munis.map((m) => n(m.total_devengado)),    sumCol("total_devengado")],
    ["Total deducciones",       ...munis.map((m) => n(m.total_deducciones)),  sumCol("total_deducciones")],
    ["Desc. por novedades",     ...munis.map((m) => n(m.novelty_deductions)), sumCol("novelty_deductions")],
    ["Adic. por novedades",     ...munis.map((m) => n(m.novelty_additions)),  sumCol("novelty_additions")],
    ["Turnos externos",         ...munis.map((m) => n(m.external_turns)),     sumCol("external_turns")],
    ["Neto total",              ...munis.map((m) => n(m.neto)),               sumCol("neto")],
  ];

  // Cobertura: municipio único usa el parámetro coverage; multi-municipio usa campos por muni
  const hasMuniCov = munis.some((m) => m.coverage_tc_req != null);
  if (coverage && munis.length === 1) {
    resRows.push(["", ...munis.map(() => ""), ""]);
    resRows.push(["── COBERTURA ──", ...munis.map(() => ""), ""]);
    resRows.push(["TC requerido",       n(coverage.tc_requerido),      n(coverage.tc_requerido)]);
    resRows.push(["TC contratado",      n(coverage.tc_contratado),     n(coverage.tc_contratado)]);
    resRows.push(["Diferencia TC",      n(coverage.diferencia_tc),     n(coverage.diferencia_tc)]);
    resRows.push(["MT requerido",       n(coverage.mt_requerido),      n(coverage.mt_requerido)]);
    resRows.push(["MT contratado",      n(coverage.mt_contratado),     n(coverage.mt_contratado)]);
    resRows.push(["Diferencia MT",      n(coverage.diferencia_mt),     n(coverage.diferencia_mt)]);
    resRows.push(["Cumple",             s(coverage.estado_cobertura),  s(coverage.estado_cobertura)]);
  } else if (hasMuniCov) {
    const sumTcReq = munis.reduce((acc, m) => acc + n(m.coverage_tc_req), 0);
    const sumTcCon = munis.reduce((acc, m) => acc + n(m.coverage_tc_con), 0);
    const sumMtReq = munis.reduce((acc, m) => acc + n(m.coverage_mt_req), 0);
    const sumMtCon = munis.reduce((acc, m) => acc + n(m.coverage_mt_con), 0);
    resRows.push(["", ...munis.map(() => ""), ""]);
    resRows.push(["── COBERTURA ──", ...munis.map(() => ""), ""]);
    resRows.push(["TC Req vs Contratada",
      ...munis.map((m) => `${n(m.coverage_tc_req)} / ${n(m.coverage_tc_con)}`),
      `${sumTcReq} / ${sumTcCon}`]);
    resRows.push(["MT Req vs Contratada",
      ...munis.map((m) => `${n(m.coverage_mt_req)} / ${n(m.coverage_mt_con)}`),
      `${sumMtReq} / ${sumMtCon}`]);
    resRows.push(["Cumple",
      ...munis.map((m) => m.coverage_estado || ""),
      sumTcCon >= sumTcReq && sumMtCon >= sumMtReq ? "Sí" : "No"]);
  }

  // Columnas monetarias: todas excepto la primera ("Concepto")
  const moneyColsRes = Array.from({ length: munis.length + 1 }, (_, i) => i + 1);
  // Filas de sección (texto descriptivo): no aplicar formato monetario
  const sectionRows = new Set([2, 7, 11, 15]); // 0-indexed rows del array resRows (las de "──")

  const wsRes = (() => {
    const ws = XLSX.utils.aoa_to_sheet([resHdr, ...resRows]);
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    // Estilo encabezado
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) ws[addr].s = { ...resMatHdrStyle };
    }
    // Formato dinámico por fila
    resRows.forEach((row, ri) => {
      const isSect = String(row[0]).startsWith("──");
      const isTot  = String(row[0]) === "Neto total";
      for (let c = 0; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r: ri + 1, c });
        if (!ws[addr]) continue;
        if (isSect) { ws[addr].s = { ...resSectStyle }; continue; }
        if (isTot)  { ws[addr].s = { ...resTotStyle  }; }
        if (c > 0 && !isSect && typeof ws[addr].v === "number") ws[addr].z = MONEY;
      }
    });
    ws["!freeze"]    = { xSplit: 1, ySplit: 1 };
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: range.e.c } }) };
    // Anchos de columna: 30 para Concepto, 22 para cada municipio, 22 para Total
    ws["!cols"] = [{ wch: 30 }, ...munis.map(() => ({ wch: 22 })), { wch: 22 }];
    return ws;
  })();

  // ── Hoja 4: Turnos ──────────────────────────────────────────────────────────
  const turnHdr = [
    "Período", "Fecha turno", "Empleado con novedad", "Documento novedad",
    "Tipo novedad", "Cubierto por", "Tipo cobertura", "Documento cobertura",
    "Municipio", "Institución", "Sede", "Modalidad", "Categoría turno",
    "Días cubiertos", "Valor día", "Valor total",
    "Banco", "Cuenta",
  ];
  const turnMonCols = [14, 15];
  const turnRows = turns.map((t) => [
    s(group.period_id),
    t.novelty_start ? s(t.novelty_start).slice(0, 10) : "",
    s(t.origin_employee_name),
    s(t.origin_document),
    s(t.novelty_type),
    t.cover_type === "INTERNA" ? s(t.internal_employee_name) : s(t.external_worker_name),
    s(t.cover_type),
    t.cover_type === "INTERNA" ? s(t.internal_document) : s(t.external_document),
    s(t.municipality_name),
    s(t.institution_name),
    s(t.site_name),
    s(t.modality),
    s(t.origin_category),
    n(t.covered_days),
    n(t.calculated_day_value),
    n(t.total_value),
    t.cover_type === "EXTERNA" ? s(t.external_bank) : "",
    t.cover_type === "EXTERNA" ? s(t.external_account_number) : "",
  ]);
  const wsTurn = makeSheet(turnHdr, turnRows, turnMonCols,
    [8,12,32,14,26,32,14,14,20,28,20,10,14,8,14,14,20,18]);

  // ── Hoja 0: Variables Nómina (primera, para referencia rápida) ───────────────
  const wsVars = makeVariablesWorksheet(computeVariablesRows(items, novelties));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsVars, "Variables Nómina");
  XLSX.utils.book_append_sheet(wb, wsNom,  "Nómina");
  XLSX.utils.book_append_sheet(wb, wsNov,  "Novedades");
  XLSX.utils.book_append_sheet(wb, wsTurn, "Turnos");
  XLSX.utils.book_append_sheet(wb, wsRes,  "Resumen");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
}

async function handleGroupExport(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  const parts = url.pathname.split("/").filter(Boolean);
  const groupId = Number(parts[2]);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de grupo inválido" }); return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.EXPORT,
    async (innerReq, innerRes) => {
      try {
        const group = await operational.getGroup(groupId);
        if (!group) { sendJson(innerRes, 404, { ok: false, message: "Grupo no encontrado" }); return; }

        const data     = await operational.getPayrollGroupDetail(group.period_id, group.id);
        const coverage = await operational.getCoverageStatsForGroup(group.contract_id, group.municipality_id).catch(() => null);
        const turnsData = await operational.listGroupTurns(group.id).catch(() => ({ turns: [] }));
        const buf  = buildGroupXlsx({ ...data, coverage, turns: turnsData.turns });
        const name = s(group.municipality_name || "municipio").replace(/[^a-z0-9\-_]/gi, "-");
        const filename = `nomina-${name}-${group.period_id}.xlsx`;

        innerRes.writeHead(200, {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": buf.length,
        });
        innerRes.end(buf);
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ── Exportación multi-municipio: varios grupos en un solo Excel ──────────────
// GET /payroll/groups/multi-export?groupIds=1,2,3
async function handleMultiGroupExport(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  const groupIdsRaw = url.searchParams.get("groupIds") || "";
  const groupIds = groupIdsRaw.split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!groupIds.length) {
    sendJson(res, 400, { ok: false, message: "Parámetro groupIds requerido (ej. groupIds=1,2,3)" }); return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.EXPORT,
    async (innerReq, innerRes) => {
      try {
        console.log("[EXPORT] Grupos seleccionados:", groupIds);
        console.log("[MEMORY] inicio:", Math.round(process.memoryUsage().heapUsed / 1024 / 1024), "MB");

        // Cargar detalle de cada grupo en secuencia para identificar cuál falla
        const valid = [];
        for (const gid of groupIds) {
          console.log("[EXPORT] Iniciando grupo", gid);
          try {
            const grp = await operational.getGroup(gid);
            if (!grp) { console.warn("[EXPORT] Grupo no encontrado:", gid); continue; }

            console.log("[EXPORT] Municipio:", grp.municipality_name, "| período:", grp.period_id);
            console.log("[MEMORY] antes de cargar grupo", gid, ":", Math.round(process.memoryUsage().heapUsed / 1024 / 1024), "MB");

            const [data, turnsRes, coverageData] = await Promise.all([
              operational.getPayrollGroupDetail(grp.period_id, gid),
              operational.listGroupTurns(gid).catch(() => ({ turns: [] })),
              operational.getCoverageStatsForGroup(grp.contract_id, grp.municipality_id).catch(() => null),
            ]);

            const payrollRows  = (data.items     || []).length;
            const noveltyRows  = (data.novelties || []).length;
            const supportRows  = (data.supports  || []).length;
            const turnRows     = (turnsRes.turns  || []).length;

            console.log("[EXPORT] Volumen grupo", gid, "(", grp.municipality_name, "):", {
              payrollRows, noveltyRows, supportRows, turnRows,
            });

            if (payrollRows  > 5000) console.warn("[EXPORT WARNING] payrollRows > 5000 en grupo", gid, ":", payrollRows);
            if (noveltyRows  > 5000) console.warn("[EXPORT WARNING] noveltyRows > 5000 en grupo", gid, ":", noveltyRows);
            if (supportRows  > 5000) console.warn("[EXPORT WARNING] supportRows > 5000 en grupo", gid, ":", supportRows);
            if (turnRows     > 5000) console.warn("[EXPORT WARNING] turnRows    > 5000 en grupo", gid, ":", turnRows);

            console.log("[MEMORY] después de cargar grupo", gid, ":", Math.round(process.memoryUsage().heapUsed / 1024 / 1024), "MB");

            valid.push({ grp, data, turns: turnsRes.turns || [], coverageData });
          } catch (err) {
            console.error("[EXPORT GRUPO ERROR] groupId =", gid);
            console.error(err);
            throw new Error(`Fallo al procesar grupo ${gid}: ${err.message}`);
          }
        }

        if (!valid.length) {
          sendJson(innerRes, 404, { ok: false, message: "Ningún grupo encontrado" }); return;
        }

        // Combinar items, novedades, turnos y soportes
        const allItems    = valid.flatMap((v) => v.data.items    || []);
        const allNovs     = valid.flatMap((v) => v.data.novelties || []);
        const allCovers   = valid.flatMap((v) => v.data.covers   || []);
        const allTurns    = valid.flatMap((v) => v.turns);

        console.log("[EXPORT] Totales combinados:", {
          items:    allItems.length,
          novs:     allNovs.length,
          covers:   allCovers.length,
          turns:    allTurns.length,
        });
        console.log("[MEMORY] antes de generar Excel:", Math.round(process.memoryUsage().heapUsed / 1024 / 1024), "MB");

        const n = (v) => Number(v || 0);
        const combinedTotals = allItems.reduce(
          (acc, item) => {
            acc.employees++;
            acc.total_devengado   += n(item.total_devengado);
            acc.total_deducciones += n(item.total_deducciones);
            acc.neto              += n(item.neto_pagar);
            acc.novelties         += n(item.novelty_count);
            acc.reviewed          += n(item.reviewed_count);
            acc.pending_supports  += n(item.pending_supports);
            acc.items_reviewed    += item.reviewed ? 1 : 0;
            acc.items_pending     += item.reviewed ? 0 : 1;
            return acc;
          },
          { employees: 0, total_devengado: 0, total_deducciones: 0, neto: 0,
            novelties: 0, reviewed: 0, pending_supports: 0, items_reviewed: 0, items_pending: 0 }
        );

        // Construir un "grupo sintético" con los datos combinados para buildGroupXlsx
        const firstGrp = valid[0].grp;
        const muniNames = valid.map((v) => v.grp.municipality_name || "").filter(Boolean);

        // Estadísticas completas por municipio para la hoja Resumen en matriz
        const munStatsPerGroup = valid.map((v) => {
          const gItems = v.data.items    || [];
          const gTurns = v.turns         || [];
          const gTotals = v.data.totals  || {};
          const totalNoveltyDed = gItems.reduce((sum, item) => sum + computeNoveltyDeduction(item), 0);
          const totalNoveltyAdd = gItems.reduce((sum, item) => sum + n((item.calculation || {}).internal_cover_value), 0);
          const totalExtTurns   = gTurns.filter((t) => t.cover_type === "EXTERNA").reduce((sum, t) => sum + n(t.total_value), 0);
          const cov = v.coverageData;
          return {
            name:               v.grp.municipality_name || "",
            period_id:          v.grp.period_id,
            position:           v.grp.operational_position,
            employees:          Number(gTotals.employees        || gItems.length),
            items_reviewed:     Number(gTotals.items_reviewed   || 0),
            items_pending:      Number(gTotals.items_pending    || 0),
            novelties:          Number(gTotals.novelties        || 0),
            reviewed:           Number(gTotals.reviewed         || 0),
            pending_supports:   Number(gTotals.pending_supports || 0),
            total_devengado:    Number(gTotals.total_devengado  || 0),
            total_deducciones:  Number(gTotals.total_deducciones|| 0),
            novelty_deductions: totalNoveltyDed,
            novelty_additions:  totalNoveltyAdd,
            external_turns:     totalExtTurns,
            neto:               Number(gTotals.neto             || 0),
            coverage_tc_req:    cov ? Number(cov.tc_requerido   || 0) : null,
            coverage_tc_con:    cov ? Number(cov.tc_contratado  || 0) : null,
            coverage_mt_req:    cov ? Number(cov.mt_requerido   || 0) : null,
            coverage_mt_con:    cov ? Number(cov.mt_contratado  || 0) : null,
            coverage_estado:    cov ? s(cov.estado_cobertura)         : "",
          };
        });

        const syntheticGroup = {
          ...firstGrp,
          municipality_name: muniNames.join(", ") || "Múltiples municipios",
          _municipalities:   munStatsPerGroup,
        };

        let buf;
        try {
          buf = buildGroupXlsx({
            group:    syntheticGroup,
            items:    allItems,
            novelties: allNovs,
            supports: [],
            covers:   allCovers,
            turns:    allTurns,
            totals:   combinedTotals,
            coverage: null,
          });
        } catch (xlsxErr) {
          console.error("[EXPORT XLSX ERROR] Fallo al generar el workbook multi-grupo");
          console.error("[EXPORT XLSX ERROR] Municipios involucrados:", muniNames);
          console.error("[EXPORT XLSX ERROR] Volumen: items=%d novs=%d covers=%d turns=%d",
            allItems.length, allNovs.length, allCovers.length, allTurns.length);
          console.error(xlsxErr);
          throw new Error(`Error generando Excel (${muniNames.join(", ")}): ${xlsxErr.message}`);
        }

        console.log("[MEMORY] después de generar Excel:", Math.round(process.memoryUsage().heapUsed / 1024 / 1024), "MB");
        console.log("[EXPORT] Excel generado, tamaño:", Math.round(buf.length / 1024), "KB");

        const periodLabel = firstGrp.period_id || "periodo";
        const munSafe = muniNames.slice(0, 3).join("-").replace(/[^a-z0-9\-_]/gi, "-");
        const filename = `nomina-${munSafe}-${periodLabel}.xlsx`;

        innerRes.writeHead(200, {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": buf.length,
        });
        innerRes.end(buf);
      } catch (err) {
        console.error("[EXPORT MULTI ERROR] Error general en handleMultiGroupExport:", err.message);
        console.error(err.stack);
        sendJson(innerRes, 400, { ok: false, message: err.message, stack: process.env.NODE_ENV !== "production" ? err.stack : undefined });
      }
    }
  )(req, res, url);
}

// ── Turnos cubiertos de un grupo ─────────────────────────────────────────────
async function handleGroupTurns(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  const parts = url.pathname.split("/").filter(Boolean);
  const groupId = Number(parts[2]);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de grupo inválido" }); return;
  }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes) => {
      try {
        const data = await operational.listGroupTurns(groupId);
        sendJson(innerRes, 200, { ok: true, ...data });
      } catch (err) {
        sendJson(innerRes, 404, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ── Cerrar grupo de nómina ───────────────────────────────────────────────────
async function handleGroupClose(req, res, url) {
  if (req.method !== "PATCH" && req.method !== "POST") { sendMethodNotAllowed(res); return; }
  const parts   = url.pathname.split("/").filter(Boolean);
  const groupId = Number(parts[2]);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de grupo inválido" }); return;
  }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, _url, user) => {
      try {
        const group = await operational.closePayrollGroup(groupId, user);
        clearGroupCache();
        sendJson(innerRes, 200, { ok: true, data: group, message: "Nómina cerrada correctamente." });
      } catch (err) {
        sendJson(innerRes, err.httpStatus || 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ── Reabrir grupo de nómina ──────────────────────────────────────────────────
async function handleGroupReopen(req, res, url) {
  if (req.method !== "POST" && req.method !== "PATCH") { sendMethodNotAllowed(res); return; }
  const parts   = url.pathname.split("/").filter(Boolean);
  const groupId = Number(parts[2]);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de grupo inválido" }); return;
  }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, _url, user) => {
      if (!isAdminOrTH(user)) {
        sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede reabrir la nómina." });
        return;
      }
      try {
        const body = await readJsonBody(innerReq);
        const reason = String(body.reason || body.motivo || "").trim();
        if (!reason) {
          sendJson(innerRes, 400, { ok: false, message: "Debe indicar el motivo de reapertura." }); return;
        }
        const group = await operational.reopenPayrollGroup(groupId, user, reason, body.observations || "");
        clearGroupCache();
        sendJson(innerRes, 200, { ok: true, data: group, message: "Nómina reabierta." });
      } catch (err) {
        sendJson(innerRes, err.httpStatus || 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ── Configuración salarial individual por empleado (Gestores, Auxiliares…) ───
// GET    /payroll/employees/:id/salary-config    → historial completo
// POST   /payroll/employees/:id/salary-config    → nueva entrada
// DELETE /payroll/employee-salary-config/:id     → eliminar entrada
async function handleEmployeeSalaryConfig(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);

  // DELETE /payroll/employee-salary-config/:configId
  if (req.method === "DELETE" && parts[1] === "employee-salary-config") {
    const configId = Number(parts[2]);
    if (!Number.isFinite(configId) || configId <= 0) {
      sendJson(res, 400, { ok: false, message: "ID de configuración inválido" }); return;
    }
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.UPDATE,
      async (innerReq, innerRes, _url, user) => {
        if (!isAdminOrTH(user)) {
          sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede eliminar configuraciones salariales." }); return;
        }
        try {
          await operational.deleteEmployeeSalaryConfig(configId);
          sendJson(innerRes, 200, { ok: true, message: "Configuración eliminada" });
        } catch (err) {
          sendJson(innerRes, err.httpStatus || 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  // GET / POST /payroll/employees/:employeeId/salary-config
  const employeeId = Number(parts[2]);
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de empleado inválido" }); return;
  }

  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes) => {
        try {
          const data = await operational.listEmployeeSalaryConfig(employeeId);
          sendJson(innerRes, 200, { ok: true, data });
        } catch (err) {
          sendJson(innerRes, 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  if (req.method === "POST") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.UPDATE,
      async (innerReq, innerRes, _url, user) => {
        if (!isAdminOrTH(user)) {
          sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede configurar salarios." }); return;
        }
        try {
          const body = await readJsonBody(innerReq);
          const data = await operational.createEmployeeSalaryConfig(employeeId, body, user.id);
          sendJson(innerRes, 201, { ok: true, data, message: "Configuración salarial guardada" });
        } catch (err) {
          sendJson(innerRes, err.httpStatus || 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// ── Historial de grupo de nómina ─────────────────────────────────────────────
async function handleGroupHistory(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  const parts   = url.pathname.split("/").filter(Boolean);
  const groupId = Number(parts[2]);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de grupo inválido" }); return;
  }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes) => {
      try {
        const data = await operational.getGroupHistory(groupId);
        sendJson(innerRes, 200, { ok: true, data });
      } catch (err) {
        sendJson(innerRes, err.httpStatus || 404, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ── helper local (duplicado de operational para no importar) ─────────────────
function s(v) { return String(v == null ? "" : v); }

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTACIÓN FORMATO VARIABLES DE NÓMINA — helpers compartidos
// Reutilizados por buildGroupXlsx (por municipio) y buildPeriodFullXlsx (global)
// ─────────────────────────────────────────────────────────────────────────────
const VARIABLES_HEADERS = [
  "Cédula",
  "Nombre Completo",
  "Municipio",
  "Días de NO CLASE",
  "Cita Médica",
  "Cita Médica de un Familiar",
  "Incapacidad Médica",
  "Incapacidad por Accidente Laboral",
  "Calamidad Familiar",
  "Luto",
  "Citaciones (Fiscalía, Procuraduría, Unidad de Víctimas, Colegio, Comisaría, Juzgado, Personería, EPS, ARL, etc.)",
  "Licencia de maternidad/paternidad",
  "Suspensión",
  "Permisos NO remunerados",
  "Fecha de ingreso",
  "Fecha de retiro",
  "Días Laborados",
];

function fmtFechaCol(date) {
  if (!date) return "";
  const d = new Date(String(date).slice(0, 10) + "T00:00:00Z");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = d.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}

function calcDiasLaborados(row) {
  const ingresoDay = row.fecha_ingreso
    ? new Date(String(row.fecha_ingreso).slice(0, 10) + "T00:00:00Z").getUTCDate()
    : null;
  const retiroDay = row.fecha_retiro
    ? new Date(String(row.fecha_retiro).slice(0, 10) + "T00:00:00Z").getUTCDate()
    : null;
  const susp     = Number(row.suspension || 0);
  const permisos = Number(row.permisos_no_remunerados || 0);

  let base;
  if (ingresoDay !== null && retiroDay !== null) {
    base = retiroDay - ingresoDay;
  } else if (retiroDay !== null) {
    base = retiroDay;
  } else if (ingresoDay !== null) {
    base = 30 - ingresoDay;
  } else {
    base = 30;
  }
  return Math.max(0, base - susp - permisos);
}

// Calcula filas de Variables a partir de los arrays items+novelties del grupo.
// Permite reutilizar desde buildGroupXlsx sin una consulta extra a la BD.
function computeVariablesRows(items, novelties) {
  const novByItem = new Map();
  for (const nov of (novelties || [])) {
    if (!nov.payroll_item_id) continue;
    const key = String(nov.payroll_item_id);
    if (!novByItem.has(key)) novByItem.set(key, []);
    novByItem.get(key).push(nov);
  }
  return (items || []).map((item) => {
    const novs = novByItem.get(String(item.id)) || [];
    function sumDays(type) {
      return novs.filter((n) => n.novelty_type === type).reduce((acc, n) => acc + Number(n.days || 0), 0);
    }
    const retiroNov  = novs.find((n) => n.novelty_type === "FECHA_RETIRO");
    const ingresoNov = novs.find((n) => n.novelty_type === "FECHA_INGRESO");
    return {
      document_number:         s(item.document_number),
      employee_name:           s(item.employee_name),
      municipality_name:       s(item.municipality_name),
      dias_no_clase:           sumDays("DIAS_NO_CLASE"),
      cita_medica:             sumDays("CITA_MEDICA"),
      cita_medica_familiar:    sumDays("CITA_MEDICA_FAMILIAR"),
      incapacidad_medica:      sumDays("INCAPACIDAD_MEDICA"),
      incapacidad_accidente:   sumDays("INCAPACIDAD_ACCIDENTE_LABORAL"),
      calamidad_familiar:      sumDays("CALAMIDAD_FAMILIAR"),
      luto:                    sumDays("LUTO"),
      citaciones_oficiales:    sumDays("CITACIONES_OFICIALES"),
      licencia_maternidad:     sumDays("LICENCIA_MATERNIDAD_PATERNIDAD"),
      suspension:              sumDays("SUSPENSION"),
      permisos_no_remunerados: sumDays("PERMISOS_NO_REMUNERADOS"),
      fecha_retiro:            retiroNov  ? retiroNov.start_date  : null,
      fecha_ingreso:           ingresoNov ? ingresoNov.start_date : null,
    };
  });
}

// Construye la hoja Excel "Variables Nómina" a partir de filas ya calculadas.
function makeVariablesWorksheet(rows) {
  function nv(v) { return Number(v) > 0 ? Number(v) : ""; }
  const hdrStyle = {
    font:      { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
    fill:      { fgColor: { rgb: "1E293B" }, type: "pattern", patternType: "solid" },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
  };
  const dataRows = rows.map((row) => [
    s(row.document_number),
    s(row.employee_name),
    s(row.municipality_name),
    nv(row.dias_no_clase),
    nv(row.cita_medica),
    nv(row.cita_medica_familiar),
    nv(row.incapacidad_medica),
    nv(row.incapacidad_accidente),
    nv(row.calamidad_familiar),
    nv(row.luto),
    nv(row.citaciones_oficiales),
    nv(row.licencia_maternidad),
    nv(row.suspension),
    nv(row.permisos_no_remunerados),
    fmtFechaCol(row.fecha_ingreso),
    fmtFechaCol(row.fecha_retiro),
    calcDiasLaborados(row),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([VARIABLES_HEADERS, ...dataRows]);
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) ws[addr].s = { ...hdrStyle };
  }
  ws["!freeze"]    = { xSplit: 0, ySplit: 1 };
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: VARIABLES_HEADERS.length - 1 } }) };
  ws["!cols"] = [
    { wch: 14 }, { wch: 34 }, { wch: 22 },
    { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 10 },
    { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
  ];
  return ws;
}

// Exportación standalone solo Variables (endpoint legacy /variables-export)
function buildVariablesXlsx(rows) {
  const ws = makeVariablesWorksheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Variables Nómina");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTACIÓN GLOBAL DEL PERÍODO (todos los municipios)
// Genera: Variables Nómina + Nómina + Resumen
// ─────────────────────────────────────────────────────────────────────────────
function buildPeriodFullXlsx({ periodLabel, items, novelties, totals }) {
  const nn  = (v) => Number(v || 0);
  const hdrStyle = {
    font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
    fill: { fgColor: { rgb: "1E293B" }, type: "pattern", patternType: "solid" },
    alignment: { horizontal: "center", vertical: "center" },
  };
  const totStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: "DCFCE7" }, type: "pattern", patternType: "solid" },
  };
  const MONEY = "#,##0";

  function makeSheet(headers, rows, moneyCols = [], colWidths = []) {
    const ws    = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) ws[addr].s = { ...hdrStyle };
    }
    for (const c of moneyCols) {
      for (let r = 1; r <= range.e.r; r++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr] && typeof ws[addr].v === "number") ws[addr].z = MONEY;
      }
    }
    ws["!freeze"]     = { xSplit: 0, ySplit: 1 };
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: range.e.c } }) };
    if (colWidths.length) ws["!cols"] = colWidths.map((w) => ({ wch: w }));
    return ws;
  }

  // ── Variables ─────────────────────────────────────────────────────────────
  const wsVars = makeVariablesWorksheet(computeVariablesRows(items, novelties));

  // ── Nómina (misma estructura que buildGroupXlsx, todos los municipios) ────
  const nomHdr = [
    "Documento", "Empleado", "Cargo", "Municipio", "Institución", "Sede",
    "Modalidad", "Jornada", "Categoría salarial", "Días",
    "Salario base", "Aux. transporte", "Otros recargos", "Reemplazo incapacidad", "Total devengado",
    "Salud (4%)", "Pensión (4%)", "Total deducciones",
    "Novedades", "Desc. salario", "Desc. transporte",
    "Neto a pagar", "Revisada",
  ];
  const nomMonCols = [10,11,12,13,14,15,16,17,19,20,21];
  function otrosItem(item) {
    const c = item.calculation || {};
    return Math.max(0, nn(item.other_earnings) - nn(c.internal_cover_value));
  }
  const nomRows = items.map((item) => {
    const calc = (item.calculation && typeof item.calculation === "object") ? item.calculation : {};
    return [
      s(item.document_number), s(item.employee_name), s(item.operational_position),
      s(item.municipality_name), s(item.institution_name || ""), s(item.site_name || ""),
      s(item.modality), s(item.work_time_type), s(item.salary_category), nn(item.worked_days),
      nn(item.base_salary), nn(item.transport_allowance), otrosItem(item), nn(calc.internal_cover_value), nn(item.total_devengado),
      nn(calc.deduccion_salud), nn(calc.deduccion_pension), nn(item.total_deducciones),
      nn(item.novelty_count), nn(calc.salary_discount), nn(calc.transport_discount),
      nn(item.neto_pagar), item.reviewed ? "Sí" : "No",
    ];
  });
  const nomTotal = [
    "TOTAL", "", "", "", "", "", "", "", "",
    items.reduce((a, i) => a + nn(i.worked_days), 0),
    items.reduce((a, i) => a + nn(i.base_salary), 0),
    items.reduce((a, i) => a + nn(i.transport_allowance), 0),
    items.reduce((a, i) => a + otrosItem(i), 0),
    items.reduce((a, i) => a + nn((i.calculation||{}).internal_cover_value), 0),
    nn(totals.total_devengado),
    items.reduce((a, i) => a + nn((i.calculation||{}).deduccion_salud), 0),
    items.reduce((a, i) => a + nn((i.calculation||{}).deduccion_pension), 0),
    nn(totals.total_deducciones),
    nn(totals.novelties),
    items.reduce((a, i) => a + nn((i.calculation||{}).salary_discount), 0),
    items.reduce((a, i) => a + nn((i.calculation||{}).transport_discount), 0),
    nn(totals.neto),
    `${nn(totals.items_reviewed)}/${nn(totals.employees)} rev.`,
  ];
  const wsNom = makeSheet(nomHdr, [...nomRows, nomTotal], nomMonCols,
    [14,32,22,20,28,20,10,10,10,5,14,14,12,18,15,12,12,15,7,13,13,14,8]);
  const nomTotR = nomRows.length + 1;
  for (let c = 0; c < nomHdr.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: nomTotR, c });
    if (wsNom[addr]) { wsNom[addr].s = { ...totStyle }; if (typeof wsNom[addr].v === "number") wsNom[addr].z = MONEY; }
  }

  // ── Resumen global del período — columnas dinámicas por municipio ────────
  const muniNamesSet = [...new Set(items.map((i) => i.municipality_name || "").filter(Boolean))].sort();
  const muniTotals = muniNamesSet.map((mName) => {
    const mItems = items.filter((i) => i.municipality_name === mName);
    return {
      name:             mName,
      employees:        mItems.length,
      items_reviewed:   mItems.filter((i) => i.reviewed).length,
      items_pending:    mItems.filter((i) => !i.reviewed).length,
      novelties:        mItems.reduce((a, i) => a + nn(i.novelty_count), 0),
      total_devengado:  mItems.reduce((a, i) => a + nn(i.total_devengado), 0),
      total_deducciones:mItems.reduce((a, i) => a + nn(i.total_deducciones), 0),
      neto:             mItems.reduce((a, i) => a + nn(i.neto_pagar), 0),
    };
  });
  const sumMf = (key) => muniTotals.reduce((a, m) => a + nn(m[key]), 0);
  const TOTALG = "TOTAL GENERAL";
  const resHdrFull = ["Concepto", ...muniTotals.map((m) => m.name.toUpperCase()), TOTALG];
  const resRowsFull = [
    ["Período",            ...muniTotals.map(() => periodLabel),           periodLabel],
    ["", ...muniTotals.map(() => ""), ""],
    ["── EMPLEADOS ──",    ...muniTotals.map(() => ""),                    ""],
    ["Total empleados",    ...muniTotals.map((m) => m.employees),          sumMf("employees")],
    ["Items revisados",    ...muniTotals.map((m) => m.items_reviewed),     sumMf("items_reviewed")],
    ["Items pendientes",   ...muniTotals.map((m) => m.items_pending),      sumMf("items_pending")],
    ["", ...muniTotals.map(() => ""), ""],
    ["── NOVEDADES ──",    ...muniTotals.map(() => ""),                    ""],
    ["Total novedades",    ...muniTotals.map((m) => m.novelties),          sumMf("novelties")],
    ["", ...muniTotals.map(() => ""), ""],
    ["── VALORES ──",      ...muniTotals.map(() => ""),                    ""],
    ["Total devengado",    ...muniTotals.map((m) => m.total_devengado),    sumMf("total_devengado")],
    ["Total deducciones",  ...muniTotals.map((m) => m.total_deducciones),  sumMf("total_deducciones")],
    ["Neto total",         ...muniTotals.map((m) => m.neto),               sumMf("neto")],
  ];
  const resHdrStyle2 = { font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 }, fill: { fgColor: { rgb: "1E293B" }, type: "pattern", patternType: "solid" }, alignment: { horizontal: "center", vertical: "center" } };
  const resSectStyle2 = { font: { bold: true, color: { rgb: "334155" }, sz: 10 }, fill: { fgColor: { rgb: "F1F5F9" }, type: "pattern", patternType: "solid" } };
  const resTotStyle2  = { font: { bold: true }, fill: { fgColor: { rgb: "DCFCE7" }, type: "pattern", patternType: "solid" } };
  const wsRes = (() => {
    const ws = XLSX.utils.aoa_to_sheet([resHdrFull, ...resRowsFull]);
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) ws[addr].s = { ...resHdrStyle2 };
    }
    resRowsFull.forEach((row, ri) => {
      const isSect = String(row[0]).startsWith("──");
      const isTot  = String(row[0]) === "Neto total";
      for (let c = 0; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r: ri + 1, c });
        if (!ws[addr]) continue;
        if (isSect) { ws[addr].s = { ...resSectStyle2 }; continue; }
        if (isTot)  { ws[addr].s = { ...resTotStyle2  }; }
        if (c > 0 && !isSect && typeof ws[addr].v === "number") ws[addr].z = "#,##0";
      }
    });
    ws["!freeze"]     = { xSplit: 1, ySplit: 1 };
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: range.e.c } }) };
    ws["!cols"] = [{ wch: 28 }, ...muniTotals.map(() => ({ wch: 22 })), { wch: 22 }];
    return ws;
  })();

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsVars, "Variables Nómina");
  XLSX.utils.book_append_sheet(wb, wsNom,  "Nómina");
  XLSX.utils.book_append_sheet(wb, wsRes,  "Resumen");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
}

// GET /payroll/periods/:periodId/full-export — todos los municipios del período
async function handlePeriodFullExport(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  const parts    = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.EXPORT,
    async (innerReq, innerRes) => {
      try {
        console.log("[EXPORT] Exportación completa del período:", periodId);
        console.log("[MEMORY] inicio:", Math.round(process.memoryUsage().heapUsed / 1024 / 1024), "MB");

        const { items, novelties, totals, periodLabel } = await operational.getPeriodItemsForExport(periodId);

        const payrollRows = (items     || []).length;
        const noveltyRows = (novelties || []).length;
        console.log("[EXPORT] Volumen período", periodId, "(", periodLabel, "):", {
          payrollRows, noveltyRows,
        });
        if (payrollRows > 5000) console.warn("[EXPORT WARNING] payrollRows > 5000:", payrollRows);
        if (noveltyRows > 5000) console.warn("[EXPORT WARNING] noveltyRows > 5000:", noveltyRows);

        // Desglose por municipio para detectar cuál tiene datos anómalos
        const muniBreakdown = {};
        for (const item of (items || [])) {
          const mName = item.municipality_name || "sin municipio";
          if (!muniBreakdown[mName]) muniBreakdown[mName] = { items: 0 };
          muniBreakdown[mName].items++;
        }
        console.log("[EXPORT] Items por municipio:", muniBreakdown);
        console.log("[MEMORY] antes de generar Excel:", Math.round(process.memoryUsage().heapUsed / 1024 / 1024), "MB");

        let buf;
        try {
          buf = buildPeriodFullXlsx({ periodLabel, items, novelties, totals });
        } catch (xlsxErr) {
          console.error("[EXPORT XLSX ERROR] Fallo al generar workbook período completo", periodId);
          console.error("[EXPORT XLSX ERROR] Volumen: items=%d novs=%d", payrollRows, noveltyRows);
          console.error("[EXPORT XLSX ERROR] Municipios:", Object.keys(muniBreakdown));
          console.error(xlsxErr);
          throw new Error(`Error generando Excel período ${periodId}: ${xlsxErr.message}`);
        }

        console.log("[MEMORY] después de generar Excel:", Math.round(process.memoryUsage().heapUsed / 1024 / 1024), "MB");
        console.log("[EXPORT] Excel generado, tamaño:", Math.round(buf.length / 1024), "KB");

        const safeLbl  = (periodLabel || String(periodId)).replace(/[^a-z0-9\-_]/gi, "-");
        const filename = `nomina-completa-${safeLbl}.xlsx`;
        innerRes.writeHead(200, {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": buf.length,
        });
        innerRes.end(buf);
      } catch (err) {
        console.error("[EXPORT PERIODO ERROR] periodId =", periodId, "| mensaje:", err.message);
        console.error(err.stack);
        sendJson(innerRes, 400, { ok: false, message: err.message, stack: process.env.NODE_ENV !== "production" ? err.stack : undefined });
      }
    }
  )(req, res, url);
}

// GET /payroll/periods/:periodId/variables-export?groupId=X
async function handleVariablesExport(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  const parts    = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }
  const groupId = url.searchParams.get("groupId") ? Number(url.searchParams.get("groupId")) : null;
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.EXPORT,
    async (innerReq, innerRes) => {
      try {
        const rows  = await operational.getVariablesExportData(periodId, groupId);
        const { rows: periodRows } = await (require("../../db/pool")).query(
          `SELECT label FROM payroll_periods WHERE id = $1`, [periodId]
        );
        const periodLabel = periodRows[0]?.label || String(periodId);
        const buf      = buildVariablesXlsx(rows, periodLabel);
        const safeLbl  = periodLabel.replace(/[^a-z0-9\-_]/gi, "-");
        const filename = `variables-nomina-${safeLbl}.xlsx`;
        innerRes.writeHead(200, {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": buf.length,
        });
        innerRes.end(buf);
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANTILLA MENSUAL DE NOVEDADES — descarga
// GET /payroll/periods/:id/novelties-template
// ─────────────────────────────────────────────────────────────────────────────
const novTemplate = require("./payroll.novelties-template");

async function handleNoveltiesTemplate(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl) => {
      const parts    = url.pathname.split("/").filter(Boolean);
      const periodId = Number(parts[2]);
      if (!Number.isFinite(periodId) || periodId <= 0) {
        sendJson(innerRes, 400, { ok: false, message: "periodId inválido" }); return;
      }
      try {
        const buf = await novTemplate.generateNoveltiesTemplate(periodId);
        innerRes.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        innerRes.setHeader("Content-Disposition", `attachment; filename="plantilla-novedades-periodo-${periodId}.xlsx"`);
        innerRes.end(buf);
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANTILLA MENSUAL DE NOVEDADES — importación
// POST /payroll/periods/:id/import-novelties-template  (Express + multer en app.js)
// El handler recibe el buffer ya parseado por multer en req.file.buffer
// ─────────────────────────────────────────────────────────────────────────────
async function handleImportNoveltiesTemplate(req, res) {
  const auth = require("../../modules/auth/auth.helpers").requireAuth(req, res);
  if (!auth) return;

  const parts    = req.url ? req.url.split("/").filter(Boolean) : [];
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    res.status(400).json({ ok: false, message: "periodId inválido" }); return;
  }
  if (!req.file || !req.file.buffer) {
    res.status(400).json({ ok: false, message: "Archivo Excel requerido" }); return;
  }

  try {
    const result = await novTemplate.importNoveltiesTemplate(periodId, req.file.buffer, auth.user.id);
    res.status(result.ok ? 200 : 422).json({ ok: result.ok, data: result });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
}

module.exports = {
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
  // Nuevos (033)
  handleSalaryCategories,
  handleOfficialNoveltyTypes,
  handleItemPayslip,
  handleTurnCoverBankInfo,
  handleChargeAccountHtml,
  handleCambioOperativo,
  // Nuevo (036)
  handleItemReviewed,
  handleDeleteNovelty,
  // Exportación por municipio (detallada)
  handleGroupExport,
  handleMultiGroupExport,
  handleGroupClose,
  handleGroupReopen,
  handleGroupHistory,
  handleGroupTurns,
  handleExternalWorkerDocs,
  // Exportación formato Variables
  handleVariablesExport,
  // Exportación completa del período (todos los municipios)
  handlePeriodFullExport,
  // Configuración salarial individual (Gestores, Auxiliares, Equipo Mínimo)
  handleEmployeeSalaryConfig,
  // Plantilla mensual de novedades por días (056)
  handleNoveltiesTemplate,
  handleImportNoveltiesTemplate,
};
