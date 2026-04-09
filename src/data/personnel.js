const { readCollection, writeCollection } = require("./store");

const PERSONNEL_FILE = "personnel.json";

function getPersonnel() {
  return readCollection(PERSONNEL_FILE);
}

function savePersonnel(personnel) {
  return writeCollection(PERSONNEL_FILE, personnel);
}

function getNextPersonnelId(personnel) {
  const ids = personnel.map((item) => item.id);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function createPersonnel(payload) {
  if (
    !payload.fullName ||
    !payload.documentNumber ||
    !payload.position ||
    !payload.companyId ||
    !payload.contractId ||
    !payload.municipality
  ) {
    throw new Error("Faltan datos obligatorios del personal");
  }

  const personnel = getPersonnel();

  const record = {
    id: getNextPersonnelId(personnel),
    fullName: payload.fullName,
    documentNumber: String(payload.documentNumber),
    position: payload.position,
    companyId: Number(payload.companyId),
    contractId: Number(payload.contractId),
    municipality: payload.municipality,
    site: payload.site || "",
    institution: payload.institution || "",
    modality: payload.modality || "",
    headOfHousehold: Boolean(payload.headOfHousehold),
    status: payload.status || "activo",
  };

  personnel.push(record);
  savePersonnel(personnel);

  return record;
}

function updatePersonnel(personnelId, changes) {
  const personnel = getPersonnel();
  const index = personnel.findIndex((item) => item.id === Number(personnelId));

  if (index === -1) {
    throw new Error("Empleado no encontrado");
  }

  const current = personnel[index];

  const updated = {
    ...current,
    ...changes,
  };

  if (updated.companyId != null) {
    updated.companyId = Number(updated.companyId);
  }

  if (updated.contractId != null) {
    updated.contractId = Number(updated.contractId);
  }

  if (updated.documentNumber != null) {
    updated.documentNumber = String(updated.documentNumber);
  }

  updated.headOfHousehold = Boolean(updated.headOfHousehold);

  personnel[index] = updated;
  savePersonnel(personnel);

  return updated;
}

function removePersonnel(personnelId) {
  const personnel = getPersonnel();
  const index = personnel.findIndex((item) => item.id === Number(personnelId));

  if (index === -1) {
    throw new Error("Empleado no encontrado");
  }

  const [removed] = personnel.splice(index, 1);
  savePersonnel(personnel);

  return removed;
}

module.exports = {
  createPersonnel,
  getPersonnel,
  updatePersonnel,
  removePersonnel,
};