const { requireAuth } = require("../auth/auth.helpers");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { getTenantIdForRequest } = require("../../tenancy/tenant");
const service = require("./contracts.service");
const repository = require("./contracts.repository");

async function handleGetContracts(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) {
    return;
  }

  try {
    const tenantId = getTenantIdForRequest(req, auth.user);
    const companyIdRaw = url?.searchParams?.get("companyId") || url?.searchParams?.get("company_id");
    const companyId = companyIdRaw ? Number(companyIdRaw) : null;
    const contracts = await service.getContracts(tenantId, companyId);

    sendJson(res, 200, {
      ok: true,
      tenantId,
      data: contracts,
      contracts,
    });
  } catch (error) {
    console.error("Error contracts:", error);

    sendJson(res, 500, {
      ok: false,
      message: "No fue posible consultar los contratos",
    });
  }
}

async function handleGetContractPositions(req, res, contractId) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  const auth = requireAuth(req, res);
  if (!auth) return;
  try {
    const positions = await repository.getContractPositions(contractId);
    sendJson(res, 200, { ok: true, positions });
  } catch (err) {
    sendJson(res, 500, { ok: false, message: err.message });
  }
}

module.exports = {
  handleGetContracts,
  handleGetContractPositions,
};
