const repository = require("./companies.repository");

async function getCompanies() {
  return repository.getAllCompanies();
}

module.exports = {
  getCompanies,
};