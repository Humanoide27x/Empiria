const { requireAuth } = require("../auth/auth.helpers");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { getTenantIdForRequest } = require("../../tenancy/tenant");
const service = require("./companies.service");

async function handleGetCompanies(req, res) {
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
    const companies = await service.getCompanies(tenantId);

    sendJson(res, 200, {
      ok: true,
      tenantId,
      companies,
    });
  } catch (error) {
    console.error("Error companies:", error);

    sendJson(res, 500, {
      ok: false,
      message: "No fue posible consultar las empresas",
    });
  }
}

module.exports = {
  handleGetCompanies,
};
