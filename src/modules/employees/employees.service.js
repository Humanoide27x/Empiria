const crypto = require("crypto");

let personnelData = {};
let store = {};

try {
  personnelData = require("../../data/personnel");
} catch (error) {
  personnelData = {};
}

try {
  store = require("../../data/store");
} catch (error) {
  store = {};
}

const PERSONNEL_FILE = "personnel.json";

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function readAllPersonnel() {
  if (typeof store.readCollection === "function") {
    return safeArray(store.readCollection(PERSONNEL_FILE));
  }

  if (typeof personnelData.getPersonnel === "function") {
    return safeArray(personnelData.getPersonnel());
  }

  if (typeof personnelData.listPersonnel === "function") {
    return safeArray(personnelData.listPersonnel());
  }

  return [];
}

function saveAllPersonnel(items) {
  const normalizedItems = safeArray(items);

  if (typeof store.writeCollection === "function") {
    return store.writeCollection(PERSONNEL_FILE, normalizedItems);
  }

  if (typeof personnelData.savePersonnel === "function") {
    return personnelData.savePersonnel(normalizedItems);
  }

  if (typeof personnelData.setPersonnel === "function") {
    return personnelData.setPersonnel(normalizedItems);
  }

  return normalizedItems;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function buildFullName(payload = {}) {
  const directName = firstNonEmpty(
    payload.name,
    payload.fullName,
    payload.nombre,
    payload.nombres,
    payload.nombreCompleto,
    payload.employeeName,
    payload.empleadoNombre,
    payload.personalName
  );

  if (String(directName).trim()) {
    return String(directName).trim();
  }

  const firstName = firstNonEmpty(
    payload.firstName,
    payload.primerNombre,
    payload.nombre1,
    payload.nombrePrimero
  );

  const secondName = firstNonEmpty(
    payload.secondName,
    payload.segundoNombre,
    payload.nombre2
  );

  const lastName = firstNonEmpty(
    payload.lastName,
    payload.apellido,
    payload.apellidos,
    payload.primerApellido,
    payload.apellido1
  );

  const secondLastName = firstNonEmpty(
    payload.secondLastName,
    payload.segundoApellido,
    payload.apellido2
  );

  return [firstName, secondName, lastName, secondLastName]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ");
}

function normalizeEmployeePayload(payload = {}) {
  const now = new Date().toISOString();
  const fullName = buildFullName(payload);

  const documentNumber = firstNonEmpty(
    payload.document,
    payload.documentNumber,
    payload.documento,
    payload.numeroDocumento,
    payload.identification,
    payload.identificationNumber,
    payload.cedula,
    payload.cédula,
    payload.cc,
    payload.numDocumento
  );

  const municipality = firstNonEmpty(
    payload.municipality,
    payload.municipio,
    payload.assignedMunicipality
  );

  const companyId = firstNonEmpty(
    payload.companyId,
    payload.company,
    payload.empresaId,
    payload.company_id
  );

  const contractId = firstNonEmpty(
    payload.contractId,
    payload.contract,
    payload.contratoId,
    payload.contract_id
  );

  const email = firstNonEmpty(
    payload.email,
    payload.correo,
    payload.correoElectronico,
    payload.emailAddress
  );

  const phone = firstNonEmpty(
    payload.phone,
    payload.telefono,
    payload.celular,
    payload.mobile
  );

  const position = firstNonEmpty(
    payload.position,
    payload.cargo,
    payload.jobTitle,
    payload.rolCargo
  );

  const employeeId = firstNonEmpty(
    payload.id,
    payload.employeeId,
    payload.personnelId
  );

  return {
    ...payload,

    id: employeeId || crypto.randomUUID(),
    employeeId: employeeId || payload.employeeId || null,
    personnelId: employeeId || payload.personnelId || null,

    name: fullName,
    fullName,
    nombre: fullName,
    nombreCompleto: fullName,

    document: documentNumber ? String(documentNumber).trim() : "",
    documentNumber: documentNumber ? String(documentNumber).trim() : "",
    documento: documentNumber ? String(documentNumber).trim() : "",
    cedula: documentNumber ? String(documentNumber).trim() : "",

    municipality: municipality ? String(municipality).trim() : "",
    municipio: municipality ? String(municipality).trim() : "",

    companyId: companyId ? String(companyId).trim() : "",
    contractId: contractId ? String(contractId).trim() : "",

    company: payload.company ?? companyId ?? "",
    contract: payload.contract ?? contractId ?? "",

    email: email ? String(email).trim() : "",
    correo: email ? String(email).trim() : "",

    phone: phone ? String(phone).trim() : "",
    telefono: phone ? String(phone).trim() : "",

    position: position ? String(position).trim() : "",
    cargo: position ? String(position).trim() : "",

    status: firstNonEmpty(
      payload.status,
      payload.estado,
      payload.employeeStatus,
      "activo"
    ),

    createdAt: payload.createdAt || now,
    updatedAt: now,
  };
}

function listEmployees() {
  return readAllPersonnel();
}

function getPersonnel() {
  return listEmployees();
}

function getEmployeeById(id) {
  if (!id) {
    return null;
  }

  const employees = readAllPersonnel();

  return (
    employees.find((item) => {
      const itemId = item?.id || item?.employeeId || item?.personnelId;
      return String(itemId) === String(id);
    }) || null
  );
}

function findPersonnelById(id) {
  return getEmployeeById(id);
}

function createEmployee(payload = {}) {
  const employees = readAllPersonnel();
  const newEmployee = normalizeEmployeePayload(payload);

  if (!String(newEmployee.name || "").trim()) {
    throw new Error("El nombre del empleado es obligatorio");
  }

  const duplicateByDocument =
    newEmployee.document &&
    employees.find(
      (item) =>
        String(
          item.document ||
            item.documentNumber ||
            item.documento ||
            item.cedula ||
            ""
        ) === String(newEmployee.document)
    );

  if (duplicateByDocument) {
    throw new Error("Ya existe un empleado con ese número de documento");
  }

  employees.push(newEmployee);
  saveAllPersonnel(employees);

  return newEmployee;
}

function createPersonnel(payload = {}) {
  return createEmployee(payload);
}

function updateEmployee(id, payload = {}) {
  if (!id) {
    throw new Error("Id de empleado requerido");
  }

  const employees = readAllPersonnel();
  const index = employees.findIndex((item) => {
    const itemId = item?.id || item?.employeeId || item?.personnelId;
    return String(itemId) === String(id);
  });

  if (index === -1) {
    return null;
  }

  const current = employees[index];
  const merged = normalizeEmployeePayload({
    ...current,
    ...payload,
    id: current.id || current.employeeId || current.personnelId || id,
    employeeId:
      current.employeeId || current.id || current.personnelId || id,
    personnelId:
      current.personnelId || current.id || current.employeeId || id,
    createdAt: current.createdAt,
  });

  employees[index] = merged;
  saveAllPersonnel(employees);

  return merged;
}

function updatePersonnel(id, payload = {}) {
  return updateEmployee(id, payload);
}

function deleteEmployee(id) {
  if (!id) {
    throw new Error("Id de empleado requerido");
  }

  const employees = readAllPersonnel();
  const index = employees.findIndex((item) => {
    const itemId = item?.id || item?.employeeId || item?.personnelId;
    return String(itemId) === String(id);
  });

  if (index === -1) {
    return false;
  }

  employees.splice(index, 1);
  saveAllPersonnel(employees);

  return true;
}

function deletePersonnel(id) {
  return deleteEmployee(id);
}

module.exports = {
  listEmployees,
  getPersonnel,
  getEmployeeById,
  findPersonnelById,
  createEmployee,
  createPersonnel,
  updateEmployee,
  updatePersonnel,
  deleteEmployee,
  deletePersonnel,
};