const { sendJson } = require("./response");
const { requireAuth } = require("../modules/auth/auth.helpers");
const { evaluateModuleAccess } = require("../auth/access");
const { getTenantIdFromRequest } = require("../tenancy/tenant");

function parseResourceFromRequest(url) {
  const searchParams = url?.searchParams;

  const tenantIdRaw =
    searchParams?.get("tenantId") ??
    searchParams?.get("tenant_id") ??
    searchParams?.get("clienteId") ??
    searchParams?.get("client_id");

  const companyIdRaw =
    searchParams?.get("companyId") ??
    searchParams?.get("empresaId") ??
    searchParams?.get("company_id");

  const contractIdRaw =
    searchParams?.get("contractId") ??
    searchParams?.get("contratoId") ??
    searchParams?.get("contract_id");

  const municipalityRaw =
    searchParams?.get("municipality") ??
    searchParams?.get("municipio");

  return {
    tenantId: tenantIdRaw ? Number(tenantIdRaw) : null,
    companyId: companyIdRaw ? Number(companyIdRaw) : null,
    contractId: contractIdRaw ? Number(contractIdRaw) : null,
    municipality: municipalityRaw ? String(municipalityRaw).trim() : null,
  };
}

function getDefaultResourceForUser(user, req) {
  return {
    tenantId: getTenantIdFromRequest(req, user),
    companyId: user?.companyId ?? null,
    contractId: user?.contractId ?? null,
    municipality:
      Array.isArray(user?.assignedMunicipalities) &&
      user.assignedMunicipalities.length
        ? user.assignedMunicipalities[0]
        : null,
  };
}

function mergeResource(userResource, requestResource) {
  return {
    tenantId: requestResource.tenantId ?? userResource.tenantId,
    companyId: requestResource.companyId ?? userResource.companyId,
    contractId: requestResource.contractId ?? userResource.contractId,
    municipality: requestResource.municipality ?? userResource.municipality,
  };
}

function withModuleProtection(moduleKey, action, handler) {
  return async function protectedHandler(req, res, url) {
    try {
      const auth = requireAuth(req, res);

      if (!auth) {
        return;
      }

      const user = auth.user;
      const defaultResource = getDefaultResourceForUser(user, req);
      const requestResource = parseResourceFromRequest(url);
      const resource = mergeResource(defaultResource, requestResource);

      const access = evaluateModuleAccess(user, moduleKey, action, resource);

      if (!access || !access.allowed) {
        sendJson(res, 403, {
          ok: false,
          message: access?.reason || "Acceso denegado",
        });
        return;
      }

      await handler(req, res, url, user, resource);
    } catch (error) {
      console.error("Error en protección de módulo:", error);

      sendJson(res, 500, {
        ok: false,
        message: "Error interno validando permisos",
      });
    }
  };
}

module.exports = {
  withModuleProtection,
  getDefaultResourceForUser,
  parseResourceFromRequest,
};
