const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");
const pool = require("../../db/pool");

const uploadsDir = path.join(__dirname, "../../../uploads/coverage");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
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

function isActiveStatus(status) {
  const value = normalize(status);
  return !["RETIRADO", "RETIRADA", "INACTIVO", "INACTIVA"].includes(value);
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
          update_origin
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `,
        [
          upload.id,
          row.uniqueCode || "",
          row.municipality,
          row.institution,
          row.site,
          row.modality,
          row.cupos,
          row.requiredTc,
          row.requiredMt,
          row.rawRequired,
          row.rowHash,
          row.updateOrigin,
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

async function getActiveEmployeesForCoverage(currentUpload) {
  const conditions = [
    "e.status IS NOT NULL",
    "e.status NOT IN ('retirado', 'retirada', 'inactivo', 'inactiva')",
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
      e.status,
      e.real_position,
      e.workday_type,
      e.modality,
      m.name AS municipality_name,
      i.name AS institution_name,
      s.name AS site_name
    FROM employees e
    LEFT JOIN municipalities m ON m.id = e.municipality_id
    LEFT JOIN institutions i ON i.id = e.institution_id
    LEFT JOIN educational_sites s ON s.id = e.site_id
    WHERE ${conditions.join(" AND ")}
    `,
    values
  );

  return result.rows.filter((row) => isActiveStatus(row.status));
}

function buildEmployeeCoverageMap(employees = []) {
  const map = new Map();

  employees.forEach((employee) => {
    const key = [
      normalize(employee.municipality_name),
      normalize(employee.institution_name),
      normalize(employee.site_name),
      normalize(employee.modality),
    ].join("|");

    if (!map.has(key)) {
      map.set(key, {
        activePersonnel: 0,
        contractedTc: 0,
        contractedMt: 0,
      });
    }

    const item = map.get(key);
    item.activePersonnel += 1;

    const workdayType = normalize(employee.workday_type);

    if (workdayType === "MT" || workdayType.includes("MEDIO")) {
      item.contractedMt += 1;
    } else {
      item.contractedTc += 1;
    }
  });

  return map;
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

async function getCoverageRowsByUpload(uploadId, municipalityNames = null) {
  const uploadResult = await pool.query(
    `SELECT * FROM coverage_uploads WHERE id = $1`,
    [uploadId]
  );

  const currentUpload = uploadResult.rows[0];

  if (!currentUpload) {
    return [];
  }

  const hasMunFilter = Array.isArray(municipalityNames) && municipalityNames.length > 0;
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

  const currentRowsResult = await pool.query(
    `SELECT * FROM coverage_upload_rows
     WHERE upload_id = $1${munCondition}
     ORDER BY municipality, institution, site, modality, unique_code`,
    rowParams
  );

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

  const employees = await getActiveEmployeesForCoverage(currentUpload);
  const employeeCoverageMap = buildEmployeeCoverageMap(employees);

  return currentRowsResult.rows.map((row) => {
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

    const employeeKey = [
      normalize(row.municipality),
      normalize(row.institution),
      normalize(row.site),
      normalize(row.modality),
    ].join("|");

    const employeeCoverage = employeeCoverageMap.get(employeeKey) || {
      activePersonnel: 0,
      contractedTc: 0,
      contractedMt: 0,
    };

    const tcDifference =
      Number(employeeCoverage.contractedTc || 0) - Number(row.required_tc || 0);

    const mtDifference =
      Number(employeeCoverage.contractedMt || 0) - Number(row.required_mt || 0);

    const coverageStatus = getCoverageStatus({
      requiredTc: row.required_tc,
      requiredMt: row.required_mt,
      contractedTc: employeeCoverage.contractedTc,
      contractedMt: employeeCoverage.contractedMt,
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

      active_personnel: employeeCoverage.activePersonnel,
      contracted_tc: employeeCoverage.contractedTc,
      contracted_mt: employeeCoverage.contractedMt,
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
};