const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { readJsonBody } = require("../../http/request");
const { withModuleProtection } = require("../../http/protection");
const { ACTIONS, MODULES } = require("../../auth/permissions");

const {
  listRequests,
  getRequestById,
  createRequest,
  updateRequest,
  getRequestsSummary,
  REQUEST_TYPES,
  REQUEST_STATUSES,
} = require("./requests.repository");

// ─────────────────────────────────────────────
// GET  /employee-requests
// POST /employee-requests
// ─────────────────────────────────────────────
async function handleRequests(req, res, url) {
  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.EMPLOYEE_REQUESTS,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user, resource) => {
        const filters = {
          companyId:   innerUrl.searchParams.get("companyId")   || resource.companyId,
          contractId:  innerUrl.searchParams.get("contractId")  || resource.contractId,
          employeeId:  innerUrl.searchParams.get("employeeId"),
          requestType: innerUrl.searchParams.get("requestType"),
          status:      innerUrl.searchParams.get("status"),
        };

        const data = await listRequests(filters);
        sendJson(innerRes, 200, { ok: true, data });
      }
    )(req, res, url);
  }

  if (req.method === "POST") {
    return withModuleProtection(
      MODULES.EMPLOYEE_REQUESTS,
      ACTIONS.CREATE,
      async (innerReq, innerRes, innerUrl, user) => {
        const body = await readJsonBody(innerReq);
        const request = await createRequest(body, user.id);
        sendJson(innerRes, 201, {
          ok: true,
          data: request,
          message: "Solicitud registrada correctamente",
        });
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// ─────────────────────────────────────────────
// GET   /employee-requests/:id
// PATCH /employee-requests/:id
// ─────────────────────────────────────────────
async function handleRequestById(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const id = Number(parts[1]);

  if (!Number.isFinite(id) || id <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de solicitud inválido" });
    return;
  }

  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.EMPLOYEE_REQUESTS,
      ACTIONS.VIEW,
      async (innerReq, innerRes) => {
        const data = await getRequestById(id);
        if (!data) {
          sendJson(innerRes, 404, { ok: false, message: "Solicitud no encontrada" });
          return;
        }
        sendJson(innerRes, 200, { ok: true, data });
      }
    )(req, res, url);
  }

  if (req.method === "PATCH" || req.method === "PUT") {
    return withModuleProtection(
      MODULES.EMPLOYEE_REQUESTS,
      ACTIONS.UPDATE,
      async (innerReq, innerRes, innerUrl, user) => {
        const body = await readJsonBody(innerReq);
        const data = await updateRequest(id, body, user.id);
        sendJson(innerRes, 200, {
          ok: true,
          data,
          message: "Solicitud actualizada correctamente",
        });
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// ─────────────────────────────────────────────
// GET /employee-requests/summary
// ─────────────────────────────────────────────
async function handleRequestsSummary(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  return withModuleProtection(
    MODULES.EMPLOYEE_REQUESTS,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user, resource) => {
      const filters = {
        companyId:  innerUrl.searchParams.get("companyId")  || resource.companyId,
        contractId: innerUrl.searchParams.get("contractId") || resource.contractId,
      };

      const data = await getRequestsSummary(filters);
      sendJson(innerRes, 200, { ok: true, data });
    }
  )(req, res, url);
}

// GET /employee-requests/types
function handleRequestTypes(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  sendJson(res, 200, {
    ok: true,
    data: REQUEST_TYPES,
    statuses: REQUEST_STATUSES,
  });
}

module.exports = {
  handleRequests,
  handleRequestById,
  handleRequestsSummary,
  handleRequestTypes,
};
