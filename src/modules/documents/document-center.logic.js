"use strict";

const path = require("path");
const { normalizeText } = require("../../utils/text");

const DOCUMENT_CATALOG = Object.freeze([
  "CEDULA_DE_CIUDADANIA",
  "HOJA_DE_VIDA",
  "CONTRATO_LABORAL",
  "AFILIACION_EPS",
  "AFILIACION_PENSION",
  "AFILIACION_ARL",
  "CERTIFICADO_RESIDENCIA",
  "SISBEN",
  "CURSO_MANIPULACION_ALIMENTOS",
  "EXAMEN_MANIPULACION_ALIMENTOS",
  "DIPLOMA",
  "ACTA_GRADO",
  "TARJETA_PROFESIONAL",
  "CERTIFICACION_BANCARIA",
  "AUTORIZACION_TRATAMIENTO_DATOS",
  "INDUCCION",
  "DOTACION",
  "OTROS",
]);

const PREVIEW_STATUS = Object.freeze({
  READY: "READY",
  NOT_FOUND: "NOT_FOUND",
  DUPLICATE: "DUPLICATE",
  TYPE_UNRECOGNIZED: "TYPE_UNRECOGNIZED",
  INVALID_FILENAME: "INVALID_FILENAME",
  ERROR: "ERROR",
});

const DUPLICATE_STRATEGY = Object.freeze({
  SKIP: "SKIP",
  REPLACE: "REPLACE",
  KEEP_BOTH: "KEEP_BOTH",
});

const UPLOAD_MODE = Object.freeze({
  CATEGORY: "CATEGORY",
  SMART: "SMART",
});

function normalizeDocumentNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeCatalogCode(value) {
  return normalizeText(value).replace(/\s+/g, "_").trim();
}

function resolveCatalogDocumentType(value) {
  const code = normalizeCatalogCode(value);
  return DOCUMENT_CATALOG.includes(code) ? code : null;
}

function buildEmployeeNumberIndex(employees = []) {
  const index = new Map();

  for (const employee of Array.isArray(employees) ? employees : []) {
    if (!employee) continue;
    const candidates = [
      employee.document_number,
      employee.documentNumber,
    ];

    for (const candidate of candidates) {
      const normalized = normalizeDocumentNumber(candidate);
      if (!normalized) continue;
      if (!index.has(normalized)) {
        index.set(normalized, employee);
      }
    }
  }

  return index;
}

function detectDocumentNumberFromFilename(filename) {
  const base = path.basename(String(filename || ""));
  const withoutExt = base.replace(/\.[^.]+$/, "");
  const segments = withoutExt
    .split(/[_\s]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const normalized = normalizeDocumentNumber(segment);
    if (normalized.length >= 5) {
      return normalized;
    }
  }

  const fullNormalized = normalizeDocumentNumber(withoutExt);
  return fullNormalized.length >= 5 ? fullNormalized : "";
}

function detectCatalogTypeFromFilename(filename) {
  const normalizedName = normalizeText(path.basename(String(filename || "")).replace(/\.[^.]+$/, ""));
  if (!normalizedName) return null;

  const collapsed = normalizedName.replace(/\s+/g, "_");
  for (const code of DOCUMENT_CATALOG) {
    const normalizedCode = normalizeText(code).replace(/\s+/g, "_");
    if (collapsed.includes(normalizedCode)) {
      return code;
    }
  }

  return null;
}

function isPdfFile(file = {}) {
  const originalName = String(file.originalname || file.originalName || "");
  const ext = path.extname(originalName).toLowerCase();
  const mimeType = String(file.mimetype || file.mimeType || "").toLowerCase();
  return ext === ".pdf" || mimeType === "application/pdf";
}

function getLatestDocumentKey(employeeId, documentType) {
  return `${Number(employeeId)}:${String(documentType || "").trim().toUpperCase()}`;
}

function classifyPreviewFile({
  file,
  uploadMode,
  selectedDocumentType,
  employeeIndex,
  existingDocumentsIndex,
}) {
  const originalFilename = String(file?.originalname || file?.originalName || "");
  const documentNumber = detectDocumentNumberFromFilename(originalFilename);
  const documentTypeFromFile = detectCatalogTypeFromFilename(originalFilename);
  const fileStatus = !isPdfFile(file)
    ? PREVIEW_STATUS.INVALID_FILENAME
    : !documentNumber
      ? PREVIEW_STATUS.INVALID_FILENAME
      : uploadMode === UPLOAD_MODE.SMART && !documentTypeFromFile
        ? PREVIEW_STATUS.TYPE_UNRECOGNIZED
        : PREVIEW_STATUS.READY;

  const documentType =
    uploadMode === UPLOAD_MODE.CATEGORY
      ? resolveCatalogDocumentType(selectedDocumentType)
      : documentTypeFromFile;

  if (uploadMode === UPLOAD_MODE.CATEGORY && !documentType) {
    return {
      original_filename: originalFilename,
      detected_document_number: documentNumber,
      employee_id: null,
      employee_name: "",
      document_type: null,
      status: PREVIEW_STATUS.TYPE_UNRECOGNIZED,
      reason: "La categoria documental seleccionada no pertenece al catalogo central.",
      action: "REVIEW",
      duplicate: false,
      duplicate_key: "",
      source_file_path: file?.path || null,
    };
  }

  if (!fileStatus || fileStatus !== PREVIEW_STATUS.READY) {
    const reason =
      fileStatus === PREVIEW_STATUS.INVALID_FILENAME
        ? "El archivo no tiene un nombre valido o no es PDF."
        : "No se pudo identificar el tipo documental.";
    return {
      original_filename: originalFilename,
      detected_document_number: documentNumber,
      employee_id: null,
      employee_name: "",
      document_type: documentType,
      status: fileStatus,
      reason,
      action: "REVIEW",
      duplicate: false,
      duplicate_key: "",
      source_file_path: file?.path || null,
    };
  }

  const employee = documentNumber ? employeeIndex.get(documentNumber) || null : null;
  if (!employee) {
    return {
      original_filename: originalFilename,
      detected_document_number: documentNumber,
      employee_id: null,
      employee_name: "",
      document_type: documentType,
      status: PREVIEW_STATUS.NOT_FOUND,
      reason: "No se encontro un empleado con ese numero de documento.",
      action: "REVIEW",
      duplicate: false,
      duplicate_key: "",
      source_file_path: file?.path || null,
    };
  }

  const duplicateKey = getLatestDocumentKey(employee.id, documentType);
  const existing = existingDocumentsIndex?.get(duplicateKey) || null;
  if (existing) {
    return {
      original_filename: originalFilename,
      detected_document_number: documentNumber,
      employee_id: Number(employee.id),
      employee_name: employee.full_name || employee.fullName || "",
      document_type: documentType,
      status: PREVIEW_STATUS.DUPLICATE,
      reason: "Ya existe un documento de este tipo para este empleado.",
      action: "REVIEW",
      duplicate: true,
      duplicate_key: duplicateKey,
      existing_document_id: existing.id || null,
      existing_version: existing.version || 1,
      source_file_path: file?.path || null,
    };
  }

  return {
    original_filename: originalFilename,
    detected_document_number: documentNumber,
    employee_id: Number(employee.id),
    employee_name: employee.full_name || employee.fullName || "",
    document_type: documentType,
    status: PREVIEW_STATUS.READY,
    reason: "",
    action: "UPLOAD",
    duplicate: false,
    duplicate_key: "",
    source_file_path: file?.path || null,
  };
}

function summarizePreviewRows(rows = []) {
  const summary = {
    total_files: 0,
    ready_count: 0,
    not_found_count: 0,
    duplicate_count: 0,
    error_count: 0,
    invalid_filename_count: 0,
    type_unrecognized_count: 0,
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    summary.total_files += 1;
    switch (row.status) {
      case PREVIEW_STATUS.READY:
        summary.ready_count += 1;
        break;
      case PREVIEW_STATUS.NOT_FOUND:
        summary.not_found_count += 1;
        break;
      case PREVIEW_STATUS.DUPLICATE:
        summary.duplicate_count += 1;
        break;
      case PREVIEW_STATUS.INVALID_FILENAME:
        summary.invalid_filename_count += 1;
        summary.error_count += 1;
        break;
      case PREVIEW_STATUS.TYPE_UNRECOGNIZED:
        summary.type_unrecognized_count += 1;
        summary.error_count += 1;
        break;
      default:
        if (row.status === PREVIEW_STATUS.ERROR) {
          summary.error_count += 1;
        }
        break;
    }
  }

  return summary;
}

function buildFinalSummary(rows = []) {
  const summary = {
    total_files: 0,
    ready_count: 0,
    not_found_count: 0,
    duplicate_count: 0,
    error_count: 0,
    saved_count: 0,
    omitted_count: 0,
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    summary.total_files += 1;
    if (row.status === PREVIEW_STATUS.READY) summary.ready_count += 1;
    if (row.status === PREVIEW_STATUS.NOT_FOUND) summary.not_found_count += 1;
    if (row.status === PREVIEW_STATUS.DUPLICATE) summary.duplicate_count += 1;
    if (row.status === PREVIEW_STATUS.ERROR || row.status === PREVIEW_STATUS.INVALID_FILENAME || row.status === PREVIEW_STATUS.TYPE_UNRECOGNIZED) {
      summary.error_count += 1;
    }
    if (row.action === "UPLOAD" || row.action === "REPLACE" || row.action === "KEEP_BOTH") summary.saved_count += 1;
    if (row.action === "SKIP" || row.action === "OMIT") summary.omitted_count += 1;
  }

  return summary;
}

module.exports = {
  DOCUMENT_CATALOG,
  PREVIEW_STATUS,
  DUPLICATE_STRATEGY,
  UPLOAD_MODE,
  normalizeDocumentNumber,
  normalizeCatalogCode,
  resolveCatalogDocumentType,
  buildEmployeeNumberIndex,
  detectDocumentNumberFromFilename,
  detectCatalogTypeFromFilename,
  isPdfFile,
  classifyPreviewFile,
  summarizePreviewRows,
  buildFinalSummary,
};
