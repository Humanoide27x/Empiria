const pool = require("../../db/pool");

function mapPersonnelRow(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    documentNumber: row.document_number,
    position: row.offered_position || "",
    companyId: row.company_id,
    contractId: row.contract_id,
    municipality: String(row.municipality_id || ""),
    municipalityId: row.municipality_id,
    modality: row.modality || "",
    status: row.status || "activo",
  };
}

async function getPersonnelFromDb() {
  const result = await pool.query(`
    SELECT
      id,
      full_name,
      document_number,
      offered_position,
      company_id,
      contract_id,
      municipality_id,
      modality,
      status
    FROM employees
    ORDER BY id DESC
  `);

  return result.rows.map(mapPersonnelRow);
}

async function createPersonnelInDb(payload) {
  const result = await pool.query(
    `
    INSERT INTO employees (
      full_name,
      document_number,
      offered_position,
      company_id,
      contract_id,
      municipality_id,
      modality,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING
      id,
      full_name,
      document_number,
      offered_position,
      company_id,
      contract_id,
      municipality_id,
      modality,
      status
    `,
    [
      payload.fullName,
      String(payload.documentNumber),
      payload.position || "",
      Number(payload.companyId),
      Number(payload.contractId),
      payload.municipalityId ? Number(payload.municipalityId) : null,
      payload.modality || "",
      payload.status || "activo",
    ]
  );

  return mapPersonnelRow(result.rows[0]);
}

async function updatePersonnelInDb(personnelId, changes) {
  const currentResult = await pool.query(
    `
    SELECT
      id,
      full_name,
      document_number,
      offered_position,
      company_id,
      contract_id,
      municipality_id,
      modality,
      status
    FROM employees
    WHERE id = $1
    LIMIT 1
    `,
    [Number(personnelId)]
  );

  const current = currentResult.rows[0];

  if (!current) {
    throw new Error("Empleado no encontrado");
  }

  const next = {
    full_name: changes.fullName ?? current.full_name,
    document_number: changes.documentNumber ?? current.document_number,
    offered_position: changes.position ?? current.offered_position,
    company_id:
      changes.companyId != null ? Number(changes.companyId) : current.company_id,
    contract_id:
      changes.contractId != null ? Number(changes.contractId) : current.contract_id,
    municipality_id:
      changes.municipalityId != null
        ? Number(changes.municipalityId)
        : current.municipality_id,
    modality: changes.modality ?? current.modality,
    status: changes.status ?? current.status,
  };

  const result = await pool.query(
    `
    UPDATE employees
    SET
      full_name = $1,
      document_number = $2,
      offered_position = $3,
      company_id = $4,
      contract_id = $5,
      municipality_id = $6,
      modality = $7,
      status = $8,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $9
    RETURNING
      id,
      full_name,
      document_number,
      offered_position,
      company_id,
      contract_id,
      municipality_id,
      modality,
      status
    `,
    [
      next.full_name,
      String(next.document_number),
      next.offered_position,
      next.company_id,
      next.contract_id,
      next.municipality_id,
      next.modality,
      next.status,
      Number(personnelId),
    ]
  );

  return mapPersonnelRow(result.rows[0]);
}

async function removePersonnelFromDb(personnelId) {
  const result = await pool.query(
    `
    DELETE FROM employees
    WHERE id = $1
    RETURNING
      id,
      full_name,
      document_number,
      offered_position,
      company_id,
      contract_id,
      municipality_id,
      modality,
      status
    `,
    [Number(personnelId)]
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Empleado no encontrado");
  }

  return mapPersonnelRow(row);
}

module.exports = {
  getPersonnelFromDb,
  createPersonnelInDb,
  updatePersonnelInDb,
  removePersonnelFromDb,
};