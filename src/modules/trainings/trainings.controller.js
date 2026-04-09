const { withModuleProtection, getDefaultResourceForUser } = require("../../http/protection");
const { readJsonBody } = require("../../http/request");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { ACTIONS, MODULES } = require("../../auth/permissions");
const { evaluateModuleAccess, matchesUserScope } = require("../../auth/access");
const {
  createTraining,
  getAttendance,
  getTrainings,
  markAttendance,
} = require("../../data/trainings");
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

function getScopedTrainings(user) {
  return getTrainings().filter((training) =>
    matchesUserScope(user, {
      companyId: training.companyId,
      contractId: training.contractId,
      municipality: training.municipality,
    })
  );
}

function getVisibleTrainingAttendance(user) {
  const visibleTrainings = getScopedTrainings(user);
  const visibleTrainingIds = new Set(visibleTrainings.map((item) => item.id));
  const scopedPersonnel = getScopedPersonnel(user);
  const personnelMap = new Map(scopedPersonnel.map((item) => [item.id, item]));

  return visibleTrainings.map((training) => {
    const attendanceRows = getAttendance()
      .filter(
        (item) =>
          visibleTrainingIds.has(item.trainingId) &&
          item.trainingId === training.id
      )
      .map((item) => ({
        ...item,
        personnel: personnelMap.get(item.personnelId) || null,
      }));

    return {
      ...training,
      attendance: attendanceRows,
    };
  });
}

function handleTrainings(req, res, url) {
  if (req.method === "GET") {
    withModuleProtection(
      MODULES.TRAINING,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user) => {
        sendJson(innerRes, 200, {
          ok: true,
          trainings: getScopedTrainings(user),
          canCreate: evaluateModuleAccess(
            user,
            MODULES.TRAINING,
            ACTIONS.CREATE,
            getDefaultResourceForUser(user)
          ).allowed,
        });
      }
    )(req, res, url);
    return;
  }

  if (req.method === "POST") {
    withModuleProtection(
      MODULES.TRAINING,
      ACTIONS.CREATE,
      async (innerReq, innerRes, innerUrl, user) => {
        try {
          const body = await readJsonBody(innerReq);

          const training = {
            ...body,
            companyId: body.companyId ?? user.companyId,
            contractId: body.contractId ?? user.contractId,
            createdByRole: user.role,
          };

          const inScope = matchesUserScope(user, {
            companyId: Number(training.companyId),
            contractId: Number(training.contractId),
            municipality: training.municipality,
          });

          if (!inScope) {
            sendJson(innerRes, 403, {
              ok: false,
              message: "No puedes crear capacitaciones fuera de tu alcance",
            });
            return;
          }

          const created = createTraining(training);

          sendJson(innerRes, 201, {
            ok: true,
            message: "Capacitacion creada correctamente",
            training: created,
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

function handleTrainingAttendance(req, res, url) {
  if (req.method === "GET") {
    withModuleProtection(
      MODULES.TRAINING,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user) => {
        sendJson(innerRes, 200, {
          ok: true,
          trainings: getVisibleTrainingAttendance(user),
          personnel: getScopedPersonnel(user),
        });
      }
    )(req, res, url);
    return;
  }

  if (req.method === "POST") {
    withModuleProtection(
      MODULES.TRAINING,
      ACTIONS.ATTENDANCE,
      async (innerReq, innerRes, innerUrl, user) => {
        try {
          const body = await readJsonBody(innerReq);

          const training = getScopedTrainings(user).find(
            (item) => item.id === Number(body.trainingId)
          );

          const personnel = getScopedPersonnel(user).find(
            (item) => item.id === Number(body.personnelId)
          );

          if (!training || !personnel) {
            sendJson(innerRes, 403, {
              ok: false,
              message:
                "No puedes marcar asistencia sobre registros fuera de tu alcance",
            });
            return;
          }

          const updated = markAttendance({
            trainingId: body.trainingId,
            personnelId: body.personnelId,
            status: body.status,
            markedByRole: user.role,
          });

          sendJson(innerRes, 200, {
            ok: true,
            message: "Asistencia actualizada correctamente",
            attendance: updated,
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
  handleTrainings,
  handleTrainingAttendance,
};