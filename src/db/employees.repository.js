const pool = require("./pool");
const XLSX = require("xlsx");

// Auto-migration: add municipios_a_cargo column if it doesn't exist yet
pool.query(
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS municipios_a_cargo TEXT DEFAULT ''`
).catch(err => console.warn("[migration] municipios_a_cargo:", err.message));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();
}

function cleanText(value) {
  return String(value || "").trim();
}

// Sanea cualquier valor de fecha antes de mandarlo a PG (acepta serial Excel, Date, o string)
function safeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const n = Number(value);
  if (Number.isFinite(n) && n > 1000) {
    // Serial numérico Excel → fecha real
    const d = new Date(new Date(Date.UTC(1899, 11, 30)).getTime() + n * 86400000);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
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
  );
}

async function resolveInstitutionId(name, municipalityId = null) {
  if (!name || !String(name).trim()) return null;
  const nameStr = String(name).trim();
  const normalized = normalize(nameStr).replace(/[^A-Z0-9]/g, '');
  if (!normalized) return null;

  const baseNorm  = `SELECT id FROM institutions WHERE REGEXP_REPLACE(UPPER(TRIM(name)),'[^A-Z0-9]','','g') = $1`;
  const baseIlike = `SELECT id FROM institutions WHERE UPPER(TRIM(name)) = UPPER(TRIM($1))`;

  if (municipalityId) {
    const r = await pool.query(`${baseNorm} AND municipality_id = $2 LIMIT 1`, [normalized, municipalityId]);
    if (r.rows[0]) return r.rows[0].id;
    const r2 = await pool.query(`${baseIlike} AND municipality_id = $2 LIMIT 1`, [nameStr, municipalityId]);
    if (r2.rows[0]) return r2.rows[0].id;
  }
  const r = await pool.query(`${baseNorm} LIMIT 1`, [normalized]);
  if (r.rows[0]) return r.rows[0].id;
  const r2 = await pool.query(`${baseIlike} LIMIT 1`, [nameStr]);
  return r2.rows[0]?.id || null;
}

async function resolveSiteId(name, institutionId = null) {
  if (!name || !String(name).trim()) return null;
  const nameStr = String(name).trim();
  const normalized = normalize(nameStr).replace(/[^A-Z0-9]/g, '');
  if (!normalized) return null;

  const baseNorm = `SELECT id FROM educational_sites WHERE REGEXP_REPLACE(UPPER(TRIM(name)),'[^A-Z0-9]','','g') = $1`;
  const baseIlike = `SELECT id FROM educational_sites WHERE UPPER(TRIM(name)) = UPPER(TRIM($1))`;

  // Try normalized match (handles special chars), with institution filter first
  if (institutionId) {
    const r = await pool.query(`${baseNorm} AND institution_id = $2 LIMIT 1`, [normalized, institutionId]);
    if (r.rows[0]) return r.rows[0].id;
    // Fallback: exact case-insensitive match with institution
    const r2 = await pool.query(`${baseIlike} AND institution_id = $2 LIMIT 1`, [nameStr, institutionId]);
    if (r2.rows[0]) return r2.rows[0].id;
  }
  // Try without institution filter
  const r = await pool.query(`${baseNorm} LIMIT 1`, [normalized]);
  if (r.rows[0]) return r.rows[0].id;
  const r2 = await pool.query(`${baseIlike} LIMIT 1`, [nameStr]);
  return r2.rows[0]?.id || null;
}

async function resolveMunicipalityId(value) {
  const numericId = toNumberOrNull(value);
  if (numericId) return numericId;

  const name = String(value || "").trim();
  if (!name) return null;

  // Exact match (case-insensitive)
  const exact = await pool.query(
    `SELECT id FROM municipalities WHERE UPPER(TRIM(name)) = UPPER(TRIM($1)) LIMIT 1`,
    [name]
  );
  if (exact.rows[0]) return exact.rows[0].id;

  // Normalized match: remove accents and all non-alphanumeric chars (matches SQL REGEXP_REPLACE)
  const normalized = normalize(name).replace(/[^A-Z0-9]/g, "");
  if (!normalized) return null;
  const fuzzy = await pool.query(
    `SELECT id FROM municipalities
     WHERE REGEXP_REPLACE(UPPER(name), '[^A-Z0-9]', '', 'g') = $1 LIMIT 1`,
    [normalized]
  );
  return fuzzy.rows[0]?.id || null;
}

// ─── Mapper ──────────────────────────────────────────────────────────────────

function mapEmployee(row) {
  return {
    id: row.id,
    legacyJsonId: row.legacy_json_id || null,

    fullName: row.full_name || "",
    name: row.full_name || "",
    nombre: row.full_name || "",

    primer_nombre: row.first_name || "",
    segundo_nombre: row.second_name || "",
    primer_apellido: row.first_last_name || "",
    segundo_apellido: row.second_last_name || "",

    firstName: row.first_name || "",
    secondName: row.second_name || "",
    firstLastName: row.first_last_name || "",
    secondLastName: row.second_last_name || "",

    tipo_documento: row.document_type || "",
    documentType: row.document_type || "",

    numero_documento: row.document_number || "",
    documentNumber: row.document_number || "",

    // Nacimiento
    birthDay:          row.birth_day          || "",
    birthMonth:        row.birth_month        || "",
    birthYear:         row.birth_year         || "",
    birthCountry:      row.birth_country      || "",
    birthDepartment:   row.birth_department   || "",
    birthMunicipality: row.birth_municipality || "",

    // Expedición cédula
    expeditionDay:          row.expedition_day          || "",
    expeditionMonth:        row.expedition_month        || "",
    expeditionYear:         row.expedition_year         || "",
    expeditionDepartment:   row.expedition_department   || "",
    expeditionMunicipality: row.expedition_municipality || "",

    bloodType:     row.blood_type     || "",

    phone: row.phone || "",
    celular: row.phone || "",
    telefono: row.phone || "",

    email: row.email || "",
    correo_electronico: row.email || "",
    correo: row.email || "",

    address: row.address || "",
    direccion_residencia: row.address || "",

    neighborhood: row.neighborhood || "",
    barrio_residencia: row.neighborhood || "",

    civil_status: row.civil_status || "",
    estado_civil: row.civil_status || "",

    cargo_real: row.real_position || row.cargo || "",
    position: row.real_position || row.cargo || "",
    cargo: row.real_position || row.cargo || "",

    eps: row.eps || "",
    fondo_pensiones: row.pension_fund || "",
    pensionFund: row.pension_fund || "",

    caja_compensacion: row.compensation_box || "COFREM",
    compensationBox: row.compensation_box || "COFREM",

    arl: row.arl || "SURA",
    fecha_real_vinculacion_arl: row.arl_vinculation_date || "",
    arlVinculationDate: row.arl_vinculation_date || "",

    fecha_inicio_cobertura: row.coverage_start_date || "",
    coverageStartDate: row.coverage_start_date || "",

    startDate: row.start_date || "",
    start_date: row.start_date || "",

    workdayType: row.workday_type || "",
    workday_type: row.workday_type || "",

    sex: row.sex || row.biological_sex || "",
    biologicalSex: row.sex || row.biological_sex || "",

    gestorZona: row.gestor_zona || "",
    gestor_zona: row.gestor_zona || "",

    municipiosACargo: row.municipios_a_cargo || "",
    municipios_a_cargo: row.municipios_a_cargo || "",

    tenantId: row.tenant_id || null,
    tenant_id: row.tenant_id || null,

    companyId: row.company_id || null,
    company_id: row.company_id || null,

    contractId: row.contract_id || null,
    contract_id: row.contract_id || null,

    municipalityId: row.municipality_id || null,
    municipality_id: row.municipality_id || null,
    municipalityName: row.municipality_name || "",
    municipality_name: row.municipality_name || "",
    municipality: row.municipality_name || row.municipality_id || "",
    municipio: row.municipality_name || row.municipality_id || "",

    residenceMunicipality: row.residence_municipality || "",
    municipio_residencia:  row.residence_municipality || "",
    residenceZone:         row.residence_zone         || "",
    zona_residencia:       row.residence_zone         || "",

    educationalMunicipality: row.educational_municipality_name || "",

    institutionId: row.institution_id || null,
    institution_id: row.institution_id || null,
    institutionName: row.institution_name || "",
    institution_name: row.institution_name || "",
    institution: row.institution_name || "",
    institucion_educativa: row.institution_name || "",

    siteId: row.site_id || null,
    site_id: row.site_id || null,
    siteName: row.site_name || "",
    site_name: row.site_name || "",
    site: row.site_name || "",
    sede_educativa: row.site_name || "",

    modality: row.modality || "",
    modalidad: row.modality || "",

    status: row.status || "",
    estado: row.status || "",

    sisben: Boolean(row.sisben),
    sisbenCategory: row.sisben_category || "",
    sisben_categoria: row.sisben_category || "",
    sisbenIssueDate: row.sisben_exp_date || "",
    sisben_exp_date: row.sisben_exp_date || "",
    sisbenExpirationDate: row.sisben_expiry || "",
    sisbenExpiry: row.sisben_expiry || "",
    sisben_expiry: row.sisben_expiry || "",

    residenceCertificate: Boolean(row.residence_certificate),
    hasResidenceCertificate: Boolean(row.residence_certificate),
    residenceCertificateIssueDate: row.residence_certificate_issue_date || "",
    residence_certificate_issue_date: row.residence_certificate_issue_date || "",
    residenceCertificateExpiration: row.residence_certificate_expiry || "",
    residenceCertificateExpiry: row.residence_certificate_expiry || "",
    residence_certificate_expiry: row.residence_certificate_expiry || "",

    presentedInOffer: Boolean(row.presented_in_offer),
    presented_in_offer: Boolean(row.presented_in_offer),

    offeredPosition: row.offered_position || "",
    offered_position: row.offered_position || "",

    photoUrl: row.photo_url || null,

    workExperience: Array.isArray(row.work_experience) ? row.work_experience : [],
    studies:        Array.isArray(row.studies)         ? row.studies         : [],

    foodHandlingCourseIssueDate:
      row.food_handling_course_issue_date || null,
    foodHandlingCourseExpirationDate:
      row.food_handling_course_expiry_date || null,
    foodHandlingExamIssueDate:
      row.food_handling_exam_issue_date || null,
    foodHandlingExamExpirationDate:
      row.food_handling_exam_expiry_date || null,

    shirtSize:    row.shirt_size    || "",
    pantsSize:    row.pants_size    || "",
    shoeSize:     row.shoe_size     || "",
    contractType: row.contract_type || "",

    accountType:        row.account_type        || "",
    bankName:           row.bank_name           || "",
    accountNumber:      row.account_number      || "",
    auxiliarGestorZona: row.auxiliar_gestor_zona || "",

    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function updateEmployeePhoto(id, photoUrl) {
  const result = await pool.query(
    `UPDATE employees SET photo_url = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id`,
    [id, photoUrl]
  );
  return result.rows[0] || null;
}

// ─── SELECT base con JOINs ────────────────────────────────────────────────────

const BASE_SELECT = `
  SELECT
    e.*,
    m.name  AS municipality_name,
    i.name  AS institution_name,
    s.name  AS site_name,
    im.name AS educational_municipality_name
  FROM employees e
  LEFT JOIN municipalities    m  ON m.id  = e.municipality_id
  LEFT JOIN institutions      i  ON i.id  = e.institution_id
  LEFT JOIN educational_sites s  ON s.id  = e.site_id
  LEFT JOIN municipalities    im ON im.id = i.municipality_id
`;

// ─── Funciones públicas ───────────────────────────────────────────────────────

async function getEmployees(filters = {}) {
  const values = [];
  const conditions = [];

  if (filters.tenantId) {
    values.push(filters.tenantId);
    conditions.push(`e.tenant_id = $${values.length}`);
  }

  if (filters.companyId) {
    values.push(filters.companyId);
    conditions.push(`e.company_id = $${values.length}`);
  }

  if (filters.contractId) {
    values.push(filters.contractId);
    conditions.push(`e.contract_id = $${values.length}`);
  }

  if (filters.municipalityId) {
    values.push(filters.municipalityId);
    conditions.push(`e.municipality_id = $${values.length}`);
  }

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`e.status = $${values.length}`);
  }

  if (filters.documentNumber) {
    values.push(filters.documentNumber);
    conditions.push(`e.document_number = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `${BASE_SELECT} ${where} ORDER BY e.full_name ASC`;

  const result = await pool.query(query, values);
  return result.rows.map(mapEmployee);
}

async function getEmployeeById(id) {
  const numId = Number(id);
  // legacy_json_id suele ser > 2^31; id (serial INTEGER) nunca lo es
  const isIntRange = Number.isInteger(numId) && numId <= 2147483647;

  const whereClause = isIntRange
    ? `WHERE (e.id = $1 OR e.legacy_json_id = $1)`
    : `WHERE e.legacy_json_id = $1`;

  const result = await pool.query(
    `${BASE_SELECT} ${whereClause} LIMIT 1`,
    [numId]
  );
  return result.rows[0] ? mapEmployee(result.rows[0]) : null;
}

async function getEmployeeByDocument(docType, docNumber) {
  const values = [docNumber];
  const conditions = [`e.document_number = $1`];

  if (docType) {
    values.push(docType);
    conditions.push(`e.document_type = $${values.length}`);
  }

  const result = await pool.query(
    `${BASE_SELECT} WHERE ${conditions.join(" AND ")} LIMIT 1`,
    values
  );
  return result.rows[0] ? mapEmployee(result.rows[0]) : null;
}

async function createEmployee(data) {
  const fullName = buildFullName(data);

  const municipalityId = await resolveMunicipalityId(
    data.municipalityId || data.municipality_id || data.municipality || data.municipio
  );

  const institutionId =
    await resolveInstitutionId(
      data.institution || data.institutionName || data.institution_name || data.institucion_educativa,
      municipalityId
    ) || toNumberOrNull(data.institutionId || data.institution_id);

  const rawSiteNameC = data.site || data.siteName || data.site_name || data.sede_educativa;
  let siteId = await resolveSiteId(rawSiteNameC, institutionId);
  if (!siteId) siteId = await resolveSiteId(rawSiteNameC, null);
  if (!siteId) {
    const rawSiteId = toNumberOrNull(data.siteId || data.site_id || data.site);
    if (rawSiteId) {
      const exists = await pool.query(`SELECT 1 FROM educational_sites WHERE id = $1`, [rawSiteId]);
      siteId = exists.rows[0] ? rawSiteId : null;
    }
  }
  if (siteId) {
    const verify = await pool.query(`SELECT 1 FROM educational_sites WHERE id = $1`, [siteId]);
    if (!verify.rows[0]) { siteId = null; }
  }

  const result = await pool.query(
    `INSERT INTO employees (
      tenant_id, full_name,
      first_name, second_name, first_last_name, second_last_name,
      document_type, document_number,
      expedition_day, expedition_month, expedition_year,
      expedition_department, expedition_municipality,
      birth_day, birth_month, birth_year,
      birth_country, birth_department, birth_municipality,
      blood_type, biological_sex,
      phone, email, address, neighborhood, civil_status,
      real_position, company_id, contract_id, municipality_id,
      institution_id, site_id, modality,
      eps, pension_fund, compensation_box, arl,
      arl_vinculation_date, coverage_start_date,
      status, workday_type, gestor_zona, municipios_a_cargo,
      shirt_size, pants_size, shoe_size, contract_type
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
      $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,
      $44,$45,$46,$47
    ) RETURNING *`,
    [
      toNumberOrNull(data.tenantId || data.tenant_id) || 1,
      fullName,
      data.primer_nombre || data.firstName || "",
      data.segundo_nombre || data.secondName || "",
      data.primer_apellido || data.firstLastName || "",
      data.segundo_apellido || data.secondLastName || "",
      data.tipo_documento || data.documentType || "",
      data.numero_documento || data.documentNumber || "",
      toNumberOrNull(data.expeditionDay),
      toNumberOrNull(data.expeditionMonth),
      toNumberOrNull(data.expeditionYear),
      data.expeditionDepartment || "",
      data.expeditionMunicipality || "",
      toNumberOrNull(data.birthDay),
      toNumberOrNull(data.birthMonth),
      toNumberOrNull(data.birthYear),
      data.birthCountry || "",
      data.birthDepartment || "",
      data.birthMunicipality || "",
      data.bloodType || "",
      data.biologicalSex || data.sex || "",
      data.phone || "",
      data.email || "",
      data.direccion_residencia || data.address || "",
      data.barrio_residencia || data.neighborhood || "",
      data.civil_status || data.civilStatus || "",
      data.cargo_real || data.real_position || data.position || "",
      toNumberOrNull(data.companyId || data.company_id),
      toNumberOrNull(data.contractId || data.contract_id),
      municipalityId,
      institutionId,
      siteId,
      data.modality || data.modalidad || "",
      data.eps || "",
      data.fondo_pensiones || data.pensionFund || data.pension_fund || "",
      data.caja_compensacion || data.compensationBox || "COFREM",
      data.arl || "SURA",
      safeDate(data.fecha_real_vinculacion_arl || data.arlVinculationDate),
      safeDate(data.fecha_inicio_cobertura || data.coverageStartDate || data.coverage_start_date),
      data.status || data.estado || "ACTIVO",
      data.workdayType || data.workday_type || "TC",
      data.gestorZona || data.gestor_zona || "",
      data.municipiosACargo || data.municipios_a_cargo || "",
      data.shirtSize    || "",
      data.pantsSize    || "",
      data.shoeSize     || "",
      data.contractType || data.contract_type || "",
    ]
  );

  return mapEmployee(result.rows[0]);
}

async function updateEmployee(id, data) {
  const fullName = buildFullName(data);

  const municipalityId = await resolveMunicipalityId(
    data.municipalityId || data.municipality_id || data.municipality || data.municipio
  );

  // Educational municipality is separate from work municipality
  const educationalMunicipalityId = (data.educationalMunicipality)
    ? await resolveMunicipalityId(data.educationalMunicipality)
    : null;

  const institutionId =
    await resolveInstitutionId(
      data.institution || data.institutionName || data.institution_name || data.institucion_educativa,
      educationalMunicipalityId || municipalityId
    ) || toNumberOrNull(data.institutionId || data.institution_id);

  // Resolve site by name first, then validate any raw numeric ID before using it.
  const rawSiteName = data.site || data.siteName || data.site_name || data.sede_educativa;
  let siteId = await resolveSiteId(rawSiteName, institutionId);

  if (!siteId) {
    // Try resolving without institution filter (catalog may be cross-municipality)
    siteId = await resolveSiteId(rawSiteName, null);
  }

  if (!siteId) {
    // data.site might itself be a numeric ID if site_name was missing at load time
    const rawSiteId = toNumberOrNull(data.siteId || data.site_id || data.site);
    if (rawSiteId) {
      const exists = await pool.query(`SELECT 1 FROM educational_sites WHERE id = $1`, [rawSiteId]);
      siteId = exists.rows[0] ? rawSiteId : null;
    }
  }

  // Final safety: verify siteId actually exists before using it
  if (siteId) {
    const verify = await pool.query(`SELECT 1 FROM educational_sites WHERE id = $1`, [siteId]);
    if (!verify.rows[0]) {
      console.error(`[updateEmployee] site_id ${siteId} not found in educational_sites — forcing null`);
      siteId = null;
    }
  }

  console.log(`[updateEmployee] id=${id} rawSite="${rawSiteName ? String(rawSiteName).slice(0,40) : '—'}" institutionId=${institutionId} resolvedSiteId=${siteId}`);
  console.log(`[updateEmployee] sisben fields: sisben=${data.sisben} cat=${data.sisbenCategory} issue=${data.sisbenIssueDate} exp=${data.sisbenExpirationDate}`);
  console.log(`[updateEmployee] residence cert: has=${data.hasResidenceCertificate} issue=${data.residenceCertificateIssueDate} exp=${data.residenceCertificateExpiration}`);

  const result = await pool.query(
    `UPDATE employees SET
      full_name = $2,
      first_name = $3, second_name = $4, first_last_name = $5, second_last_name = $6,
      document_type = $7, document_number = $8,
      expedition_day = $9, expedition_month = $10, expedition_year = $11,
      expedition_department = $12, expedition_municipality = $13,
      birth_day = $14, birth_month = $15, birth_year = $16,
      birth_country = $17, birth_department = $18, birth_municipality = $19,
      blood_type = $20, biological_sex = $21,
      phone = $22, email = $23, address = $24, neighborhood = $25, civil_status = $26,
      real_position = $27, company_id = $28, contract_id = $29, municipality_id = $30,
      institution_id = $31, site_id = $32, modality = $33,
      eps = $34, pension_fund = $35, compensation_box = $36, arl = $37,
      arl_vinculation_date = $38, coverage_start_date = $39,
      status = $40, workday_type = $41, gestor_zona = $42,
      work_experience = $43, studies = $44,
      shirt_size = $45, pants_size = $46, shoe_size = $47,
      residence_municipality = $48,
      sisben = $49, sisben_category = $50, sisben_expiry = $51, sisben_exp_date = $52,
      residence_certificate = $53, residence_certificate_expiry = $54,
      presented_in_offer = $55, offered_position = $56,
      food_handling_course_issue_date = $57, food_handling_course_expiry_date = $58,
      food_handling_exam_issue_date = $59, food_handling_exam_expiry_date = $60,
      start_date = $61, municipios_a_cargo = $62,
      residence_zone = $63,
      residence_certificate_issue_date = $64,
      account_type        = $65,
      bank_name           = $66,
      account_number      = $67,
      auxiliar_gestor_zona = $68,
      contract_type       = $69,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *`,
    [
      id,
      fullName,
      data.primer_nombre || data.firstName || "",
      data.segundo_nombre || data.secondName || "",
      data.primer_apellido || data.firstLastName || "",
      data.segundo_apellido || data.secondLastName || "",
      data.tipo_documento || data.documentType || "",
      data.numero_documento || data.documentNumber || "",
      toNumberOrNull(data.expeditionDay),
      toNumberOrNull(data.expeditionMonth),
      toNumberOrNull(data.expeditionYear),
      data.expeditionDepartment || "",
      data.expeditionMunicipality || "",
      toNumberOrNull(data.birthDay),
      toNumberOrNull(data.birthMonth),
      toNumberOrNull(data.birthYear),
      data.birthCountry || "",
      data.birthDepartment || "",
      data.birthMunicipality || "",
      data.bloodType || "",
      data.biologicalSex || data.sex || "",
      data.phone || "",
      data.email || "",
      data.direccion_residencia || data.address || "",
      data.barrio_residencia || data.neighborhood || "",
      data.civil_status || data.civilStatus || "",
      data.cargo_real || data.real_position || data.position || data.cargo_real || "",
      toNumberOrNull(data.companyId || data.company_id),
      toNumberOrNull(data.contractId || data.contract_id),
      municipalityId,
      institutionId,
      siteId,
      data.educationalModality || data.modality || data.modalidad || "",
      data.eps || "",
      data.fondo_pensiones || data.pensionFund || data.pension_fund || "",
      data.caja_compensacion || data.compensationBox || "COFREM",
      data.arl || "SURA",
      safeDate(data.fecha_real_vinculacion_arl || data.arlVinculationDate),
      safeDate(data.fecha_inicio_cobertura || data.coverageStartDate || data.coverage_start_date),
      data.status || data.estado || "ACTIVO",
      data.workTimeType || data.workdayType || data.workday_type || "TC",
      data.gestorZona || data.gestor_zona || "",
      JSON.stringify(Array.isArray(data.workExperience) ? data.workExperience : []),
      JSON.stringify(Array.isArray(data.studies)        ? data.studies        : []),
      data.shirtSize || "",
      data.pantsSize || "",
      data.shoeSize  || "",
      // New fields ($48–$63)
      data.residenceMunicipality || data.municipio_residencia || "",
      String(data.sisben) === "true",
      data.sisbenCategory || data.sisben_categoria || "",
      safeDate(data.sisbenExpirationDate || data.sisben_expiration_date || data.sisben_expiry),
      safeDate(data.sisbenIssueDate || data.sisben_issue_date || data.sisben_exp_date),
      String(data.hasResidenceCertificate) === "true",
      safeDate(data.residenceCertificateExpiration || data.residence_certificate_expiry),
      String(data.presentedInOffer) === "true",
      data.offerPosition || data.offered_position || "",
      safeDate(data.foodHandlingCourseIssueDate || data.food_handling_course_issue_date),
      safeDate(data.foodHandlingCourseExpirationDate || data.food_handling_course_expiry_date),
      safeDate(data.foodHandlingExamIssueDate || data.food_handling_exam_issue_date),
      safeDate(data.foodHandlingExamExpirationDate || data.food_handling_exam_expiry_date),
      safeDate(data.startDate || data.start_date),
      data.municipiosACargo || data.municipios_a_cargo || "",
      data.residenceZone || data.zona_residencia || "",
      safeDate(data.residenceCertificateIssueDate || data.residence_certificate_issue_date),
      data.accountType        || "",
      data.bankName           || "",
      data.accountNumber      || "",
      data.auxiliarGestorZona || "",
      data.contractType       || data.contract_type || "",
    ]
  );

  return result.rows[0] ? mapEmployee(result.rows[0]) : null;
}

async function updateEmployeeStatus(id, status) {
  const result = await pool.query(
    `UPDATE employees SET status = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return result.rows[0] ? mapEmployee(result.rows[0]) : null;
}

// ─── Import desde Excel ───────────────────────────────────────────────────────

function findExcelColumn(row, possibleNames = []) {
  const keys = Object.keys(row || {});
  const normKeys = keys.map(k => ({ key: k, norm: normalize(k) }));

  // Pass 1: exact match — try each name in priority order
  for (const name of possibleNames) {
    const n = normalize(name);
    const hit = normKeys.find(({ norm }) => norm === n);
    if (hit) return hit.key;
  }

  // Pass 2: column key contains the full search name (longer names tried first to avoid false positives)
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

function getRawCell(row, possibleNames = []) {
  const column = findExcelColumn(row, possibleNames);
  return column !== undefined ? row[column] : null;
}

// Convierte serial numérico de Excel, Date object, o string a YYYY-MM-DD (o null)
function parseExcelDate(value) {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && value > 0) {
    // Serial de Excel: época = 30 dic 1899, con bug de año bisiesto 1900
    const msPerDay = 86400000;
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + value * msPerDay);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  const str = String(value).trim();
  if (!str) return null;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // DD/MM/YYYY o DD-MM-YYYY
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function getDateCell(row, possibleNames = []) {
  return parseExcelDate(getRawCell(row, possibleNames));
}

function mapExcelRowToEmployee(row = {}, defaults = {}) {
  const firstName     = getCell(row, ["PRIMER NOMBRE", "NOMBRE 1", "NOMBRE1"]);
  const secondName    = getCell(row, ["SEGUNDO NOMBRE", "NOMBRE 2", "NOMBRE2"]);
  const firstLastName = getCell(row, ["PRIMER APELLIDO", "APELLIDO 1", "APELLIDO1"]);
  const secondLastName= getCell(row, ["SEGUNDO APELLIDO", "APELLIDO 2", "APELLIDO2"]);

  const fullName = firstNonEmpty(
    getCell(row, ["NOMBRE COMPLETO"]),
    [firstName, secondName, firstLastName, secondLastName].filter(Boolean).join(" ")
  );

  const documentNumber = getCell(row, [
    "NUMERO DOCUMENTO", "CEDULA", "CEDULA DE CIUDADANIA", "IDENTIFICACION", "DOCUMENTO",
  ]);

  const municipality = getCell(row, ["MUNICIPIO OPERACION", "MUNICIPIO DE OPERACION", "MUNICIPIO"]);

  const rawWorkday = normalize(getCell(row, [
    "TIPO JORNADA", "TIPO DE JORNADA", "JORNADA", "TIEMPO", "TC MT",
  ]));
  const workdayType = rawWorkday.includes("MT") || rawWorkday.includes("MEDIO") ? "MT" : "TC";

  const rawStatus = normalize(getCell(row, ["ESTADO", "ESTADO LABORAL"]));
  const status = rawStatus === "INACTIVO" || rawStatus === "RETIRADO"
    ? rawStatus === "RETIRADO" ? "RETIRADO" : "INACTIVO"
    : rawStatus === "NOVEDAD" ? "NOVEDAD"
    : "ACTIVO";

  return {
    ...defaults,
    firstName,  secondName, firstLastName, secondLastName,
    primer_nombre: firstName, segundo_nombre: secondName,
    primer_apellido: firstLastName, segundo_apellido: secondLastName,
    fullName, nombre: fullName, name: fullName,

    documentType:   normalize(getCell(row, ["TIPO DOCUMENTO", "TIPO DE DOCUMENTO"])) || "CC",
    documentNumber, numero_documento: documentNumber,

    // Birth
    birthDay:           getCell(row, ["DIA NACIMIENTO", "NACIMIENTO DIA", "HBD DIA"]),
    birthMonth:         getCell(row, ["MES NACIMIENTO", "NACIMIENTO MES", "HBD MES"]),
    birthYear:          getCell(row, ["ANO NACIMIENTO", "NACIMIENTO ANO", "AÑO NACIMIENTO", "HBD AÑO"]),
    birthCountry:       getCell(row, ["PAIS NACIMIENTO", "PAIS DE NACIMIENTO"]),
    birthDepartment:    getCell(row, ["DEPARTAMENTO NACIMIENTO", "DEPTO NACIMIENTO"]),
    birthMunicipality:  getCell(row, ["MUNICIPIO NACIMIENTO"]),

    // Expedition
    expeditionDay:          getCell(row, ["DIA EXPEDICION", "EXPEDICION DIA", "EXP DIA"]),
    expeditionMonth:        getCell(row, ["MES EXPEDICION", "EXPEDICION MES", "EXP MES"]),
    expeditionYear:         getCell(row, ["ANO EXPEDICION", "EXPEDICION ANO", "AÑO EXPEDICION", "EXP AÑO"]),
    expeditionDepartment:   getCell(row, ["DEPARTAMENTO EXPEDICION", "DEPTO EXPEDICION"]),
    expeditionMunicipality: getCell(row, ["MUNICIPIO EXPEDICION"]),

    // Personal
    bloodType:   normalize(getCell(row, ["TIPO SANGRE", "GRUPO SANGUINEO"])),
    biologicalSex: normalize(getCell(row, ["SEXO", "GENERO", "SEXO BIOLOGICO"])),
    phone:       getCell(row, ["CELULAR", "TELEFONO", "TELÉFONO", "MOVIL"]),
    email:       getCell(row, ["CORREO", "EMAIL", "CORREO ELECTRONICO"]),
    address:     getCell(row, ["DIRECCION", "DIRECCIÓN", "DIRECCION RESIDENCIA"]),
    neighborhood:getCell(row, ["BARRIO", "BARRIO RESIDENCIA"]),
    civilStatus: getCell(row, ["ESTADO CIVIL"]),

    // Work
    cargo_real:  getCell(row, ["CARGO REAL", "CARGO"]),
    workdayType, status,
    gestorZona:  getCell(row, ["GESTOR ZONA", "ZONA", "GESTOR"]),

    // Location
    municipality, municipio: municipality,

    // Educational
    institution: getCell(row, ["INSTITUCION EDUCATIVA", "INSTITUCION", "INSTITUCIÓN"]),
    site:        getCell(row, ["SEDE EDUCATIVA", "SEDE"]),
    modality:    getCell(row, ["MODALIDAD"]),

    // Payroll
    eps:              getCell(row, ["EPS"]),
    pensionFund:      getCell(row, ["FONDO PENSIONES", "PENSION", "AFP"]),
    compensationBox:  getCell(row, ["CAJA COMPENSACION", "CAJA"]) || "COFREM",
    arl:              getCell(row, ["ARL"]) || "SURA",
    arlVinculationDate: getDateCell(row, ["FECHA VINCULACION ARL", "FECHA ARL", "FECHA VINCULACION"]),
    coverageStartDate:  getDateCell(row, [
      "FECHA INICIO COBERTURA", "FECHA COBERTURA",
      "FECHA DE INGRESO", "FECHA INGRESO", "FECHA INICIO LABORES",
      "FECHA CONTRATACION", "FECHA INICIO",
    ]),

    // IDs (optional, used when provided)
    companyId:  getCell(row, ["EMPRESA ID", "COMPANY ID"]) || defaults.companyId || null,
    contractId: getCell(row, ["CONTRATO ID", "CONTRACT ID"]) || defaults.contractId || null,
  };
}

async function importEmployeesFromExcel({ fileBase64, fileName, defaults = {} }) {
  if (!fileBase64 || !fileBase64.startsWith("data:")) {
    throw new Error("Debes enviar un archivo Excel válido.");
  }

  const base64Data = fileBase64.split("base64,")[1];
  if (!base64Data) throw new Error("Archivo Excel inválido.");

  const buffer = Buffer.from(base64Data, "base64");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

  if (!workbook.SheetNames.length) throw new Error("El archivo Excel no tiene hojas.");

  let rows = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    const headerIndex = matrix.findIndex((row) => {
      const text = normalize(row.join(" "));
      return (
        (text.includes("DOCUMENTO") || text.includes("CEDULA") || text.includes("IDENTIFICACION")) &&
        (text.includes("NOMBRE") || text.includes("EMPLEADO"))
      );
    });

    if (headerIndex === -1) continue;

    const headers = matrix[headerIndex].map((v, i) => cleanText(v) || `COLUMNA_${i + 1}`);

    rows = matrix
      .slice(headerIndex + 1)
      .map((row) => {
        const item = {};
        headers.forEach((h, i) => { item[h] = row[i] ?? ""; });
        return item;
      })
      .filter((row) => Object.values(row).join(" ").trim() !== "");

    if (rows.length) break;
  }

  if (!rows.length) {
    throw new Error(
      "No encontré registros válidos. Verifica que el Excel tenga columnas como DOCUMENTO y NOMBRE."
    );
  }

  // Bulk-check duplicates against DB — scoped to the same contract when contractId is provided
  const docNumbers = rows
    .map((r) => normalize(getCell(r, [
      "NUMERO DOCUMENTO", "CEDULA", "CEDULA DE CIUDADANIA", "IDENTIFICACION", "DOCUMENTO",
    ])))
    .filter(Boolean);

  const contractId = toNumberOrNull(defaults.contractId);
  const existingResult = docNumbers.length
    ? await pool.query(
        contractId
          ? `SELECT id, document_number FROM employees
             WHERE UPPER(TRIM(document_number)) = ANY($1) AND contract_id = $2`
          : `SELECT id, document_number FROM employees
             WHERE UPPER(TRIM(document_number)) = ANY($1)`,
        contractId ? [docNumbers, contractId] : [docNumbers]
      )
    : { rows: [] };

  const existingByDoc = new Map(
    existingResult.rows.map((r) => [normalize(r.document_number), r.id])
  );

  let created = 0, skipped = 0, errored = 0;
  // Per-row results for the output Excel
  const resultRows = [];
  // Track within-batch duplicates
  const seenInBatch = new Set();

  for (let index = 0; index < rows.length; index++) {
    const excelRowNumber = index + 2;

    try {
      const mapped = mapExcelRowToEmployee(rows[index], defaults);
      const displayName = mapped.fullName || "(sin nombre)";
      const docNum      = mapped.documentNumber || "";

      if (!docNum) {
        errored++;
        resultRows.push({
          fila: excelRowNumber, nombre: displayName, documento: docNum,
          estado: "ERROR", mensaje: "Sin número de documento.",
        });
        continue;
      }

      const docKey = normalize(docNum);

      // DB duplicate
      if (existingByDoc.has(docKey)) {
        skipped++;
        resultRows.push({
          fila: excelRowNumber, nombre: displayName, documento: docNum,
          estado: "DUPLICADO", mensaje: "Ya existe un empleado con este documento en el sistema.",
        });
        continue;
      }

      // Within-batch duplicate
      if (seenInBatch.has(docKey)) {
        skipped++;
        resultRows.push({
          fila: excelRowNumber, nombre: displayName, documento: docNum,
          estado: "DUPLICADO", mensaje: "Documento repetido en el mismo archivo.",
        });
        continue;
      }

      seenInBatch.add(docKey);
      const newEmployee = await createEmployee(mapped);
      existingByDoc.set(docKey, newEmployee.id);
      created++;
      resultRows.push({
        fila: excelRowNumber, nombre: displayName, documento: docNum,
        estado: "CREADO", mensaje: "Registro creado exitosamente.",
      });
    } catch (error) {
      errored++;
      resultRows.push({
        fila: index + 2, nombre: "", documento: "",
        estado: "ERROR", mensaje: error.message || "Error desconocido",
      });
    }
  }

  // Generate result Excel (base64)
  let resultExcelBase64 = null;
  try {
    const wb = XLSX.utils.book_new();
    const wsData = [
      ["Fila", "Nombre", "Documento", "Estado", "Mensaje"],
      ...resultRows.map(r => [r.fila, r.nombre, r.documento, r.estado, r.mensaje]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [{ wch: 6 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, ws, "Resultado importación");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    resultExcelBase64 = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,"
      + buf.toString("base64");
  } catch { /* non-fatal — just won't have the result Excel */ }

  return {
    fileName,
    totalRows: rows.length,
    created,
    skipped,
    errored,
    resultRows,
    resultExcelBase64,
  };
}

module.exports = {
  getEmployees,
  getEmployeeById,
  getEmployeeByDocument,
  createEmployee,
  updateEmployee,
  updateEmployeeStatus,
  updateEmployeePhoto,
  importEmployeesFromExcel,
  mapEmployee,
};
