const { withModuleProtection } = require("../../http/protection");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { ACTIONS, MODULES } = require("../../auth/permissions");
const { matchesUserScope } = require("../../auth/access");
const { getPersonnel } = require("../../data/personnel");

function getScopedPersonnel(user) {
  return getPersonnel().filter((record) =>
    matchesUserScope(user, {
      companyId: record.companyId,
      contractId: record.contractId,
      municipality: record.municipality,
    })
  );
}

function handleDashboardSummary(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  withModuleProtection(
    MODULES.DASHBOARD,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user) => {
      const visiblePersonnel = getScopedPersonnel(user);
      const activeCount = visiblePersonnel.filter(
        (item) => item.status === "activo"
      ).length;
      const noveltyCount = visiblePersonnel.filter(
        (item) => item.status === "novedad"
      ).length;
      const municipalities = [
        ...new Set(visiblePersonnel.map((item) => item.municipality)),
      ];

      sendJson(innerRes, 200, {
        ok: true,
        summary: {
          totalPersonnel: visiblePersonnel.length,
          activePersonnel: activeCount,
          noveltyPersonnel: noveltyCount,
          visibleMunicipalities: municipalities.length,
          visibleContracts: [
            ...new Set(visiblePersonnel.map((item) => item.contractId)),
          ].length,
        },
        recentPersonnel: visiblePersonnel.slice(0, 5),
      });
    }
  )(req, res, url);
}

module.exports = {
  handleDashboardSummary,
};