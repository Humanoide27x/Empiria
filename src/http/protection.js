const { sendJson } = require("./response");
const { requireAuth } = require("../modules/auth/auth.helpers");
const { evaluateModuleAccess } = require("../auth/access");

function getDefaultResourceForUser(user) {
  return {
    companyId: user?.companyId ?? null,
    contractId: user?.contractId ?? null,
    municipality:
      Array.isArray(user?.assignedMunicipalities) &&
      user.assignedMunicipalities.length
        ? user.assignedMunicipalities[0]
        : null,
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
      const resource = getDefaultResourceForUser(user);

      const access = evaluateModuleAccess(user, moduleKey, action, resource);

      if (!access.allowed) {
        sendJson(res, 403, {
          ok: false,
          message: access.reason || "Acceso denegado",
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
};