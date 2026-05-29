const pool = require("../../db/pool");
const { getAllDocuments } = require("../../data/documents");

function safeString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function isActiveEmployeeStatus(status) {
  const value = normalize(status);
  return !["RETIRADO", "RETIRADA", "INACTIVO", "INACTIVA"].includes(value);
}

function normalizeWorkdayType(value) {
  const v = normalize(value);
  if (v.includes("MT") || v.includes("MEDIO") || v.includes("MEDIA") || v.includes("HALF")) return "MT";
  return "TC";
}

const COVERAGE_DEBUG = process.env.COVERAGE_DEBUG === "1";

function calculateRequiredPersonnel(cupos, modalidad) {
  const seats = Number(cupos);
  const mode = normalize(modalidad);

  if (!Number.isFinite(seats) || seats <= 0) {
    return { tc: 0, mt: 0, raw: 0 };
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

  let tc = integer;
  let mt = 0;

  if (decimal >= 0.25 && decimal <= 0.5) {
    mt = 1;
  } else if (decimal > 0.5) {
    tc += 1;
  }

  return {
    tc,
    mt,
    raw: Number(raw.toFixed(2)),
  };
}

function getDocumentRiskByEmployee(allDocuments = []) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const riskMap = new Map();

  allDocuments.forEach((doc) => {
    const employeeId = String(doc.employeeId || "");
    if (!employeeId) return;

    const status = normalize(doc.validationStatus || doc.status);
    const expirationDate = doc.expirationDate || "";

    let hasRisk = false;

    if (status === "RECHAZADO") {
      hasRisk = true;
    }

    if (expirationDate) {
      const exp = new Date(expirationDate);
      exp.setHours(0, 0, 0, 0);

      if (!Number.isNaN(exp.getTime()) && exp < today) {
        hasRisk = true;
      }
    }

    if (hasRisk) {
      riskMap.set(employeeId, true);
    }
  });

  return riskMap;
}

// ─────────────────────────────────────────────
// COBERTURA POR CONTRATO / CARGO
// ─────────────────────────────────────────────
async function getCoverageByContract(filters = {}) {
  const conditions = ["cp.active = true"];
  const values = [];

  if (filters.contractId) {
    values.push(Number(filters.contractId));
    conditions.push(`cp.contract_id = $${values.length}`);
  }

  if (filters.companyId) {
    values.push(Number(filters.companyId));
    conditions.push(`cp.company_id = $${values.length}`);
  }

  const empMunFilter =
    Array.isArray(filters.municipalityIds) && filters.municipalityIds.length > 0
      ? (() => { values.push(filters.municipalityIds); return ` AND e.municipality_id = ANY($${values.length})`; })()
      : "";

  const result = await pool.query(
    `
    SELECT
      cp.id,
      cp.name AS position_name,
      cp.category,
      cp.counts_for_coverage,
      c.id AS contract_id,
      c.name AS contract_name,
      co.id AS company_id,
      co.name AS company_name,
      e.id AS employee_id,
      e.status AS employee_status,
      e.workday_type AS employee_workday_type,
      e.municipality_id AS employee_municipality_id,
      e.institution_id  AS employee_institution_id,
      e.site_id         AS employee_site_id,
      e.modality        AS employee_modality
    FROM contract_positions cp
    JOIN contracts c ON c.id = cp.contract_id
    JOIN companies co ON co.id = cp.company_id
    LEFT JOIN employees e
      ON e.company_id = cp.company_id
      AND (e.contract_id = cp.contract_id OR e.contract_id IS NULL)
      AND UPPER(TRIM(e.real_position)) = UPPER(TRIM(cp.name))${empMunFilter}
    WHERE ${conditions.join(" AND ")}
    ORDER BY co.name, c.name, cp.category, cp.name
    `,
    values
  );

  const documentRiskMap = getDocumentRiskByEmployee(getAllDocuments());
  const grouped = new Map();

  result.rows.forEach((row) => {
    const key = `${row.company_id}-${row.contract_id}-${row.id}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        contractId:        row.contract_id,
        contractName:      row.contract_name,
        companyId:         row.company_id,
        companyName:       row.company_name,
        positionId:        row.id,
        positionName:      row.position_name,
        category:          row.category,
        countsForCoverage: row.counts_for_coverage === true,
        filledCount:       0,
        tcFilledCount:     0,
        mtFilledCount:     0,
        documentRiskCount: 0,
      });
    }

    const item = grouped.get(key);

    if (row.employee_id && isActiveEmployeeStatus(row.employee_status)) {
      const wt = normalizeWorkdayType(row.employee_workday_type);
      item.filledCount += 1;
      if (wt === "MT") item.mtFilledCount += 1;
      else item.tcFilledCount += 1;

      if (documentRiskMap.get(String(row.employee_id))) {
        item.documentRiskCount += 1;
      }

      if (COVERAGE_DEBUG) {
        console.log("[coverage employee match debug]", {
          employeeId:            row.employee_id,
          employeeStatus:        row.employee_status,
          realPosition:          row.position_name,
          workdayType:           row.employee_workday_type,
          employeeMunicipalityId:row.employee_municipality_id,
          employeeInstitutionId: row.employee_institution_id,
          employeeSiteId:        row.employee_site_id,
          employeeModality:      row.employee_modality,
          coveragePositionId:    row.id,
          coveragePositionName:  row.position_name,
          countedAs:             wt,
        });
      }
    }
  });

  return Array.from(grouped.values()).map((item) => ({
    ...item,
    alerts: [
      ...(item.documentRiskCount > 0
        ? [`${item.documentRiskCount} empleado(s) con riesgo documental`]
        : []),
    ],
  }));
}

// ─────────────────────────────────────────────
// COBERTURA POR MUNICIPIO / CARGO
// ─────────────────────────────────────────────
async function getCoverageByMunicipality(filters = {}) {
  const conditions = ["TRUE"];
  const values = [];

  // Incluye empleados con contract_id = X o con contract_id IS NULL (mismo company)
  // para cubrir empleados editados manualmente sin contrato aún asignado.
  if (filters.contractId && filters.companyId) {
    values.push(Number(filters.companyId));
    values.push(Number(filters.contractId));
    conditions.push(`e.company_id = $${values.length - 1} AND (e.contract_id = $${values.length} OR e.contract_id IS NULL)`);
  } else if (filters.contractId) {
    values.push(Number(filters.contractId));
    conditions.push(`e.contract_id = $${values.length}`);
  } else if (filters.companyId) {
    values.push(Number(filters.companyId));
    conditions.push(`e.company_id = $${values.length}`);
  }

  if (filters.municipalityId) {
    values.push(Number(filters.municipalityId));
    conditions.push(`e.municipality_id = $${values.length}`);
  }

  if (Array.isArray(filters.municipalityIds) && filters.municipalityIds.length > 0) {
    values.push(filters.municipalityIds);
    conditions.push(`e.municipality_id = ANY($${values.length})`);
  }

  const result = await pool.query(
    `
    SELECT
      e.id,
      e.status,
      e.real_position,
      e.workday_type,
      e.modality,
      e.company_id,
      e.contract_id,
      e.institution_id,
      e.site_id,
      m.id   AS municipality_id,
      m.name AS municipality_name
    FROM employees e
    LEFT JOIN municipalities m ON m.id = e.municipality_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY m.name, e.real_position
    `,
    values
  );

  const documentRiskMap = getDocumentRiskByEmployee(getAllDocuments());
  const grouped = new Map();

  result.rows.forEach((row) => {
    if (!isActiveEmployeeStatus(row.status)) return;

    const wt  = normalizeWorkdayType(row.workday_type);
    const key = `${row.company_id}-${row.contract_id}-${row.municipality_id}-${normalize(row.real_position)}-${wt}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        municipalityId:    row.municipality_id,
        municipalityName:  row.municipality_name || "Sin municipio",
        position:          row.real_position || "Sin cargo",
        workdayType:       wt,
        employeeCount:     0,
        tcCount:           0,
        mtCount:           0,
        documentRiskCount: 0,
        companyId:         row.company_id,
        contractId:        row.contract_id,
      });
    }

    const item = grouped.get(key);
    item.employeeCount += 1;
    if (wt === "MT") item.mtCount += 1;
    else item.tcCount += 1;

    if (documentRiskMap.get(String(row.id))) {
      item.documentRiskCount += 1;
    }

    if (COVERAGE_DEBUG) {
      console.log("[coverage employee match debug]", {
        employeeId:            row.id,
        status:                row.status,
        realPosition:          row.real_position,
        workTimeType:          row.workday_type,
        employeeMunicipalityId:row.municipality_id,
        employeeInstitutionId: row.institution_id,
        employeeSiteId:        row.site_id,
        employeeModality:      row.modality,
        coverageMunicipalityId:row.municipality_id,
        matchedMunicipality:   Boolean(row.municipality_id),
        countedAs:             wt,
      });
    }
  });

  return Array.from(grouped.values()).map((item) => ({
    ...item,
    alerts: [
      ...(item.documentRiskCount > 0
        ? [`${item.documentRiskCount} empleado(s) con riesgo documental`]
        : []),
    ],
  }));
}

// ─────────────────────────────────────────────
// DETALLE DE EMPLEADOS POR MUNICIPIO / CARGO
// ─────────────────────────────────────────────
async function getEmployeesByMunicipalityAndPosition(filters = {}) {
  const conditions = ["TRUE"];
  const values = [];

  if (filters.contractId && filters.companyId) {
    values.push(Number(filters.companyId));
    values.push(Number(filters.contractId));
    conditions.push(`e.company_id = $${values.length - 1} AND (e.contract_id = $${values.length} OR e.contract_id IS NULL)`);
  } else if (filters.contractId) {
    values.push(Number(filters.contractId));
    conditions.push(`e.contract_id = $${values.length}`);
  } else if (filters.companyId) {
    values.push(Number(filters.companyId));
    conditions.push(`e.company_id = $${values.length}`);
  }

  if (filters.municipalityId) {
    values.push(Number(filters.municipalityId));
    conditions.push(`e.municipality_id = $${values.length}`);
  }

  if (Array.isArray(filters.municipalityIds) && filters.municipalityIds.length > 0) {
    values.push(filters.municipalityIds);
    conditions.push(`e.municipality_id = ANY($${values.length})`);
  }

  if (filters.position) {
    values.push(safeString(filters.position));
    conditions.push(`UPPER(TRIM(e.real_position)) = UPPER(TRIM($${values.length}))`);
  }

  const result = await pool.query(
    `
    SELECT
      e.id,
      e.full_name,
      e.document_number,
      e.document_type,
      e.real_position,
      e.status,
      e.coverage_start_date,
      e.arl,
      e.arl_vinculation_date,
      e.eps,
      e.company_id,
      e.contract_id,
      m.name AS municipality_name
    FROM employees e
    LEFT JOIN municipalities m ON m.id = e.municipality_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY m.name, e.real_position, e.full_name
    `,
    values
  );

  const documentRiskMap = getDocumentRiskByEmployee(getAllDocuments());

  return result.rows
    .filter((row) => isActiveEmployeeStatus(row.status))
    .map((row) => ({
      id: row.id,
      fullName: row.full_name,
      documentType: row.document_type,
      documentNumber: row.document_number,
      position: row.real_position,
      status: row.status,
      coverageStartDate: row.coverage_start_date,
      arl: row.arl,
      arlVinculationDate: row.arl_vinculation_date,
      eps: row.eps,
      companyId: row.company_id,
      contractId: row.contract_id,
      municipalityName: row.municipality_name,
      hasDocumentRisk: !!documentRiskMap.get(String(row.id)),
      alerts: documentRiskMap.get(String(row.id))
        ? ["Empleado con riesgo documental"]
        : [],
    }));
}

// ─────────────────────────────────────────────
// RESUMEN EJECUTIVO DE COBERTURA
// ─────────────────────────────────────────────
async function getCoverageSummary(filters = {}) {
  const empConditions = ["TRUE"];
  const posConditions = ["cp.active = true", "cp.counts_for_coverage = true"];
  const empValues = [];
  const posValues = [];

  if (filters.contractId && filters.companyId) {
    empValues.push(Number(filters.companyId));
    empValues.push(Number(filters.contractId));
    empConditions.push(`e.company_id = $${empValues.length - 1} AND (e.contract_id = $${empValues.length} OR e.contract_id IS NULL)`);

    posValues.push(Number(filters.contractId));
    posConditions.push(`cp.contract_id = $${posValues.length}`);
    posValues.push(Number(filters.companyId));
    posConditions.push(`cp.company_id = $${posValues.length}`);
  } else if (filters.contractId) {
    empValues.push(Number(filters.contractId));
    empConditions.push(`e.contract_id = $${empValues.length}`);
    posValues.push(Number(filters.contractId));
    posConditions.push(`cp.contract_id = $${posValues.length}`);
  } else if (filters.companyId) {
    empValues.push(Number(filters.companyId));
    empConditions.push(`e.company_id = $${empValues.length}`);
    posValues.push(Number(filters.companyId));
    posConditions.push(`cp.company_id = $${posValues.length}`);
  }

  if (Array.isArray(filters.municipalityIds) && filters.municipalityIds.length > 0) {
    empValues.push(filters.municipalityIds);
    empConditions.push(`e.municipality_id = ANY($${empValues.length})`);
  }

  const [empResult, posResult] = await Promise.all([
    pool.query(
      `
      SELECT e.id, e.status
      FROM employees e
      WHERE ${empConditions.join(" AND ")}
      `,
      empValues
    ),
    pool.query(
      `
      SELECT COUNT(*) AS total
      FROM contract_positions cp
      WHERE ${posConditions.join(" AND ")}
      `,
      posValues
    ),
  ]);

  const documentRiskMap = getDocumentRiskByEmployee(getAllDocuments());

  const activeEmployees = empResult.rows.filter((row) =>
    isActiveEmployeeStatus(row.status)
  );

  const active = activeEmployees.length;
  const required = Number(posResult.rows[0]?.total ?? 0);
  const coveragePercent = required > 0 ? Math.round((active / required) * 100) : 0;
  const documentRiskCount = activeEmployees.filter((row) =>
    documentRiskMap.get(String(row.id))
  ).length;

  return {
    activeEmployees: active,
    requiredPositions: required,
    coveragePercent,
    gap: required - active,
    documentRiskCount,
    alerts: [
      ...(documentRiskCount > 0
        ? [`${documentRiskCount} empleado(s) con riesgo documental`]
        : []),
    ],
  };
}

module.exports = {
  calculateRequiredPersonnel,
  getCoverageByContract,
  getCoverageByMunicipality,
  getEmployeesByMunicipalityAndPosition,
  getCoverageSummary,
};