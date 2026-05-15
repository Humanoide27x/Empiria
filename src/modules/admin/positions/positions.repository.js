"use strict";

const pool = require("../../../db/pool");

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toBool(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  if (s === "true"  || s === "1" || s === "yes" || s === "si") return true;
  if (s === "false" || s === "0" || s === "no")                return false;
  return def;
}

function safe(v) { return v === undefined || v === null ? "" : String(v).trim(); }

const VALID_CATEGORIES = ["OFERTA", "EXTRA", "ADMINISTRATIVO", "OPERATIVO", "PROFESIONAL"];
const VALID_SALARY_TYPES = ["mensual", "diario", "por_hora", "prestacion_servicios"];

function mapPosition(row) {
  return {
    id:              row.id,
    companyId:       row.company_id,
    companyName:     row.company_name || "",
    contractId:      row.contract_id,
    contractName:    row.contract_name || "",
    name:            row.name,
    area:            row.area || "",
    profileLevel:    row.profile_level || "",
    positionType:    row.position_type || "",
    category:        row.category || "",
    appliesCoverage: row.applies_coverage,
    active:          row.active,
    createdBy:       row.created_by,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  };
}

function mapProfile(row) {
  return {
    id:              row.id,
    positionId:      row.position_id,
    objective:       row.objective || "",
    mainFunctions:   row.main_functions || "",
    educationReq:    row.education_req || "",
    minExperience:   row.min_experience || "",
    certifications:  row.certifications || "",
    responsibilities: row.responsibilities || "",
    observations:    row.observations || "",
    updatedAt:       row.updated_at,
  };
}

function mapPayrollValue(row) {
  return {
    id:                    row.id,
    positionId:            row.position_id,
    baseSalary:            Number(row.base_salary),
    transportAllowance:    Number(row.transport_allowance),
    salaryType:            row.salary_type,
    dayValue:              row.day_value !== null ? Number(row.day_value) : null,
    hourValue:             row.hour_value !== null ? Number(row.hour_value) : null,
    fixedBonus:            Number(row.fixed_bonus),
    sundaySurcharge:       Number(row.sunday_surcharge),
    appliesBenefits:       row.applies_benefits,
    appliesSocialSecurity: row.applies_social_security,
    validFrom:             row.valid_from,
    validUntil:            row.valid_until,
    active:                row.active,
    notes:                 row.notes || "",
    createdAt:             row.created_at,
    updatedAt:             row.updated_at,
  };
}

function mapDocReq(row) {
  return {
    id:             row.id,
    positionId:     row.position_id,
    documentTypeId: row.document_type_id,
    documentName:   row.doc_name || "",
    documentCode:   row.doc_code || "",
    required:       row.required,
    notes:          row.notes || "",
    createdAt:      row.created_at,
  };
}

// ─────────────────────────────────────────────
// POSITIONS — CRUD
// ─────────────────────────────────────────────

async function listPositions(filters = {}) {
  const parts = [];
  const vals  = [];

  if (filters.companyId) {
    vals.push(toInt(filters.companyId));
    parts.push(`p.company_id = $${vals.length}`);
  }
  if (filters.contractId) {
    vals.push(toInt(filters.contractId));
    parts.push(`p.contract_id = $${vals.length}`);
  }
  if (typeof filters.active === "boolean") {
    vals.push(filters.active);
    parts.push(`p.active = $${vals.length}`);
  }
  if (filters.area) {
    vals.push(`%${safe(filters.area)}%`);
    parts.push(`p.area ILIKE $${vals.length}`);
  }
  if (filters.category) {
    vals.push(safe(filters.category).toUpperCase());
    parts.push(`p.category = $${vals.length}`);
  }
  if (filters.search) {
    vals.push(`%${safe(filters.search)}%`);
    parts.push(`p.name ILIKE $${vals.length}`);
  }

  const where = parts.length ? `WHERE ${parts.join(" AND ")}` : "";

  const r = await pool.query(
    `SELECT
       p.*,
       c.name  AS company_name,
       ct.name AS contract_name
     FROM positions p
     LEFT JOIN companies c  ON c.id  = p.company_id
     LEFT JOIN contracts ct ON ct.id = p.contract_id
     ${where}
     ORDER BY p.company_id, p.name`,
    vals
  );

  return r.rows.map(mapPosition);
}

async function getPositionById(id) {
  const r = await pool.query(
    `SELECT
       p.*,
       c.name  AS company_name,
       ct.name AS contract_name
     FROM positions p
     LEFT JOIN companies c  ON c.id  = p.company_id
     LEFT JOIN contracts ct ON ct.id = p.contract_id
     WHERE p.id = $1`,
    [toInt(id)]
  );
  return r.rows[0] ? mapPosition(r.rows[0]) : null;
}

async function createPosition(data, userId) {
  const companyId = toInt(data.companyId || data.company_id);
  if (!companyId) throw new Error("company_id es obligatorio");
  if (!safe(data.name)) throw new Error("El nombre del cargo es obligatorio");

  const category = safe(data.category).toUpperCase();
  if (category && !VALID_CATEGORIES.includes(category)) {
    throw new Error(`Categoría inválida. Válidas: ${VALID_CATEGORIES.join(", ")}`);
  }

  const r = await pool.query(
    `INSERT INTO positions
      (company_id, contract_id, name, area, profile_level, position_type,
       category, applies_coverage, active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      companyId,
      toInt(data.contractId || data.contract_id) || null,
      safe(data.name),
      safe(data.area) || null,
      safe(data.profileLevel || data.profile_level) || null,
      safe(data.positionType || data.position_type) || null,
      category || null,
      toBool(data.appliesCoverage ?? data.applies_coverage, false),
      toBool(data.active, true),
      toInt(userId) || null,
    ]
  );

  // Auto-create empty profile row
  await pool.query(
    `INSERT INTO position_profiles (position_id) VALUES ($1) ON CONFLICT (position_id) DO NOTHING`,
    [r.rows[0].id]
  );

  return getPositionById(r.rows[0].id);
}

async function updatePosition(id, data) {
  const pos = await getPositionById(id);
  if (!pos) throw new Error("Cargo no encontrado");

  const category = data.category ? safe(data.category).toUpperCase() : pos.category;
  if (category && !VALID_CATEGORIES.includes(category)) {
    throw new Error(`Categoría inválida. Válidas: ${VALID_CATEGORIES.join(", ")}`);
  }

  await pool.query(
    `UPDATE positions SET
       name             = $2,
       area             = $3,
       profile_level    = $4,
       position_type    = $5,
       category         = $6,
       applies_coverage = $7,
       active           = $8,
       contract_id      = $9
     WHERE id = $1`,
    [
      toInt(id),
      safe(data.name) || pos.name,
      safe(data.area) || null,
      safe(data.profileLevel || data.profile_level) || null,
      safe(data.positionType || data.position_type) || null,
      category || null,
      toBool(data.appliesCoverage ?? data.applies_coverage, pos.appliesCoverage),
      toBool(data.active, pos.active),
      toInt(data.contractId || data.contract_id) || null,
    ]
  );

  return getPositionById(id);
}

async function setPositionStatus(id, active) {
  const pos = await getPositionById(id);
  if (!pos) throw new Error("Cargo no encontrado");
  await pool.query(`UPDATE positions SET active = $2 WHERE id = $1`, [toInt(id), Boolean(active)]);
  return getPositionById(id);
}

// ─────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────

async function getProfile(positionId) {
  const r = await pool.query(
    `SELECT * FROM position_profiles WHERE position_id = $1`,
    [toInt(positionId)]
  );
  if (r.rows[0]) return mapProfile(r.rows[0]);
  // Create empty profile if missing
  await pool.query(
    `INSERT INTO position_profiles (position_id) VALUES ($1) ON CONFLICT (position_id) DO NOTHING`,
    [toInt(positionId)]
  );
  const r2 = await pool.query(`SELECT * FROM position_profiles WHERE position_id = $1`, [toInt(positionId)]);
  return r2.rows[0] ? mapProfile(r2.rows[0]) : null;
}

async function upsertProfile(positionId, data) {
  const pos = await getPositionById(positionId);
  if (!pos) throw new Error("Cargo no encontrado");

  await pool.query(
    `INSERT INTO position_profiles
      (position_id, objective, main_functions, education_req,
       min_experience, certifications, responsibilities, observations)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (position_id) DO UPDATE SET
       objective        = EXCLUDED.objective,
       main_functions   = EXCLUDED.main_functions,
       education_req    = EXCLUDED.education_req,
       min_experience   = EXCLUDED.min_experience,
       certifications   = EXCLUDED.certifications,
       responsibilities = EXCLUDED.responsibilities,
       observations     = EXCLUDED.observations,
       updated_at       = NOW()`,
    [
      toInt(positionId),
      safe(data.objective) || null,
      safe(data.mainFunctions || data.main_functions) || null,
      safe(data.educationReq || data.education_req) || null,
      safe(data.minExperience || data.min_experience) || null,
      safe(data.certifications) || null,
      safe(data.responsibilities) || null,
      safe(data.observations) || null,
    ]
  );

  return getProfile(positionId);
}

// ─────────────────────────────────────────────
// PAYROLL VALUES
// ─────────────────────────────────────────────

async function listPayrollValues(positionId) {
  const r = await pool.query(
    `SELECT * FROM position_payroll_values WHERE position_id = $1 ORDER BY created_at DESC`,
    [toInt(positionId)]
  );
  return r.rows.map(mapPayrollValue);
}

async function getPayrollValueById(id) {
  const r = await pool.query(`SELECT * FROM position_payroll_values WHERE id = $1`, [toInt(id)]);
  return r.rows[0] ? mapPayrollValue(r.rows[0]) : null;
}

async function createPayrollValue(positionId, data, userId) {
  const pos = await getPositionById(positionId);
  if (!pos) throw new Error("Cargo no encontrado");

  const salaryType = safe(data.salaryType || data.salary_type) || "mensual";
  if (!VALID_SALARY_TYPES.includes(salaryType)) {
    throw new Error(`Tipo de salario inválido. Válidos: ${VALID_SALARY_TYPES.join(", ")}`);
  }

  const baseSalary = Number(data.baseSalary || data.base_salary) || 0;

  const r = await pool.query(
    `INSERT INTO position_payroll_values
      (position_id, base_salary, transport_allowance, salary_type,
       day_value, hour_value, fixed_bonus, sunday_surcharge,
       applies_benefits, applies_social_security,
       valid_from, valid_until, active, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id`,
    [
      toInt(positionId),
      baseSalary,
      Number(data.transportAllowance || data.transport_allowance) || 0,
      salaryType,
      data.dayValue  || data.day_value  ? Number(data.dayValue  || data.day_value)  : null,
      data.hourValue || data.hour_value ? Number(data.hourValue || data.hour_value) : null,
      Number(data.fixedBonus  || data.fixed_bonus)   || 0,
      Number(data.sundaySurcharge || data.sunday_surcharge) || 0,
      toBool(data.appliesBenefits ?? data.applies_benefits, true),
      toBool(data.appliesSocialSecurity ?? data.applies_social_security, true),
      data.validFrom  || data.valid_from  || null,
      data.validUntil || data.valid_until || null,
      toBool(data.active, true),
      safe(data.notes) || null,
      toInt(userId) || null,
    ]
  );

  return getPayrollValueById(r.rows[0].id);
}

async function updatePayrollValue(id, data) {
  const existing = await getPayrollValueById(id);
  if (!existing) throw new Error("Valor de nómina no encontrado");

  const salaryType = data.salaryType || data.salary_type ? safe(data.salaryType || data.salary_type) : existing.salaryType;
  if (!VALID_SALARY_TYPES.includes(salaryType)) {
    throw new Error(`Tipo de salario inválido. Válidos: ${VALID_SALARY_TYPES.join(", ")}`);
  }

  await pool.query(
    `UPDATE position_payroll_values SET
       base_salary             = $2,
       transport_allowance     = $3,
       salary_type             = $4,
       day_value               = $5,
       hour_value              = $6,
       fixed_bonus             = $7,
       sunday_surcharge        = $8,
       applies_benefits        = $9,
       applies_social_security = $10,
       valid_from              = $11,
       valid_until             = $12,
       active                  = $13,
       notes                   = $14
     WHERE id = $1`,
    [
      toInt(id),
      Number(data.baseSalary || data.base_salary) || existing.baseSalary,
      Number(data.transportAllowance || data.transport_allowance) ?? existing.transportAllowance,
      salaryType,
      data.dayValue  || data.day_value  ? Number(data.dayValue  || data.day_value)  : existing.dayValue,
      data.hourValue || data.hour_value ? Number(data.hourValue || data.hour_value) : existing.hourValue,
      Number(data.fixedBonus  || data.fixed_bonus)   ?? existing.fixedBonus,
      Number(data.sundaySurcharge || data.sunday_surcharge) ?? existing.sundaySurcharge,
      toBool(data.appliesBenefits ?? data.applies_benefits, existing.appliesBenefits),
      toBool(data.appliesSocialSecurity ?? data.applies_social_security, existing.appliesSocialSecurity),
      data.validFrom  || data.valid_from  || existing.validFrom  || null,
      data.validUntil || data.valid_until || existing.validUntil || null,
      toBool(data.active, existing.active),
      data.notes !== undefined ? safe(data.notes) : existing.notes,
    ]
  );

  return getPayrollValueById(id);
}

async function setPayrollValueStatus(id, active) {
  const existing = await getPayrollValueById(id);
  if (!existing) throw new Error("Valor de nómina no encontrado");
  await pool.query(`UPDATE position_payroll_values SET active = $2 WHERE id = $1`, [toInt(id), Boolean(active)]);
  return getPayrollValueById(id);
}

// ─────────────────────────────────────────────
// DOCUMENT REQUIREMENTS
// ─────────────────────────────────────────────

async function listDocumentRequirements(positionId) {
  const r = await pool.query(
    `SELECT pdr.*,
            dt.name AS doc_name,
            dt.code AS doc_code
     FROM position_document_requirements pdr
     LEFT JOIN document_types dt ON dt.id = pdr.document_type_id
     WHERE pdr.position_id = $1
     ORDER BY dt.name`,
    [toInt(positionId)]
  );
  return r.rows.map(mapDocReq);
}

async function upsertDocumentRequirement(positionId, documentTypeId, data) {
  const pos = await getPositionById(positionId);
  if (!pos) throw new Error("Cargo no encontrado");
  if (!toInt(documentTypeId)) throw new Error("document_type_id inválido");

  await pool.query(
    `INSERT INTO position_document_requirements
      (position_id, document_type_id, required, notes)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (position_id, document_type_id) DO UPDATE SET
       required = EXCLUDED.required,
       notes    = EXCLUDED.notes`,
    [
      toInt(positionId),
      toInt(documentTypeId),
      toBool(data?.required, true),
      safe(data?.notes) || null,
    ]
  );

  return listDocumentRequirements(positionId);
}

async function removeDocumentRequirement(id) {
  const r = await pool.query(
    `DELETE FROM position_document_requirements WHERE id = $1 RETURNING id`,
    [toInt(id)]
  );
  if (!r.rows[0]) throw new Error("Requisito documental no encontrado");
  return { deleted: true, id: r.rows[0].id };
}

// ─────────────────────────────────────────────
// Catálogo de tipos de documento (para selector en UI)
// ─────────────────────────────────────────────

async function listDocumentTypes() {
  const r = await pool.query(
    `SELECT id, code, name, phase FROM document_types WHERE active = true ORDER BY name`
  );
  return r.rows.map(row => ({
    id: row.id, code: row.code, name: row.name, phase: row.phase,
  }));
}

module.exports = {
  listPositions,
  getPositionById,
  createPosition,
  updatePosition,
  setPositionStatus,
  getProfile,
  upsertProfile,
  listPayrollValues,
  getPayrollValueById,
  createPayrollValue,
  updatePayrollValue,
  setPayrollValueStatus,
  listDocumentRequirements,
  upsertDocumentRequirement,
  removeDocumentRequirement,
  listDocumentTypes,
  VALID_CATEGORIES,
  VALID_SALARY_TYPES,
};
