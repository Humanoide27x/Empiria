"use strict";

const crypto = require("crypto");

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase()
    .trim();
}

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

function normalizeOfficialCode(value) {
  return normalizeSql(value);
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

function getPeriodBounds(periodMonth) {
  const raw = String(periodMonth || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return null;
  }

  const periodStart = new Date(Date.UTC(year, monthIndex, 1));
  const periodEnd = new Date(Date.UTC(year, monthIndex + 1, 0));
  const effectiveDate = new Date(Date.UTC(year, monthIndex, 1));

  return { periodStart, periodEnd, effectiveDate };
}

function toDateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function isDateWithinRange(target, validFrom, validTo) {
  const targetDate = toDateOnly(target);
  const fromDate = toDateOnly(validFrom);
  const toDate = toDateOnly(validTo);
  if (!targetDate || !fromDate) return false;
  if (targetDate < fromDate) return false;
  if (toDate && targetDate > toDate) return false;
  return true;
}

function pickHistoryRecord(records, targetDate) {
  const list = Array.isArray(records) ? records : [];
  const dated = list.filter((record) => isDateWithinRange(targetDate, record.valid_from, record.valid_to));
  if (dated.length) {
    dated.sort((a, b) => {
      const left = toDateOnly(b.valid_from) || "";
      const right = toDateOnly(a.valid_from) || "";
      return left.localeCompare(right);
    });
    return dated[0];
  }

  const fallback = list
    .filter((record) => toDateOnly(record.valid_from))
    .sort((a, b) => {
      const left = toDateOnly(b.valid_from) || "";
      const right = toDateOnly(a.valid_from) || "";
      return left.localeCompare(right);
    });

  return fallback[0] || null;
}

function buildSiteNameKey({ municipality_id, institution, site }) {
  return [
    String(municipality_id || ""),
    normalizeSql(institution),
    normalizeSql(site),
  ].join("|");
}

function buildReferenceCatalog({
  municipalities = [],
  institutions = [],
  sites = [],
  codeHistory = [],
  modalityHistory = [],
  periodMonth = "",
}) {
  const bounds = getPeriodBounds(periodMonth);
  const targetDate = bounds?.effectiveDate || new Date();

  const catalog = {
    municipalitiesByName: new Map(),
    municipalityById: new Map(),
    institutionsByKey: new Map(),
    institutionById: new Map(),
    siteByNameKey: new Map(),
    siteById: new Map(),
    codeHistoryBySiteId: new Map(),
    modalityHistoryBySiteId: new Map(),
    activeCodeByNormalizedCode: new Map(),
    currentCodeBySiteId: new Map(),
    periodModalityBySiteId: new Map(),
    currentModalityBySiteId: new Map(),
    bounds,
  };

  for (const municipality of municipalities) {
    const normalizedName = normalizeSql(municipality.name);
    if (normalizedName && !catalog.municipalitiesByName.has(normalizedName)) {
      catalog.municipalitiesByName.set(normalizedName, municipality);
    }
    catalog.municipalityById.set(Number(municipality.id), municipality);
  }

  for (const institution of institutions) {
    const key = [
      String(institution.municipality_id || ""),
      normalizeSql(institution.name),
    ].join("|");
    if (key && !catalog.institutionsByKey.has(key)) {
      catalog.institutionsByKey.set(key, institution);
    }
    catalog.institutionById.set(Number(institution.id), institution);
  }

  for (const site of sites) {
    const key = buildSiteNameKey({
      municipality_id: site.municipality_id,
      institution: site.institution_name,
      site: site.site_name,
    });
    if (key && !catalog.siteByNameKey.has(key)) {
      catalog.siteByNameKey.set(key, site);
    }
    catalog.siteById.set(Number(site.site_id), site);
  }

  for (const row of codeHistory) {
    const siteId = Number(row.site_id);
    if (!siteId) continue;
    if (!catalog.codeHistoryBySiteId.has(siteId)) catalog.codeHistoryBySiteId.set(siteId, []);
    catalog.codeHistoryBySiteId.get(siteId).push(row);
  }

  for (const [siteId, records] of catalog.codeHistoryBySiteId.entries()) {
    const currentRecord = pickHistoryRecord(records, new Date());
    const periodRecord = pickHistoryRecord(records, targetDate);
    if (currentRecord) catalog.currentCodeBySiteId.set(siteId, currentRecord);
    if (periodRecord) {
      const normalizedCode = normalizeOfficialCode(periodRecord.official_code);
      if (normalizedCode && !catalog.activeCodeByNormalizedCode.has(normalizedCode)) {
        catalog.activeCodeByNormalizedCode.set(normalizedCode, periodRecord);
      }
    }
  }

  for (const row of modalityHistory) {
    const siteId = Number(row.site_id);
    if (!siteId) continue;
    if (!catalog.modalityHistoryBySiteId.has(siteId)) catalog.modalityHistoryBySiteId.set(siteId, []);
    catalog.modalityHistoryBySiteId.get(siteId).push(row);
  }

  for (const [siteId, records] of catalog.modalityHistoryBySiteId.entries()) {
    const currentRecord = pickHistoryRecord(records, new Date());
    const periodRecord = pickHistoryRecord(records, targetDate);
    if (currentRecord) catalog.currentModalityBySiteId.set(siteId, currentRecord);
    if (periodRecord) catalog.periodModalityBySiteId.set(siteId, periodRecord);
  }

  return catalog;
}

function analyzeCoverageImportRows(rows = [], catalog, options = {}) {
  const periodMonth = options.periodMonth || "";
  const effectiveDate = getPeriodBounds(periodMonth)?.effectiveDate || new Date();

  return rows.map((row, index) => {
    const normalizedMunicipality = normalizeSql(row.municipality);
    const municipality = catalog.municipalitiesByName.get(normalizedMunicipality) || null;
    const municipalityId = municipality ? Number(municipality.id) : null;
    const codeRecord = row.uniqueCode
      ? catalog.activeCodeByNormalizedCode.get(normalizeOfficialCode(row.uniqueCode)) || null
      : null;
    const codeSite = codeRecord ? catalog.siteById.get(Number(codeRecord.site_id)) || null : null;
    const nameSite = municipalityId
      ? catalog.siteByNameKey.get(
          buildSiteNameKey({
            municipality_id: municipalityId,
            institution: row.institution,
            site: row.site,
          })
        ) || null
      : null;

    const matchedSite = codeSite || nameSite || null;
    const matchedSiteId = matchedSite ? Number(matchedSite.site_id) : null;
    const matchedInstitutionId = matchedSite ? Number(matchedSite.institution_id) : null;
    const currentCodeRecord = matchedSiteId ? catalog.currentCodeBySiteId.get(matchedSiteId) || null : null;
    const periodModalityRecord = matchedSiteId ? catalog.periodModalityBySiteId.get(matchedSiteId) || null : null;
    const detections = [];

    if (
      matchedSite &&
      nameSite &&
      row.uniqueCode &&
      normalizeOfficialCode(row.uniqueCode) &&
      (!codeRecord || Number(codeRecord.site_id) !== matchedSiteId)
    ) {
      const currentOfficialCode = currentCodeRecord?.official_code || "";
      if (normalizeOfficialCode(currentOfficialCode) !== normalizeOfficialCode(row.uniqueCode)) {
        detections.push({
          key: `${row.rowHash || buildRowHash(row)}:SITE_CODE`,
          changeType: "SITE_CODE",
          message: "Posible cambio de codigo de sede",
          previousOfficialCode: currentOfficialCode || null,
          newOfficialCode: row.uniqueCode || null,
          suggestedAction: "same_site_new_code",
        });
      }
    }

    const activeModality = periodModalityRecord?.modality || matchedSite?.modality || "";
    if (
      matchedSite &&
      row.modality &&
      activeModality &&
      normalizeSql(activeModality) !== normalizeSql(row.modality)
    ) {
      detections.push({
        key: `${row.rowHash || buildRowHash(row)}:MODALITY`,
        changeType: "MODALITY",
        message: "Cambio de modalidad detectado",
        previousModality: activeModality,
        newModality: row.modality,
        suggestedAction: "register_modality_change",
        effectiveDate: toDateOnly(effectiveDate),
      });
    }

    return {
      rowIndex: index,
      rowHash: row.rowHash || buildRowHash(row),
      municipalityId,
      matchedInstitutionId,
      matchedSiteId,
      matchedBy: codeSite ? "OFFICIAL_CODE" : nameSite ? "NAME_MATCH" : "NEW_SITE",
      codeRecord,
      currentCodeRecord,
      periodModalityRecord,
      matchedSite,
      detections,
    };
  });
}

function indexDecisions(decisions = []) {
  const map = new Map();
  for (const decision of Array.isArray(decisions) ? decisions : []) {
    if (!decision?.key) continue;
    map.set(String(decision.key), decision);
  }
  return map;
}

function chooseImportResolution(analysis, decisionMap = new Map()) {
  const result = {
    action: analysis.matchedSiteId ? "reuse_site" : "create_site",
    municipalityId: analysis.municipalityId || null,
    institutionId: analysis.matchedInstitutionId || null,
    siteId: analysis.matchedSiteId || null,
    resolutionSource: analysis.matchedBy || "NEW_SITE",
    codeChange: null,
    modalityChange: null,
  };

  for (const detection of analysis.detections || []) {
    const decision = decisionMap.get(String(detection.key)) || {};
    if (detection.changeType === "SITE_CODE") {
      const action = String(decision.action || detection.suggestedAction || "same_site_new_code");
      if (action === "new_site") {
        result.action = "create_site";
        result.siteId = null;
        result.resolutionSource = "NEW_SITE";
      } else {
        result.action = "reuse_site";
        result.siteId = analysis.matchedSiteId || null;
        result.institutionId = analysis.matchedInstitutionId || null;
        result.resolutionSource = "SITE_CODE_CHANGE";
      }
      result.codeChange = {
        action,
        previousOfficialCode: detection.previousOfficialCode || null,
        newOfficialCode: detection.newOfficialCode || null,
        effectiveDate: decision.validFrom || decision.effectiveDate || null,
      };
    }

    if (detection.changeType === "MODALITY") {
      const action = String(decision.action || detection.suggestedAction || "register_modality_change");
      result.modalityChange = {
        action,
        previousModality: detection.previousModality || null,
        newModality: detection.newModality || null,
        effectiveDate: decision.validFrom || decision.effectiveDate || detection.effectiveDate || null,
      };
    }
  }

  return result;
}

function summarizeCoverageByMunicipality(rows = []) {
  const grouped = new Map();

  for (const row of rows) {
    const key = String(row.municipality_id || row.municipality || "");
    if (!grouped.has(key)) {
      grouped.set(key, {
        municipalityId: row.municipality_id || null,
        municipalityName: row.municipality_name || row.municipality || "",
        requiredTc: 0,
        requiredMt: 0,
        contractedTc: 0,
        contractedMt: 0,
      });
    }

    const item = grouped.get(key);
    item.requiredTc += Number(row.required_tc || row.requiredTc || 0);
    item.requiredMt += Number(row.required_mt || row.requiredMt || 0);
    item.contractedTc += Number(row.contracted_tc || row.contractedTc || 0);
    item.contractedMt += Number(row.contracted_mt || row.contractedMt || 0);
  }

  return Array.from(grouped.values());
}

module.exports = {
  analyzeCoverageImportRows,
  buildReferenceCatalog,
  buildRowHash,
  calculateRequiredPersonnel,
  chooseImportResolution,
  getPeriodBounds,
  indexDecisions,
  isDateWithinRange,
  makeCoverageIdKey,
  makeCoverageSiteIdKey,
  makeCoverageSiteTextKey,
  makeCoverageTextKey,
  normalize,
  normalizeOfficialCode,
  normalizeSql,
  normalizeWorkTime,
  pickHistoryRecord,
  summarizeCoverageByMunicipality,
  toDateOnly,
};
