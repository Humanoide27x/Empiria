const pool = require("../../db/pool");

function mapContractRow(row) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    tenantId: row.tenant_id,
    company_id: row.company_id,
    companyId: row.company_id,
    name: row.name,
    code: row.code || "",
    start_date: row.start_date || null,
    startDate: row.start_date || null,
    end_date: row.end_date || null,
    endDate: row.end_date || null,
    active: Boolean(row.active),
    created_at: row.created_at || null,
    createdAt: row.created_at || null,
  };
}

async function getAllContracts(tenantId, companyId = null) {
  const values = [];
  const conditions = ["active = true"];

  if (tenantId) {
    values.push(tenantId);
    conditions.push(`tenant_id = $${values.length}`);
  }

  if (companyId) {
    values.push(companyId);
    conditions.push(`company_id = $${values.length}`);
  }

  const result = await pool.query(
    `
    SELECT id, tenant_id, company_id, name, code, start_date, end_date, active, created_at
    FROM contracts
    WHERE ${conditions.join(" AND ")}
    ORDER BY id
    `,
    values
  );

  return result.rows.map(mapContractRow);
}

async function getContractPositions(contractId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(positions, '[]'::jsonb) AS positions
     FROM contract_settings WHERE contract_id = $1`,
    [contractId]
  );
  const raw = rows[0]?.positions;
  return Array.isArray(raw) ? raw : [];
}

module.exports = {
  getAllContracts,
  getContractPositions,
};
