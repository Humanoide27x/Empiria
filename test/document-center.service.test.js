const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repo = require("../src/modules/documents/document-center.repository");
const {
  previewBatch,
  confirmBatch,
} = require("../src/modules/documents/document-center.service");
const {
  PREVIEW_STATUS,
  DUPLICATE_STRATEGY,
} = require("../src/modules/documents/document-center.logic");

function makeTempPdf(dir, fileName) {
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, Buffer.from("%PDF-1.4\n%mock\n"));
  return filePath;
}

function makeTempText(dir, fileName) {
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, "texto");
  return filePath;
}

test("previewBatch no guarda en employee_documents y clasifica el lote", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "empiria-doc-preview-"));
  const originals = {};
  const calls = { insertEmployeeDocument: 0 };

  try {
    for (const key of [
      "listEmployeesForDocumentCenter",
      "listCatalogDocumentTypes",
      "getExistingDocumentsIndex",
      "createUploadBatch",
      "insertBatchItem",
      "updateUploadBatch",
      "getBatchById",
      "insertEmployeeDocument",
    ]) {
      originals[key] = repo[key];
    }

    const employees = Array.from({ length: 11 }, (_, index) => {
      const num = String(1000000001 + index);
      return { id: index + 1, full_name: `Empleado ${index + 1}`, document_number: num };
    });
    const files = employees.slice(1).map((employee) => ({
      originalname: `${employee.document_number}_SISBEN.pdf`,
      mimetype: "application/pdf",
      path: makeTempPdf(tmpDir, `${employee.document_number}_SISBEN.pdf`),
      filename: `${employee.document_number}_SISBEN.pdf`,
    }));
    files.push({
      originalname: "9999999999_SISBEN.pdf",
      mimetype: "application/pdf",
      path: makeTempPdf(tmpDir, "9999999999_SISBEN.pdf"),
      filename: "9999999999_SISBEN.pdf",
    });
    files.push({
      originalname: "1000000001_SISBEN_DUPLICADO.pdf",
      mimetype: "application/pdf",
      path: makeTempPdf(tmpDir, "1000000001_SISBEN_DUPLICADO.pdf"),
      filename: "1000000001_SISBEN_DUPLICADO.pdf",
    });
    files.push({
      originalname: "SIN_NUMERO.txt",
      mimetype: "text/plain",
      path: makeTempText(tmpDir, "SIN_NUMERO.txt"),
      filename: "SIN_NUMERO.txt",
    });

    repo.listEmployeesForDocumentCenter = async () => employees;
    repo.listCatalogDocumentTypes = async () => [
      { id: 1, code: "SISBEN", name: "SISBEN", master_document_type_id: 1 },
    ];
    repo.getExistingDocumentsIndex = async () => new Map([
      ["1:SISBEN", { id: 9001, version: 1 }],
    ]);
    repo.createUploadBatch = async (data) => ({ id: 1, summary_json: data.summaryJson || {} });
    repo.insertBatchItem = async (item) => ({ id: Math.random(), ...item });
    repo.updateUploadBatch = async (_id, patch) => ({ id: 1, status: patch.status, summary_json: patch.summary_json });
    repo.getBatchById = async () => ({ id: 1, status: "PREVIEWED", batch_name: "test", summary_json: {} });
    repo.insertEmployeeDocument = async () => {
      calls.insertEmployeeDocument += 1;
      return { id: calls.insertEmployeeDocument };
    };

    const result = await previewBatch({
      files,
      uploadMode: "CATEGORY",
      documentType: "SISBEN",
      user: { id: 1, name: "Admin" },
      ip: "127.0.0.1",
    });

    assert.equal(calls.insertEmployeeDocument, 0);
    assert.equal(result.rows.length, 13);
    assert.equal(result.summary.total_files, 13);
    assert.equal(result.summary.ready_count, 10);
    assert.equal(result.summary.not_found_count, 1);
    assert.equal(result.summary.duplicate_count, 1);
    assert.equal(result.summary.error_count, 1);
    assert.ok(result.rows.some((row) => row.status === PREVIEW_STATUS.DUPLICATE));
    assert.ok(result.rows.some((row) => row.status === PREVIEW_STATUS.NOT_FOUND));
    assert.ok(result.rows.some((row) => row.status === PREVIEW_STATUS.INVALID_FILENAME));
  } finally {
    for (const key of Object.keys(originals)) {
      repo[key] = originals[key];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("previewBatch rechaza categoria invalida", async () => {
  await assert.rejects(
    () => previewBatch({
      files: [{ originalname: "1000000002_SISBEN.pdf", mimetype: "application/pdf", path: "/tmp/a.pdf" }],
      uploadMode: "CATEGORY",
      documentType: "NO_EXISTE",
      user: { id: 1, name: "Admin" },
    }),
    /document_type invalido o ausente/
  );
});

test("confirmBatch guarda y respeta SKIP y REPLACE", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "empiria-doc-confirm-"));
  const originals = {};
  const calls = {
    insertEmployeeDocument: [],
    markEmployeeDocumentReplaced: [],
    logDocumentAudit: [],
  };

  try {
    for (const key of [
      "getBatchById",
      "getBatchItems",
      "listCatalogDocumentTypes",
      "getExistingDocumentsIndex",
      "getNextDocumentVersion",
      "insertEmployeeDocument",
      "markEmployeeDocumentReplaced",
      "updateBatchItem",
      "updateUploadBatch",
      "logDocumentAudit",
    ]) {
      originals[key] = repo[key];
    }

    const readyFile = makeTempPdf(tmpDir, "1000000002_SISBEN.pdf");
    const duplicateFile = makeTempPdf(tmpDir, "1000000003_SISBEN.pdf");

    repo.getBatchById = async () => ({ id: 2, status: "PREVIEWED", batch_name: "confirm test", summary_json: {} });
    repo.getBatchItems = async () => [
      {
        id: 11,
        batch_id: 2,
        original_filename: "1000000002_SISBEN.pdf",
        stored_filename: "1000000002_SISBEN.pdf",
        detected_document_number: "1000000002",
        employee_id: 1,
        document_type: "SISBEN",
        status: PREVIEW_STATUS.READY,
        reason: "",
        action: "UPLOAD",
        temp_file_path: readyFile,
      },
      {
        id: 12,
        batch_id: 2,
        original_filename: "1000000003_SISBEN.pdf",
        stored_filename: "1000000003_SISBEN.pdf",
        detected_document_number: "1000000003",
        employee_id: 2,
        document_type: "SISBEN",
        status: PREVIEW_STATUS.DUPLICATE,
        reason: "Duplicado",
        action: "REVIEW",
        temp_file_path: duplicateFile,
      },
      {
        id: 13,
        batch_id: 2,
        original_filename: "9999999999_SISBEN.pdf",
        stored_filename: "9999999999_SISBEN.pdf",
        detected_document_number: "9999999999",
        employee_id: null,
        document_type: "SISBEN",
        status: PREVIEW_STATUS.NOT_FOUND,
        reason: "No encontrado",
        action: "REVIEW",
        temp_file_path: null,
      },
    ];
    repo.listCatalogDocumentTypes = async () => [
      { id: 1, code: "SISBEN", name: "SISBEN", master_document_type_id: 1 },
    ];
    repo.getExistingDocumentsIndex = async () => new Map([
      ["2:SISBEN", { id: 500, version: 1 }],
    ]);
    repo.getNextDocumentVersion = async (employeeId) => (Number(employeeId) === 2 ? 2 : 1);
    repo.insertEmployeeDocument = async (data) => {
      calls.insertEmployeeDocument.push(data);
      return { id: 100 + calls.insertEmployeeDocument.length };
    };
    repo.markEmployeeDocumentReplaced = async (documentId, replacedBy) => {
      calls.markEmployeeDocumentReplaced.push([documentId, replacedBy]);
      return { id: documentId, replaced_document_id: replacedBy };
    };
    repo.updateBatchItem = async () => ({});
    repo.updateUploadBatch = async (id, patch) => ({ id, ...patch, summary_json: patch.summary_json });
    repo.logDocumentAudit = async (payload) => {
      calls.logDocumentAudit.push(payload);
      return 1;
    };

    const skipResult = await confirmBatch({
      batchId: 2,
      duplicateStrategy: DUPLICATE_STRATEGY.SKIP,
      user: { id: 7, name: "Admin" },
      ip: "127.0.0.1",
    });

    assert.equal(calls.insertEmployeeDocument.length, 1);
    assert.equal(skipResult.summary.saved_count, 1);
    assert.equal(skipResult.summary.not_found_count, 1);
    assert.equal(skipResult.summary.duplicate_count, 1);
    assert.equal(skipResult.summary.omitted_count, 2);
    assert.equal(skipResult.rows[1].action, "SKIP");
    assert.equal(skipResult.rows[2].action, "OMIT");
    assert.equal(calls.logDocumentAudit.length, 1);

    const readyFile2 = makeTempPdf(tmpDir, "1000000002_SISBEN_v2.pdf");
    const duplicateFile2 = makeTempPdf(tmpDir, "1000000003_SISBEN_v2.pdf");
    calls.insertEmployeeDocument = [];
    calls.markEmployeeDocumentReplaced = [];
    calls.logDocumentAudit = [];
    repo.getBatchById = async () => ({ id: 3, status: "PREVIEWED", batch_name: "confirm replace", summary_json: {} });
    repo.getBatchItems = async () => [
      {
        id: 21,
        batch_id: 3,
        original_filename: "1000000002_SISBEN.pdf",
        stored_filename: "1000000002_SISBEN.pdf",
        detected_document_number: "1000000002",
        employee_id: 1,
        document_type: "SISBEN",
        status: PREVIEW_STATUS.READY,
        reason: "",
        action: "UPLOAD",
        temp_file_path: readyFile2,
      },
      {
        id: 22,
        batch_id: 3,
        original_filename: "1000000003_SISBEN.pdf",
        stored_filename: "1000000003_SISBEN.pdf",
        detected_document_number: "1000000003",
        employee_id: 2,
        document_type: "SISBEN",
        status: PREVIEW_STATUS.DUPLICATE,
        reason: "Duplicado",
        action: "REVIEW",
        temp_file_path: duplicateFile2,
      },
    ];

    const replaceResult = await confirmBatch({
      batchId: 3,
      duplicateStrategy: DUPLICATE_STRATEGY.REPLACE,
      user: { id: 7, name: "Admin" },
      ip: "127.0.0.1",
    });

    assert.equal(calls.insertEmployeeDocument.length, 2);
    assert.equal(calls.markEmployeeDocumentReplaced.length >= 1, true);
    assert.equal(replaceResult.summary.saved_count, 2);
    assert.equal(replaceResult.summary.duplicate_count, 1);
    assert.equal(replaceResult.rows[1].action, "REPLACE");
  } finally {
    for (const key of Object.keys(originals)) {
      repo[key] = originals[key];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
