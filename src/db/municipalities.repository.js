"use strict";

const pool = require("./pool");
const { normalizeMunicipalityName } = require("../utils/municipality");

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function mapMunicipality(row = {}) {
  return {
    id: Number(row.id),
    name: String(row.name || "").trim(),
    normalized_name: String(row.normalized_name || "").trim(),
    department: row.department ? String(row.department).trim() : "",
    active: row.active !== false,
  };
}

async function listMunicipalities({ activeOnly = false } = {}, client = pool) {
  const where = activeOnly ? "WHERE COALESCE(active, true) = true" : "";
  const { rows } = await client.query(
    `
    SELECT
      id,
      TRIM(name) AS name,
      COALESCE(normalized_name, '') AS normalized_name,
      COALESCE(department, '') AS department,
      COALESCE(active, true) AS active
    FROM municipalities
    ${where}
    ORDER BY TRIM(name)
    `
  );
  return rows.map(mapMunicipality);
}

async function getMunicipalityById(municipalityId, client = pool) {
  const id = toNumberOrNull(municipalityId);
  if (!id) return null;
  const { rows } = await client.query(
    `
    SELECT
      id,
      TRIM(name) AS name,
      COALESCE(normalized_name, '') AS normalized_name,
      COALESCE(department, '') AS department,
      COALESCE(active, true) AS active
    FROM municipalities
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );
  return rows[0] ? mapMunicipality(rows[0]) : null;
}

async function getMunicipalityByNormalizedName(municipalityName, client = pool) {
  const normalizedName = normalizeMunicipalityName(municipalityName);
  if (!normalizedName) return null;
  const { rows } = await client.query(
    `
    SELECT
      id,
      TRIM(name) AS name,
      COALESCE(normalized_name, '') AS normalized_name,
      COALESCE(department, '') AS department,
      COALESCE(active, true) AS active
    FROM municipalities
    WHERE normalized_name = $1
    ORDER BY id
    LIMIT 2
    `,
    [normalizedName]
  );
  if (rows.length > 1) {
    throw new Error(
      "No se puede crear el municipio porque ya existe una variante equivalente."
    );
  }
  return rows[0] ? mapMunicipality(rows[0]) : null;
}

async function resolveMunicipalityRecord(
  {
    municipalityId,
    municipalityName,
  } = {},
  { client = pool } = {}
) {
  const normalizedName = normalizeMunicipalityName(municipalityName);
  const byId = await getMunicipalityById(municipalityId, client);
  const byName = normalizedName
    ? await getMunicipalityByNormalizedName(normalizedName, client)
    : null;

  if (byId && byName && Number(byId.id) !== Number(byName.id)) {
    throw new Error(
      `Conflicto de municipio: el ID ${byId.id} no corresponde a "${municipalityName}".`
    );
  }

  if (byId && normalizedName && byId.normalized_name && byId.normalized_name !== normalizedName) {
    throw new Error(
      `Conflicto de municipio: el ID ${byId.id} no corresponde a "${municipalityName}".`
    );
  }

  return byId || byName || null;
}

async function resolveMunicipalityId(payload = {}, options = {}) {
  const record = await resolveMunicipalityRecord(payload, options);
  return record?.id || null;
}

module.exports = {
  listMunicipalities,
  getMunicipalityById,
  getMunicipalityByNormalizedName,
  resolveMunicipalityRecord,
  resolveMunicipalityId,
};
