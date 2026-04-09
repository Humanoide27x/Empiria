const repository = require("./contracts.repository");

async function getContracts() {
  return repository.getAllContracts();
}

module.exports = {
  getContracts,
};