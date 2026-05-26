"use strict";

const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { readJsonBody }                   = require("../../http/request");
const { requireAuth }                    = require("../auth/auth.helpers");

const {
  NOVELTY_TYPES,
  calcLine,
  calcLineHoras,
  getContractEmployees,
  getSalaryConfigForContract,
  listPeriods,
  createPeriod,
  getPeriodById,
  getPeriodResults,
  savePeriodLines,
  closePeriod,
  generateExcelBuffer,
} = require("./nomina.repository");

function guardTH(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  const role = String(auth.user.role || "").toLowerCase();
  if (!["administrador", "talento_humano"].includes(role)) {
    sendJson(res, 403, { ok: false, message: "Solo administrador o talento humano puede gestionar nómina" });
    return null;
  }
  return auth.user;
}

// GET /nomina/employees?contractId=X[&municipalityId=Y]
async function handleGetEmployees(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  const auth = requireAuth(req, res);
  if (!auth) return;
  const contractId = Number(url.searchParams.get("contractId"));
  if (!contractId) { sendJson(res, 400, { ok: false, message: "contractId requerido" }); return; }

  // Scope by user's assigned municipalities first
  const rawMunIds = auth.user?.municipality_ids;
  let municipalityIds = Array.isArray(rawMunIds) && rawMunIds.length > 0
    ? rawMunIds.map(Number).filter(n => n > 0)
    : null;

  // If a specific municipalityId is requested, narrow to that one (if in scope)
  const requestedMunId = Number(url.searchParams.get("municipalityId") || 0);
  if (requestedMunId > 0) {
    if (!municipalityIds || municipalityIds.includes(requestedMunId)) {
      municipalityIds = [requestedMunId];
    }
  }

  const employees = await getContractEmployees(contractId, municipalityIds);
  sendJson(res, 200, { ok: true, data: employees });
}

// GET /nomina/novelty-types
async function handleGetNoveltyTypes(req, res) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  if (!requireAuth(req, res)) return;
  sendJson(res, 200, { ok: true, data: NOVELTY_TYPES });
}

// GET /nomina/periods?contractId=X
// POST /nomina/periods
async function handlePeriods(req, res, url) {
  if (!requireAuth(req, res)) return;
  const contractId = Number(url.searchParams.get("contractId"));

  if (req.method === "GET") {
    if (!contractId) { sendJson(res, 400, { ok: false, message: "contractId requerido" }); return; }
    const periods = await listPeriods(contractId);
    sendJson(res, 200, { ok: true, data: periods });
    return;
  }

  if (req.method === "POST") {
    if (!guardTH(req, res)) return;
    const body = await readJsonBody(req);
    const cid  = Number(body.contractId);
    const coid = Number(body.companyId);
    if (!cid || !coid || !body.period) {
      sendJson(res, 400, { ok: false, message: "contractId, companyId y period (YYYY-MM) son requeridos" });
      return;
    }
    const label  = body.label || `Nómina ${body.period}`;
    const userId = requireAuth(req, res)?.user?.id;
    const period = await createPeriod(cid, coid, body.period, label, userId);
    sendJson(res, 201, { ok: true, data: period });
    return;
  }

  sendMethodNotAllowed(res);
}

// GET /nomina/periods/:id
async function handleGetPeriod(req, res, id) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  if (!requireAuth(req, res)) return;
  const period  = await getPeriodById(id);
  if (!period) { sendJson(res, 404, { ok: false, message: "Período no encontrado" }); return; }
  const results = await getPeriodResults(id);
  sendJson(res, 200, { ok: true, data: { period, results } });
}

// POST /nomina/periods/:id/save
async function handleSavePeriod(req, res, id) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }
  const user = guardTH(req, res);
  if (!user) return;

  const period = await getPeriodById(id);
  if (!period) { sendJson(res, 404, { ok: false, message: "Período no encontrado" }); return; }
  if (period.status === "CERRADO") {
    sendJson(res, 400, { ok: false, message: "El período está cerrado y no puede modificarse" }); return;
  }

  const body = await readJsonBody(req);
  if (!Array.isArray(body.lines) || !body.lines.length) {
    sendJson(res, 400, { ok: false, message: "lines[] es requerido" }); return;
  }

  const salaryConfig  = await getSalaryConfigForContract(period.contract_id);
  const salarySnapshot = salaryConfig;

  const linesWithCalc = body.lines.map(line => {
    const novedades    = Array.isArray(line.novedades)    ? line.novedades    : [];
    const horasDiarias = Array.isArray(line.horasDiarias) ? line.horasDiarias : [];
    const turnos       = Array.isArray(line.turnos)       ? line.turnos       : [];
    const calc = line.payrollType === "horas"
      ? calcLineHoras(salaryConfig, line.modalityClass, horasDiarias)
      : calcLine(salaryConfig, line.modalityClass, Number(line.diasNoClase) || 0, novedades, turnos);
    return { ...line, novedades, horasDiarias, turnos, calc };
  });

  await savePeriodLines(id, period.contract_id, period.company_id, linesWithCalc, salarySnapshot);

  const results = await getPeriodResults(id);
  const totals = results.reduce(
    (a, r) => ({ employees: a.employees + 1, totalDev: a.totalDev + r.totalDev, neto: a.neto + r.neto }),
    { employees: 0, totalDev: 0, neto: 0 }
  );
  sendJson(res, 200, { ok: true, data: { periodId: id, totals } });
}

// POST /nomina/periods/:id/close
async function handleClosePeriod(req, res, id) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }
  if (!guardTH(req, res)) return;
  const period = await closePeriod(id);
  sendJson(res, 200, { ok: true, data: period });
}

// GET /nomina/periods/:id/export
async function handleExportPeriod(req, res, id) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  if (!requireAuth(req, res)) return;
  const period = await getPeriodById(id);
  if (!period) { sendJson(res, 404, { ok: false, message: "Período no encontrado" }); return; }
  const buffer = await generateExcelBuffer(id);
  const filename = encodeURIComponent(`Nomina_${period.label.replace(/\s+/g, "_")}.xlsx`);
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": buffer.length,
  });
  res.end(buffer);
}

module.exports = {
  handleGetEmployees,
  handleGetNoveltyTypes,
  handlePeriods,
  handleGetPeriod,
  handleSavePeriod,
  handleClosePeriod,
  handleExportPeriod,
};
