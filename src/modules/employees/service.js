const {
  listEmployeesFromRepository,
  getEmployeeByIdFromRepository,
  createEmployeeInRepository,
  updateEmployeeInRepository,
  deleteEmployeeFromRepository,
  getRequiredDocumentsByEmployeeIdFromRepository,
} = require("./repository");

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildFullName(payload = {}) {
  const directName = firstNonEmpty(
    payload.fullName,
    payload.name,
    payload.nombre,
    payload.nombreCompleto
  );

  if (safeString(directName)) {
    return safeString(directName);
  }

  return [
    firstNonEmpty(payload.primer_nombre, payload.firstName, payload.primerNombre),
    firstNonEmpty(payload.segundo_nombre, payload.secondName, payload.segundoNombre),
    firstNonEmpty(payload.primer_apellido, payload.firstLastName, payload.primerApellido),
    firstNonEmpty(payload.segundo_apellido, payload.secondLastName, payload.segundoApellido),
  ]
    .map((item) => safeString(item))
    .filter(Boolean)
    .join(" ");
}

function normalizeEmployeePayload(payload = {}, currentEmployee = null) {
  return {
    fullName: buildFullName(payload),

    primer_nombre: safeString(
      firstNonEmpty(
        payload.primer_nombre,
        payload.firstName,
        payload.primerNombre,
        currentEmployee?.primer_nombre
      )
    ),
    segundo_nombre: safeString(
      firstNonEmpty(
        payload.segundo_nombre,
        payload.secondName,
        payload.segundoNombre,
        currentEmployee?.segundo_nombre
      )
    ),
    primer_apellido: safeString(
      firstNonEmpty(
        payload.primer_apellido,
        payload.firstLastName,
        payload.primerApellido,
        currentEmployee?.primer_apellido
      )
    ),
    segundo_apellido: safeString(
      firstNonEmpty(
        payload.segundo_apellido,
        payload.secondLastName,
        payload.segundoApellido,
        currentEmployee?.segundo_apellido
      )
    ),

    tipo_documento: safeString(
      firstNonEmpty(
        payload.tipo_documento,
        payload.documentType,
        payload.tipoDocumento,
        currentEmployee?.tipo_documento
      )
    ),
    numero_documento: safeString(
      firstNonEmpty(
        payload.numero_documento,
        payload.documentNumber,
        payload.documento,
        currentEmployee?.numero_documento
      )
    ),

    phone: safeString(
      firstNonEmpty(
        payload.phone,
        payload.telefono,
        payload.celular,
        currentEmployee?.phone
      )
    ),
    email: safeString(
      firstNonEmpty(
        payload.email,
        payload.correo,
        payload.correo_electronico,
        currentEmployee?.email
      )
    ),

    direccion_residencia: safeString(
      firstNonEmpty(
        payload.direccion_residencia,
        payload.address,
        currentEmployee?.direccion_residencia
      )
    ),
    barrio_residencia: safeString(
      firstNonEmpty(
        payload.barrio_residencia,
        payload.neighborhood,
        currentEmployee?.barrio_residencia
      )
    ),
    municipality: safeString(
      firstNonEmpty(
        payload.municipality,
        payload.municipio,
        payload.municipio_residencia,
        currentEmployee?.municipality,
        currentEmployee?.municipio
      )
    ),

    eps: safeString(firstNonEmpty(payload.eps, currentEmployee?.eps)),
    fondo_pensiones: safeString(
      firstNonEmpty(
        payload.fondo_pensiones,
        payload.pensionFund,
        currentEmployee?.fondo_pensiones
      )
    ),
    caja_compensacion: safeString(
      firstNonEmpty(
        payload.caja_compensacion,
        payload.compensationBox,
        currentEmployee?.caja_compensacion
      )
    ),
    arl: safeString(firstNonEmpty(payload.arl, currentEmployee?.arl)),

    cargo_real: safeString(
      firstNonEmpty(
        payload.cargo_real,
        payload.position,
        payload.cargo,
        currentEmployee?.cargo_real
      )
    ),

    companyId: safeNumber(
      firstNonEmpty(
        payload.companyId,
        payload.company_id,
        payload.empresaId,
        payload.empresa,
        currentEmployee?.companyId,
        currentEmployee?.company_id
      )
    ),
    contractId: safeNumber(
      firstNonEmpty(
        payload.contractId,
        payload.contract_id,
        payload.contratoId,
        payload.contrato,
        currentEmployee?.contractId,
        currentEmployee?.contract_id
      )
    ),

    status: safeString(
      firstNonEmpty(payload.status, payload.estado, currentEmployee?.status, "preingreso")
    ),
  };
}

function validateEmployeePayload(payload) {
  const isIncompleteRegistration =
    payload.registro_estado === "INCOMPLETO" ||
    payload.status === "REGISTRO INCOMPLETO";

  if (!safeString(payload.primer_nombre)) {
    throw new Error("El primer nombre es obligatorio");
  }

  if (!safeString(payload.primer_apellido)) {
    throw new Error("El primer apellido es obligatorio");
  }

  if (!safeString(payload.numero_documento)) {
    throw new Error("El número de documento es obligatorio");
  }

  // Desde identificación se permite crear incompleto
  if (isIncompleteRegistration) {
    return;
  }

  if (!safeString(payload.cargo_real)) {
    throw new Error("El cargo es obligatorio");
  }

  if (!payload.companyId) {
    throw new Error("La empresa es obligatoria");
  }

  if (!payload.contractId) {
    throw new Error("El contrato es obligatorio");
  }

  if (!safeString(payload.municipality)) {
    throw new Error("El municipio es obligatorio");
  }
}

async function listEmployees(resource = {}) {
  return await listEmployeesFromRepository(resource);
}

async function getEmployeeById(id) {
  if (!id) {
    return null;
  }

  return await getEmployeeByIdFromRepository(id);
}

async function createEmployee(payload = {}) {
  const normalizedPayload = normalizeEmployeePayload(payload);
  validateEmployeePayload(normalizedPayload);

  const duplicate = await listEmployeesFromRepository({
    documentNumber: normalizedPayload.numero_documento,
  });

  if (Array.isArray(duplicate) && duplicate.length > 0) {
    throw new Error("Ya existe un empleado con ese número de documento");
  }

  return await createEmployeeInRepository(normalizedPayload);
}

async function updateEmployee(id, payload = {}) {
  if (!id) {
    throw new Error("Id de empleado requerido");
  }

  const currentEmployee = await getEmployeeByIdFromRepository(id);

  if (!currentEmployee) {
    return null;
  }

  const normalizedPayload = normalizeEmployeePayload(payload, currentEmployee);
  validateEmployeePayload(normalizedPayload);

  if (
    safeString(normalizedPayload.numero_documento) &&
    safeString(normalizedPayload.numero_documento) !==
      safeString(currentEmployee.numero_documento)
  ) {
    const duplicate = await listEmployeesFromRepository({
      documentNumber: normalizedPayload.numero_documento,
    });

    const duplicateFound = Array.isArray(duplicate)
      ? duplicate.find((item) => Number(item.id) !== Number(id))
      : null;

    if (duplicateFound) {
      throw new Error("Ya existe un empleado con ese número de documento");
    }
  }

  return await updateEmployeeInRepository(id, normalizedPayload);
}

async function deleteEmployee(id) {
  if (!id) {
    throw new Error("Id de empleado requerido");
  }

  return await deleteEmployeeFromRepository(id);
}

async function getRequiredDocumentsByEmployeeId(id) {
  if (!id) throw new Error("Id de empleado requerido");
  return await getRequiredDocumentsByEmployeeIdFromRepository(id);
}

module.exports = {
  listEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getRequiredDocumentsByEmployeeId,
};