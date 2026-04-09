const { requireAuth } = require("../auth/auth.helpers");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const service = require("./contracts.service");

async function handleGetContracts(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) {
    return;
  }

  try {
    const contracts = await service.getContracts();

    sendJson(res, 200, {
      ok: true,
      contracts,
    });
  } catch (error) {
    console.error("Error contracts:", error);

    sendJson(res, 500, {
      ok: false,
      message: "No fue posible consultar los contratos",
    });
  }
}

module.exports = {
  handleGetContracts,
};