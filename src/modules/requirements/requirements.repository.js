const pool = require("../../db/pool");

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function safeString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeCode(value) {
  return safeString(value)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mapContractPosition(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    company_id: row.company_id,
    contractId: row.contract_id,
    contract_id: row.contract_id,
    name: row.name,
    nombre: row.name,
    category: row.category || "OFERTA",
    categoria: row.category || "OFERTA",
    countsForCoverage: row.counts_for_coverage !== false,
    counts_for_coverage: row.counts_for_coverage !== false,
    active: row.active !== false,
  };
}

function mapDocumentType(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nombre: row.name,
    phase: row.phase,
    fase: row.phase,
    required: row.required === true,
    requiredByDefault: row.required === true,
    visibleToAuditor: row.visible_to_auditor === true,
    active: row.active !== false,
  };
}

async function listContractPositions(filters = {}) {
  const values = [];
  const conditions = ["cp.active = true"];

  if (filters.companyId) {
    values.push(Number(filters.companyId));
    conditions.push(`cp.company_id = $${values.length}`);
  }

  if (filters.contractId) {
    values.push(Number(filters.contractId));
    conditions.push(`cp.contract_id = $${values.length}`);
  }

  if (filters.category) {
    values.push(safeString(filters.category).toUpperCase());
    conditions.push(`UPPER(cp.category) = $${values.length}`);
  }

  const result = await pool.query(
    `
    SELECT cp.*
    FROM contract_positions cp
    WHERE ${conditions.join(" AND ")}
    ORDER BY cp.category ASC, cp.name ASC
    `,
    values
  );

  return result.rows.map(mapContractPosition);
}

async function createContractPosition(payload = {}) {
  const companyId = toNumberOrNull(payload.companyId || payload.company_id);
  const contractId = toNumberOrNull(payload.contractId || payload.contract_id);
  const name = safeString(payload.name || payload.nombre);
  const category = safeString(payload.category || payload.categoria || "OFERTA").toUpperCase();
  const countsForCoverage = payload.countsForCoverage ?? payload.counts_for_coverage ?? category === "OFERTA";

  if (!companyId) throw new Error("La empresa es obligatoria");
  if (!contractId) throw new Error("El contrato es obligatorio");
  if (!name) throw new Error("El nombre del cargo es obligatorio");

  const result = await pool.query(
    `
    INSERT INTO contract_positions (
      company_id,
      contract_id,
      name,
      category,
      counts_for_coverage,
      active
    )
    VALUES ($1, $2, $3, $4, $5, true)
    ON CONFLICT (contract_id, name, category)
    DO UPDATE SET
      company_id = EXCLUDED.company_id,
      counts_for_coverage = EXCLUDED.counts_for_coverage,
      active = true,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [companyId, contractId, name, category, Boolean(countsForCoverage)]
  );

  return mapContractPosition(result.rows[0]);
}

async function updateContractPosition(id, payload = {}) {
  const name = safeString(payload.name || payload.nombre);
  const category = safeString(payload.category || payload.categoria || "").toUpperCase();
  const countsForCoverage = payload.countsForCoverage ?? payload.counts_for_coverage;

  const current = await pool.query(`SELECT * FROM contract_positions WHERE id = $1`, [id]);
  if (!current.rows[0]) return null;

  const result = await pool.query(
    `
    UPDATE contract_positions SET
      name = COALESCE(NULLIF($2, ''), name),
      category = COALESCE(NULLIF($3, ''), category),
      counts_for_coverage = COALESCE($4, counts_for_coverage),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
    `,
    [Number(id), name, category, countsForCoverage === undefined ? null : Boolean(countsForCoverage)]
  );

  return mapContractPosition(result.rows[0]);
}

async function disableContractPosition(id) {
  const result = await pool.query(
    `UPDATE contract_positions SET active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [Number(id)]
  );
  return result.rowCount > 0;
}

async function listDocumentTypes(filters = {}) {
  const values = [];
  const conditions = ["active = true"];

  if (filters.phase) {
    values.push(safeString(filters.phase));
    conditions.push(`phase = $${values.length}`);
  }

  const result = await pool.query(
    `SELECT * FROM document_types WHERE ${conditions.join(" AND ")} ORDER BY phase ASC, name ASC`,
    values
  );

  return result.rows.map(mapDocumentType);
}

async function createDocumentType(payload = {}) {
  const name = safeString(payload.name || payload.nombre);
  const code = safeString(payload.code || payload.codigo || normalizeCode(name));
  const phase = safeString(payload.phase || payload.fase || "hoja_vida");
  const visibleToAuditor = payload.visibleToAuditor ?? payload.visible_to_auditor ?? false;

  if (!name) throw new Error("El nombre del documento es obligatorio");

  const result = await pool.query(
    `
    INSERT INTO document_types (code, name, phase, required, visible_to_auditor, active)
    VALUES ($1, $2, $3, false, $4, true)
    ON CONFLICT (code)
    DO UPDATE SET
      name = EXCLUDED.name,
      phase = EXCLUDED.phase,
      visible_to_auditor = EXCLUDED.visible_to_auditor,
      active = true
    RETURNING *
    `,
    [code, name, phase, Boolean(visibleToAuditor)]
  );

  return mapDocumentType(result.rows[0]);
}

async function listPositionDocuments(contractPositionId) {
  const result = await pool.query(
    `
    SELECT
      cpd.id,
      cpd.contract_position_id,
      cpd.document_type_id,
      cpd.required,
      cpd.expires,
      cpd.alert_days_before_expiration,
      dt.code,
      dt.name,
      dt.phase,
      dt.visible_to_auditor,
      dt.active
    FROM contract_position_documents cpd
    INNER JOIN document_types dt ON dt.id = cpd.document_type_id
    WHERE cpd.contract_position_id = $1
      AND dt.active = true
    ORDER BY dt.phase ASC, dt.name ASC
    `,
    [Number(contractPositionId)]
  );

  return result.rows.map((row) => ({
    id: row.id,
    contractPositionId: row.contract_position_id,
    documentTypeId: row.document_type_id,
    required: row.required === true,
    expires: row.expires === true,
    alertDaysBeforeExpiration: row.alert_days_before_expiration,
    document: mapDocumentType(row),
  }));
}

async function savePositionDocuments(contractPositionId, documents = []) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM contract_position_documents WHERE contract_position_id = $1`,
      [Number(contractPositionId)]
    );

    for (const item of documents) {
      const documentTypeId = toNumberOrNull(item.documentTypeId || item.document_type_id || item.id);
      if (!documentTypeId) continue;

      await client.query(
        `
        INSERT INTO contract_position_documents (
          contract_position_id,
          document_type_id,
          required,
          expires,
          alert_days_before_expiration
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          Number(contractPositionId),
          documentTypeId,
          item.required !== false,
          item.expires === true,
          toNumberOrNull(item.alertDaysBeforeExpiration || item.alert_days_before_expiration),
        ]
      );
    }

    await client.query("COMMIT");
    return await listPositionDocuments(contractPositionId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getEmployeeDocumentRequirements(employeeId) {
  const employeeResult = await pool.query(
    `
    SELECT
      e.*,
      CASE
        WHEN e.presented_in_offer = true THEN COALESCE(NULLIF(e.offered_position, ''), NULLIF(e.offer_position, ''), NULLIF(e.real_position, ''))
        ELSE COALESCE(NULLIF(e.real_position, ''), NULLIF(e.offered_position, ''), NULLIF(e.offer_position, ''))
      END AS document_position_name
    FROM employees e
    WHERE e.id = $1
    `,
    [Number(employeeId)]
  );

  const employee = employeeResult.rows[0];
  if (!employee) return null;

  const positionName = safeString(employee.document_position_name);

  const positionResult = await pool.query(
    `
    SELECT *
    FROM contract_positions
    WHERE contract_id = $1
      AND active = true
      AND UPPER(TRIM(name)) = UPPER(TRIM($2))
    ORDER BY
      CASE WHEN category = 'OFERTA' THEN 0 ELSE 1 END,
      id ASC
    LIMIT 1
    `,
    [employee.contract_id, positionName]
  );

  const contractPosition = positionResult.rows[0] || null;

  if (!contractPosition) {
    return {
      employeeId: employee.id,
      contractId: employee.contract_id,
      companyId: employee.company_id,
      presentedInOffer: employee.presented_in_offer === true,
      cargoBaseDocumental: positionName,
      contractPosition: null,
      requiredDocuments: [],
      uploadedDocuments: [],
      missingDocuments: [],
      status: "SIN_REGLA_DOCUMENTAL",
      message: "No hay regla documental configurada para este cargo en este contrato",
    };
  }

  const docsResult = await pool.query(
    `
    SELECT
      dt.id,
      dt.code,
      dt.name,
      dt.phase,
      cpd.required,
      cpd.expires,
      cpd.alert_days_before_expiration
    FROM contract_position_documents cpd
    INNER JOIN document_types dt ON dt.id = cpd.document_type_id
    WHERE cpd.contract_position_id = $1
      AND cpd.required = true
      AND dt.active = true
    ORDER BY dt.phase ASC, dt.name ASC
    `,
    [contractPosition.id]
  );

  const uploadedResult = await pool.query(
    `
    SELECT DISTINCT ON (ed.document_type_id)
      ed.document_type_id,
      ed.status,
      ed.file_name,
      ed.uploaded_at,
      ed.expiration_date,
      ed.validated
    FROM employee_documents ed
    WHERE ed.employee_id = $1
    ORDER BY ed.document_type_id, ed.uploaded_at DESC NULLS LAST, ed.id DESC
    `,
    [employee.id]
  );

  const uploadedByType = new Map(
    uploadedResult.rows.map((row) => [Number(row.document_type_id), row])
  );

  const requiredDocuments = docsResult.rows.map((row) => {
    const uploaded = uploadedByType.get(Number(row.id)) || null;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      phase: row.phase,
      required: row.required === true,
      expires: row.expires === true,
      alertDaysBeforeExpiration: row.alert_days_before_expiration,
      uploaded: Boolean(uploaded),
      uploadedInfo: uploaded,
    };
  });

  const missingDocuments = requiredDocuments.filter((doc) => !doc.uploaded);

  return {
    employeeId: employee.id,
    contractId: employee.contract_id,
    companyId: employee.company_id,
    presentedInOffer: employee.presented_in_offer === true,
    cargoBaseDocumental: positionName,
    contractPosition: mapContractPosition(contractPosition),
    requiredDocuments,
    uploadedDocuments: uploadedResult.rows,
    missingDocuments,
    status: missingDocuments.length ? "INCOMPLETA" : "COMPLETA",
  };
}

module.exports = {
  listContractPositions,
  createContractPosition,
  updateContractPosition,
  disableContractPosition,
  listDocumentTypes,
  createDocumentType,
  listPositionDocuments,
  savePositionDocuments,
  getEmployeeDocumentRequirements,
};
