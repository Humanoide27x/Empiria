"use strict";

const { sendJson, sendMethodNotAllowed } = require("../../../http/response");
const { readJsonBody } = require("../../../http/request");
const { requireAuth } = require("../../auth/auth.helpers");
const {
  buildContractualMeta,
  listMasterCatalog,
  getMasterCatalogRecord,
  createMasterCatalogRecord,
  updateMasterCatalogRecord,
  listContractConfigurationSummary,
  listContractPositionRules,
  getContractPositionRuleById,
  createContractPositionRule,
  updateContractPositionRule,
  deactivateContractPositionRule,
  listContractDocumentRules,
  getContractDocumentRuleById,
  createContractDocumentRule,
  updateContractDocumentRule,
  deactivateContractDocumentRule,
  listContractExperienceRules,
  getContractExperienceRuleById,
  createContractExperienceRule,
  updateContractExperienceRule,
  deactivateContractExperienceRule,
  listContractCoverageRules,
  getContractCoverageRuleById,
  createContractCoverageRule,
  updateContractCoverageRule,
  deactivateContractCoverageRule,
  listContractMunicipalities,
  replaceContractMunicipalities,
  listContractModalities,
  replaceContractModalities,
  listEmployeeAssignments,
  listEmployeeAssignmentHistory,
  listEmployeeDocumentCompliance,
  listEmployeeExperienceSummary,
  evaluateEmployeeExperience,
  getEmployeeCoverageContext,
  listEmploymentCertificates,
  createEmploymentCertificate,
} = require("./contractual.repository");

function getUser(req, res) {
  const auth = requireAuth(req, res);
  return auth ? auth.user : null;
}

function isAdmin(user) {
  return String(user?.role || "").toLowerCase() === "administrador";
}

function canView(user) {
  const role = String(user?.role || "").toLowerCase();
  return role === "administrador" || role === "talento_humano";
}

function guardView(req, res) {
  const user = getUser(req, res);
  if (!user) return null;
  if (!canView(user)) {
    sendJson(res, 403, {
      ok: false,
      message: "Acceso denegado a configuracion contractual",
    });
    return null;
  }
  return user;
}

function guardAdmin(req, res) {
  const user = getUser(req, res);
  if (!user) return null;
  if (!isAdmin(user)) {
    sendJson(res, 403, {
      ok: false,
      message: "Solo el Administrador puede realizar esta accion",
    });
    return null;
  }
  return user;
}

function parseId(pathname, prefix) {
  const value = String(pathname || "").slice(prefix.length).split("/")[0];
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseMasterKind(pathname) {
  const segments = String(pathname || "").split("/").filter(Boolean);
  return segments[3] || null;
}

function parseBooleanParam(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "si", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return undefined;
}

function buildMasterFilters(url) {
  return {
    active: parseBooleanParam(url.searchParams.get("active")),
    search: url.searchParams.get("search") || "",
  };
}

function buildPositionRuleFilters(url) {
  return {
    active: parseBooleanParam(url.searchParams.get("active")),
    search: url.searchParams.get("search") || "",
    staffingType: url.searchParams.get("staffingType") || url.searchParams.get("staffing_type") || "",
  };
}

function buildDocumentRuleFilters(url) {
  return {
    active: parseBooleanParam(url.searchParams.get("active")),
    contractPositionRuleId:
      url.searchParams.get("contractPositionRuleId")
      || url.searchParams.get("contract_position_rule_id")
      || "",
  };
}

function buildAssignmentFilters(url) {
  return {
    includeInactive:
      parseBooleanParam(url.searchParams.get("includeInactive"))
      ?? parseBooleanParam(url.searchParams.get("include_inactive"))
      ?? false,
  };
}

async function handleContractualMeta(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const user = guardView(req, res);
  if (!user) return;

  sendJson(res, 200, {
    ok: true,
    data: buildContractualMeta(),
  });
}

async function handleMasterCatalog(req, res, url) {
  const kind = parseMasterKind(url.pathname);
  if (!kind) {
    sendJson(res, 400, { ok: false, message: "Catalogo maestro invalido" });
    return;
  }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;

    try {
      const data = await listMasterCatalog(kind, buildMasterFilters(url));
      sendJson(res, 200, { ok: true, data, total: data.length });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "POST") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const body = await readJsonBody(req);
      const data = await createMasterCatalogRecord(kind, body);
      sendJson(res, 201, {
        ok: true,
        data,
        message: "Registro maestro creado correctamente",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

async function handleMasterCatalogById(req, res, url) {
  const kind = parseMasterKind(url.pathname);
  const id = parseId(url.pathname, `/admin/contractual/master/${kind}/`);

  if (!kind || !id) {
    sendJson(res, 400, { ok: false, message: "Identificador invalido" });
    return;
  }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;

    try {
      const data = await getMasterCatalogRecord(kind, id);
      if (!data) {
        sendJson(res, 404, { ok: false, message: "Registro no encontrado" });
        return;
      }
      sendJson(res, 200, { ok: true, data });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "PUT" || req.method === "PATCH") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const body = await readJsonBody(req);
      const data = await updateMasterCatalogRecord(kind, id, body);
      sendJson(res, 200, {
        ok: true,
        data,
        message: "Registro maestro actualizado",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

async function handleContractSummary(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const user = guardView(req, res);
  if (!user) return;

  const contractId = parseId(url.pathname, "/admin/contractual/contracts/");
  if (!contractId) {
    sendJson(res, 400, { ok: false, message: "contract_id invalido" });
    return;
  }

  try {
    const data = await listContractConfigurationSummary(contractId);
    sendJson(res, 200, { ok: true, data });
  } catch (error) {
    sendJson(res, 400, { ok: false, message: error.message });
  }
}

async function handleContractPositionRules(req, res, url) {
  const contractId = parseId(url.pathname, "/admin/contractual/contracts/");
  if (!contractId) {
    sendJson(res, 400, { ok: false, message: "contract_id invalido" });
    return;
  }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;

    try {
      const data = await listContractPositionRules(contractId, buildPositionRuleFilters(url));
      sendJson(res, 200, { ok: true, data, total: data.length });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "POST") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const body = await readJsonBody(req);
      const data = await createContractPositionRule(contractId, body);
      sendJson(res, 201, {
        ok: true,
        data,
        message: "Regla contractual de cargo creada",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

async function handleContractPositionRuleById(req, res, url) {
  const id = parseId(url.pathname, "/admin/contractual/position-rules/");
  if (!id) {
    sendJson(res, 400, { ok: false, message: "ID de regla invalido" });
    return;
  }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;

    try {
      const data = await getContractPositionRuleById(id);
      if (!data) {
        sendJson(res, 404, { ok: false, message: "Regla no encontrada" });
        return;
      }
      sendJson(res, 200, { ok: true, data });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "PUT" || req.method === "PATCH") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const body = await readJsonBody(req);
      const data = await updateContractPositionRule(id, body);
      sendJson(res, 200, {
        ok: true,
        data,
        message: "Regla contractual de cargo actualizada",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "DELETE") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const data = await deactivateContractPositionRule(id);
      sendJson(res, 200, {
        ok: true,
        data,
        message: "Regla contractual de cargo inactivada",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

async function handleContractDocumentRules(req, res, url) {
  const contractId = parseId(url.pathname, "/admin/contractual/contracts/");
  if (!contractId) {
    sendJson(res, 400, { ok: false, message: "contract_id invalido" });
    return;
  }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;

    try {
      const data = await listContractDocumentRules(contractId, buildDocumentRuleFilters(url));
      sendJson(res, 200, { ok: true, data, total: data.length });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "POST") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const body = await readJsonBody(req);
      const data = await createContractDocumentRule(contractId, body);
      sendJson(res, 201, {
        ok: true,
        data,
        message: "Regla documental contractual creada",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

async function handleContractDocumentRuleById(req, res, url) {
  const id = parseId(url.pathname, "/admin/contractual/document-rules/");
  if (!id) {
    sendJson(res, 400, { ok: false, message: "ID de regla invalido" });
    return;
  }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;

    try {
      const data = await getContractDocumentRuleById(id);
      if (!data) {
        sendJson(res, 404, { ok: false, message: "Regla no encontrada" });
        return;
      }
      sendJson(res, 200, { ok: true, data });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "PUT" || req.method === "PATCH") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const body = await readJsonBody(req);
      const data = await updateContractDocumentRule(id, body);
      sendJson(res, 200, {
        ok: true,
        data,
        message: "Regla documental contractual actualizada",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "DELETE") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const data = await deactivateContractDocumentRule(id);
      sendJson(res, 200, {
        ok: true,
        data,
        message: "Regla documental contractual inactivada",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

async function handleContractExperienceRules(req, res, url) {
  const contractId = parseId(url.pathname, "/admin/contractual/contracts/");
  if (!contractId) {
    sendJson(res, 400, { ok: false, message: "contract_id invalido" });
    return;
  }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;

    try {
      const data = await listContractExperienceRules(contractId);
      sendJson(res, 200, { ok: true, data, total: data.length });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "POST") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const body = await readJsonBody(req);
      const data = await createContractExperienceRule(contractId, body);
      sendJson(res, 201, {
        ok: true,
        data,
        message: "Regla de experiencia creada",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

async function handleContractExperienceRuleById(req, res, url) {
  const id = parseId(url.pathname, "/admin/contractual/experience-rules/");
  if (!id) {
    sendJson(res, 400, { ok: false, message: "ID de regla invalido" });
    return;
  }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;

    try {
      const data = await getContractExperienceRuleById(id);
      if (!data) {
        sendJson(res, 404, { ok: false, message: "Regla no encontrada" });
        return;
      }
      sendJson(res, 200, { ok: true, data });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "PUT" || req.method === "PATCH") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const body = await readJsonBody(req);
      const data = await updateContractExperienceRule(id, body);
      sendJson(res, 200, {
        ok: true,
        data,
        message: "Regla de experiencia actualizada",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "DELETE") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const data = await deactivateContractExperienceRule(id);
      sendJson(res, 200, {
        ok: true,
        data,
        message: "Regla de experiencia inactivada",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

async function handleContractCoverageRules(req, res, url) {
  const contractId = parseId(url.pathname, "/admin/contractual/contracts/");
  if (!contractId) {
    sendJson(res, 400, { ok: false, message: "contract_id invalido" });
    return;
  }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;

    try {
      const data = await listContractCoverageRules(contractId);
      sendJson(res, 200, { ok: true, data, total: data.length });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "POST") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const body = await readJsonBody(req);
      const data = await createContractCoverageRule(contractId, body);
      sendJson(res, 201, {
        ok: true,
        data,
        message: "Regla de cobertura creada",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

async function handleContractCoverageRuleById(req, res, url) {
  const id = parseId(url.pathname, "/admin/contractual/coverage-rules/");
  if (!id) {
    sendJson(res, 400, { ok: false, message: "ID de regla invalido" });
    return;
  }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;

    try {
      const data = await getContractCoverageRuleById(id);
      if (!data) {
        sendJson(res, 404, { ok: false, message: "Regla no encontrada" });
        return;
      }
      sendJson(res, 200, { ok: true, data });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "PUT" || req.method === "PATCH") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const body = await readJsonBody(req);
      const data = await updateContractCoverageRule(id, body);
      sendJson(res, 200, {
        ok: true,
        data,
        message: "Regla de cobertura actualizada",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "DELETE") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const data = await deactivateContractCoverageRule(id);
      sendJson(res, 200, {
        ok: true,
        data,
        message: "Regla de cobertura inactivada",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

async function handleContractMunicipalities(req, res, url) {
  const contractId = parseId(url.pathname, "/admin/contractual/contracts/");
  if (!contractId) {
    sendJson(res, 400, { ok: false, message: "contract_id invalido" });
    return;
  }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;

    try {
      const data = await listContractMunicipalities(contractId);
      sendJson(res, 200, { ok: true, data, total: data.length });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "PUT" || req.method === "PATCH") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const body = await readJsonBody(req);
      const municipalityIds = Array.isArray(body)
        ? body
        : (body.municipalityIds || body.municipality_ids || []);
      const data = await replaceContractMunicipalities(contractId, municipalityIds);
      sendJson(res, 200, {
        ok: true,
        data,
        message: "Municipios del contrato actualizados",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

async function handleContractModalities(req, res, url) {
  const contractId = parseId(url.pathname, "/admin/contractual/contracts/");
  if (!contractId) {
    sendJson(res, 400, { ok: false, message: "contract_id invalido" });
    return;
  }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;

    try {
      const data = await listContractModalities(contractId);
      sendJson(res, 200, { ok: true, data, total: data.length });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "PUT" || req.method === "PATCH") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const body = await readJsonBody(req);
      const items = Array.isArray(body) ? body : (body.items || body.modalities || []);
      const data = await replaceContractModalities(contractId, items);
      sendJson(res, 200, {
        ok: true,
        data,
        message: "Modalidades del contrato actualizadas",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

async function handleEmployeeAssignments(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const user = guardView(req, res);
  if (!user) return;

  const employeeId = parseId(url.pathname, "/admin/contractual/employees/");
  if (!employeeId) {
    sendJson(res, 400, { ok: false, message: "employee_id invalido" });
    return;
  }

  try {
    const data = await listEmployeeAssignments(employeeId, buildAssignmentFilters(url));
    sendJson(res, 200, { ok: true, data, total: data.length });
  } catch (error) {
    sendJson(res, 400, { ok: false, message: error.message });
  }
}

async function handleEmployeeAssignmentHistory(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const user = guardView(req, res);
  if (!user) return;

  const employeeId = parseId(url.pathname, "/admin/contractual/employees/");
  if (!employeeId) {
    sendJson(res, 400, { ok: false, message: "employee_id invalido" });
    return;
  }

  try {
    const data = await listEmployeeAssignmentHistory(employeeId);
    sendJson(res, 200, { ok: true, data, total: data.length });
  } catch (error) {
    sendJson(res, 400, { ok: false, message: error.message });
  }
}

async function handleEmployeeDocumentCompliance(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const user = guardView(req, res);
  if (!user) return;

  const employeeId = parseId(url.pathname, "/admin/contractual/employees/");
  if (!employeeId) {
    sendJson(res, 400, { ok: false, message: "employee_id invalido" });
    return;
  }

  try {
    const data = await listEmployeeDocumentCompliance(employeeId);
    sendJson(res, 200, { ok: true, data, total: data.length });
  } catch (error) {
    sendJson(res, 400, { ok: false, message: error.message });
  }
}

async function handleEmployeeExperienceSummary(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const user = guardView(req, res);
  if (!user) return;

  const employeeId = parseId(url.pathname, "/admin/contractual/employees/");
  if (!employeeId) {
    sendJson(res, 400, { ok: false, message: "employee_id invalido" });
    return;
  }

  try {
    const data = await listEmployeeExperienceSummary(employeeId);
    sendJson(res, 200, {
      ok: true,
      data,
      total: Array.isArray(data.records) ? data.records.length : 0,
    });
  } catch (error) {
    sendJson(res, 400, { ok: false, message: error.message });
  }
}

async function handleEmployeeExperienceEvaluation(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const user = guardView(req, res);
  if (!user) return;

  const employeeId = parseId(url.pathname, "/admin/contractual/employees/");
  if (!employeeId) {
    sendJson(res, 400, { ok: false, message: "employee_id invalido" });
    return;
  }

  try {
    const data = await evaluateEmployeeExperience(employeeId);
    sendJson(res, 200, { ok: true, data, total: data.length });
  } catch (error) {
    sendJson(res, 400, { ok: false, message: error.message });
  }
}

async function handleEmployeeCoverageContext(req, res, url) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const user = guardView(req, res);
  if (!user) return;

  const employeeId = parseId(url.pathname, "/admin/contractual/employees/");
  if (!employeeId) {
    sendJson(res, 400, { ok: false, message: "employee_id invalido" });
    return;
  }

  try {
    const data = await getEmployeeCoverageContext(employeeId);
    sendJson(res, 200, { ok: true, data, total: data.length });
  } catch (error) {
    sendJson(res, 400, { ok: false, message: error.message });
  }
}

async function handleEmploymentCertificates(req, res, url) {
  const employeeId = parseId(url.pathname, "/admin/contractual/employees/");
  if (!employeeId) {
    sendJson(res, 400, { ok: false, message: "employee_id invalido" });
    return;
  }

  if (req.method === "GET") {
    const user = guardView(req, res);
    if (!user) return;

    try {
      const data = await listEmploymentCertificates(employeeId);
      sendJson(res, 200, { ok: true, data, total: data.length });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (req.method === "POST") {
    const user = guardAdmin(req, res);
    if (!user) return;

    try {
      const body = await readJsonBody(req);
      const data = await createEmploymentCertificate(employeeId, body, user.id);
      sendJson(res, 201, {
        ok: true,
        data,
        message: "Certificacion laboral generada",
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

module.exports = {
  handleContractualMeta,
  handleMasterCatalog,
  handleMasterCatalogById,
  handleContractSummary,
  handleContractPositionRules,
  handleContractPositionRuleById,
  handleContractDocumentRules,
  handleContractDocumentRuleById,
  handleContractExperienceRules,
  handleContractExperienceRuleById,
  handleContractCoverageRules,
  handleContractCoverageRuleById,
  handleContractMunicipalities,
  handleContractModalities,
  handleEmployeeAssignments,
  handleEmployeeAssignmentHistory,
  handleEmployeeDocumentCompliance,
  handleEmployeeExperienceSummary,
  handleEmployeeExperienceEvaluation,
  handleEmployeeCoverageContext,
  handleEmploymentCertificates,
};
