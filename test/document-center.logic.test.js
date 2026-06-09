const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeDocumentNumber,
  buildEmployeeNumberIndex,
  classifyPreviewFile,
  summarizePreviewRows,
  PREVIEW_STATUS,
  UPLOAD_MODE,
} = require("../src/modules/documents/document-center.logic");

test("normaliza numeros de documento con puntos, espacios y guiones", () => {
  assert.equal(normalizeDocumentNumber("1120357131"), "1120357131");
  assert.equal(normalizeDocumentNumber("1.120.357.131"), "1120357131");
  assert.equal(normalizeDocumentNumber("1 120 357 131"), "1120357131");
  assert.equal(normalizeDocumentNumber("1120-357-131"), "1120357131");
});

test("clasifica archivos de preview por categoria e inteligente", () => {
  const employees = buildEmployeeNumberIndex([
    { id: 1, full_name: "Empleado Uno", document_number: "1120357131" },
  ]);
  const existing = new Map();

  const ready = classifyPreviewFile({
    file: { originalname: "1120357131_SISBEN.pdf", mimetype: "application/pdf" },
    uploadMode: UPLOAD_MODE.CATEGORY,
    selectedDocumentType: "SISBEN",
    employeeIndex: employees,
    existingDocumentsIndex: existing,
  });

  assert.equal(ready.status, PREVIEW_STATUS.READY);
  assert.equal(ready.employee_id, 1);
  assert.equal(ready.document_type, "SISBEN");

  const unrecognized = classifyPreviewFile({
    file: { originalname: "1120357131_DESCONOCIDO.pdf", mimetype: "application/pdf" },
    uploadMode: UPLOAD_MODE.SMART,
    selectedDocumentType: null,
    employeeIndex: employees,
    existingDocumentsIndex: existing,
  });

  assert.equal(unrecognized.status, PREVIEW_STATUS.TYPE_UNRECOGNIZED);
});

test("resume el preview con estados mixtos", () => {
  const summary = summarizePreviewRows([
    { status: PREVIEW_STATUS.READY },
    { status: PREVIEW_STATUS.NOT_FOUND },
    { status: PREVIEW_STATUS.DUPLICATE },
    { status: PREVIEW_STATUS.INVALID_FILENAME },
    { status: PREVIEW_STATUS.TYPE_UNRECOGNIZED },
    { status: PREVIEW_STATUS.ERROR },
  ]);

  assert.equal(summary.total_files, 6);
  assert.equal(summary.ready_count, 1);
  assert.equal(summary.not_found_count, 1);
  assert.equal(summary.duplicate_count, 1);
  assert.equal(summary.error_count, 3);
});
