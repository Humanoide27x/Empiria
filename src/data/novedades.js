const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "novedades.json");

function readNovedades() {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function writeNovedades(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function getNovedades(filters = {}) {
  let list = readNovedades();
  if (filters.employeeId)
    list = list.filter(n => String(n.employeeId) === String(filters.employeeId));
  if (filters.municipalityId)
    list = list.filter(n => String(n.municipalityId) === String(filters.municipalityId));
  if (filters.status)
    list = list.filter(n => n.status === filters.status);
  return list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function createNovedad(data) {
  const list = readNovedades();
  const novedad = {
    id: Date.now(),
    employeeId:       data.employeeId       || null,
    employeeName:     data.employeeName     || "",
    municipalityId:   data.municipalityId   || null,
    municipalityName: data.municipalityName || "",
    cargo:            data.cargo            || "",
    type:             data.type             || "Otro",
    description:      data.description     || "",
    date:             data.date             || new Date().toISOString().slice(0, 10),
    registeredBy:     data.registeredBy     || "",
    registeredByName: data.registeredByName || "",
    documentBase64:   data.documentBase64   || null,
    documentName:     data.documentName     || null,
    status:           "PENDIENTE",
    reviewNote:       "",
    reviewedBy:       "",
    reviewedByName:   "",
    reviewedAt:       null,
    createdAt:        new Date().toISOString(),
  };
  list.push(novedad);
  writeNovedades(list);
  return novedad;
}

function updateNovedadStatus(id, status, note, reviewedBy, reviewedByName) {
  const list = readNovedades();
  const idx = list.findIndex(n => String(n.id) === String(id));
  if (idx === -1) return null;
  list[idx] = {
    ...list[idx],
    status:         status,
    reviewNote:     note       || "",
    reviewedBy:     reviewedBy     || "",
    reviewedByName: reviewedByName || "",
    reviewedAt:     new Date().toISOString(),
  };
  writeNovedades(list);
  return list[idx];
}

module.exports = { getNovedades, createNovedad, updateNovedadStatus };
