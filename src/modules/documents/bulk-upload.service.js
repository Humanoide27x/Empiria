"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const unzipper = require("unzipper");

const { normalizeText } = require("../../utils/text");
const { putFile, isR2Configured } = require("../../config/storage");

const PREVIEW_STATUS = {
  READY: "READY",
  REQUIRES_REVIEW: "REQUIRES_REVIEW",
  NOT_FOUND: "NOT_FOUND",
  TYPE_UNRECOGNIZED: "TYPE_UNRECOGNIZED",
  ERROR: "ERROR",
  OMITTED: "OMITTED",
};

const DUPLICATE_STRATEGY = {
  KEEP_BOTH: "keep_both",
  REPLACE: "replace",
  NEW_VERSION: "new_version",
};

const BULK_ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png"]);
const BULK_ALLOWED_ARCHIVE_EXTENSIONS = new Set([".zip"]);
const BULK_PER_FILE_LIMIT = 10 * 1024 * 1024;
const BULK_ZIP_LIMIT = 50 * 1024 * 1024;
const BULK_TOTAL_LIMIT = 150 * 1024 * 1024;
const BULK_TOTAL_FILES_LIMIT = 500;

const DOCUMENT_TYPE_DEFINITIONS = [
  { canonicalCode: "CC", aliases: ["CC", "CEDULA", "CEDULA CIUDADANIA", "CEDULA DE CIUDADANIA"] },
  { canonicalCode: "HV", aliases: ["HV", "HOJA VIDA", "HOJA DE VIDA"] },
  { canonicalCode: "CONTRATO", aliases: ["CONTRATO", "CONTRATO LABORAL"] },
  { canonicalCode: "EPS", aliases: ["EPS", "AFILIACION EPS", "CERTIFICADO EPS"] },
  { canonicalCode: "PENSION", aliases: ["PENSION", "AFP", "AFILIACION PENSION", "CERTIFICADO PENSION"] },
  { canonicalCode: "CAJA", aliases: ["CAJA", "CAJA COMPENSACION", "CAJA DE COMPENSACION"] },
  { canonicalCode: "ARL", aliases: ["ARL", "AFILIACION ARL"] },
  { canonicalCode: "ANTECEDENTES", aliases: ["ANTECEDENTES", "ANTECEDENTE", "ANTECEDENTES JUDICIALES"] },
  { canonicalCode: "CERTIFICADO_RESIDENCIA", aliases: ["CERTIFICADO RESIDENCIA", "CERTIFICADO_RESIDENCIA", "RESIDENCIA", "CERT RESIDENCIA"] },
  { canonicalCode: "MANIPULACION", aliases: ["MANIPULACION", "MANIPULACION ALIMENTOS", "CURSO MANIPULACION", "CURSO MANIPULACION DE ALIMENTOS"] },
  { canonicalCode: "EXAMEN_MEDICO", aliases: ["EXAMEN MEDICO", "EXAMEN_MEDICO", "EXAMENES", "EXAMENES MANIPULACION DE ALIMENTOS"] },
  { canonicalCode: "DOTACION", aliases: ["DOTACION", "SOPORTE DOTACION"] },
  { canonicalCode: "RUT", aliases: ["RUT"] },
  { canonicalCode: "BANCO", aliases: ["BANCO", "CERTIFICACION BANCARIA", "CERT BANCARIA"] },
];

const PREFIX_ALIASES = DOCUMENT_TYPE_DEFINITIONS.flatMap((item) =>
  item.aliases.map((alias) => ({
    canonicalCode: item.canonicalCode,
    tokens: normalizeText(alias).split(" ").filter(Boolean),
  }))
).sort((a, b) => b.tokens.length - a.tokens.length);

function compactDocumentNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function sanitizeFileNameSegment(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sanitizeZipPathSegment(value, fallback = "archivo") {
  const safe = String(value || "")
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 180);
  return safe && safe !== "." && safe !== ".." ? safe : fallback;
}

function sanitizeZipFileName(fileName, fallback = "archivo") {
  const raw = String(fileName || "");
  const originalExt = path.extname(raw);
  const ext = originalExt.replace(/[^A-Za-z0-9.]+/g, "").toLowerCase();
  const safeBase = sanitizeZipPathSegment(path.basename(raw, originalExt), fallback);
  return `${safeBase}${ext}`;
}

function normalizeZipEntryPath(entryPath) {
  return String(entryPath || "").replace(/\0/g, "").replace(/\\/g, "/").trim();
}

function sanitizeZipEntryPath(entryPath) {
  const normalized = normalizeZipEntryPath(entryPath);
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) return "";
  return segments
    .map((segment, index) => (
      index === segments.length - 1
        ? sanitizeZipFileName(segment)
        : sanitizeZipPathSegment(segment, `carpeta_${index + 1}`)
    ))
    .join("/");
}

function isDangerousZipEntryPath(entryPath) {
  const normalized = normalizeZipEntryPath(entryPath);
  if (!normalized) return true;
  if (normalized.startsWith("/") || normalized.startsWith("//")) return true;
  if (/^[A-Za-z]:($|\/)/.test(normalized)) return true;
  return normalized.split("/").some((segment) => segment === "..");
}

function detectMimeType(extension) {
  const ext = String(extension || "").toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

function normalizeTokenSignature(value) {
  return normalizeText(value).split(" ").filter(Boolean).sort().join(" ");
}

function parseDocumentFileName(fileName) {
  const ext = path.extname(String(fileName || ""));
  const base = path.basename(String(fileName || ""), ext);
  const normalizedBase = normalizeText(base);
  const tokens = normalizedBase.split(" ").filter(Boolean);

  if (!tokens.length) {
    return {
      originalFileName: fileName,
      extension: ext.toLowerCase(),
      canonicalCode: "",
      rawName: "",
      normalizedName: "",
      normalizedTokenName: "",
      documentNumber: "",
      recognizedType: false,
      format: "UNKNOWN",
    };
  }

  let matchedPrefix = null;
  for (const alias of PREFIX_ALIASES) {
    const candidate = tokens.slice(0, alias.tokens.length);
    if (candidate.length !== alias.tokens.length) continue;
    if (candidate.join(" ") === alias.tokens.join(" ")) {
      matchedPrefix = alias;
      break;
    }
  }

  const prefixLength = matchedPrefix ? matchedPrefix.tokens.length : 1;
  const canonicalCode = matchedPrefix ? matchedPrefix.canonicalCode : tokens[0];
  const remaining = tokens.slice(prefixLength);
  const numericToken = remaining.find((token) => /^\d{5,}$/.test(token)) || "";
  const nameTokens = remaining.filter((token) => token !== numericToken);
  const rawName = nameTokens.join(" ");

  return {
    originalFileName: fileName,
    extension: ext.toLowerCase(),
    canonicalCode,
    rawName,
    normalizedName: normalizeText(rawName),
    normalizedTokenName: normalizeTokenSignature(rawName),
    documentNumber: compactDocumentNumber(numericToken),
    recognizedType: Boolean(matchedPrefix),
    format: matchedPrefix ? "TYPE_NAME" : "UNKNOWN_PREFIX",
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

function resolveDocumentType(parsed, documentTypes) {
  const definition = DOCUMENT_TYPE_DEFINITIONS.find((item) => item.canonicalCode === parsed.canonicalCode);
  const aliases = definition
    ? definition.aliases.map((alias) => normalizeText(alias))
    : [normalizeText(parsed.canonicalCode)];

  return documentTypes.find((item) =>
    aliases.includes(normalizeText(item.code)) || aliases.includes(normalizeText(item.name))
  ) || null;
}

function buildBulkReviewRow(source, employees, documentTypes, existingDocumentsIndex = new Map()) {
  if (source.errorMessage) {
    return {
      sourceKey: source.sourceKey,
      sourceType: source.sourceType,
      archiveName: source.archiveName || "",
      archiveEntryName: source.archiveEntryName || "",
      fileName: source.originalName,
      extension: source.extension,
      fileSize: source.size || 0,
      documentTypeCode: "",
      documentTypeId: null,
      documentTypeName: "",
      extractedName: "",
      normalizedName: "",
      documentNumber: "",
      format: "ERROR",
      employeeId: null,
      documentTypeResolved: false,
      detectedEmployee: null,
      candidates: [],
      candidateCount: 0,
      confidence: 0,
      status: PREVIEW_STATUS.ERROR,
      statusLabel: source.errorMessage,
      canAutoAssign: false,
      duplicateStrategy: DUPLICATE_STRATEGY.KEEP_BOTH,
      existingDocument: null,
      existingConflict: false,
      errorMessage: source.errorMessage,
    };
  }

  const parsed = parseDocumentFileName(source.originalName);
  const documentType = resolveDocumentType(parsed, documentTypes);

  const byDocument = parsed.documentNumber
    ? employees.filter((employee) => compactDocumentNumber(employee.documentNumber) === parsed.documentNumber)
    : [];

  const exactFullName = parsed.normalizedName
    ? employees.filter((employee) => employee.normalizedFullName === parsed.normalizedName)
    : [];

  const exactTokenName = parsed.normalizedTokenName
    ? employees.filter((employee) => employee.normalizedTokenName === parsed.normalizedTokenName)
    : [];

  const exactMap = new Map();
  [...byDocument, ...exactFullName, ...exactTokenName].forEach((employee) => {
    if (employee?.id != null) exactMap.set(String(employee.id), employee);
  });
  const exactMatches = [...exactMap.values()];

  const partialMatches = parsed.normalizedName
    ? employees
        .map((employee) => ({
          ...employee,
          confidence: scoreNameMatch(parsed.normalizedName, employee.normalizedFullName),
        }))
        .filter((employee) => employee.confidence >= 70 && !exactMap.has(String(employee.id)))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5)
    : [];

  let status = PREVIEW_STATUS.READY;
  let detectedEmployee = null;
  if (!documentType) {
    status = PREVIEW_STATUS.TYPE_UNRECOGNIZED;
  } else if (exactMatches.length === 1) {
    detectedEmployee = exactMatches[0];
    status = PREVIEW_STATUS.READY;
  } else if (exactMatches.length > 1 || partialMatches.length > 0) {
    status = PREVIEW_STATUS.REQUIRES_REVIEW;
  } else {
    status = PREVIEW_STATUS.NOT_FOUND;
  }

  const existingDocument = detectedEmployee && documentType
    ? existingDocumentsIndex.get(`${detectedEmployee.id}:${documentType.id}`) || null
    : null;

  return {
    sourceKey: source.sourceKey,
    sourceType: source.sourceType,
    archiveName: source.archiveName || "",
    archiveEntryName: source.archiveEntryName || "",
    fileName: source.originalName,
    extension: source.extension,
    fileSize: source.size || 0,
    documentTypeCode: parsed.canonicalCode,
    documentTypeId: documentType?.id || null,
    documentTypeName: documentType?.name || parsed.canonicalCode,
    extractedName: parsed.rawName,
    normalizedName: parsed.normalizedName,
    documentNumber: parsed.documentNumber,
    format: parsed.format,
    employeeId: status === PREVIEW_STATUS.READY ? detectedEmployee?.id || null : null,
    documentTypeResolved: Boolean(documentType),
    detectedEmployee,
    candidates: status === PREVIEW_STATUS.READY ? [] : [...exactMatches, ...partialMatches].slice(0, 8),
    candidateCount: exactMatches.length + partialMatches.length,
    confidence: status === PREVIEW_STATUS.READY ? 100 : (partialMatches[0]?.confidence || 0),
    status,
    statusLabel: status,
    canAutoAssign: status === PREVIEW_STATUS.READY,
    duplicateStrategy: existingDocument ? DUPLICATE_STRATEGY.KEEP_BOTH : DUPLICATE_STRATEGY.KEEP_BOTH,
    existingDocument,
    existingConflict: Boolean(existingDocument),
    errorMessage: "",
  };
}

function summarizePreviewRows(rows) {
  return rows.reduce((acc, row) => {
    acc.total += 1;
    acc.statuses[row.status] = (acc.statuses[row.status] || 0) + 1;
    if (row.canAutoAssign) acc.ready += 1;
    if (row.existingConflict) acc.withConflicts += 1;
    return acc;
  }, {
    total: 0,
    ready: 0,
    withConflicts: 0,
    statuses: {},
  });
}

function csvEscape(value) {
  const raw = String(value ?? "");
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, "\"\"")}"`;
  return raw;
}

function buildCommitCsv(reportRows) {
  const header = [
    "archivo",
    "tipo_documental",
    "trabajador",
    "numero_documento",
    "estado",
    "resultado",
    "estrategia_duplicado",
    "observacion",
  ];
  const lines = [
    header.join(","),
    ...reportRows.map((row) => ([
      row.fileName,
      row.documentTypeName,
      row.employeeName,
      row.employeeDocumentNumber,
      row.status,
      row.result,
      row.duplicateStrategy,
      row.message,
    ].map(csvEscape).join(","))),
  ];
  return `data:text/csv;base64,${Buffer.from(lines.join("\n"), "utf8").toString("base64")}`;
}

function ensureWithinLimit(totalSize, totalFiles) {
  if (totalFiles > BULK_TOTAL_FILES_LIMIT) {
    throw new Error(`La carga supera el maximo de ${BULK_TOTAL_FILES_LIMIT} archivos por lote`);
  }
  if (totalSize > BULK_TOTAL_LIMIT) {
    throw new Error("La carga supera el tamano maximo permitido para un lote");
  }
}

function buildZipEntrySourceBase({
  archiveName,
  archiveEntryName,
  originalName,
  extension,
  size,
  index,
}) {
  return {
    sourceKey: `ZIP:${archiveName}:${index}:${archiveEntryName || originalName}`,
    sourceType: "ZIP",
    archiveName,
    archiveEntryName,
    originalName,
    extension,
    size,
    mimeType: detectMimeType(extension),
  };
}

async function extractZipEntries(zipBuffer, archiveName) {
  let directory;
  try {
    directory = await unzipper.Open.buffer(zipBuffer);
  } catch (err) {
    throw new Error(`El ZIP ${archiveName} no se pudo leer: ${err.message}`);
  }

  const results = [];
  for (const [index, entry] of directory.files.entries()) {
    const rawEntryName = normalizeZipEntryPath(entry.path || "");
    if (!rawEntryName) continue;
    if ((entry.type || entry.vars?.type) === "Directory") continue;
    if (rawEntryName.startsWith("__MACOSX/")) continue;

    const sanitizedEntryPath = sanitizeZipEntryPath(rawEntryName);
    const safeOriginalName = sanitizeZipFileName(path.basename(rawEntryName), `archivo_${index + 1}`);
    const extension = path.extname(safeOriginalName).toLowerCase();
    const uncompressedSize = Number(entry.uncompressedSize || entry.vars?.uncompressedSize || 0);
    const baseSource = buildZipEntrySourceBase({
      archiveName,
      archiveEntryName: sanitizedEntryPath,
      originalName: safeOriginalName,
      extension,
      size: uncompressedSize,
      index,
    });

    if (isDangerousZipEntryPath(rawEntryName)) {
      results.push({
        ...baseSource,
        errorMessage: `Ruta invalida dentro del ZIP: ${rawEntryName}`,
      });
      continue;
    }

    if (!sanitizedEntryPath) {
      results.push({
        ...baseSource,
        errorMessage: "Nombre invalido dentro del ZIP",
      });
      continue;
    }

    if (!BULK_ALLOWED_EXTENSIONS.has(extension)) {
      results.push({
        ...baseSource,
        errorMessage: `Formato no permitido dentro del ZIP: ${extension || "sin extension"}`,
      });
      continue;
    }

    if (uncompressedSize > BULK_PER_FILE_LIMIT) {
      results.push({
        ...baseSource,
        errorMessage: "El archivo dentro del ZIP excede el maximo de 10 MB",
      });
      continue;
    }

    let buffer;
    try {
      buffer = await entry.buffer();
    } catch (err) {
      results.push({
        ...baseSource,
        errorMessage: `No fue posible extraer ${safeOriginalName}: ${err.message}`,
      });
      continue;
    }

    if (buffer.length > BULK_PER_FILE_LIMIT) {
      results.push({
        ...baseSource,
        size: buffer.length,
        errorMessage: "El archivo dentro del ZIP excede el maximo de 10 MB",
      });
      continue;
    }

    results.push({
      ...baseSource,
      size: buffer.length || uncompressedSize,
      buffer,
      errorMessage: "",
    });
  }

  return results;
}

async function extractRequestSources({ documentFiles = [], zipFiles = [] }) {
  const sources = [];
  let totalSize = 0;
  let totalFiles = 0;

  documentFiles.forEach((file, index) => {
    const safeOriginalName = sanitizeZipFileName(file.originalname || `archivo_${index + 1}`);
    const extension = path.extname(safeOriginalName).toLowerCase();
    const source = {
      sourceKey: `DIRECT:${index}:${safeOriginalName}:${file.size}`,
      sourceType: "DIRECT",
      archiveName: "",
      archiveEntryName: "",
      originalName: safeOriginalName,
      extension,
      size: Number(file.size || 0),
      tempPath: file.path,
      mimeType: detectMimeType(extension),
      errorMessage: "",
    };

    if (!BULK_ALLOWED_EXTENSIONS.has(extension)) {
      source.errorMessage = `Formato no permitido: ${extension || "sin extension"}`;
    } else if (source.size > BULK_PER_FILE_LIMIT) {
      source.errorMessage = "El archivo excede el maximo de 10 MB";
    }

    totalSize += source.size;
    totalFiles += 1;
    ensureWithinLimit(totalSize, totalFiles);
    sources.push(source);
  });

  for (const zipFile of zipFiles) {
    const safeArchiveName = sanitizeZipFileName(zipFile.originalname || "lote.zip", "lote");
    const extension = path.extname(safeArchiveName).toLowerCase();
    if (!BULK_ALLOWED_ARCHIVE_EXTENSIONS.has(extension)) {
      sources.push({
        sourceKey: `ZIP:${safeArchiveName}`,
        sourceType: "ZIP",
        archiveName: safeArchiveName,
        archiveEntryName: "",
        originalName: safeArchiveName,
        extension,
        size: Number(zipFile.size || 0),
        errorMessage: `Formato ZIP invalido: ${extension || "sin extension"}`,
      });
      continue;
    }
    if (Number(zipFile.size || 0) > BULK_ZIP_LIMIT) {
      sources.push({
        sourceKey: `ZIP:${safeArchiveName}`,
        sourceType: "ZIP",
        archiveName: safeArchiveName,
        archiveEntryName: "",
        originalName: safeArchiveName,
        extension,
        size: Number(zipFile.size || 0),
        errorMessage: "El archivo ZIP excede el maximo de 50 MB",
      });
      continue;
    }

    const zipBuffer = await fs.promises.readFile(zipFile.path);
    const entries = await extractZipEntries(zipBuffer, safeArchiveName);
    entries.forEach((entry) => {
      totalSize += Number(entry.size || 0);
      totalFiles += 1;
      ensureWithinLimit(totalSize, totalFiles);
      sources.push(entry);
    });
  }

  return sources;
}

async function getSourceBuffer(source) {
  if (source.buffer) return source.buffer;
  if (source.tempPath) return fs.promises.readFile(source.tempPath);
  throw new Error(`No se encontro el contenido del archivo ${source.originalName}`);
}

async function storeFinalDocument({
  source,
  companyId,
  employeeDocumentNumber,
  documentTypeCode,
  dateString,
  version = 1,
}) {
  const ext = source.extension || path.extname(source.originalName || "").toLowerCase();
  const docNumber = sanitizeFileNameSegment(compactDocumentNumber(employeeDocumentNumber) || "SIN_DOC");
  const typeCode = sanitizeFileNameSegment(normalizeText(documentTypeCode || "DOC").replace(/\s+/g, "_"));
  const versionSuffix = Number(version) > 1 ? `_v${Number(version)}` : "";
  const finalFileName = `${docNumber}_${typeCode}_${dateString}${versionSuffix}${ext}`;
  const buffer = await getSourceBuffer(source);

  if (isR2Configured()) {
    const key = `documents/${companyId}/${dateString}/${finalFileName}`;
    await putFile(key, buffer, source.mimeType || detectMimeType(ext));
    return { fileKey: key, fileName: finalFileName };
  }

  const targetDir = path.resolve(process.cwd(), "uploads", "documents");
  await fs.promises.mkdir(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, finalFileName);
  await fs.promises.writeFile(targetPath, buffer);
  return { fileKey: `documents/${finalFileName}`, fileName: finalFileName };
}

async function cleanupUploadedFiles(filesByField = {}) {
  const allFiles = Object.values(filesByField).flat();
  await Promise.all(allFiles.map(async (file) => {
    if (!file?.path) return;
    try {
      await fs.promises.unlink(file.path);
    } catch (_) {
      // Best effort cleanup.
    }
  }));
}

function hashRowPayload(value) {
  return crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

module.exports = {
  PREVIEW_STATUS,
  DUPLICATE_STRATEGY,
  BULK_ALLOWED_EXTENSIONS,
  BULK_ALLOWED_ARCHIVE_EXTENSIONS,
  BULK_PER_FILE_LIMIT,
  BULK_ZIP_LIMIT,
  BULK_TOTAL_LIMIT,
  BULK_TOTAL_FILES_LIMIT,
  parseDocumentFileName,
  buildBulkReviewRow,
  summarizePreviewRows,
  buildCommitCsv,
  extractRequestSources,
  getSourceBuffer,
  storeFinalDocument,
  cleanupUploadedFiles,
  hashRowPayload,
};
