const { requireAuth } = require("../auth/auth.helpers");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const service = require("./companies.service");

async function handleGetCompanies(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) {
    return;
  }

  try {
    const companies = await service.getCompanies();

    sendJson(res, 200, {
      ok: true,
      companies,
    });
  } catch (error) {
    console.error("Error companies:", error);

    sendJson(res, 500, {
      ok: false,
      message: "No fue posible consultar las empresas",
    });
  }
}

module.exports = {
  handleGetCompanies,
};