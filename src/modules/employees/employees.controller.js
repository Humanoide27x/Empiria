const { sendJson } = require("../../http/response");
const { readJsonBody } = require("../../http/request");
const { withModuleProtection } = require("../../http/protection");
const pool = require("../../db/pool");

const {
  getPersonnel,
  createPersonnel,
  updatePersonnel,
} = require("../../data/personnel");

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b\p{L}/gu, (char) => char.toUpperCase());
}

async function getEducationalCatalog() {
  const result = await pool.query(`
    SELECT
      m.name AS municipality,
      i.name AS institution,
      s.name AS site,
      sm.modality AS modality
    FROM municipalities m
    JOIN institutions i ON i.municipality_id = m.id
    JOIN educational_sites s ON s.institution_id = i.id
    JOIN site_modalities sm ON sm.site_id = s.id
    ORDER BY m.name, i.name, s.name, sm.modality
  `);

  const catalog = {};

  for (const row of result.rows) {
    const municipality = toTitleCase(row.municipality);
    const institution = row.institution;
    const site = row.site;
    const modality = row.modality;

    if (!catalog[municipality]) catalog[municipality] = {};
    if (!catalog[municipality][institution]) catalog[municipality][institution] = {};
    if (!catalog[municipality][institution][site]) catalog[municipality][institution][site] = [];

    if (!catalog[municipality][institution][site].includes(modality)) {
      catalog[municipality][institution][site].push(modality);
    }
  }

  return catalog;
}

function handlePersonnel(req, res) {
  if (req.method === "GET") {
    return withModuleProtection(
      "gestion_personal",
      "view",
      async (req, res) => {
        const data = await getPersonnel();
        const educationalCatalog = await getEducationalCatalog();

        return sendJson(res, 200, {
          data,
          educationalCatalog,
        });
      }
    )(req, res);
  }

  if (req.method === "POST") {
    return withModuleProtection(
      "gestion_personal",
      "create",
      async (req, res) => {
        const body = await readJsonBody(req);
        const created = await createPersonnel(body);
        return sendJson(res, 201, { data: created });
      }
    )(req, res);
  }

  if (req.method === "PUT") {
    return withModuleProtection(
      "gestion_personal",
      "update",
      async (req, res) => {
        const body = await readJsonBody(req);
        const id = body.id || body.employeeId || body.personnelId;

        if (!id) {
          return sendJson(res, 400, {
            ok: false,
            message: "ID requerido para actualizar el empleado",
          });
        }

        const updated = await updatePersonnel(id, body);

        if (!updated) {
          return sendJson(res, 404, {
            ok: false,
            message: "Empleado no encontrado",
          });
        }

        return sendJson(res, 200, {
          ok: true,
          data: updated,
          message: "Empleado actualizado correctamente",
        });
      }
    )(req, res);
  }

  return sendJson(res, 405, {
    ok: false,
    message: "Método no permitido",
  });
}

module.exports = {
  handlePersonnel,
};