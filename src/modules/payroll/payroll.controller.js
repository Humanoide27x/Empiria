const XLSX = require("xlsx");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { readJsonBody } = require("../../http/request");
const { withModuleProtection, isDemoUser } = require("../../http/protection");
const { ACTIONS, MODULES, ROLES } = require("../../auth/permissions");

const {
  listNovelties,
  getNoveltyById,
  createNovelty,
  updateNoveltyStatus,
  getPayrollSummary,
  calculatePayroll,
  getPayrollConfig,
  NOVELTY_TYPES,
  NOVELTY_STATUSES,
  listPeriods,
  getPeriodById,
  createPeriod,
  calculateAndSavePeriod,
  getPeriodResults,
  closePeriod,
  getPaySlip,
} = require("./payroll.repository");

const operational = require("./payroll.operational.repository");

function getIdFromPath(pathname, prefix) {
  const raw = String(pathname || "").replace(prefix, "").split("/").filter(Boolean)[0];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isAdminOrTH(user) {
  const r = String(user.role || "").toLowerCase();
  return r === ROLES.ADMINISTRATOR || r === ROLES.HUMAN_RESOURCES;
}

function parseNumericPart(pathname, index) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  const n = Number(parts[index]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function handleOperationalPeriods(req, res, url) {
  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user, resource) => {
        const filters = {
          companyId: innerUrl.searchParams.get("companyId") || resource.companyId,
          contractId: innerUrl.searchParams.get("contractId") || resource.contractId,
        };
        const data = await operational.listOperationalPeriods(filters);
        sendJson(innerRes, 200, { ok: true, data });
      }
    )(req, res, url);
  }

  if (req.method === "POST") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.CREATE,
      async (innerReq, innerRes, innerUrl, user) => {
        if (!isAdminOrTH(user)) {
          sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede crear periodos" });
          return;
        }
        const body = await readJsonBody(innerReq);
        if (user.companyId && !body.companyId && !body.company_id) body.companyId = user.companyId;
        if (user.contractId && !body.contractId && !body.contract_id) body.contractId = user.contractId;
        try {
          const data = await operational.createOperationalPeriod(body, user.id);
          sendJson(innerRes, 201, { ok: true, data, message: "Periodo creado correctamente" });
        } catch (err) {
          sendJson(innerRes, 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

async function handleOperationalGroups(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  const periodId = parseNumericPart(url.pathname, 1);
  if (!periodId) { sendJson(res, 400, { ok: false, message: "ID de periodo invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes) => {
      try {
        const data = await operational.listPayrollGroups(periodId);
        sendJson(innerRes, 200, { ok: true, data });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleOperationalGroupById(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }
  const periodId = parseNumericPart(url.pathname, 1);
  const groupId = parseNumericPart(url.pathname, 3);
  if (!periodId || !groupId) { sendJson(res, 400, { ok: false, message: "ID de grupo invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes) => {
      try {
        const data = await operational.getPayrollGroupDetail(periodId, groupId);
        sendJson(innerRes, 200, { ok: true, data });
      } catch (err) {
        sendJson(innerRes, 404, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleOperationalGroupCalculate(req, res, url) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }
  const groupId = parseNumericPart(url.pathname, 2);
  if (!groupId) { sendJson(res, 400, { ok: false, message: "ID de grupo invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, innerUrl, user) => {
      if (!isAdminOrTH(user)) {
        sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede calcular la nomina" });
        return;
      }
      try {
        const data = await operational.calculatePayrollGroup(groupId);
        sendJson(innerRes, 200, { ok: true, data, message: "Grupo calculado correctamente" });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleOperationalItemNovelties(req, res, url) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }
  const itemId = parseNumericPart(url.pathname, 2);
  if (!itemId) { sendJson(res, 400, { ok: false, message: "ID de item invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.REGISTER,
    async (innerReq, innerRes, innerUrl, user) => {
      try {
        const body = await readJsonBody(innerReq);
        const data = await operational.createNoveltyForItem(itemId, body, user.id);
        sendJson(innerRes, 201, { ok: true, data, message: "Novedad registrada correctamente" });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleOperationalNoveltyPatch(req, res, url) {
  if (req.method !== "PATCH" && req.method !== "PUT") { sendMethodNotAllowed(res); return; }
  const noveltyId = parseNumericPart(url.pathname, 2);
  if (!noveltyId) { sendJson(res, 400, { ok: false, message: "ID de novedad invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, innerUrl, user) => {
      try {
        const body = await readJsonBody(innerReq);
        const data = await operational.patchNovelty(noveltyId, body, user.id);
        sendJson(innerRes, 200, { ok: true, data, message: "Novedad actualizada" });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleOperationalNoveltyReviewed(req, res, url) {
  if (req.method !== "PATCH" && req.method !== "PUT") { sendMethodNotAllowed(res); return; }
  const noveltyId = parseNumericPart(url.pathname, 2);
  if (!noveltyId) { sendJson(res, 400, { ok: false, message: "ID de novedad invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, innerUrl, user) => {
      try {
        const body = await readJsonBody(innerReq);
        const data = await operational.setNoveltyReviewed(noveltyId, body.reviewed !== false, body, user);
        sendJson(innerRes, 200, { ok: true, data, message: "Revision actualizada" });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleOperationalNoveltyCover(req, res, url) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }
  const noveltyId = parseNumericPart(url.pathname, 2);
  if (!noveltyId) { sendJson(res, 400, { ok: false, message: "ID de novedad invalido" }); return; }
  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.REGISTER,
    async (innerReq, innerRes, innerUrl, user) => {
      try {
        const body = await readJsonBody(innerReq);
        const data = await operational.createTurnCover(noveltyId, body, user.id);
        sendJson(innerRes, 201, { ok: true, data, message: "Cobertura registrada" });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

async function handleOperationalSupports(req, res, url) {
  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl) => {
        const data = await operational.listSupports({
          periodId: innerUrl.searchParams.get("periodId"),
          municipalityId: innerUrl.searchParams.get("municipalityId"),
          status: innerUrl.searchParams.get("status"),
        });
        sendJson(innerRes, 200, { ok: true, data });
      }
    )(req, res, url);
  }
  if (req.method === "POST") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.REGISTER,
      async (innerReq, innerRes, innerUrl, user) => {
        try {
          const body = await readJsonBody(innerReq);
          const data = await operational.createSupport(body, user.id);
          sendJson(innerRes, 201, { ok: true, data, message: "Soporte actualizado" });
        } catch (err) {
          sendJson(innerRes, 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }
  sendMethodNotAllowed(res);
}

// ─────────────────────────────────────────────
// GET  /payroll/novelties
// POST /payroll/novelties
// ─────────────────────────────────────────────
async function handleNovelties(req, res, url) {
  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user, resource) => {
        const filters = {
          companyId:    innerUrl.searchParams.get("companyId")    || resource.companyId,
          contractId:   innerUrl.searchParams.get("contractId")   || resource.contractId,
          employeeId:   innerUrl.searchParams.get("employeeId"),
          noveltyType:  innerUrl.searchParams.get("noveltyType"),
          status:       innerUrl.searchParams.get("status"),
          startDateFrom: innerUrl.searchParams.get("startDateFrom"),
          startDateTo:   innerUrl.searchParams.get("startDateTo"),
        };

        const data = await listNovelties(filters);
        sendJson(innerRes, 200, { ok: true, data });
      }
    )(req, res, url);
  }

  if (req.method === "POST") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.REGISTER,
      async (innerReq, innerRes, innerUrl, user, resource) => {
        const body = await readJsonBody(innerReq);
        try {
          const novelty = await createNovelty(body, user.id);
          sendJson(innerRes, 201, {
            ok: true,
            data: novelty,
            message: "Novedad registrada correctamente",
          });
        } catch (err) {
          sendJson(innerRes, 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// ─────────────────────────────────────────────
// GET    /payroll/novelties/:id
// ─────────────────────────────────────────────
async function handleNoveltyById(req, res, url) {
  const id = getIdFromPath(url.pathname, "/payroll/novelties/");

  if (!id) {
    sendJson(res, 400, { ok: false, message: "ID de novedad inválido" });
    return;
  }

  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes) => {
        const novelty = await getNoveltyById(id);
        if (!novelty) {
          sendJson(innerRes, 404, { ok: false, message: "Novedad no encontrada" });
          return;
        }
        sendJson(innerRes, 200, { ok: true, data: novelty });
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// PATCH /payroll/novelties/:id/status
async function handleNoveltyStatus(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const id = Number(parts[2]);

  if (!Number.isFinite(id) || id <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de novedad inválido" });
    return;
  }

  if (req.method !== "PATCH" && req.method !== "PUT") {
    sendMethodNotAllowed(res);
    return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, innerUrl, user) => {
      const body = await readJsonBody(innerReq);
      const { status, reviewNotes } = body;

      if (!status) {
        sendJson(innerRes, 400, { ok: false, message: "Debes enviar el campo 'status'" });
        return;
      }

      try {
        const updated = await updateNoveltyStatus(id, status, reviewNotes, user.id);
        sendJson(innerRes, 200, {
          ok: true,
          data: updated,
          message: "Estado de novedad actualizado",
        });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ─────────────────────────────────────────────
// GET /payroll/summary
// ─────────────────────────────────────────────
async function handlePayrollSummary(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user, resource) => {
      const filters = {
        companyId:  innerUrl.searchParams.get("companyId")  || resource.companyId,
        contractId: innerUrl.searchParams.get("contractId") || resource.contractId,
      };

      const data = await getPayrollSummary(filters);
      sendJson(innerRes, 200, { ok: true, data });
    }
  )(req, res, url);
}

// GET /payroll/novelty-types
function handleNoveltyTypes(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }
  sendJson(res, 200, { ok: true, data: NOVELTY_TYPES, statuses: NOVELTY_STATUSES });
}

// ─────────────────────────────────────────────
// GET /payroll/calculate?period=YYYY-MM (preview, sin guardar)
// ─────────────────────────────────────────────
async function handleCalculatePayroll(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user, resource) => {
      const period     = innerUrl.searchParams.get("period");
      const companyId  = innerUrl.searchParams.get("companyId")  || resource.companyId  || null;
      const contractId = innerUrl.searchParams.get("contractId") || resource.contractId || null;

      try {
        const result = await calculatePayroll({ period, companyId, contractId });
        sendJson(innerRes, 200, { ok: true, ...result });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ─────────────────────────────────────────────
// GET/PATCH /payroll/config
// ─────────────────────────────────────────────
async function handlePayrollConfig(req, res, url) {
  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (_req, _res) => {
        const cfg = getPayrollConfig();
        sendJson(_res, 200, { ok: true, data: cfg });
      }
    )(req, res, url);
  }

  if (req.method === "PATCH" || req.method === "PUT") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.UPDATE,
      async (innerReq, innerRes) => {
        const { updatePayrollConfig } = require("../../data/payroll_config");
        const body = await readJsonBody(innerReq);
        try {
          const updated = updatePayrollConfig(body);
          sendJson(innerRes, 200, { ok: true, data: updated, message: "Configuración de nómina actualizada" });
        } catch (err) {
          sendJson(innerRes, 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// ─────────────────────────────────────────────
// GET /payroll/export?period=YYYY-MM → CSV
// ─────────────────────────────────────────────
async function handleExportPayroll(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.EXPORT,
    async (innerReq, innerRes, innerUrl, user, resource) => {
      const period     = innerUrl.searchParams.get("period");
      const companyId  = innerUrl.searchParams.get("companyId")  || resource.companyId  || null;
      const contractId = innerUrl.searchParams.get("contractId") || resource.contractId || null;

      try {
        const { payrollLines, totals } = await calculatePayroll({ period, companyId, contractId });

        const headers = [
          "Empleado","Documento","Municipio","Institución","Sede","Modalidad","Clasificación","Tipo","Días",
          "Salario Base","Aux. Transporte","Otros Ingresos","Total Devengado",
          "Ded. Salud","Ded. Pensión","Total Deducciones","Desc. Novedades","Neto a Pagar","Observaciones",
        ];

        const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

        const rows = payrollLines.map(l => [
          escape(l.employeeName), escape(l.documentNumber),
          escape(l.municipality), escape(l.institution), escape(l.site),
          escape(l.modality), escape(l.modalityClass), escape(l.workTimeType),
          l.workedDays, l.baseSalary, l.transportAllowance, l.otherEarnings,
          l.totalDevengado, l.deduccionSalud, l.deduccionPension, l.totalDeducciones,
          l.novedadDescuento, l.netoPagar, escape(l.observations.join(" | ")),
        ].join(","));

        const totalRow = [
          escape("TOTAL"), "", "", "", "", "", "", "",
          "", totals.totalDevengado, "", "", totals.totalDevengado,
          "", "", totals.totalDeducciones, "", totals.netoPagar, "",
        ].join(",");

        const csv = [headers.join(","), ...rows, totalRow].join("\n");

        innerRes.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="nomina-${period || "periodo"}.csv"`,
        });
        innerRes.end("﻿" + csv);
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// ═════════════════════════════════════════════
// FASE 7 — Gestión de Períodos
// ═════════════════════════════════════════════

// GET  /payroll/periods
// POST /payroll/periods
async function handlePeriods(req, res, url) {
  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes, innerUrl, user, resource) => {
        if (isDemoUser(user)) {
          sendJson(innerRes, 200, { ok: true, data: [] });
          return;
        }
        const filters = {
          companyId:  resource.companyId  || innerUrl.searchParams.get("companyId"),
          contractId: resource.contractId || innerUrl.searchParams.get("contractId"),
          status:     innerUrl.searchParams.get("status"),
        };
        const data = await listPeriods(filters);
        sendJson(innerRes, 200, { ok: true, data });
      }
    )(req, res, url);
  }

  if (req.method === "POST") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.CREATE,
      async (innerReq, innerRes, innerUrl, user) => {
        if (!isAdminOrTH(user)) {
          sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede crear períodos" });
          return;
        }
        const body = await readJsonBody(innerReq);
        // For contract-scoped users, inject their company/contract if not provided
        if (user.companyId  && !body.companyId  && !body.company_id)  body.companyId  = user.companyId;
        if (user.contractId && !body.contractId && !body.contract_id) body.contractId = user.contractId;
        try {
          const period = await createPeriod(body, user.id);
          sendJson(innerRes, 201, { ok: true, data: period, message: "Período creado correctamente" });
        } catch (err) {
          sendJson(innerRes, 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// GET /payroll/periods/:id
async function handlePeriodById(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  const id = getIdFromPath(url.pathname, "/payroll/periods/");
  if (!id) { sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return; }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes) => {
      const period = await getPeriodById(id);
      if (!period) {
        sendJson(innerRes, 404, { ok: false, message: "Período no encontrado" });
        return;
      }
      sendJson(innerRes, 200, { ok: true, data: period });
    }
  )(req, res, url);
}

// GET  /payroll/periods/:id/novelties  — novedades del rango de fechas del período
// POST /payroll/periods/:id/novelties  — registrar novedad vinculada al período
async function handlePeriodNovelties(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }

  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes) => {
        const period = await getPeriodById(periodId);
        if (!period) { sendJson(innerRes, 404, { ok: false, message: "Período no encontrado" }); return; }

        const data = await listNovelties({
          companyId:    period.companyId,
          contractId:   period.contractId,
          startDateFrom: new Date(period.periodStart).toISOString().substring(0, 10),
          startDateTo:   new Date(period.periodEnd).toISOString().substring(0, 10),
        });
        sendJson(innerRes, 200, { ok: true, data, period });
      }
    )(req, res, url);
  }

  if (req.method === "POST") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.REGISTER,
      async (innerReq, innerRes, innerUrl, user) => {
        const period = await getPeriodById(periodId);
        if (!period) { sendJson(innerRes, 404, { ok: false, message: "Período no encontrado" }); return; }
        if (period.status === "CERRADO") {
          sendJson(innerRes, 400, { ok: false, message: "No se pueden agregar novedades a un período cerrado" }); return;
        }

        const body = await readJsonBody(innerReq);
        body.companyId  = body.companyId  || period.companyId;
        body.contractId = body.contractId || period.contractId;

        try {
          const novelty = await createNovelty(body, user.id);
          sendJson(innerRes, 201, { ok: true, data: novelty, message: "Novedad registrada correctamente" });
        } catch (err) {
          sendJson(innerRes, 400, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// POST /payroll/periods/:id/calculate
async function handlePeriodCalculate(req, res, url) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }

  const parts = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user) => {
      if (!isAdminOrTH(user)) {
        sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede calcular la nómina" });
        return;
      }
      try {
        const result = await calculateAndSavePeriod(periodId, user.id);
        sendJson(innerRes, 200, {
          ok: true,
          message: `Nómina calculada: ${result.payrollLines.length} empleados`,
          data: {
            periodId,
            employees: result.payrollLines.length,
            totals: result.totals,
            alerts: result.alerts,
          },
        });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// GET /payroll/periods/:id/results
async function handlePeriodResults(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  const parts = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes) => {
      try {
        const data = await getPeriodResults(periodId);
        sendJson(innerRes, 200, { ok: true, data });
      } catch (err) {
        sendJson(innerRes, 404, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// GET /payroll/periods/:id/export → XLSX
async function handlePeriodExport(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  const parts = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.EXPORT,
    async (innerReq, innerRes) => {
      try {
        const { period, lines, totals } = await getPeriodResults(periodId);

        const headerRow = [
          "Empleado", "Cédula", "Municipio", "Institución", "Sede",
          "Modalidad", "Clasificación", "Tipo jornada", "Días trabajados",
          "Salario base", "Aux. transporte", "Otros ingresos", "Total devengado",
          "Ded. salud", "Ded. pensión", "Total deducciones",
          "Desc. novedades", "Neto a pagar", "Observaciones",
        ];

        const dataRows = lines.map(l => [
          l.employeeName ?? "", l.documentNumber ?? "",
          l.municipality ?? "", l.institution ?? "", l.site ?? "",
          l.modality ?? "", l.modalityClass ?? "", l.workTimeType ?? "",
          l.workedDays ?? 0,
          l.baseSalary ?? 0, l.transportAllowance ?? 0, l.otherEarnings ?? 0, l.totalDevengado ?? 0,
          l.deduccionSalud ?? 0, l.deduccionPension ?? 0, l.totalDeducciones ?? 0,
          l.novedadDescuento ?? 0, l.netoPagar ?? 0,
          l.observations ?? "",
        ]);

        const totalsRow = [
          "TOTAL", "", "", "", "", "", "", "",
          "", "", "", "", totals.totalDevengado ?? 0,
          "", "", totals.totalDeducciones ?? 0,
          "", totals.netoPagar ?? 0, "",
        ];

        const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows, totalsRow]);

        // Column widths
        ws["!cols"] = [
          {wch:32},{wch:14},{wch:22},{wch:30},{wch:22},
          {wch:10},{wch:14},{wch:14},{wch:8},
          {wch:14},{wch:14},{wch:14},{wch:16},
          {wch:12},{wch:12},{wch:16},
          {wch:16},{wch:14},{wch:30},
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Nómina");

        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
        const filename = `nomina-${period.label.replace(/[^a-z0-9]/gi, "-")}.xlsx`;

        innerRes.writeHead(200, {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": buf.length,
        });
        innerRes.end(buf);
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// POST /payroll/periods/:id/close
async function handlePeriodClose(req, res, url) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }

  const parts = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, innerUrl, user) => {
      if (!isAdminOrTH(user)) {
        sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede cerrar períodos" });
        return;
      }
      try {
        const period = await closePeriod(periodId, user.id);
        sendJson(innerRes, 200, { ok: true, data: period, message: "Período cerrado correctamente" });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// GET  /payroll/periods/:id/municipality-status
// POST /payroll/periods/:id/municipality-status
async function handleMunicipalityStatus(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }

  const pool = require("../../db/pool");

  if (req.method === "GET") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.VIEW,
      async (innerReq, innerRes) => {
        try {
          const { rows } = await pool.query(
            `SELECT municipality, is_complete, completed_by_name, completed_at, notes
             FROM payroll_municipality_status
             WHERE period_id = $1
             ORDER BY municipality ASC`,
            [periodId]
          );
          sendJson(innerRes, 200, { ok: true, data: rows });
        } catch (err) {
          sendJson(innerRes, 500, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  if (req.method === "POST") {
    return withModuleProtection(
      MODULES.PAYROLL,
      ACTIONS.REGISTER,
      async (innerReq, innerRes, innerUrl, user) => {
        const body = await readJsonBody(innerReq);
        const municipality = String(body.municipality || "").trim();
        if (!municipality) {
          sendJson(innerRes, 400, { ok: false, message: "Municipio requerido" }); return;
        }
        const isComplete = Boolean(body.isComplete !== false);
        try {
          await pool.query(
            `INSERT INTO payroll_municipality_status
               (period_id, municipality, is_complete, completed_by_user_id, completed_by_name, completed_at, notes, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), $6, NOW())
             ON CONFLICT (period_id, municipality) DO UPDATE SET
               is_complete = EXCLUDED.is_complete,
               completed_by_user_id = EXCLUDED.completed_by_user_id,
               completed_by_name = EXCLUDED.completed_by_name,
               completed_at = CASE WHEN EXCLUDED.is_complete THEN NOW() ELSE NULL END,
               notes = COALESCE(EXCLUDED.notes, payroll_municipality_status.notes),
               updated_at = NOW()`,
            [periodId, municipality, isComplete, user.id || null, user.username || user.name || "", body.notes || null]
          );
          sendJson(innerRes, 200, { ok: true, message: isComplete ? "Municipio marcado como completado" : "Estado actualizado" });
        } catch (err) {
          sendJson(innerRes, 500, { ok: false, message: err.message });
        }
      }
    )(req, res, url);
  }

  sendMethodNotAllowed(res);
}

// POST /payroll/periods/:id/confirm-and-send
async function handleConfirmAndSend(req, res, url) {
  if (req.method !== "POST") { sendMethodNotAllowed(res); return; }

  const parts = url.pathname.split("/").filter(Boolean);
  const periodId = Number(parts[2]);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    sendJson(res, 400, { ok: false, message: "ID de período inválido" }); return;
  }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.UPDATE,
    async (innerReq, innerRes, innerUrl, user) => {
      if (!isAdminOrTH(user)) {
        sendJson(innerRes, 403, { ok: false, message: "Solo Administrador o Talento Humano puede confirmar la nómina" });
        return;
      }

      const pool = require("../../db/pool");

      try {
        // Close the period
        const period = await closePeriod(periodId, user.id);

        // Get payslip results to count employees with emails
        let sent = 0, failed = 0;
        try {
          const { lines } = await getPeriodResults(periodId);
          // Email sending requires SMTP config — count employees with emails registered
          const { getPersonnel } = require("../../data/personnel");
          const personnel = getPersonnel();
          const emailMap = {};
          personnel.forEach(e => {
            if (e.email || e.correo) {
              const key = String(e.id || e.documentNumber || e.numero_documento || "");
              if (key) emailMap[key] = e.email || e.correo;
            }
          });
          for (const line of lines) {
            const empId = String(line.employeeId || "");
            const email = emailMap[empId] || emailMap[line.documentNumber || ""];
            if (email) sent++; else failed++;
          }
        } catch { /* non-fatal */ }

        sendJson(innerRes, 200, {
          ok: true,
          message: `Nómina confirmada. ${sent} desprendibles disponibles para envío.`,
          data: { period, employeesWithEmail: sent, employeesWithoutEmail: failed },
        });
      } catch (err) {
        sendJson(innerRes, 400, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

// GET /payroll/employees/:employeeId/slip?periodId=X
async function handlePaySlip(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  return withModuleProtection(
    MODULES.PAYROLL,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl) => {
      const parts = url.pathname.split("/").filter(Boolean);
      const employeeId = parts[2];
      const periodId   = Number(innerUrl.searchParams.get("periodId"));

      if (!employeeId) { sendJson(innerRes, 400, { ok: false, message: "employeeId inválido" }); return; }
      if (!Number.isFinite(periodId) || periodId <= 0) {
        sendJson(innerRes, 400, { ok: false, message: "periodId inválido" }); return;
      }

      try {
        const data = await getPaySlip(periodId, employeeId);
        sendJson(innerRes, 200, { ok: true, data });
      } catch (err) {
        sendJson(innerRes, 404, { ok: false, message: err.message });
      }
    }
  )(req, res, url);
}

module.exports = {
  handleNovelties,
  handleNoveltyById,
  handleNoveltyStatus,
  handlePayrollSummary,
  handleNoveltyTypes,
  handleCalculatePayroll,
  handlePayrollConfig,
  handleExportPayroll,
  handlePeriods,
  handlePeriodById,
  handlePeriodNovelties,
  handlePeriodCalculate,
  handlePeriodResults,
  handlePeriodExport,
  handlePeriodClose,
  handleMunicipalityStatus,
  handleConfirmAndSend,
  handlePaySlip,
  handleOperationalPeriods,
  handleOperationalGroups,
  handleOperationalGroupById,
  handleOperationalGroupCalculate,
  handleOperationalItemNovelties,
  handleOperationalNoveltyPatch,
  handleOperationalNoveltyReviewed,
  handleOperationalNoveltyCover,
  handleOperationalSupports,
};
