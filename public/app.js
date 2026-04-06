const state = {
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
};

const elements = {
  loginWrap: document.getElementById("loginWrap"),
  loginForm: document.getElementById("loginForm"),
  loginMessage: document.getElementById("loginMessage"),
  dashboard: document.getElementById("dashboard"),
  welcomeName: document.getElementById("welcomeName"),
  welcomeRole: document.getElementById("welcomeRole"),
  companyValue: document.getElementById("companyValue"),
  contractValue: document.getElementById("contractValue"),
  municipalityValue: document.getElementById("municipalityValue"),
  logoutButton: document.getElementById("logoutButton"),
  accessPanel: document.getElementById("accessPanel"),
  accessForm: document.getElementById("accessForm"),
  moduleSelect: document.getElementById("moduleSelect"),
  actionSelect: document.getElementById("actionSelect"),
  companyInput: document.getElementById("companyInput"),
  contractInput: document.getElementById("contractInput"),
  municipalityInput: document.getElementById("municipalityInput"),
  accessResult: document.getElementById("accessResult"),
  adminPanel: document.getElementById("adminPanel"),
  refreshUsersButton: document.getElementById("refreshUsersButton"),
  createUserForm: document.getElementById("createUserForm"),
  createName: document.getElementById("createName"),
  createUsername: document.getElementById("createUsername"),
  createPassword: document.getElementById("createPassword"),
  createRole: document.getElementById("createRole"),
  createCompanyId: document.getElementById("createCompanyId"),
  createContractId: document.getElementById("createContractId"),
  createMunicipalities: document.getElementById("createMunicipalities"),
  adminCreateMessage: document.getElementById("adminCreateMessage"),
  adminUsersList: document.getElementById("adminUsersList"),
  adminCount: document.getElementById("adminCount"),
  moduleNav: document.getElementById("moduleNav"),
  workspace: document.getElementById("workspace"),
  mfaFieldWrap: document.getElementById("mfaFieldWrap"),
  mfaCode: document.getElementById("mfaCode"),
  topUser: document.getElementById("topUser"),
  topCompany: document.getElementById("topCompany"),
  topContract: document.getElementById("topContract"),
  topMunicipality: document.getElementById("topMunicipality"),
};

const moduleViews = {
  dashboard: {
    title: "Dashboard",
    route: "/dashboard-summary",
    submodules: [{ key: "resumen_general", title: "Resumen general" }],
  },

  gestion_personal: {
    title: "Gestión del Personal",
    route: "/personnel",
    submodules: [
      { key: "crear_empleado", title: "Crear empleado" },
      { key: "editar_empleado", title: "Editar empleado" },
      { key: "consultar_empleados", title: "Consultar empleados" },
      { key: "cambiar_estado", title: "Cambiar estado" },
    ],
  },

  hoja_vida_documentos: {
    title: "Hoja de Vida y Documentos",
    route: "/resume-view",
    submodules: [
      { key: "ver_hoja_vida", title: "Ver hoja de vida" },
      { key: "cargar_documentos", title: "Cargar documentos" },
      { key: "documentos_pendientes", title: "Documentos pendientes" },
      { key: "historial_documental", title: "Historial documental" },
    ],
  },

  contratos_vinculacion: {
    title: "Contratos y Vinculación",
    route: null,
    submodules: [
      { key: "crear_contrato", title: "Crear contrato" },
      { key: "prorrogas", title: "Prórrogas" },
      { key: "finalizacion", title: "Finalización" },
      { key: "historial_contractual", title: "Historial contractual" },
    ],
  },

  cobertura_calculadora: {
    title: "Cobertura y Calculadora de Personal",
    route: "/coverage",
    submodules: [
      { key: "calculadora_personal", title: "Calculadora de personal" },
      { key: "verificacion_cobertura", title: "Verificación de cobertura" },
      { key: "analisis_municipio", title: "Análisis por municipio" },
      { key: "analisis_sede", title: "Análisis por sede" },
    ],
  },

  nomina_novedades: {
    title: "Nómina y Novedades",
    route: "/payroll-changes",
    routeMethod: "POST",
    submodules: [
      { key: "registrar_novedad", title: "Registrar novedad" },
      { key: "consultar_novedades", title: "Consultar novedades" },
      { key: "desprendibles", title: "Desprendibles" },
      { key: "certificaciones", title: "Certificaciones" },
    ],
  },

  capacitaciones_asistencia: {
    title: "Capacitaciones y Asistencia",
    route: "/trainings",
    submodules: [
      { key: "programar_capacitacion", title: "Programar capacitación" },
      { key: "registrar_asistencia", title: "Registrar asistencia" },
      { key: "evidencias", title: "Evidencias" },
      { key: "historial_capacitaciones", title: "Historial" },
    ],
  },

  informes_reportes: {
    title: "Informes y Reportes",
    route: "/reports",
    submodules: [
      { key: "reportes_personal", title: "Reportes de personal" },
      { key: "reportes_cobertura", title: "Reportes de cobertura" },
      { key: "reportes_nomina", title: "Reportes de nómina" },
      { key: "exportaciones", title: "Exportaciones" },
    ],
  },

  solicitudes_empleados: {
    title: "Solicitudes de Empleados",
    route: null,
    submodules: [
      { key: "solicitar_certificacion", title: "Solicitar certificación laboral" },
      { key: "solicitar_desprendible", title: "Solicitar desprendible de pago" },
      { key: "estado_solicitudes", title: "Estado de solicitudes" },
    ],
  },

  administracion_configuraciones: {
    title: "Administración y Configuraciones",
    route: "/users",
    submodules: [
      { key: "gestion_usuarios", title: "Gestión de usuarios" },
      { key: "roles_permisos", title: "Roles y permisos" },
      { key: "probar_acceso", title: "Probar acceso" },
      { key: "auditoria", title: "Auditoría" },
      { key: "bloqueos", title: "Bloqueos" },
    ],
  },
};

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { message: "Respuesta inválida del servidor" };
  }

  if (!response.ok) {
    throw new Error(payload.message || "Ocurrió un error");
  }

  return payload;
}

function prettyLabel(text) {
  return String(text || "").replaceAll("_", " ");
}

function iconSvg(pathMarkup) {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      ${pathMarkup}
    </svg>
  `;
}

function getModuleMeta(moduleKey) {
  const moduleMap = {
    dashboard: {
      label: "Dashboard",
      icon: iconSvg(`
        <line x1="5" y1="20" x2="19" y2="20"></line>
        <rect x="6" y="11" width="2.8" height="7" rx="1"></rect>
        <rect x="10.6" y="8" width="2.8" height="10" rx="1"></rect>
        <rect x="15.2" y="5" width="2.8" height="13" rx="1"></rect>
      `),
    },
    gestion_personal: {
      label: "Gestión del Personal",
      icon: iconSvg(`
        <circle cx="9" cy="8" r="2.5"></circle>
        <path d="M4.8 17.2c.7-2.1 2.4-3.2 4.2-3.2s3.5 1.1 4.2 3.2"></path>
        <circle cx="16.5" cy="9.2" r="2"></circle>
        <path d="M14.7 16.8c.4-1.3 1.4-2.1 2.8-2.1 1.3 0 2.4.8 2.9 2.1"></path>
      `),
    },
    hoja_vida_documentos: {
      label: "Hoja de Vida y Documentos",
      icon: iconSvg(`
        <path d="M8 3.5h6l3 3V19a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19V5A1.5 1.5 0 0 1 8.5 3.5z"></path>
        <path d="M14 3.5V7h3"></path>
        <line x1="9.5" y1="10.5" x2="14.5" y2="10.5"></line>
        <line x1="9.5" y1="13.5" x2="14.5" y2="13.5"></line>
      `),
    },
    contratos_vinculacion: {
      label: "Contratos y Vinculación",
      icon: iconSvg(`
        <path d="M7.5 4.5h7l3 3V18a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6.5 18V6A1.5 1.5 0 0 1 8 4.5z"></path>
        <path d="M14.5 4.5V8h3"></path>
        <path d="M9 12h6"></path>
        <path d="M9 15h4"></path>
      `),
    },
    cobertura_calculadora: {
      label: "Cobertura y Calculadora de Personal",
      icon: iconSvg(`
        <path d="M5.5 18.5h13"></path>
        <path d="M7.5 16V11"></path>
        <path d="M12 16V7"></path>
        <path d="M16.5 16V9"></path>
      `),
    },
    nomina_novedades: {
      label: "Nómina y Novedades",
      icon: iconSvg(`
        <rect x="5.5" y="6" width="13" height="12" rx="2"></rect>
        <path d="M9 10.2c.4-.8 1.2-1.2 2.1-1.2 1.1 0 1.9.5 1.9 1.4 0 2-3.3 1.3-3.3 3.1 0 .9.8 1.5 2.1 1.5 1 0 1.9-.4 2.5-1.1"></path>
      `),
    },
    capacitaciones_asistencia: {
      label: "Capacitaciones y Asistencia",
      icon: iconSvg(`
        <path d="M4.5 8.5L12 5l7.5 3.5L12 12z"></path>
        <path d="M7 10.5V14.5c0 .9 2.2 2 5 2s5-1.1 5-2v-4"></path>
      `),
    },
    informes_reportes: {
      label: "Informes y Reportes",
      icon: iconSvg(`
        <path d="M7.5 4.5h7l3 3V19a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6.5 19V6A1.5 1.5 0 0 1 8 4.5z"></path>
        <path d="M14.5 4.5V8h3"></path>
        <polyline points="9,15 11,13 13,14 15.5,11.5"></polyline>
      `),
    },
    solicitudes_empleados: {
      label: "Solicitudes de Empleados",
      icon: iconSvg(`
        <rect x="4.5" y="6.5" width="15" height="11" rx="2"></rect>
        <path d="M6 8l6 4 6-4"></path>
      `),
    },
    administracion_configuraciones: {
      label: "Administración y Configuraciones",
      icon: iconSvg(`
        <circle cx="12" cy="12" r="2.4"></circle>
        <path d="M12 5.5v1.3"></path>
        <path d="M12 17.2v1.3"></path>
        <path d="M18.5 12h-1.3"></path>
        <path d="M6.8 12H5.5"></path>
        <path d="M16.6 7.4l-.9.9"></path>
        <path d="M8.3 15.7l-.9.9"></path>
        <path d="M16.6 16.6l-.9-.9"></path>
        <path d="M8.3 8.3l-.9-.9"></path>
      `),
    },
  };

  return moduleMap[moduleKey] || {
    label: prettyLabel(moduleKey),
    icon: iconSvg(`<circle cx="12" cy="12" r="3"></circle>`),
  };
}

function showLoginMessage(message, isError = true) {
  if (!elements.loginMessage) return;
  elements.loginMessage.textContent = message;
  elements.loginMessage.style.color = isError ? "#9d2f2f" : "#0d6b5b";
}

function showAdminCreateMessage(message, isError = true) {
  if (!elements.adminCreateMessage) return;
  elements.adminCreateMessage.textContent = message;
  elements.adminCreateMessage.style.color = isError ? "#9d2f2f" : "#0d6b5b";
}

function fillSelect(select, values) {
  if (!select) return;
  select.innerHTML = values
    .map((value) => `<option value="${value}">${prettyLabel(value)}</option>`)
    .join("");
}

function fillOptionSelect(select, items, { valueKey, labelBuilder, includeEmpty }) {
  if (!select) return;

  const emptyOption = includeEmpty ? '<option value="">Sin asignar</option>' : "";

  select.innerHTML =
    emptyOption +
    items
      .map((item) => `<option value="${item[valueKey]}">${labelBuilder(item)}</option>`)
      .join("");
}

function toMunicipalityArray(text) {
  return String(text || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatCompany(companyId) {
  if (companyId === null || companyId === undefined) {
    return "Sin asignar";
  }

  const found = state.companies.find((item) => item.id === Number(companyId));
  return found ? `${found.name} (${found.id})` : String(companyId);
}

function formatContract(contractId) {
  if (contractId === null || contractId === undefined) {
    return "Sin asignar";
  }

  const found = state.contracts.find((item) => item.id === Number(contractId));
  return found ? `${found.name} (${found.id})` : String(contractId);
}

function ensureMfaField() {
  if (!elements.mfaFieldWrap || !elements.mfaCode) return;
}

function showMfaField(show = true) {
  ensureMfaField();

  if (!elements.mfaFieldWrap) return;
  elements.mfaFieldWrap.classList.toggle("hidden", !show);

  if (show && elements.mfaCode) {
    elements.mfaCode.focus();
  }
}

function resetMfaState() {
  state.requiresMfa = false;
  state.tempUsername = "";
  state.tempPassword = "";

  if (elements.mfaCode) {
    elements.mfaCode.value = "";
  }

  showMfaField(false);
}

function renderModuleNav(modules = []) {
  if (!elements.moduleNav) {
    return;
  }

  if (!Array.isArray(modules) || !modules.length) {
    elements.moduleNav.innerHTML = `
      <div class="nav-empty">
        No hay módulos disponibles para este usuario.
      </div>
    `;
    return;
  }

  elements.moduleNav.innerHTML = modules
    .map((item) => {
      const moduleKey = item.module;
      const meta = getModuleMeta(moduleKey);
      const isActive = state.activeModule === moduleKey;
      const isExpanded = state.expandedModule === moduleKey;
      const view = moduleViews[moduleKey];
      const submodules = view?.submodules || [];

      return `
        <div class="module-group">
          <button
            type="button"
            class="module-nav-item ${isActive ? "active" : ""}"
            data-module="${moduleKey}"
            aria-expanded="${isExpanded ? "true" : "false"}"
          >
            <span class="module-nav-inline">
              <span class="module-nav-icon">${meta.icon}</span>
              <span class="module-nav-title">${meta.label}</span>
            </span>
            <span class="module-nav-caret ${isExpanded ? "open" : ""}">⌄</span>
          </button>

          ${
            isExpanded && submodules.length
              ? `
                <div class="submodule-list">
                  ${submodules
                    .map(
                      (submodule) => `
                        <button
                          type="button"
                          class="submodule-nav-item ${state.activeSubmodule === submodule.key ? "active" : ""}"
                          data-module="${moduleKey}"
                          data-submodule="${submodule.key}"
                        >
                          <span class="submodule-dot"></span>
                          <span class="submodule-label">${submodule.title}</span>
                        </button>
                      `
                    )
                    .join("")}
                </div>
              `
              : ""
          }
        </div>
      `;
    })
    .join("");

  const moduleButtons = elements.moduleNav.querySelectorAll(".module-nav-item[data-module]");
  moduleButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const moduleKey = button.dataset.module;
      const isSameExpanded = state.expandedModule === moduleKey;

      if (isSameExpanded) {
        state.expandedModule = null;
        if (state.activeModule === moduleKey) {
          state.activeModule = null;
          state.activeSubmodule = null;
          renderModuleNav(modules);
          renderEmptyWorkspace();
          syncAdminPanelsVisibility();
          return;
        }
      } else {
        state.expandedModule = moduleKey;
        state.activeModule = moduleKey;
        state.activeSubmodule = null;
      }

      renderModuleNav(modules);
      await openModule(moduleKey);
    });
  });

  const submoduleButtons = elements.moduleNav.querySelectorAll(".submodule-nav-item[data-submodule]");
  submoduleButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const moduleKey = button.dataset.module;
      const submoduleKey = button.dataset.submodule;

      state.expandedModule = moduleKey;
      state.activeModule = moduleKey;
      state.activeSubmodule = submoduleKey;

      renderModuleNav(modules);
      await openModule(moduleKey);
    });
  });
}

function renderEmptyWorkspace() {
  if (!elements.workspace) return;

  elements.workspace.innerHTML = `
    <div class="workspace-empty">
      <div>
        <h3>Selecciona un módulo del menú izquierdo</h3>
        <p class="subtitle">Al abrir un módulo verás sus acciones disponibles.</p>
      </div>
    </div>
  `;
}

async function loadDashboardModule() {
  const payload = await apiFetch("/dashboard-summary");
  const stats = payload.summary;

  return `
    <div class="dashboard-stats">
      <article class="info-card">
        <h3>Total personal</h3>
        <p>${stats.totalPersonnel}</p>
      </article>
      <article class="info-card">
        <h3>Activos</h3>
        <p>${stats.activePersonnel}</p>
      </article>
      <article class="info-card">
        <h3>Con novedad</h3>
        <p>${stats.noveltyPersonnel}</p>
      </article>
      <article class="info-card">
        <h3>Municipios visibles</h3>
        <p>${stats.visibleMunicipalities}</p>
      </article>
    </div>

    <article class="info-card">
      <h3>Personal reciente visible</h3>
      ${
        payload.recentPersonnel.length
          ? payload.recentPersonnel
              .map(
                (item) => `
                  <div class="personnel-item">
                    <strong>${item.fullName}</strong>
                    <p>${item.position}</p>
                    <p>${item.municipality} | ${item.status}</p>
                  </div>
                `
              )
              .join("")
          : "<p>No hay personal visible para este usuario.</p>"
      }
    </article>
  `;
}

async function handleCreatePersonnel(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);

  try {
    await apiFetch("/personnel", {
      method: "POST",
      body: JSON.stringify({
        fullName: formData.get("fullName"),
        documentNumber: formData.get("documentNumber"),
        position: formData.get("position"),
        companyId: formData.get("companyId")
          ? Number(formData.get("companyId"))
          : state.currentUser.companyId,
        contractId: formData.get("contractId")
          ? Number(formData.get("contractId"))
          : state.currentUser.contractId,
        municipality: formData.get("municipality"),
        institution: formData.get("institution"),
        modality: formData.get("modality"),
        status: formData.get("status"),
      }),
    });

    state.expandedModule = "gestion_personal";
    state.activeModule = "gestion_personal";
    state.activeSubmodule = "consultar_empleados";
    renderModuleNav(state.access?.modules || []);
    await openModule("gestion_personal");
  } catch (error) {
    alert(error.message);
  }
}

async function loadPersonnelModule(moduleConfig, submoduleKey) {
  const payload = await apiFetch("/personnel");

  const showCreateForm = payload.canCreate && submoduleKey === "crear_empleado";
  const showEditHelp = submoduleKey === "editar_empleado";
  const showStatusHelp = submoduleKey === "cambiar_estado";
  const showList = submoduleKey === "consultar_empleados" || showEditHelp || showStatusHelp;

  const formHtml = showCreateForm
    ? `
      <article class="info-card">
        <h3>Registrar personal</h3>
        <form id="personnelForm" class="personnel-form">
          <label>
            Nombre completo
            <input name="fullName" type="text" required />
          </label>
          <label>
            Documento
            <input name="documentNumber" type="text" required />
          </label>
          <label>
            Cargo
            <input name="position" type="text" required />
          </label>
          <label>
            Municipio
            <input name="municipality" type="text" required />
          </label>
          <label>
            Empresa
            <input name="companyId" type="number" value="${state.currentUser.companyId ?? ""}" ${state.currentUser.companyId ? "readonly" : ""} />
          </label>
          <label>
            Contrato
            <input name="contractId" type="number" value="${state.currentUser.contractId ?? ""}" ${state.currentUser.contractId ? "readonly" : ""} />
          </label>
          <label>
            Institución
            <input name="institution" type="text" />
          </label>
          <label>
            Modalidad
            <input name="modality" type="text" />
          </label>
          <label class="wide">
            Estado
            <select name="status">
              <option value="activo">Activo</option>
              <option value="novedad">Novedad</option>
              <option value="retiro">Retiro</option>
            </select>
          </label>
          <div class="admin-actions wide">
            <button type="submit">Guardar personal</button>
          </div>
        </form>
      </article>
    `
    : "";

  const helperHtml = showEditHelp
    ? `
      <article class="info-card">
        <h3>Editar empleado</h3>
        <p>En la siguiente fase este espacio tendrá edición individual por registro.</p>
      </article>
    `
    : showStatusHelp
      ? `
        <article class="info-card">
          <h3>Cambiar estado</h3>
          <p>En la siguiente fase este espacio permitirá activar, inactivar o suspender personal desde cada registro.</p>
        </article>
      `
      : "";

  const listHtml = showList
    ? `
      <article class="info-card">
        <h3>Personal visible</h3>
        <div class="personnel-list">
          ${
            payload.personnel.length
              ? payload.personnel
                  .map(
                    (item) => `
                      <div class="personnel-item">
                        <strong>${item.fullName}</strong>
                        <p>${item.position}</p>
                        <p>Documento: ${item.documentNumber}</p>
                        <p>${formatCompany(item.companyId)} | ${formatContract(item.contractId)}</p>
                        <p>${item.municipality} | ${item.institution || "Sin institución"} | ${item.status}</p>
                      </div>
                    `
                  )
                  .join("")
              : "<p>No hay registros visibles para este usuario.</p>"
          }
        </div>
      </article>
    `
    : "";

  setTimeout(() => {
    const form = document.getElementById("personnelForm");
    if (form) {
      form.addEventListener("submit", handleCreatePersonnel);
    }
  }, 0);

  return `
    <div class="personnel-grid">
      ${formHtml}
      ${helperHtml}
      ${listHtml}
    </div>
  `;
}

async function loadResumeModule() {
  const currentUrl = new URL(window.location.href);
  const site = currentUrl.searchParams.get("resumeSite") || "";
  const institution = currentUrl.searchParams.get("resumeInstitution") || "";
  const modality = currentUrl.searchParams.get("resumeModality") || "";
  const query = new URLSearchParams();

  if (site) query.set("site", site);
  if (institution) query.set("institution", institution);
  if (modality) query.set("modality", modality);

  const payload = await apiFetch(
    query.toString() ? `/resume-view?${query.toString()}` : "/resume-view"
  );

  setTimeout(() => {
    const form = document.getElementById("resumeFilterForm");
    if (!form) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const next = new URLSearchParams();

      if (formData.get("site")) next.set("resumeSite", formData.get("site"));
      if (formData.get("institution")) next.set("resumeInstitution", formData.get("institution"));
      if (formData.get("modality")) next.set("resumeModality", formData.get("modality"));

      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("resumeSite");
      cleanUrl.searchParams.delete("resumeInstitution");
      cleanUrl.searchParams.delete("resumeModality");
      next.forEach((value, key) => cleanUrl.searchParams.set(key, value));
      window.history.replaceState({}, "", cleanUrl);

      state.expandedModule = "hoja_vida_documentos";
      state.activeModule = "hoja_vida_documentos";
      state.activeSubmodule = "ver_hoja_vida";
      renderModuleNav(state.access?.modules || []);
      await openModule("hoja_vida_documentos");
    });
  }, 0);

  return `
    <article class="info-card">
      <h3>Filtros de hoja de vida</h3>
      <form id="resumeFilterForm" class="resume-filter-form">
        <label>
          Sede
          <select name="site">
            <option value="">Todas</option>
            ${payload.availableFilters.sites
              .map(
                (value) =>
                  `<option value="${value}" ${value === payload.filters.site ? "selected" : ""}>${value}</option>`
              )
              .join("")}
          </select>
        </label>
        <label>
          Institución
          <select name="institution">
            <option value="">Todas</option>
            ${payload.availableFilters.institutions
              .map(
                (value) =>
                  `<option value="${value}" ${value === payload.filters.institution ? "selected" : ""}>${value}</option>`
              )
              .join("")}
          </select>
        </label>
        <label>
          Modalidad
          <select name="modality">
            <option value="">Todas</option>
            ${payload.availableFilters.modalities
              .map(
                (value) =>
                  `<option value="${value}" ${value === payload.filters.modality ? "selected" : ""}>${value}</option>`
              )
              .join("")}
          </select>
        </label>
        <div class="admin-actions wide">
          <button type="submit">Aplicar filtros</button>
        </div>
      </form>
    </article>

    <div class="resume-list">
      ${
        payload.records.length
          ? payload.records
              .map(
                (record) => `
                  <article class="info-card">
                    <h3>${record.fullName}</h3>
                    <p>${record.position}</p>
                    <p>${record.site} | ${record.institution} | ${record.modality}</p>
                    <p>${record.municipality}</p>
                    <div class="resume-docs">
                      ${Object.entries(record.documents)
                        .map(
                          ([key, value]) => `
                            <div class="personnel-item">
                              <strong>${prettyLabel(key)}</strong>
                              <p>${value}</p>
                            </div>
                          `
                        )
                        .join("")}
                    </div>
                  </article>
                `
              )
              .join("")
          : '<article class="info-card"><p>No hay hojas de vida visibles con los filtros actuales.</p></article>'
      }
    </div>
  `;
}

async function handleCreateTraining(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);

  try {
    await apiFetch("/trainings", {
      method: "POST",
      body: JSON.stringify({
        title: formData.get("title"),
        date: formData.get("date"),
        municipality: formData.get("municipality"),
        site: formData.get("site"),
        institution: formData.get("institution"),
        modality: formData.get("modality"),
        companyId: formData.get("companyId")
          ? Number(formData.get("companyId"))
          : state.currentUser.companyId,
        contractId: formData.get("contractId")
          ? Number(formData.get("contractId"))
          : state.currentUser.contractId,
        status: formData.get("status"),
      }),
    });

    state.expandedModule = "capacitaciones_asistencia";
    state.activeModule = "capacitaciones_asistencia";
    state.activeSubmodule = "programar_capacitacion";
    renderModuleNav(state.access?.modules || []);
    await openModule("capacitaciones_asistencia");
  } catch (error) {
    alert(error.message);
  }
}

async function loadTrainingsModule() {
  const payload = await apiFetch("/trainings");

  setTimeout(() => {
    const form = document.getElementById("trainingForm");
    if (form) {
      form.addEventListener("submit", handleCreateTraining);
    }
  }, 0);

  const formHtml = payload.canCreate
    ? `
      <article class="info-card">
        <h3>Crear capacitación</h3>
        <form id="trainingForm" class="training-form">
          <label>
            Título
            <input name="title" type="text" required />
          </label>
          <label>
            Fecha
            <input name="date" type="date" required />
          </label>
          <label>
            Municipio
            <input name="municipality" type="text" required />
          </label>
          <label>
            Sede
            <input name="site" type="text" />
          </label>
          <label>
            Institución
            <input name="institution" type="text" />
          </label>
          <label>
            Modalidad
            <input name="modality" type="text" />
          </label>
          <label>
            Empresa
            <input name="companyId" type="number" value="${state.currentUser.companyId ?? ""}" ${state.currentUser.companyId ? "readonly" : ""} />
          </label>
          <label>
            Contrato
            <input name="contractId" type="number" value="${state.currentUser.contractId ?? ""}" ${state.currentUser.contractId ? "readonly" : ""} />
          </label>
          <label class="wide">
            Estado
            <select name="status">
              <option value="programada">Programada</option>
              <option value="en_curso">En curso</option>
              <option value="cerrada">Cerrada</option>
            </select>
          </label>
          <div class="admin-actions wide">
            <button type="submit">Guardar capacitación</button>
          </div>
        </form>
      </article>
    `
    : `
      <article class="info-card">
        <h3>Capacitaciones</h3>
        <p>Este usuario puede consultar la información, pero no crear nuevas capacitaciones.</p>
      </article>
    `;

  const listHtml = `
    <article class="info-card">
      <h3>Capacitaciones visibles</h3>
      <div class="training-list">
        ${
          payload.trainings.length
            ? payload.trainings
                .map(
                  (training) => `
                    <div class="personnel-item">
                      <strong>${training.title}</strong>
                      <p>Fecha: ${training.date}</p>
                      <p>${training.municipality} | ${training.site || "Sin sede"} | ${training.institution || "Sin institución"}</p>
                      <p>${training.modality || "Sin modalidad"} | ${training.status}</p>
                    </div>
                  `
                )
                .join("")
            : "<p>No hay capacitaciones visibles para este usuario.</p>"
        }
      </div>
    </article>
  `;

  return `<div class="training-grid">${formHtml}${listHtml}</div>`;
}

async function loadTrainingAttendanceModule() {
  const payload = await apiFetch("/training-attendance");

  setTimeout(() => {
    document.querySelectorAll(".attendance-form").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);

        try {
          await apiFetch("/training-attendance", {
            method: "POST",
            body: JSON.stringify({
              trainingId: Number(formData.get("trainingId")),
              personnelId: Number(formData.get("personnelId")),
              status: formData.get("status"),
            }),
          });

          state.expandedModule = "capacitaciones_asistencia";
          state.activeModule = "capacitaciones_asistencia";
          state.activeSubmodule = "registrar_asistencia";
          renderModuleNav(state.access?.modules || []);
          await openModule("capacitaciones_asistencia");
        } catch (error) {
          alert(error.message);
        }
      });
    });
  }, 0);

  return `
    <div class="attendance-list">
      ${
        payload.trainings.length
          ? payload.trainings
              .map(
                (training) => `
                  <article class="info-card">
                    <h3>${training.title}</h3>
                    <p>${training.date} | ${training.municipality} | ${training.site || "Sin sede"}</p>
                    <div class="attendance-list">
                      ${
                        training.attendance.length
                          ? training.attendance
                              .map(
                                (item) => `
                                  <div class="personnel-item">
                                    <strong>${item.personnel ? item.personnel.fullName : "Personal no encontrado"}</strong>
                                    <p>Estado actual: ${prettyLabel(item.status)}</p>
                                    <p>Marcado por: ${prettyLabel(item.markedByRole)}</p>
                                  </div>
                                `
                              )
                              .join("")
                          : "<p>No hay asistencias registradas todavía.</p>"
                      }
                    </div>
                    <form class="attendance-form">
                      <input type="hidden" name="trainingId" value="${training.id}" />
                      <label>
                        Persona
                        <select name="personnelId" required>
                          ${payload.personnel
                            .map(
                              (person) =>
                                `<option value="${person.id}">${person.fullName} - ${person.municipality}</option>`
                            )
                            .join("")}
                        </select>
                      </label>
                      <label>
                        Estado
                        <select name="status" required>
                          <option value="asistio">Asistió</option>
                          <option value="no_asistio">No asistió</option>
                          <option value="pendiente">Pendiente</option>
                        </select>
                      </label>
                      <div class="admin-actions wide">
                        <button type="submit">Guardar asistencia</button>
                      </div>
                    </form>
                  </article>
                `
              )
              .join("")
          : '<article class="info-card"><p>No hay capacitaciones visibles para marcar asistencia.</p></article>'
      }
    </div>
  `;
}

async function handleCreateReport(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);

  try {
    await apiFetch("/reports", {
      method: "POST",
      body: JSON.stringify({
        title: formData.get("title"),
        template: formData.get("template"),
        companyId: formData.get("companyId")
          ? Number(formData.get("companyId"))
          : state.currentUser.companyId,
        contractId: formData.get("contractId")
          ? Number(formData.get("contractId"))
          : state.currentUser.contractId,
      }),
    });

    state.expandedModule = "informes_reportes";
    state.activeModule = "informes_reportes";
    state.activeSubmodule = "reportes_personal";
    renderModuleNav(state.access?.modules || []);
    await openModule("informes_reportes");
  } catch (error) {
    alert(error.message);
  }
}

async function loadReportsModule() {
  const payload = await apiFetch("/reports");

  setTimeout(() => {
    const form = document.getElementById("reportForm");
    if (form) {
      form.addEventListener("submit", handleCreateReport);
    }
  }, 0);

  const formHtml = `
    <article class="info-card">
      <h3>Crear informe</h3>
      <form id="reportForm" class="report-form">
        <label>
          Título
          <input name="title" type="text" required />
        </label>
        <label>
          Plantilla
          <select name="template" required>
            ${payload.templates
              .map((template) => `<option value="${template.id}">${template.title}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          Empresa
          <input name="companyId" type="number" value="${payload.defaults.companyId ?? ""}" ${payload.defaults.companyId ? "readonly" : ""} />
        </label>
        <label>
          Contrato
          <input name="contractId" type="number" value="${payload.defaults.contractId ?? ""}" ${payload.defaults.contractId ? "readonly" : ""} />
        </label>
        <div class="admin-actions wide">
          <button type="submit">Generar informe</button>
        </div>
      </form>
      <div>
        ${payload.templates
          .map(
            (template) =>
              `<div class="personnel-item"><strong>${template.title}</strong><p>${template.description}</p></div>`
          )
          .join("")}
      </div>
    </article>
  `;

  const listHtml = `
    <article class="info-card">
      <h3>Informes guardados</h3>
      <div class="report-list">
        ${
          payload.reports.length
            ? payload.reports
                .slice()
                .reverse()
                .map(
                  (report) => `
                    <article class="personnel-item">
                      <strong>${report.title}</strong>
                      <p>Tipo: ${prettyLabel(report.template)}</p>
                      <p>Creado por: ${prettyLabel(report.createdByRole)}</p>
                      <p>Fecha: ${new Date(report.createdAt).toLocaleString("es-CO")}</p>
                      <div class="report-metrics">
                        ${Object.entries(report.content.metrics || {})
                          .map(
                            ([key, value]) => `
                              <div class="info-card">
                                <h3>${prettyLabel(key)}</h3>
                                <p>${value}</p>
                              </div>
                            `
                          )
                          .join("")}
                      </div>
                      <p>${report.content.summary || ""}</p>
                      ${
                        report.content.notes?.length
                          ? `<p>${report.content.notes.join(" | ")}</p>`
                          : ""
                      }
                      ${
                        report.content.people?.length
                          ? `<div>${report.content.people
                              .map(
                                (person) =>
                                  `<span class="pill">${person.fullName} - ${prettyLabel(person.status)}</span>`
                              )
                              .join("")}</div>`
                          : ""
                      }
                    </article>
                  `
                )
                .join("")
            : "<p>No hay informes guardados para este usuario.</p>"
        }
      </div>
    </article>
  `;

  return `<div class="report-grid">${formHtml}${listHtml}</div>`;
}

function toggleAdminPanel(isVisible) {
  if (!elements.adminPanel) return;
  elements.adminPanel.classList.toggle("hidden", !isVisible);
}

function toggleAccessPanel(isVisible) {
  if (!elements.accessPanel) return;
  elements.accessPanel.classList.toggle("hidden", !isVisible);
}

function syncAdminPanelsVisibility() {
  const isAdministrator = state.currentUser?.role === "administrador";
  const isAdminModuleActive = state.activeModule === "administracion_configuraciones";

  toggleAdminPanel(Boolean(isAdministrator && isAdminModuleActive));
  toggleAccessPanel(Boolean(isAdministrator && isAdminModuleActive));
}

async function renderSubmoduleContent(moduleKey, submoduleKey, moduleConfig) {
  if (!submoduleKey) {
    return `
      <article class="info-card">
        <p>Selecciona una acción del menú izquierdo.</p>
      </article>
    `;
  }

  if (moduleKey === "dashboard") {
    return await loadDashboardModule();
  }

  if (moduleKey === "gestion_personal") {
    if (
      submoduleKey === "consultar_empleados" ||
      submoduleKey === "editar_empleado" ||
      submoduleKey === "crear_empleado" ||
      submoduleKey === "cambiar_estado"
    ) {
      return await loadPersonnelModule(moduleConfig, submoduleKey);
    }
  }

  if (moduleKey === "hoja_vida_documentos") {
    if (submoduleKey === "ver_hoja_vida") {
      return await loadResumeModule();
    }

    return `
      <article class="info-card">
        <h3>${prettyLabel(submoduleKey)}</h3>
        <p>Este espacio quedó reservado dentro de Hoja de Vida y Documentos.</p>
      </article>
    `;
  }

  if (moduleKey === "contratos_vinculacion") {
    return `
      <article class="info-card">
        <h3>${prettyLabel(submoduleKey)}</h3>
        <p>Este espacio pertenece al proceso contractual y de vinculación.</p>
      </article>
    `;
  }

  if (moduleKey === "cobertura_calculadora") {
    return `
      <article class="info-card">
        <h3>${prettyLabel(submoduleKey)}</h3>
        <p>Este espacio concentrará la lógica operativa de cobertura y cálculo de personal.</p>
      </article>
    `;
  }

  if (moduleKey === "nomina_novedades") {
    return `
      <article class="info-card">
        <h3>${prettyLabel(submoduleKey)}</h3>
        <p>Este espacio organizará el proceso específico dentro de Nómina y Novedades.</p>
      </article>
    `;
  }

  if (moduleKey === "capacitaciones_asistencia") {
    if (submoduleKey === "programar_capacitacion") {
      return await loadTrainingsModule();
    }

    if (submoduleKey === "registrar_asistencia") {
      return await loadTrainingAttendanceModule();
    }

    return `
      <article class="info-card">
        <h3>${prettyLabel(submoduleKey)}</h3>
        <p>Este espacio quedará enfocado en la gestión de capacitación y trazabilidad.</p>
      </article>
    `;
  }

  if (moduleKey === "informes_reportes") {
    return await loadReportsModule();
  }

  if (moduleKey === "solicitudes_empleados") {
    return `
      <article class="info-card">
        <h3>${prettyLabel(submoduleKey)}</h3>
        <p>Este espacio quedará dedicado a la atención de solicitudes del empleado.</p>
      </article>
    `;
  }

  if (moduleKey === "administracion_configuraciones") {
    if (submoduleKey === "gestion_usuarios") {
      return `
        <article class="info-card">
          <h3>Gestión de usuarios</h3>
          <p>Usa los paneles administrativos para crear, editar y administrar usuarios del sistema.</p>
        </article>
      `;
    }

    if (submoduleKey === "roles_permisos") {
      return `
        <article class="info-card">
          <h3>Roles y permisos</h3>
          <p>Este espacio quedará dedicado a la configuración fina de accesos por rol y módulo.</p>
        </article>
      `;
    }

    if (submoduleKey === "probar_acceso") {
      return `
        <article class="info-card">
          <h3>Probar acceso</h3>
          <p>Usa el panel de validación de acceso para simular permisos y verificar restricciones.</p>
        </article>
      `;
    }

    if (submoduleKey === "auditoria") {
      return `
        <article class="info-card">
          <h3>Auditoría</h3>
          <p>Este espacio quedará reservado para la trazabilidad de acciones sensibles del sistema.</p>
        </article>
      `;
    }

    if (submoduleKey === "bloqueos") {
      return `
        <article class="info-card">
          <h3>Bloqueos</h3>
          <p>Este espacio quedará dedicado a revisar bloqueos, intentos fallidos y desbloqueos manuales.</p>
        </article>
      `;
    }
  }

  return `
    <article class="info-card">
      <h3>${prettyLabel(submoduleKey)}</h3>
      <p>Espacio disponible para desarrollo.</p>
    </article>
  `;
}

async function openModule(moduleKey) {
  state.activeModule = moduleKey;
  state.expandedModule = moduleKey;

  if (!state.access) {
    renderEmptyWorkspace();
    return;
  }

  const moduleConfig = state.access.modules.find((item) => item.module === moduleKey);
  if (!moduleConfig) {
    renderEmptyWorkspace();
    return;
  }

  const view = moduleViews[moduleKey] || {
    title: prettyLabel(moduleKey),
    submodules: [],
  };

  if (!state.activeSubmodule && view.submodules?.length) {
    state.activeSubmodule = view.submodules[0].key;
  }

  syncAdminPanelsVisibility();
  renderModuleNav(state.access.modules);

  const activeSubmodule = view.submodules?.find(
    (item) => item.key === state.activeSubmodule
  );

  const submoduleContentHtml = await renderSubmoduleContent(
    moduleKey,
    state.activeSubmodule,
    moduleConfig
  );

  elements.workspace.innerHTML = `
    <h2 class="workspace-title">${view.title}</h2>
    ${activeSubmodule ? `<p class="subtitle workspace-subtitle">${activeSubmodule.title}</p>` : ""}
    <section class="submodule-content">
      ${submoduleContentHtml}
    </section>
  `;
}

function renderAdminUsers() {
  if (!elements.adminUsersList || !elements.adminCount) return;

  elements.adminCount.textContent = `${state.users.length} usuarios`;
  elements.adminUsersList.innerHTML = state.users
    .map(
      (user) => `
        <article class="admin-user-card">
          <div class="admin-user-head">
            <div>
              <strong>${user.name}</strong>
              <p class="soft tiny">Usuario: ${user.username} | Rol: ${prettyLabel(user.role)}</p>
            </div>
            <span class="pill">ID ${user.id}</span>
          </div>

          <form class="admin-user-form" data-user-id="${user.id}">
            <label>
              Nombre completo
              <input name="name" type="text" value="${user.name}" required />
            </label>

            <label>
              Usuario
              <input name="username" type="text" value="${user.username}" required />
            </label>

            <label>
              Rol
              <select name="role">
                ${state.availableRoles
                  .map(
                    (role) =>
                      `<option value="${role}" ${role === user.role ? "selected" : ""}>${prettyLabel(role)}</option>`
                  )
                  .join("")}
              </select>
            </label>

            <label>
              Empresa
              <select name="companyId">
                <option value="">Sin asignar</option>
                ${state.companies
                  .map(
                    (company) =>
                      `<option value="${company.id}" ${company.id === user.companyId ? "selected" : ""}>${company.name} (${company.id})</option>`
                  )
                  .join("")}
              </select>
            </label>

            <label>
              Contrato
              <select name="contractId">
                <option value="">Sin asignar</option>
                ${state.contracts
                  .map(
                    (contract) =>
                      `<option value="${contract.id}" ${contract.id === user.contractId ? "selected" : ""}>${contract.name} (${contract.id})</option>`
                  )
                  .join("")}
              </select>
            </label>

            <label>
              Nueva clave
              <input name="password" type="password" placeholder="Solo si la quieres cambiar" />
            </label>

            <label class="wide">
              Municipios asignados
              <input
                name="assignedMunicipalities"
                type="text"
                value="${(user.assignedMunicipalities || []).join(", ")}"
                placeholder="Ejemplo: Bogotá, Soacha"
              />
            </label>

            <div class="admin-actions wide">
              <button type="submit" class="btn btn-primary">Guardar cambios</button>
            </div>
          </form>
        </article>
      `
    )
    .join("");

  elements.adminUsersList
    .querySelectorAll(".admin-user-form")
    .forEach((form) => form.addEventListener("submit", handleUpdateUser));
}

async function loadAdminData() {
  const [rolesPayload, usersPayload] = await Promise.all([
    apiFetch("/roles"),
    apiFetch("/users"),
  ]);

  state.availableRoles = rolesPayload.roles;
  state.users = usersPayload.users;

  fillSelect(elements.createRole, state.availableRoles);
  renderAdminUsers();
}

async function loadReferenceData() {
  const [companiesPayload, contractsPayload] = await Promise.all([
    apiFetch("/companies"),
    apiFetch("/contracts"),
  ]);

  state.companies = companiesPayload.companies;
  state.contracts = contractsPayload.contracts;

  fillOptionSelect(elements.createCompanyId, state.companies, {
    valueKey: "id",
    labelBuilder: (company) => `${company.name} (${company.id})`,
    includeEmpty: true,
  });

  fillOptionSelect(elements.createContractId, state.contracts, {
    valueKey: "id",
    labelBuilder: (contract) => `${contract.name} (${contract.id})`,
    includeEmpty: true,
  });
}

async function renderDashboard(user, access) {
  state.currentUser = user;
  state.access = access;
  await loadReferenceData();

  elements.loginWrap?.classList.add("hidden");
  elements.dashboard?.classList.remove("hidden");

  if (elements.welcomeName) elements.welcomeName.textContent = user.name || "Usuario";
  if (elements.welcomeRole) elements.welcomeRole.textContent = prettyLabel(user.role);

  if (elements.companyValue) {
    elements.companyValue.textContent = formatCompany(user.companyId);
  }

  if (elements.contractValue) {
    elements.contractValue.textContent = formatContract(user.contractId);
  }

  if (elements.municipalityValue) {
    elements.municipalityValue.textContent =
      user.assignedMunicipalities && user.assignedMunicipalities.length
        ? user.assignedMunicipalities.join(", ")
        : "Sin restricción";
  }

  if (elements.topUser) {
    elements.topUser.textContent = `${user.name} · ${prettyLabel(user.role)}`;
  }

  if (elements.topCompany) {
    elements.topCompany.textContent = formatCompany(user.companyId);
  }

  if (elements.topContract) {
    elements.topContract.textContent = formatContract(user.contractId);
  }

  if (elements.topMunicipality) {
    elements.topMunicipality.textContent =
      user.assignedMunicipalities && user.assignedMunicipalities.length
        ? user.assignedMunicipalities.join(", ")
        : "Sin restricción";
  }

  state.activeModule = null;
  state.expandedModule = null;
  state.activeSubmodule = null;

  renderModuleNav(access.modules);

  fillSelect(
    elements.moduleSelect,
    access.modules.map((item) => item.module)
  );

  const isAdministrator = user.role === "administrador";

  if (isAdministrator) {
    await loadAdminData();
  }

  renderEmptyWorkspace();
  syncAdminPanelsVisibility();
}

function resetDashboard() {
  state.currentUser = null;
  state.access = null;
  state.activeModule = null;
  state.expandedModule = null;
  state.activeSubmodule = null;
  state.token = "";

  localStorage.removeItem("empiria_token");
  localStorage.removeItem("empiria_user");
  localStorage.removeItem("empiria_access");

  resetMfaState();

  elements.dashboard?.classList.add("hidden");
  elements.loginWrap?.classList.remove("hidden");
  elements.accessResult?.classList.add("hidden");

  toggleAdminPanel(false);
  toggleAccessPanel(false);

  state.users = [];

  if (elements.adminUsersList) elements.adminUsersList.innerHTML = "";
  if (elements.adminCount) elements.adminCount.textContent = "0 usuarios";
  if (elements.moduleNav) elements.moduleNav.innerHTML = "";

  renderEmptyWorkspace();

    if (elements.topUser) elements.topUser.textContent = "Usuario · Rol";
  if (elements.topCompany) elements.topCompany.textContent = "-";
  if (elements.topContract) elements.topContract.textContent = "-";
  if (elements.topMunicipality) elements.topMunicipality.textContent = "Sin restricción";

  showAdminCreateMessage("");
  showLoginMessage("");
}

async function loadModulesCatalog() {
  const payload = await apiFetch("/modules");
  state.availableModules = payload.modules;
  state.availableActions = payload.actions;
  fillSelect(elements.actionSelect, payload.actions);
}

async function tryRestoreSession() {
  if (!state.token) return;

  try {
    const payload = await apiFetch("/me");
    await renderDashboard(payload.user, payload.access);
  } catch {
    resetDashboard();
  }
}

async function handleCreateUser(event) {
  event.preventDefault();

  const formData = new FormData(elements.createUserForm);
  const payload = {
    name: formData.get("name"),
    username: formData.get("username"),
    password: formData.get("password"),
    role: formData.get("role"),
    companyId: formData.get("companyId") ? Number(formData.get("companyId")) : null,
    contractId: formData.get("contractId") ? Number(formData.get("contractId")) : null,
    assignedMunicipalities: toMunicipalityArray(formData.get("assignedMunicipalities")),
  };

  try {
    await apiFetch("/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    elements.createUserForm.reset();
    showAdminCreateMessage("Usuario creado correctamente", false);
    await loadAdminData();
  } catch (error) {
    showAdminCreateMessage(error.message, true);
  }
}

async function handleUpdateUser(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const userId = Number(form.dataset.userId);
  const formData = new FormData(form);

  const payload = {
    name: formData.get("name"),
    username: formData.get("username"),
    role: formData.get("role"),
    companyId: formData.get("companyId") ? Number(formData.get("companyId")) : null,
    contractId: formData.get("contractId") ? Number(formData.get("contractId")) : null,
    assignedMunicipalities: toMunicipalityArray(formData.get("assignedMunicipalities")),
  };

  if (formData.get("password")) {
    payload.password = formData.get("password");
  }

  try {
    await apiFetch(`/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    showAdminCreateMessage("Cambios guardados correctamente", false);
    await loadAdminData();
  } catch (error) {
    showAdminCreateMessage(error.message, true);
  }
}

if (elements.loginForm) {
  ensureMfaField();

  elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(elements.loginForm);

    let username = formData.get("username");
    let password = formData.get("password");

    if (state.requiresMfa) {
      username = state.tempUsername;
      password = state.tempPassword;
    }

    const mfaCode = elements.mfaCode ? String(elements.mfaCode.value || "").trim() : "";

    try {
      const payload = await apiFetch("/login", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          mfaCode: state.requiresMfa ? mfaCode : undefined,
        }),
      });

      if (payload.requiresMfa) {
        state.requiresMfa = true;
        state.tempUsername = username;
        state.tempPassword = password;

        showMfaField(true);
        showLoginMessage(payload.message || "Debes ingresar el código MFA", true);
        return;
      }

      if (!payload.ok) {
        showLoginMessage(payload.message || "No fue posible iniciar sesión", true);
        return;
      }

      state.token = payload.token;
      localStorage.setItem("empiria_token", payload.token);
      localStorage.setItem("empiria_user", JSON.stringify(payload.user || {}));
      localStorage.setItem("empiria_access", JSON.stringify(payload.access || {}));

      resetMfaState();
      showLoginMessage("Inicio de sesión correcto", false);
      await renderDashboard(payload.user, payload.access);
    } catch (error) {
      showLoginMessage(error.message, true);
    }
  });
}

if (elements.logoutButton) {
  elements.logoutButton.addEventListener("click", async () => {
    try {
      await apiFetch("/logout", { method: "POST" });
    } catch {
      // cierre local
    }

    resetDashboard();
  });
}

if (elements.accessForm) {
  elements.accessForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.currentUser || state.currentUser.role !== "administrador") {
      elements.accessResult.classList.remove("hidden");
      elements.accessResult.classList.add("denied");
      elements.accessResult.innerHTML = `
        <strong>Acceso restringido</strong>
        <p>Solo el administrador puede usar esta validación.</p>
      `;
      return;
    }

    const resource = {
      companyId: elements.companyInput.value ? Number(elements.companyInput.value) : null,
      contractId: elements.contractInput.value ? Number(elements.contractInput.value) : null,
      municipality: elements.municipalityInput.value || null,
    };

    try {
      const payload = await apiFetch("/access-check", {
        method: "POST",
        body: JSON.stringify({
          module: elements.moduleSelect.value,
          action: elements.actionSelect.value,
          resource,
        }),
      });

      elements.accessResult.classList.remove("hidden", "denied");
      elements.accessResult.innerHTML = `
        <strong>${payload.result.allowed ? "Acceso permitido" : "Acceso negado"}</strong>
        <p>${payload.result.reason}</p>
      `;

      if (!payload.result.allowed) {
        elements.accessResult.classList.add("denied");
      }
    } catch (error) {
      elements.accessResult.classList.remove("hidden");
      elements.accessResult.classList.add("denied");
      elements.accessResult.innerHTML = `
        <strong>No se pudo validar</strong>
        <p>${error.message}</p>
      `;
    }
  });
}

if (elements.createUserForm) {
  elements.createUserForm.addEventListener("submit", handleCreateUser);
}

if (elements.refreshUsersButton) {
  elements.refreshUsersButton.addEventListener("click", async () => {
    try {
      await loadAdminData();
      showAdminCreateMessage("Lista actualizada", false);
    } catch (error) {
      showAdminCreateMessage(error.message, true);
    }
  });
}

Promise.all([loadModulesCatalog(), tryRestoreSession()]).catch(() => {
  showLoginMessage("No fue posible cargar la pantalla", true);
});