"use strict";

const pool = require("../../../db/pool");

// Auto-migration: add salary_config column if it doesn't exist yet
pool.query(
  `ALTER TABLE contract_settings ADD COLUMN IF NOT EXISTS salary_config JSONB DEFAULT '{}'::jsonb`
).catch(err => console.warn("[migration] salary_config:", err.message));

async function listClients() {
  const { rows } = await pool.query(`
    SELECT
      c.id,
      c.name,
      c.nit,
      c.active,
      c.created_at,
      (
        SELECT COUNT(*)::int
        FROM companies sub
        WHERE sub.parent_company_id = c.id
      ) AS subcompanies_count,
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'id',     sub.id,
            'name',   sub.name,
            'nit',    sub.nit,
            'active', sub.active,
            'contracts', COALESCE((
              SELECT json_agg(
                json_build_object(
                  'id',         ct.id,
                  'name',       ct.name,
                  'code',       ct.code,
                  'active',     ct.active,
                  'start_date', ct.start_date,
                  'end_date',   ct.end_date,
                  'employees',  (SELECT COUNT(*)::int FROM employees e WHERE e.contract_id = ct.id)
                ) ORDER BY ct.id
              )
              FROM contracts ct WHERE ct.company_id = sub.id
            ), '[]'::json)
          )
          ORDER BY sub.name
        )
        FROM companies sub
        WHERE sub.parent_company_id = c.id
      ), '[]'::json) AS subcompanies_detail,
      (
        SELECT COUNT(*)::int
        FROM contracts ct
        WHERE ct.company_id = c.id
      ) AS contracts_count,
      (
        SELECT COUNT(*)::int
        FROM employees e
        WHERE e.company_id = c.id
      ) AS employees_count,
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'id',         ct.id,
            'name',       ct.name,
            'code',       ct.code,
            'active',     ct.active,
            'start_date', ct.start_date,
            'end_date',   ct.end_date,
            'employees',  (
              SELECT COUNT(*)::int FROM employees e WHERE e.contract_id = ct.id
            )
          ) ORDER BY ct.id
        )
        FROM contracts ct
        WHERE ct.company_id = c.id
      ), '[]'::json) AS contracts_detail
    FROM companies c
    WHERE c.parent_company_id IS NULL
    ORDER BY c.active DESC, c.name
  `);
  return rows;
}

async function getClientById(id) {
  const { rows } = await pool.query(`
    SELECT
      c.*,
      (SELECT COUNT(*)::int FROM companies sub WHERE sub.parent_company_id = c.id) AS subcompanies_count,
      (SELECT COUNT(*)::int FROM contracts ct WHERE ct.company_id = c.id) AS contracts_count,
      (SELECT COUNT(*)::int FROM employees e WHERE e.company_id = c.id) AS employees_count
    FROM companies c
    WHERE c.id = $1
  `, [id]);
  return rows[0] || null;
}

async function createClient({ name, nit }) {
  const { rows } = await pool.query(`
    INSERT INTO companies (name, nit, active, tenant_id)
    VALUES ($1, $2, true, 1)
    RETURNING *
  `, [name.trim(), nit ? nit.trim() : null]);
  return rows[0];
}

async function updateClient(id, { name, nit, active }) {
  const fields = [];
  const values = [];
  let i = 1;

  if (name   !== undefined) { fields.push(`name   = $${i++}`); values.push(name.trim()); }
  if (nit    !== undefined) { fields.push(`nit    = $${i++}`); values.push(nit ? nit.trim() : null); }
  if (active !== undefined) { fields.push(`active = $${i++}`); values.push(Boolean(active)); }

  if (!fields.length) throw new Error("Nada que actualizar");

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE companies SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] || null;
}

// ── Contract basic CRUD ───────────────────────────────────────────────────────

async function createContract({ company_id, name, code, start_date, end_date }) {
  const { rows } = await pool.query(`
    INSERT INTO contracts (company_id, name, code, active, start_date, end_date)
    VALUES ($1, $2, $3, true, $4, $5)
    RETURNING *
  `, [company_id, name.trim(), code ? code.trim() : null, start_date || null, end_date || null]);
  return rows[0];
}

async function updateContract(id, { name, code, active, start_date, end_date }) {
  const fields = [];
  const values = [];
  let i = 1;

  if (name       !== undefined) { fields.push(`name       = $${i++}`); values.push(name.trim()); }
  if (code       !== undefined) { fields.push(`code       = $${i++}`); values.push(code ? code.trim() : null); }
  if (active     !== undefined) { fields.push(`active     = $${i++}`); values.push(Boolean(active)); }
  if (start_date !== undefined) { fields.push(`start_date = $${i++}`); values.push(start_date || null); }
  if (end_date   !== undefined) { fields.push(`end_date   = $${i++}`); values.push(end_date || null); }

  if (!fields.length) throw new Error("Nada que actualizar");

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE contracts SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] || null;
}

// ── Contract configuration (settings + positions as JSONB) ────────────────────

async function getContractConfig(id) {
  const { rows } = await pool.query(`
    SELECT
      ct.id, ct.name, ct.code, ct.active,
      ct.start_date, ct.end_date,
      json_build_object('id', co.id, 'name', co.name) AS company,
      CASE WHEN cs.contract_id IS NOT NULL
        THEN json_build_object(
               'position_mode',    cs.position_mode,
               'modules',          cs.modules,
               'positions',        cs.positions,
               'role_permissions', cs.role_permissions,
               'salary_config',    COALESCE(cs.salary_config, '{}'::jsonb))
        ELSE json_build_object(
               'position_mode',    'licitacion',
               'modules',          '{}'::jsonb,
               'positions',        '[]'::jsonb,
               'role_permissions', '{}'::jsonb,
               'salary_config',    '{}'::jsonb)
      END AS settings
    FROM contracts ct
    JOIN  companies co        ON co.id = ct.company_id
    LEFT JOIN contract_settings cs ON cs.contract_id = ct.id
    WHERE ct.id = $1
  `, [id]);
  return rows[0] || null;
}

async function upsertContractSettings(contractId, { position_mode, modules, positions, role_permissions, salary_config }) {
  const { rows } = await pool.query(`
    INSERT INTO contract_settings (contract_id, position_mode, modules, positions, role_permissions, salary_config, updated_at)
    VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, COALESCE($6::jsonb, '{}'::jsonb), NOW())
    ON CONFLICT (contract_id) DO UPDATE
      SET position_mode    = EXCLUDED.position_mode,
          modules          = EXCLUDED.modules,
          positions        = EXCLUDED.positions,
          role_permissions = EXCLUDED.role_permissions,
          salary_config    = COALESCE(EXCLUDED.salary_config, contract_settings.salary_config),
          updated_at       = NOW()
    RETURNING *
  `, [
    contractId,
    position_mode || 'licitacion',
    JSON.stringify(modules          || {}),
    JSON.stringify(positions        || []),
    JSON.stringify(role_permissions || {}),
    salary_config != null ? JSON.stringify(salary_config) : null,
  ]);
  return rows[0];
}

async function getSalaryConfig(contractId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(salary_config, '{}'::jsonb) AS salary_config
     FROM contract_settings WHERE contract_id = $1`,
    [contractId]
  );
  return rows[0]?.salary_config || {};
}

async function upsertSalaryConfigOnly(contractId, salaryConfig) {
  const { rows } = await pool.query(`
    INSERT INTO contract_settings
      (contract_id, position_mode, modules, positions, role_permissions, salary_config, updated_at)
    VALUES ($1, 'licitacion', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, $2::jsonb, NOW())
    ON CONFLICT (contract_id) DO UPDATE
      SET salary_config = EXCLUDED.salary_config,
          updated_at    = NOW()
    RETURNING salary_config
  `, [contractId, JSON.stringify(salaryConfig || {})]);
  return rows[0]?.salary_config || {};
}

// ── Contract users ────────────────────────────────────────────────────────────

const crypto = require("crypto");

async function getContractUsers(contractId) {
  const { rows } = await pool.query(`
    SELECT id, username, full_name, role_code, active, created_at
    FROM users
    WHERE contract_id = $1
    ORDER BY active DESC, full_name
  `, [contractId]);
  return rows;
}

async function createContractUser(contractId, { name, username, password, role }) {
  const hash = crypto.createHash("sha256").update(String(password)).digest("hex");

  const roleRow = await pool.query(
    "SELECT id FROM roles WHERE LOWER(code) = LOWER($1) LIMIT 1", [role]
  );
  const roleId = roleRow.rows[0]?.id || null;

  const ctRow = await pool.query(
    "SELECT company_id FROM contracts WHERE id = $1", [contractId]
  );
  const companyId = ctRow.rows[0]?.company_id || null;

  const { rows } = await pool.query(`
    INSERT INTO users (username, password_hash, full_name, role_id, role_code, company_id, contract_id, tenant_id, active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 1, true)
    RETURNING id, username, full_name, role_code, active, created_at
  `, [
    String(username).trim().toLowerCase(),
    hash,
    String(name).trim(),
    roleId,
    String(role).toLowerCase(),
    companyId,
    contractId,
  ]);
  return rows[0];
}

async function updateContractUser(userId, { name, username, password, role, active }) {
  const fields = [];
  const values = [];
  let i = 1;

  if (name     !== undefined) { fields.push(`full_name = $${i++}`); values.push(String(name).trim()); }
  if (username !== undefined) { fields.push(`username  = $${i++}`); values.push(String(username).trim().toLowerCase()); }
  if (password) {
    const hash = crypto.createHash("sha256").update(String(password)).digest("hex");
    fields.push(`password_hash = $${i++}`);
    values.push(hash);
  }
  if (role !== undefined) {
    const roleRow = await pool.query(
      "SELECT id FROM roles WHERE LOWER(code) = LOWER($1) LIMIT 1", [role]
    );
    if (roleRow.rows[0]) {
      fields.push(`role_id   = $${i++}`); values.push(roleRow.rows[0].id);
      fields.push(`role_code = $${i++}`); values.push(String(role).toLowerCase());
    }
  }
  if (active !== undefined) { fields.push(`active = $${i++}`); values.push(Boolean(active)); }

  if (!fields.length) throw new Error("Nada que actualizar");

  fields.push(`updated_at = NOW()`);
  values.push(Number(userId));

  const { rows } = await pool.query(
    `UPDATE users SET ${fields.join(", ")} WHERE id = $${i} RETURNING id, username, full_name, role_code, active`,
    values
  );
  return rows[0] || null;
}

module.exports = {
  listClients, getClientById, createClient, updateClient,
  createContract, updateContract,
  getContractConfig, upsertContractSettings,
  getSalaryConfig, upsertSalaryConfigOnly,
  getContractUsers, createContractUser, updateContractUser,
};
