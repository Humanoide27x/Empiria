const pool = require("../../db/pool");

async function getAllCompanies() {
  const result = await pool.query(`
    SELECT id, name
    FROM companies
    ORDER BY id ASC
  `);

  return result.rows;
}

module.exports = {
  getAllCompanies,
};