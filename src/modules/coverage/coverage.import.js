"use strict";

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const XLSX = require("xlsx");
const pool = require("../../db/pool");
const { listMunicipalities } = require("../../db/municipalities.repository");
const {
  analyzeCoverageImportRows,
  buildReferenceCatalog,
  buildRowHash,
  calculateRequiredPersonnel,
  chooseImportResolution,
  getPeriodBounds,
  indexDecisions,
  normalize,
  normalizeSql,
  toDateOnly,
} = require("./coverage-history");

const uploadsDir = path.join(__dirname, "../../../uploads/coverage");
const pendingDir = path.join(uploadsDir, "pending");

for (const dir of [uploadsDir, pendingDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

function normalizeHeader(value) {
  return normalize(value);
}

function parseCoverageExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames.find((name) => normalize(name) === "COBERTURA");

  if (!sheetName) {
    throw new Error("El archivo no contiene una hoja llamada 'COBERTURA'.");
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

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

  return matrix
    .slice(headerIndex + 1)
    .map((row) => {
      const uniqueCode = cleanText(row[idxUnique]);
      const municipality = cleanText(row[idxMunicipality]);
      const institution = cleanText(row[idxInstitution]);
      const site = cleanText(row[idxSite]);
      const modality = cleanText(row[idxModality]);
      const cupos = toNumber(row[idxCupos]);

      if (!municipality && !institution && !site && !modality && !cupos) return null;
      if (!municipality || !institution || !site || !modality) return null;

      return {
        uniqueCode,
        municipality,
        institution,
        site,
        modality,
        cupos,
        ...calculateRequiredPersonnel(cupos, modality),
        rowHash: buildRowHash({ municipality, institution, site, modality }),
      };
    })
    .filter(Boolean);
}

function getSafeFileName(fileName) {
  return String(fileName || "cobertura.xlsx")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
}

function savePendingSession(sessionToken, payload) {
  const sessionPath = path.join(pendingDir, `${sessionToken}.json`);
  fs.writeFileSync(sessionPath, JSON.stringify(payload, null, 2), "utf8");
  return sessionPath;
}

function readPendingSession(sessionToken) {
  const sessionPath = path.join(pendingDir, `${sessionToken}.json`);
  if (!fs.existsSync(sessionPath)) return null;
  return JSON.parse(fs.readFileSync(sessionPath, "utf8"));
}

function deletePendingSession(sessionToken) {
  const sessionPath = path.join(pendingDir, `${sessionToken}.json`);
  if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
}

async function loadReferenceCatalog(client, periodMonth) {
  const [municipalities, institutionsResult, sitesResult, codeHistoryResult, modalityHistoryResult] =
    await Promise.all([
      listMunicipalities({}, client),
      client.query(`
        SELECT i.id, i.name, i.municipality_id, m.name AS municipality_name
        FROM institutions i
        LEFT JOIN municipalities m ON m.id = i.municipality_id
      `),
      client.query(`
        SELECT
          s.id AS site_id,
          s.name AS site_name,
          i.id AS institution_id,
          i.name AS institution_name,
          i.municipality_id,
          m.name AS municipality_name
        FROM educational_sites s
        JOIN institutions i ON i.id = s.institution_id
        LEFT JOIN municipalities m ON m.id = i.municipality_id
      `),
      client.query(`SELECT * FROM site_code_history ORDER BY site_id, valid_from, id`),
      client.query(`SELECT * FROM site_modality_history ORDER BY site_id, valid_from, id`),
    ]);

  return buildReferenceCatalog({
    municipalities,
    institutions: institutionsResult.rows,
    sites: sitesResult.rows,
    codeHistory: codeHistoryResult.rows,
    modalityHistory: modalityHistoryResult.rows,
    periodMonth,
  });
}

function buildDetectionPayload({ row, analysis }) {
  return (analysis.detections || []).map((detection) => ({
    key: detection.key,
    rowHash: analysis.rowHash,
    rowIndex: analysis.rowIndex,
    changeType: detection.changeType,
    message: detection.message,
    municipality: row.municipality,
    institution: row.institution,
    site: row.site,
    municipalityId: analysis.municipalityId || null,
    institutionId: analysis.matchedInstitutionId || null,
    siteId: analysis.matchedSiteId || null,
    previousOfficialCode: detection.previousOfficialCode || null,
    newOfficialCode: detection.newOfficialCode || row.uniqueCode || null,
    previousModality: detection.previousModality || null,
    newModality: detection.newModality || row.modality || null,
    effectiveDate: detection.effectiveDate || null,
    suggestedAction: detection.suggestedAction || null,
  }));
}

async function persistPendingAudit(client, {
  sessionToken,
  companyId,
  contractId,
  periodMonth,
  sourceFileName,
  detections,
}) {
  await client.query(`DELETE FROM coverage_change_audit WHERE session_token = $1`, [sessionToken]);

  for (const detection of detections) {
    await client.query(
      `
      INSERT INTO coverage_change_audit (
        session_token,
        company_id,
        contract_id,
        period_month,
        municipality_id,
        institution_id,
        site_id,
        municipality_name,
        institution_name,
        site_name,
        previous_official_code,
        new_official_code,
        previous_modality,
        new_modality,
        effective_date,
        source_file_name,
        status,
        change_type,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending',$17,$18::jsonb)
      `,
      [
        sessionToken,
        companyId || null,
        contractId || null,
        periodMonth || null,
        detection.municipalityId || null,
        detection.institutionId || null,
        detection.siteId || null,
        detection.municipality || null,
        detection.institution || null,
        detection.site || null,
        detection.previousOfficialCode || null,
        detection.newOfficialCode || null,
        detection.previousModality || null,
        detection.newModality || null,
        detection.effectiveDate || null,
        sourceFileName || null,
        detection.changeType,
        JSON.stringify({
          key: detection.key,
          rowHash: detection.rowHash,
          rowIndex: detection.rowIndex,
          suggestedAction: detection.suggestedAction || null,
        }),
      ]
    );
  }
}

function ensureDecisionsPresent(detections = [], decisionMap = new Map()) {
  const missing = [];
  for (const detection of detections) {
    if (!decisionMap.has(String(detection.key))) missing.push(detection.key);
  }
  return missing;
}

async function ensureInstitution(client, catalog, municipalityId, institutionName) {
  const key = [String(municipalityId || ""), normalizeSql(institutionName)].join("|");
  const existing = catalog.institutionsByKey.get(key);
  if (existing) return existing;

  const insertResult = await client.query(
    `
    INSERT INTO institutions (municipality_id, name, active)
    VALUES ($1, $2, true)
    RETURNING id, name, municipality_id
    `,
    [municipalityId || null, institutionName]
  );

  const institution = insertResult.rows[0];
  catalog.institutionsByKey.set(key, institution);
  catalog.institutionById.set(Number(institution.id), institution);
  return institution;
}

async function ensureSite(client, catalog, institution, municipalityId, institutionName, siteName) {
  const key = [String(municipalityId || ""), normalizeSql(institutionName), normalizeSql(siteName)].join("|");
  const existing = catalog.siteByNameKey.get(key);
  if (existing) return existing;

  try {
    const insertResult = await client.query(
      `
      INSERT INTO educational_sites (institution_id, name)
      VALUES ($1, $2)
      RETURNING id AS site_id, name AS site_name
      `,
      [institution.id, siteName]
    );

    const site = {
      site_id: insertResult.rows[0].site_id,
      site_name: insertResult.rows[0].site_name,
      institution_id: Number(institution.id),
      institution_name: institution.name,
      municipality_id: municipalityId || null,
    };

    catalog.siteByNameKey.set(key, site);
    catalog.siteById.set(Number(site.site_id), site);
    return site;
  } catch (error) {
    if (!String(error.message || "").includes("educational_sites_institution_id_name_key")) throw error;
    const lookupResult = await client.query(
      `
      SELECT
        s.id AS site_id,
        s.name AS site_name,
        i.id AS institution_id,
        i.name AS institution_name,
        i.municipality_id
      FROM educational_sites s
      JOIN institutions i ON i.id = s.institution_id
      WHERE s.institution_id = $1
        AND UPPER(TRIM(s.name)) = UPPER(TRIM($2))
      LIMIT 1
      `,
      [institution.id, siteName]
    );
    const site = lookupResult.rows[0];
    if (!site) throw error;
    catalog.siteByNameKey.set(key, site);
    catalog.siteById.set(Number(site.site_id), site);
    return site;
  }
}

async function applySiteCodeHistory(client, {
  siteId,
  officialCode,
  effectiveDate,
  source,
  createdBy,
}) {
  const code = cleanText(officialCode);
  if (!siteId || !code || !effectiveDate) return;

  const currentResult = await client.query(
    `
    SELECT *
    FROM site_code_history
    WHERE site_id = $1
      AND valid_from <= $2
      AND (valid_to IS NULL OR valid_to >= $2)
    ORDER BY valid_from DESC, id DESC
    LIMIT 1
    `,
    [siteId, effectiveDate]
  );

  const current = currentResult.rows[0] || null;
  if (current && normalizeSql(current.official_code) === normalizeSql(code)) return;

  await client.query(
    `
    UPDATE site_code_history
    SET valid_to = ($2::date - INTERVAL '1 day')::date
    WHERE site_id = $1
      AND valid_from <= $2
      AND (valid_to IS NULL OR valid_to >= $2)
    `,
    [siteId, effectiveDate]
  );

  await client.query(
    `
    INSERT INTO site_code_history (site_id, official_code, valid_from, source, created_by)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [siteId, code, effectiveDate, source || null, createdBy || null]
  );
}

async function applySiteModalityHistory(client, {
  siteId,
  modality,
  effectiveDate,
  source,
  createdBy,
}) {
  const value = cleanText(modality);
  if (!siteId || !value || !effectiveDate) return;

  const currentResult = await client.query(
    `
    SELECT *
    FROM site_modality_history
    WHERE site_id = $1
      AND valid_from <= $2
      AND (valid_to IS NULL OR valid_to >= $2)
    ORDER BY valid_from DESC, id DESC
    LIMIT 1
    `,
    [siteId, effectiveDate]
  );

  const current = currentResult.rows[0] || null;
  if (current && normalizeSql(current.modality) === normalizeSql(value)) return;

  await client.query(
    `
    UPDATE site_modality_history
    SET valid_to = ($2::date - INTERVAL '1 day')::date
    WHERE site_id = $1
      AND valid_from <= $2
      AND (valid_to IS NULL OR valid_to >= $2)
    `,
    [siteId, effectiveDate]
  );

  await client.query(
    `
    INSERT INTO site_modality_history (site_id, modality, valid_from, source, created_by)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [siteId, value, effectiveDate, source || null, createdBy || null]
  );
}

async function updateAuditAfterConfirmation(client, {
  sessionToken,
  uploadId,
  confirmedBy,
  decisions = [],
}) {
  const decisionMap = indexDecisions(decisions);
  const pendingResult = await client.query(
    `SELECT id, change_type, metadata FROM coverage_change_audit WHERE session_token = $1`,
    [sessionToken]
  );

  for (const row of pendingResult.rows) {
    const metadata = row.metadata || {};
    const decision = decisionMap.get(String(metadata.key)) || {};
    const action = String(decision.action || "");
    const status = action === "keep_current" ? "rejected" : "confirmed";

    await client.query(
      `
      UPDATE coverage_change_audit
      SET
        upload_id = $2,
        confirmed_by = $3,
        confirmed_at = NOW(),
        effective_date = COALESCE($4, effective_date),
        status = $5,
        metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb
      WHERE id = $1
      `,
      [
        row.id,
        uploadId || null,
        confirmedBy || null,
        decision.validFrom || decision.effectiveDate || null,
        status,
        JSON.stringify({ decision }),
      ]
    );
  }
}

function buildMergedRows(previousRows, parsedRows, analysesByHash) {
  const newRowsMap = new Map();
  for (const row of parsedRows) {
    newRowsMap.set(row.rowHash, {
      ...row,
      analysis: analysesByHash.get(row.rowHash) || null,
    });
  }

  const finalRows = [];
  const ignoredSuspiciousRows = [];

  for (const prevRow of previousRows) {
    const key = buildRowHash({
      municipality: prevRow.municipality,
      institution: prevRow.institution,
      site: prevRow.site,
      modality: prevRow.modality,
    });
    const newRow = newRowsMap.get(key);

    if (!newRow) {
      finalRows.push({
        uniqueCode: prevRow.unique_code || prevRow.official_code || "",
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
        municipalityId: prevRow.municipality_id ? Number(prevRow.municipality_id) : null,
        institutionId: prevRow.institution_id ? Number(prevRow.institution_id) : null,
        siteId: prevRow.site_id ? Number(prevRow.site_id) : null,
        officialCode: prevRow.official_code || prevRow.unique_code || "",
        resolutionSource: prevRow.resolution_source || "HEREDADO",
      });
      continue;
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
        uniqueCode: prevRow.unique_code || prevRow.official_code || "",
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
        municipalityId: prevRow.municipality_id ? Number(prevRow.municipality_id) : null,
        institutionId: prevRow.institution_id ? Number(prevRow.institution_id) : null,
        siteId: prevRow.site_id ? Number(prevRow.site_id) : null,
        officialCode: prevRow.official_code || prevRow.unique_code || "",
        resolutionSource: prevRow.resolution_source || "HEREDADO",
      });

      newRowsMap.delete(key);
      continue;
    }

    const hasChanges =
      Number(prevRow.cupos || 0) !== Number(newRow.cupos || 0) ||
      Number(prevRow.required_tc || 0) !== Number(newRow.requiredTc || 0) ||
      Number(prevRow.required_mt || 0) !== Number(newRow.requiredMt || 0) ||
      normalizeSql(prevRow.modality || "") !== normalizeSql(newRow.modality || "") ||
      normalizeSql(prevRow.official_code || prevRow.unique_code || "") !== normalizeSql(newRow.uniqueCode || "");

    finalRows.push({
      ...newRow,
      updateOrigin: hasChanges ? "ACTUALIZADO" : "HEREDADO",
      municipalityId: hasChanges ? null : (prevRow.municipality_id ? Number(prevRow.municipality_id) : null),
      institutionId: hasChanges ? null : (prevRow.institution_id ? Number(prevRow.institution_id) : null),
      siteId: hasChanges ? null : (prevRow.site_id ? Number(prevRow.site_id) : null),
      officialCode: hasChanges ? (newRow.uniqueCode || "") : (prevRow.official_code || prevRow.unique_code || ""),
      resolutionSource: hasChanges ? null : (prevRow.resolution_source || "HEREDADO"),
    });
    newRowsMap.delete(key);
  }

  for (const newRow of newRowsMap.values()) {
    finalRows.push({
      ...newRow,
      updateOrigin: "ACTUALIZADO",
      officialCode: newRow.uniqueCode || "",
    });
  }

  return { finalRows, ignoredSuspiciousRows };
}

async function persistCoverageUpload(client, {
  companyId,
  contractId,
  periodMonth,
  weekNumber,
  safeFileName,
  storedFileName,
  uploadedBy,
  parsedRows,
  decisions = [],
  sessionToken = null,
}) {
  const catalog = await loadReferenceCatalog(client, periodMonth);
  const analyses = analyzeCoverageImportRows(parsedRows, catalog, { periodMonth });
  const detections = analyses.flatMap((analysis, index) =>
    buildDetectionPayload({ row: parsedRows[index], analysis })
  );
  const decisionMap = indexDecisions(decisions);
  const missingDecisions = ensureDecisionsPresent(detections, decisionMap);

  if (detections.length && missingDecisions.length) {
    throw new Error("Faltan decisiones de confirmación para cambios detectados en cobertura.");
  }

  const previousValues = [];
  const previousConditions = ["TRUE"];
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
      `SELECT * FROM coverage_upload_rows WHERE upload_id = $1 ORDER BY id ASC`,
      [previousUpload.id]
    );
    previousRows = previousRowsResult.rows;
  }

  const analysesByHash = new Map(analyses.map((analysis) => [analysis.rowHash, analysis]));
  const { finalRows, ignoredSuspiciousRows } = buildMergedRows(previousRows, parsedRows, analysesByHash);

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
      finalRows.length,
      finalRows.reduce((sum, row) => sum + Number(row.cupos || 0), 0),
      finalRows.reduce((sum, row) => sum + Number(row.requiredTc || 0), 0),
      finalRows.reduce((sum, row) => sum + Number(row.requiredMt || 0), 0),
    ]
  );

  const upload = uploadResult.rows[0];
  const effectiveDate = toDateOnly(getPeriodBounds(periodMonth)?.effectiveDate || new Date());

  for (const row of finalRows) {
    let municipalityId = row.municipalityId || null;
    let institutionId = row.institutionId || null;
    let siteId = row.siteId || null;
    let officialCode = row.officialCode || row.uniqueCode || "";
    let resolutionSource = row.resolutionSource || null;

    if (row.updateOrigin === "ACTUALIZADO") {
      const analysis = row.analysis || analysesByHash.get(row.rowHash);
      const resolution = chooseImportResolution(analysis || {}, decisionMap);

      municipalityId = resolution.municipalityId || municipalityId;
      if (!municipalityId) {
        ignoredSuspiciousRows.push({
          municipality: row.municipality,
          institution: row.institution,
          site: row.site,
          modality: row.modality,
          reason: "MUNICIPIO_NO_RESUELTO",
        });
        continue;
      }

      let institution;
      if (resolution.institutionId) {
        institution = catalog.institutionById.get(Number(resolution.institutionId)) || null;
      }
      if (!institution) {
        institution = await ensureInstitution(client, catalog, municipalityId, row.institution);
      }

      let site;
      if (resolution.action === "reuse_site" && resolution.siteId) {
        site = catalog.siteById.get(Number(resolution.siteId)) || null;
      }
      if (!site) {
        site = await ensureSite(client, catalog, institution, municipalityId, row.institution, row.site);
      }

      institutionId = Number(site.institution_id || institution.id);
      siteId = Number(site.site_id);
      resolutionSource = resolution.resolutionSource || resolutionSource || "OFFICIAL_CODE";
      officialCode = row.uniqueCode || officialCode || "";

      await applySiteCodeHistory(client, {
        siteId,
        officialCode,
        effectiveDate: resolution.codeChange?.effectiveDate || effectiveDate,
        source: safeFileName,
        createdBy: uploadedBy,
      });

      const modalityAction = resolution.modalityChange?.action || "register_modality_change";
      if (modalityAction !== "keep_current") {
        await applySiteModalityHistory(client, {
          siteId,
          modality: row.modality,
          effectiveDate: resolution.modalityChange?.effectiveDate || effectiveDate,
          source: safeFileName,
          createdBy: uploadedBy,
        });
      }
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
        municipality_id,
        institution_id,
        site_id,
        official_code,
        resolution_source
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
        municipalityId || null,
        institutionId || null,
        siteId || null,
        officialCode || null,
        resolutionSource || null,
      ]
    );
  }

  if (sessionToken) {
    await updateAuditAfterConfirmation(client, {
      sessionToken,
      uploadId: upload.id,
      confirmedBy: uploadedBy,
      decisions,
    });
  }

  return {
    upload,
    rows: finalRows,
    summary: {
      totalRows: finalRows.length,
      totalCupos: finalRows.reduce((sum, row) => sum + Number(row.cupos || 0), 0),
      totalRequiredTc: finalRows.reduce((sum, row) => sum + Number(row.requiredTc || 0), 0),
      totalRequiredMt: finalRows.reduce((sum, row) => sum + Number(row.requiredMt || 0), 0),
      updatedRows: finalRows.filter((row) => row.updateOrigin === "ACTUALIZADO").length,
      preservedRows: finalRows.filter((row) => row.updateOrigin === "HEREDADO").length,
      ignoredSuspiciousRows,
      detectedChanges: detections,
    },
  };
}

async function startCoverageUploadSession({
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
  if (!base64Data) throw new Error("Archivo Excel inválido.");

  const safeFileName = getSafeFileName(fileName);
  const storedFileName = `coverage_${Date.now()}_${safeFileName}`;
  const filePath = path.join(uploadsDir, storedFileName);
  fs.writeFileSync(filePath, base64Data, "base64");

  const parsedRows = parseCoverageExcel(filePath);
  if (!parsedRows.length) throw new Error("El archivo no tiene registros válidos.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const catalog = await loadReferenceCatalog(client, periodMonth);
    const analyses = analyzeCoverageImportRows(parsedRows, catalog, { periodMonth });
    const detections = analyses.flatMap((analysis, index) =>
      buildDetectionPayload({ row: parsedRows[index], analysis })
    );

    if (detections.length) {
      const sessionToken = randomUUID();
      savePendingSession(sessionToken, {
        sessionToken,
        companyId,
        contractId,
        periodMonth,
        weekNumber,
        safeFileName,
        storedFileName,
        uploadedBy,
        parsedRows,
      });

      await persistPendingAudit(client, {
        sessionToken,
        companyId,
        contractId,
        periodMonth,
        sourceFileName: safeFileName,
        detections,
      });

      await client.query("COMMIT");

      return {
        requiresConfirmation: true,
        confirmationToken: sessionToken,
        detectedChanges: detections,
        message: "Se detectaron cambios de código o modalidad. Confirma cómo deben registrarse antes de guardar la cobertura.",
      };
    }

    const result = await persistCoverageUpload(client, {
      companyId,
      contractId,
      periodMonth,
      weekNumber,
      safeFileName,
      storedFileName,
      uploadedBy,
      parsedRows,
      decisions: [],
    });

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function confirmCoverageUpload({
  confirmationToken,
  changeDecisions,
  uploadedBy,
}) {
  if (!confirmationToken) {
    throw new Error("Debes enviar el token de confirmación de cobertura.");
  }

  const session = readPendingSession(confirmationToken);
  if (!session) {
    throw new Error("La sesión de confirmación ya no existe o expiró.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await persistCoverageUpload(client, {
      companyId: session.companyId,
      contractId: session.contractId,
      periodMonth: session.periodMonth,
      weekNumber: session.weekNumber,
      safeFileName: session.safeFileName,
      storedFileName: session.storedFileName,
      uploadedBy: uploadedBy || session.uploadedBy,
      parsedRows: session.parsedRows,
      decisions: changeDecisions || [],
      sessionToken: confirmationToken,
    });

    await client.query("COMMIT");
    deletePendingSession(confirmationToken);
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function saveCoverageUpload(payload) {
  if (payload?.confirmationToken) {
    return confirmCoverageUpload(payload);
  }
  return startCoverageUploadSession(payload);
}

async function getCoverageAudit(filters = {}) {
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
  if (filters.status) {
    values.push(String(filters.status));
    conditions.push(`status = $${values.length}`);
  }

  const result = await pool.query(
    `
    SELECT *
    FROM coverage_change_audit
    WHERE ${conditions.join(" AND ")}
    ORDER BY detected_at DESC, id DESC
    LIMIT 200
    `,
    values
  );

  return result.rows;
}

module.exports = {
  getCoverageAudit,
  parseCoverageExcel,
  saveCoverageUpload,
};
