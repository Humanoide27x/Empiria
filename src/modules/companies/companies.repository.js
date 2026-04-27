const pool = require("../../db/pool");

async function getAllCompanies(tenantId) {
  const values = [];
  let where = "";

  if (tenantId) {
    values.push(tenantId);
    where = `WHERE tenant_id = $${values.length}`;
  }

  const result = await pool.query(
    `
    SELECT id, tenant_id, name, nit, active, created_at
    FROM companies
    ${where}
    ORDER BY id ASC
    `,
    values
  );

  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    tenant_id: row.tenant_id,
    name: row.name,
    nit: row.nit || "",
    active: row.active !== false,
    createdAt: row.created_at || null,
  }));
}

module.exports = {
  getAllCompanies,
};
