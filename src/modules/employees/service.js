const {
  getPersonnelFromDb,
  createPersonnelInDb,
  updatePersonnelInDb,
  removePersonnelFromDb,
} = require("./repository");

function validatePersonnelPayload(payload) {
  if (!payload.fullName) {
    throw new Error("El nombre completo es obligatorio");
  }

  if (!payload.documentNumber) {
    throw new Error("El número de documento es obligatorio");
  }

  if (!payload.position) {
    throw new Error("El cargo es obligatorio");
  }

  if (!payload.companyId) {
    throw new Error("La empresa es obligatoria");
  }

  if (!payload.contractId) {
    throw new Error("El contrato es obligatorio");
  }
}

async function getPersonnel() {
  return getPersonnelFromDb();
}

async function createPersonnel(payload) {
  validatePersonnelPayload(payload);
  return createPersonnelInDb(payload);
}

async function updatePersonnel(personnelId, changes) {
  return updatePersonnelInDb(personnelId, changes);
}

async function removePersonnel(personnelId) {
  return removePersonnelFromDb(personnelId);
}

module.exports = {
  getPersonnel,
  createPersonnel,
  updatePersonnel,
  removePersonnel,
};