const { requireAuth } = require("../modules/auth/auth.helpers");
const { evaluateModuleAccess } = require("../auth/access");
const { sendJson } = require("./response");

function getDefaultResourceForUser(user) {
  return {
    companyId: user.companyId ?? null,
    contractId: user.contractId ?? null,
    municipality: user.assignedMunicipalities?.[0] || null,
  };
}

function withModuleProtection(moduleKey, action, handler, getResource) {
  return async function protectedHandler(req, res, url) {
    const auth = requireAuth(req, res);

    if (!auth) {
      return;
    }

    try {
      const resource =
        typeof getResource === "function"
          ? await getResource(req, res, url, auth.user)
          : getDefaultResourceForUser(auth.user);

      const access = evaluateModuleAccess(
        auth.user,
        moduleKey,
        action,
        resource,
      );

      if (!access.allowed) {
        sendJson(res, 403, {
          ok: false,
          message: access.reason || "No tienes permisos para esta accion",
          module: moduleKey,
          action,
        });
        return;
      }

      await handler(req, res, url, auth.user, resource, access);
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        message: "Error interno validando permisos",
        detail: error.message,
      });
    }
  };
}

module.exports = {
  withModuleProtection,
  getDefaultResourceForUser,
};