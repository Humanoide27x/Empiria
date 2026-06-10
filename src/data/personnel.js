const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { personnelCache } = require("../utils/cache");

const filePath = path.join(__dirname, "personnel.json");
const CACHE_KEY = "personnel_data";

function readPersonnel() {
  const cached = personnelCache.get(CACHE_KEY);
  if (cached !== undefined) return cached;
  if (!fs.existsSync(filePath)) {
    personnelCache.set(CACHE_KEY, []);
    return [];
  }
  const data = fs.readFileSync(filePath, "utf-8");
  const parsed = data ? JSON.parse(data) : [];
  personnelCache.set(CACHE_KEY, parsed);
  return parsed;
}

function writePersonnel(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  personnelCache.invalidate(CACHE_KEY);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function asBoolean(value) {
  return (
    value === true ||
    String(value || "").trim().toLowerCase() === "true" ||
    String(value || "").trim().toUpperCase() === "SI" ||
    String(value || "").trim().toUpperCase() === "SÍ"
  );
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function cleanText(value) {
  return String(value || "").trim();
}

function isInstitutionalPosition(value) {
  return normalize(value) === "OPERARIO MANIPULADOR DE ALIMENTOS";
}

function buildFullName(data = {}) {
  return firstNonEmpty(
    data.fullName,
    data.full_name,
    data.nombre,
    [
      data.primer_nombre || data.firstName,
      data.segundo_nombre || data.secondName,
      data.primer_apellido || data.firstLastName,
      data.segundo_apellido || data.secondLastName,
    ]
      .filter(Boolean)
      .join(" ")
  ).trim();
}

function normalizePersonnelPayload(payload = {}) {
  const presentedInOffer = asBoolean(
    firstNonEmpty(
      payload.presented_in_offer,
      payload.presentedInOffer,
      payload.presentacion_en_licitacion
    )
  );

  const realPosition = firstNonEmpty(
    payload.cargo_real,
    payload.real_position,
    payload.position,
    payload.cargo
  ).trim();

  const offeredPosition = presentedInOffer
    ? firstNonEmpty(
        payload.offered_position,
        payload.offer_position,
        payload.cargo_presentado_en_licitacion,
        payload.offerPosition
      ).trim()
    : "";

  const needsInstitution = isInstitutionalPosition(realPosition);

  const educationalMunicipality = needsInstitution
    ? firstNonEmpty(
        payload.educationalMunicipality,
        payload.educational_municipality,
        payload.municipio_educativo,
        payload.municipio_institucional
      )
    : "";

  const institution = needsInstitution
    ? firstNonEmpty(payload.institution, payload.institucion_educativa)
    : "";

  const site = needsInstitution
    ? firstNonEmpty(payload.site, payload.sede_educativa)
    : "";

  const educationalModality = needsInstitution
    ? firstNonEmpty(payload.educationalModality, payload.modalidad)
    : "";

  const workTimeType = firstNonEmpty(
    payload.workTimeType,
    payload.work_time_type,
    payload.tipo_tiempo
  );

  return {
    ...payload,

    fullName: buildFullName(payload),
    name: buildFullName(payload),

    firstName: firstNonEmpty(payload.firstName, payload.primer_nombre),
    secondName: firstNonEmpty(payload.secondName, payload.segundo_nombre),
    firstLastName: firstNonEmpty(payload.firstLastName, payload.primer_apellido),
    secondLastName: firstNonEmpty(payload.secondLastName, payload.segundo_apellido),

    documentType: firstNonEmpty(payload.documentType, payload.tipo_documento),
    documentNumber: firstNonEmpty(payload.documentNumber, payload.numero_documento),

    companyId:
      Number(firstNonEmpty(payload.companyId, payload.company_id, payload.empresa)) ||
      "",
    contractId:
      Number(firstNonEmpty(payload.contractId, payload.contract_id, payload.contrato)) ||
      "",

    municipalityId:
      Number(
        firstNonEmpty(payload.municipalityId, payload.municipality_id, payload.municipio)
      ) || "",

    status: firstNonEmpty(payload.status, payload.estado, "ACTIVO"),
    estado: firstNonEmpty(payload.status, payload.estado, "ACTIVO"),

    workTimeType,
    work_time_type: workTimeType,
    tipo_tiempo: workTimeType,

    presented_in_offer: presentedInOffer,
    presentedInOffer,
    presentacion_en_licitacion: presentedInOffer,

    offered_position: offeredPosition,
    offer_position: offeredPosition,
    offerPosition: offeredPosition,
    cargo_presentado_en_licitacion: offeredPosition,

    cargo_real: realPosition,
    real_position: realPosition,
    position: realPosition,

    educationalMunicipality,
    educational_municipality: educationalMunicipality,
    municipio_educativo: educationalMunicipality,
    municipio_institucional: educationalMunicipality,

    institution,
    site,
    educationalModality,

    institucion_educativa: institution,
    sede_educativa: site,
    modalidad: educationalModality,

    coverageStartDate: firstNonEmpty(
      payload.coverageStartDate,
      payload.coverage_start_date,
      payload.fecha_inicio_cobertura
    ),
    coverage_start_date: firstNonEmpty(
      payload.coverageStartDate,
      payload.coverage_start_date,
      payload.fecha_inicio_cobertura
    ),
    fecha_inicio_cobertura: firstNonEmpty(
      payload.coverageStartDate,
      payload.coverage_start_date,
      payload.fecha_inicio_cobertura
    ),

    eps: firstNonEmpty(payload.eps),

    pensionFund: firstNonEmpty(
      payload.pensionFund,
      payload.pension_fund,
      payload.fondo_pension
    ),
    pension_fund: firstNonEmpty(
      payload.pensionFund,
      payload.pension_fund,
      payload.fondo_pension
    ),
    fondo_pension: firstNonEmpty(
      payload.pensionFund,
      payload.pension_fund,
      payload.fondo_pension
    ),

    compensationBox: "COFREM",
    compensation_box: "COFREM",
    caja_compensacion: "COFREM",

    arl: "SURA",

    gestorZona: firstNonEmpty(payload.gestorZona, payload.gestor_zona, ""),
    gestor_zona: firstNonEmpty(payload.gestorZona, payload.gestor_zona, ""),

    updatedAt: new Date().toISOString(),
  };
}

function validatePersonnelBusinessRules(record = {}) {
  if (!record.fullName) {
    throw new Error("El nombre completo del empleado es obligatorio");
  }

  if (!record.documentNumber && !record.numero_documento) {
    throw new Error("El número de documento es obligatorio");
  }

  if (record.presented_in_offer && !record.offered_position) {
    throw new Error("Debe seleccionar el cargo presentado en la oferta");
  }
}

function getPersonnel() {
  return readPersonnel();
}

function getVisibleResumeRecords(user) {
  const personnel = readPersonnel();

  if (user.role === "administrador") return personnel;

  return personnel.filter((p) => {
    const sameCompany = !user.companyId || !p.companyId || p.companyId === user.companyId;
    const sameContract =
      !user.contractId || !p.contractId || p.contractId === user.contractId;

    return sameCompany && sameContract;
  });
}

function createPersonnel(newPerson) {
  const personnel = readPersonnel();

  const record = normalizePersonnelPayload({
    id: Date.now(),
    ...newPerson,
    createdAt: new Date().toISOString(),
  });

  validatePersonnelBusinessRules(record);

  personnel.push(record);
  writePersonnel(personnel);

  return record;
}

function updatePersonnel(id, updatedData) {
  const personnel = readPersonnel();
  const index = personnel.findIndex((p) => String(p.id) === String(id));

  if (index === -1) return null;

  const record = normalizePersonnelPayload({
    ...personnel[index],
    ...updatedData,
  });

  validatePersonnelBusinessRules(record);

  personnel[index] = record;
  writePersonnel(personnel);

  return record;
}

function findExcelColumn(row, possibleNames = []) {
  const keys = Object.keys(row || {});

  return keys.find((key) => {
    const normalizedKey = normalize(key);
    return possibleNames.some((name) => normalizedKey.includes(normalize(name)));
  });
}

function getCell(row, possibleNames = []) {
  const column = findExcelColumn(row, possibleNames);
  return column ? cleanText(row[column]) : "";
}

function mapExcelRowToPersonnel(row = {}, defaults = {}) {
  const firstName = getCell(row, ["NOMBRE 1", "PRIMER NOMBRE"]);
  const secondName = getCell(row, ["NOMBRE 2", "SEGUNDO NOMBRE"]);
  const firstLastName = getCell(row, ["APELLIDO 1", "PRIMER APELLIDO"]);
  const secondLastName = getCell(row, ["APELLIDO 2", "SEGUNDO APELLIDO"]);

  const fullName = firstNonEmpty(
    getCell(row, ["NOMBRE COMPLETO"]),
    [firstName, secondName, firstLastName, secondLastName].filter(Boolean).join(" ")
  );

  const documentNumber = getCell(row, [
    "CEDULA",
    "CÉDULA",
    "DOCUMENTO",
    "NUMERO DOCUMENTO",
    "IDENTIFICACION",
  ]);

  const municipality = getCell(row, ["MUNICIPIO"]);

  return {
    ...defaults,

    firstName,
    secondName,
    firstLastName,
    secondLastName,

    primer_nombre: firstName,
    segundo_nombre: secondName,
    primer_apellido: firstLastName,
    segundo_apellido: secondLastName,

    fullName,
    nombre: fullName,
    name: fullName,

    documentType: "CC",
    documentNumber,
    numero_documento: documentNumber,

    cargo_real: getCell(row, ["CARGO"]),
    real_position: getCell(row, ["CARGO"]),
    position: getCell(row, ["CARGO"]),

    birthDate: getCell(row, ["HBD"]),
    birthDay: getCell(row, ["HBD DIA"]),
    birthMonth: getCell(row, ["HBD MES"]),
    birthYear: getCell(row, ["HBD AÑO"]),

    expeditionDate: getCell(row, ["EXP"]),
    expeditionDay: getCell(row, ["EXP DIA"]),
    expeditionMonth: getCell(row, ["EXP MES"]),
    expeditionYear: getCell(row, ["EXP AÑO"]),

    sex: getCell(row, ["SEXO"]),

    expeditionPlace: getCell(row, [
      "LUGAR DE EXPEDICIÓN",
      "LUGAR DE EXPEDICION",
    ]),

    birthDepartment: getCell(row, [
      "DEP HBD",
      "DEP  HBD",
    ]),

    birthPlace: getCell(row, ["LUGAR HBD"]),

    address: getCell(row, ["DIRECCION", "DIRECCIÓN"]),
    neighborhood: getCell(row, ["BARRIO"]),
    phone: getCell(row, ["CELULAR", "TELEFONO", "TELÉFONO"]),
    email: getCell(row, ["CORREO", "EMAIL"]),
    civilStatus: getCell(row, ["ESTADO CIVIL"]),

    municipalityName: municipality,
    municipality: municipality,
    municipio: municipality,

    status: "ACTIVO",
    estado: "ACTIVO",

    presentedInOffer: false,
    presented_in_offer: false,
    presentacion_en_licitacion: false,

    offered_position: "",
    offer_position: "",
    offerPosition: "",
    cargo_presentado_en_licitacion: "",

    educationalMunicipality: "",
    educational_municipality: "",
    municipio_educativo: "",
    municipio_institucional: "",

    institution: "",
    institucion_educativa: "",

    site: "",
    sede_educativa: "",

    educationalModality: "",
    modalidad: "",

    compensationBox: "COFREM",
    compensation_box: "COFREM",
    caja_compensacion: "COFREM",

    arl: "SURA",
  };
}

function importPersonnelFromExcel({ fileBase64, fileName, defaults = {} }) {
  if (!fileBase64 || !fileBase64.startsWith("data:")) {
    throw new Error("Debes enviar un archivo Excel válido.");
  }

  const base64Data = fileBase64.split("base64,")[1];

  if (!base64Data) {
    throw new Error("Archivo Excel inválido.");
  }

  const buffer = Buffer.from(base64Data, "base64");
  const workbook = XLSX.read(buffer, { type: "buffer" });

  if (!workbook.SheetNames.length) {
    throw new Error("El archivo Excel no tiene hojas.");
  }

  let rows = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
    });

    const headerIndex = matrix.findIndex((row) => {
      const text = normalize(row.join(" "));
      return (
        text.includes("DOCUMENTO") ||
        text.includes("CEDULA") ||
        text.includes("IDENTIFICACION")
      ) && (
        text.includes("NOMBRE") ||
        text.includes("EMPLEADO")
      );
    });

    if (headerIndex === -1) continue;

    const headers = matrix[headerIndex].map((value, index) => {
      const header = cleanText(value);
      return header || `COLUMNA_${index + 1}`;
    });

    rows = matrix
      .slice(headerIndex + 1)
      .map((row) => {
        const item = {};

        headers.forEach((header, index) => {
          item[header] = row[index] ?? "";
        });

        return item;
      })
      .filter((row) => {
        const values = Object.values(row).join(" ").trim();
        return values !== "";
      });

    if (rows.length) break;
  }

  if (!rows.length) {
    throw new Error(
      "No encontré registros válidos. Verifica que el Excel tenga columnas como DOCUMENTO y NOMBRE."
    );
  }

  const personnel = readPersonnel();
  const existingByDocument = new Map();

  personnel.forEach((person, index) => {
    const documentNumber = normalize(
      firstNonEmpty(person.documentNumber, person.numero_documento)
    );

    if (documentNumber) {
      existingByDocument.set(documentNumber, index);
    }
  });

  let created = 0;
  let updated = 0;
  let omitted = 0;

  const errors = [];

  rows.forEach((row, index) => {
    const excelRowNumber = index + 2;

    try {
      const mapped = mapExcelRowToPersonnel(row, defaults);
      const normalized = normalizePersonnelPayload(mapped);

      validatePersonnelBusinessRules(normalized);

      const documentKey = normalize(normalized.documentNumber);

      if (!documentKey) {
        omitted += 1;
        errors.push({
          row: excelRowNumber,
          message: "Fila omitida: no tiene número de documento.",
        });
        return;
      }

      if (existingByDocument.has(documentKey)) {
        const existingIndex = existingByDocument.get(documentKey);

        personnel[existingIndex] = normalizePersonnelPayload({
          ...personnel[existingIndex],
          ...normalized,
          id: personnel[existingIndex].id,
          updatedAt: new Date().toISOString(),
        });

        updated += 1;
      } else {
        const record = normalizePersonnelPayload({
          id: Date.now() + index,
          ...normalized,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        personnel.push(record);
        existingByDocument.set(documentKey, personnel.length - 1);

        created += 1;
      }
    } catch (error) {
      omitted += 1;

      errors.push({
        row: excelRowNumber,
        message: error.message,
      });
    }
  });

  writePersonnel(personnel);

  return {
    fileName,
    totalRows: rows.length,
    created,
    updated,
    omitted,
    errors,
  };
}

module.exports = {
  getPersonnel,
  getVisibleResumeRecords,
  createPersonnel,
  updatePersonnel,
  importPersonnelFromExcel,
};