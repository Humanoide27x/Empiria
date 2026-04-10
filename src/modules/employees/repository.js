const pool = require("../../db/pool");

// 🔥 Construir nombre completo automáticamente
function buildFullName(data) {
  return [
    data.first_last_name,
    data.second_last_name,
    data.first_name,
    data.second_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

// 🔄 Mapear DB → Frontend
function mapPersonnelRow(row) {
  return {
    id: row.id,

    // 🔥 NUEVO MODELO
    firstName: row.first_name,
    secondName: row.second_name,
    firstLastName: row.first_last_name,
    secondLastName: row.second_last_name,
    fullName: row.full_name,

    documentType: row.document_type,
    documentNumber: row.document_number,

    birthDay: row.birth_day,
    birthMonth: row.birth_month,
    birthYear: row.birth_year,

    expeditionDay: row.expedition_day,
    expeditionMonth: row.expedition_month,
    expeditionYear: row.expedition_year,

    expeditionDepartment: row.expedition_department,
    expeditionMunicipality: row.expedition_municipality,

    nationality: row.nationality,
    biologicalSex: row.biological_sex,
    bloodType: row.blood_type,

    phone: row.phone,
    email: row.email,
    address: row.address,
    neighborhood: row.neighborhood,

    residenceCountry: row.residence_country,
    residenceDepartment: row.residence_department,
    residenceMunicipality: row.residence_municipality,
    residenceZone: row.residence_zone,

    civilStatus: row.civil_status,

    contractType: row.contract_type,
    startDate: row.start_date,
    eps: row.eps,
    pensionFund: row.pension_fund,
    compensationBox: row.compensation_box,
    arl: row.arl,

    educationLevel: row.education_level,
    degree: row.degree,
    degreeInstitution: row.degree_institution,
    degreeDate: row.degree_date,

    sisben: row.sisben,
    sisbenCategory: row.sisben_category,

    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,

    position: row.offered_position || "",
    companyId: row.company_id,
    contractId: row.contract_id,
    municipalityId: row.municipality_id,
    modality: row.modality,
    status: row.status,
  };
}

// 📥 LISTAR
async function getPersonnelFromDb() {
  const result = await pool.query(`
    SELECT * FROM employees
    ORDER BY id DESC
  `);

  return result.rows.map(mapPersonnelRow);
}

// ➕ CREAR
async function createPersonnelInDb(payload) {
  const fullName = buildFullName(payload);

  const result = await pool.query(
    `
    INSERT INTO employees (
      full_name,
      first_name,
      second_name,
      first_last_name,
      second_last_name,
      document_type,
      document_number,

      birth_day,
      birth_month,
      birth_year,

      expedition_day,
      expedition_month,
      expedition_year,

      expedition_department,
      expedition_municipality,

      nationality,
      biological_sex,
      blood_type,

      phone,
      email,
      address,
      neighborhood,

      residence_country,
      residence_department,
      residence_municipality,
      residence_zone,

      civil_status,

      contract_type,
      start_date,
      eps,
      pension_fund,
      compensation_box,
      arl,

      education_level,
      degree,
      degree_institution,
      degree_date,

      sisben,
      sisben_category,

      emergency_contact_name,
      emergency_contact_phone,

      offered_position,
      company_id,
      contract_id,
      municipality_id,
      modality,
      status
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,
      $8,$9,$10,
      $11,$12,$13,
      $14,$15,
      $16,$17,$18,
      $19,$20,$21,$22,
      $23,$24,$25,$26,
      $27,
      $28,$29,$30,$31,$32,$33,
      $34,$35,$36,$37,
      $38,$39,
      $40,$41,
      $42,$43,$44,$45,$46,$47
    )
    RETURNING *
    `,
    [
      fullName,
      payload.firstName,
      payload.secondName,
      payload.firstLastName,
      payload.secondLastName,
      payload.documentType,
      payload.documentNumber,

      payload.birthDay,
      payload.birthMonth,
      payload.birthYear,

      payload.expeditionDay,
      payload.expeditionMonth,
      payload.expeditionYear,

      payload.expeditionDepartment,
      payload.expeditionMunicipality,

      payload.nationality,
      payload.biologicalSex,
      payload.bloodType,

      payload.phone,
      payload.email,
      payload.address,
      payload.neighborhood,

      payload.residenceCountry,
      payload.residenceDepartment,
      payload.residenceMunicipality,
      payload.residenceZone,

      payload.civilStatus,

      payload.contractType,
      payload.startDate,
      payload.eps,
      payload.pensionFund,
      payload.compensationBox,
      payload.arl,

      payload.educationLevel,
      payload.degree,
      payload.degreeInstitution,
      payload.degreeDate,

      payload.sisben,
      payload.sisbenCategory,

      payload.emergencyContactName,
      payload.emergencyContactPhone,

      payload.position,
      payload.companyId,
      payload.contractId,
      payload.municipalityId,
      payload.modality,
      payload.status || "preingreso",
    ]
  );

  return mapPersonnelRow(result.rows[0]);
}

module.exports = {
  getPersonnelFromDb,
  createPersonnelInDb,
};