const { sendJson } = require("../../http/response");
const { readJsonBody } = require("../../http/request");
const { requireAuth } = require("../auth/auth.helpers");
const { getNovedades, createNovedad, updateNovedadStatus } = require("../../data/novedades");

async function handleNovedades(req, res, url) {
  const auth = requireAuth(req, res);
  if (!auth) return true;

  // GET /novedades  or  GET /novedades?employeeId=X
  if (req.method === "GET") {
    const employeeId = url.searchParams.get("employeeId") || null;
    const municipalityId = url.searchParams.get("municipalityId") || null;
    const status = url.searchParams.get("status") || null;
    const list = getNovedades({ employeeId, municipalityId, status });
    return sendJson(res, 200, { ok: true, data: list });
  }

  // POST /novedades
  if (req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.employeeId) return sendJson(res, 400, { ok: false, message: "employeeId requerido" });
    if (!body.type)       return sendJson(res, 400, { ok: false, message: "type requerido" });

    const novedad = createNovedad({
      ...body,
      registeredBy:     auth.user.username || "",
      registeredByName: auth.user.name     || auth.user.username || "",
    });
    return sendJson(res, 201, { ok: true, data: novedad });
  }

  // PUT /novedades/:id/status
  if (req.method === "PUT") {
    const parts = url.pathname.split("/").filter(Boolean);
    // parts = ["novedades", id, "status"]
    const id = parts[1];
    if (!id) return sendJson(res, 400, { ok: false, message: "id requerido" });

    const body = await readJsonBody(req);
    const { status, reviewNote } = body;
    if (!status) return sendJson(res, 400, { ok: false, message: "status requerido" });

    const updated = updateNovedadStatus(
      id, status, reviewNote,
      auth.user.username || "",
      auth.user.name     || auth.user.username || ""
    );
    if (!updated) return sendJson(res, 404, { ok: false, message: "Novedad no encontrada" });
    return sendJson(res, 200, { ok: true, data: updated });
  }

  return sendJson(res, 405, { ok: false, message: "Método no permitido" });
}

module.exports = { handleNovedades };
