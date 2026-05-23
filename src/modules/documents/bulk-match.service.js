"use strict";

const path = require("path");
const { normalizeText } = require("../../utils/text");

const KNOWN_PREFIXES = [
  "CC",
  "CEDULA",
  "EPS",
  "ARL",
  "VACUNA",
  "PENSION",
  "AFP",
  "RUT",
  "HV",
  "HOJA_VIDA",
  "CERTIFICADO",
  "CONTRATO",
  "EXAMEN",
  "MANIPULACION",
  "ANTECEDENTES",
];

const DOCUMENT_TYPE_ALIASES = {
  CC: ["CC", "CEDULA", "CEDULA DE CIUDADANIA", "CEDULA CIUDADANIA"],
  CEDULA: ["CC", "CEDULA", "CEDULA DE CIUDADANIA", "CEDULA CIUDADANIA"],
  EPS: ["EPS", "EPS AFILIACION RADICACION", "CERTIFICADO EPS", "CERTIFICADO DE AFILIACION O RADICACION EPS"],
  ARL: ["ARL", "SOPORTE ARL"],
  PENSION: ["PENSION", "FONDO PENSIONES", "CERTIFICADO FONDO DE PENSIONES"],
  AFP: ["AFP", "FONDO PENSIONES", "CERTIFICADO FONDO DE PENSIONES"],
  HV: ["HV", "HOJA VIDA", "HOJA DE VIDA"],
  HOJA_VIDA: ["HV", "HOJA VIDA", "HOJA DE VIDA"],
  CONTRATO: ["CONTRATO", "CONTRATO LABORAL"],
  RUT: ["RUT"],
  VACUNA: ["VACUNA", "VACUNAS"],
};

function compactDocumentNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function parseDocumentFileName(fileName) {
  const base = path.basename(String(fileName || ""), path.extname(String(fileName || "")));
  const normalizedBase = normalizeText(base);
  const tokens = normalizedBase.split(" ").filter(Boolean);

  if (!tokens.length) {
    return {
      originalFileName: fileName,
      documentTypeCode: "",
      rawName: "",
      normalizedName: "",
      documentNumber: "",
      format: "UNKNOWN",
    };
  }

  const first = tokens[0] || "";
  const last = tokens[tokens.length - 1] || "";
  const firstIsDoc = /^\d{5,}$/.test(first);
  const lastIsDoc = /^\d{5,}$/.test(last);

  if (firstIsDoc && tokens.length >= 2) {
    return {
      originalFileName: fileName,
      documentTypeCode: tokens[1] || "",
      rawName: "",
      normalizedName: "",
      documentNumber: compactDocumentNumber(first),
      format: "DOCUMENT_NUMBER_PREFIX",
    };
  }

  if (lastIsDoc && tokens.length >= 2) {
    return {
      originalFileName: fileName,
      documentTypeCode: tokens[0] || "",
      rawName: tokens.slice(1, -1).join(" "),
      normalizedName: normalizeText(tokens.slice(1, -1).join(" ")),
      documentNumber: compactDocumentNumber(last),
      format: "DOCUMENT_NUMBER_SUFFIX",
    };
  }

  const prefix = tokens[0] || "";
  const knownPrefix = KNOWN_PREFIXES.includes(prefix) ? prefix : prefix;
  const rawName = tokens.slice(1).join(" ");

  return {
    originalFileName: fileName,
    documentTypeCode: knownPrefix,
    rawName,
    normalizedName: normalizeText(rawName),
    documentNumber: "",
    format: "TYPE_NAME",
  };
}

function scoreNameMatch(target, candidate) {
  const targetTokens = new Set(normalizeText(target).split(" ").filter(Boolean));
  const candidateTokens = new Set(normalizeText(candidate).split(" ").filter(Boolean));
  if (!targetTokens.size || !candidateTokens.size) return 0;

  let intersection = 0;
  targetTokens.forEach((token) => {
    if (candidateTokens.has(token)) intersection += 1;
  });

  return Math.round((intersection / Math.max(targetTokens.size, candidateTokens.size)) * 100);
}

function classifyMatch({ exactMatches, partialMatches, documentNumberMatch }) {
  if (documentNumberMatch) return "MATCHED";
  if (exactMatches.length === 1) return "MATCHED";
  if (exactMatches.length > 1) return "DUPLICATE";
  if (partialMatches.length === 1) return "PARTIAL_MATCH";
  if (partialMatches.length > 1) return "DUPLICATE";
  return "NO_MATCH";
}

function buildBulkReviewRow(file, employees, documentTypes) {
  const parsed = parseDocumentFileName(file.originalname || file.fileName || file.name);
  const docAliases = DOCUMENT_TYPE_ALIASES[parsed.documentTypeCode] || [parsed.documentTypeCode];
  const documentType =
    documentTypes.find((type) => docAliases.some((alias) => normalizeText(type.code) === normalizeText(alias))) ||
    documentTypes.find((type) => docAliases.some((alias) => normalizeText(type.name) === normalizeText(alias))) ||
    null;

  const byDocument = parsed.documentNumber
    ? employees.filter((employee) => compactDocumentNumber(employee.documentNumber) === parsed.documentNumber)
    : [];

  const exactMatches = parsed.normalizedName
    ? employees.filter((employee) => employee.normalizedFullName === parsed.normalizedName)
    : [];

  const partialMatches = parsed.normalizedName
    ? employees
        .map((employee) => ({
          ...employee,
          confidence: scoreNameMatch(parsed.normalizedName, employee.normalizedFullName),
        }))
        .filter((employee) => employee.confidence >= 70 && employee.normalizedFullName !== parsed.normalizedName)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5)
    : [];

  const documentNumberMatch = byDocument.length === 1 ? byDocument[0] : null;
  const exactMatch = exactMatches.length === 1 ? exactMatches[0] : null;
  const bestPartial = partialMatches[0] || null;
  const status = classifyMatch({ exactMatches, partialMatches, documentNumberMatch });
  const detectedEmployee = documentNumberMatch || exactMatch || bestPartial || null;
  const confidence = documentNumberMatch || exactMatch ? 100 : bestPartial?.confidence || 0;
  const finalStatus = documentType ? status : "NEEDS_REVIEW";

  return {
    fileName: parsed.originalFileName,
    documentTypeCode: parsed.documentTypeCode,
    documentTypeId: documentType?.id || null,
    documentTypeName: documentType?.name || parsed.documentTypeCode,
    extractedName: parsed.rawName,
    normalizedName: parsed.normalizedName,
    documentNumber: parsed.documentNumber,
    format: parsed.format,
    employeeId: finalStatus === "MATCHED" ? detectedEmployee?.id || null : null,
    detectedEmployee,
    candidates: status === "MATCHED" ? [] : partialMatches,
    status: finalStatus,
    confidence,
    canAutoAssign: finalStatus === "MATCHED",
  };
}

module.exports = {
  normalizeText,
  parseDocumentFileName,
  buildBulkReviewRow,
};
