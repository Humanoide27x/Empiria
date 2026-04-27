const pool = require("../../db/pool");

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function buildFullName(data = {}) {
  return firstNonEmpty(
    data.fullName,
    data.full_name,
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

function mapEmployee(row) {
  return {
    id: row.id,

    fullName: row.full_name,
    name: row.full_name,
    nombre: row.full_name,

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

    phone: row.phone || "",
    celular: row.phone || "",
    telefono: row.phone || "",

    email: row.email || "",
    correo_electronico: row.email || "",
    correo: row.email || "",

    address: row.address || "",
    direccion_residencia: row.address || "",

    civil_status: row.civil_status || "",
    estado_civil: row.civil_status || "",

    cargo_real: row.real_position || row.offered_position || "",
    position: row.real_position || row.offered_position || "",
    cargo: row.real_position || row.offered_position || "",

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
    municipio_residencia: row.municipality_name || row.municipality_id || "",

    status: row.status || "",
    estado: row.status || "",

    // 🔴 ALERTAS IMPORTANTES
    sisben: Boolean(row.sisben),
    sisbenCategory: row.sisben_category || row.sisben_categoria || "",
    sisben_categoria: row.sisben_category || row.sisben_categoria || "",
    sisbenExpiry: row.sisben_expiry || "",
    sisben_expiry: row.sisben_expiry || "",

    residenceCertificate: Boolean(row.residence_certificate),
    residenceCertificateExpiry:
      row.residence_certificate_expiry ||
      row.residence_certificate_expiration ||
      "",
  };
}

async function listEmployeesFromRepository(filters = {}) {
  let query = `
    SELECT e.*, m.name AS municipality_name
    FROM employees e
    LEFT JOIN municipalities m ON m.id = e.municipality_id
  `;
  const values = [];
  const conditions = [];

  if (filters.tenantId) {
    values.push(filters.tenantId);
    conditions.push("e.tenant_id = $" + values.length);
  }

  if (filters.documentNumber) {
    values.push(filters.documentNumber);
    conditions.push(`e.document_number = $${values.length}`);
  }

  if (filters.companyId) {
    values.push(filters.companyId);
    conditions.push(`e.company_id = $${values.length}`);
  }

  if (filters.contractId) {
    values.push(filters.contractId);
    conditions.push(`e.contract_id = $${values.length}`);
  }

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`e.status = $${values.length}`);
  }

  if (conditions.length) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  query += ` ORDER BY e.id DESC`;

  const result = await pool.query(query, values);
  return result.rows.map(mapEmployee);
}

async function getEmployeeByIdFromRepository(id) {
  const result = await pool.query(
    `
    SELECT e.*, m.name AS municipality_name
    FROM employees e
    LEFT JOIN municipalities m ON m.id = e.municipality_id
    WHERE e.id = $1
    `,
    [id]
  );
  return result.rows[0] ? mapEmployee(result.rows[0]) : null;
}

async function createEmployeeInRepository(data) {
  const fullName = buildFullName(data);

  const result = await pool.query(
    `
    INSERT INTO employees (
      tenant_id,
      full_name,
      first_name,
      second_name,
      first_last_name,
      second_last_name,
      document_type,
      document_number,
      expedition_day,
      expedition_month,
      expedition_year,
      expedition_department,
      expedition_municipality,
      birth_day,
      birth_month,
      birth_year,
      birth_country,
      birth_department,
      birth_municipality,
      blood_type,
      biological_sex,
      phone,
      email,
      address,
      neighborhood,
      civil_status,
      real_position,
      company_id,
      contract_id,
      municipality_id,
      institution_id,
      site_id,
      modality,
      eps,
      pension_fund,
      compensation_box,
      arl,
      arl_vinculation_date,
      coverage_start_date,
      status
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
      $31,$32,$33,$34,$35,$36,$37,$38,$39,$40
    )
    RETURNING *
    `,
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
      data.biologicalSex || "",

      data.phone || "",
      data.email || "",
      data.direccion_residencia || data.address || "",
      data.barrio_residencia || data.neighborhood || "",
      data.civil_status || data.civilStatus || "",

      data.cargo_real || data.position || "",

      toNumberOrNull(data.companyId),
      toNumberOrNull(data.contractId),
      toNumberOrNull(data.municipalityId || data.municipality_id || data.municipality || data.municipio),

      toNumberOrNull(data.institutionId),
      toNumberOrNull(data.siteId),
      data.modality || "",

      data.eps || "",
      data.fondo_pensiones || data.pensionFund || "",
      data.caja_compensacion || data.compensationBox || "",
      data.arl || "SURA",
      data.fecha_real_vinculacion_arl || data.arlVinculationDate || null,
      data.fecha_inicio_cobertura || data.coverageStartDate || null,

      data.status || "REGISTRO INCOMPLETO",
    ]
  );

  return mapEmployee(result.rows[0]);
}

async function updateEmployeeInRepository(id, data) {
  const fullName = buildFullName(data);

  const result = await pool.query(
    `
    UPDATE employees SET
      full_name = $2,
      first_name = $3,
      second_name = $4,
      first_last_name = $5,
      second_last_name = $6,
      document_type = $7,
      document_number = $8,
      expedition_day = $9,
      expedition_month = $10,
      expedition_year = $11,
      expedition_department = $12,
      expedition_municipality = $13,
      birth_day = $14,
      birth_month = $15,
      birth_year = $16,
      birth_country = $17,
      birth_department = $18,
      birth_municipality = $19,
      blood_type = $20,
      biological_sex = $21,
      phone = $22,
      email = $23,
      address = $24,
      neighborhood = $25,
      civil_status = $26,
      real_position = $27,
      company_id = $28,
      contract_id = $29,
      municipality_id = $30,
      institution_id = $31,
      site_id = $32,
      modality = $33,
      eps = $34,
      pension_fund = $35,
      compensation_box = $36,
      arl = $37,
      arl_vinculation_date = $38,
      coverage_start_date = $39,
      status = $40,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
    `,
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
      data.biologicalSex || "",

      data.phone || "",
      data.email || "",
      data.direccion_residencia || data.address || "",
      data.barrio_residencia || data.neighborhood || "",
      data.civil_status || data.civilStatus || "",

      data.cargo_real || data.position || "",

      toNumberOrNull(data.companyId),
      toNumberOrNull(data.contractId),
      toNumberOrNull(data.municipalityId || data.municipality_id || data.municipality || data.municipio),

      toNumberOrNull(data.institutionId),
      toNumberOrNull(data.siteId),
      data.modality || "",

      data.eps || "",
      data.fondo_pensiones || data.pensionFund || "",
      data.caja_compensacion || data.compensationBox || "",
      data.arl || "SURA",
      data.fecha_real_vinculacion_arl || data.arlVinculationDate || null,
      data.fecha_inicio_cobertura || data.coverageStartDate || null,

      data.status || "REGISTRO INCOMPLETO",
    ]
  );

  return result.rows[0] ? mapEmployee(result.rows[0]) : null;
}

async function deleteEmployeeFromRepository(id) {
  const result = await pool.query(`DELETE FROM employees WHERE id = $1`, [id]);
  return result.rowCount > 0;
}

async function getRequiredDocumentsByEmployeeIdFromRepository(id) {
  const result = await pool.query(
    `
    SELECT 
      dt.id,
      dt.code,
      dt.name,
      dt.phase,
      cpd.required,
      cp.name AS position_name,
      cp.category,
      cp.profile_level
    FROM employees e
    JOIN contract_positions cp
      ON cp.company_id = e.company_id
     AND cp.contract_id = e.contract_id
     AND cp.tenant_id = e.tenant_id
     AND upper(trim(cp.name)) = upper(trim(
          CASE 
            WHEN e.presented_in_offer = true 
              THEN COALESCE(NULLIF(e.offered_position, ''), NULLIF(e.offer_position, ''), e.real_position)
            ELSE e.real_position
          END
     ))
    JOIN contract_position_documents cpd
      ON cpd.contract_position_id = cp.id
    JOIN document_types dt
      ON dt.id = cpd.document_type_id
    WHERE e.id = $1
    ORDER BY dt.phase, dt.name
    `,
    [id]
  );

  return result.rows;
}

module.exports = {
  listEmployeesFromRepository,
  getEmployeeByIdFromRepository,
  createEmployeeInRepository,
  updateEmployeeInRepository,
  deleteEmployeeFromRepository,
  getRequiredDocumentsByEmployeeIdFromRepository,
};