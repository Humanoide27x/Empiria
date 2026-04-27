const pool = require("./pool");

// =============================
// ROLES
// =============================
async function getRolesFromDb() {
  const result = await pool.query(`
    SELECT id, code, name, active
    FROM roles
    ORDER BY id
  `);
  return result.rows;
}

// =============================
// COMPANIES
// =============================
async function getCompaniesFromDb() {
  const result = await pool.query(`
    SELECT id, name, nit, active, created_at
    FROM companies
    ORDER BY id
  `);
  return result.rows;
}

// =============================
// USERS (PREPARADO PARA MIGRACIÓN)
// =============================
async function getUserByUsername(username) {
  const result = await pool.query(
    `SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
    [username]
  );

  return result.rows[0] || null;
}

async function getUserById(id) {
  const result = await pool.query(
    `SELECT * FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );

  return result.rows[0] || null;
}

async function createUserDb(user) {
  const result = await pool.query(
    `INSERT INTO users 
    (username, password_hash, name, role, company_id, contract_id, assigned_municipalities, mfa_enabled, mfa_secret)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING *`,
    [
      user.username,
      user.passwordHash,
      user.name,
      user.role,
      user.companyId,
      user.contractId,
      user.assignedMunicipalities,
      user.mfaEnabled || false,
      user.mfaSecret || null,
    ]
  );

  return result.rows[0];
}

module.exports = {
  getRolesFromDb,
  getCompaniesFromDb,
  getUserByUsername,
  getUserById,
  createUserDb,
};