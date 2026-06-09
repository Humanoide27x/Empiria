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

const DOCUMENT_TYPE_DEFINITIONS = [
  {
    key: "cedula",
    code: "cedula",
    name: "Cedula de ciudadania",
    aliases: ["cc", "cedula", "cedula ciudadania", "cedula de ciudadania", "documento identidad", "documento de identidad", "cedula ciudadana"],
  },
  {
    key: "hoja_vida",
    code: "hoja_vida",
    name: "Hoja de vida",
    aliases: ["hv", "hoja vida", "hoja de vida"],
  },
  {
    key: "contrato",
    code: "contrato",
    name: "Contrato",
    aliases: ["contrato", "contrato laboral"],
  },
  {
    key: "eps_afiliacion_radicacion",
    code: "eps_afiliacion_radicacion",
    name: "Certificado de afiliacion o radicacion EPS",
    aliases: ["eps", "afiliacion eps", "certificado eps", "certificado de afiliacion eps", "eps afiliacion radicacion"],
  },
  {
    key: "fondo_pensiones",
    code: "fondo_pensiones",
    name: "Certificado fondo de pensiones",
    aliases: ["pension", "afp", "fondo pensiones", "afiliacion pension", "certificado pension"],
  },
  {
    key: "cofrem",
    code: "cofrem",
    name: "Certificado caja de compensacion Cofrem",
    aliases: ["caja", "caja compensacion", "caja de compensacion", "cofrem"],
  },
  {
    key: "arl",
    code: "arl",
    name: "Afiliacion ARL",
    aliases: ["arl", "afiliacion arl"],
  },
  {
    key: "curso_manipulacion_alimentos",
    code: "curso_manipulacion_alimentos",
    name: "Curso de manipulacion de alimentos",
    aliases: ["manipulacion", "manipulacion alimentos", "curso manipulacion", "curso manipulacion de alimentos"],
  },
  {
    key: "examen_manipulacion_alimentos",
    code: "examen_manipulacion_alimentos",
    name: "Examen de manipulacion de alimentos",
    aliases: ["examen medico", "examenes", "examenes manipulacion de alimentos", "examen manipulacion alimentos"],
  },
  {
    key: "certificado_residencia",
    code: "certificado_residencia",
    name: "Certificado de residencia",
    aliases: ["residencia", "certificado residencia", "certificado de residencia", "residencia expedida por alcaldia"],
  },
  {
    key: "formato_dotacion",
    code: "formato_dotacion",
    name: "Formato de dotacion",
    aliases: ["dotacion", "formato dotacion", "soporte dotacion"],
  },
  {
    key: "certificacion_bancaria",
    code: "certificacion_bancaria",
    name: "Certificacion bancaria",
    aliases: ["banco", "certificacion bancaria", "cert bancaria"],
  },
  {
    key: "rut",
    code: "rut",
    name: "RUT",
    aliases: ["rut"],
  },
  {
    key: "contraloria",
    code: "contraloria",
    name: "Antecedentes Contraloria",
    aliases: ["contraloria", "antecedentes contraloria"],
  },
  {
    key: "procuraduria",
    code: "procuraduria",
    name: "Antecedentes Procuraduria",
    aliases: ["procuraduria", "antecedentes procuraduria"],
  },
  {
    key: "antecedentes_policia",
    code: "antecedentes_policia",
    name: "Antecedentes Policia",
    aliases: ["antecedentes policia", "antecedentes judiciales", "policia", "judiciales"],
  },
  {
    key: "redam",
    code: "redam",
    name: "REDAM",
    aliases: ["redam"],
  },
];

const DOCUMENT_TYPE_ALIASES = new Map(
  DOCUMENT_TYPE_DEFINITIONS.flatMap((item) => item.aliases.map((alias) => [alias, item.key]))
);

const CANONICAL_DOCUMENT_TYPES = Object.fromEntries(
  DOCUMENT_TYPE_DEFINITIONS.map((item) => [item.key, { key: item.key, code: item.code, name: item.name }])
);

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
    return "cedula";
  }
  if (normalized === "cedula" || normalized === "cc") {
    return "cedula";
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
