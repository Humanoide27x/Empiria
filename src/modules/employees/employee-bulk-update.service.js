"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");
const XLSX_CFB = XLSX.CFB;

const pool = require("../../db/pool");
const {
  getEmployees,
  getEmployeeById,
  updateEmployee,
} = require("../../db/employees.repository");
const {
  createEmployeeSalaryConfig,
} = require("../payroll/payroll.operational.repository");

const OUTPUT_DIR = path.resolve(process.cwd(), "uploads", "personnel-bulk-updates");
const BOOLEAN_TEXT_LIST = ["true", "false"];
const SENSITIVE_KEYS = new Set(["documentType", "documentNumber", "firstName", "secondName", "firstLastName", "secondLastName"]);
const OPERATIONAL_KEYS = new Set(["municipalityName", "institution", "site", "educationalModality"]);
const LABOR_KEYS = new Set(["companyName", "contractName", "cargoReal", "contractType", "workTimeType", "startDate", "terminationDate", "employmentStatus"]);
const PAYROLL_ALERT_KEYS = new Set(["salaryBase", "transportAllowance", "otherRecargos", "salaryCategory", "cargoReal", "startDate", "terminationDate"]);
const COVERAGE_ALERT_KEYS = new Set(["cargoReal", "municipalityName", "institution", "site", "educationalModality", "startDate", "terminationDate"]);
const UNSUPPORTED_BULK_UPDATE_KEYS = new Set(["salaryCategory", "otherRecargos", "observationsJson", "internalNotes"]);
const MANUALLY_VALIDATED_CATALOG_FIELDS = new Set(["companyName", "contractName", "municipalityName", "institution", "site", "educationalModality"]);
const EXCEL_VALIDATION_RANGE_BY_CATALOG = {
  documentTypes: "CAT_DOCUMENT_TYPES",
  sexes: "CAT_SEXES",
  bloodTypes: "CAT_BLOOD_TYPES",
  eps: "CAT_EPS",
  pensions: "CAT_PENSIONS",
  compensationBoxes: "CAT_COMPENSATION_BOXES",
  arls: "CAT_ARLS",
  companies: "CAT_COMPANIES",
  contracts: "CAT_CONTRACTS",
  positions: "CAT_POSITIONS",
  municipalities: "CAT_MUNICIPALITIES",
  institutions: "CAT_INSTITUTIONS",
  sites: "CAT_SITES",
  modalities: "CAT_MODALITIES",
  contractTypes: "CAT_CONTRACT_TYPES",
  studyLevels: "CAT_STUDY_LEVELS",
  accountTypes: "CAT_ACCOUNT_TYPES",
  banks: "CAT_BANKS",
  employmentStatuses: "CAT_EMPLOYMENT_STATUSES",
  salaryCategories: "CAT_SALARY_CATEGORIES",
  shirtSizes: "CAT_SHIRT_SIZES",
  pantsSizes: "CAT_PANTS_SIZES",
  shoeSizes: "CAT_SHOE_SIZES",
  workTimes: "CAT_WORK_TIMES",
  booleanText: "CAT_BOOLEAN_TEXT",
};

const FIELD_DEFS = [
  { key: "documentReference", header: "DOCUMENTO_REFERENCIA", group: "Identificacion", kind: "text", readOnly: true, impacts: [] },
  { key: "documentType", header: "TIPO_DOCUMENTO", group: "Identificacion", kind: "catalog", catalog: "documentTypes", impacts: ["Personal"] },
  { key: "documentNumber", header: "NUMERO_DOCUMENTO", group: "Identificacion", kind: "text", impacts: ["Personal"] },
  { key: "expeditionDate", header: "FECHA_EXPEDICION", group: "Identificacion", kind: "date", impacts: ["Personal"] },
  { key: "expeditionDepartment", header: "DEPARTAMENTO_EXPEDICION", group: "Identificacion", kind: "text", impacts: ["Personal"] },
  { key: "expeditionMunicipality", header: "MUNICIPIO_EXPEDICION", group: "Identificacion", kind: "text", impacts: ["Personal"] },
  { key: "firstName", header: "PRIMER_NOMBRE", group: "Identificacion", kind: "text", impacts: ["Personal"] },
  { key: "secondName", header: "SEGUNDO_NOMBRE", group: "Identificacion", kind: "text", impacts: ["Personal"] },
  { key: "firstLastName", header: "PRIMER_APELLIDO", group: "Identificacion", kind: "text", impacts: ["Personal"] },
  { key: "secondLastName", header: "SEGUNDO_APELLIDO", group: "Identificacion", kind: "text", impacts: ["Personal"] },
  { key: "birthDate", header: "FECHA_NACIMIENTO", group: "Identificacion", kind: "date", impacts: ["Personal"] },
  { key: "birthCountry", header: "PAIS_NACIMIENTO", group: "Identificacion", kind: "text", impacts: ["Personal"] },
  { key: "birthDepartment", header: "DEPARTAMENTO_NACIMIENTO", group: "Identificacion", kind: "text", impacts: ["Personal"] },
  { key: "birthMunicipality", header: "MUNICIPIO_NACIMIENTO", group: "Identificacion", kind: "text", impacts: ["Personal"] },
  { key: "biologicalSex", header: "SEXO", group: "Identificacion", kind: "catalog", catalog: "sexes", impacts: ["Personal"] },
  { key: "bloodType", header: "GRUPO_SANGUINEO", group: "Identificacion", kind: "catalog", catalog: "bloodTypes", impacts: ["Personal"] },

  { key: "phone", header: "TELEFONO", group: "Datos generales", kind: "text", impacts: ["Personal"] },
  { key: "email", header: "CORREO", group: "Datos generales", kind: "text", impacts: ["Personal"] },
  { key: "address", header: "DIRECCION", group: "Datos generales", kind: "text", impacts: ["Personal"] },
  { key: "neighborhood", header: "BARRIO", group: "Datos generales", kind: "text", impacts: ["Personal"] },
  { key: "residenceMunicipality", header: "MUNICIPIO_RESIDENCIA", group: "Datos generales", kind: "text", impacts: ["Personal"] },
  { key: "residenceZone", header: "ZONA_RESIDENCIA", group: "Datos generales", kind: "text", impacts: ["Personal"] },
  { key: "civilStatus", header: "ESTADO_CIVIL", group: "Datos generales", kind: "text", impacts: ["Personal"] },
  { key: "eps", header: "EPS", group: "Datos generales", kind: "catalog", catalog: "eps", impacts: ["Personal"] },
  { key: "pensionFund", header: "PENSION", group: "Datos generales", kind: "catalog", catalog: "pensions", impacts: ["Personal"] },
  { key: "compensationBox", header: "CAJA_COMPENSACION", group: "Datos generales", kind: "catalog", catalog: "compensationBoxes", impacts: ["Personal"] },
  { key: "arl", header: "ARL", group: "Datos generales", kind: "catalog", catalog: "arls", impacts: ["Personal"] },
  { key: "shirtSize", header: "TALLA_CAMISA", group: "Datos generales", kind: "catalog", catalog: "shirtSizes", impacts: ["Personal"] },
  { key: "pantsSize", header: "TALLA_PANTALON", group: "Datos generales", kind: "catalog", catalog: "pantsSizes", impacts: ["Personal"] },
  { key: "shoeSize", header: "TALLA_CALZADO", group: "Datos generales", kind: "catalog", catalog: "shoeSizes", impacts: ["Personal"] },
  { key: "sisben", header: "TIENE_SISBEN", group: "Datos generales", kind: "catalog", catalog: "booleanText", impacts: ["Personal"] },
  { key: "sisbenCategory", header: "SISBEN_CATEGORIA", group: "Datos generales", kind: "text", impacts: ["Personal"] },
  { key: "sisbenIssueDate", header: "SISBEN_FECHA_EXPEDICION", group: "Datos generales", kind: "date", impacts: ["Personal"] },
  { key: "sisbenExpirationDate", header: "SISBEN_FECHA_VENCIMIENTO", group: "Datos generales", kind: "date", impacts: ["Personal"] },
  { key: "hasResidenceCertificate", header: "TIENE_CERTIFICADO_RESIDENCIA", group: "Datos generales", kind: "catalog", catalog: "booleanText", impacts: ["Personal"] },
  { key: "residenceCertificateIssueDate", header: "CERTIFICADO_RESIDENCIA_FECHA_EXPEDICION", group: "Datos generales", kind: "date", impacts: ["Personal"] },
  { key: "residenceCertificateExpiration", header: "CERTIFICADO_RESIDENCIA_FECHA_VENCIMIENTO", group: "Datos generales", kind: "date", impacts: ["Personal"] },
  { key: "foodHandlingCourseIssueDate", header: "CURSO_MANIPULACION_FECHA_EXPEDICION", group: "Datos generales", kind: "date", impacts: ["Personal"] },
  { key: "foodHandlingCourseExpirationDate", header: "CURSO_MANIPULACION_FECHA_VENCIMIENTO", group: "Datos generales", kind: "date", impacts: ["Personal"] },
  { key: "foodHandlingExamIssueDate", header: "EXAMEN_MANIPULACION_FECHA_EXPEDICION", group: "Datos generales", kind: "date", impacts: ["Personal"] },
  { key: "foodHandlingExamExpirationDate", header: "EXAMEN_MANIPULACION_FECHA_VENCIMIENTO", group: "Datos generales", kind: "date", impacts: ["Personal"] },
  { key: "studiesJson", header: "ESTUDIOS_JSON", group: "Datos generales", kind: "json", impacts: ["Personal"] },
  { key: "studyLevel", header: "NIVEL_EDUCATIVO", group: "Datos generales", kind: "catalog", catalog: "studyLevels", impacts: ["Personal"] },
  { key: "studyDegree", header: "TITULO", group: "Datos generales", kind: "text", impacts: ["Personal"] },
  { key: "workExperienceJson", header: "EXPERIENCIA_JSON", group: "Datos generales", kind: "json", impacts: ["Personal"] },

  { key: "companyName", header: "EMPRESA", group: "Vinculacion laboral", kind: "catalog", catalog: "companies", impacts: ["Personal"] },
  { key: "contractName", header: "CONTRATO", group: "Vinculacion laboral", kind: "catalog", catalog: "contracts", impacts: ["Personal"] },
  { key: "cargoReal", header: "CARGO", group: "Vinculacion laboral", kind: "catalog", catalog: "positions", impacts: ["Personal", "Cobertura", "Nomina"] },
  { key: "salaryCategory", header: "CATEGORIA_SALARIAL", group: "Vinculacion laboral", kind: "catalog", catalog: "salaryCategories", impacts: ["Nomina"] },
  { key: "salaryBase", header: "SALARIO_BASE", group: "Vinculacion laboral", kind: "number", impacts: ["Nomina"] },
  { key: "transportAllowance", header: "AUXILIO_TRANSPORTE", group: "Vinculacion laboral", kind: "number", impacts: ["Nomina"] },
  { key: "otherRecargos", header: "OTROS_RECARGOS", group: "Vinculacion laboral", kind: "number", impacts: ["Nomina"] },
  { key: "startDate", header: "FECHA_INICIO", group: "Vinculacion laboral", kind: "date", impacts: ["Personal", "Cobertura", "Nomina"] },
  { key: "coverageStartDate", header: "FECHA_INICIO_COBERTURA", group: "Vinculacion laboral", kind: "date", impacts: ["Cobertura"] },
  { key: "arlVinculationDate", header: "FECHA_VINCULACION_ARL", group: "Vinculacion laboral", kind: "date", impacts: ["Personal"] },
  { key: "terminationDate", header: "FECHA_RETIRO", group: "Vinculacion laboral", kind: "date", impacts: ["Personal", "Cobertura", "Nomina"] },
  { key: "employmentStatus", header: "ESTADO_LABORAL", group: "Vinculacion laboral", kind: "catalog", catalog: "employmentStatuses", impacts: ["Personal"] },
  { key: "presentedInOffer", header: "PRESENTADO_EN_LICITACION", group: "Vinculacion laboral", kind: "catalog", catalog: "booleanText", impacts: ["Personal"] },
  { key: "offerPosition", header: "CARGO_PRESENTADO", group: "Vinculacion laboral", kind: "text", impacts: ["Personal"] },
  { key: "municipalityName", header: "MUNICIPIO_VINCULACION", group: "Vinculacion laboral", kind: "catalog", catalog: "municipalities", impacts: ["Personal", "Cobertura", "Nomina"] },
  { key: "institution", header: "INSTITUCION_EDUCATIVA", group: "Vinculacion laboral", kind: "catalog", catalog: "institutions", impacts: ["Personal", "Cobertura", "Nomina"] },
  { key: "site", header: "SEDE_EDUCATIVA", group: "Vinculacion laboral", kind: "catalog", catalog: "sites", impacts: ["Personal", "Cobertura", "Nomina"] },
  { key: "educationalModality", header: "MODALIDAD", group: "Vinculacion laboral", kind: "catalog", catalog: "modalities", impacts: ["Personal", "Cobertura", "Nomina"] },
  { key: "contractType", header: "TIPO_CONTRATO", group: "Vinculacion laboral", kind: "catalog", catalog: "contractTypes", impacts: ["Personal"] },
  { key: "workTimeType", header: "TIPO_JORNADA", group: "Vinculacion laboral", kind: "catalog", catalog: "workTimes", impacts: ["Personal", "Nomina"] },
  { key: "gestorZona", header: "GESTOR_ZONA", group: "Vinculacion laboral", kind: "text", impacts: ["Personal"] },
  { key: "auxiliarGestorZona", header: "AUXILIAR_GESTOR_ZONA", group: "Vinculacion laboral", kind: "text", impacts: ["Personal"] },
  { key: "municipiosACargo", header: "MUNICIPIOS_A_CARGO", group: "Vinculacion laboral", kind: "text", impacts: ["Personal"] },
  { key: "accountType", header: "TIPO_CUENTA", group: "Vinculacion laboral", kind: "catalog", catalog: "accountTypes", impacts: ["Personal"] },
  { key: "bankName", header: "BANCO", group: "Vinculacion laboral", kind: "catalog", catalog: "banks", impacts: ["Personal"] },
  { key: "accountNumber", header: "NUMERO_CUENTA", group: "Vinculacion laboral", kind: "text", impacts: ["Personal"] },

  { key: "observationsJson", header: "OBSERVACIONES_JSON", group: "Historial y observaciones", kind: "json", impacts: ["Personal"] },
  { key: "internalNotes", header: "NOTAS_INTERNAS", group: "Historial y observaciones", kind: "text", impacts: ["Personal"] },
];

const FIELD_BY_KEY = new Map(FIELD_DEFS.map((field) => [field.key, field]));
const FIELD_BY_HEADER = new Map(FIELD_DEFS.map((field) => [normalizeHeader(field.header), field]));

let _auditLogColumns = null;

function text(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^A-Z0-9]/g, "");
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const raw = String(value).replace(/\./g, "").replace(/,/g, ".");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseBooleanText(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (["TRUE", "SI", "SÍ", "1", "YES"].includes(raw)) return "true";
  if (["FALSE", "NO", "0"].includes(raw)) return "false";
  return "";
}

function formatBooleanText(value) {
  if (value === true || value === "true") return "true";
  if (value === false || value === "false") return "false";
  return "";
}

function toIsoDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return "";
  const dd = String(m[1]).padStart(2, "0");
  const mm = String(m[2]).padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

function splitIsoDate(value) {
  const iso = toIsoDate(value);
  if (!iso) return { day: "", month: "", year: "" };
  const [year, month, day] = iso.split("-");
  return { day, month, year };
}

function safeJsonString(value) {
  if (!value) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function parseJsonArray(value) {
  const raw = text(value);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function firstStudyField(studies = [], field) {
  return Array.isArray(studies) && studies[0] ? text(studies[0][field]) : "";
}

function buildCatalogRow(records, labelKey = "name") {
  return records.map((item) => item[labelKey]).filter(Boolean);
}

function uniqueSortedObjectsByName(records = []) {
  const seen = new Set();
  return (records || [])
    .filter((item) => {
      const name = text(item?.name);
      if (!name) return false;
      const key = normalizeText(name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => text(a?.name).localeCompare(text(b?.name), "es"));
}

function findCatalogOptionValue(options = [], value) {
  const raw = text(value);
  if (!raw) return "";
  const norm = normalizeText(raw);
  return (options || []).find((item) => normalizeText(item) === norm) || "";
}

function formatValidValues(validValues = [], maxItems = 40) {
  const values = uniqueSorted(validValues);
  if (!values.length) return "Sin valores configurados";
  if (values.length <= maxItems) return values.join(", ");
  return `${values.slice(0, maxItems).join(", ")} ... (+${values.length - maxItems} mas)`;
}

function addValidationError(rowErrors, validationErrors, {
  rowNumber = "",
  field = "",
  label = "",
  valueReceived = "",
  validValues = [],
  message = "",
} = {}) {
  const received = text(valueReceived);
  const values = uniqueSorted(validValues);
  const fieldLabel = text(label) || text(field) || "Campo";
  const detailMessage = message || `${fieldLabel}: valor no valido${received ? ` (${received})` : ""}.`;
  rowErrors.push(detailMessage);
  validationErrors.push({
    rowNumber,
    field,
    label: fieldLabel,
    valueReceived: received,
    validValues: values,
    validValuesText: formatValidValues(values),
    message: detailMessage,
  });
}

function buildCatalogOptions(catalogName, catalogs) {
  if (catalogName === "documentTypes") return catalogs.documentTypes || [];
  if (catalogName === "sexes") return catalogs.sexes || [];
  if (catalogName === "bloodTypes") return catalogs.bloodTypes || [];
  if (catalogName === "eps") return catalogs.eps || [];
  if (catalogName === "pensions") return catalogs.pensions || [];
  if (catalogName === "compensationBoxes") return catalogs.compensationBoxes || [];
  if (catalogName === "arls") return catalogs.arls || [];
  if (catalogName === "companies") return buildCatalogRow(catalogs.companies);
  if (catalogName === "contracts") return buildCatalogRow(catalogs.contracts);
  if (catalogName === "positions") return catalogs.positions || [];
  if (catalogName === "municipalities") return buildCatalogRow(catalogs.municipalities);
  if (catalogName === "institutions") return buildCatalogRow(catalogs.institutions);
  if (catalogName === "sites") return buildCatalogRow(catalogs.sites);
  if (catalogName === "modalities") return catalogs.modalities || [];
  if (catalogName === "contractTypes") return catalogs.contractTypes || [];
  if (catalogName === "studyLevels") return catalogs.studyLevels || [];
  if (catalogName === "accountTypes") return catalogs.accountTypes || [];
  if (catalogName === "banks") return catalogs.banks || [];
  if (catalogName === "employmentStatuses") return catalogs.employmentStatuses || [];
  if (catalogName === "salaryCategories") return catalogs.salaryCategories || [];
  if (catalogName === "shirtSizes") return catalogs.shirtSizes || [];
  if (catalogName === "pantsSizes") return catalogs.pantsSizes || [];
  if (catalogName === "shoeSizes") return catalogs.shoeSizes || [];
  if (catalogName === "workTimes") return catalogs.workTimes || [];
  if (catalogName === "booleanText") return catalogs.booleanText || [];
  return [];
}

async function getAuditLogColumns() {
  if (_auditLogColumns) return _auditLogColumns;
  const result = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'audit_logs'`
  );
  _auditLogColumns = new Set(result.rows.map((row) => text(row.column_name).toLowerCase()));
  return _auditLogColumns;
}

async function insertAuditLog(entry = {}) {
  const columns = await getAuditLogColumns().catch(() => new Set());
  const useModule = columns.has("module");
  const fields = [];
  const values = [];
  const push = (name, value) => {
    fields.push(name);
    values.push(value);
    return `$${values.length}`;
  };
  const placeholders = [];
  if (useModule) placeholders.push(push("module", entry.module || "personnel"));
  placeholders.push(push("entity_type", entry.entityType || "employee"));
  placeholders.push(push("entity_id", String(entry.entityId || "")));
  placeholders.push(push("action", entry.action || "bulk_update"));
  placeholders.push(push("user_id", entry.userId || null));
  placeholders.push(push("user_name", entry.userName || null));
  placeholders.push(push("reason", entry.reason || null));
  placeholders.push(`${push("payload", JSON.stringify(entry.payload || {}))}::jsonb`);
  await pool.query(
    `INSERT INTO audit_logs (${fields.join(", ")})
     VALUES (${placeholders.join(", ")})`,
    values
  );
}

async function getCatalogs() {
  const [companiesRes, contractsRes, positionsRes, municipalitiesRes, institutionsRes, sitesRes, banksRes, latestCoverageRes, employeeCatalogsRes, salaryCategoriesRes, studyLevelsRes] = await Promise.all([
    pool.query(`SELECT id, name FROM companies WHERE active = true ORDER BY name`),
    pool.query(`SELECT id, name, code, company_id AS "companyId" FROM contracts WHERE active = true ORDER BY name`),
    pool.query(`
      SELECT DISTINCT name
      FROM (
        SELECT TRIM(name) AS name FROM positions WHERE active = true
        UNION
        SELECT TRIM(real_position) AS name FROM employees WHERE NULLIF(TRIM(real_position), '') IS NOT NULL
      ) p
      WHERE NULLIF(TRIM(name), '') IS NOT NULL
      ORDER BY name
    `),
    pool.query(`SELECT id, name FROM municipalities ORDER BY name`),
    pool.query(`SELECT id, name, municipality_id AS "municipalityId" FROM institutions ORDER BY name`),
    pool.query(`SELECT id, name, institution_id AS "institutionId" FROM educational_sites ORDER BY name`),
    pool.query(`SELECT name, code FROM banks ORDER BY code, name`).catch(() => ({ rows: [] })),
    pool.query(`
      WITH latest_uploads AS (
        SELECT DISTINCT ON (company_id, contract_id)
          id, company_id, contract_id
        FROM coverage_uploads
        ORDER BY company_id, contract_id, created_at DESC, id DESC
      )
      SELECT
        lu.company_id AS "companyId",
        lu.contract_id AS "contractId",
        r.municipality_id AS "municipalityId",
        UPPER(TRIM(r.institution)) AS institution_name,
        UPPER(TRIM(r.site)) AS site_name,
        UPPER(TRIM(r.modality)) AS modality_name
      FROM latest_uploads lu
      JOIN coverage_upload_rows r ON r.upload_id = lu.id
      WHERE NULLIF(TRIM(r.institution), '') IS NOT NULL
        AND NULLIF(TRIM(r.site), '') IS NOT NULL
        AND NULLIF(TRIM(r.modality), '') IS NOT NULL
    `).catch(() => ({ rows: [] })),
    pool.query(`
      SELECT
        ARRAY(
          SELECT DISTINCT UPPER(BTRIM(document_type))
          FROM employees
          WHERE NULLIF(BTRIM(document_type), '') IS NOT NULL
          ORDER BY 1
        ) AS "documentTypes",
        ARRAY(
          SELECT DISTINCT UPPER(BTRIM(COALESCE(biological_sex, sex)))
          FROM employees
          WHERE NULLIF(BTRIM(COALESCE(biological_sex, sex)), '') IS NOT NULL
          ORDER BY 1
        ) AS "sexes",
        ARRAY(
          SELECT DISTINCT UPPER(BTRIM(blood_type))
          FROM employees
          WHERE NULLIF(BTRIM(blood_type), '') IS NOT NULL
          ORDER BY 1
        ) AS "bloodTypes",
        ARRAY(
          SELECT DISTINCT BTRIM(eps)
          FROM employees
          WHERE NULLIF(BTRIM(eps), '') IS NOT NULL
          ORDER BY 1
        ) AS "eps",
        ARRAY(
          SELECT DISTINCT BTRIM(pension_fund)
          FROM employees
          WHERE NULLIF(BTRIM(pension_fund), '') IS NOT NULL
          ORDER BY 1
        ) AS "pensions",
        ARRAY(
          SELECT DISTINCT BTRIM(compensation_box)
          FROM employees
          WHERE NULLIF(BTRIM(compensation_box), '') IS NOT NULL
          ORDER BY 1
        ) AS "compensationBoxes",
        ARRAY(
          SELECT DISTINCT BTRIM(arl)
          FROM employees
          WHERE NULLIF(BTRIM(arl), '') IS NOT NULL
          ORDER BY 1
        ) AS "arls",
        ARRAY(
          SELECT DISTINCT BTRIM(contract_type)
          FROM employees
          WHERE NULLIF(BTRIM(contract_type), '') IS NOT NULL
          ORDER BY 1
        ) AS "contractTypes",
        ARRAY(
          SELECT DISTINCT UPPER(BTRIM(workday_type))
          FROM employees
          WHERE NULLIF(BTRIM(workday_type), '') IS NOT NULL
          ORDER BY 1
        ) AS "workTimes",
        ARRAY(
          SELECT DISTINCT UPPER(BTRIM(status))
          FROM employees
          WHERE NULLIF(BTRIM(status), '') IS NOT NULL
          ORDER BY 1
        ) AS "employmentStatuses",
        ARRAY(
          SELECT DISTINCT BTRIM(shirt_size)
          FROM employees
          WHERE NULLIF(BTRIM(shirt_size), '') IS NOT NULL
          ORDER BY 1
        ) AS "shirtSizes",
        ARRAY(
          SELECT DISTINCT BTRIM(pants_size)
          FROM employees
          WHERE NULLIF(BTRIM(pants_size), '') IS NOT NULL
          ORDER BY 1
        ) AS "pantsSizes",
        ARRAY(
          SELECT DISTINCT BTRIM(shoe_size)
          FROM employees
          WHERE NULLIF(BTRIM(shoe_size), '') IS NOT NULL
          ORDER BY 1
        ) AS "shoeSizes",
        ARRAY(
          SELECT DISTINCT BTRIM(account_type)
          FROM employees
          WHERE NULLIF(BTRIM(account_type), '') IS NOT NULL
          ORDER BY 1
        ) AS "accountTypes"
    `).catch(() => ({ rows: [{}] })),
    pool.query(`
      SELECT DISTINCT category_code AS name
      FROM payroll_salary_categories
      WHERE active = true
        AND NULLIF(BTRIM(category_code), '') IS NOT NULL
      UNION
      SELECT DISTINCT salary_category AS name
      FROM payroll_items
      WHERE NULLIF(BTRIM(salary_category), '') IS NOT NULL
      ORDER BY name
    `).catch(() => ({ rows: [] })),
    pool.query(`
      SELECT DISTINCT BTRIM(item->>'educationLevel') AS name
      FROM employees e
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.studies, '[]'::jsonb)) item
      WHERE NULLIF(BTRIM(item->>'educationLevel'), '') IS NOT NULL
      ORDER BY name
    `).catch(() => ({ rows: [] })),
  ]);

  const contracts = contractsRes.rows.map((row) => ({
    id: Number(row.id),
    name: text(row.name),
    code: text(row.code),
    companyId: Number(row.companyId) || null,
  }));
  const companies = companiesRes.rows.map((row) => ({ id: Number(row.id), name: text(row.name) }));
  const municipalities = municipalitiesRes.rows.map((row) => ({ id: Number(row.id), name: text(row.name) }));
  const institutions = institutionsRes.rows.map((row) => ({
    id: Number(row.id),
    name: text(row.name),
    municipalityId: Number(row.municipalityId) || null,
  }));
  const sites = sitesRes.rows.map((row) => ({
    id: Number(row.id),
    name: text(row.name),
    institutionId: Number(row.institutionId) || null,
  }));
  const positions = positionsRes.rows.map((row) => text(row.name)).filter(Boolean);
  const banks = banksRes.rows.map((row) => text(row.name)).filter(Boolean);
  const employeeCatalogs = employeeCatalogsRes.rows[0] || {};
  const studyLevels = studyLevelsRes.rows.map((row) => text(row.name)).filter(Boolean);
  const salaryCategories = salaryCategoriesRes.rows.map((row) => text(row.name)).filter(Boolean);

  const maps = {
    companyByNorm: new Map(),
    contractByNorm: new Map(),
    municipalityByNorm: new Map(),
    institutionByNorm: new Map(),
    siteByNorm: new Map(),
    positionSet: new Set(positions.map(normalizeText)),
    modalityIndex: new Map(),
    institutionsByMunicipality: new Map(),
    sitesByInstitution: new Map(),
  };

  for (const row of companies) {
    maps.companyByNorm.set(normalizeText(row.name), row);
    maps.companyByNorm.set(normalizeText(row.id), row);
  }
  for (const row of contracts) {
    maps.contractByNorm.set(normalizeText(row.name), row);
    if (row.code) maps.contractByNorm.set(normalizeText(row.code), row);
    maps.contractByNorm.set(normalizeText(row.id), row);
  }
  for (const row of municipalities) {
    maps.municipalityByNorm.set(normalizeText(row.name), row);
    maps.municipalityByNorm.set(normalizeText(row.id), row);
  }
  for (const row of institutions) {
    maps.institutionByNorm.set(normalizeText(`${row.name}|${row.municipalityId || ""}`), row);
    maps.institutionByNorm.set(normalizeText(row.name), row);
    if (!maps.institutionsByMunicipality.has(String(row.municipalityId || ""))) {
      maps.institutionsByMunicipality.set(String(row.municipalityId || ""), new Set());
    }
    maps.institutionsByMunicipality.get(String(row.municipalityId || "")).add(row.name);
  }
  for (const row of sites) {
    maps.siteByNorm.set(normalizeText(`${row.name}|${row.institutionId || ""}`), row);
    maps.siteByNorm.set(normalizeText(row.name), row);
    if (!maps.sitesByInstitution.has(String(row.institutionId || ""))) {
      maps.sitesByInstitution.set(String(row.institutionId || ""), new Set());
    }
    maps.sitesByInstitution.get(String(row.institutionId || "")).add(row.name);
  }
  for (const row of latestCoverageRes.rows) {
    const key = [
      Number(row.companyId) || "",
      Number(row.contractId) || "",
      Number(row.municipalityId) || "",
      text(row.institution_name),
      text(row.site_name),
    ].map((item) => normalizeText(item)).join("|");
    if (!maps.modalityIndex.has(key)) maps.modalityIndex.set(key, new Set());
    maps.modalityIndex.get(key).add(text(row.modality_name));
  }

  const modalities = uniqueSorted([...maps.modalityIndex.values()].flatMap((set) => [...set]));

  return {
    companies,
    contracts,
    positions,
    municipalities,
    institutions: uniqueSortedObjectsByName(institutions),
    sites: uniqueSortedObjectsByName(sites),
    modalities,
    banks,
    documentTypes: uniqueSorted(employeeCatalogs.documentTypes || []),
    sexes: uniqueSorted(employeeCatalogs.sexes || []),
    bloodTypes: uniqueSorted(employeeCatalogs.bloodTypes || []),
    eps: uniqueSorted(employeeCatalogs.eps || []),
    pensions: uniqueSorted(employeeCatalogs.pensions || []),
    compensationBoxes: uniqueSorted(employeeCatalogs.compensationBoxes || []),
    arls: uniqueSorted(employeeCatalogs.arls || []),
    contractTypes: uniqueSorted(employeeCatalogs.contractTypes || []),
    workTimes: uniqueSorted(employeeCatalogs.workTimes || []),
    booleanText: BOOLEAN_TEXT_LIST,
    studyLevels: uniqueSorted(studyLevels),
    accountTypes: uniqueSorted(employeeCatalogs.accountTypes || []),
    employmentStatuses: uniqueSorted(employeeCatalogs.employmentStatuses || []),
    salaryCategories: uniqueSorted(salaryCategories),
    shirtSizes: uniqueSorted(employeeCatalogs.shirtSizes || []),
    pantsSizes: uniqueSorted(employeeCatalogs.pantsSizes || []),
    shoeSizes: uniqueSorted(employeeCatalogs.shoeSizes || []),
    maps,
  };
}

function buildScopeFilters(resource = {}) {
  const filters = { exportAll: true, full: true };
  if (resource?.companyId) filters.companyId = resource.companyId;
  if (resource?.contractId) filters.contractId = resource.contractId;
  if (Array.isArray(resource?.municipalityIds) && resource.municipalityIds.length) {
    filters.municipalityIds = resource.municipalityIds;
  }
  return filters;
}

async function getEmployeeCurrentPayrollSnapshots(employeeIds = []) {
  if (!employeeIds.length) return { salaryConfigByEmployee: new Map(), latestPayrollByEmployee: new Map() };
  const [cfgRes, payrollRes] = await Promise.all([
    pool.query(
      `SELECT DISTINCT ON (employee_id)
         employee_id AS "employeeId",
         base_salary AS "baseSalary",
         transport_allowance AS "transportAllowance",
         effective_date AS "effectiveDate"
       FROM employee_payroll_config
       WHERE employee_id = ANY($1::integer[])
       ORDER BY employee_id, effective_date DESC, id DESC`,
      [employeeIds]
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT DISTINCT ON (employee_id)
         employee_id AS "employeeId",
         salary_category AS "salaryCategory",
         base_salary AS "baseSalary",
         transport_allowance AS "transportAllowance",
         other_earnings AS "otherRecargos",
         period_id AS "periodId"
       FROM payroll_items
       WHERE employee_id = ANY($1::integer[])
       ORDER BY employee_id, period_id DESC, id DESC`,
      [employeeIds]
    ).catch(() => ({ rows: [] })),
  ]);

  return {
    salaryConfigByEmployee: new Map(cfgRes.rows.map((row) => [String(row.employeeId), row])),
    latestPayrollByEmployee: new Map(payrollRes.rows.map((row) => [String(row.employeeId), row])),
  };
}

function buildEmployeeFlatRow(employee, catalogs, payrollSnapshots) {
  const salaryConfig = payrollSnapshots.salaryConfigByEmployee.get(String(employee.id)) || null;
  const latestPayroll = payrollSnapshots.latestPayrollByEmployee.get(String(employee.id)) || null;
  const studies = Array.isArray(employee.studies) ? employee.studies : [];
  const experience = Array.isArray(employee.workExperience) ? employee.workExperience : [];
  const salaryBase = salaryConfig?.baseSalary ?? latestPayroll?.baseSalary ?? "";
  const transportAllowance = salaryConfig?.transportAllowance ?? latestPayroll?.transportAllowance ?? "";
  const otherRecargos = latestPayroll?.otherRecargos ?? "";
  const companyName = catalogs.companies.find((row) => Number(row.id) === Number(employee.companyId || employee.company_id))?.name || "";
  const contractName = catalogs.contracts.find((row) => Number(row.id) === Number(employee.contractId || employee.contract_id))?.name || "";

  return {
    documentReference: text(employee.documentNumber || employee.numero_documento),
    documentType: text(employee.documentType || employee.tipo_documento),
    documentNumber: text(employee.documentNumber || employee.numero_documento),
    expeditionDate: toIsoDate(`${employee.expeditionYear || ""}-${employee.expeditionMonth || ""}-${employee.expeditionDay || ""}`),
    expeditionDepartment: text(employee.expeditionDepartment),
    expeditionMunicipality: text(employee.expeditionMunicipality),
    firstName: text(employee.firstName || employee.primer_nombre),
    secondName: text(employee.secondName || employee.segundo_nombre),
    firstLastName: text(employee.firstLastName || employee.primer_apellido),
    secondLastName: text(employee.secondLastName || employee.segundo_apellido),
    birthDate: toIsoDate(`${employee.birthYear || ""}-${employee.birthMonth || ""}-${employee.birthDay || ""}`),
    birthCountry: text(employee.birthCountry || "Colombia"),
    birthDepartment: text(employee.birthDepartment),
    birthMunicipality: text(employee.birthMunicipality),
    biologicalSex: text(employee.biologicalSex || employee.sex),
    bloodType: text(employee.bloodType),
    phone: text(employee.phone),
    email: text(employee.email),
    address: text(employee.address),
    neighborhood: text(employee.neighborhood),
    residenceMunicipality: text(employee.residenceMunicipality || employee.municipio_residencia),
    residenceZone: text(employee.residenceZone || employee.zona_residencia),
    civilStatus: text(employee.civilStatus || employee.estado_civil),
    eps: text(employee.eps),
    pensionFund: text(employee.pensionFund || employee.fondo_pensiones),
    compensationBox: text(employee.compensationBox || employee.caja_compensacion || "COFREM"),
    arl: text(employee.arl || "SURA"),
    shirtSize: text(employee.shirtSize || employee.shirt_size),
    pantsSize: text(employee.pantsSize || employee.pants_size),
    shoeSize: text(employee.shoeSize || employee.shoe_size),
    sisben: formatBooleanText(employee.sisben),
    sisbenCategory: text(employee.sisbenCategory || employee.sisben_categoria),
    sisbenIssueDate: toIsoDate(employee.sisbenIssueDate || employee.sisben_exp_date),
    sisbenExpirationDate: toIsoDate(employee.sisbenExpirationDate || employee.sisbenExpiry || employee.sisben_expiry),
    hasResidenceCertificate: formatBooleanText(employee.hasResidenceCertificate || employee.residenceCertificate),
    residenceCertificateIssueDate: toIsoDate(employee.residenceCertificateIssueDate || employee.residence_certificate_issue_date),
    residenceCertificateExpiration: toIsoDate(employee.residenceCertificateExpiration || employee.residenceCertificateExpiry || employee.residence_certificate_expiry),
    foodHandlingCourseIssueDate: toIsoDate(employee.foodHandlingCourseIssueDate),
    foodHandlingCourseExpirationDate: toIsoDate(employee.foodHandlingCourseExpirationDate),
    foodHandlingExamIssueDate: toIsoDate(employee.foodHandlingExamIssueDate),
    foodHandlingExamExpirationDate: toIsoDate(employee.foodHandlingExamExpirationDate),
    studiesJson: safeJsonString(studies),
    studyLevel: firstStudyField(studies, "educationLevel"),
    studyDegree: firstStudyField(studies, "degree"),
    workExperienceJson: safeJsonString(experience),
    companyName,
    contractName,
    cargoReal: text(employee.cargo_real || employee.position || employee.cargo),
    salaryCategory: text(latestPayroll?.salaryCategory),
    salaryBase: salaryBase === "" ? "" : Number(salaryBase),
    transportAllowance: transportAllowance === "" ? "" : Number(transportAllowance),
    otherRecargos: otherRecargos === "" ? "" : Number(otherRecargos),
    startDate: toIsoDate(employee.startDate || employee.start_date),
    coverageStartDate: toIsoDate(employee.coverageStartDate || employee.coverage_start_date),
    arlVinculationDate: toIsoDate(employee.arlVinculationDate || employee.arl_vinculation_date),
    terminationDate: toIsoDate(employee.terminationDate || employee.fecha_retiro || employee.laborEndDate),
    employmentStatus: text(employee.employmentStatus || employee.estado_laboral || employee.status),
    presentedInOffer: formatBooleanText(employee.presentedInOffer || employee.presented_in_offer),
    offerPosition: text(employee.offerPosition || employee.offered_position),
    municipalityName: text(employee.municipalityName || employee.municipality_name || employee.municipality),
    institution: text(employee.institution || employee.institutionName),
    site: text(employee.site || employee.siteName),
    educationalModality: text(employee.educationalModality || employee.modality || employee.modalidad),
    contractType: text(employee.contractType || employee.contract_type),
    workTimeType: text(employee.workTimeType || employee.workdayType || employee.workday_type),
    gestorZona: text(employee.gestorZona || employee.gestor_zona),
    auxiliarGestorZona: text(employee.auxiliarGestorZona),
    municipiosACargo: text(employee.municipiosACargo),
    accountType: text(employee.accountType),
    bankName: text(employee.bankName),
    accountNumber: text(employee.accountNumber),
    observationsJson: "",
    internalNotes: text(employee.internalNotes || ""),
  };
}

function enrichCatalogsFromEmployees(catalogs, employees = [], payrollSnapshots) {
  const rows = (employees || []).map((employee) => buildEmployeeFlatRow(employee, catalogs, payrollSnapshots));
  const mergeValues = (catalogKey, fieldKey) => uniqueSorted([
    ...(catalogs[catalogKey] || []),
    ...rows.map((row) => text(row[fieldKey])).filter(Boolean),
  ]);

  return {
    ...catalogs,
    documentTypes: mergeValues("documentTypes", "documentType"),
    sexes: mergeValues("sexes", "biologicalSex"),
    bloodTypes: mergeValues("bloodTypes", "bloodType"),
    eps: mergeValues("eps", "eps"),
    pensions: mergeValues("pensions", "pensionFund"),
    compensationBoxes: mergeValues("compensationBoxes", "compensationBox"),
    arls: mergeValues("arls", "arl"),
    contractTypes: mergeValues("contractTypes", "contractType"),
    workTimes: mergeValues("workTimes", "workTimeType"),
    studyLevels: mergeValues("studyLevels", "studyLevel"),
    accountTypes: mergeValues("accountTypes", "accountType"),
    employmentStatuses: mergeValues("employmentStatuses", "employmentStatus"),
    salaryCategories: mergeValues("salaryCategories", "salaryCategory"),
    shirtSizes: mergeValues("shirtSizes", "shirtSize"),
    pantsSizes: mergeValues("pantsSizes", "pantsSize"),
    shoeSizes: mergeValues("shoeSizes", "shoeSize"),
  };
}

function parseWorksheetRows(fileBase64) {
  if (!fileBase64 || !String(fileBase64).startsWith("data:")) {
    throw new Error("Debes enviar un archivo Excel valido.");
  }
  const base64 = String(fileBase64).split("base64,")[1];
  if (!base64) throw new Error("Archivo Excel invalido.");
  const workbook = XLSX.read(Buffer.from(base64, "base64"), { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => normalizeText(name) === "EXPEDIENTE") || workbook.SheetNames.find((name) => normalizeText(name) !== "CATALOGOS");
  if (!sheetName) throw new Error("El archivo no contiene la hoja EXPEDIENTE.");
  const ws = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (!matrix.length) throw new Error("La hoja EXPEDIENTE no contiene datos.");
  const headers = (matrix[0] || []).map((item) => text(item));
  const rows = [];
  for (let index = 1; index < matrix.length; index += 1) {
    const values = matrix[index] || [];
    const row = {};
    headers.forEach((header, colIndex) => {
      row[header] = values[colIndex] ?? "";
    });
    if (Object.values(row).every((value) => text(value) === "")) continue;
    rows.push({ rowNumber: index + 1, raw: row });
  }
  return rows;
}

function getFieldValue(rawRow, key) {
  const field = FIELD_BY_KEY.get(key);
  if (!field) return "";
  const direct = rawRow[field.header];
  if (direct !== undefined) return direct;
  const normalizedMap = Object.fromEntries(Object.keys(rawRow || {}).map((header) => [normalizeHeader(header), rawRow[header]]));
  return normalizedMap[normalizeHeader(field.header)] ?? "";
}

function parseIncomingRow(rawRow = {}) {
  const values = {};
  for (const field of FIELD_DEFS) {
    const rawValue = getFieldValue(rawRow, field.key);
    if (field.kind === "date") values[field.key] = toIsoDate(rawValue);
    else if (field.kind === "number") values[field.key] = text(rawValue) === "" ? "" : rawValue;
    else if (field.kind === "json") values[field.key] = text(rawValue);
    else if (field.kind === "catalog" && field.catalog === "booleanText") values[field.key] = parseBooleanText(rawValue);
    else values[field.key] = text(rawValue);
  }
  return values;
}

function compareFieldValues(field, currentValue, incomingValue) {
  if (field.kind === "number") {
    const a = toNumber(currentValue);
    const b = toNumber(incomingValue);
    return (a ?? "") === (b ?? "");
  }
  return text(currentValue) === text(incomingValue);
}

function shouldApplyIncoming(field, incomingValue, allowClearEmpty) {
  if (field.readOnly) return false;
  const hasValue = text(incomingValue) !== "";
  return hasValue || allowClearEmpty;
}

function buildChangeType(fieldKey) {
  if (SENSITIVE_KEYS.has(fieldKey)) return "Cambio sensible";
  if (OPERATIONAL_KEYS.has(fieldKey)) return "Cambio operativo";
  if (LABOR_KEYS.has(fieldKey)) return "Cambio laboral";
  if (PAYROLL_ALERT_KEYS.has(fieldKey)) return "Cambio salarial";
  return "Actualizacion";
}

function changeImpacts(field) {
  const impacts = new Set(field.impacts || []);
  return {
    personal: impacts.has("Personal"),
    coverage: impacts.has("Cobertura"),
    payroll: impacts.has("Nomina"),
    sst: impacts.has("SST"),
  };
}

function resolveCatalogValue(catalogName, value, catalogs) {
  const raw = text(value);
  if (!raw) return { ok: true, value: "" };
  const norm = normalizeText(raw);
  if (catalogName === "documentTypes") {
    const match = findCatalogOptionValue(catalogs.documentTypes || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Valor no valido para tipo documento: ${raw}`, validValues: catalogs.documentTypes || [] };
  }
  if (catalogName === "sexes") {
    const match = findCatalogOptionValue(catalogs.sexes || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Valor no valido para sexo: ${raw}`, validValues: catalogs.sexes || [] };
  }
  if (catalogName === "bloodTypes") {
    const match = findCatalogOptionValue(catalogs.bloodTypes || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Valor no valido para grupo sanguineo: ${raw}`, validValues: catalogs.bloodTypes || [] };
  }
  if (catalogName === "eps") {
    const match = findCatalogOptionValue(catalogs.eps || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Valor no valido para EPS: ${raw}`, validValues: catalogs.eps || [] };
  }
  if (catalogName === "pensions") {
    const match = findCatalogOptionValue(catalogs.pensions || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Valor no valido para pension: ${raw}`, validValues: catalogs.pensions || [] };
  }
  if (catalogName === "compensationBoxes") {
    const match = findCatalogOptionValue(catalogs.compensationBoxes || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Valor no valido para caja de compensacion: ${raw}`, validValues: catalogs.compensationBoxes || [] };
  }
  if (catalogName === "arls") {
    const match = findCatalogOptionValue(catalogs.arls || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Valor no valido para ARL: ${raw}`, validValues: catalogs.arls || [] };
  }
  if (catalogName === "contractTypes") {
    const match = findCatalogOptionValue(catalogs.contractTypes || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Valor no valido para tipo de contrato: ${raw}`, validValues: catalogs.contractTypes || [] };
  }
  if (catalogName === "workTimes") {
    const match = findCatalogOptionValue(catalogs.workTimes || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Valor no valido para tipo de jornada: ${raw}`, validValues: catalogs.workTimes || [] };
  }
  if (catalogName === "booleanText") {
    const parsed = parseBooleanText(raw);
    return parsed ? { ok: true, value: parsed } : { ok: false, message: `Valor no valido (use true/false): ${raw}`, validValues: catalogs.booleanText || [] };
  }
  if (catalogName === "studyLevels") {
    const match = findCatalogOptionValue(catalogs.studyLevels || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Valor no valido para nivel educativo: ${raw}`, validValues: catalogs.studyLevels || [] };
  }
  if (catalogName === "accountTypes") {
    const match = findCatalogOptionValue(catalogs.accountTypes || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Valor no valido para tipo de cuenta: ${raw}`, validValues: catalogs.accountTypes || [] };
  }
  if (catalogName === "banks") {
    const match = findCatalogOptionValue(catalogs.banks || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Valor no valido para banco: ${raw}`, validValues: catalogs.banks || [] };
  }
  if (catalogName === "companies") {
    const match = catalogs.maps.companyByNorm.get(norm);
    return match ? { ok: true, value: match.name, entity: match } : { ok: false, message: `Empresa no encontrada: ${raw}`, validValues: buildCatalogRow(catalogs.companies) };
  }
  if (catalogName === "contracts") {
    const match = catalogs.maps.contractByNorm.get(norm);
    return match ? { ok: true, value: match.name, entity: match } : { ok: false, message: `Contrato no encontrado: ${raw}`, validValues: buildCatalogRow(catalogs.contracts) };
  }
  if (catalogName === "municipalities") {
    const match = catalogs.maps.municipalityByNorm.get(norm);
    return match ? { ok: true, value: match.name, entity: match } : { ok: false, message: `Municipio no encontrado: ${raw}`, validValues: buildCatalogRow(catalogs.municipalities) };
  }
  if (catalogName === "institutions") {
    const match = findCatalogOptionValue(buildCatalogRow(catalogs.institutions), raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Institucion no encontrada: ${raw}`, validValues: buildCatalogRow(catalogs.institutions) };
  }
  if (catalogName === "sites") {
    const match = findCatalogOptionValue(buildCatalogRow(catalogs.sites), raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Sede no encontrada: ${raw}`, validValues: buildCatalogRow(catalogs.sites) };
  }
  if (catalogName === "modalities") {
    const match = findCatalogOptionValue(catalogs.modalities || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Modalidad no encontrada: ${raw}`, validValues: catalogs.modalities || [] };
  }
  if (catalogName === "positions") {
    const match = findCatalogOptionValue(catalogs.positions || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Cargo no valido: ${raw}`, validValues: catalogs.positions || [] };
  }
  if (catalogName === "employmentStatuses") {
    const match = findCatalogOptionValue(catalogs.employmentStatuses || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Estado laboral no valido: ${raw}`, validValues: catalogs.employmentStatuses || [] };
  }
  if (catalogName === "salaryCategories") {
    const match = findCatalogOptionValue(catalogs.salaryCategories || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Categoria salarial no valida: ${raw}`, validValues: catalogs.salaryCategories || [] };
  }
  if (catalogName === "shirtSizes") {
    const match = findCatalogOptionValue(catalogs.shirtSizes || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Talla de camisa no valida: ${raw}`, validValues: catalogs.shirtSizes || [] };
  }
  if (catalogName === "pantsSizes") {
    const match = findCatalogOptionValue(catalogs.pantsSizes || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Talla de pantalon no valida: ${raw}`, validValues: catalogs.pantsSizes || [] };
  }
  if (catalogName === "shoeSizes") {
    const match = findCatalogOptionValue(catalogs.shoeSizes || [], raw);
    return match ? { ok: true, value: match } : { ok: false, message: `Talla de calzado no valida: ${raw}`, validValues: catalogs.shoeSizes || [] };
  }
  return { ok: true, value: raw };
}

function parseRowComplexFields(values, errors) {
  if (values.studiesJson) {
    try {
      const parsed = parseJsonArray(values.studiesJson);
      values.studies = parsed;
    } catch {
      errors.push("Estudios JSON invalido.");
    }
  } else if (values.studyLevel || values.studyDegree) {
    values.studies = [{
      educationLevel: text(values.studyLevel),
      degree: text(values.studyDegree),
      institution: "",
      year: "",
    }];
  } else {
    values.studies = null;
  }

  if (values.workExperienceJson) {
    try {
      values.workExperience = parseJsonArray(values.workExperienceJson);
    } catch {
      errors.push("Experiencia JSON invalido.");
    }
  } else {
    values.workExperience = null;
  }

  if (values.observationsJson) {
    try {
      values.observations = parseJsonArray(values.observationsJson);
    } catch {
      errors.push("Observaciones JSON invalido.");
    }
  } else {
    values.observations = null;
  }
}

function uniqueSorted(values = []) {
  return [...new Set((values || []).map((item) => text(item)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function findZipEntry(zip, entryPath) {
  return XLSX_CFB.find(zip, `/${entryPath}`)
    || XLSX_CFB.find(zip, `Root Entry/${entryPath}`)
    || XLSX_CFB.find(zip, entryPath)
    || null;
}

function buildValidationCatalogConfigs(catalogs) {
  return [
    { header: "TIPO_DOCUMENTO", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.documentTypes, values: uniqueSorted(catalogs.documentTypes) },
    { header: "SEXO", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.sexes, values: uniqueSorted(catalogs.sexes) },
    { header: "GRUPO_SANGUINEO", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.bloodTypes, values: uniqueSorted(catalogs.bloodTypes) },
    { header: "EPS", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.eps, values: uniqueSorted(catalogs.eps) },
    { header: "PENSION", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.pensions, values: uniqueSorted(catalogs.pensions) },
    { header: "CAJA_COMPENSACION", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.compensationBoxes, values: uniqueSorted(catalogs.compensationBoxes) },
    { header: "ARL", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.arls, values: uniqueSorted(catalogs.arls) },
    { header: "EMPRESA", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.companies, values: uniqueSorted(buildCatalogRow(catalogs.companies)) },
    { header: "CONTRATO", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.contracts, values: uniqueSorted(buildCatalogRow(catalogs.contracts)) },
    { header: "CARGO", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.positions, values: uniqueSorted(catalogs.positions) },
    { header: "MUNICIPIO", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.municipalities, values: uniqueSorted(buildCatalogRow(catalogs.municipalities)) },
    { header: "INSTITUCION", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.institutions, values: uniqueSorted(buildCatalogRow(catalogs.institutions)) },
    { header: "SEDE", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.sites, values: uniqueSorted(buildCatalogRow(catalogs.sites)) },
    {
      header: "MODALIDAD",
      rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.modalities,
      values: uniqueSorted(catalogs.modalities),
    },
    { header: "TIPO_CONTRATO", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.contractTypes, values: uniqueSorted(catalogs.contractTypes) },
    { header: "NIVEL_EDUCATIVO", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.studyLevels, values: uniqueSorted(catalogs.studyLevels) },
    { header: "TIPO_CUENTA", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.accountTypes, values: uniqueSorted(catalogs.accountTypes) },
    { header: "BANCO", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.banks, values: uniqueSorted(catalogs.banks) },
    { header: "ESTADO_LABORAL", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.employmentStatuses, values: uniqueSorted(catalogs.employmentStatuses) },
    { header: "CATEGORIA_SALARIAL", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.salaryCategories, values: uniqueSorted(catalogs.salaryCategories) },
    { header: "TALLA_CAMISA", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.shirtSizes, values: uniqueSorted(catalogs.shirtSizes) },
    { header: "TALLA_PANTALON", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.pantsSizes, values: uniqueSorted(catalogs.pantsSizes) },
    { header: "TALLA_CALZADO", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.shoeSizes, values: uniqueSorted(catalogs.shoeSizes) },
    { header: "TIPO_JORNADA", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.workTimes, values: uniqueSorted(catalogs.workTimes) },
    { header: "BOOLEANOS", rangeName: EXCEL_VALIDATION_RANGE_BY_CATALOG.booleanText, values: uniqueSorted(catalogs.booleanText) },
  ];
}

function buildCatalogSheet(configs = []) {
  const headers = configs.map((config) => config.header);
  const maxRows = Math.max(1, ...configs.map((config) => config.values.length));
  const rows = [headers];
  for (let index = 0; index < maxRows; index += 1) {
    rows.push(configs.map((config) => config.values[index] ?? ""));
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = headers.map((header) => ({ wch: Math.max(20, header.length + 4) }));
  return sheet;
}

function buildWorkbookNames(configs = []) {
  return configs
    .filter((config) => config.rangeName && config.values.length)
    .map((config, index) => {
      const column = XLSX.utils.encode_col(index);
      return {
        Name: config.rangeName,
        Ref: `'CATALOGOS'!$${column}$2:$${column}$${config.values.length + 1}`,
      };
    });
}

function injectExcelDataValidations(buffer) {
  const validations = FIELD_DEFS
    .map((field, index) => {
      const rangeName = field.catalog ? EXCEL_VALIDATION_RANGE_BY_CATALOG[field.catalog] : "";
      if (!rangeName || field.readOnly) return "";
      const column = XLSX.utils.encode_col(index);
      return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="stop" sqref="${column}2:${column}1048576"><formula1>${xmlEscape(rangeName)}</formula1></dataValidation>`;
    })
    .filter(Boolean);

  if (!validations.length) return buffer;

  const zip = XLSX_CFB.read(buffer, { type: "buffer" });
  const sheetEntry = findZipEntry(zip, "xl/worksheets/sheet1.xml");
  if (!sheetEntry?.content) return buffer;

  const dataValidationBlock = `<dataValidations count="${validations.length}">${validations.join("")}</dataValidations>`;
  const sheetXml = String(sheetEntry.content);
  const updatedXml = sheetXml.includes("<ignoredErrors>")
    ? sheetXml.replace("<ignoredErrors>", `${dataValidationBlock}<ignoredErrors>`)
    : sheetXml.replace("</worksheet>", `${dataValidationBlock}</worksheet>`);

  sheetEntry.content = Buffer.from(updatedXml, "utf8");
  return XLSX_CFB.write(zip, { fileType: "zip", type: "buffer" });
}

function buildTemplateWorkbook(rows, catalogs) {
  const dataHeaders = FIELD_DEFS.map((field) => field.header);
  const dataRows = rows.map((row) => FIELD_DEFS.map((field) => row[field.key] ?? ""));
  const ws = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows]);
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: dataHeaders.length - 1, r: Math.max(1, dataRows.length) } }) };
  ws["!freeze"] = { xSplit: 3, ySplit: 1 };
  ws["!cols"] = FIELD_DEFS.map((field) => ({ wch: Math.max(16, field.header.length + 2) }));
  const catalogConfigs = buildValidationCatalogConfigs(catalogs);
  const catalogWs = buildCatalogSheet(catalogConfigs);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "EXPEDIENTE");
  XLSX.utils.book_append_sheet(wb, catalogWs, "CATALOGOS");
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.Names = buildWorkbookNames(catalogConfigs);
  wb.Workbook.Sheets = [{ name: "EXPEDIENTE", Hidden: 0 }, { name: "CATALOGOS", Hidden: 1 }];
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return injectExcelDataValidations(buffer);
}

async function buildBulkUpdateTemplate({ resource } = {}) {
  const filters = buildScopeFilters(resource);
  const [employeesPayload, catalogs] = await Promise.all([
    getEmployees(filters),
    getCatalogs(),
  ]);
  const employees = Array.isArray(employeesPayload.rows) ? employeesPayload.rows : [];
  const employeeIds = employees.map((row) => Number(row.id)).filter(Boolean);
  const payrollSnapshots = await getEmployeeCurrentPayrollSnapshots(employeeIds);
  const enrichedCatalogs = enrichCatalogsFromEmployees(catalogs, employees, payrollSnapshots);
  const flatRows = employees.map((employee) => buildEmployeeFlatRow(employee, enrichedCatalogs, payrollSnapshots));
  return {
    buffer: buildTemplateWorkbook(flatRows, enrichedCatalogs),
    fileName: `plantilla_actualizacion_expediente_${new Date().toISOString().slice(0, 10)}.xlsx`,
  };
}

function findEmployeeByReference(values, currentByDoc) {
  const reference = text(values.documentReference || values.documentNumber);
  if (!reference) return null;
  const key = normalizeText(reference);
  return currentByDoc.get(key) || null;
}

function buildRowPatch(existing, values, normalized, allowOverwriteEmpty) {
  const patch = {};
  const apply = (key, value) => {
    if (value === undefined) return;
    patch[key] = value;
  };
  const setIf = (condition, key, value) => {
    if (condition) patch[key] = value;
  };

  const expedition = splitIsoDate(normalized.expeditionDate);
  const birth = splitIsoDate(normalized.birthDate);

  if (shouldApplyIncoming(FIELD_BY_KEY.get("documentType"), normalized.documentType, allowOverwriteEmpty)) apply("documentType", normalized.documentType);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("documentNumber"), normalized.documentNumber, allowOverwriteEmpty)) apply("documentNumber", normalized.documentNumber);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("firstName"), normalized.firstName, allowOverwriteEmpty)) apply("firstName", normalized.firstName);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("secondName"), normalized.secondName, allowOverwriteEmpty)) apply("secondName", normalized.secondName);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("firstLastName"), normalized.firstLastName, allowOverwriteEmpty)) apply("firstLastName", normalized.firstLastName);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("secondLastName"), normalized.secondLastName, allowOverwriteEmpty)) apply("secondLastName", normalized.secondLastName);
  setIf(shouldApplyIncoming(FIELD_BY_KEY.get("expeditionDate"), normalized.expeditionDate, allowOverwriteEmpty), "expeditionDay", expedition.day);
  setIf(shouldApplyIncoming(FIELD_BY_KEY.get("expeditionDate"), normalized.expeditionDate, allowOverwriteEmpty), "expeditionMonth", expedition.month);
  setIf(shouldApplyIncoming(FIELD_BY_KEY.get("expeditionDate"), normalized.expeditionDate, allowOverwriteEmpty), "expeditionYear", expedition.year);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("expeditionDepartment"), normalized.expeditionDepartment, allowOverwriteEmpty)) apply("expeditionDepartment", normalized.expeditionDepartment);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("expeditionMunicipality"), normalized.expeditionMunicipality, allowOverwriteEmpty)) apply("expeditionMunicipality", normalized.expeditionMunicipality);
  setIf(shouldApplyIncoming(FIELD_BY_KEY.get("birthDate"), normalized.birthDate, allowOverwriteEmpty), "birthDay", birth.day);
  setIf(shouldApplyIncoming(FIELD_BY_KEY.get("birthDate"), normalized.birthDate, allowOverwriteEmpty), "birthMonth", birth.month);
  setIf(shouldApplyIncoming(FIELD_BY_KEY.get("birthDate"), normalized.birthDate, allowOverwriteEmpty), "birthYear", birth.year);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("birthCountry"), normalized.birthCountry, allowOverwriteEmpty)) apply("birthCountry", normalized.birthCountry);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("birthDepartment"), normalized.birthDepartment, allowOverwriteEmpty)) apply("birthDepartment", normalized.birthDepartment);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("birthMunicipality"), normalized.birthMunicipality, allowOverwriteEmpty)) apply("birthMunicipality", normalized.birthMunicipality);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("biologicalSex"), normalized.biologicalSex, allowOverwriteEmpty)) apply("biologicalSex", normalized.biologicalSex);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("bloodType"), normalized.bloodType, allowOverwriteEmpty)) apply("bloodType", normalized.bloodType);

  if (shouldApplyIncoming(FIELD_BY_KEY.get("phone"), normalized.phone, allowOverwriteEmpty)) apply("phone", normalized.phone);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("email"), normalized.email, allowOverwriteEmpty)) apply("email", normalized.email);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("address"), normalized.address, allowOverwriteEmpty)) apply("address", normalized.address);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("neighborhood"), normalized.neighborhood, allowOverwriteEmpty)) apply("neighborhood", normalized.neighborhood);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("residenceMunicipality"), normalized.residenceMunicipality, allowOverwriteEmpty)) apply("residenceMunicipality", normalized.residenceMunicipality);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("residenceZone"), normalized.residenceZone, allowOverwriteEmpty)) apply("residenceZone", normalized.residenceZone);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("civilStatus"), normalized.civilStatus, allowOverwriteEmpty)) apply("civilStatus", normalized.civilStatus);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("eps"), normalized.eps, allowOverwriteEmpty)) apply("eps", normalized.eps);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("pensionFund"), normalized.pensionFund, allowOverwriteEmpty)) apply("pensionFund", normalized.pensionFund);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("compensationBox"), normalized.compensationBox, allowOverwriteEmpty)) apply("compensationBox", normalized.compensationBox);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("arl"), normalized.arl, allowOverwriteEmpty)) apply("arl", normalized.arl);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("shirtSize"), normalized.shirtSize, allowOverwriteEmpty)) apply("shirtSize", normalized.shirtSize);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("pantsSize"), normalized.pantsSize, allowOverwriteEmpty)) apply("pantsSize", normalized.pantsSize);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("shoeSize"), normalized.shoeSize, allowOverwriteEmpty)) apply("shoeSize", normalized.shoeSize);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("sisben"), normalized.sisben, allowOverwriteEmpty)) apply("sisben", normalized.sisben);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("sisbenCategory"), normalized.sisbenCategory, allowOverwriteEmpty)) apply("sisbenCategory", normalized.sisbenCategory);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("sisbenIssueDate"), normalized.sisbenIssueDate, allowOverwriteEmpty)) apply("sisbenIssueDate", normalized.sisbenIssueDate);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("sisbenExpirationDate"), normalized.sisbenExpirationDate, allowOverwriteEmpty)) apply("sisbenExpirationDate", normalized.sisbenExpirationDate);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("hasResidenceCertificate"), normalized.hasResidenceCertificate, allowOverwriteEmpty)) apply("hasResidenceCertificate", normalized.hasResidenceCertificate);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("residenceCertificateIssueDate"), normalized.residenceCertificateIssueDate, allowOverwriteEmpty)) apply("residenceCertificateIssueDate", normalized.residenceCertificateIssueDate);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("residenceCertificateExpiration"), normalized.residenceCertificateExpiration, allowOverwriteEmpty)) apply("residenceCertificateExpiration", normalized.residenceCertificateExpiration);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("foodHandlingCourseIssueDate"), normalized.foodHandlingCourseIssueDate, allowOverwriteEmpty)) apply("foodHandlingCourseIssueDate", normalized.foodHandlingCourseIssueDate);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("foodHandlingCourseExpirationDate"), normalized.foodHandlingCourseExpirationDate, allowOverwriteEmpty)) apply("foodHandlingCourseExpirationDate", normalized.foodHandlingCourseExpirationDate);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("foodHandlingExamIssueDate"), normalized.foodHandlingExamIssueDate, allowOverwriteEmpty)) apply("foodHandlingExamIssueDate", normalized.foodHandlingExamIssueDate);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("foodHandlingExamExpirationDate"), normalized.foodHandlingExamExpirationDate, allowOverwriteEmpty)) apply("foodHandlingExamExpirationDate", normalized.foodHandlingExamExpirationDate);

  if (values.studies !== null && (normalized.studiesJson || normalized.studyLevel || normalized.studyDegree || allowOverwriteEmpty)) {
    apply("studies", values.studies || []);
  }
  if (values.workExperience !== null && (normalized.workExperienceJson || allowOverwriteEmpty)) {
    apply("workExperience", values.workExperience || []);
  }

  if (shouldApplyIncoming(FIELD_BY_KEY.get("companyName"), normalized.companyName, allowOverwriteEmpty)) apply("companyId", values.companyId || "");
  if (shouldApplyIncoming(FIELD_BY_KEY.get("contractName"), normalized.contractName, allowOverwriteEmpty)) apply("contractId", values.contractId || "");
  if (shouldApplyIncoming(FIELD_BY_KEY.get("cargoReal"), normalized.cargoReal, allowOverwriteEmpty)) apply("cargo_real", normalized.cargoReal);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("startDate"), normalized.startDate, allowOverwriteEmpty)) apply("startDate", normalized.startDate);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("coverageStartDate"), normalized.coverageStartDate, allowOverwriteEmpty)) apply("coverageStartDate", normalized.coverageStartDate);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("arlVinculationDate"), normalized.arlVinculationDate, allowOverwriteEmpty)) apply("arlVinculationDate", normalized.arlVinculationDate);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("terminationDate"), normalized.terminationDate, allowOverwriteEmpty)) {
    apply("terminationDate", normalized.terminationDate);
    apply("hasTermination", normalized.terminationDate ? "true" : "");
  }
  if (shouldApplyIncoming(FIELD_BY_KEY.get("employmentStatus"), normalized.employmentStatus, allowOverwriteEmpty)) {
    apply("employmentStatus", normalized.employmentStatus);
  } else if (normalized.terminationDate) {
    apply("employmentStatus", "INACTIVO");
  } else if (allowOverwriteEmpty && text(normalized.terminationDate) === "") {
    apply("employmentStatus", "ACTIVO");
  }
  if (shouldApplyIncoming(FIELD_BY_KEY.get("presentedInOffer"), normalized.presentedInOffer, allowOverwriteEmpty)) apply("presentedInOffer", normalized.presentedInOffer);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("offerPosition"), normalized.offerPosition, allowOverwriteEmpty)) apply("offerPosition", normalized.offerPosition);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("municipalityName"), normalized.municipalityName, allowOverwriteEmpty)) apply("municipalityId", values.municipalityId || "");
  if (shouldApplyIncoming(FIELD_BY_KEY.get("institution"), normalized.institution, allowOverwriteEmpty)) apply("institution", normalized.institution);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("site"), normalized.site, allowOverwriteEmpty)) apply("site", normalized.site);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("educationalModality"), normalized.educationalModality, allowOverwriteEmpty)) apply("educationalModality", normalized.educationalModality);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("contractType"), normalized.contractType, allowOverwriteEmpty)) apply("contractType", normalized.contractType);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("workTimeType"), normalized.workTimeType, allowOverwriteEmpty)) apply("workTimeType", normalized.workTimeType);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("gestorZona"), normalized.gestorZona, allowOverwriteEmpty)) apply("gestorZona", normalized.gestorZona);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("auxiliarGestorZona"), normalized.auxiliarGestorZona, allowOverwriteEmpty)) apply("auxiliarGestorZona", normalized.auxiliarGestorZona);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("municipiosACargo"), normalized.municipiosACargo, allowOverwriteEmpty)) apply("municipiosACargo", normalized.municipiosACargo);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("accountType"), normalized.accountType, allowOverwriteEmpty)) apply("accountType", normalized.accountType);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("bankName"), normalized.bankName, allowOverwriteEmpty)) apply("bankName", normalized.bankName);
  if (shouldApplyIncoming(FIELD_BY_KEY.get("accountNumber"), normalized.accountNumber, allowOverwriteEmpty)) apply("accountNumber", normalized.accountNumber);

  return { ...existing, ...patch };
}

function buildPayrollImpactRange(existingRow, incomingRow) {
  const dates = [
    existingRow.startDate,
    existingRow.terminationDate,
    incomingRow.startDate,
    incomingRow.terminationDate,
    new Date().toISOString().slice(0, 10),
  ].map(toIsoDate).filter(Boolean).sort();
  return {
    from: dates[0] || new Date().toISOString().slice(0, 10),
    to: dates[dates.length - 1] || new Date().toISOString().slice(0, 10),
  };
}

async function findAffectedPayrollPeriods({ companyId, contractId, from, to }) {
  if (!companyId || !contractId) return [];
  const result = await pool.query(
    `SELECT id, label, period_start AS "periodStart", period_end AS "periodEnd", status
       FROM payroll_periods
      WHERE company_id = $1
        AND contract_id = $2
        AND period_start <= $4::date
        AND period_end >= $3::date
      ORDER BY period_start`,
    [Number(companyId), Number(contractId), from, to]
  ).catch(() => ({ rows: [] }));
  return result.rows;
}

async function previewBulkUpdate({ fileBase64, allowOverwriteEmpty = false, confirmSensitiveChanges = false, resource = {} } = {}) {
  const [catalogs, employeesPayload] = await Promise.all([
    getCatalogs(),
    getEmployees(buildScopeFilters(resource)),
  ]);
  const parsedRows = parseWorksheetRows(fileBase64);
  const employees = Array.isArray(employeesPayload.rows) ? employeesPayload.rows : [];
  const currentByDoc = new Map(employees.map((row) => [normalizeText(row.documentNumber || row.numero_documento), row]));
  const payrollSnapshots = await getEmployeeCurrentPayrollSnapshots(employees.map((row) => Number(row.id)).filter(Boolean));
  const effectiveCatalogs = enrichCatalogsFromEmployees(catalogs, employees, payrollSnapshots);

  const previewRows = [];
  const errors = [];
  const referenceSeen = new Set();
  const finalDocumentSeen = new Map();
  let changeCount = 0;
  let sensitiveCount = 0;

  for (const item of parsedRows) {
    const rowErrors = [];
    const validationErrors = [];
    const values = parseIncomingRow(item.raw);
    parseRowComplexFields(values, rowErrors);

    const employee = findEmployeeByReference(values, currentByDoc);
    if (!employee) {
      addValidationError(rowErrors, validationErrors, {
        rowNumber: item.rowNumber,
        field: "documentReference",
        label: "DOCUMENTO_REFERENCIA",
        valueReceived: values.documentReference || values.documentNumber || "",
        message: "Empleado no encontrado para el documento de referencia.",
      });
      previewRows.push({
        rowNumber: item.rowNumber,
        employee: "",
        documentNumber: values.documentNumber || values.documentReference || "",
        status: "ERROR",
        errors: rowErrors,
        validationErrors,
        changes: [],
        payrollAlerts: [],
      });
      errors.push({ rowNumber: item.rowNumber, errors: rowErrors, validationErrors });
      continue;
    }

    const currentFlat = buildEmployeeFlatRow(employee, effectiveCatalogs, payrollSnapshots);
    const normalized = { ...values };
    const companyResolved = resolveCatalogValue("companies", normalized.companyName || currentFlat.companyName, effectiveCatalogs);
    const contractResolved = resolveCatalogValue("contracts", normalized.contractName || currentFlat.contractName, effectiveCatalogs);
    const municipalityResolved = resolveCatalogValue("municipalities", normalized.municipalityName || currentFlat.municipalityName, effectiveCatalogs);

    if (!companyResolved.ok) {
      addValidationError(rowErrors, validationErrors, {
        rowNumber: item.rowNumber,
        field: "companyName",
        label: "EMPRESA",
        valueReceived: normalized.companyName || currentFlat.companyName,
        validValues: companyResolved.validValues || buildCatalogOptions("companies", effectiveCatalogs),
        message: companyResolved.message,
      });
    }
    if (!contractResolved.ok) {
      addValidationError(rowErrors, validationErrors, {
        rowNumber: item.rowNumber,
        field: "contractName",
        label: "CONTRATO",
        valueReceived: normalized.contractName || currentFlat.contractName,
        validValues: contractResolved.validValues || buildCatalogOptions("contracts", effectiveCatalogs),
        message: contractResolved.message,
      });
    }
    if (!municipalityResolved.ok && text(normalized.municipalityName)) {
      addValidationError(rowErrors, validationErrors, {
        rowNumber: item.rowNumber,
        field: "municipalityName",
        label: "MUNICIPIO_VINCULACION",
        valueReceived: normalized.municipalityName,
        validValues: municipalityResolved.validValues || buildCatalogOptions("municipalities", effectiveCatalogs),
        message: municipalityResolved.message,
      });
    }

    const contractEntity = contractResolved.entity || effectiveCatalogs.contracts.find((row) => row.name === currentFlat.contractName) || null;
    const companyEntity = companyResolved.entity || effectiveCatalogs.companies.find((row) => row.name === currentFlat.companyName) || null;
    normalized.companyId = companyEntity?.id || employee.companyId || employee.company_id || "";
    normalized.contractId = contractEntity?.id || employee.contractId || employee.contract_id || "";
    if (contractEntity && companyEntity && contractEntity.companyId && Number(contractEntity.companyId) !== Number(companyEntity.id)) {
      addValidationError(rowErrors, validationErrors, {
        rowNumber: item.rowNumber,
        field: "contractName",
        label: "CONTRATO",
        valueReceived: normalized.contractName || currentFlat.contractName,
        validValues: uniqueSorted((effectiveCatalogs.contracts || [])
          .filter((row) => Number(row.companyId) === Number(companyEntity.id))
          .map((row) => row.name)),
        message: "El contrato no pertenece a la empresa seleccionada.",
      });
    }

    const municipalityEntity = municipalityResolved.entity || effectiveCatalogs.municipalities.find((row) => row.name === currentFlat.municipalityName) || null;
    normalized.municipalityId = municipalityEntity?.id || employee.municipalityId || employee.municipality_id || "";
    const institutionNorm = normalizeText(normalized.institution || currentFlat.institution);
    const siteNorm = normalizeText(normalized.site || currentFlat.site);
    const institutionRow = effectiveCatalogs.maps.institutionByNorm.get(normalizeText(`${normalized.institution || currentFlat.institution}|${municipalityEntity?.id || ""}`))
      || effectiveCatalogs.maps.institutionByNorm.get(institutionNorm)
      || null;
    const siteRow = effectiveCatalogs.maps.siteByNorm.get(normalizeText(`${normalized.site || currentFlat.site}|${institutionRow?.id || ""}`))
      || effectiveCatalogs.maps.siteByNorm.get(siteNorm)
      || null;

    if (false && text(normalized.institution) && municipalityEntity && institutionRow && institutionRow.municipalityId && Number(institutionRow.municipalityId) !== Number(municipalityEntity.id)) {
      rowErrors.push("La institución no pertenece al municipio.");
    } else if (false && text(normalized.institution) && !institutionRow) {
      rowErrors.push("Valor no válido para institución educativa.");
    }

    if (false && text(normalized.site) && institutionRow && siteRow && siteRow.institutionId && Number(siteRow.institutionId) !== Number(institutionRow.id)) {
      rowErrors.push("La sede no pertenece a la institución.");
    } else if (false && text(normalized.site) && !siteRow) {
      rowErrors.push("Valor no válido para sede educativa.");
    }

    if (text(normalized.institution) && municipalityEntity && institutionRow && institutionRow.municipalityId && Number(institutionRow.municipalityId) !== Number(municipalityEntity.id)) {
      addValidationError(rowErrors, validationErrors, {
        rowNumber: item.rowNumber,
        field: "institution",
        label: "INSTITUCION_EDUCATIVA",
        valueReceived: normalized.institution,
        validValues: [...(effectiveCatalogs.maps.institutionsByMunicipality.get(String(municipalityEntity.id)) || new Set())],
        message: "La institucion no pertenece al municipio seleccionado.",
      });
    } else if (text(normalized.institution) && !institutionRow) {
      addValidationError(rowErrors, validationErrors, {
        rowNumber: item.rowNumber,
        field: "institution",
        label: "INSTITUCION_EDUCATIVA",
        valueReceived: normalized.institution,
        validValues: municipalityEntity
          ? [...(effectiveCatalogs.maps.institutionsByMunicipality.get(String(municipalityEntity.id)) || new Set())]
          : buildCatalogOptions("institutions", effectiveCatalogs),
        message: "Valor no valido para institucion educativa.",
      });
    }

    if (text(normalized.site) && institutionRow && siteRow && siteRow.institutionId && Number(siteRow.institutionId) !== Number(institutionRow.id)) {
      addValidationError(rowErrors, validationErrors, {
        rowNumber: item.rowNumber,
        field: "site",
        label: "SEDE_EDUCATIVA",
        valueReceived: normalized.site,
        validValues: [...(effectiveCatalogs.maps.sitesByInstitution.get(String(institutionRow.id)) || new Set())],
        message: "La sede no pertenece a la institucion seleccionada.",
      });
    } else if (text(normalized.site) && !siteRow) {
      addValidationError(rowErrors, validationErrors, {
        rowNumber: item.rowNumber,
        field: "site",
        label: "SEDE_EDUCATIVA",
        valueReceived: normalized.site,
        validValues: institutionRow
          ? [...(effectiveCatalogs.maps.sitesByInstitution.get(String(institutionRow.id)) || new Set())]
          : buildCatalogOptions("sites", effectiveCatalogs),
        message: "Valor no valido para sede educativa.",
      });
    }

    const effectiveCompanyId = companyEntity?.id || employee.companyId || employee.company_id || null;
    const effectiveContractId = contractEntity?.id || employee.contractId || employee.contract_id || null;
    const modalityKey = [
      effectiveCompanyId || "",
      effectiveContractId || "",
      municipalityEntity?.id || employee.municipalityId || employee.municipality_id || "",
      text(normalized.institution || currentFlat.institution),
      text(normalized.site || currentFlat.site),
    ].map((part) => normalizeText(part)).join("|");
    const allowedModalities = effectiveCatalogs.maps.modalityIndex.get(modalityKey) || null;
    if (false && text(normalized.educationalModality) && allowedModalities && !allowedModalities.has(text(normalized.educationalModality).toUpperCase())) {
      rowErrors.push("La modalidad no pertenece a la sede.");
    } else if (false && text(normalized.educationalModality) && !allowedModalities && text(normalized.site || currentFlat.site)) {
      rowErrors.push("Modalidad no encontrada en cobertura.");
    }

    if (text(normalized.educationalModality) && allowedModalities && !allowedModalities.has(text(normalized.educationalModality).toUpperCase())) {
      addValidationError(rowErrors, validationErrors, {
        rowNumber: item.rowNumber,
        field: "educationalModality",
        label: "MODALIDAD",
        valueReceived: normalized.educationalModality,
        validValues: [...allowedModalities],
        message: "La modalidad no pertenece a la sede seleccionada.",
      });
    } else if (text(normalized.educationalModality) && !allowedModalities && text(normalized.site || currentFlat.site)) {
      addValidationError(rowErrors, validationErrors, {
        rowNumber: item.rowNumber,
        field: "educationalModality",
        label: "MODALIDAD",
        valueReceived: normalized.educationalModality,
        validValues: buildCatalogOptions("modalities", effectiveCatalogs),
        message: "Modalidad no encontrada en la cobertura vigente.",
      });
    }

    for (const field of FIELD_DEFS) {
      if (!field.catalog || !text(normalized[field.key])) continue;
      if (MANUALLY_VALIDATED_CATALOG_FIELDS.has(field.key)) continue;
      const resolved = resolveCatalogValue(field.catalog, normalized[field.key], effectiveCatalogs);
      if (!resolved.ok) {
        addValidationError(rowErrors, validationErrors, {
          rowNumber: item.rowNumber,
          field: field.key,
          label: field.header,
          valueReceived: normalized[field.key],
          validValues: resolved.validValues || buildCatalogOptions(field.catalog, effectiveCatalogs),
          message: resolved.message,
        });
      } else {
        normalized[field.key] = resolved.value;
      }
    }

    const referenceNorm = normalizeText(values.documentReference || currentFlat.documentReference);
    if (referenceNorm) {
      if (referenceSeen.has(referenceNorm)) rowErrors.push("Empleado repetido en el archivo.");
      referenceSeen.add(referenceNorm);
    }

    const finalDocumentNorm = normalizeText(normalized.documentNumber || currentFlat.documentNumber);
    if (finalDocumentNorm) {
      const existingOwner = currentByDoc.get(finalDocumentNorm);
      if (existingOwner && Number(existingOwner.id) !== Number(employee.id)) {
        rowErrors.push("Documento duplicado con otro empleado.");
      }
      const repeatedRow = finalDocumentSeen.get(finalDocumentNorm);
      if (repeatedRow && Number(repeatedRow.employeeId) !== Number(employee.id)) {
        rowErrors.push("Documento duplicado en el archivo.");
      } else {
        finalDocumentSeen.set(finalDocumentNorm, { employeeId: employee.id, rowNumber: item.rowNumber });
      }
    }

    const changes = [];
    for (const field of FIELD_DEFS) {
      if (!shouldApplyIncoming(field, normalized[field.key], allowOverwriteEmpty)) continue;
      if (field.key === "documentReference") continue;
      if (UNSUPPORTED_BULK_UPDATE_KEYS.has(field.key) && !compareFieldValues(field, currentFlat[field.key], normalized[field.key])) {
        if (field.key === "salaryCategory") rowErrors.push("La actualizacion de categoria salarial no esta soportada en esta version.");
        else if (field.key === "otherRecargos") rowErrors.push("La actualizacion de otros recargos no esta soportada en esta version.");
        else if (field.key === "observationsJson") rowErrors.push("La actualizacion masiva del historial de observaciones no esta soportada en esta version.");
        else if (field.key === "internalNotes") rowErrors.push("La actualizacion masiva de notas internas no esta soportada en esta version.");
        continue;
      }
      if (field.key === "salaryCategory" && text(normalized.salaryCategory) && !compareFieldValues(field, currentFlat.salaryCategory, normalized.salaryCategory)) {
        rowErrors.push("La actualización de categoría salarial no está soportada en esta versión.");
        continue;
      }
      if (field.key === "otherRecargos" && text(normalized.otherRecargos) && !compareFieldValues(field, currentFlat.otherRecargos, normalized.otherRecargos)) {
        rowErrors.push("La actualización de otros recargos no está soportada en esta versión.");
        continue;
      }
      if (compareFieldValues(field, currentFlat[field.key], normalized[field.key])) continue;
      const impacts = changeImpacts(field);
      const isSensitive = field.key === "documentNumber";
      if (isSensitive) sensitiveCount += 1;
      if (isSensitive && !confirmSensitiveChanges) {
        rowErrors.push("Cambio sensible en número de documento: requiere confirmación especial.");
      }
      changes.push({
        field: field.key,
        label: field.header,
        currentValue: currentFlat[field.key] ?? "",
        newValue: normalized[field.key] ?? "",
        changeType: buildChangeType(field.key),
        impacts,
      });
    }

    let payrollAlerts = [];
    if (changes.some((change) => PAYROLL_ALERT_KEYS.has(change.field))) {
      const range = buildPayrollImpactRange(currentFlat, normalized);
      const periods = await findAffectedPayrollPeriods({
        companyId: companyEntity?.id || employee.companyId || employee.company_id,
        contractId: contractEntity?.id || employee.contractId || employee.contract_id,
        from: range.from,
        to: range.to,
      });
      payrollAlerts = periods.map((period) => ({
        periodId: period.id,
        label: period.label,
        status: period.status,
        message: `Este cambio afecta nomina del periodo ${period.label}. Requiere revision.`,
      }));
    }

    changeCount += changes.length;
    const status = rowErrors.length ? "ERROR" : changes.length ? "READY" : "SKIP";
    previewRows.push({
      rowNumber: item.rowNumber,
      employeeId: employee.id,
      employee: employee.fullName || employee.nombre || "",
      documentNumber: currentFlat.documentNumber,
      status,
      errors: rowErrors,
      validationErrors,
      changes,
      payrollAlerts,
      salaryChangesSupported: !rowErrors.some((msg) => msg.includes("categoría salarial") || msg.includes("otros recargos")),
      sourceValues: normalized,
    });
    if (rowErrors.length) errors.push({ rowNumber: item.rowNumber, errors: rowErrors, validationErrors });
  }

  return {
    summary: {
      totalRows: parsedRows.length,
      readyRows: previewRows.filter((row) => row.status === "READY").length,
      skippedRows: previewRows.filter((row) => row.status === "SKIP").length,
      errorRows: previewRows.filter((row) => row.status === "ERROR").length,
      changeCount,
      sensitiveCount,
      requiresSensitiveConfirmation: sensitiveCount > 0,
    },
    rows: previewRows,
    errors,
  };
}

async function appendAssignmentHistory(employee, beforeFlat, afterFlat, user) {
  const assignmentRes = await pool.query(
    `SELECT assignment_id AS "assignmentId", company_id AS "companyId", contract_id AS "contractId"
       FROM v_employee_current_assignments
      WHERE employee_id = $1
      ORDER BY assignment_id DESC
      LIMIT 1`,
    [Number(employee.id)]
  ).catch(() => ({ rows: [] }));
  const currentAssignment = assignmentRes.rows[0];
  if (!currentAssignment?.assignmentId) return;

  const changedFields = ["cargoReal", "municipalityName", "institution", "site", "educationalModality", "workTimeType"]
    .filter((key) => text(beforeFlat[key]) !== text(afterFlat[key]));
  for (const key of changedFields) {
    await pool.query(
      `INSERT INTO employee_assignment_history (
         assignment_id, employee_id, company_id, contract_id,
         action_type, field_name, old_value, new_value,
         snapshot_before, snapshot_after, changed_by_user_id, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)`,
      [
        currentAssignment.assignmentId,
        Number(employee.id),
        currentAssignment.companyId || null,
        currentAssignment.contractId || null,
        "BULK_UPDATE",
        key,
        JSON.stringify({ value: beforeFlat[key] ?? "" }),
        JSON.stringify({ value: afterFlat[key] ?? "" }),
        JSON.stringify(beforeFlat),
        JSON.stringify(afterFlat),
        user?.id || null,
        "Actualización masiva del expediente",
      ]
    ).catch(() => {});
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

async function applyBulkUpdate({
  fileBase64,
  fileName = "actualizacion_expediente.xlsx",
  allowOverwriteEmpty = false,
  confirmSensitiveChanges = false,
  resource = {},
  user = {},
} = {}) {
  const preview = await previewBulkUpdate({
    fileBase64,
    allowOverwriteEmpty,
    confirmSensitiveChanges,
    resource,
  });

  const readyRows = preview.rows.filter((row) => row.status === "READY");
  if (!readyRows.length) {
    return {
      ...preview.summary,
      appliedRows: 0,
      batchId: crypto.randomUUID(),
      errors: preview.errors,
    };
  }

  ensureDir(OUTPUT_DIR);
  const batchId = crypto.randomUUID();
  const storedFileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${batchId}-${path.basename(fileName)}`;
  const absolutePath = path.join(OUTPUT_DIR, storedFileName);
  fs.writeFileSync(absolutePath, Buffer.from(String(fileBase64).split("base64,")[1], "base64"));

  const appliedRows = [];
  const applyErrors = [];
  const catalogs = await getCatalogs();
  for (const row of readyRows) {
    try {
      const current = await getEmployeeById(row.employeeId);
      if (!current) throw new Error("Empleado no encontrado al aplicar cambios.");
      const snapshots = await getEmployeeCurrentPayrollSnapshots([Number(current.id)]);
      const beforeFlat = buildEmployeeFlatRow(current, catalogs, snapshots);
      const mergedPayload = buildRowPatch(current, row.sourceValues, row.sourceValues, allowOverwriteEmpty);
      const updated = await updateEmployee(current.id, mergedPayload, {
        userId: user.id || null,
        userName: user.name || user.full_name || user.username || "Usuario",
      });

      const after = await getEmployeeById(current.id);
      const afterSnapshots = await getEmployeeCurrentPayrollSnapshots([Number(current.id)]);
      const afterFlat = buildEmployeeFlatRow(after || updated || current, catalogs, afterSnapshots);

      await appendAssignmentHistory(current, beforeFlat, afterFlat, user);

      const salaryChanged = row.changes.some((change) => change.field === "salaryBase" || change.field === "transportAllowance");
      if (salaryChanged) {
        await createEmployeeSalaryConfig(current.id, {
          base_salary: toNumber(row.sourceValues.salaryBase) || 0,
          transport_allowance: toNumber(row.sourceValues.transportAllowance) || 0,
          effective_date: row.sourceValues.startDate || new Date().toISOString().slice(0, 10),
          notes: "Actualización masiva del expediente",
        }, user.id || null);
      }

      const payrollAlerts = row.payrollAlerts || [];
      if (payrollAlerts.length) {
        await insertAuditLog({
          module: "personnel",
          entityType: "employee",
          entityId: String(current.id),
          action: "bulk_update_payroll_alert",
          userId: user.id || null,
          userName: user.name || user.username || "Usuario",
          reason: "Actualización masiva con impacto en nómina",
          payload: {
            periods: payrollAlerts,
          },
        });
      }

      await insertAuditLog({
        module: "personnel",
        entityType: "employee",
        entityId: String(current.id),
        action: "bulk_update_expediente",
        userId: user.id || null,
        userName: user.name || user.username || "Usuario",
        reason: "Actualización masiva del expediente",
        payload: {
          batchId,
          fileName,
          changedFields: row.changes.map((change) => ({
            field: change.field,
            label: change.label,
            currentValue: change.currentValue,
            newValue: change.newValue,
            changeType: change.changeType,
          })),
        },
      });

      appliedRows.push({
        employeeId: current.id,
        employee: current.fullName || "",
        documentNumber: current.documentNumber || "",
        changeCount: row.changes.length,
      });
    } catch (error) {
      applyErrors.push({
        rowNumber: row.rowNumber,
        employeeId: row.employeeId,
        employee: row.employee,
        message: error.message || "Error aplicando cambios.",
      });
    }
  }

  await insertAuditLog({
    module: "personnel",
    entityType: "employee_bulk_update",
    entityId: batchId,
    action: "bulk_update_batch",
    userId: user.id || null,
    userName: user.name || user.username || "Usuario",
    reason: "Actualización masiva del expediente",
    payload: {
      fileName,
      filePath: absolutePath,
      totalRows: preview.summary.totalRows,
      readyRows: preview.summary.readyRows,
      appliedRows: appliedRows.length,
      errorRows: preview.summary.errorRows + applyErrors.length,
      allowOverwriteEmpty: Boolean(allowOverwriteEmpty),
      confirmSensitiveChanges: Boolean(confirmSensitiveChanges),
      errors: applyErrors,
    },
  });

  return {
    batchId,
    totalRows: preview.summary.totalRows,
    readyRows: preview.summary.readyRows,
    errorRows: preview.summary.errorRows + applyErrors.length,
    appliedRows: appliedRows.length,
    skippedRows: preview.summary.skippedRows,
    applied: appliedRows,
    errors: [...preview.errors, ...applyErrors],
  };
}

module.exports = {
  FIELD_DEFS,
  getCatalogs,
  buildBulkUpdateTemplate,
  previewBulkUpdate,
  applyBulkUpdate,
};
