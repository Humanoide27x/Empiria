const { readJsonBody } = require("../../http/request");
const { sendJson } = require("../../http/response");
const { saveDraft } = require("./drafts.service");
const { getDraftsByEmployee } = require("./drafts.repository");

async function handleSaveDraft(req, res, user) {
  try {
    const body = await readJsonBody(req);

    const draftKey = body.draftKey || body.draft_key;
    const sectionKey = body.sectionKey || body.section_key;
    const data = body.data || {};
    const progress = Number(body.progress || 0);
    const employeeId = body.employeeId || body.employee_id || null;

    if (!draftKey) {
      sendJson(res, 400, { ok: false, message: "Debes enviar draftKey" });
      return;
    }

    if (!sectionKey) {
      sendJson(res, 400, { ok: false, message: "Debes enviar sectionKey" });
      return;
    }

    const draft = await saveDraft(
      { draftKey, sectionKey, data, progress, employeeId },
      user
    );

    sendJson(res, 200, {
      ok: true,
      message: "Borrador guardado correctamente",
      data: draft,
      draft,
    });
  } catch (error) {
    console.error("Error guardando draft:", error);
    sendJson(res, 500, {
      ok: false,
      message: error.message || "No fue posible guardar el borrador",
    });
  }
}

async function handleGetDrafts(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname.startsWith("/employee-drafts/")) {
      const employeeId = url.pathname.split("/")[2];
      const drafts = await getDraftsByEmployee(employeeId);
      sendJson(res, 200, { ok: true, data: drafts });
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error consultando drafts:", error);
    sendJson(res, 500, {
      ok: false,
      message: error.message || "No fue posible consultar los borradores",
    });
    return true;
  }
}

module.exports = {
  handleSaveDraft,
  handleGetDrafts,
};
