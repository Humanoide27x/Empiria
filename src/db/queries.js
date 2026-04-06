const { pool } = require("./pool");

async function getRolesFromDb() {
  const result = await pool.query(`
    SELECT id, code, name, active
    FROM roles
    ORDER BY id
  `);

  return result.rows;
}

async function getCompaniesFromDb() {
  const result = await pool.query(`
    SELECT id, name, nit, active, created_at
    FROM companies
    ORDER BY id
  `);

  return result.rows;
}

module.exports = {
  getRolesFromDb,
  getCompaniesFromDb,
};