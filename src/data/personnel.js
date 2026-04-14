const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "personnel.json");

function readPersonnel() {
  if (!fs.existsSync(filePath)) return [];
  const data = fs.readFileSync(filePath, "utf-8");
  return data ? JSON.parse(data) : [];
}

function writePersonnel(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getPersonnel() {
  return readPersonnel();
}

// 🔥 ESTA ES LA QUE FALTABA
function getVisibleResumeRecords(user) {
  const personnel = readPersonnel();

  if (user.role === "administrador") {
    return personnel;
  }

  return personnel.filter((p) => {
    const sameCompany =
      !user.companyId || !p.companyId || p.companyId === user.companyId;

    const sameContract =
      !user.contractId || !p.contractId || p.contractId === user.contractId;

    return sameCompany && sameContract;
  });
}

function createPersonnel(newPerson) {
  const personnel = readPersonnel();

  const id = Date.now();

  const record = {
    id,
    ...newPerson,
    createdAt: new Date().toISOString(),
  };

  personnel.push(record);
  writePersonnel(personnel);

  return record;
}

// 🔥 UPDATE REAL (TE FALTABA ESTO BIEN HECHO)
function updatePersonnel(id, updatedData) {
  const personnel = readPersonnel();

  const index = personnel.findIndex((p) => p.id == id);
  if (index === -1) return null;

  personnel[index] = {
    ...personnel[index],
    ...updatedData,
    updatedAt: new Date().toISOString(),
  };

  writePersonnel(personnel);
  return personnel[index];
}

module.exports = {
  getPersonnel,
  getVisibleResumeRecords,
  createPersonnel,
  updatePersonnel,
};