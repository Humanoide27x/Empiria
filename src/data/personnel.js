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

module.exports = {
  createPersonnel,
  getPersonnel,
};
