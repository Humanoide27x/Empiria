const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "documents.json");
const uploadsDir = path.join(__dirname, "../../uploads/documents");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function readDocuments() {
  if (!fs.existsSync(filePath)) return [];

  const data = fs.readFileSync(filePath, "utf-8");
  if (!data.trim()) return [];

  const parsed = safeJsonParse(data);
  return Array.isArray(parsed) ? parsed : [];
}

function writeDocuments(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function getAllDocuments() {
  return readDocuments();
}

function getDocumentsByEmployee(employeeId) {
  return readDocuments().filter(
    (doc) => String(doc.employeeId) === String(employeeId)
  );
}

function getDocumentsByEmployees(employeeIds = []) {
  const ids = new Set(employeeIds.map((id) => String(id)).filter(Boolean));
  if (!ids.size) return [];
  return readDocuments().filter((doc) => ids.has(String(doc.employeeId)));
}

function sanitizeFileName(name = "documento.pdf") {
  return String(name)
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

function saveDocument(doc) {
  const docs = readDocuments();

  if (!doc.employeeId) {
    throw new Error("employeeId es requerido");
  }

  if (!doc.documentType) {
    throw new Error("documentType es requerido");
  }

  if (!doc.fileBase64 || !doc.fileBase64.startsWith("data:application/pdf")) {
    throw new Error("Debes subir un PDF válido");
  }

  const base64Data = doc.fileBase64.replace(
    /^data:application\/pdf;base64,/,
    ""
  );

  const originalName = sanitizeFileName(doc.fileName || "documento.pdf");
  const fileName = `employee_${doc.employeeId}_${Date.now()}_${originalName}`;
  const pdfPath = path.join(uploadsDir, fileName);

  fs.writeFileSync(pdfPath, base64Data, "base64");

  const newDoc = {
    id: Date.now(),
    employeeId: doc.employeeId,
    documentType: doc.documentType,
    issueDate: doc.issueDate || "",
    expirationDate: doc.expirationDate || "",
    fileName: originalName,
    storedFileName: fileName,
    fileUrl: `/uploads/documents/${fileName}`,
    validationStatus: "PENDIENTE_VALIDACION",
    uploadedBy: doc.uploadedBy || "Sistema",
    validatedBy: "",
    validatedAt: "",
    rejectionReason: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  docs.push(newDoc);
  writeDocuments(docs);

  return newDoc;
}

function validateDocument(id, userName = "Usuario") {
  const docs = readDocuments();
  const index = docs.findIndex((doc) => String(doc.id) === String(id));

  if (index === -1) return null;

  docs[index] = {
    ...docs[index],
    validationStatus: "VALIDADO",
    validatedBy: userName,
    validatedAt: new Date().toISOString(),
    rejectionReason: "",
    updatedAt: new Date().toISOString(),
  };

  writeDocuments(docs);
  return docs[index];
}

function rejectDocument(id, reason = "", userName = "Usuario") {
  const docs = readDocuments();
  const index = docs.findIndex((doc) => String(doc.id) === String(id));

  if (index === -1) return null;

  docs[index] = {
    ...docs[index],
    validationStatus: "RECHAZADO",
    validatedBy: userName,
    validatedAt: new Date().toISOString(),
    rejectionReason: reason,
    updatedAt: new Date().toISOString(),
  };

  writeDocuments(docs);
  return docs[index];
}

module.exports = {
  getAllDocuments,
  getDocumentsByEmployee,
  getDocumentsByEmployees,
  saveDocument,
  validateDocument,
  rejectDocument,
};
