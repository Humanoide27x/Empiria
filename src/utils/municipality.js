"use strict";

/**
 * Normalizes a municipality name to its canonical form: lowercase, no accents,
 * no invisible chars, no punctuation, single spaces.
 *
 * "PUERTO LÓPEZ" -> "puerto lopez"
 * "Puerto  López" -> "puerto lopez"
 */
function normalizeMunicipalityName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { normalizeMunicipalityName };
