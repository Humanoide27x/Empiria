const { withModuleProtection, getDefaultResourceForUser } = require("../../http/protection");
const { readJsonBody } = require("../../http/request");
const {
  sendJson,
  sendMethodNotAllowed,
} = require("../../http/response");

const { ACTIONS, MODULES } = require("../../auth/permissions");
const { evaluateModuleAccess, matchesUserScope } = require("../../auth/access");

const {
  getPersonnel,
  createPersonnel,
  updatePersonnel,
  removePersonnel,
} = require("./service");

function getScopedPersonnel(user) {
  return getPersonnel().filter((record) =>
    matchesUserScope(user, {
      companyId: record.companyId,
      contractId: record.contractId,
      municipality: record.municipality,
    }),
  );
}

function getPersonnelIdFromPath(pathname) {
  const match = pathname.match(/^\/personnel\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function getPersonnelStatusPathId(pathname) {
  const match = pathname.match(/^\/personnel\/(\d+)\/status$/);
  return match ? Number(match[1]) : null;
}

async function handlePersonnel(req, res, url) {
  const personnelId = getPersonnelIdFromPath(url.pathname);
  const statusPersonnelId = getPersonnelStatusPathId(url.pathname);

  if (req.method === "GET" && url.pathname === "/personnel") {
    withModuleProtection(
      MODULES.PERSONNEL,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user) => {
        sendJson(innerRes, 200, {
          ok: true,
          personnel: getScopedPersonnel(user),
          canCreate: evaluateModuleAccess(
            user,
            MODULES.PERSONNEL,
            ACTIONS.CREATE,
            getDefaultResourceForUser(user),
          ).allowed,
        });
      },
    )(req, res, url);
    return;
  }

  if (req.method === "POST" && url.pathname === "/personnel") {
    withModuleProtection(
      MODULES.PERSONNEL,
      ACTIONS.CREATE,
      async (innerReq, innerRes, innerUrl, user) => {
        try {
          const body = await readJsonBody(innerReq);

          const record = {
            ...body,
            companyId: body.companyId ?? user.companyId,
            contractId: body.contractId ?? user.contractId,
          };

          const inScope = matchesUserScope(user, {
            companyId: Number(record.companyId),
            contractId: Number(record.contractId),
            municipality: record.municipality,
          });

          if (!inScope) {
            sendJson(innerRes, 403, {
              ok: false,
              message: "No puedes crear personal fuera de tu alcance",
            });
            return;
          }

          const created = createPersonnel(record);

          sendJson(innerRes, 201, {
            ok: true,
            message: "Personal creado correctamente",
            personnel: created,
          });
        } catch (error) {
          sendJson(innerRes, 400, {
            ok: false,
            message: error.message,
          });
        }
      },
    )(req, res, url);
    return;
  }

  if ((req.method === "PUT" || req.method === "PATCH") && personnelId) {
    withModuleProtection(
      MODULES.PERSONNEL,
      ACTIONS.EDIT,
      async (innerReq, innerRes, innerUrl, user) => {
        try {
          const body = await readJsonBody(innerReq);
          const current = getScopedPersonnel(user).find((item) => item.id === personnelId);

          if (!current) {
            sendJson(innerRes, 404, {
              ok: false,
              message: "Empleado no encontrado o fuera de tu alcance",
            });
            return;
          }

          const nextRecord = {
            ...current,
            ...body,
          };

          const inScope = matchesUserScope(user, {
            companyId: Number(nextRecord.companyId),
            contractId: Number(nextRecord.contractId),
            municipality: nextRecord.municipality,
          });

          if (!inScope) {
            sendJson(innerRes, 403, {
              ok: false,
              message: "No puedes mover personal fuera de tu alcance",
            });
            return;
          }

          const updated = updatePersonnel(personnelId, body);

          sendJson(innerRes, 200, {
            ok: true,
            message: "Empleado actualizado correctamente",
            personnel: updated,
          });
        } catch (error) {
          sendJson(innerRes, 400, {
            ok: false,
            message: error.message,
          });
        }
      },
    )(req, res, url);
    return;
  }

  if ((req.method === "PATCH" || req.method === "PUT") && statusPersonnelId) {
    withModuleProtection(
      MODULES.PERSONNEL,
      ACTIONS.EDIT,
      async (innerReq, innerRes, innerUrl, user) => {
        try {
          const body = await readJsonBody(innerReq);
          const current = getScopedPersonnel(user).find((item) => item.id === statusPersonnelId);

          if (!current) {
            sendJson(innerRes, 404, {
              ok: false,
              message: "Empleado no encontrado o fuera de tu alcance",
            });
            return;
          }

          const updated = updatePersonnel(statusPersonnelId, {
            status: body.status,
          });

          sendJson(innerRes, 200, {
            ok: true,
            message: "Estado actualizado correctamente",
            personnel: updated,
          });
        } catch (error) {
          sendJson(innerRes, 400, {
            ok: false,
            message: error.message,
          });
        }
      },
    )(req, res, url);
    return;
  }

  if (req.method === "DELETE" && personnelId) {
    withModuleProtection(
      MODULES.PERSONNEL,
      ACTIONS.DELETE,
      async (innerReq, innerRes, innerUrl, user) => {
        try {
          const current = getScopedPersonnel(user).find((item) => item.id === personnelId);

          if (!current) {
            sendJson(innerRes, 404, {
              ok: false,
              message: "Empleado no encontrado o fuera de tu alcance",
            });
            return;
          }

          removePersonnel(personnelId);

          sendJson(innerRes, 200, {
            ok: true,
            message: "Empleado eliminado correctamente",
          });
        } catch (error) {
          sendJson(innerRes, 400, {
            ok: false,
            message: error.message,
          });
        }
      },
    )(req, res, url);
    return;
  }

  sendMethodNotAllowed(res);
}

module.exports = {
  handlePersonnel,
};