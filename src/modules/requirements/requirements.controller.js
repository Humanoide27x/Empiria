const { readJsonBody } = require("../../http/request");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");

const {
  listContractPositions,
  createContractPosition,
  updateContractPosition,
  disableContractPosition,
  listDocumentTypes,
  createDocumentType,
  listPositionDocuments,
  savePositionDocuments,
  getEmployeeDocumentRequirements,
} = require("./requirements.repository");

function getIdFromPath(pathname, prefix) {
  const value = String(pathname || "").replace(prefix, "").split("/").filter(Boolean)[0];
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

function getEmployeeIdFromRequirementsPath(pathname) {
  const match = String(pathname || "").match(/^\/personnel\/(\d+)\/document-requirements$/);
  return match ? Number(match[1]) : null;
}

async function handleRequirements(req, res, url) {
  const pathname = url.pathname;
  const method = String(req.method || "GET").toUpperCase();

  try {
    if (pathname === "/contract-positions" && method === "GET") {
      const data = await listContractPositions({
        companyId: url.searchParams.get("companyId"),
        contractId: url.searchParams.get("contractId"),
        category: url.searchParams.get("category"),
      });
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (pathname === "/contract-positions" && method === "POST") {
      const payload = await readJsonBody(req);
      const data = await createContractPosition(payload);
      sendJson(res, 201, { ok: true, data });
      return;
    }

    if (/^\/contract-positions\/\d+$/.test(pathname) && method === "PUT") {
      const id = getIdFromPath(pathname, "/contract-positions/");
      const payload = await readJsonBody(req);
      const data = await updateContractPosition(id, payload);
      if (!data) {
        sendJson(res, 404, { ok: false, message: "Cargo no encontrado" });
        return;
      }
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (/^\/contract-positions\/\d+$/.test(pathname) && method === "DELETE") {
      const id = getIdFromPath(pathname, "/contract-positions/");
      const deleted = await disableContractPosition(id);
      sendJson(res, 200, { ok: true, deleted });
      return;
    }

    if (pathname === "/document-types" && method === "GET") {
      const data = await listDocumentTypes({ phase: url.searchParams.get("phase") });
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (pathname === "/document-types" && method === "POST") {
      const payload = await readJsonBody(req);
      const data = await createDocumentType(payload);
      sendJson(res, 201, { ok: true, data });
      return;
    }

    if (/^\/contract-positions\/\d+\/documents$/.test(pathname) && method === "GET") {
      const id = getIdFromPath(pathname, "/contract-positions/");
      const data = await listPositionDocuments(id);
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (/^\/contract-positions\/\d+\/documents$/.test(pathname) && method === "PUT") {
      const id = getIdFromPath(pathname, "/contract-positions/");
      const payload = await readJsonBody(req);
      const documents = Array.isArray(payload) ? payload : payload.documents || [];
      const data = await savePositionDocuments(id, documents);
      sendJson(res, 200, { ok: true, data });
      return;
    }

    const employeeId = getEmployeeIdFromRequirementsPath(pathname);
    if (employeeId && method === "GET") {
      const data = await getEmployeeDocumentRequirements(employeeId);
      if (!data) {
        sendJson(res, 404, { ok: false, message: "Empleado no encontrado" });
        return;
      }
      sendJson(res, 200, { ok: true, data });
      return;
    }

    sendMethodNotAllowed(res);
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      message: error.message || "Error procesando requisitos documentales",
    });
  }
}

module.exports = { handleRequirements };
