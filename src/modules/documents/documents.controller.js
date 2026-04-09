const { ACTIONS, MODULES } = require("../../auth/permissions");
const { getRolePermissions } = require("../../auth/access");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { withModuleProtection } = require("../../http/protection");
const {
  getScopedPersonnel,
  getVisibleResumeRecords,
} = require("../../data/personnel");

function handleResumeView(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  withModuleProtection(
    MODULES.RESUME_VIEW,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user) => {
      const filters = {
        site: innerUrl.searchParams.get("site") || "",
        institution: innerUrl.searchParams.get("institution") || "",
        modality: innerUrl.searchParams.get("modality") || "",
      };

      const records = getVisibleResumeRecords(user, filters);
      const rolePermissions = getRolePermissions(user.role);

      sendJson(innerRes, 200, {
        ok: true,
        filters,
        availableFilters: {
          sites: [...new Set(getScopedPersonnel(user).map((item) => item.site).filter(Boolean))],
          institutions: [
            ...new Set(getScopedPersonnel(user).map((item) => item.institution).filter(Boolean)),
          ],
          modalities: [
            ...new Set(getScopedPersonnel(user).map((item) => item.modality).filter(Boolean)),
          ],
        },
        visibleFields: rolePermissions?.modules?.[MODULES.RESUME_VIEW]?.fields || [],
        records,
      });
    },
  )(req, res, url);
}

module.exports = {
  handleResumeView,
};