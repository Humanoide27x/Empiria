// ── Shared mutable state ──────────────────────────────────────────────────────

export const state = {
  token: localStorage.getItem("empiria_token") || "",
  currentUser: null,
  access: null,
  availableModules: [],
  availableActions: [],
  availableRoles: [],
  companies: [],
  contracts: [],
  users: [],
  activeModule: null,
  expandedModule: null,
  activeSubmodule: null,
  requiresMfa: false,
  tempUsername: "",
  tempPassword: "",
  personnelCreateTab: "identificacion",
  personnelDraft: {},
  personnelViewMode: "table",
  personnelEditingId: null,
  personnelSelectedId: null,
  personnelDocumentsEmployee: null,
  educationalCatalog: {},
  personnelPage: 1,
  personnelPageSize: 50,
  novedadDraft: {},
  novedadFilters: {},
  desprendibleDraft: {},
  certDraft: {},
  personnelFilters: {
    search: "", status: "", hvStatus: "", municipality: "",
    role: "", companyId: "", contractId: "",
    gestorZona: "", institution: "", site: "", modality: "", sort: "",
  },
  gestorFormOpen: false,
  nominaPeriod: "",
  nominaCalculated: false,
  // FASE 7 — Wizard de Períodos
  payrollPeriodId: null,
  payrollWizardStep: 1,
  payrollPeriodData: null,
  payrollCreateOpen: false,
  // Cargos y Perfiles
  posViewMode: "list",   // "list" | "detail" | "create"
  posSelectedId: null,
  posTab: "datos",       // "datos" | "perfil" | "nomina" | "documentos"
  posFilters: { companyId: "", contractId: "", area: "", status: "", search: "" },
  // Config module
  cfgClientSearch: "",
  cfgContractConfigId: null,
  coverageSelectedUploadId: null,
  coverageActiveTab: "cobertura",
  coverageFilters: {
    coverageSearch: "",
    coverageFilterMunicipality: "",
    coverageFilterModality: "",
    coverageFilterStatus: "",
    coverageFilterChange: "",
  },
};

// ── DOM element references ────────────────────────────────────────────────────

export const elements = {
  loginWrap:           document.getElementById("loginWrap"),
  loginForm:           document.getElementById("loginForm"),
  loginMessage:        document.getElementById("loginMessage"),
  dashboard:           document.getElementById("dashboard"),
  welcomeName:         document.getElementById("welcomeName"),
  welcomeRole:         document.getElementById("welcomeRole"),
  companyValue:        document.getElementById("companyValue"),
  contractValue:       document.getElementById("contractValue"),
  municipalityValue:   document.getElementById("municipalityValue"),
  logoutButton:        document.getElementById("logoutButton"),
  accessPanel:         document.getElementById("accessPanel"),
  accessForm:          document.getElementById("accessForm"),
  moduleSelect:        document.getElementById("moduleSelect"),
  actionSelect:        document.getElementById("actionSelect"),
  companyInput:        document.getElementById("companyInput"),
  contractInput:       document.getElementById("contractInput"),
  municipalityInput:   document.getElementById("municipalityInput"),
  accessResult:        document.getElementById("accessResult"),
  adminPanel:          document.getElementById("adminPanel"),
  refreshUsersButton:  document.getElementById("refreshUsersButton"),
  createUserForm:      document.getElementById("createUserForm"),
  createName:          document.getElementById("createName"),
  createUsername:      document.getElementById("createUsername"),
  createPassword:      document.getElementById("createPassword"),
  createRole:          document.getElementById("createRole"),
  createCompanyId:     document.getElementById("createCompanyId"),
  createContractId:    document.getElementById("createContractId"),
  createMunicipalities:document.getElementById("createMunicipalities"),
  adminCreateMessage:  document.getElementById("adminCreateMessage"),
  adminUsersList:      document.getElementById("adminUsersList"),
  adminCount:          document.getElementById("adminCount"),
  moduleNav:           document.getElementById("moduleNav"),
  workspace:           document.getElementById("workspace"),
  mfaFieldWrap:        document.getElementById("mfaFieldWrap"),
  mfaCode:             document.getElementById("mfaCode"),
  topUser:             document.getElementById("topUser"),
  topModuleName:       document.getElementById("topModuleName"),
  topModuleBreadcrumb: document.getElementById("topModuleBreadcrumb"),
  sbCompany:           document.getElementById("sbCompany"),
  sbContract:          document.getElementById("sbContract"),
  sbMunicipality:      document.getElementById("sbMunicipality"),
  bootScreen:          document.getElementById("bootScreen"),
};

// ── Module view configuration ─────────────────────────────────────────────────

export const moduleViews = {
  dashboard_hr: {
    title: "Dashboard",
    submodules: [],
  },
  gestion_personal: {
    title: "Gestión del Personal",
    submodules: [],
  },
  cobertura_calculadora: {
    title: "Verificación de Cobertura",
    submodules: [],
  },
  nomina_novedades: {
    title: "Nómina",
    submodules: [],
  },
  capacitaciones_asistencia: {
    title: "Capacitaciones y Asistencia",
    submodules: [
      { key: "programar_capacitacion", title: "Programar Capacitación" },
      { key: "registrar_asistencia",   title: "Registrar Asistencia" },
    ],
  },
  informes_reportes: {
    title: "Informes y Reportes",
    submodules: [
      { key: "reportes_personal",   title: "Reportes de Personal" },
      { key: "reportes_cobertura",  title: "Reportes de Cobertura" },
      { key: "exportar_datos",      title: "Exportar Datos" },
    ],
  },
  solicitudes_empleados: {
    title: "Solicitudes de Empleados",
    submodules: [
      { key: "nueva_solicitud",   title: "Nueva Solicitud" },
      { key: "estado_solicitudes", title: "Estado de Solicitudes" },
    ],
  },
  calculadora_personal: {
    title: "Calculadora",
    submodules: [],
  },
  administracion_configuraciones: {
    title: "Configuración",
    submodules: [],
  },
  seguridad_salud_trabajo: {
    title: "Seguridad y Salud en el Trabajo",
    submodules: [],
  },
  registro_novedades: {
    title: "Registro de Novedades",
    submodules: [],
  },
  repositorio_hojas_vida: {
    title: "Repositorio de Hojas de Vida",
    submodules: [],
  },
  gestion_dotacion: {
    title: "Dotación",
    submodules: [],
  },
};
