const pool = require("./pool");

// =============================
// ROLES
// =============================
async function getRolesFromDb() {
  try {
    const result = await pool.query(`
      SELECT id, code, name, active
      FROM roles
      ORDER BY id
    `);

    return result.rows;
  } catch (error) {
    console.error("Error consultando roles:", error);
    throw error;
  }
}

// =============================
// COMPANIES
// =============================
async function getCompaniesFromDb() {
  try {
    const result = await pool.query(`
      SELECT id, name, nit, active, created_at
      FROM companies
      ORDER BY id
    `);

    return result.rows;
  } catch (error) {
    console.error("Error consultando empresas:", error);
    throw error;
  }
}

module.exports = {
  getRolesFromDb,
  getCompaniesFromDb,
};