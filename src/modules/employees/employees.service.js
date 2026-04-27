const {
  listEmployeesFromRepository,
  getEmployeeByIdFromRepository,
  createEmployeeInRepository,
  updateEmployeeInRepository,
  deleteEmployeeFromRepository,
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
    payload.name,
    payload.fullName,
    payload.nombre,
    payload.nombres,
    payload.nombreCompleto,
    payload.employeeName,
    payload.empleadoNombre,
    payload.personalName
  );

  if (safeString(directName)) {
    return safeString(directName);
  }

  const firstName = firstNonEmpty(
    payload.firstName,
    payload.primerNombre,
    payload.primer_nombre,
    payload.nombre1,
    payload.nombrePrimero
  );

  const secondName = firstNonEmpty(
    payload.secondName,
    payload.segundoNombre,
    payload.segundo_nombre,
    payload.nombre2
  );

  const lastName = firstNonEmpty(
    payload.lastName,
    payload.apellido,
    payload.apellidos,
    payload.primerApellido,
    payload.primer_apellido,
    payload.apellido1
  );

  const secondLastName = firstNonEmpty(
    payload.secondLastName,
    payload.segundoApellido,
    payload.segundo_apellido,
    payload.apellido2
  );

  return [firstName, secondName, lastName, secondLastName]
    .map((item) => safeString(item))
    .filter(Boolean)
    .join(" ");
}

function normalizeEmployeePayload(payload = {}, currentEmployee = null) {
  const fullName = buildFullName(payload);

  const firstName = firstNonEmpty(
    payload.firstName,
    payload.primerNombre,
    payload.primer_nombre,
    payload.nombre1,
    payload.nombrePrimero,
    currentEmployee?.primer_nombre
  );

  const secondName = firstNonEmpty(
    payload.secondName,
    payload.segundoNombre,
    payload.segundo_nombre,
    payload.nombre2,
    currentEmployee?.segundo_nombre
  );

  const firstLastName = firstNonEmpty(
    payload.lastName,
    payload.apellido,
    payload.apellidos,
    payload.primerApellido,
    payload.primer_apellido,
    payload.apellido1,
    currentEmployee?.primer_apellido
  );

  const secondLastName = firstNonEmpty(
    payload.secondLastName,
    payload.segundoApellido,
    payload.segundo_apellido,
    payload.apellido2,
    currentEmployee?.segundo_apellido
  );

  const documentType = firstNonEmpty(
    payload.documentType,
    payload.tipo_documento,
    payload.tipoDocumento,
    currentEmployee?.tipo_documento
  );

  const documentNumber = firstNonEmpty(
    payload.document,
    payload.documentNumber,
    payload.documento,
    payload.numeroDocumento,
    payload.numero_documento,
    payload.identification,
    payload.identificationNumber,
    payload.cedula,
    payload.cédula,
    payload.cc,
    payload.numDocumento,
    currentEmployee?.numero_documento
  );

  const municipality = firstNonEmpty(
    payload.municipality,
    payload.municipio,
    currentEmployee?.municipality,
    currentEmployee?.municipio
  );

  const companyId = firstNonEmpty(
    payload.companyId,
    payload.company_id,
    payload.company,
    payload.empresa,
    payload.empresaId,
    currentEmployee?.companyId,
    currentEmployee?.company_id
  );

  const contractId = firstNonEmpty(
    payload.contractId,
    payload.contract_id,
    payload.contract,
    payload.contrato,
    payload.contratoId,
    currentEmployee?.contractId,
    currentEmployee?.contract_id
  );

  const email = firstNonEmpty(
    payload.email,
    payload.correo,
    payload.correoElectronico,
    payload.correo_electronico,
    payload.emailAddress,
    currentEmployee?.email
  );

  const phone = firstNonEmpty(
    payload.phone,
    payload.telefono,
    payload.celular,
    payload.mobile,
    currentEmployee?.phone
  );

  const position = firstNonEmpty(
    payload.position,
    payload.cargo,
    payload.cargo_real,
    payload.jobTitle,
    payload.rolCargo,
    currentEmployee?.position,
    currentEmployee?.cargo_real
  );

  const status = firstNonEmpty(
    payload.status,
    payload.estado,
    payload.employeeStatus,
    currentEmployee?.status,
    "activo"
  );

  return {
    tenantId: safeNumber(firstNonEmpty(payload.tenantId, payload.tenant_id, currentEmployee?.tenantId, currentEmployee?.tenant_id, 1)),
    fullName,
    primer_nombre: safeString(firstName),
    segundo_nombre: safeString(secondName),
    primer_apellido: safeString(firstLastName),
    segundo_apellido: safeString(secondLastName),
    tipo_documento: safeString(documentType),
    numero_documento: safeString(documentNumber),
    municipality: safeString(municipality),
    companyId: safeNumber(companyId),
    contractId: safeNumber(contractId),
    email: safeString(email),
    phone: safeString(phone),
    position: safeString(position),
    cargo_real: safeString(
      firstNonEmpty(payload.cargo_real, payload.cargo, payload.position, position)
    ),

    direccion_residencia: safeString(
      firstNonEmpty(payload.direccion_residencia, payload.address, currentEmployee?.direccion_residencia)
    ),
    barrio_residencia: safeString(
      firstNonEmpty(payload.barrio_residencia, payload.neighborhood, currentEmployee?.barrio_residencia)
    ),
    municipio_residencia: safeString(
      firstNonEmpty(
        payload.municipio_residencia,
        payload.residenceMunicipality,
        currentEmployee?.municipio_residencia
      )
    ),

    eps: safeString(firstNonEmpty(payload.eps, currentEmployee?.eps)),
    fondo_pensiones: safeString(
      firstNonEmpty(payload.fondo_pensiones, payload.pensionFund, currentEmployee?.fondo_pensiones)
    ),
    caja_compensacion: safeString(
      firstNonEmpty(
        payload.caja_compensacion,
        payload.compensationBox,
        currentEmployee?.caja_compensacion
      )
    ),
    arl: safeString(firstNonEmpty(payload.arl, currentEmployee?.arl)),

    status: safeString(status),

    // 🔥 CLAVE PARA QUE FUNCIONE EL GUARDADO PARCIAL
    registro_estado: safeString(
      firstNonEmpty(payload.registro_estado, currentEmployee?.registro_estado)
    ),
  };
}

function validateEmployeePayload(payload, { requireNames = true } = {}) {
  const isIncompleteRegistration =
    payload.registro_estado === "INCOMPLETO" ||
    payload.status === "REGISTRO INCOMPLETO" ||
    (!payload.companyId &&
      !payload.contractId &&
      !safeString(payload.municipality));

  if (!safeString(payload.fullName)) {
    throw new Error("El nombre completo del empleado es obligatorio");
  }

  if (requireNames && !safeString(payload.primer_nombre)) {
    throw new Error("El primer nombre del empleado es obligatorio");
  }

  if (requireNames && !safeString(payload.primer_apellido)) {
    throw new Error("El primer apellido del empleado es obligatorio");
  }

  if (!safeString(payload.numero_documento)) {
    throw new Error("El número de documento es obligatorio");
  }

  // 🔥 SI ES INCOMPLETO → NO VALIDAR LO DEMÁS
  if (isIncompleteRegistration) {
    return;
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
  if (!id) return null;
  return await getEmployeeByIdFromRepository(id);
}

async function createEmployee(payload = {}) {
  const normalizedPayload = normalizeEmployeePayload(payload);

  validateEmployeePayload(normalizedPayload, { requireNames: true });

  const duplicate = await listEmployeesFromRepository({
    documentNumber: normalizedPayload.numero_documento,
    tenantId: normalizedPayload.tenantId,
  });

  if (Array.isArray(duplicate) && duplicate.length > 0) {
    throw new Error("Ya existe un empleado con ese número de documento");
  }

  return await createEmployeeInRepository(normalizedPayload);
}

async function updateEmployee(id, payload = {}) {
  if (!id) throw new Error("Id de empleado requerido");

  const currentEmployee = await getEmployeeByIdFromRepository(id);
  if (!currentEmployee) return null;

  const normalizedPayload = normalizeEmployeePayload(payload, currentEmployee);

  validateEmployeePayload(normalizedPayload, { requireNames: true });

  if (
    safeString(normalizedPayload.numero_documento) &&
    safeString(normalizedPayload.numero_documento) !==
      safeString(currentEmployee.numero_documento)
  ) {
    const duplicate = await listEmployeesFromRepository({
      documentNumber: normalizedPayload.numero_documento,
      tenantId: normalizedPayload.tenantId,
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
  if (!id) throw new Error("Id de empleado requerido");
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