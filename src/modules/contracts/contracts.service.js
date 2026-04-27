const repository = require("./contracts.repository");

async function getContracts(tenantId, companyId = null) {
  return repository.getAllContracts(tenantId, companyId);
}

module.exports = {
  getContracts,
};
