const {
  ACTIONS,
  ROLE_PERMISSIONS,
  canAccessModule,
  getAccessibleModules,
  getRolePermissions,
} = require("./permissions");

function matchesLinkedScope(user, resource) {
  if (!resource) {
    return true;
  }

  return (
    user.companyId === resource.companyId && user.contractId === resource.contractId
  );
}

function matchesAssignedMunicipalities(user, resource) {
  if (!resource || !resource.municipality) {
    return true;
  }

  return user.assignedMunicipalities.includes(resource.municipality);
}

function evaluateScope(user, resource) {
  const roleConfig = getRolePermissions(user.role);

  if (!roleConfig) {
    return {
      allowed: false,
      reason: "Rol no configurado",
    };
  }

  if (roleConfig.scope === "all" || roleConfig.scope === "all_companies") {
    return { allowed: true, reason: "Acceso sin restriccion de empresa o contrato" };
  }

  if (roleConfig.scope === "linked_company_and_contract") {
    return {
      allowed: matchesLinkedScope(user, resource),
      reason: "Acceso restringido a empresa y contrato vinculados",
    };
  }

  if (roleConfig.scope === "assigned_municipalities") {
    const linkedOk = matchesLinkedScope(user, resource);
    const municipalityOk = matchesAssignedMunicipalities(user, resource);

    return {
      allowed: linkedOk && municipalityOk,
      reason: "Acceso restringido por empresa, contrato y municipios asignados",
    };
  }

  return {
    allowed: false,
    reason: "Scope no soportado",
  };
}

function matchesUserScope(user, resource) {
  return evaluateScope(user, resource).allowed;
}

function describeUserAccess(user) {
  const roleConfig = getRolePermissions(user.role);

  return {
    role: user.role,
    scope: roleConfig ? roleConfig.scope : null,
    linkedScope: roleConfig ? roleConfig.linkedScope || null : null,
    modules: getAccessibleModules(user.role),
  };
}

function evaluateModuleAccess(user, moduleKey, action = ACTIONS.VIEW, resource = null) {
  const hasModulePermission = canAccessModule(user.role, moduleKey, action);

  if (!hasModulePermission) {
    return {
      allowed: false,
      reason: "El rol no tiene permiso sobre este modulo o accion",
    };
  }

  return evaluateScope(user, resource);
}

module.exports = {
  describeUserAccess,
  evaluateModuleAccess,
  evaluateScope,
  matchesUserScope,
  ROLE_PERMISSIONS,
};
