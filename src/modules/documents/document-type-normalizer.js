"use strict";

const DAMAGED_CHAR_REPLACEMENTS = new Map([
  ["‚", "e"],
  ["¡", "i"],
  ["¢", "o"],
  ["Ã¡", "a"],
  ["Ã©", "e"],
  ["Ã­", "i"],
  ["Ã³", "o"],
  ["Ãº", "u"],
  ["Ã±", "n"],
]);

const DOCUMENT_TYPE_ALIASES = new Map([
  ["cc", "cedula_ciudadania"],
  ["cedula", "cedula_ciudadania"],
  ["cedula ciudadania", "cedula_ciudadania"],
  ["cedula de ciudadania", "cedula_ciudadania"],
  ["documento identidad", "cedula_ciudadania"],
  ["documento de identidad", "cedula_ciudadania"],
  ["cedula ciudadana", "cedula_ciudadania"],
]);

const CANONICAL_DOCUMENT_TYPES = {
  cedula_ciudadania: {
    key: "cedula_ciudadania",
    code: "cedula_ciudadania",
    name: "Cedula de ciudadania",
  },
};

function repairDamagedDocumentTypeText(value) {
  let text = String(value || "");
  for (const [from, to] of DAMAGED_CHAR_REPLACEMENTS.entries()) {
    text = text.split(from).join(to);
  }
  return text;
}

function normalizeDocumentTypeText(value) {
  return repairDamagedDocumentTypeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalDocumentTypeKey(value) {
  const normalized = normalizeDocumentTypeText(value);
  if (!normalized) return "";
  if (DOCUMENT_TYPE_ALIASES.has(normalized)) return DOCUMENT_TYPE_ALIASES.get(normalized);

  if (normalized.includes("cedula") && normalized.includes("ciudadania")) {
    return "cedula_ciudadania";
  }
  if (normalized === "cedula" || normalized === "cc") {
    return "cedula_ciudadania";
  }

  return normalized.replace(/\s+/g, "_");
}

function getCanonicalDocumentType(value) {
  const key = canonicalDocumentTypeKey(value);
  return CANONICAL_DOCUMENT_TYPES[key] || {
    key,
    code: key,
    name: key ? key.replace(/_/g, " ") : "",
  };
}

module.exports = {
  CANONICAL_DOCUMENT_TYPES,
  normalizeDocumentTypeText,
  canonicalDocumentTypeKey,
  getCanonicalDocumentType,
};
