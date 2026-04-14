const { sendJson } = require("../../http/response");
const { readJsonBody } = require("../../http/request");
const { withModuleProtection } = require("../../http/protection");

const {
  getPersonnel,
  createPersonnel,
  updatePersonnel,
} = require("../../data/personnel");

function handlePersonnel(req, res) {
  if (req.method === "GET") {
    return withModuleProtection(
      "gestion_personal",
      "view",
      async (req, res) => {
        const data = getPersonnel();
        return sendJson(res, 200, { data });
      }
    )(req, res);
  }

  if (req.method === "POST") {
    return withModuleProtection(
      "gestion_personal",
      "create",
      async (req, res) => {
        const body = await readJsonBody(req);
        const created = createPersonnel(body);
        return sendJson(res, 201, { data: created });
      }
    )(req, res);
  }

  if (req.method === "PUT") {
    return withModuleProtection(
      "gestion_personal",
      "edit",
      async (req, res) => {
        const body = await readJsonBody(req);

        if (!body.id) {
          return sendJson(res, 400, { message: "ID requerido" });
        }

        const updated = updatePersonnel(body.id, body);

        if (!updated) {
          return sendJson(res, 404, { message: "Empleado no encontrado" });
        }

        return sendJson(res, 200, { data: updated });
      }
    )(req, res);
  }

  return sendJson(res, 405, { message: "Método no permitido" });
}

module.exports = {
  handlePersonnel,
};