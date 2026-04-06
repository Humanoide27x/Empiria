const MODULES = Object.freeze({
  DASHBOARD: "dashboard",
  EMPLOYEE_MANAGEMENT: "gestion_personal",
  EMPLOYEE_FILES: "hoja_vida_documentos",
  CONTRACTS: "contratos_vinculacion",
  COVERAGE: "cobertura_calculadora",
  PAYROLL: "nomina_novedades",
  TRAINING: "capacitaciones_asistencia",
  REPORTS: "informes_reportes",
  EMPLOYEE_REQUESTS: "solicitudes_empleados",
  ADMIN_SETTINGS: "administracion_configuraciones",
});

const ACTIONS = Object.freeze({
  VIEW: "view",
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  UPLOAD: "upload",
  EXPORT: "export",
  REGISTER: "register",
  ATTENDANCE: "attendance",
  ORGANIZE: "organize",
  TRACE: "trace",
  FILTER: "filter",
  MANAGE: "manage",
  TEST: "test",
  AUDIT: "audit",
  BLOCK: "block",
  CONFIGURE: "configure",
});

const SCOPE_RULES = Object.freeze({
  ALL: "all",
  LINKED_COMPANY_AND_CONTRACT: "linked_company_and_contract",
  ASSIGNED_MUNICIPALITIES: "assigned_municipalities",
  ALL_COMPANIES: "all_companies",
});

const ROLES = Object.freeze({
  ADMINISTRATOR: "administrador",
  HUMAN_RESOURCES: "talento_humano",
  OPERATIONS: "operacion",
  QUALITY: "calidad",
  MANAGERS_AND_ASSISTANTS: "gestores_auxiliares",
  INTERNAL_AUDITORS: "auditores_internos",
  INTERVENTORIA: "interventoria",
});

const FULL_EMPLOYEE_FILE_FIELDS = Object.freeze([
  "hoja_de_vida",
  "cedula",
  "examenes_manipulacion_alimentos",
  "acta_entrega_dotacion",
  "documentos_contratacion",
  "formatos_afiliacion",
  "soportes",
]);

const LIMITED_EMPLOYEE_FILE_FIELDS = Object.freeze([
  "hoja_de_vida",
  "cedula",
  "examenes_manipulacion_alimentos",
  "acta_entrega_dotacion",
]);

const EMPLOYEE_MANAGEMENT_PERMISSIONS = Object.freeze({
  allowedActions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.UPDATE],
  features: Object.freeze([
    "crear_empleado",
    "editar_empleado",
    "consultar_empleado",
    "asignar_empresa",
    "asignar_contrato",
    "asignar_municipio",
    "cambiar_estado_empleado",
  ]),
});

const CONTRACTS_PERMISSIONS = Object.freeze({
  allowedActions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.UPDATE],
  features: Object.freeze([
    "crear_contrato",
    "editar_contrato",
    "finalizar_contrato",
    "registrar_prorroga",
    "consultar_historial_contractual",
    "gestionar_vinculacion",
  ]),
});

const COVERAGE_PERMISSIONS = Object.freeze({
  allowedActions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EXPORT],
  features: Object.freeze([
    "calculadora_caa",
    "calculadora_caares",
    "calculadora_ri",
    "verificacion_cobertura",
    "comparativo_requerido_vs_contratado",
    "analisis_por_municipio",
    "analisis_por_institucion",
    "analisis_por_sede",
  ]),
});

const PAYROLL_PERMISSIONS = Object.freeze({
  allowedActions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.REGISTER, ACTIONS.EXPORT],
  features: Object.freeze([
    "registrar_novedades_nomina",
    "verificacion_novedades_nomina",
    "consultar_novedades",
    "desprendibles_pago",
    "certificaciones_laborales",
  ]),
});

const TRAINING_PERMISSIONS = Object.freeze({
  allowedActions: [
    ACTIONS.VIEW,
    ACTIONS.CREATE,
    ACTIONS.ORGANIZE,
    ACTIONS.TRACE,
    ACTIONS.ATTENDANCE,
  ],
  features: Object.freeze([
    "crear_capacitacion",
    "organizar_capacitacion",
    "registrar_asistencia",
    "trazabilidad_asistencia",
    "evidencias_capacitacion",
  ]),
});

const REPORTS_PERMISSIONS = Object.freeze({
  allowedActions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EXPORT],
  features: Object.freeze([
    "reportes_personal",
    "reportes_cobertura",
    "reportes_documentales",
    "reportes_nomina",
    "exportar_listados_personal",
    "indicadores",
  ]),
});

const EMPLOYEE_REQUESTS_PERMISSIONS = Object.freeze({
  allowedActions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.UPDATE],
  features: Object.freeze([
    "solicitud_certificacion_laboral",
    "solicitud_desprendible_pago",
    "seguimiento_solicitud",
  ]),
});

const ADMIN_SETTINGS_PERMISSIONS = Object.freeze({
  allowedActions: [
    ACTIONS.VIEW,
    ACTIONS.CREATE,
    ACTIONS.UPDATE,
    ACTIONS.DELETE,
    ACTIONS.MANAGE,
    ACTIONS.TEST,
    ACTIONS.AUDIT,
    ACTIONS.BLOCK,
    ACTIONS.CONFIGURE,
  ],
  features: Object.freeze([
    "gestion_usuarios",
    "roles_permisos",
    "probar_acceso",
    "configuraciones_generales",
    "auditoria",
    "bloqueos",
    "reset_mfa",
  ]),
});

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.ADMINISTRATOR]: {
    scope: SCOPE_RULES.ALL,
    modules: {
      [MODULES.DASHBOARD]: { allowedActions: [ACTIONS.VIEW] },
      [MODULES.EMPLOYEE_MANAGEMENT]: EMPLOYEE_MANAGEMENT_PERMISSIONS,
      [MODULES.EMPLOYEE_FILES]: {
        allowedActions: [ACTIONS.VIEW, ACTIONS.UPLOAD, ACTIONS.EXPORT],
        fields: FULL_EMPLOYEE_FILE_FIELDS,
        features: Object.freeze([
          "ver_hoja_de_vida",
          "cargar_documentos",
          "validar_documentos",
          "documentos_pendientes",
          "descarga_documental",
        ]),
      },
      [MODULES.CONTRACTS]: CONTRACTS_PERMISSIONS,
      [MODULES.COVERAGE]: COVERAGE_PERMISSIONS,
      [MODULES.PAYROLL]: PAYROLL_PERMISSIONS,
      [MODULES.TRAINING]: TRAINING_PERMISSIONS,
      [MODULES.REPORTS]: REPORTS_PERMISSIONS,
      [MODULES.EMPLOYEE_REQUESTS]: EMPLOYEE_REQUESTS_PERMISSIONS,
      [MODULES.ADMIN_SETTINGS]: ADMIN_SETTINGS_PERMISSIONS,
    },
  },

  [ROLES.HUMAN_RESOURCES]: {
    scope: SCOPE_RULES.LINKED_COMPANY_AND_CONTRACT,
    modules: {
      [MODULES.DASHBOARD]: { allowedActions: [ACTIONS.VIEW] },
      [MODULES.EMPLOYEE_MANAGEMENT]: EMPLOYEE_MANAGEMENT_PERMISSIONS,
      [MODULES.EMPLOYEE_FILES]: {
        allowedActions: [ACTIONS.VIEW, ACTIONS.UPLOAD],
        fields: FULL_EMPLOYEE_FILE_FIELDS,
        features: Object.freeze([
          "ver_hoja_de_vida",
          "cargar_documentos",
          "validar_documentos",
          "documentos_pendientes",
        ]),
      },
      [MODULES.CONTRACTS]: CONTRACTS_PERMISSIONS,
      [MODULES.COVERAGE]: {
        allowedActions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EXPORT],
        features: Object.freeze([
          "calculadora_caa",
          "calculadora_caares",
          "calculadora_ri",
          "verificacion_cobertura",
          "comparativo_requerido_vs_contratado",
        ]),
      },
      [MODULES.PAYROLL]: PAYROLL_PERMISSIONS,
      [MODULES.REPORTS]: {
        allowedActions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EXPORT],
        features: Object.freeze([
          "reportes_personal",
          "reportes_documentales",
          "reportes_nomina",
          "indicadores",
        ]),
      },
      [MODULES.EMPLOYEE_REQUESTS]: EMPLOYEE_REQUESTS_PERMISSIONS,
    },
  },

  [ROLES.OPERATIONS]: {
    scope: SCOPE_RULES.LINKED_COMPANY_AND_CONTRACT,
    modules: {
      [MODULES.DASHBOARD]: { allowedActions: [ACTIONS.VIEW] },
      [MODULES.EMPLOYEE_FILES]: {
        allowedActions: [ACTIONS.VIEW],
        fields: LIMITED_EMPLOYEE_FILE_FIELDS,
        features: Object.freeze([
          "ver_hoja_de_vida",
          "consultar_documentos_operativos",
        ]),
      },
      [MODULES.COVERAGE]: {
        allowedActions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EXPORT],
        features: Object.freeze([
          "calculadora_caa",
          "calculadora_caares",
          "calculadora_ri",
          "verificacion_cobertura",
          "comparativo_requerido_vs_contratado",
          "analisis_por_municipio",
          "analisis_por_institucion",
          "analisis_por_sede",
        ]),
      },
      [MODULES.REPORTS]: {
        allowedActions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EXPORT],
        features: Object.freeze([
          "reportes_cobertura",
          "exportar_listados_personal",
          "20_por_ciento_madres_cabeza_familia",
          "cambio_personal_carta_solicitud",
          "cambio_personal_pdf_hoja_vida",
        ]),
      },
    },
  },

  [ROLES.QUALITY]: {
    scope: SCOPE_RULES.LINKED_COMPANY_AND_CONTRACT,
    modules: {
      [MODULES.DASHBOARD]: { allowedActions: [ACTIONS.VIEW] },
      [MODULES.EMPLOYEE_FILES]: {
        allowedActions: [ACTIONS.VIEW],
        fields: LIMITED_EMPLOYEE_FILE_FIELDS,
        features: Object.freeze([
          "ver_hoja_de_vida",
          "consultar_documentos_operativos",
        ]),
      },
      [MODULES.COVERAGE]: {
        allowedActions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EXPORT],
        features: Object.freeze([
          "calculadora_caa",
          "calculadora_caares",
          "calculadora_ri",
          "verificacion_cobertura",
        ]),
      },
      [MODULES.TRAINING]: TRAINING_PERMISSIONS,
      [MODULES.REPORTS]: {
        allowedActions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EXPORT],
        features: Object.freeze([
          "reportes_cobertura",
          "reportes_capacitaciones",
          "indicadores",
        ]),
      },
    },
  },

  [ROLES.MANAGERS_AND_ASSISTANTS]: {
    scope: SCOPE_RULES.ASSIGNED_MUNICIPALITIES,
    linkedScope: SCOPE_RULES.LINKED_COMPANY_AND_CONTRACT,
    modules: {
      [MODULES.DASHBOARD]: { allowedActions: [ACTIONS.VIEW] },
      [MODULES.COVERAGE]: {
        allowedActions: [ACTIONS.VIEW, ACTIONS.CREATE],
        features: Object.freeze([
          "calculadora_caa",
          "calculadora_caares",
          "calculadora_ri",
          "verificacion_cobertura",
          "analisis_por_municipio",
        ]),
      },
      [MODULES.EMPLOYEE_FILES]: {
        allowedActions: [ACTIONS.VIEW],
        fields: LIMITED_EMPLOYEE_FILE_FIELDS,
        features: Object.freeze([
          "ver_hoja_de_vida",
          "consultar_documentos_operativos",
        ]),
      },
      [MODULES.PAYROLL]: {
        allowedActions: [ACTIONS.VIEW, ACTIONS.REGISTER],
        requiresSupportDocuments: true,
        features: Object.freeze([
          "registrar_novedades_nomina",
          "consultar_novedades",
        ]),
      },
      [MODULES.TRAINING]: {
        allowedActions: [ACTIONS.VIEW, ACTIONS.TRACE, ACTIONS.ATTENDANCE],
        features: Object.freeze([
          "registrar_asistencia",
          "trazabilidad_asistencia",
        ]),
      },
    },
  },

  [ROLES.INTERNAL_AUDITORS]: {
    scope: SCOPE_RULES.ALL_COMPANIES,
    modules: {
      [MODULES.DASHBOARD]: { allowedActions: [ACTIONS.VIEW] },
      [MODULES.EMPLOYEE_FILES]: {
        allowedActions: [ACTIONS.VIEW],
        fields: FULL_EMPLOYEE_FILE_FIELDS,
        unrestricted: true,
        features: Object.freeze([
          "ver_hoja_de_vida",
          "consulta_auditoria_documental",
        ]),
      },
      [MODULES.REPORTS]: {
        allowedActions: [ACTIONS.VIEW, ACTIONS.EXPORT],
        features: Object.freeze([
          "reportes_personal",
          "reportes_cobertura",
          "reportes_documentales",
          "reportes_nomina",
        ]),
      },
    },
  },

  [ROLES.INTERVENTORIA]: {
    scope: SCOPE_RULES.LINKED_COMPANY_AND_CONTRACT,
    modules: {
      [MODULES.DASHBOARD]: { allowedActions: [ACTIONS.VIEW] },
      [MODULES.EMPLOYEE_FILES]: {
        allowedActions: [ACTIONS.VIEW, ACTIONS.FILTER],
        fields: LIMITED_EMPLOYEE_FILE_FIELDS,
        filters: Object.freeze(["sede", "institucion", "modalidad"]),
        features: Object.freeze([
          "ver_hoja_de_vida",
          "filtrar_documentos_operativos",
        ]),
      },
      [MODULES.COVERAGE]: {
        allowedActions: [ACTIONS.VIEW],
        features: Object.freeze([
          "verificacion_cobertura",
          "comparativo_requerido_vs_contratado",
        ]),
      },
      [MODULES.REPORTS]: {
        allowedActions: [ACTIONS.VIEW, ACTIONS.EXPORT],
        features: Object.freeze([
          "reportes_cobertura",
          "exportar_listados_personal",
        ]),
      },
    },
  },
});

function normalizeRole(role) {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

function getRolePermissions(role) {
  return ROLE_PERMISSIONS[normalizeRole(role)] || null;
}

function canAccessModule(role, moduleKey, action = ACTIONS.VIEW) {
  const roleConfig = getRolePermissions(role);

  if (!roleConfig) {
    return false;
  }

  const moduleConfig = roleConfig.modules[moduleKey];
  return Boolean(moduleConfig && moduleConfig.allowedActions.includes(action));
}

function getAccessibleModules(role) {
  const roleConfig = getRolePermissions(role);

  if (!roleConfig) {
    return [];
  }

  return Object.entries(roleConfig.modules).map(([moduleKey, moduleConfig]) => ({
    module: moduleKey,
    allowedActions: moduleConfig.allowedActions,
    features: moduleConfig.features || [],
    fields: moduleConfig.fields || [],
    filters: moduleConfig.filters || [],
    requiresSupportDocuments: Boolean(moduleConfig.requiresSupportDocuments),
    unrestricted: Boolean(moduleConfig.unrestricted),
  }));
}

module.exports = {
  ACTIONS,
  MODULES,
  ROLES,
  ROLE_PERMISSIONS,
  SCOPE_RULES,
  canAccessModule,
  getAccessibleModules,
  getRolePermissions,
  normalizeRole,
};