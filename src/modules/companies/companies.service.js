const repository = require("./companies.repository");

async function getCompanies(tenantId) {
  return repository.getAllCompanies(tenantId);
}

module.exports = {
  getCompanies,
};
