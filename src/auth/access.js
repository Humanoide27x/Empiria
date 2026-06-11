const {
  ACTIONS,
  MODULES,
  ROLES,
  SCOPE_RULES,
  getRolePermissions,
  getAccessibleModules,
  normalizeRole,
} = require("./permissions");

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMunicipality(value) {
  return safeString(value).toLowerCase();
}

function normalizeModuleKey(moduleKey) {
  return safeString(moduleKey);
}

function getModuleConfig(roleConfig, moduleKey) {
  if (!roleConfig || !roleConfig.modules) {
    return null;
  }

  return roleConfig.modules[moduleKey] || null;
}

function matchesLinkedCompanyAndContract(user, resource = {}) {
  if (!user) return false;

  const userCompanyId = user.companyId ?? null;
  const userContractId = user.contractId ?? null;

  const resourceCompanyId = resource.companyId ?? null;
  const resourceContractId = resource.contractId ?? null;

  const companyMatches =
    resourceCompanyId == null
      ? true
      : Number(userCompanyId) === Number(resourceCompanyId);

  const contractMatches =
    resourceContractId == null
      ? true
      : Number(userContractId) === Number(resourceContractId);

  return companyMatches && contractMatches;
}

function matchesAssignedMunicipalities(user, resource = {}) {
  if (!user) return false;

  const assignedNames = Array.isArray(user.assignedMunicipalities)
    ? user.assignedMunicipalities.map(normalizeMunicipality).filter(Boolean)
    : Array.isArray(user.municipality_names)
      ? user.municipality_names.map(normalizeMunicipality).filter(Boolean)
      : [];

  const assignedIds = Array.isArray(user.municipality_ids)
    ? user.municipality_ids.map(Number).filter(n => n > 0)
    : [];

  // No municipality restrictions — access is open within the linked scope
  if (!assignedNames.length && !assignedIds.length) return true;

  // No municipality was specified in the resource — allow (endpoint will filter via municipalityIds)
  const resourceMunicipality = normalizeMunicipality(resource.municipality);
  const resourceMunId        = resource.municipalityId ? Number(resource.municipalityId) : null;

  if (!resourceMunicipality && !resourceMunId) return true;

  // Name-based check
  if (resourceMunicipality && assignedNames.includes(resourceMunicipality)) return true;

  // ID-based check (more reliable)
  if (resourceMunId && assignedIds.includes(resourceMunId)) return true;

  // If only one type of identifier is present, fall back to allowing when the other matches
  if (resourceMunicipality && !assignedNames.length && assignedIds.length) return true;
  if (resourceMunId && !assignedIds.length && assignedNames.length) return true;

  return false;
}

function matchesUserScope(user, resource = {}) {
  const normalizedRole = normalizeRole(user?.role);
  const roleConfig = getRolePermissions(normalizedRole);

  if (!roleConfig) {
    return false;
  }

  switch (roleConfig.scope) {
    case SCOPE_RULES.ALL:
      return true;

    case SCOPE_RULES.ALL_COMPANIES:
      return true;

    case SCOPE_RULES.LINKED_COMPANY_AND_CONTRACT:
      return matchesLinkedCompanyAndContract(user, resource);

    case SCOPE_RULES.ASSIGNED_MUNICIPALITIES: {
      const linkedScopeOk = roleConfig.linkedScope
        ? roleConfig.linkedScope === SCOPE_RULES.LINKED_COMPANY_AND_CONTRACT
          ? matchesLinkedCompanyAndContract(user, resource)
          : true
        : true;

      return linkedScopeOk && matchesAssignedMunicipalities(user, resource);
    }

    default:
      return false;
  }
}

function evaluateModuleAccess(
  user,
  moduleKey,
  action = ACTIONS.VIEW,
  resource = null
) {
  try {
    if (!user || !user.role) {
      return {
        allowed: false,
        reason: "Debes iniciar sesión",
      };
    }

    const normalizedRole = normalizeRole(user.role);
    const roleConfig = getRolePermissions(normalizedRole);

    if (!roleConfig) {
      return {
        allowed: false,
        reason: "El rol no tiene configuración de permisos",
      };
    }

    const resolvedModuleKey = normalizeModuleKey(moduleKey);

    if (!resolvedModuleKey) {
      return {
        allowed: false,
        reason: "No se indicó el módulo a validar",
      };
    }

    const moduleConfig = getModuleConfig(roleConfig, resolvedModuleKey);

    if (!moduleConfig) {
      return {
        allowed: false,
        reason: "El rol no tiene permiso sobre este módulo",
      };
    }

    const resolvedAction = (safeString(action) || ACTIONS.VIEW).toLowerCase();
    const allowedActions = Array.isArray(moduleConfig.allowedActions)
      ? moduleConfig.allowedActions.map((item) => safeString(item).toLowerCase())
      : [];

    if (!allowedActions.includes(resolvedAction)) {
      return {
        allowed: false,
        reason: "El rol no tiene permiso sobre esta acción",
      };
    }

    const scopeOk = matchesUserScope(user, resource || {});

    if (!scopeOk) {
      return {
        allowed: false,
        reason: "El recurso está fuera del alcance del usuario",
      };
    }

    return {
      allowed: true,
      reason: "Acceso permitido",
    };
  } catch (error) {
    console.error("Error evaluando permisos:", error);

    return {
      allowed: false,
      reason: "Error interno validando permisos",
    };
  }
}

function describeUserAccess(user) {
  try {
    const normalizedRole = normalizeRole(user?.role);
    const roleConfig = getRolePermissions(normalizedRole);

    if (!roleConfig) {
      return {
        role: normalizedRole,
        scope: null,
        linkedScope: null,
        modules: [],
      };
    }

    return {
      role: normalizedRole,
      scope: roleConfig.scope || null,
      linkedScope: roleConfig.linkedScope || null,
      modules: getAccessibleModules(normalizedRole),
    };
  } catch (error) {
    console.error("Error describiendo acceso:", error);

    return {
      role: normalizeRole(user?.role),
      scope: null,
      linkedScope: null,
      modules: [],
    };
  }
}

module.exports = {
  evaluateModuleAccess,
  matchesUserScope,
  describeUserAccess,
};