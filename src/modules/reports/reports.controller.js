const { withModuleProtection } = require("../../http/protection");
const { readJsonBody } = require("../../http/request");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { ACTIONS, MODULES, getRolePermissions } = require("../../auth/permissions");
const { matchesUserScope } = require("../../auth/access");
const { getPersonnel } = require("../../data/personnel");
const { createReport, getReports } = require("../../data/reports");

function getScopedPersonnel(user) {
  return getPersonnel().filter((record) =>
    matchesUserScope(user, {
      companyId: record.companyId,
      contractId: record.contractId,
      municipality: record.municipality,
    })
  );
}

function getScopedReports(user) {
  return getReports().filter((report) =>
    matchesUserScope(user, {
      companyId: report.companyId,
      contractId: report.contractId,
      municipality: null,
    })
  );
}

function getAvailableReportTemplates(user) {
  const rolePermissions = getRolePermissions(user.role);
  const features =
    rolePermissions?.modules?.[MODULES.REPORTS]?.features || [];

  const templates = [
    {
      id: "resumen_general",
      title: "Resumen general",
      description:
        "Resume el personal visible, activos y novedades del alcance del usuario.",
    },
  ];

  if (features.includes("20_por_ciento_madres_cabeza_familia")) {
    templates.push({
      id: "madres_cabeza_familia",
      title: "20% madres cabeza de familia",
      description:
        "Calcula el porcentaje visible de madres cabeza de familia en el personal.",
    });
  }

  if (features.includes("cambio_personal_carta_solicitud")) {
    templates.push({
      id: "cambio_personal",
      title: "Cambio de personal",
      description:
        "Resume el personal con novedades y deja nota de carta de solicitud y hoja de vida anexa.",
    });
  }

  return templates;
}

function buildReportContent(user, template) {
  const scopedPersonnel = getScopedPersonnel(user);
  const totalPersonnel = scopedPersonnel.length;
  const activePersonnel = scopedPersonnel.filter(
    (item) => item.status === "activo"
  ).length;
  const noveltyPersonnel = scopedPersonnel.filter(
    (item) => item.status === "novedad"
  ).length;
  const headOfHouseholdCount = scopedPersonnel.filter(
    (item) => item.headOfHousehold
  ).length;
  const headOfHouseholdPercent = totalPersonnel
    ? Number(((headOfHouseholdCount / totalPersonnel) * 100).toFixed(2))
    : 0;

  if (template === "madres_cabeza_familia") {
    return {
      summary:
        "Reporte del porcentaje de madres cabeza de familia dentro del personal visible.",
      metrics: {
        totalPersonnel,
        headOfHouseholdCount,
        headOfHouseholdPercent,
      },
      notes: ["Este reporte usa los registros visibles para el rol actual."],
    };
  }

  if (template === "cambio_personal") {
    return {
      summary: "Reporte de novedades y cambios de personal.",
      metrics: {
        totalPersonnel,
        noveltyPersonnel,
      },
      notes: [
        "Adjuntar carta de solicitud cuando aplique.",
        "Adjuntar PDF con hoja de vida del reemplazo cuando corresponda.",
      ],
      people: scopedPersonnel
        .filter(
          (item) => item.status === "novedad" || item.status === "retiro"
        )
        .map((item) => ({
          fullName: item.fullName,
          position: item.position,
          municipality: item.municipality,
          status: item.status,
        })),
    };
  }

  return {
    summary: "Reporte general del alcance visible para este usuario.",
    metrics: {
      totalPersonnel,
      activePersonnel,
      noveltyPersonnel,
    },
    notes: [
      "Este resumen se genera con el personal visible para el usuario actual.",
    ],
  };
}

function handleReports(req, res, url) {
  if (req.method === "GET") {
    withModuleProtection(
      MODULES.REPORTS,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user) => {
        sendJson(innerRes, 200, {
          ok: true,
          templates: getAvailableReportTemplates(user),
          reports: getScopedReports(user),
          defaults: {
            companyId: user.companyId,
            contractId: user.contractId,
          },
        });
      }
    )(req, res, url);
    return;
  }

  if (req.method === "POST") {
    withModuleProtection(
      MODULES.REPORTS,
      ACTIONS.CREATE,
      async (innerReq, innerRes, innerUrl, user) => {
        try {
          const body = await readJsonBody(innerReq);
          const templates = getAvailableReportTemplates(user);

          if (!templates.find((item) => item.id === body.template)) {
            sendJson(innerRes, 403, {
              ok: false,
              message: "Ese tipo de informe no esta permitido para este rol",
            });
            return;
          }

          const report = createReport({
            title: body.title,
            template: body.template,
            createdByRole: user.role,
            companyId: body.companyId ?? user.companyId,
            contractId: body.contractId ?? user.contractId,
            content: buildReportContent(user, body.template),
          });

          sendJson(innerRes, 201, {
            ok: true,
            message: "Informe creado correctamente",
            report,
          });
        } catch (error) {
          sendJson(innerRes, 400, {
            ok: false,
            message: error.message,
          });
        }
      }
    )(req, res, url);
    return;
  }

  sendMethodNotAllowed(res);
}

module.exports = {
  handleReports,
};