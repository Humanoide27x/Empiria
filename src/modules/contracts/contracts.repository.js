const pool = require("../../db/pool");

async function getAllContracts() {
  const result = await pool.query(`
    SELECT id, name
    FROM contracts
    ORDER BY id ASC
  `);

  return result.rows;
}

module.exports = {
  getAllContracts,
};