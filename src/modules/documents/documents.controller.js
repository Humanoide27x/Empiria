const { sendJson } = require("../../http/response");
const { readJsonBody } = require("../../http/request");

const {
  getAllDocuments,
  getDocumentsByEmployee,
  saveDocument,
  validateDocument,
  rejectDocument,
} = require("../../data/documents");

async function handleDocuments(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const employeeId = url.searchParams.get("employeeId");

  if (req.method === "GET") {
    if (!employeeId) {
      return sendJson(res, 200, {
        ok: true,
        data: getAllDocuments(),
      });
    }

    return sendJson(res, 200, {
      ok: true,
      data: getDocumentsByEmployee(employeeId),
    });
  }

  if (req.method === "POST") {
    const body = await readJsonBody(req);

    if (!body.employeeId) {
      return sendJson(res, 400, {
        ok: false,
        message: "employeeId es requerido",
      });
    }

    if (!body.documentType) {
      return sendJson(res, 400, {
        ok: false,
        message: "documentType es requerido",
      });
    }

    if (!body.fileBase64 || !body.fileBase64.startsWith("data:application/pdf")) {
      return sendJson(res, 400, {
        ok: false,
        message: "Debes subir un archivo PDF válido",
      });
    }

    const document = saveDocument(body);

    return sendJson(res, 201, {
      ok: true,
      data: document,
      message: "Documento guardado correctamente",
    });
  }

  if (req.method === "PUT" && url.pathname === "/documents/validate") {
    const body = await readJsonBody(req);

    if (!body.id) {
      return sendJson(res, 400, {
        ok: false,
        message: "id es requerido",
      });
    }

    const document = validateDocument(body.id, body.userName || "Usuario");

    if (!document) {
      return sendJson(res, 404, {
        ok: false,
        message: "Documento no encontrado",
      });
    }

    return sendJson(res, 200, {
      ok: true,
      data: document,
      message: "Documento validado correctamente",
    });
  }

  if (req.method === "PUT" && url.pathname === "/documents/reject") {
    const body = await readJsonBody(req);

    if (!body.id) {
      return sendJson(res, 400, {
        ok: false,
        message: "id es requerido",
      });
    }

    const document = rejectDocument(
      body.id,
      body.reason || "",
      body.userName || "Usuario"
    );

    if (!document) {
      return sendJson(res, 404, {
        ok: false,
        message: "Documento no encontrado",
      });
    }

    return sendJson(res, 200, {
      ok: true,
      data: document,
      message: "Documento rechazado correctamente",
    });
  }

  return sendJson(res, 405, {
    ok: false,
    message: "Método no permitido",
  });
}

module.exports = {
  handleDocuments,
};