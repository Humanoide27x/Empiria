const { readCollection, writeCollection } = require("./store");

const REPORTS_FILE = "reports.json";

function getReports() {
  return readCollection(REPORTS_FILE);
}

function saveReports(reports) {
  return writeCollection(REPORTS_FILE, reports);
}

function getNextReportId(reports) {
  const ids = reports.map((item) => item.id);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function createReport(payload) {
  if (!payload.title || !payload.template || !payload.companyId || !payload.contractId) {
    throw new Error("Faltan datos obligatorios del informe");
  }

  const reports = getReports();
  const record = {
    id: getNextReportId(reports),
    title: payload.title,
    template: payload.template,
    createdAt: new Date().toISOString(),
    createdByRole: payload.createdByRole,
    companyId: Number(payload.companyId),
    contractId: Number(payload.contractId),
    content: payload.content,
  };

  reports.push(record);
  saveReports(reports);

  return record;
}

module.exports = {
  createReport,
  getReports,
};
