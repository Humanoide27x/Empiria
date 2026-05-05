const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { readJsonBody } = require("../../http/request");
const { withModuleProtection } = require("../../http/protection");
const { ACTIONS, MODULES } = require("../../auth/permissions");

const {
  listNovelties,
  getNoveltyById,
  createNovelty,
  updateNoveltyStatus,
  getPayrollSummary,
  NOVELTY_TYPES,
  NOVELTY_STATUSES,
} = require("./payroll.repository");

function getIdFromPath(pathname, prefix) {
  const raw = String(pathname || "").replace(prefix, "").split("/").filter(Boolean)[0];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
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
// PATCH  /payroll/novelties/:id/status
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
  // Extraer el id de /payroll/novelties/42/status
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

// GET /payroll/novelty-types  — catálogo de tipos de novedad
function handleNoveltyTypes(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  sendJson(res, 200, {
    ok: true,
    data: NOVELTY_TYPES,
    statuses: NOVELTY_STATUSES,
  });
}

module.exports = {
  handleNovelties,
  handleNoveltyById,
  handleNoveltyStatus,
  handlePayrollSummary,
  handleNoveltyTypes,
};
