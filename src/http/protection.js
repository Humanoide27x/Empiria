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
    tenantId:   getTenantIdFromRequest(req, user),
    companyId:  user?.companyId  ?? user?.company_id  ?? null,
    contractId: user?.contractId ?? user?.contract_id ?? null,
    municipality:
      Array.isArray(user?.assignedMunicipalities) &&
      user.assignedMunicipalities.length
        ? user.assignedMunicipalities[0]
        : null,
  };
}

// Returns true for non-admin users that have no company/contract assigned (demo users).
function isDemoUser(user) {
  const role       = (user?.role || "").toLowerCase();
  const companyId  = user?.companyId  ?? user?.company_id  ?? null;
  const contractId = user?.contractId ?? user?.contract_id ?? null;
  return role !== "administrador" && !companyId && !contractId;
}

function mergeResource(userResource, requestResource, user) {
  // For users bound to a specific company/contract, ignore URL params for those fields.
  // This prevents contract-scoped users from querying other companies via query string.
  if (userResource.companyId || userResource.contractId) {
    return {
      tenantId:     requestResource.tenantId ?? userResource.tenantId,
      companyId:    userResource.companyId,
      contractId:   userResource.contractId,
      municipality: requestResource.municipality ?? userResource.municipality,
    };
  }
  return {
    tenantId:     requestResource.tenantId ?? userResource.tenantId,
    companyId:    requestResource.companyId ?? userResource.companyId,
    contractId:   requestResource.contractId ?? userResource.contractId,
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
      const resource = mergeResource(defaultResource, requestResource, user);

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
        message: error?.message || "Error interno del servidor",
      });
    }
  };
}

module.exports = {
  withModuleProtection,
  getDefaultResourceForUser,
  parseResourceFromRequest,
  isDemoUser,
};
