const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");
const pool = require("../../db/pool");
const { normalizeMunicipalityName } = require("../../utils/municipality");
const { listMunicipalities } = require("../../db/municipalities.repository");

const uploadsDir = path.join(__dirname, "../../../uploads/coverage");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase()
    .trim();
}

// Matches the PostgreSQL SQL_NORMALIZE_TEXT used in getActiveEmployeeCoverageCounts
function normalizeSql(value) {
  return normalize(value).replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ");
}

function normalizeWorkTime(value) {
  const normalized = normalize(value);
  if (!normalized) return "";
  if (
    normalized === "MT" ||
    normalized.includes("MEDIO") ||
    normalized.includes("MEDIA") ||
    normalized.includes("HALF") ||
    normalized.includes("PART TIME")
  ) {
    return "MT";
  }
  if (
    normalized === "TC" ||
    normalized.includes("COMPLETO") ||
    normalized.includes("FULL") ||
    normalized.includes("TIEMPO COMPLETO")
  ) {
    return "TC";
  }
  return normalized;
}


function makeCoverageIdKey({ contract_id, municipality_id, institution_id, site_id, modality }) {
  if (!contract_id || !municipality_id || !institution_id || !site_id || !normalizeSql(modality)) return "";
  return [
    String(contract_id),
    String(municipality_id),
    String(institution_id),
    String(site_id),
    normalizeSql(modality),
  ].join("|");
}

function makeCoverageTextKey({ contract_id, municipality, institution, site, modality }) {
  return [
    String(contract_id || ""),
    normalizeSql(municipality),
    normalizeSql(institution),
    normalizeSql(site),
    normalizeSql(modality),
  ].join("|");
}

function makeCoverageSiteIdKey({ contract_id, municipality_id, institution_id, site_id }) {
  if (!contract_id || !municipality_id || !institution_id || !site_id) return "";
  return [
    String(contract_id),
    String(municipality_id),
    String(institution_id),
    String(site_id),
  ].join("|");
}

function makeCoverageSiteTextKey({ contract_id, municipality, institution, site }) {
  return [
    String(contract_id || ""),
    normalizeSql(municipality),
    normalizeSql(institution),
    normalizeSql(site),
  ].join("|");
}

function cleanText(value) {
  return String(value || "").trim();
}

function toNumber(value) {
  const cleaned = String(value || "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

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

function buildRowHash({ municipality, institution, site, modality }) {
  const base = [
    normalize(municipality),
    normalize(institution),
    normalize(site),
    normalize(modality),
  ].join("|");

  return crypto.createHash("sha256").update(base).digest("hex");
}

function parseCoverageExcel(filePath) {
  const workbook = XLSX.readFile(filePath);

  const sheetName = workbook.SheetNames.find(
    (name) => normalize(name) === "COBERTURA"
  );

  if (!sheetName) {
    throw new Error("El archivo no contiene una hoja llamada 'COBERTURA'.");
  }

  const sheet = workbook.Sheets[sheetName];

  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });

  const normalizeHeader = (value) => normalize(value);

  const headerIndex = matrix.findIndex((row) => {
    const normalizedRow = row.map(normalizeHeader);

    return (
      normalizedRow.includes("CONSECUTIVO UNICO") &&
      normalizedRow.includes("MUNICIPIO") &&
      normalizedRow.includes("INSTITUCION EDUCATIVA") &&
      normalizedRow.includes("SEDE EDUCATIVA") &&
      normalizedRow.includes("MODALIDAD") &&
      normalizedRow.includes("CUPOS TOTAL")
    );
  });

  if (headerIndex === -1) {
    throw new Error("No encontré los encabezados en la hoja COBERTURA.");
  }

  const headers = matrix[headerIndex].map(normalizeHeader);
  const getIndex = (name) => headers.indexOf(normalizeHeader(name));

  const idxUnique = getIndex("CONSECUTIVO UNICO");
  const idxMunicipality = getIndex("MUNICIPIO");
  const idxInstitution = getIndex("INSTITUCION EDUCATIVA");
  const idxSite = getIndex("SEDE EDUCATIVA");
  const idxModality = getIndex("MODALIDAD");
  const idxCupos = getIndex("CUPOS TOTAL");

  const dataRows = matrix.slice(headerIndex + 1);

  return dataRows
    .map((row) => {
      const uniqueCode = cleanText(row[idxUnique]);
      const municipality = cleanText(row[idxMunicipality]);
      const institution = cleanText(row[idxInstitution]);
      const site = cleanText(row[idxSite]);
      const modality = cleanText(row[idxModality]);
      const cupos = toNumber(row[idxCupos]);

      if (!municipality && !institution && !site && !modality && !cupos) {
        return null;
      }

      if (!municipality || !institution || !site || !modality) {
        return null;
      }

      const calculated = calculateRequiredPersonnel(cupos, modality);

      const rowHash = buildRowHash({
        municipality,
        institution,
        site,
        modality,
      });

      return {
        uniqueCode,
        municipality,
        institution,
        site,
        modality,
        cupos,
        ...calculated,
        rowHash,
      };
    })
    .filter(Boolean);
}

async function saveCoverageUpload({
  companyId,
  contractId,
  periodMonth,
  weekNumber,
  fileBase64,
  fileName,
  uploadedBy,
}) {
  if (!fileBase64 || !fileBase64.startsWith("data:")) {
    throw new Error("Debes enviar un archivo Excel válido.");
  }

  const base64Data = fileBase64.split("base64,")[1];

  if (!base64Data) {
    throw new Error("Archivo Excel inválido.");
  }

  const safeFileName = String(fileName || "cobertura.xlsx")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);

  const storedFileName = `coverage_${Date.now()}_${safeFileName}`;
  const filePath = path.join(uploadsDir, storedFileName);

  fs.writeFileSync(filePath, base64Data, "base64");

  const parsedRows = parseCoverageExcel(filePath);

  if (!parsedRows.length) {
    throw new Error("El archivo no tiene registros válidos.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE coverage_upload_rows
      ADD COLUMN IF NOT EXISTS update_origin VARCHAR(20) DEFAULT 'ACTUALIZADO'
    `);

    await client.query(`
      ALTER TABLE coverage_upload_rows
      ADD COLUMN IF NOT EXISTS municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL
    `).catch(() => {});

    // Construir mapa normalizado de nombre → municipality_id para resolver durante la importación.
    const munCatalogResult = await listMunicipalities({}, client);
    const munNameToId = new Map();
    const munIdToName = new Map();
    for (const r of munCatalogResult) {
      const key = normalizeMunicipalityName(r.name);
      if (key && !munNameToId.has(key)) munNameToId.set(key, r.id);
      munIdToName.set(Number(r.id), r.name);
    }

    const previousConditions = ["TRUE"];
    const previousValues = [];

    if (companyId) {
      previousValues.push(Number(companyId));
      previousConditions.push(`company_id = $${previousValues.length}`);
    }

    if (contractId) {
      previousValues.push(Number(contractId));
      previousConditions.push(`contract_id = $${previousValues.length}`);
    }

    const previousUploadResult = await client.query(
      `
      SELECT *
      FROM coverage_uploads
      WHERE ${previousConditions.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      previousValues
    );

    const previousUpload = previousUploadResult.rows[0] || null;
    let previousRows = [];

    if (previousUpload) {
      const previousRowsResult = await client.query(
        `
        SELECT *
        FROM coverage_upload_rows
        WHERE upload_id = $1
        ORDER BY id ASC
        `,
        [previousUpload.id]
      );

      previousRows = previousRowsResult.rows;
    }

    const ignoredSuspiciousRows = [];

    const buildKey = (row) =>
      buildRowHash({
        municipality: row.municipality,
        institution: row.institution,
        site: row.site,
        modality: row.modality,
      });

    const newRowsMap = new Map();

    parsedRows.forEach((newRow) => {
      const key = buildKey(newRow);
      newRowsMap.set(key, newRow);
    });

    const finalRows = [];

    previousRows.forEach((prevRow) => {
      const key = buildKey(prevRow);
      const newRow = newRowsMap.get(key);
      const prevMunId = prevRow.municipality_id ? Number(prevRow.municipality_id) : null;

      if (!newRow) {
        finalRows.push({
          uniqueCode: prevRow.unique_code || "",
          municipality: prevRow.municipality || "",
          institution: prevRow.institution || "",
          site: prevRow.site || "",
          modality: prevRow.modality || "",
          cupos: Number(prevRow.cupos || 0),
          requiredTc: Number(prevRow.required_tc || 0),
          requiredMt: Number(prevRow.required_mt || 0),
          rawRequired: Number(prevRow.raw_required || 0),
          rowHash: key,
          updateOrigin: "HEREDADO",
          _prevMunicipalityId: prevMunId,
        });

        return;
      }

      const previousCupos = Number(prevRow.cupos || 0);
      const newCupos = Number(newRow.cupos || 0);

      if (previousCupos > 0 && newCupos <= 0) {
        ignoredSuspiciousRows.push({
          municipality: newRow.municipality,
          institution: newRow.institution,
          site: newRow.site,
          modality: newRow.modality,
          previousCupos,
          newCupos,
          reason: "CUPOS_EN_CERO_SOSPECHOSO",
        });

        finalRows.push({
          uniqueCode: prevRow.unique_code || "",
          municipality: prevRow.municipality || "",
          institution: prevRow.institution || "",
          site: prevRow.site || "",
          modality: prevRow.modality || "",
          cupos: Number(prevRow.cupos || 0),
          requiredTc: Number(prevRow.required_tc || 0),
          requiredMt: Number(prevRow.required_mt || 0),
          rawRequired: Number(prevRow.raw_required || 0),
          rowHash: key,
          updateOrigin: "HEREDADO",
          _prevMunicipalityId: prevMunId,
        });

        newRowsMap.delete(key);
        return;
      }

      const hasChanges =
        Number(prevRow.cupos || 0) !== Number(newRow.cupos || 0) ||
        Number(prevRow.required_tc || 0) !== Number(newRow.requiredTc || 0) ||
        Number(prevRow.required_mt || 0) !== Number(newRow.requiredMt || 0);

      finalRows.push({
        ...newRow,
        rowHash: key,
        updateOrigin: hasChanges ? "ACTUALIZADO" : "HEREDADO",
        _prevMunicipalityId: hasChanges ? null : prevMunId,
      });

      newRowsMap.delete(key);
    });

    newRowsMap.forEach((newRow) => {
      const key = buildKey(newRow);

      finalRows.push({
        ...newRow,
        rowHash: key,
        updateOrigin: "ACTUALIZADO",
      });
    });

    const mergedRows = finalRows;

    const totalRows = mergedRows.length;
    const totalCupos = mergedRows.reduce(
      (sum, row) => sum + Number(row.cupos || 0),
      0
    );
    const totalRequiredTc = mergedRows.reduce(
      (sum, row) => sum + Number(row.requiredTc || 0),
      0
    );
    const totalRequiredMt = mergedRows.reduce(
      (sum, row) => sum + Number(row.requiredMt || 0),
      0
    );

    const updatedRows = mergedRows.filter(
      (row) => row.updateOrigin === "ACTUALIZADO"
    ).length;

    const preservedRows = mergedRows.filter(
      (row) => row.updateOrigin === "HEREDADO"
    ).length;

    const uploadResult = await client.query(
      `
      INSERT INTO coverage_uploads (
        company_id,
        contract_id,
        period_month,
        week_number,
        original_file_name,
        stored_file_name,
        uploaded_by,
        total_rows,
        total_cupos,
        total_required_tc,
        total_required_mt
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
      `,
      [
        companyId || null,
        contractId || null,
        periodMonth || null,
        weekNumber || null,
        safeFileName,
        storedFileName,
        uploadedBy || "Sistema",
        totalRows,
        totalCupos,
        totalRequiredTc,
        totalRequiredMt,
      ]
    );

    const upload = uploadResult.rows[0];

    for (const row of mergedRows) {
      // For inherited rows carry the previously stored municipality_id to avoid
      // losing the FK when the catalog name and the stored text diverge.
      const resolvedMunicipalityId =
        (row._prevMunicipalityId > 0 ? row._prevMunicipalityId : null) ||
        munNameToId.get(normalizeMunicipalityName(row.municipality)) ||
        null;
      const canonicalMunicipalityName = resolvedMunicipalityId
        ? (munIdToName.get(Number(resolvedMunicipalityId)) || row.municipality)
        : row.municipality;

      // New rows from the Excel must resolve to a known municipality — skip them
      // if the municipality name is not in the catalog (item 8 hardening).
      if (!resolvedMunicipalityId && row.updateOrigin === "ACTUALIZADO") {
        ignoredSuspiciousRows.push({
          municipality: row.municipality,
          institution: row.institution,
          site: row.site,
          modality: row.modality,
          reason: "MUNICIPIO_NO_RESUELTO",
        });
        continue;
      }

      await client.query(
        `
        INSERT INTO coverage_upload_rows (
          upload_id,
          unique_code,
          municipality,
          institution,
          site,
          modality,
          cupos,
          required_tc,
          required_mt,
          raw_required,
          row_hash,
          update_origin,
          municipality_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        `,
        [
          upload.id,
          row.uniqueCode || "",
          canonicalMunicipalityName,
          row.institution,
          row.site,
          row.modality,
          row.cupos,
          row.requiredTc,
          row.requiredMt,
          row.rawRequired,
          row.rowHash,
          row.updateOrigin,
          resolvedMunicipalityId,
        ]
      );
    }

    await client.query("COMMIT");

    return {
      upload,
      rows: mergedRows,
      summary: {
        totalRows,
        totalCupos,
        totalRequiredTc,
        totalRequiredMt,
        updatedRows,
        preservedRows,
        ignoredSuspiciousRows,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
        warnings.push(`Empleado sin tipo de jornada: ${employee.full_name || employee.document_number || employee.id}`);
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

function getCoverageAssignedPersonnel({
  contract_id,
  municipality_id,
  institution_id,
  site_id,
  modality,
  municipality,
  institution,
  site,
}, employeeIndex = { byIdKey: new Map(), byTextKey: new Map() }) {
  const idKey = makeCoverageIdKey({
    contract_id,
    municipality_id,
    institution_id,
    site_id,
    modality,
  });
  const employees = idKey && employeeIndex.byIdKey.has(idKey)
    ? employeeIndex.byIdKey.get(idKey)
    : [];

  return buildAssignedPersonnelSummary(employees);
}

async function getActiveEmployeeCoverageIndex(currentUpload) {
  const conditions = [
    `${SQL_NORMALIZE_TEXT("e.status")} IN ('ACTIVO', 'VINCULADO', 'EN CONTRATO')`,
    "e.site_id IS NOT NULL",
  ];

  const values = [];

  if (currentUpload.company_id) {
    values.push(currentUpload.company_id);
    conditions.push(`e.company_id = $${values.length}`);
  }

  if (currentUpload.contract_id) {
    values.push(currentUpload.contract_id);
    conditions.push(`e.contract_id = $${values.length}`);
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
      e.modality,
      m.name AS municipality_name,
      i.name AS institution_name,
      s.name AS site_name
    FROM employees e
    LEFT JOIN municipalities m ON m.id = e.municipality_id
    LEFT JOIN institutions i ON i.id = e.institution_id
    LEFT JOIN educational_sites s ON s.id = e.site_id
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
      modality: row.modality || "",
    };

    const idKey = makeCoverageIdKey(row);
    const textKey = makeCoverageTextKey({
      contract_id: row.contract_id,
      municipality: row.municipality_name,
      institution: row.institution_name,
      site: row.site_name,
      modality: row.modality,
    });
    const siteIdKey = makeCoverageSiteIdKey(row);
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
  const rTc = Number(requiredTc   || 0);
  const rMt = Number(requiredMt   || 0);
  const cTc = Number(contractedTc || 0);
  const cMt = Number(contractedMt || 0);

  const tcDiff = cTc - rTc;
  const mtDiff = cMt - rMt;

  // Totales iguales pero distribución TC/MT incorrecta
  if ((cTc + cMt) === (rTc + rMt) && (tcDiff !== 0 || mtDiff !== 0)) return "MAL_CONTRATADO";
  if (tcDiff < 0 || mtDiff < 0) return "FALTANTE";
  if (tcDiff > 0 || mtDiff > 0) return "SOBRANTE";
  return "CUMPLE";
}

async function getCoverageRowsByUpload(uploadId, municipalityIds = null) {
  const uploadResult = await pool.query(
    `SELECT * FROM coverage_uploads WHERE id = $1`,
    [uploadId]
  );

  const currentUpload = uploadResult.rows[0];

  if (!currentUpload) {
    return [];
  }

  const hasMunFilter = Array.isArray(municipalityIds) && municipalityIds.length > 0;
  const municipalityNames = [];
  const rowParams = hasMunFilter
    ? [uploadId, municipalityNames.map(n => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim())]
    : [uploadId];
  const ACCENT_FROM = "ÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑÇ";
  const ACCENT_TO   = "AAAAAAEEEEIIIIOOOOOOUUUUYNC";
  const munCondition = hasMunFilter
    ? ` AND REGEXP_REPLACE(translate(UPPER(TRIM(municipality)),'${ACCENT_FROM}','${ACCENT_TO}'),'[^A-Z0-9 ]','','g') = ANY(
          SELECT REGEXP_REPLACE(translate(UPPER(TRIM(unnest($2::text[]))),'${ACCENT_FROM}','${ACCENT_TO}'),'[^A-Z0-9 ]','','g')
        )`
    : "";
  const scopedMunicipalityIds = hasMunFilter
    ? municipalityIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  const municipalityFilterSql = scopedMunicipalityIds.length
    ? ` AND municipality_id = ANY($2::int[])`
    : "";
  if (scopedMunicipalityIds.length) {
    rowParams[1] = scopedMunicipalityIds;
  }

  const currentRowsResult = await pool.query(
    `SELECT * FROM coverage_upload_rows
     WHERE upload_id = $1${municipalityFilterSql}
     ORDER BY municipality, institution, site, modality, unique_code`,
    rowParams
  );

  const currentRows = currentRowsResult.rows;
  const currentRowIds = currentRows.map((row) => Number(row.id)).filter(Boolean);
  const rowMetadata = new Map();
  if (currentRowIds.length) {
    const metadataResult = await pool.query(
      `
      SELECT
        r.id AS row_id,
        COALESCE(r.municipality_id, m.id) AS municipality_id,
        i.id AS institution_id,
        s.id AS site_id
      FROM coverage_upload_rows r
      LEFT JOIN municipalities m
        ON m.id = r.municipality_id
      LEFT JOIN institutions i
        ON ${SQL_NORMALIZE_TEXT("i.name")} = ${SQL_NORMALIZE_TEXT("r.institution")}
       AND (COALESCE(r.municipality_id, m.id) IS NULL OR i.municipality_id = COALESCE(r.municipality_id, m.id))
      LEFT JOIN educational_sites s
        ON ${SQL_NORMALIZE_TEXT("s.name")} = ${SQL_NORMALIZE_TEXT("r.site")}
       AND (i.id IS NULL OR s.institution_id = i.id)
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
      `
      SELECT *
      FROM coverage_upload_rows
      WHERE upload_id = $1
      `,
      [previousUpload.id]
    );

    previousRows = previousRowsResult.rows;
  }

  const previousMap = new Map();

  previousRows.forEach((row) => {
    const key = buildRowHash({
      uniqueCode: row.unique_code || "",
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
      uniqueCode: row.unique_code || "",
      municipality: row.municipality,
      institution: row.institution,
      site: row.site,
      modality: row.modality,
    });

    const previous = previousMap.get(key);

    const previousCupos = Number(previous?.cupos || 0);
    const currentCupos = Number(row.cupos || 0);

    const previousRequiredTc = Number(previous?.required_tc || 0);
    const currentRequiredTc = Number(row.required_tc || 0);

    const previousRequiredMt = Number(previous?.required_mt || 0);
    const currentRequiredMt = Number(row.required_mt || 0);

    const cuposDelta = previous ? currentCupos - previousCupos : null;
    const requiredTcDelta = previous ? currentRequiredTc - previousRequiredTc : null;
    const requiredMtDelta = previous ? currentRequiredMt - previousRequiredMt : null;

    let changeStatus = "SIN_COMPARACION";

    if (previous) {
      if (cuposDelta > 0) {
        changeStatus = "SUBIO";
      } else if (cuposDelta < 0) {
        changeStatus = "BAJO";
      } else {
        // Cupos sin cambio: evaluar personal requerido como indicador secundario
        if (requiredTcDelta > 0 || requiredMtDelta > 0) {
          changeStatus = "SUBIO";
        } else if (requiredTcDelta < 0 || requiredMtDelta < 0) {
          changeStatus = "BAJO";
        } else {
          changeStatus = "SIN_CAMBIO";
        }
      }
    }

    const metadata = rowMetadata.get(Number(row.id)) || {};
    // Preferir municipality_id almacenado en la fila (resuelto al importar) sobre el del JOIN de texto.
    const resolvedMunId = row.municipality_id ?? metadata.municipality_id ?? null;
    const employeeCoverage = getCoverageAssignedPersonnel({
      contract_id: currentUpload.contract_id,
      municipality_id: resolvedMunId,
      institution_id: metadata.institution_id,
      site_id: metadata.site_id,
      modality: row.modality,
      municipality: row.municipality,
      institution: row.institution,
      site: row.site,
    }, employeeCoverageIndex);

    const rowSiteIdKey = makeCoverageSiteIdKey({
      contract_id: currentUpload.contract_id,
      municipality_id: resolvedMunId,
      institution_id: metadata.institution_id,
      site_id: metadata.site_id,
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

    const tcDifference =
      Number(employeeCoverage.tc_contratado || 0) - Number(row.required_tc || 0);

    const mtDifference =
      Number(employeeCoverage.mt_contratado || 0) - Number(row.required_mt || 0);

    const coverageStatus = getCoverageStatus({
      requiredTc: row.required_tc,
      requiredMt: row.required_mt,
      contractedTc: employeeCoverage.tc_contratado,
      contractedMt: employeeCoverage.mt_contratado,
    });

    return {
      ...row,
      previous_upload_id: previousUpload?.id || null,
      previous_cupos: previous ? previousCupos : null,
      cupos_delta: cuposDelta,
      previous_required_tc: previous ? previousRequiredTc : null,
      required_tc_delta: requiredTcDelta,
      previous_required_mt: previous ? previousRequiredMt : null,
      required_mt_delta: requiredMtDelta,
      change_status: changeStatus,

      municipality_id: resolvedMunId,
      institution_id: metadata.institution_id || null,
      site_id: metadata.site_id || null,
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

module.exports = {
  calculateRequiredPersonnel,
  saveCoverageUpload,
  getCoverageHistory,
  getCoverageRowsByUpload,
  getCoverageAssignedPersonnel,
};
