const pool = require("../../db/pool");
const {
  getCoverageAudit,
  saveCoverageUpload,
} = require("./coverage.import");
const {
  buildRowHash,
  getPeriodBounds,
  makeCoverageIdKey,
  makeCoverageSiteIdKey,
  makeCoverageSiteTextKey,
  makeCoverageTextKey,
  normalize,
  normalizeSql,
  normalizeWorkTime,
} = require("./coverage-history");

function calculateRequiredPersonnel(cupos, modalidad) {
  const seats = Number(cupos);
  const mode = normalize(modalidad);

  if (!Number.isFinite(seats) || seats <= 0) {
    return { requiredTc: 0, requiredMt: 0, rawRequired: 0 };
  }

  let raw = 0;

  if (mode.includes("CAARES")) {
    raw = 1 + ((seats * 4 - 60) / 120);
  } else if (mode.includes("CAA")) {
    raw = 1 + ((seats - 60) / 120);
  } else if (mode.includes("RI")) {
    if (seats <= 100) raw = 0;
    else if (seats <= 300) raw = 1;
    else if (seats <= 500) raw = 2;
    else if (seats <= 800) raw = 3;
    else raw = 4;
  }

  const integer = Math.floor(raw);
  const decimal = raw - integer;

  let requiredTc = integer;
  let requiredMt = 0;

  if (decimal >= 0.25 && decimal <= 0.5) {
    requiredMt = 1;
  } else if (decimal > 0.5) {
    requiredTc += 1;
  }

  return {
    requiredTc,
    requiredMt,
    rawRequired: Number(raw.toFixed(2)),
  };
}

async function getCoverageHistory(filters = {}) {
  const conditions = ["TRUE"];
  const values = [];

  if (filters.companyId) {
    values.push(Number(filters.companyId));
    conditions.push(`company_id = $${values.length}`);
  }

  if (filters.contractId) {
    values.push(Number(filters.contractId));
    conditions.push(`contract_id = $${values.length}`);
  }

  const result = await pool.query(
    `
    SELECT *
    FROM coverage_uploads
    WHERE ${conditions.join(" AND ")}
    ORDER BY created_at DESC, id DESC
    `,
    values
  );

  return result.rows;
}

async function getPreviousUpload(currentUpload) {
  const conditions = ["id <> $1"];
  const values = [currentUpload.id];

  if (currentUpload.company_id) {
    values.push(currentUpload.company_id);
    conditions.push(`company_id = $${values.length}`);
  }

  if (currentUpload.contract_id) {
    values.push(currentUpload.contract_id);
    conditions.push(`contract_id = $${values.length}`);
  }

  const result = await pool.query(
    `
    SELECT *
    FROM coverage_uploads
    WHERE ${conditions.join(" AND ")}
      AND (
        created_at < $${values.length + 1}
        OR (created_at = $${values.length + 1} AND id < $1)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [...values, currentUpload.created_at]
  );

  return result.rows[0] || null;
}

const SQL_NORMALIZE_TEXT = (expr) =>
  `REGEXP_REPLACE(REGEXP_REPLACE(translate(UPPER(TRIM(COALESCE(${expr}, ''))),'ÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑÇ','AAAAAAEEEEIIIIOOOOOOUUUUYNC'),'[^A-Z0-9 ]','','g'),'[[:space:]]+',' ','g')`;

function buildAssignedPersonnelSummary(employees = []) {
  const warnings = [];
  let tcContratado = 0;
  let mtContratado = 0;

  const uniqueEmployees = new Map();
  for (const employee of employees) {
    if (!employee?.id || uniqueEmployees.has(String(employee.id))) continue;
    uniqueEmployees.set(String(employee.id), employee);

    const workTime = normalizeWorkTime(employee.work_time_type || employee.contract_type || "");
    if (workTime === "MT") {
      mtContratado += 1;
    } else {
      tcContratado += 1;
      if (!workTime) {
        warnings.push(
          `Empleado sin tipo de jornada: ${employee.full_name || employee.document_number || employee.id}`
        );
      }
    }
  }

  return {
    total_contratado: uniqueEmployees.size,
    tc_contratado: tcContratado,
    mt_contratado: mtContratado,
    empleados: Array.from(uniqueEmployees.values()),
    warnings,
  };
}

function getCoverageAssignedPersonnel(
  { contract_id, municipality_id, institution_id, site_id, modality, municipality, institution, site },
  employeeIndex = { byIdKey: new Map(), byTextKey: new Map() }
) {
  const idKey = makeCoverageIdKey({
    contract_id,
    municipality_id,
    institution_id,
    site_id,
    modality,
  });
  const textKey = makeCoverageTextKey({
    contract_id,
    municipality,
    institution,
    site,
    modality,
  });

  const employees = idKey && employeeIndex.byIdKey.has(idKey)
    ? employeeIndex.byIdKey.get(idKey)
    : employeeIndex.byTextKey.get(textKey) || [];

  return buildAssignedPersonnelSummary(employees);
}

async function getActiveEmployeeCoverageIndex(currentUpload) {
  const conditions = ["e.site_id IS NOT NULL"];
  const values = [];
  const bounds = getPeriodBounds(currentUpload.period_month);

  if (currentUpload.company_id) {
    values.push(currentUpload.company_id);
    conditions.push(`e.company_id = $${values.length}`);
  }

  if (currentUpload.contract_id) {
    values.push(currentUpload.contract_id);
    conditions.push(`e.contract_id = $${values.length}`);
  }

  let lateralModalityJoin = "";
  if (bounds) {
    values.push(bounds.periodStart.toISOString().slice(0, 10));
    const periodStartIdx = values.length;
    values.push(bounds.periodEnd.toISOString().slice(0, 10));
    const periodEndIdx = values.length;

    lateralModalityJoin = `
      LEFT JOIN LATERAL (
        SELECT smh.modality
        FROM site_modality_history smh
        WHERE smh.site_id = e.site_id
          AND smh.valid_from <= $${periodEndIdx}
          AND (smh.valid_to IS NULL OR smh.valid_to >= $${periodStartIdx})
        ORDER BY smh.valid_from DESC, smh.id DESC
        LIMIT 1
      ) smh ON TRUE
    `;

    conditions.push(`
      COALESCE(e.labor_start_date, e.start_date, e.coverage_start_date, e.created_at::date) <= $${periodEndIdx}
    `);
    conditions.push(`
      COALESCE(
        e.labor_end_date,
        e.retirement_date,
        CASE
          WHEN ${SQL_NORMALIZE_TEXT("e.status")} IN ('RETIRADO','RETIRADA','INACTIVO','INACTIVA')
          THEN CURRENT_DATE
          ELSE NULL
        END
      ) IS NULL
      OR COALESCE(
        e.labor_end_date,
        e.retirement_date,
        CASE
          WHEN ${SQL_NORMALIZE_TEXT("e.status")} IN ('RETIRADO','RETIRADA','INACTIVO','INACTIVA')
          THEN CURRENT_DATE
          ELSE NULL
        END
      ) >= $${periodStartIdx}
    `);
  } else {
    conditions.push(
      `${SQL_NORMALIZE_TEXT("e.status")} NOT IN ('RETIRADO','RETIRADA','INACTIVO','INACTIVA')`
    );
  }

  const result = await pool.query(
    `
    SELECT
      e.id,
      e.full_name,
      e.document_number,
      e.real_position,
      e.workday_type AS work_time_type,
      e.contract_type,
      e.contract_id,
      e.municipality_id,
      e.institution_id,
      e.site_id,
      COALESCE(smh.modality, e.modality) AS effective_modality,
      e.modality,
      m.name AS municipality_name,
      i.name AS institution_name,
      s.name AS site_name
    FROM employees e
    LEFT JOIN municipalities m ON m.id = e.municipality_id
    LEFT JOIN institutions i ON i.id = e.institution_id
    LEFT JOIN educational_sites s ON s.id = e.site_id
    ${lateralModalityJoin}
    LEFT JOIN contract_positions cp
      ON cp.contract_id = e.contract_id
     AND (cp.company_id = e.company_id OR cp.company_id IS NULL OR e.company_id IS NULL)
     AND cp.active = true
     AND ${SQL_NORMALIZE_TEXT("cp.name")} = ${SQL_NORMALIZE_TEXT("e.real_position")}
    WHERE ${conditions.join(" AND ")}
      AND (
        COALESCE(cp.counts_for_coverage, false) = true
        OR (cp.id IS NULL AND ${SQL_NORMALIZE_TEXT("e.real_position")} = 'OPERARIO MANIPULADOR DE ALIMENTOS')
      )
    ORDER BY e.id
    `,
    values
  );

  const index = {
    byIdKey: new Map(),
    byTextKey: new Map(),
    bySiteIdKey: new Map(),
    bySiteTextKey: new Map(),
  };

  result.rows.forEach((row) => {
    const effectiveModality = row.effective_modality || row.modality || "";
    const employee = {
      id: row.id,
      full_name: row.full_name || "",
      document_number: row.document_number || "",
      real_position: row.real_position || "",
      work_time_type: row.work_time_type || "",
      municipality_id: row.municipality_id || null,
      municipality_name: row.municipality_name || "",
      institution_id: row.institution_id || null,
      institution_name: row.institution_name || "",
      site_id: row.site_id || null,
      site_name: row.site_name || "",
      modality: effectiveModality,
    };

    const idKey = makeCoverageIdKey({
      contract_id: row.contract_id,
      municipality_id: row.municipality_id,
      institution_id: row.institution_id,
      site_id: row.site_id,
      modality: effectiveModality,
    });
    const textKey = makeCoverageTextKey({
      contract_id: row.contract_id,
      municipality: row.municipality_name,
      institution: row.institution_name,
      site: row.site_name,
      modality: effectiveModality,
    });
    const siteIdKey = makeCoverageSiteIdKey({
      contract_id: row.contract_id,
      municipality_id: row.municipality_id,
      institution_id: row.institution_id,
      site_id: row.site_id,
    });
    const siteTextKey = makeCoverageSiteTextKey({
      contract_id: row.contract_id,
      municipality: row.municipality_name,
      institution: row.institution_name,
      site: row.site_name,
    });

    for (const [map, key] of [
      [index.byIdKey, idKey],
      [index.byTextKey, textKey],
      [index.bySiteIdKey, siteIdKey],
      [index.bySiteTextKey, siteTextKey],
    ]) {
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(employee);
    }
  });

  return index;
}

function getCoverageStatus({ requiredTc, requiredMt, contractedTc, contractedMt }) {
  const rTc = Number(requiredTc || 0);
  const rMt = Number(requiredMt || 0);
  const cTc = Number(contractedTc || 0);
  const cMt = Number(contractedMt || 0);

  const tcDiff = cTc - rTc;
  const mtDiff = cMt - rMt;

  if ((cTc + cMt) === (rTc + rMt) && (tcDiff !== 0 || mtDiff !== 0)) return "MAL_CONTRATADO";
  if (tcDiff < 0 || mtDiff < 0) return "FALTANTE";
  if (tcDiff > 0 || mtDiff > 0) return "SOBRANTE";
  return "CUMPLE";
}

async function getCoverageRowsByUpload(uploadId, municipalityIds = null) {
  const uploadResult = await pool.query(`SELECT * FROM coverage_uploads WHERE id = $1`, [uploadId]);
  const currentUpload = uploadResult.rows[0];
  if (!currentUpload) return [];

  const scopedMunicipalityIds = Array.isArray(municipalityIds)
    ? municipalityIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];

  const currentRowsResult = await pool.query(
    `
    SELECT *
    FROM coverage_upload_rows
    WHERE upload_id = $1
      ${scopedMunicipalityIds.length ? "AND municipality_id = ANY($2::int[])" : ""}
    ORDER BY municipality, institution, site, modality, COALESCE(official_code, unique_code)
    `,
    scopedMunicipalityIds.length ? [uploadId, scopedMunicipalityIds] : [uploadId]
  );

  const currentRows = currentRowsResult.rows;
  const currentRowIds = currentRows.map((row) => Number(row.id)).filter(Boolean);

  const rowMetadata = new Map();
  if (currentRowIds.length) {
    const metadataResult = await pool.query(
      `
      SELECT
        r.id AS row_id,
        r.municipality_id,
        COALESCE(r.institution_id, i.id) AS institution_id,
        COALESCE(r.site_id, s.id) AS site_id,
        COALESCE(NULLIF(TRIM(r.official_code), ''), NULLIF(TRIM(r.unique_code), '')) AS official_code
      FROM coverage_upload_rows r
      LEFT JOIN institutions i
        ON r.institution_id IS NULL
       AND ${SQL_NORMALIZE_TEXT("i.name")} = ${SQL_NORMALIZE_TEXT("r.institution")}
       AND (r.municipality_id IS NULL OR i.municipality_id = r.municipality_id)
      LEFT JOIN educational_sites s
        ON r.site_id IS NULL
       AND ${SQL_NORMALIZE_TEXT("s.name")} = ${SQL_NORMALIZE_TEXT("r.site")}
       AND (
         COALESCE(r.institution_id, i.id) IS NULL
         OR s.institution_id = COALESCE(r.institution_id, i.id)
       )
      WHERE r.id = ANY($1::int[])
      `,
      [currentRowIds]
    );
    metadataResult.rows.forEach((row) => rowMetadata.set(Number(row.row_id), row));
  }

  const previousUpload = await getPreviousUpload(currentUpload);
  let previousRows = [];
  if (previousUpload) {
    const previousRowsResult = await pool.query(
      `SELECT * FROM coverage_upload_rows WHERE upload_id = $1`,
      [previousUpload.id]
    );
    previousRows = previousRowsResult.rows;
  }

  const previousMap = new Map();
  previousRows.forEach((row) => {
    const key = buildRowHash({
      municipality: row.municipality,
      institution: row.institution,
      site: row.site,
      modality: row.modality,
    });
    previousMap.set(key, row);
  });

  const employeeCoverageIndex = await getActiveEmployeeCoverageIndex(currentUpload);

  return currentRows.map((row) => {
    const key = buildRowHash({
      municipality: row.municipality,
      institution: row.institution,
      site: row.site,
      modality: row.modality,
    });
    const previous = previousMap.get(key);
    const metadata = rowMetadata.get(Number(row.id)) || {};
    const resolvedMunId = row.municipality_id ?? metadata.municipality_id ?? null;

    const employeeCoverage = getCoverageAssignedPersonnel(
      {
        contract_id: currentUpload.contract_id,
        municipality_id: resolvedMunId,
        institution_id: metadata.institution_id || row.institution_id || null,
        site_id: metadata.site_id || row.site_id || null,
        modality: row.modality,
        municipality: row.municipality,
        institution: row.institution,
        site: row.site,
      },
      employeeCoverageIndex
    );

    const rowSiteIdKey = makeCoverageSiteIdKey({
      contract_id: currentUpload.contract_id,
      municipality_id: resolvedMunId,
      institution_id: metadata.institution_id || row.institution_id || null,
      site_id: metadata.site_id || row.site_id || null,
    });
    const rowSiteTextKey = makeCoverageSiteTextKey({
      contract_id: currentUpload.contract_id,
      municipality: row.municipality,
      institution: row.institution,
      site: row.site,
    });

    const possibleSameSiteEmployees = rowSiteIdKey && employeeCoverageIndex.bySiteIdKey.has(rowSiteIdKey)
      ? employeeCoverageIndex.bySiteIdKey.get(rowSiteIdKey)
      : employeeCoverageIndex.bySiteTextKey.get(rowSiteTextKey) || [];

    const technicalWarnings = [...employeeCoverage.warnings];
    if (employeeCoverage.total_contratado === 0 && possibleSameSiteEmployees.length > 0) {
      technicalWarnings.push(
        "Hay empleados asignados, pero no coinciden los IDs de municipio/institución/sede/modalidad. Revisar datos institucionales."
      );
    }

    const tcDifference = Number(employeeCoverage.tc_contratado || 0) - Number(row.required_tc || 0);
    const mtDifference = Number(employeeCoverage.mt_contratado || 0) - Number(row.required_mt || 0);
    const coverageStatus = getCoverageStatus({
      requiredTc: row.required_tc,
      requiredMt: row.required_mt,
      contractedTc: employeeCoverage.tc_contratado,
      contractedMt: employeeCoverage.mt_contratado,
    });

    const previousCupos = Number(previous?.cupos || 0);
    const previousRequiredTc = Number(previous?.required_tc || 0);
    const previousRequiredMt = Number(previous?.required_mt || 0);
    const currentCupos = Number(row.cupos || 0);
    const currentRequiredTc = Number(row.required_tc || 0);
    const currentRequiredMt = Number(row.required_mt || 0);

    let changeStatus = "SIN_COMPARACION";
    if (previous) {
      if (currentCupos - previousCupos > 0) changeStatus = "SUBIO";
      else if (currentCupos - previousCupos < 0) changeStatus = "BAJO";
      else if (currentRequiredTc - previousRequiredTc > 0 || currentRequiredMt - previousRequiredMt > 0) changeStatus = "SUBIO";
      else if (currentRequiredTc - previousRequiredTc < 0 || currentRequiredMt - previousRequiredMt < 0) changeStatus = "BAJO";
      else changeStatus = "SIN_CAMBIO";
    }

    return {
      ...row,
      previous_upload_id: previousUpload?.id || null,
      previous_cupos: previous ? previousCupos : null,
      cupos_delta: previous ? currentCupos - previousCupos : null,
      previous_required_tc: previous ? previousRequiredTc : null,
      required_tc_delta: previous ? currentRequiredTc - previousRequiredTc : null,
      previous_required_mt: previous ? previousRequiredMt : null,
      required_mt_delta: previous ? currentRequiredMt - previousRequiredMt : null,
      change_status: changeStatus,
      municipality_id: resolvedMunId,
      institution_id: metadata.institution_id || row.institution_id || null,
      site_id: metadata.site_id || row.site_id || null,
      official_code: metadata.official_code || row.official_code || row.unique_code || "",
      official_code_used: metadata.official_code || row.official_code || row.unique_code || "",
      modality_used: row.modality,
      cupos_used: Number(row.cupos || 0),
      active_personnel: employeeCoverage.total_contratado,
      contracted_tc: employeeCoverage.tc_contratado,
      contracted_mt: employeeCoverage.mt_contratado,
      tc_contratado: employeeCoverage.tc_contratado,
      mt_contratado: employeeCoverage.mt_contratado,
      total_contratado: employeeCoverage.total_contratado,
      estado_cobertura: coverageStatus,
      coverage_employees: employeeCoverage.empleados,
      coverage_warnings: technicalWarnings,
      tc_difference: tcDifference,
      mt_difference: mtDifference,
      coverage_status: coverageStatus,
    };
  });
}

async function getCoverageExcludedEmployees({ companyId, contractId } = {}) {
  const values = [];
  const companyFilter = [];
  if (companyId) {
    values.push(Number(companyId));
    companyFilter.push(`e.company_id = $${values.length}`);
  }
  if (contractId) {
    values.push(Number(contractId));
    companyFilter.push(`e.contract_id = $${values.length}`);
  }
  const scopeWhere = companyFilter.length ? `AND ${companyFilter.join(" AND ")}` : "";

  const result = await pool.query(
    `
    SELECT
      e.id,
      e.full_name,
      e.document_number,
      e.real_position,
      e.status,
      e.municipality_id,
      e.institution_id,
      e.site_id,
      e.modality,
      m.name AS municipality_name,
      i.name AS institution_name,
      s.name AS site_name,
      cp.counts_for_coverage
    FROM employees e
    LEFT JOIN municipalities m ON m.id = e.municipality_id
    LEFT JOIN institutions i ON i.id = e.institution_id
    LEFT JOIN educational_sites s ON s.id = e.site_id
    LEFT JOIN contract_positions cp
      ON cp.contract_id = e.contract_id
     AND (cp.company_id = e.company_id OR cp.company_id IS NULL OR e.company_id IS NULL)
     AND cp.active = true
     AND ${SQL_NORMALIZE_TEXT("cp.name")} = ${SQL_NORMALIZE_TEXT("e.real_position")}
    WHERE ${SQL_NORMALIZE_TEXT("e.status")} NOT IN ('RETIRADO','RETIRADA','INACTIVO','INACTIVA')
      ${scopeWhere}
      AND (
        COALESCE(cp.counts_for_coverage, false) = true
        OR ${SQL_NORMALIZE_TEXT("e.real_position")} = 'OPERARIO MANIPULADOR DE ALIMENTOS'
      )
      AND e.site_id IS NULL
    ORDER BY m.name, e.full_name
    `,
    values
  );

  return result.rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    documentNumber: row.document_number,
    realPosition: row.real_position,
    status: row.status,
    municipalityId: row.municipality_id,
    municipalityName: row.municipality_name || "Sin municipio",
    institutionId: row.institution_id,
    institutionName: row.institution_name || "",
    siteId: row.site_id,
    siteName: row.site_name || "",
    modality: row.modality || "",
    exclusionReason: "SIN_SEDE_ASIGNADA",
    exclusionDetail:
      "El empleado no tiene Sede (site_id) asignada. Sin sede no se puede cruzar con el Excel de cobertura. Corrija desde el módulo Personal → Editar empleado → Sede educativa.",
  }));
}

module.exports = {
  calculateRequiredPersonnel,
  getCoverageAudit,
  getCoverageAssignedPersonnel,
  getCoverageExcludedEmployees,
  getCoverageHistory,
  getCoverageRowsByUpload,
  saveCoverageUpload,
};
