"use strict";

const pool = require("../../../db/pool");

const VALID_STAFFING_TYPES = ["ANY", "LICITACION", "EXTRA", "INTERNO", "APOYO"];
const VALID_ASSIGNMENT_STAFFING_TYPES = ["LICITACION", "EXTRA", "INTERNO", "APOYO"];
const VALID_VALIDATION_MODES = ["DOCUMENTAL", "AUTOMATICA", "MIXTA"];
const VALID_COVERAGE_MODES = ["UPLOAD", "MANUAL", "FORMULA"];
const VALID_SPECIFICITY_TYPES = ["GENERAL", "ESPECIFICA"];
const VALID_SOURCE_TYPES = ["EXTERNA", "INTERNA"];

function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toLimit(value, fallback = 500, max = 1000) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function toOffset(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function toBool(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "si", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

function safe(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function upperSafe(value) {
  const text = safe(value);
  return text ? text.toUpperCase() : "";
}

function lowerSafe(value) {
  const text = safe(value);
  return text ? text.toLowerCase() : "";
}

function normalizeCode(value, fallbackPrefix = "ITEM") {
  const base = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || `${fallbackPrefix}_${Date.now()}`;
}

function normalizeExtraDocumentSource(bidPositionName, operationalPositionName, fallback = "") {
  const bid = safe(bidPositionName);
  const operational = safe(operationalPositionName);
  if (upperSafe(bid) === "EXTRA") return operational || safe(fallback);
  return bid || operational || safe(fallback);
}

function normalizeStaffingMode(value, bidPositionName = "") {
  const normalized = upperSafe(value);
  if (["EXTRA", "LICITACION"].includes(normalized)) return normalized;
  return upperSafe(bidPositionName) === "EXTRA" ? "EXTRA" : "LICITACION";
}

function deriveContractPositionFields(payload, masterPosition, current = null) {
  const hasBidPositionInput = payload.bidPositionName !== undefined || payload.bid_position_name !== undefined;
  const hasOperationalInput = payload.operationalPositionName !== undefined || payload.operational_position_name !== undefined;
  const staffingMode = normalizeStaffingMode(
    payload.staffingMode || payload.staffing_mode || payload.staffingType || payload.staffing_type,
    payload.bidPositionName || payload.bid_position_name || current?.bidPositionName || masterPosition?.bidPositionName || ""
  );

  const bidPositionName = staffingMode === "EXTRA"
    ? "EXTRA"
    : (
      (hasBidPositionInput ? safe(payload.bidPositionName || payload.bid_position_name) : "")
      || masterPosition?.bidPositionName
      || (current?.bidPositionName && upperSafe(current.bidPositionName) !== "EXTRA" ? current.bidPositionName : null)
      || null
    );

  const operationalPositionName = (
    (hasOperationalInput ? safe(payload.operationalPositionName || payload.operational_position_name) : "")
    || current?.operationalPositionName
    || masterPosition?.operationalPositionName
    || null
  );

  const documentRuleSource = staffingMode === "EXTRA"
    ? (operationalPositionName || "")
    : (bidPositionName || "");

  return {
    staffingMode,
    bidPositionName,
    operationalPositionName,
    documentRuleSource,
  };
}

async function ensureContractPositionRuleUniqueness({
  contractId,
  code,
  name,
  bidPositionName,
  operationalPositionName,
  excludeId = null,
}, client = pool) {
  const result = await client.query(
    `SELECT id
     FROM contract_position_rules
     WHERE contract_id = $1
       AND ($2::int IS NULL OR id <> $2)
       AND (
         UPPER(BTRIM(code)) = UPPER(BTRIM($3))
         OR (
           UPPER(BTRIM(name)) = UPPER(BTRIM($4))
           AND UPPER(BTRIM(COALESCE(bid_position_name, ''))) = UPPER(BTRIM(COALESCE($5, '')))
           AND UPPER(BTRIM(COALESCE(operational_position_name, ''))) = UPPER(BTRIM(COALESCE($6, '')))
         )
       )
     LIMIT 1`,
    [
      toInt(contractId),
      toInt(excludeId),
      safe(code),
      safe(name),
      bidPositionName || null,
      operationalPositionName || null,
    ]
  );

  if (result.rows[0]) {
    throw new Error("Ya existe una regla de cargo equivalente para este contrato.");
  }
}

function isPgUniqueViolation(error) {
  return error && error.code === "23505";
}

function mapPgError(error, fallbackMessage) {
  if (isPgUniqueViolation(error)) {
    return new Error("Ya existe un registro con esos valores únicos.");
  }
  return new Error(error?.message || fallbackMessage);
}

async function getContractScope(contractId, client = pool) {
  const id = toInt(contractId);
  if (!id) throw new Error("contract_id inválido");

  const result = await client.query(
    `SELECT
       ct.id,
       ct.company_id,
       ct.tenant_id,
       ct.name AS contract_name,
       c.name AS company_name
     FROM contracts ct
     JOIN companies c ON c.id = ct.company_id
     WHERE ct.id = $1
     LIMIT 1`,
    [id]
  );

  if (!result.rows[0]) throw new Error("Contrato no encontrado");
  return result.rows[0];
}

async function resolveMasterAreaCode(areaCodeOrName, client = pool) {
  const raw = safe(areaCodeOrName);
  if (!raw) return null;
  const result = await client.query(
    `SELECT code
     FROM master_areas
     WHERE UPPER(BTRIM(code)) = UPPER(BTRIM($1))
        OR UPPER(BTRIM(name)) = UPPER(BTRIM($1))
     ORDER BY code
     LIMIT 1`,
    [raw]
  );
  return result.rows[0]?.code || null;
}

async function resolveMasterModalityId(value, client = pool) {
  const numeric = toInt(value);
  if (numeric) return numeric;

  const raw = safe(value);
  if (!raw) return null;

  const result = await client.query(
    `SELECT id
     FROM master_modalities
     WHERE UPPER(BTRIM(code)) = UPPER(BTRIM($1))
        OR UPPER(BTRIM(name)) = UPPER(BTRIM($1))
     ORDER BY id
     LIMIT 1`,
    [raw]
  );
  return result.rows[0]?.id || null;
}

async function resolveMasterExperienceTypeId(value, client = pool) {
  const numeric = toInt(value);
  if (numeric) return numeric;

  const raw = safe(value);
  if (!raw) return null;

  const result = await client.query(
    `SELECT id
     FROM master_experience_types
     WHERE UPPER(BTRIM(code)) = UPPER(BTRIM($1))
        OR UPPER(BTRIM(name)) = UPPER(BTRIM($1))
     ORDER BY id
     LIMIT 1`,
    [raw]
  );
  return result.rows[0]?.id || null;
}

async function resolveMasterDocumentTypeId(value, client = pool) {
  const numeric = toInt(value);
  if (numeric) return numeric;

  const raw = safe(value);
  if (!raw) return null;

  const result = await client.query(
    `SELECT id
     FROM master_document_types
     WHERE LOWER(BTRIM(code)) = LOWER(BTRIM($1))
        OR UPPER(BTRIM(name)) = UPPER(BTRIM($1))
     ORDER BY id
     LIMIT 1`,
    [raw]
  );
  return result.rows[0]?.id || null;
}

async function resolveMasterPositionId(value, client = pool) {
  const numeric = toInt(value);
  if (numeric) return numeric;

  const raw = safe(value);
  if (!raw) return null;

  const result = await client.query(
    `SELECT id
     FROM master_positions
     WHERE UPPER(BTRIM(code)) = UPPER(BTRIM($1))
        OR UPPER(BTRIM(COALESCE(bid_position_name, ''))) = UPPER(BTRIM($1))
        OR UPPER(BTRIM(COALESCE(operational_position_name, ''))) = UPPER(BTRIM($1))
        OR UPPER(BTRIM(document_rule_source)) = UPPER(BTRIM($1))
     ORDER BY id
     LIMIT 1`,
    [raw]
  );
  return result.rows[0]?.id || null;
}

async function getMasterPositionById(id, client = pool) {
  const result = await client.query(
    `SELECT
       id,
       code,
       bid_position_name AS "bidPositionName",
       operational_position_name AS "operationalPositionName",
       document_rule_source AS "documentRuleSource",
       category,
       area,
       counts_for_coverage AS "countsForCoverage",
       risk_level AS "riskLevel",
       active,
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM master_positions
     WHERE id = $1`,
    [toInt(id)]
  );
  return result.rows[0] || null;
}

async function getMasterAreaByCode(code, client = pool) {
  const result = await client.query(
    `SELECT code, name FROM master_areas WHERE code = $1 LIMIT 1`,
    [upperSafe(code)]
  );
  return result.rows[0] || null;
}

async function syncLegacyDocumentType(client, masterDocumentTypeId) {
  const result = await client.query(
    `SELECT
       id,
       code,
       name,
       phase,
       visible_to_auditor AS "visibleToAuditor",
       active
     FROM master_document_types
     WHERE id = $1`,
    [toInt(masterDocumentTypeId)]
  );

  const doc = result.rows[0];
  if (!doc) throw new Error("Tipo documental maestro no encontrado");

  const legacy = await client.query(
    `INSERT INTO document_types (
       code, name, phase, required, visible_to_auditor, active, master_document_type_id
     )
     VALUES ($1, $2, $3, false, $4, $5, $6)
     ON CONFLICT (code)
     DO UPDATE SET
       name = EXCLUDED.name,
       phase = EXCLUDED.phase,
       visible_to_auditor = EXCLUDED.visible_to_auditor,
       active = EXCLUDED.active,
       master_document_type_id = EXCLUDED.master_document_type_id
     RETURNING id`,
    [
      lowerSafe(doc.code),
      safe(doc.name),
      safe(doc.phase) || "preingreso",
      Boolean(doc.visibleToAuditor),
      Boolean(doc.active),
      doc.id,
    ]
  );

  return legacy.rows[0]?.id || null;
}

async function syncLegacyContractPosition(client, contractPositionRuleId) {
  const result = await client.query(
    `SELECT
       cpr.id,
       cpr.tenant_id,
       cpr.company_id,
       cpr.contract_id,
       cpr.legacy_contract_position_id AS "legacyContractPositionId",
       cpr.name,
       cpr.bid_position_name AS "bidPositionName",
       cpr.operational_position_name AS "operationalPositionName",
       cpr.document_rule_source AS "documentRuleSource",
       cpr.category,
       cpr.counts_for_coverage AS "countsForCoverage",
       cpr.profile_level AS "profileLevel",
       cpr.position_type AS "positionType",
       cpr.active
     FROM contract_position_rules cpr
     WHERE cpr.id = $1`,
    [toInt(contractPositionRuleId)]
  );

  const rule = result.rows[0];
  if (!rule) throw new Error("Regla de cargo contractual no encontrada");

  const legacyCategory = upperSafe(rule.bidPositionName) === "EXTRA" || upperSafe(rule.category) === "EXTRA"
    ? "EXTRA"
    : "OFERTA";
  const legacyName = safe(rule.documentRuleSource || rule.bidPositionName || rule.operationalPositionName || rule.name);

  if (rule.legacyContractPositionId) {
    await client.query(
      `UPDATE contract_positions
       SET company_id = $2,
           contract_id = $3,
           name = $4,
           category = $5,
           counts_for_coverage = $6,
           active = $7,
           tenant_id = $8,
           position_type = $9,
           profile_level = $10,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        rule.legacyContractPositionId,
        rule.company_id,
        rule.contract_id,
        legacyName,
        legacyCategory,
        Boolean(rule.countsForCoverage),
        Boolean(rule.active),
        toInt(rule.tenant_id) || 1,
        safe(rule.positionType) || "OFERTA",
        safe(rule.profileLevel) || null,
      ]
    );
    return rule.legacyContractPositionId;
  }

  const insert = await client.query(
    `INSERT INTO contract_positions (
       company_id, contract_id, name, category, counts_for_coverage, active, tenant_id, position_type, profile_level
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      rule.company_id,
      rule.contract_id,
      legacyName,
      legacyCategory,
      Boolean(rule.countsForCoverage),
      Boolean(rule.active),
      toInt(rule.tenant_id) || 1,
      safe(rule.positionType) || "OFERTA",
      safe(rule.profileLevel) || null,
    ]
  );

  const legacyId = insert.rows[0]?.id || null;
  if (legacyId) {
    await client.query(
      `UPDATE contract_position_rules
       SET legacy_contract_position_id = $2
       WHERE id = $1`,
      [rule.id, legacyId]
    );
  }
  return legacyId;
}

async function syncLegacyContractDocumentRule(client, contractDocumentRuleId) {
  const result = await client.query(
    `SELECT
       cdr.id,
       cdr.contract_position_rule_id AS "contractPositionRuleId",
       cdr.master_document_type_id AS "masterDocumentTypeId",
       cdr.master_modality_id AS "masterModalityId",
       cdr.municipality_id AS "municipalityId",
       cdr.institution_id AS "institutionId",
       cdr.site_id AS "siteId",
       cdr.applies_to_staffing_type AS "staffingType",
       cdr.required,
       cdr.expires,
       cdr.alert_days_before_expiration AS "alertDays",
       cdr.active
     FROM contract_document_rules cdr
     WHERE cdr.id = $1`,
    [toInt(contractDocumentRuleId)]
  );

  const rule = result.rows[0];
  if (!rule) throw new Error("Regla documental contractual no encontrada");

  const hasUnsupportedScope =
    rule.masterModalityId ||
    rule.municipalityId ||
    rule.institutionId ||
    rule.siteId ||
    (safe(rule.staffingType) && safe(rule.staffingType) !== "ANY");

  if (!rule.contractPositionRuleId || hasUnsupportedScope) return null;

  const legacyPositionId = await syncLegacyContractPosition(client, rule.contractPositionRuleId);
  if (!legacyPositionId) return null;

  const legacyDocumentTypeId = await syncLegacyDocumentType(client, rule.masterDocumentTypeId);
  if (!legacyDocumentTypeId) return null;

  const existing = await client.query(
    `SELECT id
     FROM contract_position_documents
     WHERE contract_position_id = $1
       AND document_type_id = $2
     LIMIT 1`,
    [legacyPositionId, legacyDocumentTypeId]
  );

  if (!rule.active) {
    if (existing.rows[0]) {
      await client.query(
        `DELETE FROM contract_position_documents
         WHERE id = $1`,
        [existing.rows[0].id]
      );
    }
    return null;
  }

  if (existing.rows[0]) {
    await client.query(
      `UPDATE contract_position_documents
       SET required = $2,
           expires = $3,
           alert_days_before_expiration = $4
       WHERE id = $1`,
      [
        existing.rows[0].id,
        Boolean(rule.required),
        Boolean(rule.expires),
        toInt(rule.alertDays),
      ]
    );
    return existing.rows[0].id;
  }

  const insert = await client.query(
    `INSERT INTO contract_position_documents (
       contract_position_id, document_type_id, required, expires, alert_days_before_expiration
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      legacyPositionId,
      legacyDocumentTypeId,
      Boolean(rule.required),
      Boolean(rule.expires),
      toInt(rule.alertDays),
    ]
  );
  return insert.rows[0]?.id || null;
}

const MASTER_KIND_CONFIG = {
  positions: {
    label: "catálogo maestro de cargos",
    listQuery: `
      SELECT
        id,
        code,
        bid_position_name AS "bidPositionName",
        operational_position_name AS "operationalPositionName",
        document_rule_source AS "documentRuleSource",
        category,
        area,
        counts_for_coverage AS "countsForCoverage",
        risk_level AS "riskLevel",
        active,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM master_positions
    `,
    byIdQuery: `
      SELECT
        id,
        code,
        bid_position_name AS "bidPositionName",
        operational_position_name AS "operationalPositionName",
        document_rule_source AS "documentRuleSource",
        category,
        area,
        counts_for_coverage AS "countsForCoverage",
        risk_level AS "riskLevel",
        active,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM master_positions
      WHERE id = $1
    `,
  },
  areas: {
    label: "catálogo maestro de áreas",
    listQuery: `
      SELECT
        id,
        code,
        name,
        description,
        active,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM master_areas
    `,
    byIdQuery: `
      SELECT
        id,
        code,
        name,
        description,
        active,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM master_areas
      WHERE id = $1
    `,
  },
  "document-types": {
    label: "catálogo maestro documental",
    listQuery: `
      SELECT
        id,
        code,
        name,
        description,
        phase,
        is_global_base AS "isGlobalBase",
        COALESCE(default_expires, false) AS "defaultExpires",
        COALESCE(default_alert_days_before_expiration, 30) AS "defaultAlertDaysBeforeExpiration",
        COALESCE(validation_required, true) AS "validationRequired",
        visible_to_auditor AS "visibleToAuditor",
        active,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM master_document_types
    `,
    byIdQuery: `
      SELECT
        id,
        code,
        name,
        description,
        phase,
        is_global_base AS "isGlobalBase",
        COALESCE(default_expires, false) AS "defaultExpires",
        COALESCE(default_alert_days_before_expiration, 30) AS "defaultAlertDaysBeforeExpiration",
        COALESCE(validation_required, true) AS "validationRequired",
        visible_to_auditor AS "visibleToAuditor",
        active,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM master_document_types
      WHERE id = $1
    `,
  },
  modalities: {
    label: "catálogo maestro de modalidades",
    listQuery: `
      SELECT
        id,
        code,
        name,
        description,
        active,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM master_modalities
    `,
    byIdQuery: `
      SELECT
        id,
        code,
        name,
        description,
        active,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM master_modalities
      WHERE id = $1
    `,
  },
  "experience-types": {
    label: "catálogo maestro de tipos de experiencia",
    listQuery: `
      SELECT
        id,
        code,
        name,
        description,
        active,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM master_experience_types
    `,
    byIdQuery: `
      SELECT
        id,
        code,
        name,
        description,
        active,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM master_experience_types
      WHERE id = $1
    `,
  },
};

function getMasterConfig(kind) {
  const config = MASTER_KIND_CONFIG[kind];
  if (!config) throw new Error("Catálogo maestro no soportado");
  return config;
}

async function listMasterCatalog(kind, filters = {}) {
  const config = getMasterConfig(kind);
  const values = [];
  const conditions = [];

  if (filters.active !== undefined && filters.active !== null && filters.active !== "") {
    values.push(toBool(filters.active, true));
    conditions.push(`active = $${values.length}`);
  }

  if (filters.search) {
    values.push(`%${safe(filters.search)}%`);
    if (kind === "positions") {
      conditions.push(`(
        code ILIKE $${values.length}
        OR COALESCE(bid_position_name, '') ILIKE $${values.length}
        OR COALESCE(operational_position_name, '') ILIKE $${values.length}
        OR document_rule_source ILIKE $${values.length}
      )`);
    } else {
      conditions.push(`(
        code ILIKE $${values.length}
        OR name ILIKE $${values.length}
        OR COALESCE(description, '') ILIKE $${values.length}
      )`);
    }
  }

  const where = conditions.length
    ? ` WHERE ${conditions.join(" AND ")}`
    : "";
  const orderBy = kind === "positions"
    ? ` ORDER BY active DESC, code ASC`
    : ` ORDER BY active DESC, code ASC`;
  const limit = toLimit(filters.limit ?? filters.pageSize, 500, 1000);
  const offset = toOffset(filters.offset);
  values.push(limit, offset);

  const result = await pool.query(
    `${config.listQuery}${where}${orderBy} LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return result.rows;
}

async function getMasterCatalogRecord(kind, id) {
  const config = getMasterConfig(kind);
  const result = await pool.query(config.byIdQuery, [toInt(id)]);
  return result.rows[0] || null;
}

async function createMasterCatalogRecord(kind, payload = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let createdId = null;

    if (kind === "positions") {
      const code = upperSafe(payload.code || normalizeCode(payload.bidPositionName || payload.operationalPositionName || "POS", "POS"));
      const bidPositionName = safe(payload.bidPositionName || payload.bid_position_name) || null;
      const operationalPositionName = safe(payload.operationalPositionName || payload.operational_position_name) || null;
      const category = safe(payload.category) || null;
      const area = safe(payload.area) || null;
      const riskLevel = safe(payload.riskLevel || payload.risk_level) || null;
      const countsForCoverage = toBool(payload.countsForCoverage ?? payload.counts_for_coverage, false);
      const active = toBool(payload.active, true);
      const documentRuleSource = normalizeExtraDocumentSource(
        bidPositionName,
        operationalPositionName,
        payload.documentRuleSource || payload.document_rule_source
      );

      if (!code) throw new Error("El código es obligatorio");
      if (!documentRuleSource) throw new Error("document_rule_source es obligatorio");
      if (upperSafe(bidPositionName) === "EXTRA" && !operationalPositionName) {
        throw new Error("operational_position_name es obligatorio cuando bid_position_name = EXTRA");
      }

      const result = await client.query(
        `INSERT INTO master_positions (
           code, bid_position_name, operational_position_name, document_rule_source,
           category, area, counts_for_coverage, risk_level, active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          code,
          bidPositionName,
          operationalPositionName,
          documentRuleSource,
          category,
          area,
          countsForCoverage,
          riskLevel,
          active,
        ]
      );
      createdId = result.rows[0].id;
    } else if (kind === "areas") {
      const code = upperSafe(payload.code || normalizeCode(payload.name || "AREA", "AREA"));
      const name = safe(payload.name);
      if (!code) throw new Error("El código es obligatorio");
      if (!name) throw new Error("El nombre es obligatorio");

      const result = await client.query(
        `INSERT INTO master_areas (code, name, description, active)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          code,
          name,
          safe(payload.description) || null,
          toBool(payload.active, true),
        ]
      );
      createdId = result.rows[0].id;
    } else if (kind === "document-types") {
      const code = lowerSafe(payload.code || normalizeCode(payload.name || "documento", "DOCUMENTO"));
      const name = safe(payload.name);
      const isGlobalBase = toBool(payload.isGlobalBase ?? payload.is_global_base, false);
      const defaultExpires = toBool(payload.defaultExpires ?? payload.default_expires, false);
      const validationRequired = toBool(payload.validationRequired ?? payload.validation_required, true);
      const active = isGlobalBase ? true : toBool(payload.active, true);
      if (!code) throw new Error("El código es obligatorio");
      if (!name) throw new Error("El nombre es obligatorio");

      const result = await client.query(
        `INSERT INTO master_document_types (
           code, name, description, phase, is_global_base,
           default_expires, default_alert_days_before_expiration, validation_required,
           visible_to_auditor, active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          code,
          name,
          safe(payload.description) || null,
          safe(payload.phase) || null,
          isGlobalBase,
          defaultExpires,
          defaultExpires
            ? toInt(payload.defaultAlertDaysBeforeExpiration || payload.default_alert_days_before_expiration)
            : 30,
          validationRequired,
          toBool(payload.visibleToAuditor ?? payload.visible_to_auditor, false),
          active,
        ]
      );
      createdId = result.rows[0].id;
      await syncLegacyDocumentType(client, createdId);
    } else if (kind === "modalities") {
      const code = upperSafe(payload.code || normalizeCode(payload.name || "MOD", "MOD"));
      const name = safe(payload.name || code);
      const result = await client.query(
        `INSERT INTO master_modalities (code, name, description, active)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          code,
          name,
          safe(payload.description) || null,
          toBool(payload.active, true),
        ]
      );
      createdId = result.rows[0].id;
    } else if (kind === "experience-types") {
      const code = upperSafe(payload.code || normalizeCode(payload.name || "EXP", "EXP"));
      const name = safe(payload.name || code);
      const result = await client.query(
        `INSERT INTO master_experience_types (code, name, description, active)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          code,
          name,
          safe(payload.description) || null,
          toBool(payload.active, true),
        ]
      );
      createdId = result.rows[0].id;
    }

    await client.query("COMMIT");
    return await getMasterCatalogRecord(kind, createdId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw mapPgError(error, "No fue posible crear el registro maestro.");
  } finally {
    client.release();
  }
}

async function updateMasterCatalogRecord(kind, id, payload = {}) {
  const current = await getMasterCatalogRecord(kind, id);
  if (!current) throw new Error("Registro maestro no encontrado");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (kind === "positions") {
      const bidPositionName = payload.bidPositionName !== undefined || payload.bid_position_name !== undefined
        ? (safe(payload.bidPositionName || payload.bid_position_name) || null)
        : current.bidPositionName;
      const operationalPositionName = payload.operationalPositionName !== undefined || payload.operational_position_name !== undefined
        ? (safe(payload.operationalPositionName || payload.operational_position_name) || null)
        : current.operationalPositionName;
      const code = payload.code !== undefined ? upperSafe(payload.code) : current.code;
      const documentRuleSourceInput = payload.documentRuleSource !== undefined || payload.document_rule_source !== undefined
        ? payload.documentRuleSource || payload.document_rule_source
        : current.documentRuleSource;
      const documentRuleSource = normalizeExtraDocumentSource(
        bidPositionName,
        operationalPositionName,
        documentRuleSourceInput
      );

      if (upperSafe(bidPositionName) === "EXTRA" && !operationalPositionName) {
        throw new Error("operational_position_name es obligatorio cuando bid_position_name = EXTRA");
      }
      if (!documentRuleSource) throw new Error("document_rule_source es obligatorio");

      await client.query(
        `UPDATE master_positions
         SET code = $2,
             bid_position_name = $3,
             operational_position_name = $4,
             document_rule_source = $5,
             category = $6,
             area = $7,
             counts_for_coverage = $8,
             risk_level = $9,
             active = $10
         WHERE id = $1`,
        [
          toInt(id),
          code,
          bidPositionName,
          operationalPositionName,
          documentRuleSource,
          payload.category !== undefined ? (safe(payload.category) || null) : current.category,
          payload.area !== undefined ? (safe(payload.area) || null) : current.area,
          payload.countsForCoverage !== undefined || payload.counts_for_coverage !== undefined
            ? toBool(payload.countsForCoverage ?? payload.counts_for_coverage, false)
            : current.countsForCoverage,
          payload.riskLevel !== undefined || payload.risk_level !== undefined
            ? (safe(payload.riskLevel || payload.risk_level) || null)
            : current.riskLevel,
          payload.active !== undefined ? toBool(payload.active, true) : current.active,
        ]
      );
    } else if (kind === "areas") {
      await client.query(
        `UPDATE master_areas
         SET code = $2,
             name = $3,
             description = $4,
             active = $5
         WHERE id = $1`,
        [
          toInt(id),
          payload.code !== undefined ? upperSafe(payload.code) : current.code,
          payload.name !== undefined ? safe(payload.name) : current.name,
          payload.description !== undefined ? (safe(payload.description) || null) : current.description,
          payload.active !== undefined ? toBool(payload.active, true) : current.active,
        ]
      );
    } else if (kind === "document-types") {
      const requestedIsGlobalBase =
        payload.isGlobalBase !== undefined || payload.is_global_base !== undefined
          ? toBool(payload.isGlobalBase ?? payload.is_global_base, false)
          : current.isGlobalBase;
      const requestedActive =
        payload.active !== undefined ? toBool(payload.active, true) : current.active;
      const requestedDefaultExpires =
        payload.defaultExpires !== undefined || payload.default_expires !== undefined
          ? toBool(payload.defaultExpires ?? payload.default_expires, false)
          : current.defaultExpires;
      const requestedValidationRequired =
        payload.validationRequired !== undefined || payload.validation_required !== undefined
          ? toBool(payload.validationRequired ?? payload.validation_required, true)
          : current.validationRequired;

      if (current.isGlobalBase && requestedIsGlobalBase === false) {
        throw new Error("No se puede quitar la marca global base a un documento global base.");
      }
      if (current.isGlobalBase && requestedActive === false) {
        throw new Error("No se puede desactivar un documento global base.");
      }
      if (requestedIsGlobalBase && requestedActive === false) {
        throw new Error("Los documentos globales base deben permanecer activos.");
      }

      await client.query(
        `UPDATE master_document_types
         SET code = $2,
             name = $3,
             description = $4,
             phase = $5,
             is_global_base = $6,
             default_expires = $7,
             default_alert_days_before_expiration = $8,
             validation_required = $9,
             visible_to_auditor = $10,
             active = $11
         WHERE id = $1`,
        [
          toInt(id),
          payload.code !== undefined ? lowerSafe(payload.code) : current.code,
          payload.name !== undefined ? safe(payload.name) : current.name,
          payload.description !== undefined ? (safe(payload.description) || null) : current.description,
          payload.phase !== undefined ? (safe(payload.phase) || null) : current.phase,
          current.isGlobalBase ? true : requestedIsGlobalBase,
          requestedDefaultExpires,
          requestedDefaultExpires
            ? (
              payload.defaultAlertDaysBeforeExpiration !== undefined || payload.default_alert_days_before_expiration !== undefined
                ? toInt(payload.defaultAlertDaysBeforeExpiration || payload.default_alert_days_before_expiration)
                : current.defaultAlertDaysBeforeExpiration
            )
            : 30,
          requestedValidationRequired,
          payload.visibleToAuditor !== undefined || payload.visible_to_auditor !== undefined
            ? toBool(payload.visibleToAuditor ?? payload.visible_to_auditor, false)
            : current.visibleToAuditor,
          requestedIsGlobalBase ? true : requestedActive,
        ]
      );
      await syncLegacyDocumentType(client, id);
    } else if (kind === "modalities") {
      await client.query(
        `UPDATE master_modalities
         SET code = $2,
             name = $3,
             description = $4,
             active = $5
         WHERE id = $1`,
        [
          toInt(id),
          payload.code !== undefined ? upperSafe(payload.code) : current.code,
          payload.name !== undefined ? safe(payload.name) : current.name,
          payload.description !== undefined ? (safe(payload.description) || null) : current.description,
          payload.active !== undefined ? toBool(payload.active, true) : current.active,
        ]
      );
    } else if (kind === "experience-types") {
      await client.query(
        `UPDATE master_experience_types
         SET code = $2,
             name = $3,
             description = $4,
             active = $5
         WHERE id = $1`,
        [
          toInt(id),
          payload.code !== undefined ? upperSafe(payload.code) : current.code,
          payload.name !== undefined ? safe(payload.name) : current.name,
          payload.description !== undefined ? (safe(payload.description) || null) : current.description,
          payload.active !== undefined ? toBool(payload.active, true) : current.active,
        ]
      );
    }

    await client.query("COMMIT");
    return await getMasterCatalogRecord(kind, id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw mapPgError(error, "No fue posible actualizar el registro maestro.");
  } finally {
    client.release();
  }
}

async function deleteMasterCatalogRecord(kind, id) {
  if (kind !== "document-types") {
    throw new Error("La eliminacion solo esta soportada para documentos maestros.");
  }

  const current = await getMasterCatalogRecord(kind, id);
  if (!current) throw new Error("Registro maestro no encontrado");
  if (current.isGlobalBase) {
    throw new Error("No se puede eliminar un documento global base.");
  }

  const usageResult = await pool.query(
    `SELECT
       EXISTS (
         SELECT 1
         FROM contract_document_rules
         WHERE master_document_type_id = $1
       ) AS "usedInContractRules",
       EXISTS (
         SELECT 1
         FROM employee_documents
         WHERE master_document_type_id = $1
       ) AS "usedInEmployeeDocuments",
       EXISTS (
         SELECT 1
         FROM employee_documents ed
         JOIN document_types dt ON dt.id = ed.document_type_id
         WHERE dt.master_document_type_id = $1
       ) AS "usedInLegacyEmployeeDocuments",
       EXISTS (
         SELECT 1
         FROM contract_position_documents cpd
         JOIN document_types dt ON dt.id = cpd.document_type_id
         WHERE dt.master_document_type_id = $1
       ) AS "usedInLegacyContractRules"`,
    [toInt(id)]
  );

  const usage = usageResult.rows[0] || {};
  if (
    usage.usedInContractRules
    || usage.usedInEmployeeDocuments
    || usage.usedInLegacyEmployeeDocuments
    || usage.usedInLegacyContractRules
  ) {
    throw new Error("No se puede eliminar porque este documento ya tiene historial. Puede desactivarlo.");
  }

  await pool.query(
    `DELETE FROM master_document_types
     WHERE id = $1`,
    [toInt(id)]
  );

  return { id: toInt(id), deleted: true };
}

async function findContractDocumentMatrixRule(client, contractId, contractPositionRuleId, masterDocumentTypeId) {
  const result = await client.query(
    `SELECT id
     FROM contract_document_rules
     WHERE contract_id = $1
       AND contract_position_rule_id = $2
       AND master_document_type_id = $3
       AND master_modality_id IS NULL
       AND municipality_id IS NULL
       AND institution_id IS NULL
       AND site_id IS NULL
       AND applies_to_staffing_type = 'ANY'
     ORDER BY id
     LIMIT 1`,
    [toInt(contractId), toInt(contractPositionRuleId), toInt(masterDocumentTypeId)]
  );
  return result.rows[0]?.id || null;
}

async function listContractDocumentMatrix(contractId) {
  const scope = await getContractScope(contractId);
  const [positions, documentsResult, rulesResult] = await Promise.all([
    listContractPositionRules(scope.id, { active: true }),
    pool.query(
      `SELECT
         mdt.id,
         mdt.code,
         mdt.name,
         mdt.description,
         mdt.phase,
         mdt.is_global_base AS "isGlobalBase",
         COALESCE(mdt.default_expires, false) AS "defaultExpires",
         COALESCE(mdt.default_alert_days_before_expiration, 30) AS "defaultAlertDaysBeforeExpiration",
         COALESCE(mdt.validation_required, true) AS "validationRequired",
         mdt.visible_to_auditor AS "visibleToAuditor",
         mdt.active,
         mdt.created_at AS "createdAt",
         mdt.updated_at AS "updatedAt",
         COUNT(DISTINCT cdr.id) AS "contractRuleCount",
         COUNT(DISTINCT ed.id) AS "employeeDocumentCount",
         (
           SELECT COUNT(*)
           FROM employee_documents led
           JOIN document_types ldt ON ldt.id = led.document_type_id
           WHERE ldt.master_document_type_id = mdt.id
         ) AS "legacyEmployeeDocumentCount",
         (
           SELECT COUNT(*)
           FROM contract_position_documents cpd
           JOIN document_types ldt ON ldt.id = cpd.document_type_id
           WHERE ldt.master_document_type_id = mdt.id
         ) AS "legacyContractRuleCount"
       FROM master_document_types mdt
       LEFT JOIN contract_document_rules cdr
         ON cdr.master_document_type_id = mdt.id
       LEFT JOIN employee_documents ed
         ON ed.master_document_type_id = mdt.id
       GROUP BY mdt.id
       ORDER BY mdt.is_global_base DESC, mdt.active DESC, mdt.code ASC`
    ),
    pool.query(
      `SELECT
         cdr.id,
         cdr.contract_position_rule_id AS "contractPositionRuleId",
         cdr.master_document_type_id AS "masterDocumentTypeId",
         cdr.required,
         cdr.expires,
         cdr.alert_days_before_expiration AS "alertDaysBeforeExpiration",
         cdr.requires_approval AS "requiresApproval",
         cdr.validation_mode AS "validationMode",
         cdr.active
       FROM contract_document_rules cdr
       WHERE cdr.contract_id = $1
         AND cdr.contract_position_rule_id IS NOT NULL
         AND cdr.master_modality_id IS NULL
         AND cdr.municipality_id IS NULL
         AND cdr.institution_id IS NULL
         AND cdr.site_id IS NULL
         AND cdr.applies_to_staffing_type = 'ANY'
       ORDER BY cdr.id`,
      [scope.id]
    ),
  ]);

  const ruleMap = new Map();
  for (const rule of rulesResult.rows) {
    ruleMap.set(`${rule.masterDocumentTypeId}:${rule.contractPositionRuleId}`, rule);
  }

  const documents = documentsResult.rows.map((doc) => ({
    ...doc,
    canDelete:
      !doc.isGlobalBase
      && Number(doc.contractRuleCount || 0) === 0
      && Number(doc.employeeDocumentCount || 0) === 0
      && Number(doc.legacyEmployeeDocumentCount || 0) === 0
      && Number(doc.legacyContractRuleCount || 0) === 0,
    cells: positions.map((position) => {
      const rule = ruleMap.get(`${doc.id}:${position.id}`) || null;
      return {
        contractPositionRuleId: position.id,
        checked: doc.isGlobalBase ? true : Boolean(rule?.active && rule?.required),
        locked: Boolean(doc.isGlobalBase),
        ruleId: rule?.id || null,
        required: rule?.required ?? Boolean(doc.isGlobalBase),
        active: rule?.active ?? false,
        expires: rule?.expires ?? Boolean(doc.defaultExpires),
        alertDaysBeforeExpiration: rule?.alertDaysBeforeExpiration ?? doc.defaultAlertDaysBeforeExpiration ?? null,
        requiresApproval: rule?.requiresApproval ?? true,
        validationMode: rule?.validationMode || "DOCUMENTAL",
      };
    }),
  }));

  return {
    contractId: scope.id,
    companyId: scope.company_id,
    companyName: scope.company_name,
    contractName: scope.contract_name,
    positions: positions.map((position) => ({
      id: position.id,
      code: position.code,
      name: position.name,
      bidPositionName: position.bidPositionName,
      operationalPositionName: position.operationalPositionName,
      active: position.active,
    })),
    documents,
  };
}

async function applyContractDocumentMatrixChange(client, scope, change = {}) {
  const contractPositionRuleId = toInt(change.contractPositionRuleId || change.contract_position_rule_id);
  const masterDocumentTypeId = toInt(change.masterDocumentTypeId || change.master_document_type_id);
  const checked = toBool(change.checked, false);

  if (!contractPositionRuleId || !masterDocumentTypeId) {
    throw new Error("Cada cambio de matriz requiere cargo contractual y documento maestro.");
  }

  const [positionResult, documentResult] = await Promise.all([
    client.query(
      `SELECT id, contract_id, name
       FROM contract_position_rules
       WHERE id = $1
         AND contract_id = $2
       LIMIT 1`,
      [contractPositionRuleId, scope.id]
    ),
    client.query(
      `SELECT
         id,
         name,
         is_global_base AS "isGlobalBase",
         COALESCE(default_expires, false) AS "defaultExpires",
         COALESCE(default_alert_days_before_expiration, 30) AS "defaultAlertDaysBeforeExpiration",
         COALESCE(validation_required, true) AS "validationRequired"
       FROM master_document_types
       WHERE id = $1
       LIMIT 1`,
      [masterDocumentTypeId]
    ),
  ]);

  const position = positionResult.rows[0];
  const document = documentResult.rows[0];
  if (!position) throw new Error("El cargo contractual seleccionado no pertenece a este contrato.");
  if (!document) throw new Error("El documento maestro seleccionado no existe.");
  if (document.isGlobalBase && checked === false) {
    throw new Error("Los documentos globales base siempre aplican a todos los cargos.");
  }

  const existingRuleId = await findContractDocumentMatrixRule(
    client,
    scope.id,
    contractPositionRuleId,
    masterDocumentTypeId
  );

  if (checked) {
    if (existingRuleId) {
      await client.query(
        `UPDATE contract_document_rules
         SET required = true,
             active = true,
             expires = COALESCE(expires, $2),
             alert_days_before_expiration = COALESCE(alert_days_before_expiration, $3),
             requires_approval = COALESCE(requires_approval, true),
             validation_mode = COALESCE(validation_mode, 'DOCUMENTAL')
         WHERE id = $1`,
        [
          existingRuleId,
          Boolean(document.defaultExpires),
          toInt(document.defaultAlertDaysBeforeExpiration),
        ]
      );
      await syncLegacyContractDocumentRule(client, existingRuleId);
      return existingRuleId;
    }

    const insert = await client.query(
      `INSERT INTO contract_document_rules (
         tenant_id, company_id, contract_id, contract_position_rule_id, master_document_type_id,
         applies_to_staffing_type, required, expires, alert_days_before_expiration, requires_approval,
         validation_mode, active
       )
       VALUES ($1, $2, $3, $4, $5, 'ANY', true, $6, $7, true, 'DOCUMENTAL', true)
       RETURNING id`,
      [
        toInt(scope.tenant_id) || 1,
        scope.company_id,
        scope.id,
        contractPositionRuleId,
        masterDocumentTypeId,
        Boolean(document.defaultExpires),
        toInt(document.defaultAlertDaysBeforeExpiration),
      ]
    );
    await syncLegacyContractDocumentRule(client, insert.rows[0].id);
    return insert.rows[0].id;
  }

  if (!existingRuleId) return null;

  await client.query(
    `UPDATE contract_document_rules
     SET required = false,
         active = false
     WHERE id = $1`,
    [existingRuleId]
  );
  await syncLegacyContractDocumentRule(client, existingRuleId);
  return existingRuleId;
}

async function saveContractDocumentMatrix(contractId, payload = {}) {
  const scope = await getContractScope(contractId);
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const change of changes) {
      await applyContractDocumentMatrixChange(client, scope, change);
    }
    await client.query("COMMIT");
    return await listContractDocumentMatrix(scope.id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw mapPgError(error, "No fue posible guardar la matriz documental.");
  } finally {
    client.release();
  }
}

async function updateContractDocumentMatrixCell(contractId, payload = {}) {
  return saveContractDocumentMatrix(contractId, { changes: [payload] });
}

async function listContractConfigurationSummary(contractId) {
  const scope = await getContractScope(contractId);
  const result = await pool.query(
    `SELECT
       v.contract_id AS "contractId",
       v.company_id AS "companyId",
       v.tenant_id AS "tenantId",
       v.contract_name AS "contractName",
       v.position_rules_count AS "positionRulesCount",
       v.document_rules_count AS "documentRulesCount",
       v.experience_rules_count AS "experienceRulesCount",
       v.coverage_rules_count AS "coverageRulesCount",
       v.municipalities_count AS "municipalitiesCount",
       v.modalities_count AS "modalitiesCount",
       cs.position_mode AS "positionMode",
       cs.modules,
       cs.role_permissions AS "rolePermissions",
       cs.salary_config AS "salaryConfig"
     FROM v_contract_rule_summary v
     LEFT JOIN contract_settings cs ON cs.contract_id = v.contract_id
     WHERE v.contract_id = $1
     LIMIT 1`,
    [scope.id]
  );
  const row = result.rows[0] || {};
  const coverageEnabled =
    row?.coverageSettings?.enabled === true
    || row?.modules?.cobertura_calculadora === true
    || Number(row?.coverageRulesCount || 0) > 0;

  return {
    companyId: scope.company_id,
    companyName: scope.company_name,
    contractId: scope.id,
    contractName: scope.contract_name,
    ...row,
    coverageEnabled,
    coverageSettings: {
      enabled: coverageEnabled,
      ...(row?.coverageSettings && typeof row.coverageSettings === "object" ? row.coverageSettings : {}),
    },
  };
}

async function listContractPositionRules(contractId, filters = {}) {
  const scope = await getContractScope(contractId);
  const values = [scope.id];
  const conditions = [`cpr.contract_id = $1`];

  if (filters.active !== undefined && filters.active !== null && filters.active !== "") {
    values.push(toBool(filters.active, true));
    conditions.push(`cpr.active = $${values.length}`);
  }

  if (filters.search) {
    values.push(`%${safe(filters.search)}%`);
    conditions.push(`(
      cpr.code ILIKE $${values.length}
      OR cpr.name ILIKE $${values.length}
      OR COALESCE(cpr.bid_position_name, '') ILIKE $${values.length}
      OR COALESCE(cpr.operational_position_name, '') ILIKE $${values.length}
      OR cpr.document_rule_source ILIKE $${values.length}
    )`);
  }

  const limit = toLimit(filters.limit ?? filters.pageSize, 500, 1000);
  const offset = toOffset(filters.offset);
  values.push(limit, offset);

  const result = await pool.query(
    `SELECT
       cpr.id,
       cpr.tenant_id AS "tenantId",
       cpr.company_id AS "companyId",
       cpr.contract_id AS "contractId",
       cpr.legacy_contract_position_id AS "legacyContractPositionId",
       cpr.master_position_id AS "masterPositionId",
       mp.code AS "masterPositionCode",
       cpr.code,
       cpr.name,
       cpr.bid_position_name AS "bidPositionName",
       cpr.operational_position_name AS "operationalPositionName",
       cpr.document_rule_source AS "documentRuleSource",
       cpr.category,
       cpr.area_code AS "areaCode",
       ma.name AS "areaName",
       cpr.counts_for_coverage AS "countsForCoverage",
       cpr.is_minimum_team AS "isMinimumTeam",
       cpr.allows_extra_personnel AS "allowsExtraPersonnel",
       cpr.manages_multiple_municipalities AS "managesMultipleMunicipalities",
       cpr.workday_type AS "workdayType",
       cpr.profile_level AS "profileLevel",
       cpr.position_type AS "positionType",
       cpr.notes,
       cpr.active,
       cpr.created_at AS "createdAt",
       cpr.updated_at AS "updatedAt"
     FROM contract_position_rules cpr
     LEFT JOIN master_positions mp ON mp.id = cpr.master_position_id
     LEFT JOIN master_areas ma ON ma.code = cpr.area_code
     WHERE ${conditions.join(" AND ")}
     ORDER BY cpr.active DESC, cpr.code ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return result.rows;
}

async function getContractPositionRuleById(id) {
  const result = await pool.query(
    `SELECT
       cpr.id,
       cpr.tenant_id AS "tenantId",
       cpr.company_id AS "companyId",
       cpr.contract_id AS "contractId",
       cpr.legacy_contract_position_id AS "legacyContractPositionId",
       cpr.master_position_id AS "masterPositionId",
       mp.code AS "masterPositionCode",
       cpr.code,
       cpr.name,
       cpr.bid_position_name AS "bidPositionName",
       cpr.operational_position_name AS "operationalPositionName",
       cpr.document_rule_source AS "documentRuleSource",
       cpr.category,
       cpr.area_code AS "areaCode",
       ma.name AS "areaName",
       cpr.counts_for_coverage AS "countsForCoverage",
       cpr.is_minimum_team AS "isMinimumTeam",
       cpr.allows_extra_personnel AS "allowsExtraPersonnel",
       cpr.manages_multiple_municipalities AS "managesMultipleMunicipalities",
       cpr.workday_type AS "workdayType",
       cpr.profile_level AS "profileLevel",
       cpr.position_type AS "positionType",
       cpr.notes,
       cpr.active,
       cpr.created_at AS "createdAt",
       cpr.updated_at AS "updatedAt"
     FROM contract_position_rules cpr
     LEFT JOIN master_positions mp ON mp.id = cpr.master_position_id
     LEFT JOIN master_areas ma ON ma.code = cpr.area_code
     WHERE cpr.id = $1
     LIMIT 1`,
    [toInt(id)]
  );
  return result.rows[0] || null;
}

async function createContractPositionRule(contractId, payload = {}) {
  const scope = await getContractScope(contractId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const masterPositionId = await resolveMasterPositionId(payload.masterPositionId || payload.master_position_id, client);
    const masterPosition = masterPositionId ? await getMasterPositionById(masterPositionId, client) : null;
    const derivedFields = deriveContractPositionFields(payload, masterPosition);
    const staffingMode = derivedFields.staffingMode;
    const bidPositionName = derivedFields.bidPositionName;
    const operationalPositionName = derivedFields.operationalPositionName;
    const code = upperSafe(payload.code || masterPosition?.code || normalizeCode(bidPositionName || operationalPositionName || payload.name || "CPR", "CPR"));
    const name = safe(payload.name || documentRuleNameFromPayload(payload, masterPosition, bidPositionName, operationalPositionName, code));
    const documentRuleSource = derivedFields.documentRuleSource;
    const areaCode = await resolveMasterAreaCode(payload.areaCode || payload.area_code || payload.area || masterPosition?.area, client);

    if (!code) throw new Error("El código del cargo contractual es obligatorio");
    if (!name) throw new Error("El nombre del cargo contractual es obligatorio");
    if (staffingMode === "LICITACION" && !bidPositionName) {
      throw new Error("bid_position_name es obligatorio cuando el tipo de personal es LICITACION");
    }
    if (staffingMode === "EXTRA" && !operationalPositionName) {
      throw new Error("operational_position_name es obligatorio cuando bid_position_name = EXTRA");
    }
    if (!documentRuleSource) throw new Error("document_rule_source es obligatorio");
    await ensureContractPositionRuleUniqueness({
      contractId: scope.id,
      code,
      name,
      bidPositionName,
      operationalPositionName,
    }, client);

    const result = await client.query(
      `INSERT INTO contract_position_rules (
         tenant_id, company_id, contract_id, master_position_id, code, name,
         bid_position_name, operational_position_name, document_rule_source,
         category, area_code, counts_for_coverage, is_minimum_team,
         allows_extra_personnel, manages_multiple_municipalities, workday_type,
         profile_level, position_type, notes, active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING id`,
      [
        toInt(scope.tenant_id) || 1,
        scope.company_id,
        scope.id,
        masterPositionId,
        code,
        name,
        bidPositionName,
        operationalPositionName,
        documentRuleSource,
        safe(payload.category || masterPosition?.category) || null,
        areaCode,
        toBool(payload.countsForCoverage ?? payload.counts_for_coverage, masterPosition?.countsForCoverage ?? false),
        toBool(payload.isMinimumTeam ?? payload.is_minimum_team, staffingMode !== "EXTRA"),
        toBool(payload.allowsExtraPersonnel ?? payload.allows_extra_personnel, true),
        toBool(payload.managesMultipleMunicipalities ?? payload.manages_multiple_municipalities, false),
        safe(payload.workdayType || payload.workday_type) || null,
        safe(payload.profileLevel || payload.profile_level || masterPosition?.profileLevel) || null,
        safe(payload.positionType || payload.position_type) || null,
        safe(payload.notes) || null,
        toBool(payload.active, true),
      ]
    );

    await syncLegacyContractPosition(client, result.rows[0].id);
    await client.query("COMMIT");
    return await getContractPositionRuleById(result.rows[0].id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw mapPgError(error, "No fue posible crear la regla contractual del cargo.");
  } finally {
    client.release();
  }
}

function documentRuleNameFromPayload(payload, masterPosition, bidPositionName, operationalPositionName, code) {
  return safe(payload.name)
    || safe(masterPosition?.documentRuleSource)
    || normalizeExtraDocumentSource(bidPositionName, operationalPositionName, "")
    || safe(masterPosition?.bidPositionName)
    || safe(masterPosition?.operationalPositionName)
    || safe(code);
}

async function updateContractPositionRule(id, payload = {}) {
  const current = await getContractPositionRuleById(id);
  if (!current) throw new Error("Regla contractual del cargo no encontrada");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const masterPositionId = payload.masterPositionId !== undefined || payload.master_position_id !== undefined
      ? await resolveMasterPositionId(payload.masterPositionId || payload.master_position_id, client)
      : current.masterPositionId;
    const masterPosition = masterPositionId ? await getMasterPositionById(masterPositionId, client) : null;

    const derivedFields = deriveContractPositionFields(payload, masterPosition, current);
    const staffingMode = derivedFields.staffingMode;
    const bidPositionName = derivedFields.bidPositionName;
    const operationalPositionName = derivedFields.operationalPositionName;
    const name = payload.name !== undefined
      ? safe(payload.name)
      : current.name;
    const documentRuleSource = derivedFields.documentRuleSource;
    const areaCode = payload.areaCode !== undefined || payload.area_code !== undefined || payload.area !== undefined
      ? await resolveMasterAreaCode(payload.areaCode || payload.area_code || payload.area, client)
      : current.areaCode;

    if (staffingMode === "LICITACION" && !bidPositionName) {
      throw new Error("bid_position_name es obligatorio cuando el tipo de personal es LICITACION");
    }
    if (staffingMode === "EXTRA" && !operationalPositionName) {
      throw new Error("operational_position_name es obligatorio cuando bid_position_name = EXTRA");
    }
    if (!documentRuleSource) throw new Error("document_rule_source es obligatorio");
    await ensureContractPositionRuleUniqueness({
      contractId: current.contractId,
      code: payload.code !== undefined ? upperSafe(payload.code) : current.code,
      name,
      bidPositionName,
      operationalPositionName,
      excludeId: id,
    }, client);

    await client.query(
      `UPDATE contract_position_rules
       SET master_position_id = $2,
           code = $3,
           name = $4,
           bid_position_name = $5,
           operational_position_name = $6,
           document_rule_source = $7,
           category = $8,
           area_code = $9,
           counts_for_coverage = $10,
           is_minimum_team = $11,
           allows_extra_personnel = $12,
           manages_multiple_municipalities = $13,
           workday_type = $14,
           profile_level = $15,
           position_type = $16,
           notes = $17,
           active = $18
       WHERE id = $1`,
      [
        toInt(id),
        masterPositionId,
        payload.code !== undefined ? upperSafe(payload.code) : current.code,
        name,
        bidPositionName,
        operationalPositionName,
        documentRuleSource,
        payload.category !== undefined ? (safe(payload.category) || null) : current.category,
        areaCode,
        payload.countsForCoverage !== undefined || payload.counts_for_coverage !== undefined
          ? toBool(payload.countsForCoverage ?? payload.counts_for_coverage, false)
          : current.countsForCoverage,
        payload.isMinimumTeam !== undefined || payload.is_minimum_team !== undefined
          ? toBool(payload.isMinimumTeam ?? payload.is_minimum_team, false)
          : (staffingMode !== "EXTRA" ? current.isMinimumTeam : false),
        payload.allowsExtraPersonnel !== undefined || payload.allows_extra_personnel !== undefined
          ? toBool(payload.allowsExtraPersonnel ?? payload.allows_extra_personnel, true)
          : current.allowsExtraPersonnel,
        payload.managesMultipleMunicipalities !== undefined || payload.manages_multiple_municipalities !== undefined
          ? toBool(payload.managesMultipleMunicipalities ?? payload.manages_multiple_municipalities, false)
          : current.managesMultipleMunicipalities,
        payload.workdayType !== undefined || payload.workday_type !== undefined
          ? (safe(payload.workdayType || payload.workday_type) || null)
          : current.workdayType,
        payload.profileLevel !== undefined || payload.profile_level !== undefined
          ? (safe(payload.profileLevel || payload.profile_level) || null)
          : current.profileLevel,
        payload.positionType !== undefined || payload.position_type !== undefined
          ? (safe(payload.positionType || payload.position_type) || null)
          : current.positionType,
        payload.notes !== undefined ? (safe(payload.notes) || null) : current.notes,
        payload.active !== undefined ? toBool(payload.active, true) : current.active,
      ]
    );

    await syncLegacyContractPosition(client, id);
    await client.query("COMMIT");
    return await getContractPositionRuleById(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw mapPgError(error, "No fue posible actualizar la regla contractual del cargo.");
  } finally {
    client.release();
  }
}

async function deactivateContractPositionRule(id) {
  return updateContractPositionRule(id, { active: false });
}

async function listContractDocumentRules(contractId, filters = {}) {
  const scope = await getContractScope(contractId);
  const values = [scope.id];
  const conditions = [`cdr.contract_id = $1`];

  if (filters.active !== undefined && filters.active !== null && filters.active !== "") {
    values.push(toBool(filters.active, true));
    conditions.push(`cdr.active = $${values.length}`);
  }

  if (filters.contractPositionRuleId) {
    values.push(toInt(filters.contractPositionRuleId));
    conditions.push(`cdr.contract_position_rule_id = $${values.length}`);
  }

  const limit = toLimit(filters.limit ?? filters.pageSize, 500, 1000);
  const offset = toOffset(filters.offset);
  values.push(limit, offset);

  const result = await pool.query(
    `SELECT
       cdr.id,
       cdr.contract_id AS "contractId",
       cdr.contract_position_rule_id AS "contractPositionRuleId",
       cpr.code AS "contractPositionCode",
       cpr.name AS "contractPositionName",
       cdr.master_document_type_id AS "masterDocumentTypeId",
       mdt.code AS "documentCode",
       mdt.name AS "documentName",
       mdt.phase,
       mdt.is_global_base AS "isGlobalBase",
       cdr.master_modality_id AS "masterModalityId",
       mm.code AS "modalityCode",
       mm.name AS "modalityName",
       cdr.municipality_id AS "municipalityId",
       m.name AS "municipalityName",
       cdr.institution_id AS "institutionId",
       i.name AS "institutionName",
       cdr.site_id AS "siteId",
       es.name AS "siteName",
       cdr.applies_to_staffing_type AS "appliesToStaffingType",
       cdr.required,
       cdr.expires,
       cdr.alert_days_before_expiration AS "alertDaysBeforeExpiration",
       cdr.requires_approval AS "requiresApproval",
       cdr.validation_mode AS "validationMode",
       cdr.notes,
       cdr.active,
       cdr.created_at AS "createdAt",
       cdr.updated_at AS "updatedAt"
     FROM contract_document_rules cdr
     JOIN master_document_types mdt ON mdt.id = cdr.master_document_type_id
     LEFT JOIN contract_position_rules cpr ON cpr.id = cdr.contract_position_rule_id
     LEFT JOIN master_modalities mm ON mm.id = cdr.master_modality_id
     LEFT JOIN municipalities m ON m.id = cdr.municipality_id
     LEFT JOIN institutions i ON i.id = cdr.institution_id
     LEFT JOIN educational_sites es ON es.id = cdr.site_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY cdr.active DESC, cpr.code NULLS FIRST, mdt.code ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return result.rows;
}

async function getContractDocumentRuleById(id) {
  const result = await pool.query(
    `SELECT
       cdr.id,
       cdr.contract_id AS "contractId",
       cdr.contract_position_rule_id AS "contractPositionRuleId",
       cpr.code AS "contractPositionCode",
       cpr.name AS "contractPositionName",
       cdr.master_document_type_id AS "masterDocumentTypeId",
       mdt.code AS "documentCode",
       mdt.name AS "documentName",
       mdt.phase,
       cdr.master_modality_id AS "masterModalityId",
       mm.code AS "modalityCode",
       mm.name AS "modalityName",
       cdr.municipality_id AS "municipalityId",
       cdr.institution_id AS "institutionId",
       cdr.site_id AS "siteId",
       cdr.applies_to_staffing_type AS "appliesToStaffingType",
       cdr.required,
       cdr.expires,
       cdr.alert_days_before_expiration AS "alertDaysBeforeExpiration",
       cdr.requires_approval AS "requiresApproval",
       cdr.validation_mode AS "validationMode",
       cdr.notes,
       cdr.active,
       cdr.created_at AS "createdAt",
       cdr.updated_at AS "updatedAt"
     FROM contract_document_rules cdr
     JOIN master_document_types mdt ON mdt.id = cdr.master_document_type_id
     LEFT JOIN contract_position_rules cpr ON cpr.id = cdr.contract_position_rule_id
     LEFT JOIN master_modalities mm ON mm.id = cdr.master_modality_id
     WHERE cdr.id = $1
     LIMIT 1`,
    [toInt(id)]
  );
  return result.rows[0] || null;
}

async function createContractDocumentRule(contractId, payload = {}) {
  const scope = await getContractScope(contractId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const masterDocumentTypeId = await resolveMasterDocumentTypeId(payload.masterDocumentTypeId || payload.master_document_type_id || payload.documentCode || payload.document_code, client);
    if (!masterDocumentTypeId) throw new Error("master_document_type_id es obligatorio");

    const contractPositionRuleId = toInt(payload.contractPositionRuleId || payload.contract_position_rule_id) || null;
    const masterModalityId = await resolveMasterModalityId(payload.masterModalityId || payload.master_modality_id || payload.modalityCode || payload.modality_code, client);
    const staffingType = upperSafe(payload.appliesToStaffingType || payload.applies_to_staffing_type || "ANY");
    if (!VALID_STAFFING_TYPES.includes(staffingType)) {
      throw new Error(`applies_to_staffing_type inválido. Válidos: ${VALID_STAFFING_TYPES.join(", ")}`);
    }
    const validationMode = upperSafe(payload.validationMode || payload.validation_mode || "DOCUMENTAL");
    if (!VALID_VALIDATION_MODES.includes(validationMode)) {
      throw new Error(`validation_mode inválido. Válidos: ${VALID_VALIDATION_MODES.join(", ")}`);
    }

    const result = await client.query(
      `INSERT INTO contract_document_rules (
         tenant_id, company_id, contract_id, contract_position_rule_id, master_document_type_id,
         master_modality_id, municipality_id, institution_id, site_id, applies_to_staffing_type,
         required, expires, alert_days_before_expiration, requires_approval, validation_mode,
         notes, active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id`,
      [
        toInt(scope.tenant_id) || 1,
        scope.company_id,
        scope.id,
        contractPositionRuleId,
        masterDocumentTypeId,
        masterModalityId,
        toInt(payload.municipalityId || payload.municipality_id) || null,
        toInt(payload.institutionId || payload.institution_id) || null,
        toInt(payload.siteId || payload.site_id) || null,
        staffingType,
        toBool(payload.required, true),
        toBool(payload.expires, false),
        toInt(payload.alertDaysBeforeExpiration || payload.alert_days_before_expiration),
        toBool(payload.requiresApproval ?? payload.requires_approval, true),
        validationMode,
        safe(payload.notes) || null,
        toBool(payload.active, true),
      ]
    );

    await syncLegacyContractDocumentRule(client, result.rows[0].id);
    await client.query("COMMIT");
    return await getContractDocumentRuleById(result.rows[0].id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw mapPgError(error, "No fue posible crear la regla documental contractual.");
  } finally {
    client.release();
  }
}

async function updateContractDocumentRule(id, payload = {}) {
  const current = await getContractDocumentRuleById(id);
  if (!current) throw new Error("Regla documental contractual no encontrada");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const masterDocumentTypeId = payload.masterDocumentTypeId !== undefined || payload.master_document_type_id !== undefined || payload.documentCode !== undefined || payload.document_code !== undefined
      ? await resolveMasterDocumentTypeId(payload.masterDocumentTypeId || payload.master_document_type_id || payload.documentCode || payload.document_code, client)
      : current.masterDocumentTypeId;
    const masterModalityId = payload.masterModalityId !== undefined || payload.master_modality_id !== undefined || payload.modalityCode !== undefined || payload.modality_code !== undefined
      ? await resolveMasterModalityId(payload.masterModalityId || payload.master_modality_id || payload.modalityCode || payload.modality_code, client)
      : current.masterModalityId;
    const staffingType = payload.appliesToStaffingType !== undefined || payload.applies_to_staffing_type !== undefined
      ? upperSafe(payload.appliesToStaffingType || payload.applies_to_staffing_type)
      : current.appliesToStaffingType;
    if (!VALID_STAFFING_TYPES.includes(staffingType)) {
      throw new Error(`applies_to_staffing_type inválido. Válidos: ${VALID_STAFFING_TYPES.join(", ")}`);
    }
    const validationMode = payload.validationMode !== undefined || payload.validation_mode !== undefined
      ? upperSafe(payload.validationMode || payload.validation_mode)
      : current.validationMode;
    if (!VALID_VALIDATION_MODES.includes(validationMode)) {
      throw new Error(`validation_mode inválido. Válidos: ${VALID_VALIDATION_MODES.join(", ")}`);
    }

    await client.query(
      `UPDATE contract_document_rules
       SET contract_position_rule_id = $2,
           master_document_type_id = $3,
           master_modality_id = $4,
           municipality_id = $5,
           institution_id = $6,
           site_id = $7,
           applies_to_staffing_type = $8,
           required = $9,
           expires = $10,
           alert_days_before_expiration = $11,
           requires_approval = $12,
           validation_mode = $13,
           notes = $14,
           active = $15
       WHERE id = $1`,
      [
        toInt(id),
        payload.contractPositionRuleId !== undefined || payload.contract_position_rule_id !== undefined
          ? (toInt(payload.contractPositionRuleId || payload.contract_position_rule_id) || null)
          : current.contractPositionRuleId,
        masterDocumentTypeId,
        masterModalityId,
        payload.municipalityId !== undefined || payload.municipality_id !== undefined
          ? (toInt(payload.municipalityId || payload.municipality_id) || null)
          : current.municipalityId,
        payload.institutionId !== undefined || payload.institution_id !== undefined
          ? (toInt(payload.institutionId || payload.institution_id) || null)
          : current.institutionId,
        payload.siteId !== undefined || payload.site_id !== undefined
          ? (toInt(payload.siteId || payload.site_id) || null)
          : current.siteId,
        staffingType,
        payload.required !== undefined ? toBool(payload.required, true) : current.required,
        payload.expires !== undefined ? toBool(payload.expires, false) : current.expires,
        payload.alertDaysBeforeExpiration !== undefined || payload.alert_days_before_expiration !== undefined
          ? toInt(payload.alertDaysBeforeExpiration || payload.alert_days_before_expiration)
          : current.alertDaysBeforeExpiration,
        payload.requiresApproval !== undefined || payload.requires_approval !== undefined
          ? toBool(payload.requiresApproval ?? payload.requires_approval, true)
          : current.requiresApproval,
        validationMode,
        payload.notes !== undefined ? (safe(payload.notes) || null) : current.notes,
        payload.active !== undefined ? toBool(payload.active, true) : current.active,
      ]
    );

    await syncLegacyContractDocumentRule(client, id);
    await client.query("COMMIT");
    return await getContractDocumentRuleById(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw mapPgError(error, "No fue posible actualizar la regla documental contractual.");
  } finally {
    client.release();
  }
}

async function deactivateContractDocumentRule(id) {
  return updateContractDocumentRule(id, { active: false });
}

async function listContractExperienceRules(contractId) {
  const scope = await getContractScope(contractId);
  const result = await pool.query(
    `SELECT
       cer.id,
       cer.contract_id AS "contractId",
       cer.contract_position_rule_id AS "contractPositionRuleId",
       cpr.code AS "contractPositionCode",
       cpr.name AS "contractPositionName",
       cer.master_experience_type_id AS "masterExperienceTypeId",
       met.code AS "experienceTypeCode",
       met.name AS "experienceTypeName",
       cer.applies_to_staffing_type AS "appliesToStaffingType",
       cer.specificity_type AS "specificityType",
       cer.minimum_months AS "minimumMonths",
       cer.notes,
       cer.active,
       cer.created_at AS "createdAt",
       cer.updated_at AS "updatedAt"
     FROM contract_experience_rules cer
     JOIN contract_position_rules cpr ON cpr.id = cer.contract_position_rule_id
     JOIN master_experience_types met ON met.id = cer.master_experience_type_id
     WHERE cer.contract_id = $1
     ORDER BY cer.active DESC, cpr.code ASC, met.code ASC`,
    [scope.id]
  );
  return result.rows;
}

async function getContractExperienceRuleById(id) {
  const result = await pool.query(
    `SELECT
       cer.id,
       cer.contract_id AS "contractId",
       cer.contract_position_rule_id AS "contractPositionRuleId",
       cpr.code AS "contractPositionCode",
       cpr.name AS "contractPositionName",
       cer.master_experience_type_id AS "masterExperienceTypeId",
       met.code AS "experienceTypeCode",
       met.name AS "experienceTypeName",
       cer.applies_to_staffing_type AS "appliesToStaffingType",
       cer.specificity_type AS "specificityType",
       cer.minimum_months AS "minimumMonths",
       cer.notes,
       cer.active,
       cer.created_at AS "createdAt",
       cer.updated_at AS "updatedAt"
     FROM contract_experience_rules cer
     JOIN contract_position_rules cpr ON cpr.id = cer.contract_position_rule_id
     JOIN master_experience_types met ON met.id = cer.master_experience_type_id
     WHERE cer.id = $1
     LIMIT 1`,
    [toInt(id)]
  );
  return result.rows[0] || null;
}

async function createContractExperienceRule(contractId, payload = {}) {
  const scope = await getContractScope(contractId);
  const contractPositionRuleId = toInt(payload.contractPositionRuleId || payload.contract_position_rule_id);
  if (!contractPositionRuleId) throw new Error("contract_position_rule_id es obligatorio");
  const masterExperienceTypeId = await resolveMasterExperienceTypeId(
    payload.masterExperienceTypeId || payload.master_experience_type_id || payload.experienceTypeCode || payload.experience_type_code
  );
  if (!masterExperienceTypeId) throw new Error("master_experience_type_id es obligatorio");

  const staffingType = upperSafe(payload.appliesToStaffingType || payload.applies_to_staffing_type || "ANY");
  if (!VALID_STAFFING_TYPES.includes(staffingType)) {
    throw new Error(`applies_to_staffing_type inválido. Válidos: ${VALID_STAFFING_TYPES.join(", ")}`);
  }
  const specificityType = upperSafe(payload.specificityType || payload.specificity_type || "GENERAL");
  if (!VALID_SPECIFICITY_TYPES.includes(specificityType)) {
    throw new Error(`specificity_type inválido. Válidos: ${VALID_SPECIFICITY_TYPES.join(", ")}`);
  }

  try {
    const result = await pool.query(
      `INSERT INTO contract_experience_rules (
         tenant_id, company_id, contract_id, contract_position_rule_id, master_experience_type_id,
         applies_to_staffing_type, specificity_type, minimum_months, notes, active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        toInt(scope.tenant_id) || 1,
        scope.company_id,
        scope.id,
        contractPositionRuleId,
        masterExperienceTypeId,
        staffingType,
        specificityType,
        Math.max(0, toInt(payload.minimumMonths || payload.minimum_months) || 0),
        safe(payload.notes) || null,
        toBool(payload.active, true),
      ]
    );
    return await getContractExperienceRuleById(result.rows[0].id);
  } catch (error) {
    throw mapPgError(error, "No fue posible crear la regla de experiencia.");
  }
}

async function updateContractExperienceRule(id, payload = {}) {
  const current = await getContractExperienceRuleById(id);
  if (!current) throw new Error("Regla de experiencia no encontrada");

  const staffingType = payload.appliesToStaffingType !== undefined || payload.applies_to_staffing_type !== undefined
    ? upperSafe(payload.appliesToStaffingType || payload.applies_to_staffing_type)
    : current.appliesToStaffingType;
  if (!VALID_STAFFING_TYPES.includes(staffingType)) {
    throw new Error(`applies_to_staffing_type inválido. Válidos: ${VALID_STAFFING_TYPES.join(", ")}`);
  }

  const specificityType = payload.specificityType !== undefined || payload.specificity_type !== undefined
    ? upperSafe(payload.specificityType || payload.specificity_type)
    : current.specificityType;
  if (!VALID_SPECIFICITY_TYPES.includes(specificityType)) {
    throw new Error(`specificity_type inválido. Válidos: ${VALID_SPECIFICITY_TYPES.join(", ")}`);
  }

  const masterExperienceTypeId = payload.masterExperienceTypeId !== undefined || payload.master_experience_type_id !== undefined || payload.experienceTypeCode !== undefined || payload.experience_type_code !== undefined
    ? await resolveMasterExperienceTypeId(payload.masterExperienceTypeId || payload.master_experience_type_id || payload.experienceTypeCode || payload.experience_type_code)
    : current.masterExperienceTypeId;

  try {
    await pool.query(
      `UPDATE contract_experience_rules
       SET contract_position_rule_id = $2,
           master_experience_type_id = $3,
           applies_to_staffing_type = $4,
           specificity_type = $5,
           minimum_months = $6,
           notes = $7,
           active = $8
       WHERE id = $1`,
      [
        toInt(id),
        payload.contractPositionRuleId !== undefined || payload.contract_position_rule_id !== undefined
          ? toInt(payload.contractPositionRuleId || payload.contract_position_rule_id)
          : current.contractPositionRuleId,
        masterExperienceTypeId,
        staffingType,
        specificityType,
        payload.minimumMonths !== undefined || payload.minimum_months !== undefined
          ? Math.max(0, toInt(payload.minimumMonths || payload.minimum_months) || 0)
          : current.minimumMonths,
        payload.notes !== undefined ? (safe(payload.notes) || null) : current.notes,
        payload.active !== undefined ? toBool(payload.active, true) : current.active,
      ]
    );
    return await getContractExperienceRuleById(id);
  } catch (error) {
    throw mapPgError(error, "No fue posible actualizar la regla de experiencia.");
  }
}

async function deactivateContractExperienceRule(id) {
  return updateContractExperienceRule(id, { active: false });
}

async function listContractCoverageRules(contractId) {
  const scope = await getContractScope(contractId);
  const result = await pool.query(
    `SELECT
       ccr.id,
       ccr.contract_id AS "contractId",
       ccr.contract_position_rule_id AS "contractPositionRuleId",
       cpr.code AS "contractPositionCode",
       cpr.name AS "contractPositionName",
       ccr.master_modality_id AS "masterModalityId",
       mm.code AS "modalityCode",
       mm.name AS "modalityName",
       ccr.municipality_id AS "municipalityId",
       m.name AS "municipalityName",
       ccr.institution_id AS "institutionId",
       i.name AS "institutionName",
       ccr.site_id AS "siteId",
       es.name AS "siteName",
       ccr.coverage_mode AS "coverageMode",
       ccr.enabled,
       ccr.minimum_cupos AS "minimumCupos",
       ccr.maximum_cupos AS "maximumCupos",
       ccr.required_tc AS "requiredTc",
       ccr.required_mt AS "requiredMt",
       ccr.notes,
       ccr.active,
       ccr.created_at AS "createdAt",
       ccr.updated_at AS "updatedAt"
     FROM contract_coverage_rules ccr
     LEFT JOIN contract_position_rules cpr ON cpr.id = ccr.contract_position_rule_id
     LEFT JOIN master_modalities mm ON mm.id = ccr.master_modality_id
     LEFT JOIN municipalities m ON m.id = ccr.municipality_id
     LEFT JOIN institutions i ON i.id = ccr.institution_id
     LEFT JOIN educational_sites es ON es.id = ccr.site_id
     WHERE ccr.contract_id = $1
     ORDER BY ccr.active DESC, ccr.enabled DESC, cpr.code NULLS FIRST`,
    [scope.id]
  );
  return result.rows;
}

async function getContractCoverageRuleById(id) {
  const result = await pool.query(
    `SELECT
       ccr.id,
       ccr.contract_id AS "contractId",
       ccr.contract_position_rule_id AS "contractPositionRuleId",
       ccr.master_modality_id AS "masterModalityId",
       ccr.municipality_id AS "municipalityId",
       ccr.institution_id AS "institutionId",
       ccr.site_id AS "siteId",
       ccr.coverage_mode AS "coverageMode",
       ccr.enabled,
       ccr.minimum_cupos AS "minimumCupos",
       ccr.maximum_cupos AS "maximumCupos",
       ccr.required_tc AS "requiredTc",
       ccr.required_mt AS "requiredMt",
       ccr.notes,
       ccr.active,
       ccr.created_at AS "createdAt",
       ccr.updated_at AS "updatedAt"
     FROM contract_coverage_rules ccr
     WHERE ccr.id = $1
     LIMIT 1`,
    [toInt(id)]
  );
  return result.rows[0] || null;
}

async function createContractCoverageRule(contractId, payload = {}) {
  const scope = await getContractScope(contractId);
  const coverageMode = upperSafe(payload.coverageMode || payload.coverage_mode || "UPLOAD");
  if (!VALID_COVERAGE_MODES.includes(coverageMode)) {
    throw new Error(`coverage_mode inválido. Válidos: ${VALID_COVERAGE_MODES.join(", ")}`);
  }

  const masterModalityId = await resolveMasterModalityId(
    payload.masterModalityId || payload.master_modality_id || payload.modalityCode || payload.modality_code
  );

  try {
    const result = await pool.query(
      `INSERT INTO contract_coverage_rules (
         tenant_id, company_id, contract_id, contract_position_rule_id, master_modality_id,
         municipality_id, institution_id, site_id, coverage_mode, enabled, minimum_cupos,
         maximum_cupos, required_tc, required_mt, notes, active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id`,
      [
        toInt(scope.tenant_id) || 1,
        scope.company_id,
        scope.id,
        toInt(payload.contractPositionRuleId || payload.contract_position_rule_id) || null,
        masterModalityId,
        toInt(payload.municipalityId || payload.municipality_id) || null,
        toInt(payload.institutionId || payload.institution_id) || null,
        toInt(payload.siteId || payload.site_id) || null,
        coverageMode,
        toBool(payload.enabled, true),
        toInt(payload.minimumCupos || payload.minimum_cupos) || null,
        toInt(payload.maximumCupos || payload.maximum_cupos) || null,
        toInt(payload.requiredTc || payload.required_tc) || null,
        toInt(payload.requiredMt || payload.required_mt) || null,
        safe(payload.notes) || null,
        toBool(payload.active, true),
      ]
    );
    return await getContractCoverageRuleById(result.rows[0].id);
  } catch (error) {
    throw mapPgError(error, "No fue posible crear la regla de cobertura.");
  }
}

async function updateContractCoverageRule(id, payload = {}) {
  const current = await getContractCoverageRuleById(id);
  if (!current) throw new Error("Regla de cobertura no encontrada");

  const coverageMode = payload.coverageMode !== undefined || payload.coverage_mode !== undefined
    ? upperSafe(payload.coverageMode || payload.coverage_mode)
    : current.coverageMode;
  if (!VALID_COVERAGE_MODES.includes(coverageMode)) {
    throw new Error(`coverage_mode inválido. Válidos: ${VALID_COVERAGE_MODES.join(", ")}`);
  }

  const masterModalityId = payload.masterModalityId !== undefined || payload.master_modality_id !== undefined || payload.modalityCode !== undefined || payload.modality_code !== undefined
    ? await resolveMasterModalityId(payload.masterModalityId || payload.master_modality_id || payload.modalityCode || payload.modality_code)
    : current.masterModalityId;

  try {
    await pool.query(
      `UPDATE contract_coverage_rules
       SET contract_position_rule_id = $2,
           master_modality_id = $3,
           municipality_id = $4,
           institution_id = $5,
           site_id = $6,
           coverage_mode = $7,
           enabled = $8,
           minimum_cupos = $9,
           maximum_cupos = $10,
           required_tc = $11,
           required_mt = $12,
           notes = $13,
           active = $14
       WHERE id = $1`,
      [
        toInt(id),
        payload.contractPositionRuleId !== undefined || payload.contract_position_rule_id !== undefined
          ? (toInt(payload.contractPositionRuleId || payload.contract_position_rule_id) || null)
          : current.contractPositionRuleId,
        masterModalityId,
        payload.municipalityId !== undefined || payload.municipality_id !== undefined
          ? (toInt(payload.municipalityId || payload.municipality_id) || null)
          : current.municipalityId,
        payload.institutionId !== undefined || payload.institution_id !== undefined
          ? (toInt(payload.institutionId || payload.institution_id) || null)
          : current.institutionId,
        payload.siteId !== undefined || payload.site_id !== undefined
          ? (toInt(payload.siteId || payload.site_id) || null)
          : current.siteId,
        coverageMode,
        payload.enabled !== undefined ? toBool(payload.enabled, true) : current.enabled,
        payload.minimumCupos !== undefined || payload.minimum_cupos !== undefined
          ? (toInt(payload.minimumCupos || payload.minimum_cupos) || null)
          : current.minimumCupos,
        payload.maximumCupos !== undefined || payload.maximum_cupos !== undefined
          ? (toInt(payload.maximumCupos || payload.maximum_cupos) || null)
          : current.maximumCupos,
        payload.requiredTc !== undefined || payload.required_tc !== undefined
          ? (toInt(payload.requiredTc || payload.required_tc) || null)
          : current.requiredTc,
        payload.requiredMt !== undefined || payload.required_mt !== undefined
          ? (toInt(payload.requiredMt || payload.required_mt) || null)
          : current.requiredMt,
        payload.notes !== undefined ? (safe(payload.notes) || null) : current.notes,
        payload.active !== undefined ? toBool(payload.active, true) : current.active,
      ]
    );
    return await getContractCoverageRuleById(id);
  } catch (error) {
    throw mapPgError(error, "No fue posible actualizar la regla de cobertura.");
  }
}

async function deactivateContractCoverageRule(id) {
  return updateContractCoverageRule(id, { active: false });
}

async function listContractMunicipalities(contractId) {
  const scope = await getContractScope(contractId);
  const result = await pool.query(
    `SELECT
       cm.id,
       cm.contract_id AS "contractId",
       cm.municipality_id AS "municipalityId",
       m.name AS "municipalityName",
       cm.active,
       cm.created_at AS "createdAt",
       cm.updated_at AS "updatedAt"
     FROM contract_municipalities cm
     JOIN municipalities m ON m.id = cm.municipality_id
     WHERE cm.contract_id = $1
     ORDER BY cm.active DESC, m.name ASC`,
    [scope.id]
  );
  return result.rows;
}

async function replaceContractMunicipalities(contractId, municipalityIds = []) {
  const scope = await getContractScope(contractId);
  const ids = [...new Set((Array.isArray(municipalityIds) ? municipalityIds : []).map(toInt).filter(Boolean))];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (ids.length) {
      await client.query(
        `UPDATE contract_municipalities
         SET active = false
         WHERE contract_id = $1
           AND municipality_id <> ALL($2::int[])`,
        [scope.id, ids]
      );
    } else {
      await client.query(
        `UPDATE contract_municipalities
         SET active = false
         WHERE contract_id = $1`,
        [scope.id]
      );
    }

    for (const municipalityId of ids) {
      await client.query(
        `INSERT INTO contract_municipalities (
           tenant_id, company_id, contract_id, municipality_id, active
         )
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (contract_id, municipality_id)
         DO UPDATE SET active = true, updated_at = NOW()`,
        [toInt(scope.tenant_id) || 1, scope.company_id, scope.id, municipalityId]
      );
    }

    await client.query("COMMIT");
    return await listContractMunicipalities(scope.id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw mapPgError(error, "No fue posible actualizar los municipios del contrato.");
  } finally {
    client.release();
  }
}

async function listContractModalities(contractId) {
  const scope = await getContractScope(contractId);
  const result = await pool.query(
    `SELECT
       cm.id,
       cm.contract_id AS "contractId",
       cm.master_modality_id AS "masterModalityId",
       mm.code AS "modalityCode",
       mm.name AS "modalityName",
       cm.municipality_id AS "municipalityId",
       m.name AS "municipalityName",
       cm.institution_id AS "institutionId",
       i.name AS "institutionName",
       cm.site_id AS "siteId",
       es.name AS "siteName",
       cm.active,
       cm.created_at AS "createdAt",
       cm.updated_at AS "updatedAt"
     FROM contract_modalities cm
     JOIN master_modalities mm ON mm.id = cm.master_modality_id
     LEFT JOIN municipalities m ON m.id = cm.municipality_id
     LEFT JOIN institutions i ON i.id = cm.institution_id
     LEFT JOIN educational_sites es ON es.id = cm.site_id
     WHERE cm.contract_id = $1
     ORDER BY cm.active DESC, mm.code ASC, m.name NULLS FIRST, i.name NULLS FIRST, es.name NULLS FIRST`,
    [scope.id]
  );
  return result.rows;
}

async function replaceContractModalities(contractId, items = []) {
  const scope = await getContractScope(contractId);
  const normalizedItems = [];
  for (const item of Array.isArray(items) ? items : []) {
    const masterModalityId = await resolveMasterModalityId(
      item.masterModalityId || item.master_modality_id || item.modalityCode || item.modality_code
    );
    if (!masterModalityId) continue;
    normalizedItems.push({
      masterModalityId,
      municipalityId: toInt(item.municipalityId || item.municipality_id) || null,
      institutionId: toInt(item.institutionId || item.institution_id) || null,
      siteId: toInt(item.siteId || item.site_id) || null,
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE contract_modalities
       SET active = false
       WHERE contract_id = $1`,
      [scope.id]
    );

    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO contract_modalities (
           tenant_id, company_id, contract_id, master_modality_id, municipality_id, institution_id, site_id, active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)
         ON CONFLICT (
           contract_id,
           master_modality_id,
           COALESCE(municipality_id, 0),
           COALESCE(institution_id, 0),
           COALESCE(site_id, 0)
         )
         DO UPDATE SET active = true, updated_at = NOW()`,
        [
          toInt(scope.tenant_id) || 1,
          scope.company_id,
          scope.id,
          item.masterModalityId,
          item.municipalityId,
          item.institutionId,
          item.siteId,
        ]
      );
    }

    await client.query("COMMIT");
    return await listContractModalities(scope.id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw mapPgError(error, "No fue posible actualizar las modalidades del contrato.");
  } finally {
    client.release();
  }
}

async function listEmployeeAssignments(employeeId, filters = {}) {
  const id = toInt(employeeId);
  if (!id) throw new Error("employee_id inválido");
  const values = [id];
  const conditions = [`employee_id = $1`];

  if (!toBool(filters.includeInactive, false)) {
    conditions.push(`active = true`);
  }

  const result = await pool.query(
    `SELECT
       assignment_id AS "assignmentId",
       employee_id AS "employeeId",
       employee_name AS "employeeName",
       document_number AS "documentNumber",
       tenant_id AS "tenantId",
       company_id AS "companyId",
       company_name AS "companyName",
       contract_id AS "contractId",
       contract_name AS "contractName",
       contract_position_rule_id AS "contractPositionRuleId",
       contract_position_code AS "contractPositionCode",
       contract_position_name AS "contractPositionName",
       master_position_id AS "masterPositionId",
       master_position_code AS "masterPositionCode",
       bid_position_name AS "bidPositionName",
       operational_position_name AS "operationalPositionName",
       document_rule_source AS "documentRuleSource",
       area_code AS "areaCode",
       area_name AS "areaName",
       municipality_id AS "municipalityId",
       municipality_name AS "municipalityName",
       institution_id AS "institutionId",
       institution_name AS "institutionName",
       site_id AS "siteId",
       site_name AS "siteName",
       master_modality_id AS "masterModalityId",
       modality_code AS "modalityCode",
       modality_name AS "modalityName",
       workday_type AS "workdayType",
       presented_in_bid AS "presentedInBid",
       staffing_type AS "staffingType",
       coverage_enabled AS "coverageEnabled",
       manages_multiple_municipalities AS "managesMultipleMunicipalities",
       assignment_start_date AS "assignmentStartDate",
       assignment_end_date AS "assignmentEndDate",
       status,
       notes,
       active,
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM v_employee_current_assignments
     WHERE ${conditions.join(" AND ")}
     ORDER BY assignment_id DESC`,
    values
  );
  return result.rows;
}

async function listEmployeeAssignmentHistory(employeeId) {
  const id = toInt(employeeId);
  if (!id) throw new Error("employee_id inválido");
  const result = await pool.query(
    `SELECT
       eah.id,
       eah.assignment_id AS "assignmentId",
       eah.employee_id AS "employeeId",
       eah.company_id AS "companyId",
       eah.contract_id AS "contractId",
       eah.action_type AS "actionType",
       eah.field_name AS "fieldName",
       eah.old_value AS "oldValue",
       eah.new_value AS "newValue",
       eah.snapshot_before AS "snapshotBefore",
       eah.snapshot_after AS "snapshotAfter",
       eah.changed_by_user_id AS "changedByUserId",
       u.full_name AS "changedByUserName",
       eah.notes,
       eah.created_at AS "createdAt"
     FROM employee_assignment_history eah
     LEFT JOIN users u ON u.id = eah.changed_by_user_id
     WHERE eah.employee_id = $1
     ORDER BY eah.created_at DESC, eah.id DESC`,
    [id]
  );
  return result.rows;
}

async function listEmployeeDocumentCompliance(employeeId) {
  const id = toInt(employeeId);
  if (!id) throw new Error("employee_id inválido");

     const result = await pool.query(
    `WITH latest_docs AS (
       SELECT DISTINCT ON (ed.employee_id, COALESCE(ed.master_document_type_id, dt.master_document_type_id), COALESCE(ed.employee_assignment_id, 0))
         ed.employee_id,
         ed.employee_assignment_id,
         COALESCE(ed.master_document_type_id, dt.master_document_type_id) AS master_document_type_id,
         ed.id AS employee_document_id,
         ed.document_type_id,
         ed.file_name,
         ed.file_url,
         ed.status,
         ed.uploaded_at,
         ed.expiration_date,
         ed.validated,
         ed.observations
       FROM employee_documents ed
       LEFT JOIN document_types dt ON dt.id = ed.document_type_id
       WHERE ed.employee_id = $1
         AND COALESCE(ed.master_document_type_id, dt.master_document_type_id) IS NOT NULL
       ORDER BY
         ed.employee_id,
         COALESCE(ed.master_document_type_id, dt.master_document_type_id),
         COALESCE(ed.employee_assignment_id, 0),
         ed.uploaded_at DESC NULLS LAST,
         ed.id DESC
     )
     SELECT
       vedr.assignment_id AS "assignmentId",
       vedr.employee_id AS "employeeId",
       vedr.contract_id AS "contractId",
       vedr.contract_position_rule_id AS "contractPositionRuleId",
       vedr.staffing_type AS "staffingType",
       vedr.master_document_type_id AS "masterDocumentTypeId",
       vedr.document_code AS "documentCode",
       vedr.document_name AS "documentName",
       vedr.phase,
       vedr.rule_origin AS "ruleOrigin",
       vedr.required,
       vedr.expires,
       vedr.alert_days_before_expiration AS "alertDaysBeforeExpiration",
       vedr.requires_approval AS "requiresApproval",
       vedr.validation_mode AS "validationMode",
       vedr.visible_to_auditor AS "visibleToAuditor",
       ld.employee_document_id AS "employeeDocumentId",
       ld.document_type_id AS "documentTypeId",
       ld.file_name AS "fileName",
       ld.file_url AS "fileUrl",
       ld.status AS "documentStatus",
       ld.uploaded_at AS "uploadedAt",
       ld.expiration_date AS "expirationDate",
       ld.validated,
       ld.observations,
       CASE WHEN ld.employee_document_id IS NULL THEN true ELSE false END AS "isMissing",
       CASE
         WHEN ld.expiration_date IS NOT NULL AND ld.expiration_date < CURRENT_DATE THEN true
         ELSE false
       END AS "isExpired",
       CASE
         WHEN ld.expiration_date IS NOT NULL
          AND vedr.alert_days_before_expiration IS NOT NULL
          AND ld.expiration_date <= CURRENT_DATE + (vedr.alert_days_before_expiration || ' days')::interval
         THEN true
         ELSE false
       END AS "isExpiringSoon"
     FROM v_employee_effective_document_rules vedr
     LEFT JOIN latest_docs ld
       ON ld.employee_id = vedr.employee_id
      AND ld.master_document_type_id = vedr.master_document_type_id
      AND (
        ld.employee_assignment_id = vedr.assignment_id
        OR ld.employee_assignment_id IS NULL
      )
     WHERE vedr.employee_id = $1
     ORDER BY vedr.assignment_id, vedr.rule_origin, vedr.document_code`,
    [id]
  );
  return result.rows;
}

async function listEmployeeExperienceSummary(employeeId) {
  const id = toInt(employeeId);
  if (!id) throw new Error("employee_id inválido");

  const summary = await pool.query(
    `SELECT
       employee_id AS "employeeId",
       master_experience_type_id AS "masterExperienceTypeId",
       experience_type_code AS "experienceTypeCode",
       experience_type_name AS "experienceTypeName",
       records_count AS "recordsCount",
       total_months AS "totalMonths",
       validated_months AS "validatedMonths",
       latest_end_date AS "latestEndDate"
     FROM v_employee_experience_summary
     WHERE employee_id = $1
     ORDER BY experience_type_code`,
    [id]
  );

  const details = await pool.query(
    `SELECT
       ee.id,
       ee.employee_id AS "employeeId",
       ee.employee_assignment_id AS "employeeAssignmentId",
       ee.company_name AS "companyName",
       ee.position_name AS "positionName",
       ee.master_experience_type_id AS "masterExperienceTypeId",
       met.code AS "experienceTypeCode",
       met.name AS "experienceTypeName",
       ee.source_type AS "sourceType",
       ee.start_date AS "startDate",
       ee.end_date AS "endDate",
       ee.months_calculated AS "monthsCalculated",
       ee.support_file_url AS "supportFileUrl",
       ee.support_file_name AS "supportFileName",
       ee.validated,
       ee.validated_by_user_id AS "validatedByUserId",
       ee.validated_at AS "validatedAt",
       ee.observations,
       ee.active,
       ee.created_at AS "createdAt",
       ee.updated_at AS "updatedAt"
     FROM employee_experiences ee
     JOIN master_experience_types met ON met.id = ee.master_experience_type_id
     WHERE ee.employee_id = $1
     ORDER BY ee.start_date DESC, ee.id DESC`,
    [id]
  );

  return {
    summary: summary.rows,
    records: details.rows,
  };
}

async function evaluateEmployeeExperience(employeeId) {
  const id = toInt(employeeId);
  if (!id) throw new Error("employee_id inválido");

  const result = await pool.query(
    `WITH current_assignments AS (
       SELECT *
       FROM v_employee_current_assignments
       WHERE employee_id = $1
     )
     SELECT
       ca.assignment_id AS "assignmentId",
       ca.contract_id AS "contractId",
       ca.contract_name AS "contractName",
       ca.contract_position_rule_id AS "contractPositionRuleId",
       ca.contract_position_code AS "contractPositionCode",
       ca.contract_position_name AS "contractPositionName",
       ca.staffing_type AS "staffingType",
       cer.id AS "contractExperienceRuleId",
       cer.master_experience_type_id AS "masterExperienceTypeId",
       met.code AS "experienceTypeCode",
       met.name AS "experienceTypeName",
       cer.specificity_type AS "specificityType",
       cer.minimum_months AS "minimumMonths",
       cer.applies_to_staffing_type AS "appliesToStaffingType",
       COALESCE(ves.total_months, 0) AS "totalMonths",
       COALESCE(ves.validated_months, 0) AS "validatedMonths",
       COALESCE(ves.validated_months, 0) >= cer.minimum_months AS "isCompliant"
     FROM current_assignments ca
     JOIN contract_experience_rules cer
       ON cer.contract_position_rule_id = ca.contract_position_rule_id
      AND cer.active = true
      AND (cer.applies_to_staffing_type = 'ANY' OR cer.applies_to_staffing_type = ca.staffing_type)
     JOIN master_experience_types met ON met.id = cer.master_experience_type_id
     LEFT JOIN v_employee_experience_summary ves
       ON ves.employee_id = ca.employee_id
      AND ves.master_experience_type_id = cer.master_experience_type_id
     ORDER BY ca.assignment_id, met.code`,
    [id]
  );
  return result.rows;
}

async function getEmployeeCoverageContext(employeeId) {
  const id = toInt(employeeId);
  if (!id) throw new Error("employee_id inválido");

  const result = await pool.query(
    `SELECT
       ca.assignment_id AS "assignmentId",
       ca.contract_id AS "contractId",
       ca.contract_name AS "contractName",
       ca.contract_position_rule_id AS "contractPositionRuleId",
       ca.contract_position_code AS "contractPositionCode",
       ca.contract_position_name AS "contractPositionName",
       ca.modality_code AS "modalityCode",
       ca.modality_name AS "modalityName",
       ca.municipality_id AS "municipalityId",
       ca.municipality_name AS "municipalityName",
       ca.institution_id AS "institutionId",
       ca.institution_name AS "institutionName",
       ca.site_id AS "siteId",
       ca.site_name AS "siteName",
       ca.coverage_enabled AS "coverageEnabled",
       ccr.id AS "coverageRuleId",
       ccr.coverage_mode AS "coverageMode",
       ccr.enabled,
       ccr.minimum_cupos AS "minimumCupos",
       ccr.maximum_cupos AS "maximumCupos",
       ccr.required_tc AS "requiredTc",
       ccr.required_mt AS "requiredMt",
       ccr.notes
     FROM v_employee_current_assignments ca
     LEFT JOIN contract_coverage_rules ccr
       ON ccr.contract_id = ca.contract_id
      AND ccr.active = true
      AND ccr.enabled = true
      AND (ccr.contract_position_rule_id IS NULL OR ccr.contract_position_rule_id = ca.contract_position_rule_id)
      AND (ccr.master_modality_id IS NULL OR ccr.master_modality_id = ca.master_modality_id)
      AND (ccr.municipality_id IS NULL OR ccr.municipality_id = ca.municipality_id)
      AND (ccr.institution_id IS NULL OR ccr.institution_id = ca.institution_id)
      AND (ccr.site_id IS NULL OR ccr.site_id = ca.site_id)
     WHERE ca.employee_id = $1
     ORDER BY ca.assignment_id, ccr.id NULLS FIRST`,
    [id]
  );
  return result.rows;
}

async function listEmploymentCertificates(employeeId) {
  const id = toInt(employeeId);
  if (!id) throw new Error("employee_id inválido");
  const result = await pool.query(
    `SELECT
       ec.id,
       ec.employee_id AS "employeeId",
       ec.assignment_id AS "assignmentId",
       ec.company_id AS "companyId",
       c.name AS "companyName",
       ec.contract_id AS "contractId",
       ct.name AS "contractName",
       ec.certificate_number AS "certificateNumber",
       ec.purpose,
       ec.issue_date AS "issueDate",
       ec.issued_by_user_id AS "issuedByUserId",
       u.full_name AS "issuedByUserName",
       ec.signatory_name AS "signatoryName",
       ec.signatory_role AS "signatoryRole",
       ec.status,
       ec.snapshot_data AS "snapshotData",
       ec.file_url AS "fileUrl",
       ec.file_name AS "fileName",
       ec.created_at AS "createdAt",
       ec.updated_at AS "updatedAt"
     FROM employment_certificates ec
     JOIN companies c ON c.id = ec.company_id
     LEFT JOIN contracts ct ON ct.id = ec.contract_id
     LEFT JOIN users u ON u.id = ec.issued_by_user_id
     WHERE ec.employee_id = $1
     ORDER BY ec.issue_date DESC, ec.id DESC`,
    [id]
  );
  return result.rows;
}

async function createEmploymentCertificate(employeeId, payload = {}, userId = null) {
  const id = toInt(employeeId);
  if (!id) throw new Error("employee_id inválido");

  const assignmentId = toInt(payload.assignmentId || payload.assignment_id);
  let assignment = null;
  if (assignmentId) {
    const assignments = await listEmployeeAssignments(id, { includeInactive: true });
    assignment = assignments.find((item) => item.assignmentId === assignmentId) || null;
    if (!assignment) throw new Error("La asignación indicada no existe para este empleado");
  } else {
    const assignments = await listEmployeeAssignments(id);
    assignment = assignments[0] || null;
  }

  if (!assignment) throw new Error("El empleado no tiene asignación contractual disponible");

  const certificateNumber = safe(payload.certificateNumber || payload.certificate_number)
    || `CERT-${assignment.employeeId}-${Date.now()}`;

  try {
    const result = await pool.query(
      `INSERT INTO employment_certificates (
         employee_id, assignment_id, company_id, contract_id, certificate_number,
         purpose, issue_date, issued_by_user_id, signatory_name, signatory_role,
         status, snapshot_data, file_url, file_name
       )
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_DATE), $8, $9, $10, $11, $12::jsonb, $13, $14)
       RETURNING id`,
      [
        id,
        assignment.assignmentId,
        assignment.companyId,
        assignment.contractId,
        certificateNumber,
        safe(payload.purpose) || null,
        safe(payload.issueDate || payload.issue_date) || null,
        toInt(userId),
        safe(payload.signatoryName || payload.signatory_name) || null,
        safe(payload.signatoryRole || payload.signatory_role) || null,
        safe(payload.status) || "GENERADA",
        JSON.stringify({
          employeeName: assignment.employeeName,
          documentNumber: assignment.documentNumber,
          companyName: assignment.companyName,
          contractName: assignment.contractName,
          contractPositionName: assignment.contractPositionName,
          bidPositionName: assignment.bidPositionName,
          operationalPositionName: assignment.operationalPositionName,
          assignmentStartDate: assignment.assignmentStartDate,
          assignmentEndDate: assignment.assignmentEndDate,
          modalityName: assignment.modalityName,
          municipalityName: assignment.municipalityName,
          areaName: assignment.areaName,
        }),
        safe(payload.fileUrl || payload.file_url) || null,
        safe(payload.fileName || payload.file_name) || null,
      ]
    );

    const certificates = await listEmploymentCertificates(id);
    return certificates.find((item) => item.id === result.rows[0].id) || null;
  } catch (error) {
    throw mapPgError(error, "No fue posible crear la certificación laboral.");
  }
}

function buildContractualMeta() {
  return {
    staffingTypes: VALID_ASSIGNMENT_STAFFING_TYPES,
    ruleStaffingTypes: VALID_STAFFING_TYPES,
    validationModes: VALID_VALIDATION_MODES,
    coverageModes: VALID_COVERAGE_MODES,
    specificityTypes: VALID_SPECIFICITY_TYPES,
    experienceSourceTypes: VALID_SOURCE_TYPES,
    supportedMasterCatalogs: Object.keys(MASTER_KIND_CONFIG),
  };
}

module.exports = {
  VALID_STAFFING_TYPES,
  VALID_ASSIGNMENT_STAFFING_TYPES,
  VALID_VALIDATION_MODES,
  VALID_COVERAGE_MODES,
  VALID_SPECIFICITY_TYPES,
  VALID_SOURCE_TYPES,
  buildContractualMeta,
  listMasterCatalog,
  getMasterCatalogRecord,
  createMasterCatalogRecord,
  updateMasterCatalogRecord,
  deleteMasterCatalogRecord,
  listContractDocumentMatrix,
  saveContractDocumentMatrix,
  updateContractDocumentMatrixCell,
  listContractConfigurationSummary,
  listContractPositionRules,
  getContractPositionRuleById,
  createContractPositionRule,
  updateContractPositionRule,
  deactivateContractPositionRule,
  listContractDocumentRules,
  getContractDocumentRuleById,
  createContractDocumentRule,
  updateContractDocumentRule,
  deactivateContractDocumentRule,
  listContractExperienceRules,
  getContractExperienceRuleById,
  createContractExperienceRule,
  updateContractExperienceRule,
  deactivateContractExperienceRule,
  listContractCoverageRules,
  getContractCoverageRuleById,
  createContractCoverageRule,
  updateContractCoverageRule,
  deactivateContractCoverageRule,
  listContractMunicipalities,
  replaceContractMunicipalities,
  listContractModalities,
  replaceContractModalities,
  listEmployeeAssignments,
  listEmployeeAssignmentHistory,
  listEmployeeDocumentCompliance,
  listEmployeeExperienceSummary,
  evaluateEmployeeExperience,
  getEmployeeCoverageContext,
  listEmploymentCertificates,
  createEmploymentCertificate,
};
