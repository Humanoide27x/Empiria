"use strict";

/**
 * Normalizes a municipality name to its canonical form: uppercase, no accents,
 * no special characters, single spaces. Mirrors SQL_NORM_MUN in dashboard.controller.js.
 *
 * "Puerto López" → "PUERTO LOPEZ"
 * "PUERTO LLERAS" → "PUERTO LLERAS"
 */
function normalizeMunicipalityName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { normalizeMunicipalityName };
