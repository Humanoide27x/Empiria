"use strict";

const crypto = require("crypto");
const pool = require("../../db/pool");
const { createEmployee } = require("../../db/employees.repository");
const { normalizeText } = require("../../utils/text");

const SIZE_FIELDS = [
  { key: "uniforme", label: "Uniforme", columns: ["UNIFORME", "TALLA UNIFORME", "TALLA_UNIFORME"] },
  { key: "talla_camisa", label: "Talla camisa", columns: ["TALLA_CAMISA", "TALLA CAMISA", "CAMISA"] },
  { key: "talla_pantalon", label: "Talla pantalon", columns: ["TALLA_PANTALON", "TALLA PANTALON", "PANTALON"] },
  { key: "calzado", label: "Calzado", columns: ["CALZADO", "TALLA CALZADO", "TALLA_CALZADO", "TALLA ZAPATOS", "TALLA_ZAPATOS"] },
];

const UPDATE_FIELDS = [
  { key: "full_name", label: "Nombre completo", column: "full_name" },
  { key: "real_position", label: "Cargo real", column: "real_position" },
  { key: "gestor_zona", label: "Gestor zona", column: "gestor_zona" },
  { key: "municipality_id", label: "Municipio", column: "municipality_id" },
  { key: "company_id", label: "Empresa", column: "company_id" },
  { key: "contract_id", label: "Contrato", column: "contract_id" },
  { key: "workday_type", label: "Tipo jornada", column: "workday_type" },
  { key: "status", label: "Estado", column: "status" },
  { key: "phone", label: "Celular", column: "phone" },
  { key: "email", label: "Correo", column: "email" },
  { key: "address", label: "Direccion", column: "address" },
  { key: "neighborhood", label: "Barrio", column: "neighborhood" },
  { key: "civil_status", label: "Estado civil", column: "civil_status" },
  { key: "institution_id", label: "Institucion", column: "institution_id" },
  { key: "site_id", label: "Sede", column: "site_id" },
  { key: "modality", label: "Modalidad", column: "modality" },
  { key: "eps", label: "EPS", column: "eps" },
  { key: "pension_fund", label: "Fondo pensiones", column: "pension_fund" },
  { key: "compensation_box", label: "Caja compensacion", column: "compensation_box" },
  { key: "arl", label: "ARL", column: "arl" },
  ...SIZE_FIELDS.map((field) => ({ key: field.key, label: field.label, column: field.key, group: "Dotacion y tallas" })),
];

const UPDATE_FIELD_BY_KEY = new Map(UPDATE_FIELDS.map((field) => [field.key, field]));

const UPDATE_FIELD_COLUMNS = {
  full_name: ["NOMBRE COMPLETO", "NOMBRE EMPLEADO", "EMPLEADO", "PRIMER NOMBRE", "SEGUNDO NOMBRE", "PRIMER APELLIDO", "SEGUNDO APELLIDO"],
  real_position: ["CARGO REAL", "CARGO"],
  gestor_zona: ["GESTOR ZONA", "GESTOR DE ZONA", "GESTOR"],
  municipality_id: ["MUNICIPIO OPERACION", "MUNICIPIO DE OPERACION", "MUNICIPIO"],
  company_id: ["EMPRESA", "NOMBRE EMPRESA", "EMPRESA ID", "COMPANY ID"],
  contract_id: ["CONTRATO", "NOMBRE CONTRATO", "CONTRATO NOMBRE", "CONTRATO ID", "CONTRACT ID"],
  workday_type: ["TIPO JORNADA", "TIPO DE JORNADA", "JORNADA", "TIEMPO", "TC MT"],
  status: ["ESTADO", "ESTADO LABORAL"],
  phone: ["CELULAR", "TELEFONO", "TELÉFONO", "MOVIL"],
  email: ["CORREO", "EMAIL", "CORREO ELECTRONICO"],
  address: ["DIRECCION", "DIRECCIÓN", "DIRECCION RESIDENCIA"],
  neighborhood: ["BARRIO", "BARRIO RESIDENCIA"],
  civil_status: ["ESTADO CIVIL"],
  institution_id: ["INSTITUCION EDUCATIVA", "INSTITUCION", "INSTITUCIÓN"],
  site_id: ["SEDE EDUCATIVA", "SEDE"],
  modality: ["MODALIDAD"],
  eps: ["EPS"],
  pension_fund: ["FONDO PENSIONES", "PENSION", "AFP"],
  compensation_box: ["CAJA COMPENSACION", "CAJA"],
  arl: ["ARL"],
  ...Object.fromEntries(SIZE_FIELDS.map((field) => [field.key, field.columns])),
};

function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function normalizeKey(value) {
  return normalize(value).replace(/[^A-Z0-9]/g, "");
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function normalizeSize(value) {
  const text = normalize(value).replace(/[^A-Z0-9]/g, "");
  return text;
}

function isFoodHandlerPosition(value) {
  const position = normalize(value);
  return position.includes("OPERARIO") &&
    position.includes("MANIPULADOR") &&
    position.includes("ALIMENTOS");
}

function extractSizeFields(raw = {}) {
  return SIZE_FIELDS.reduce((acc, field) => {
    acc[field.key] = normalizeSize(getCell(raw, field.columns));
    return acc;
  }, {});
}

function getApplicableSizeKeys(positionValue) {
  return isFoodHandlerPosition(positionValue)
    ? ["uniforme", "calzado"]
    : ["talla_camisa", "talla_pantalon", "calzado"];
}

function extractApplicableSizeFields(raw = {}, positionValue = "") {
  const sizes = extractSizeFields(raw);
  if (!cleanText(positionValue)) return sizes;
  const allowed = new Set(getApplicableSizeKeys(positionValue));
  return Object.fromEntries(
    Object.entries(sizes).map(([key, value]) => [key, allowed.has(key) ? value : ""])
  );
}

function findExcelColumn(row, possibleNames = []) {
  const keys = Object.keys(row || {});
  const normKeys = keys.map((key) => ({ key, norm: normalize(key) }));
  for (const name of possibleNames) {
    const n = normalize(name);
    const hit = normKeys.find(({ norm }) => norm === n);
    if (hit) return hit.key;
  }
  const byLength = [...possibleNames].sort((a, b) => b.length - a.length);
  for (const name of byLength) {
    const n = normalize(name);
    const hit = normKeys.find(({ norm }) => norm.includes(n));
    if (hit) return hit.key;
  }
  return undefined;
}

function getCell(row, possibleNames = []) {
  const column = findExcelColumn(row, possibleNames);
  return column !== undefined ? cleanText(row[column]) : "";
}

function hasCellValue(row, possibleNames = []) {
  return Boolean(getCell(row, possibleNames));
}

function hasColumn(row, possibleNames = []) {
  return findExcelColumn(row, possibleNames) !== undefined;
}

function parseExcelRows(fileBase64) {
  if (!fileBase64 || !fileBase64.startsWith("data:")) {
    throw new Error("Debes enviar un archivo Excel valido.");
  }

  const XLSX = require("xlsx");
  const base64Data = fileBase64.split("base64,")[1];
  if (!base64Data) throw new Error("Archivo Excel invalido.");

  const workbook = XLSX.read(Buffer.from(base64Data, "base64"), { type: "buffer", cellDates: true });
  if (!workbook.SheetNames.length) throw new Error("El archivo Excel no tiene hojas.");

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const headerIndex = matrix.findIndex((row) => {
      const text = normalize(row.join(" "));
      const hasDocument = text.includes("DOCUMENTO") || text.includes("CEDULA") || text.includes("IDENTIFICACION");
      const hasName = text.includes("NOMBRE") || text.includes("EMPLEADO");
      const hasDotacion = text.includes("UNIFORME") || text.includes("CALZADO") ||
        text.includes("TALLA CAMISA") || text.includes("TALLA PANTALON") ||
        text.includes("TALLA_CAMISA") || text.includes("TALLA_PANTALON") || text.includes("TALLA_CALZADO");
      return hasDocument && (hasName || hasDotacion);
    });

    if (headerIndex === -1) continue;

    const headers = matrix[headerIndex].map((v, i) => cleanText(v) || `COLUMNA_${i + 1}`);
    const rows = matrix
      .slice(headerIndex + 1)
      .map((row, index) => {
        const raw = {};
        headers.forEach((header, i) => { raw[header] = row[i] ?? ""; });
        return { rowNumber: headerIndex + index + 2, raw };
      })
      .filter((item) => Object.values(item.raw).join(" ").trim() !== "");

    if (rows.length) return rows;
  }

  throw new Error("No encontre registros validos. Verifica columnas como DOCUMENTO y NOMBRE.");
}

function extractStagingFields(raw = {}, defaults = {}) {
  const firstName = getCell(raw, ["PRIMER NOMBRE", "NOMBRE 1", "NOMBRE1"]);
  const secondName = getCell(raw, ["SEGUNDO NOMBRE", "NOMBRE 2", "NOMBRE2"]);
  const firstLastName = getCell(raw, ["PRIMER APELLIDO", "APELLIDO 1", "APELLIDO1"]);
  const secondLastName = getCell(raw, ["SEGUNDO APELLIDO", "APELLIDO 2", "APELLIDO2"]);

  const realPositionText = getCell(raw, ["CARGO REAL", "CARGO"]);

  return {
    documentNumber: getCell(raw, [
      "NUMERO DOCUMENTO", "NUMERO DE DOCUMENTO", "CEDULA", "CEDULA DE CIUDADANIA", "IDENTIFICACION", "DOCUMENTO",
    ]),
    fullName: firstNonEmpty(
      getCell(raw, ["NOMBRE COMPLETO", "NOMBRE EMPLEADO", "EMPLEADO"]),
      [firstName, secondName, firstLastName, secondLastName].filter(Boolean).join(" ")
    ),
    municipalityText: getCell(raw, ["MUNICIPIO OPERACION", "MUNICIPIO DE OPERACION", "MUNICIPIO"]),
    managerText: getCell(raw, ["GESTOR ZONA", "GESTOR DE ZONA", "GESTOR"]),
    contractText: firstNonEmpty(
      getCell(raw, ["CONTRATO", "NOMBRE CONTRATO", "CONTRATO NOMBRE"]),
      getCell(raw, ["CONTRATO ID", "CONTRACT ID"]),
      defaults.contractId
    ),
    companyText: firstNonEmpty(
      getCell(raw, ["EMPRESA", "NOMBRE EMPRESA"]),
      getCell(raw, ["EMPRESA ID", "COMPANY ID"]),
      defaults.companyId
    ),
    realPositionText,
    sizes: extractApplicableSizeFields(raw, realPositionText),
  };
}

function mapRawToEmployee(raw = {}, staging = {}) {
  const firstName = getCell(raw, ["PRIMER NOMBRE", "NOMBRE 1", "NOMBRE1"]);
  const secondName = getCell(raw, ["SEGUNDO NOMBRE", "NOMBRE 2", "NOMBRE2"]);
  const firstLastName = getCell(raw, ["PRIMER APELLIDO", "APELLIDO 1", "APELLIDO1"]);
  const secondLastName = getCell(raw, ["SEGUNDO APELLIDO", "APELLIDO 2", "APELLIDO2"]);
  const rawWorkday = normalize(getCell(raw, ["TIPO JORNADA", "TIPO DE JORNADA", "JORNADA", "TIEMPO", "TC MT"]));
  const rawStatus = normalize(getCell(raw, ["ESTADO", "ESTADO LABORAL"]));

  return {
    firstName,
    secondName,
    firstLastName,
    secondLastName,
    primer_nombre: firstName,
    segundo_nombre: secondName,
    primer_apellido: firstLastName,
    segundo_apellido: secondLastName,
    fullName: staging.full_name,
    nombre: staging.full_name,
    documentType: normalize(getCell(raw, ["TIPO DOCUMENTO", "TIPO DE DOCUMENTO"])) || "CC",
    documentNumber: staging.document_number,
    cargo_real: staging.resolved_position_label,
    gestorZona: staging.resolved_manager_label || "",
    municipalityId: staging.resolved_municipality_id,
    companyId: staging.resolved_company_id,
    contractId: staging.resolved_contract_id,
    workdayType: rawWorkday.includes("MT") || rawWorkday.includes("MEDIO") ? "MT" : "TC",
    status: rawStatus === "INACTIVO" || rawStatus === "RETIRADO" ? rawStatus : "ACTIVO",
    phone: getCell(raw, ["CELULAR", "TELEFONO", "TELÉFONO", "MOVIL"]),
    email: getCell(raw, ["CORREO", "EMAIL", "CORREO ELECTRONICO"]),
    address: getCell(raw, ["DIRECCION", "DIRECCIÓN", "DIRECCION RESIDENCIA"]),
    neighborhood: getCell(raw, ["BARRIO", "BARRIO RESIDENCIA"]),
    civilStatus: getCell(raw, ["ESTADO CIVIL"]),
    institution: getCell(raw, ["INSTITUCION EDUCATIVA", "INSTITUCION", "INSTITUCIÓN"]),
    site: getCell(raw, ["SEDE EDUCATIVA", "SEDE"]),
    modality: getCell(raw, ["MODALIDAD"]),
    eps: getCell(raw, ["EPS"]),
    pensionFund: getCell(raw, ["FONDO PENSIONES", "PENSION", "AFP"]),
    compensationBox: getCell(raw, ["CAJA COMPENSACION", "CAJA"]) || "COFREM",
    arl: getCell(raw, ["ARL"]) || "SURA",
    ...extractApplicableSizeFields(raw, staging.resolved_position_label || staging.real_position_text),
  };
}

function getImportUpdateValues(raw = {}, staging = {}) {
  const employee = mapRawToEmployee(raw, staging);
  return {
    full_name: employee.fullName,
    real_position: employee.cargo_real,
    gestor_zona: employee.gestorZona,
    municipality_id: employee.municipalityId,
    company_id: employee.companyId,
    contract_id: employee.contractId,
    workday_type: employee.workdayType,
    status: employee.status,
    phone: employee.phone,
    email: employee.email,
    address: employee.address,
    neighborhood: employee.neighborhood,
    civil_status: employee.civilStatus,
    institution_id: null,
    site_id: null,
    modality: employee.modality,
    eps: employee.eps,
    pension_fund: employee.pensionFund,
    compensation_box: employee.compensationBox,
    arl: employee.arl,
    ...extractApplicableSizeFields(raw, staging.resolved_position_label || staging.real_position_text),
  };
}

function presentImportFields(raw = {}, staging = {}) {
  const values = getImportUpdateValues(raw, staging);
  const present = new Set();
  for (const field of UPDATE_FIELDS) {
    const value = values[field.key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      present.add(field.key);
    }
  }
  for (const field of UPDATE_FIELDS) {
    const aliases = UPDATE_FIELD_COLUMNS[field.key] || [];
    if (aliases.length && !hasColumn(raw, aliases)) {
      present.delete(field.key);
    }
  }
  return present;
}

function buildConflicts(row, existingEmployee) {
  if (!existingEmployee) return [];
  const values = getImportUpdateValues(row.raw_data || {}, row);
  const present = presentImportFields(row.raw_data || {}, row);
  const conflicts = [];
  for (const field of UPDATE_FIELDS) {
    if (!present.has(field.key)) continue;
    const incoming = values[field.key];
    const current = existingEmployee[field.column];
    if (String(current ?? "").trim() !== String(incoming ?? "").trim()) {
      conflicts.push({
        field: field.key,
        label: field.label,
        current: current ?? "",
        incoming: incoming ?? "",
      });
    }
  }
  return conflicts;
}

async function exactOrAlias(client, type, value, exactQuery, aliasTargetQuery) {
  const text = cleanText(value);
  if (!text) return { status: "missing", matches: [] };

  const exact = await client.query(exactQuery.sql, exactQuery.values(text));
  if (exact.rows.length === 1) return { status: "ok", match: exact.rows[0] };
  if (exact.rows.length > 1) return { status: "ambiguous", matches: exact.rows };

  const alias = await client.query(
    `SELECT target_id, target_label
     FROM import_aliases
     WHERE type = $1 AND active = true AND UPPER(TRIM(source_value)) = UPPER(TRIM($2))
     LIMIT 2`,
    [type, text]
  );
  if (alias.rows.length > 1) return { status: "ambiguous", matches: alias.rows };
  if (alias.rows[0]) {
    if (!aliasTargetQuery) {
      return { status: "ok", match: { id: alias.rows[0].target_id, label: alias.rows[0].target_label, name: alias.rows[0].target_label } };
    }
    const target = await client.query(aliasTargetQuery.sql, aliasTargetQuery.values(alias.rows[0]));
    if (target.rows.length === 1) return { status: "ok", match: target.rows[0] };
  }

  return { status: "not_found", matches: [] };
}

function pushIssue(issues, code, message, field, severity = "ERROR") {
  issues.push({ code, message, field, severity });
}

async function validateBatch(importBatchId, clientArg = null) {
  const client = clientArg || pool;
  const { rows } = await client.query(
    `SELECT * FROM employee_import_staging WHERE import_batch_id = $1 ORDER BY row_number`,
    [importBatchId]
  );

  const seen = new Set();
  const docKeys = rows.map((row) => normalize(row.document_number)).filter(Boolean);
  const existingDocs = docKeys.length
    ? await client.query(
        `SELECT
           UPPER(TRIM(document_number)) AS doc,
           id, full_name, document_number, real_position, gestor_zona,
           municipality_id, company_id, contract_id, workday_type, status,
           phone, email, address, neighborhood, civil_status,
           institution_id, site_id, modality, eps, pension_fund,
           compensation_box, arl,
           uniforme, calzado, talla_camisa, talla_pantalon
         FROM employees
         WHERE UPPER(TRIM(document_number)) = ANY($1)`,
        [docKeys]
      )
    : { rows: [] };
  const existingByDoc = new Map(existingDocs.rows.map((row) => [row.doc, row]));

  for (const row of rows) {
    const issues = [];
    const resolved = {
      municipalityId: null,
      managerId: null,
      managerLabel: null,
      contractId: null,
      companyId: null,
      positionId: null,
      positionLabel: null,
    };

    if (!cleanText(row.document_number)) pushIssue(issues, "REQUIRED_DOCUMENT", "Documento obligatorio faltante.", "document_number");

    const docKey = normalize(row.document_number);
    const existingEmployee = docKey ? existingByDoc.get(docKey) : null;
    if (existingEmployee) pushIssue(issues, "EXISTING_EMPLOYEE", "Empleado existente: candidato a actualizacion.", "document_number", "INFO");
    if (docKey && seen.has(docKey)) pushIssue(issues, "DUPLICATE_IN_BATCH", "Documento repetido en el archivo.", "document_number");
    if (docKey) seen.add(docKey);

    if (!existingEmployee) {
      if (!cleanText(row.full_name)) pushIssue(issues, "REQUIRED_NAME", "Nombre obligatorio faltante.", "full_name");
      if (!cleanText(row.municipality_text)) pushIssue(issues, "REQUIRED_MUNICIPALITY", "Municipio obligatorio faltante.", "municipality_text");
      if (!cleanText(row.contract_text)) pushIssue(issues, "REQUIRED_CONTRACT", "Contrato obligatorio faltante.", "contract_text");
      if (!cleanText(row.real_position_text)) pushIssue(issues, "REQUIRED_POSITION", "Cargo real obligatorio faltante.", "real_position_text");
    }

    const company = row.resolved_company_id
      ? { status: "ok", match: { id: row.resolved_company_id } }
      : await exactOrAlias(client, "company", row.company_text, {
      sql: `SELECT id, name FROM companies WHERE active = true AND (id::text = TRIM($1) OR UPPER(TRIM(name)) = UPPER(TRIM($1))) LIMIT 2`,
      values: (text) => [text],
    }, {
      sql: `SELECT id, name FROM companies WHERE active = true AND id = $1`,
      values: (alias) => [alias.target_id],
    });
    if (company.status === "ok") resolved.companyId = company.match.id;
    else if (company.status === "ambiguous") pushIssue(issues, "COMPANY_AMBIGUOUS", "Empresa ambigua.", "company_text", "NEEDS_REVIEW");
    else if (row.company_text) pushIssue(issues, "COMPANY_NOT_FOUND", "Empresa no encontrada.", "company_text", "NEEDS_REVIEW");

    const contract = row.resolved_contract_id
      ? await (async () => {
          const r = await client.query(`SELECT id, name, company_id FROM contracts WHERE active = true AND id = $1`, [row.resolved_contract_id]);
          return r.rows[0] ? { status: "ok", match: r.rows[0] } : { status: "not_found", matches: [] };
        })()
      : await exactOrAlias(client, "contract", row.contract_text, {
      sql: `SELECT id, name, company_id FROM contracts
            WHERE active = true AND (id::text = TRIM($1) OR UPPER(TRIM(name)) = UPPER(TRIM($1)) OR UPPER(TRIM(COALESCE(code,''))) = UPPER(TRIM($1)))
            LIMIT 2`,
      values: (text) => [text],
    }, {
      sql: `SELECT id, name, company_id FROM contracts WHERE active = true AND id = $1`,
      values: (alias) => [alias.target_id],
    });
    if (contract.status === "ok") resolved.contractId = contract.match.id;
    else if (contract.status === "ambiguous") pushIssue(issues, "CONTRACT_AMBIGUOUS", "Contrato ambiguo.", "contract_text", "NEEDS_REVIEW");
    else if (row.contract_text) pushIssue(issues, "CONTRACT_NOT_FOUND", "Contrato no encontrado.", "contract_text", "NEEDS_REVIEW");

    if (resolved.companyId && contract.match?.company_id && Number(contract.match.company_id) !== Number(resolved.companyId)) {
      pushIssue(issues, "COMPANY_CONTRACT_MISMATCH", "El contrato no pertenece a la empresa indicada.", "contract_text");
    }
    if (!resolved.companyId && contract.match?.company_id) resolved.companyId = contract.match.company_id;
    if (!resolved.companyId && !existingEmployee) {
      pushIssue(issues, "COMPANY_NOT_FOUND", "Empresa no encontrada.", "company_text", row.company_text ? "NEEDS_REVIEW" : "ERROR");
    }

    const municipality = row.resolved_municipality_id
      ? { status: "ok", match: { id: row.resolved_municipality_id } }
      : await exactOrAlias(client, "municipality", row.municipality_text, {
      sql: `SELECT id, name FROM municipalities WHERE UPPER(TRIM(name)) = UPPER(TRIM($1)) LIMIT 2`,
      values: (text) => [text],
    }, {
      sql: `SELECT id, name FROM municipalities WHERE id = $1`,
      values: (alias) => [alias.target_id],
    });
    if (municipality.status === "ok") resolved.municipalityId = municipality.match.id;
    else if (municipality.status === "ambiguous") pushIssue(issues, "MUNICIPALITY_AMBIGUOUS", "Municipio ambiguo.", "municipality_text", "NEEDS_REVIEW");
    else if (row.municipality_text) pushIssue(issues, "MUNICIPALITY_NOT_FOUND", "Municipio no encontrado.", "municipality_text", "NEEDS_REVIEW");

    const manager = row.resolved_manager_id || row.resolved_manager_label
      ? { status: "ok", match: { id: row.resolved_manager_id, name: row.resolved_manager_label || row.manager_text } }
      : await exactOrAlias(client, "manager", row.manager_text, {
      sql: `SELECT id, full_name AS name FROM employees
            WHERE UPPER(TRIM(full_name)) = UPPER(TRIM($1))
              AND status IN ('ACTIVO','preingreso','PREINGRESO')
            LIMIT 2`,
      values: (text) => [text],
    }, {
      sql: `SELECT id, full_name AS name FROM employees WHERE id = $1`,
      values: (alias) => [alias.target_id],
    });
    if (manager.status === "ok") {
      resolved.managerId = manager.match.id || null;
      resolved.managerLabel = manager.match.name || manager.match.label || row.manager_text;
    } else if (manager.status === "ambiguous") {
      pushIssue(issues, "MANAGER_AMBIGUOUS", "Gestor ambiguo.", "manager_text", "NEEDS_REVIEW");
    } else if (row.manager_text) {
      pushIssue(issues, "MANAGER_NOT_FOUND", "Gestor no encontrado.", "manager_text", "NEEDS_REVIEW");
    }

    const position = row.resolved_position_id || row.resolved_position_label
      ? { status: "ok", match: { id: row.resolved_position_id, name: row.resolved_position_label || row.real_position_text } }
      : await exactOrAlias(client, "position", row.real_position_text, {
      sql: `SELECT MIN(id) AS id, name FROM (
              SELECT id, name FROM positions
              WHERE active = true AND UPPER(TRIM(name)) = UPPER(TRIM($1))
              UNION
              SELECT NULL::integer AS id, TRIM(real_position) AS name FROM employees
              WHERE NULLIF(TRIM(real_position), '') IS NOT NULL
                AND UPPER(TRIM(real_position)) = UPPER(TRIM($1))
            ) matches
            GROUP BY name
            LIMIT 2`,
      values: (text) => [text],
    }, {
      sql: `SELECT id, name FROM positions WHERE active = true AND id = $1`,
      values: (alias) => [alias.target_id],
    });
    if (position.status === "ok") {
      resolved.positionId = position.match.id || null;
      resolved.positionLabel = position.match.name || position.match.label || row.real_position_text;
    } else if (position.status === "ambiguous") {
      pushIssue(issues, "POSITION_AMBIGUOUS", "Cargo real ambiguo.", "real_position_text", "NEEDS_REVIEW");
    } else if (row.real_position_text) {
      pushIssue(issues, "POSITION_NOT_FOUND", "Cargo real no encontrado.", "real_position_text", "NEEDS_REVIEW");
    }

    const conflicts = buildConflicts(row, existingEmployee);
    if (existingEmployee && conflicts.length) {
      pushIssue(issues, "HAS_CONFLICTS", "Existen diferencias entre el Excel y la BD.", "row", "NEEDS_REVIEW");
    }

    const hasErrors = issues.some((issue) => issue.severity === "ERROR");
    const hasReview = issues.some((issue) => issue.severity === "NEEDS_REVIEW");
    const status = hasErrors
      ? "ERROR"
      : existingEmployee && conflicts.length
        ? "HAS_CONFLICTS"
        : existingEmployee
          ? "EXISTING_EMPLOYEE"
          : hasReview
            ? "NEEDS_REVIEW"
            : "VALID";

    await client.query(
      `UPDATE employee_import_staging SET
         status = $2,
         errors = $3::jsonb,
         resolved_municipality_id = $4,
         resolved_manager_id = $5,
         resolved_manager_label = $6,
         resolved_contract_id = $7,
         resolved_company_id = $8,
         resolved_position_id = $9,
         resolved_position_label = $10,
         existing_employee_id = $11,
         conflicts = $12::jsonb
       WHERE id = $1`,
      [
        row.id,
        status,
        JSON.stringify(issues),
        resolved.municipalityId,
        resolved.managerId,
        resolved.managerLabel,
        resolved.contractId,
        resolved.companyId,
        resolved.positionId,
        resolved.positionLabel,
        existingEmployee?.id || null,
        JSON.stringify(conflicts),
      ]
    );
  }

  return getBatchSummary(importBatchId, client);
}

async function getBatchSummary(importBatchId, client = pool) {
  const { rows } = await client.query(
    `SELECT
       COUNT(*)::int AS total_rows,
       COUNT(*) FILTER (WHERE status = 'VALID')::int AS valid_rows,
       COUNT(*) FILTER (WHERE status = 'ERROR')::int AS error_rows,
       COUNT(*) FILTER (WHERE status = 'NEEDS_REVIEW')::int AS review_rows,
       COUNT(*) FILTER (WHERE status = 'EXISTING_EMPLOYEE')::int AS existing_rows,
       COUNT(*) FILTER (WHERE status = 'HAS_CONFLICTS')::int AS conflict_rows,
       COUNT(*) FILTER (WHERE errors @> '[{"code":"DUPLICATE_IN_BATCH"}]'::jsonb)::int AS duplicated_rows,
       COUNT(*) FILTER (WHERE status = 'IMPORTED')::int AS imported_rows,
       COUNT(*) FILTER (WHERE status = 'UPDATED')::int AS updated_rows
     FROM employee_import_staging
     WHERE import_batch_id = $1`,
    [importBatchId]
  );
  const s = rows[0] || {};
  return {
    importBatchId,
    totalRows: s.total_rows || 0,
    validRows: s.valid_rows || 0,
    errorRows: s.error_rows || 0,
    needsReviewRows: s.review_rows || 0,
    existingRows: s.existing_rows || 0,
    conflictRows: s.conflict_rows || 0,
    duplicatedRows: s.duplicated_rows || 0,
    importedRows: s.imported_rows || 0,
    updatedRows: s.updated_rows || 0,
  };
}

async function createPreview({ fileBase64, defaults = {}, user }) {
  const parsedRows = parseExcelRows(fileBase64);
  const importBatchId = crypto.randomUUID();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    for (const item of parsedRows) {
      const fields = extractStagingFields(item.raw, defaults);
      await client.query(
        `INSERT INTO employee_import_staging
          (import_batch_id, row_number, document_number, full_name, municipality_text,
           manager_text, contract_text, company_text, real_position_text, raw_data, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
        [
          importBatchId,
          item.rowNumber,
          fields.documentNumber,
          fields.fullName,
          fields.municipalityText,
          fields.managerText,
          fields.contractText,
          fields.companyText,
          fields.realPositionText,
          JSON.stringify(item.raw),
          toInt(user?.id),
        ]
      );
    }
    const summary = await validateBatch(importBatchId, client);
    await client.query("COMMIT");
    return summary;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getBatchRows(importBatchId, onlyProblems = false) {
  const where = onlyProblems ? "AND s.status IN ('ERROR','NEEDS_REVIEW','EXISTING_EMPLOYEE','HAS_CONFLICTS')" : "";
  const { rows } = await pool.query(
    `SELECT s.*, e.full_name AS existing_full_name
     FROM employee_import_staging s
     LEFT JOIN employees e ON e.id = s.existing_employee_id
     WHERE s.import_batch_id = $1 ${where}
     ORDER BY s.row_number`,
    [importBatchId]
  );
  return rows.map((row) => ({
    id: row.id,
    rowNumber: row.row_number,
    documentNumber: row.document_number || "",
    fullName: row.full_name || row.existing_full_name || "",
    municipalityText: row.municipality_text || "",
    managerText: row.manager_text || "",
    contractText: row.contract_text || "",
    companyText: row.company_text || "",
    realPositionText: row.real_position_text || "",
    existingEmployeeId: row.existing_employee_id || null,
    conflicts: Array.isArray(row.conflicts) ? row.conflicts : [],
    sizes: extractApplicableSizeFields(row.raw_data || {}, row.resolved_position_label || row.real_position_text),
    presentFields: [...presentImportFields(row.raw_data || {}, row)],
    status: row.status,
    errors: Array.isArray(row.errors) ? row.errors : [],
  }));
}

async function getCatalogs() {
  const [municipalities, managers, companies, contracts, positions] = await Promise.all([
    pool.query(`SELECT id, name FROM municipalities ORDER BY name`),
    pool.query(`SELECT id, full_name AS name FROM employees WHERE status IN ('ACTIVO','preingreso','PREINGRESO') ORDER BY full_name`),
    pool.query(`SELECT id, name FROM companies WHERE active = true ORDER BY name`),
    pool.query(`SELECT id, name, company_id AS "companyId" FROM contracts WHERE active = true ORDER BY name`),
    pool.query(`SELECT id, name, company_id AS "companyId", contract_id AS "contractId" FROM positions WHERE active = true ORDER BY name`),
  ]);
  return {
    municipalities: municipalities.rows,
    managers: managers.rows,
    companies: companies.rows,
    contracts: contracts.rows,
    positions: positions.rows,
    updateFields: UPDATE_FIELDS,
    sizeFields: SIZE_FIELDS,
  };
}

async function saveAlias(client, type, sourceValue, targetId, targetLabel) {
  if (!cleanText(sourceValue) || !cleanText(targetLabel)) return;
  await client.query(
    `INSERT INTO import_aliases (type, source_value, target_id, target_label, active)
     VALUES ($1,$2,$3,$4,true)
     ON CONFLICT (type, source_value)
     DO UPDATE SET target_id = EXCLUDED.target_id, target_label = EXCLUDED.target_label, active = true, updated_at = NOW()`,
    [type, cleanText(sourceValue), targetId || null, cleanText(targetLabel)]
  );
}

function resolutionToUpdate(type, target = {}) {
  const id = toInt(target.id || target.targetId);
  const label = cleanText(target.label || target.name || target.targetLabel);
  if (type === "municipality") return { field: "municipality_text", sql: "resolved_municipality_id = $VALUE_ID", label: null, id, labelValue: label };
  if (type === "manager") return { field: "manager_text", sql: "resolved_manager_id = $VALUE_ID, resolved_manager_label = $VALUE_LABEL", label, id, labelValue: label };
  if (type === "contract") return { field: "contract_text", sql: "resolved_contract_id = $VALUE_ID", label: null, id, labelValue: label };
  if (type === "company") return { field: "company_text", sql: "resolved_company_id = $VALUE_ID", label: null, id, labelValue: label };
  if (type === "position") return { field: "real_position_text", sql: "resolved_position_id = $VALUE_ID, resolved_position_label = $VALUE_LABEL", label, id, labelValue: label };
  throw new Error("Tipo de correccion no soportado.");
}

async function resolveBatch(importBatchId, payload = {}) {
  const type = cleanText(payload.type);
  const sourceValue = cleanText(payload.sourceValue);
  const applyToAll = payload.applyToAll !== false;
  const saveAliasFlag = Boolean(payload.saveAlias);
  const target = payload.target || {};
  const res = resolutionToUpdate(type, target);

  if (!sourceValue && applyToAll) throw new Error("sourceValue es obligatorio para correccion masiva.");
  if (!res.id && !res.labelValue) throw new Error("Selecciona un destino valido.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const values = [importBatchId];
    let condition = "";
    if (applyToAll) {
      values.push(sourceValue);
      condition = `AND UPPER(TRIM(${res.field})) = UPPER(TRIM($2))`;
    } else if (payload.rowId) {
      values.push(toInt(payload.rowId));
      condition = `AND id = $2`;
    } else {
      throw new Error("Debes indicar rowId o activar applyToAll.");
    }

    const setSql = res.sql
      .replace("$VALUE_ID", res.id ? String(res.id) : "NULL")
      .replace("$VALUE_LABEL", "$" + (values.length + 1));
    if (setSql.includes(`$${values.length + 1}`)) values.push(res.labelValue);

    const updated = await client.query(
      `UPDATE employee_import_staging
       SET ${setSql}
       WHERE import_batch_id = $1 ${condition}
       RETURNING id`,
      values
    );

    if (saveAliasFlag) {
      await saveAlias(client, type, sourceValue, res.id, res.labelValue || sourceValue);
    }

    const summary = await validateBatch(importBatchId, client);
    await client.query("COMMIT");
    return { ...summary, correctedRows: updated.rowCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateEmployeeSelectedFields(client, row, options = {}) {
  const employeeId = toInt(row.existing_employee_id);
  if (!employeeId) return false;

  const selected = Array.isArray(options.updateFields) ? options.updateFields : [];
  const allowOverwriteEmpty = Boolean(options.allowOverwriteEmpty);
  const overrideValues = options.overrideValues && typeof options.overrideValues === "object" ? options.overrideValues : {};
  const current = await client.query(
    `SELECT real_position FROM employees WHERE id = $1`,
    [employeeId]
  );
  const positionForSizes = row.resolved_position_label || row.real_position_text || current.rows[0]?.real_position || "";
  const valuesByField = getImportUpdateValues(row.raw_data || {}, {
    ...row,
    resolved_position_label: positionForSizes,
    real_position_text: positionForSizes,
  });
  const presentFields = presentImportFields(row.raw_data || {}, row);
  const assignments = [];
  const values = [employeeId];

  for (const key of selected) {
    const field = UPDATE_FIELD_BY_KEY.get(key);
    if (!field) continue;
    const hasOverride = Object.prototype.hasOwnProperty.call(overrideValues, key);
    const columnPresent = hasOverride || hasColumn(row.raw_data || {}, UPDATE_FIELD_COLUMNS[key] || []);
    if (!hasOverride && !presentFields.has(key) && (!allowOverwriteEmpty || !columnPresent)) continue;

    const value = hasOverride
      ? (SIZE_FIELDS.some((sizeField) => sizeField.key === key) ? normalizeSize(overrideValues[key]) : cleanText(overrideValues[key]))
      : valuesByField[key];
    if ((value === undefined || value === null || String(value).trim() === "") && !allowOverwriteEmpty) continue;

    values.push(value === undefined ? null : value);
    assignments.push(`${field.column} = $${values.length}`);

    if (field.column === "full_name") {
      values.push(normalizeText(value));
      assignments.push(`normalized_full_name = $${values.length}`);
    }
  }

  if (!assignments.length) return false;

  values.push(new Date());
  await client.query(
    `UPDATE employees
     SET ${assignments.join(", ")}, updated_at = $${values.length}
     WHERE id = $1`,
    values
  );
  return true;
}

async function applySizeFieldsToCreatedEmployee(client, employeeId, raw = {}) {
  const positionValue = getCell(raw, ["CARGO REAL", "CARGO"]);
  const sizes = extractApplicableSizeFields(raw, positionValue);
  const assignments = [];
  const values = [employeeId];
  for (const field of SIZE_FIELDS) {
    const value = sizes[field.key];
    if (!value) continue;
    values.push(value);
    assignments.push(`${field.key} = $${values.length}`);
  }
  if (!assignments.length) return;
  await client.query(
    `UPDATE employees SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    values
  );
}

async function commitBatch(importBatchId, options = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const summary = await validateBatch(importBatchId, client);
    const { rows } = await client.query(
      `SELECT * FROM employee_import_staging
       WHERE import_batch_id = $1
         AND status IN ('VALID','EXISTING_EMPLOYEE','HAS_CONFLICTS')
       ORDER BY row_number`,
      [importBatchId]
    );

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const failures = [];
    for (const row of rows) {
      try {
        if (row.existing_employee_id) {
          const changed = await updateEmployeeSelectedFields(client, row, options);
          await client.query(
            `UPDATE employee_import_staging SET status = $2 WHERE id = $1`,
            [row.id, changed ? "UPDATED" : "SKIPPED"]
          );
          if (changed) updated += 1;
          else skipped += 1;
        } else {
          const newEmployee = await createEmployee(mapRawToEmployee(row.raw_data || {}, row));
          await applySizeFieldsToCreatedEmployee(client, newEmployee.id, row.raw_data || {});
          await client.query(`UPDATE employee_import_staging SET status = 'IMPORTED' WHERE id = $1`, [row.id]);
          imported += 1;
        }
      } catch (error) {
        failures.push({ rowNumber: row.row_number, message: error.message || "Error importando fila" });
        await client.query(
          `UPDATE employee_import_staging
           SET status = 'ERROR',
               errors = errors || $2::jsonb
           WHERE id = $1`,
          [row.id, JSON.stringify([{ code: "COMMIT_FAILED", message: error.message || "Error importando fila", field: "row", severity: "ERROR" }])]
        );
      }
    }

    const after = await getBatchSummary(importBatchId, client);
    await client.query("COMMIT");
    return { ...after, importedRows: imported, updatedRows: updated, skippedRows: skipped, failedOnCommit: failures.length, failures, beforeCommit: summary };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createPreview,
  getBatchRows,
  getCatalogs,
  resolveBatch,
  commitBatch,
  getBatchSummary,
  UPDATE_FIELDS,
  SIZE_FIELDS,
};
