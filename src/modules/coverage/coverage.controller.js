const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { readJsonBody } = require("../../http/request");
const { withModuleProtection, isDemoUser } = require("../../http/protection");
const { ACTIONS, MODULES } = require("../../auth/permissions");

const {
  getCoverageByContract,
  getCoverageByMunicipality,
  getEmployeesByMunicipalityAndPosition,
  getCoverageSummary,
} = require("./coverage.repository");

const {
  saveCoverageUpload,
  getCoverageHistory,
  getCoverageRowsByUpload,
} = require("./coverage.excel");

const COVERAGE_SUMMARY_CACHE = new Map();
const COVERAGE_SUMMARY_TTL = 90 * 1000;

function getCoverageSummaryCacheKey(filters = {}) {
  const municipalityIds = Array.isArray(filters.municipalityIds) ? filters.municipalityIds.join(",") : "";
  return [
    filters.companyId || "",
    filters.contractId || "",
    filters.municipalityId || "",
    municipalityIds,
  ].join("|");
}

function readCoverageSummaryCache(key) {
  const cached = COVERAGE_SUMMARY_CACHE.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts > COVERAGE_SUMMARY_TTL) {
    COVERAGE_SUMMARY_CACHE.delete(key);
    return null;
  }
  return cached.data;
}

function writeCoverageSummaryCache(key, data) {
  COVERAGE_SUMMARY_CACHE.set(key, { ts: Date.now(), data });
}

function clearCoverageSummaryCache() {
  COVERAGE_SUMMARY_CACHE.clear();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;

  const normalized = String(value)
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const number = Number(normalized);

  return Number.isFinite(number) ? number : 0;
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }

  return 0;
}

function getCoverageStatus(personalActual, personalRequerido) {
  const actual = toNumber(personalActual);
  const requerido = toNumber(personalRequerido);
  const diferencia = actual - requerido;

  let estado = "EXACTO";

  if (diferencia < 0) estado = "FALTANTE";
  if (diferencia > 0) estado = "SOBRANTE";

  let riesgo = "BAJO";

  if (requerido === 0 && actual > 0) {
    riesgo = "ALTO";
  } else if (diferencia < 0) {
    riesgo = Math.abs(diferencia) >= 2 ? "ALTO" : "MEDIO";
  } else if (diferencia > 2) {
    riesgo = "MEDIO";
  }

  return {
    estado,
    diferencia,
    riesgo,
  };
}

function decorateCoverageRow(row = {}) {
  if (
    row.required_tc !== undefined ||
    row.required_mt !== undefined ||
    row.contracted_tc !== undefined ||
    row.contracted_mt !== undefined
  ) {
    return row;
  }

  const personalRequerido = firstValue(row, [
    "personal_requerido",
    "required_personnel",
    "requiredPersonnel",
    "personalRequired",
    "PERSONAL REQUERIDO",
    "PERSONAL_REQUERIDO",
    "requerido",
    "REQUERIDO",
    "total_requerido",
    "required",
  ]);

  const personalActual = firstValue(row, [
    "personal_actual",
    "current_personnel",
    "currentPersonnel",
    "personalActual",
    "PERSONAL ACTUAL",
    "PERSONAL_ACTUAL",
    "actual",
    "ACTUAL",
    "total_actual",
    "assigned",
  ]);

  const coverage = getCoverageStatus(personalActual, personalRequerido);

  return {
    ...row,

    personal_requerido_calculado: toNumber(personalRequerido),
    personal_actual_calculado: toNumber(personalActual),

    coverage_status: coverage.estado,
    coverage_diff: coverage.diferencia,
    coverage_risk: coverage.riesgo,

    coverageStatus: coverage.estado,
    coverageDiff: coverage.diferencia,
    coverageRisk: coverage.riesgo,

    coverage_label:
      coverage.estado === "FALTANTE"
        ? "🔴 FALTANTE"
        : coverage.estado === "SOBRANTE"
        ? "🟢 SOBRANTE"
        : "🟡 EXACTO",

    coverage_class:
      coverage.estado === "FALTANTE"
        ? "coverage-faltante"
        : coverage.estado === "SOBRANTE"
        ? "coverage-sobrante"
        : "coverage-exacto",

    coverage_risk_class:
      coverage.riesgo === "ALTO"
        ? "risk-alto"
        : coverage.riesgo === "MEDIO"
        ? "risk-medio"
        : "risk-bajo",
  };
}

function decorateCoverageRows(data) {
  if (!Array.isArray(data)) return data;
  return data.map(decorateCoverageRow);
}

// GET /coverage/summary
function handleCoverageSummary(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  return withModuleProtection(
    MODULES.COVERAGE,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user, resource) => {
      const filters = {
        companyId:       innerUrl.searchParams.get("companyId") || resource.companyId,
        contractId:      innerUrl.searchParams.get("contractId") || resource.contractId,
        municipalityIds: resource.municipalityIds || null,
      };

      const cacheKey = getCoverageSummaryCacheKey(filters);
      const cached = readCoverageSummaryCache(cacheKey);
      if (cached) {
        sendJson(innerRes, 200, { ok: true, cached: true, data: cached });
        return;
      }

      const summary = await getCoverageSummary(filters);
      const data = Array.isArray(summary) ? decorateCoverageRows(summary) : summary;
      writeCoverageSummaryCache(cacheKey, data);

      sendJson(innerRes, 200, {
        ok: true,
        cached: false,
        data,
      });
    }
  )(req, res, url);
}

// POST /coverage/upload
function handleCoverageUpload(req, res, url) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return;
  }

  return withModuleProtection(
    MODULES.COVERAGE,
    ACTIONS.CREATE,
    async (innerReq, innerRes, innerUrl, user, resource) => {
      try {
        const body = await readJsonBody(innerReq);

        if (!body.fileBase64) {
          sendJson(innerRes, 400, {
            ok: false,
            message: "Debes enviar el archivo Excel.",
          });
          return;
        }

        if (!body.fileName) {
          sendJson(innerRes, 400, {
            ok: false,
            message: "Debes enviar el nombre del archivo.",
          });
          return;
        }

        const result = await saveCoverageUpload({
          companyId: body.companyId || resource.companyId,
          contractId: body.contractId || resource.contractId,
          periodMonth: body.periodMonth || "",
          weekNumber: body.weekNumber || null,
          fileBase64: body.fileBase64,
          fileName: body.fileName,
          uploadedBy: user?.name || user?.username || "Usuario",
        });
        clearCoverageSummaryCache();

        sendJson(innerRes, 201, {
          ok: true,
          data: result,
          message: "Archivo de cobertura procesado correctamente.",
        });
      } catch (error) {
        sendJson(innerRes, 400, {
          ok: false,
          message: error.message || "No fue posible procesar el archivo.",
        });
      }
    }
  )(req, res, url);
}

// GET /coverage/history
function handleCoverageHistory(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  return withModuleProtection(
    MODULES.COVERAGE,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user, resource) => {
      const filters = {
        companyId: innerUrl.searchParams.get("companyId") || resource.companyId,
        contractId: innerUrl.searchParams.get("contractId") || resource.contractId,
      };

      const data = await getCoverageHistory(filters);

      sendJson(innerRes, 200, {
        ok: true,
        data,
      });
    }
  )(req, res, url);
}

// GET /coverage/upload/:id
function handleCoverageUploadRows(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  return withModuleProtection(
    MODULES.COVERAGE,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user, resource) => {
      const uploadId = innerUrl.pathname.split("/")[3];

      if (!uploadId) {
        sendJson(innerRes, 400, {
          ok: false,
          message: "uploadId es requerido.",
        });
        return;
      }

      const municipalityIds = Array.isArray(resource?.municipalityIds) && resource.municipalityIds.length
        ? resource.municipalityIds
        : null;
      const data = await getCoverageRowsByUpload(uploadId, municipalityIds);

      sendJson(innerRes, 200, {
        ok: true,
        data: decorateCoverageRows(data),
      });
    }
  )(req, res, url);
}

// GET /coverage/by-contract
function handleCoverageByContract(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  return withModuleProtection(
    MODULES.COVERAGE,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user, resource) => {
      if (isDemoUser(user)) { sendJson(innerRes, 200, { ok: true, data: [] }); return; }
      const filters = {
        companyId:       resource.companyId  || innerUrl.searchParams.get("companyId"),
        contractId:      resource.contractId || innerUrl.searchParams.get("contractId"),
        municipalityIds: resource.municipalityIds || null,
      };

      const data = await getCoverageByContract(filters);

      sendJson(innerRes, 200, {
        ok: true,
        data: decorateCoverageRows(data),
      });
    }
  )(req, res, url);
}

// GET /coverage/by-municipality
function handleCoverageByMunicipality(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  return withModuleProtection(
    MODULES.COVERAGE,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user, resource) => {
      if (isDemoUser(user)) { sendJson(innerRes, 200, { ok: true, data: [] }); return; }
      const filters = {
        companyId:       resource.companyId  || innerUrl.searchParams.get("companyId"),
        contractId:      resource.contractId || innerUrl.searchParams.get("contractId"),
        municipalityId:  innerUrl.searchParams.get("municipalityId"),
        municipalityIds: resource.municipalityIds || null,
      };

      const data = await getCoverageByMunicipality(filters);

      sendJson(innerRes, 200, {
        ok: true,
        data: decorateCoverageRows(data),
      });
    }
  )(req, res, url);
}

// GET /coverage/employees
function handleCoverageEmployees(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  return withModuleProtection(
    MODULES.COVERAGE,
    ACTIONS.VIEW,
    async (innerReq, innerRes, innerUrl, user, resource) => {
      if (isDemoUser(user)) { sendJson(innerRes, 200, { ok: true, data: [] }); return; }
      const filters = {
        companyId:       resource.companyId  || innerUrl.searchParams.get("companyId"),
        contractId:      resource.contractId || innerUrl.searchParams.get("contractId"),
        municipalityId:  innerUrl.searchParams.get("municipalityId"),
        position:        innerUrl.searchParams.get("position"),
        municipalityIds: resource.municipalityIds || null,
      };

      const data = await getEmployeesByMunicipalityAndPosition(filters);

      sendJson(innerRes, 200, {
        ok: true,
        data,
      });
    }
  )(req, res, url);
}

module.exports = {
  handleCoverageSummary,
  handleCoverageUpload,
  handleCoverageHistory,
  handleCoverageUploadRows,
  handleCoverageByContract,
  handleCoverageByMunicipality,
  handleCoverageEmployees,
};
