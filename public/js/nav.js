import { state, elements, moduleViews } from './state.js';
import { prettyLabel, escapeHtml, escapeAttr, getModuleMeta } from './utils.js';

// Versionado de módulos dinámicos: agrega ?v=<hash> para invalidar cache en cada deploy
const _iv = (mod) => `${mod}?v=${window.APP_VERSION || '0'}`;

// Callback registered by dashboard.js to clean up its timers and charts.
export const dashboardCleaner = { fn: () => {} };

function resolveModuleAlias(moduleKey) {
  if (moduleKey === "dashboard") return "dashboard_hr";
  return moduleKey;
}

export function renderModuleNav(modules = []) {
  if (!elements.moduleNav) return;

  const hiddenModules = new Set([
    "dashboard",
    "hoja_vida_documentos",
    "contratos_vinculacion",
    "capacitaciones_asistencia",
    "informes_reportes",
    "solicitudes_empleados",
  ]);

  const MODULE_ORDER = [
    "dashboard_hr",
    "gestion_personal",
    "calculadora_personal",
    "cobertura_calculadora",
    "nomina_novedades",
    "registro_novedades",
    "seguridad_salud_trabajo",
    "gestion_dotacion",
    "repositorio_hojas_vida",
    "administracion_configuraciones",
  ];

  const visibleModules = Array.isArray(modules)
    ? modules
        .filter((item) => item.module && !hiddenModules.has(item.module) && moduleViews[item.module])
        .sort((a, b) => {
          const ia = MODULE_ORDER.indexOf(a.module);
          const ib = MODULE_ORDER.indexOf(b.module);
          if (ia === -1 && ib === -1) return 0;
          if (ia === -1) return 1;
          if (ib === -1) return -1;
          return ia - ib;
        })
    : [];

  if (!visibleModules.length) {
    elements.moduleNav.innerHTML = `<div class="nav-empty">No hay modulos disponibles para este usuario.</div>`;
    return;
  }

  elements.moduleNav.innerHTML = visibleModules.map((item) => {
    const moduleKey = item.module;
    const meta = getModuleMeta(moduleKey);
    const navLabelOverrides = {
      dashboard_hr: "Dashboard",
      gestion_personal: "Personal",
      cobertura_calculadora: "Cobertura PAE",
      nomina_novedades: "Nómina",
      calculadora_personal: "Calculadora",
      administracion_configuraciones: "Configuración",
      seguridad_salud_trabajo: "SST",
      registro_novedades: "Novedades",
      repositorio_hojas_vida: "Repositorio HV",
    };
    const navLabel = navLabelOverrides[moduleKey] || meta.label;
    const isActive = state.activeModule === moduleKey;
    const isExpanded = state.expandedModule === moduleKey;
    const view = moduleViews[moduleKey];
    const noSubmoduleKeys = new Set([
      "gestion_personal",
      "nomina_novedades",
      "calculadora_personal",
      "dashboard_hr",
      "cobertura_calculadora",
      "administracion_configuraciones",
      "gestion_dotacion",
    ]);
    const submodules = noSubmoduleKeys.has(moduleKey) ? [] : (view?.submodules || []);

    return `
      <div class="module-group">
        <button type="button" class="module-nav-item ${isActive ? "active" : ""}"
          data-module="${moduleKey}" aria-expanded="${isExpanded ? "true" : "false"}"
          data-tooltip="${escapeAttr(navLabel)}">
          <span class="module-nav-inline">
            <span class="module-nav-icon">${meta.icon}</span>
            <span class="module-nav-title">${navLabel}</span>
          </span>
          ${submodules.length ? `<span class="module-nav-caret ${isExpanded ? "open" : ""}">⌄</span>` : ""}
        </button>
        ${isExpanded && submodules.length ? `
          <div class="submodule-list">
            ${submodules.map((submodule) => `
              <button type="button"
                class="submodule-nav-item ${state.activeSubmodule === submodule.key ? "active" : ""}"
                data-module="${moduleKey}" data-submodule="${submodule.key}">
                <span class="submodule-dot"></span>
                <span class="submodule-label">${submodule.title}</span>
              </button>
            `).join("")}
          </div>
        ` : ""}
      </div>
    `;
  }).join("");

  elements.moduleNav.querySelectorAll(".module-nav-item[data-module]").forEach((button) => {
    button.addEventListener("click", async () => {
      const moduleKey = button.dataset.module;
      const noSubKeys = new Set([
        "gestion_personal",
        "nomina_novedades",
        "calculadora_personal",
        "dashboard",
        "dashboard_hr",
        "cobertura_calculadora",
        "administracion_configuraciones",
        "gestion_dotacion",
      ]);
      const hasSubmodules = !noSubKeys.has(moduleKey) && Boolean(moduleViews[moduleKey]?.submodules?.length);
      const isSameExpanded = state.expandedModule === moduleKey;

      if (isSameExpanded && hasSubmodules) {
        state.expandedModule = null;
        if (state.activeModule === moduleKey) {
          state.activeModule = null;
          state.activeSubmodule = null;
          renderModuleNav(visibleModules);
          renderEmptyWorkspace();
          syncAdminPanelsVisibility();
          return;
        }
      } else {
        state.expandedModule = moduleKey;
        state.activeModule = moduleKey;
        if (moduleKey === "gestion_personal") {
          state.activeSubmodule = null;
          state.personnelViewMode = "table";
          state.personnelEditingId = null;
          state.personnelDocumentsEmployee = null;
        } else {
          state.activeSubmodule = null;
        }
      }

      renderModuleNav(visibleModules);
      await openModule(moduleKey);
    });
  });

  elements.moduleNav.querySelectorAll(".submodule-nav-item[data-submodule]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.expandedModule = button.dataset.module;
      state.activeModule = button.dataset.module;
      state.activeSubmodule = button.dataset.submodule;
      renderModuleNav(visibleModules);
      await openModule(button.dataset.module);
    });
  });
}

export function renderEmptyWorkspace() {
  syncTopbarModuleTitle();
  if (!elements.workspace) return;
  elements.workspace.innerHTML = `
    <div class="workspace-empty">
      <div>
        <h3>Selecciona un modulo del menu izquierdo</h3>
        <p class="subtitle">Al abrir un modulo veras su contenido aqui.</p>
      </div>
    </div>
  `;
}

export function syncTopbarModuleTitle(moduleKey = state.activeModule, submoduleKey = state.activeSubmodule) {
  if (!elements.topModuleName) return;
  document.body?.classList.toggle("module-nomina", moduleKey === "nomina_novedades");

  if (!moduleKey) {
    elements.topModuleName.textContent = "Dashboard";
    elements.topModuleName.title = "Dashboard";
    if (elements.topModuleBreadcrumb) {
      elements.topModuleBreadcrumb.textContent = "Dashboard";
      elements.topModuleBreadcrumb.title = "Dashboard";
    }
    return;
  }

  const topbarTitleOverrides = {
    gestion_personal: "Gestión de Personal",
  };
  const topbarSectionOverrides = {
    gestion_personal: "Personal",
  };

  const view = moduleViews[moduleKey] || { title: prettyLabel(moduleKey), submodules: [] };
  const activeSubmodule = view.submodules?.find((item) => item.key === submoduleKey);
  const moduleTitle = topbarTitleOverrides[moduleKey] || view.title;
  const sectionTitle = topbarSectionOverrides[moduleKey] || moduleTitle;
  const title = activeSubmodule ? activeSubmodule.title : moduleTitle;
  const breadcrumbParts = activeSubmodule
    ? ["Dashboard", sectionTitle, activeSubmodule.title]
    : sectionTitle === moduleTitle
      ? ["Dashboard", moduleTitle]
      : ["Dashboard", sectionTitle, moduleTitle];
  const breadcrumb = breadcrumbParts.join(" > ");

  elements.topModuleName.textContent = title;
  elements.topModuleName.title = title;
  if (elements.topModuleBreadcrumb) {
    elements.topModuleBreadcrumb.textContent = breadcrumb;
    elements.topModuleBreadcrumb.title = breadcrumb;
  }
}

export function toggleAdminPanel(isVisible) {
  if (!elements.adminPanel) return;
  elements.adminPanel.classList.toggle("hidden", !isVisible);
}

export function toggleAccessPanel(isVisible) {
  if (!elements.accessPanel) return;
  elements.accessPanel.classList.toggle("hidden", !isVisible);
}

export function syncAdminPanelsVisibility() {
  toggleAdminPanel(false);
  toggleAccessPanel(false);
}

async function renderSubmoduleContent(moduleKey, submoduleKey, moduleConfig) {
  if (moduleKey === "gestion_personal") {
    if (!state.personnelViewMode) state.personnelViewMode = "table";
    const {
      loadPersonnelModule,
      renderPersonnelTableModule,
      loadEmployeeDocumentsModule,
      renderPersonnelCvModule,
    } = await import(_iv('./modules/personnel.js'));

    if (state.personnelViewMode === "table") return await renderPersonnelTableModule();
    if (state.personnelViewMode === "documents") return await loadEmployeeDocumentsModule();
    if (state.personnelViewMode === "cv") return renderPersonnelCvModule();
    if (state.personnelViewMode === "create" || state.personnelViewMode === "edit") {
      return await loadPersonnelModule(
        moduleConfig,
        state.personnelViewMode === "edit" ? "editar_empleado" : "crear_empleado"
      );
    }
    return await renderPersonnelTableModule();
  }

  if (moduleKey === "dashboard_hr") {
    const { loadDashboardHrModule } = await import(_iv('./modules/dashboard-hr.js'));
    return await loadDashboardHrModule();
  }

  if (moduleKey === "cobertura_calculadora") {
    const { loadCoverageModule } = await import(_iv('./modules/coverage.js'));
    return await loadCoverageModule();
  }

  if (moduleKey === "calculadora_personal") {
    const { loadCalculatorModule, wireCalculatorEvents } = await import(_iv('./modules/calculator.js'));
    const html = await loadCalculatorModule();
    setTimeout(wireCalculatorEvents, 80);
    return html;
  }

  if (moduleKey === "nomina_novedades") {
    const payroll = await import(_iv('./modules/payroll.js'));
    const html = await payroll.loadPayrollModule();
    setTimeout(() => payroll.wirePayrollEvents(), 80);
    return html;
  }

  if (moduleKey === "administracion_configuraciones") {
    const { loadClientesModule, wireConfigEvents, loadContractConfigPanel, wireContractConfigEvents } = await import(_iv('./modules/config.js'));
    if (state.cfgContractConfigId) {
      const html = await loadContractConfigPanel(state.cfgContractConfigId);
      setTimeout(wireContractConfigEvents, 0);
      return html;
    }
    const html = await loadClientesModule();
    setTimeout(wireConfigEvents, 0);
    return html;
  }

  if (moduleKey === "seguridad_salud_trabajo") {
    const { loadSstModule } = await import(_iv('./modules/sst.js'));
    return await loadSstModule();
  }

  if (moduleKey === "registro_novedades") {
    const { loadNovedadesModule } = await import(_iv('./modules/novedades.js'));
    return await loadNovedadesModule();
  }

  if (moduleKey === "repositorio_hojas_vida") {
    const { loadRepositorioHvModule } = await import(_iv('./modules/repositorio-hv.js'));
    return await loadRepositorioHvModule();
  }

  if (moduleKey === "gestion_dotacion") {
    const { loadDotacionModule } = await import(_iv('./modules/dotacion.js'));
    return await loadDotacionModule(moduleConfig);
  }

  if (!submoduleKey) {
    return `<article class="info-card"><p>Selecciona una accion del menu izquierdo.</p></article>`;
  }

  if (moduleKey === "hoja_vida_documentos" || moduleKey === "contratos_vinculacion") {
    state.activeModule = "gestion_personal";
    state.personnelViewMode = "table";
    const { renderPersonnelTableModule } = await import(_iv('./modules/personnel.js'));
    return await renderPersonnelTableModule();
  }

  if (moduleKey === "capacitaciones_asistencia") {
    const {
      loadTrainingsModule,
      loadTrainingAttendanceModule,
      loadResumeModule,
    } = await import(_iv('./modules/trainings.js'));
    if (submoduleKey === "programar_capacitacion") return await loadTrainingsModule();
    if (submoduleKey === "registrar_asistencia") return await loadTrainingAttendanceModule();
    if (submoduleKey === "ver_hoja_vida") return await loadResumeModule();
    return await loadTrainingsModule();
  }

  if (moduleKey === "informes_reportes") {
    const { loadReportsModule } = await import(_iv('./modules/reports.js'));
    return await loadReportsModule();
  }

  if (moduleKey === "solicitudes_empleados") {
    const {
      loadSolicitudFormModule,
      wireSolicitudFormEvents,
      loadEstadoSolicitudesModule,
      wireEstadoSolicitudesEvents,
    } = await import(_iv('./modules/requests.js'));

    if (submoduleKey === "nueva_solicitud") {
      const html = await loadSolicitudFormModule(
        "CERTIFICADO_LABORAL",
        "Nueva Solicitud",
        "Registra una solicitud de certificado, desprendible u otro documento."
      );
      setTimeout(wireSolicitudFormEvents, 0);
      return html;
    }

    if (submoduleKey === "estado_solicitudes") {
      const html = await loadEstadoSolicitudesModule();
      setTimeout(wireEstadoSolicitudesEvents, 0);
      return html;
    }

    const html = await loadSolicitudFormModule(
      "CERTIFICADO_LABORAL",
      "Nueva Solicitud",
      "Registra una solicitud de certificado, desprendible u otro documento."
    );
    setTimeout(wireSolicitudFormEvents, 0);
    return html;
  }

  return `<article class="info-card"><p>Espacio disponible para este modulo.</p></article>`;
}

export async function openModule(moduleKey) {
  const requestedModuleKey = moduleKey;
  moduleKey = resolveModuleAlias(moduleKey);
  if (moduleKey !== "dashboard_hr") dashboardCleaner.fn();
  state.activeModule = moduleKey;
  state.expandedModule = moduleKey;
  syncTopbarModuleTitle(moduleKey, state.activeSubmodule);

  if (!state.token || !state.access) {
    renderEmptyWorkspace();
    return;
  }

  const moduleConfig =
    state.access.modules.find((item) => item.module === moduleKey)
    || state.access.modules.find((item) => item.module === requestedModuleKey);
  if (!moduleConfig) {
    renderEmptyWorkspace();
    return;
  }

  const view = moduleViews[moduleKey] || { title: prettyLabel(moduleKey), submodules: [] };
  if (moduleKey !== "gestion_personal" && !state.activeSubmodule && view.submodules?.length) {
    state.activeSubmodule = view.submodules[0].key;
    syncTopbarModuleTitle(moduleKey, state.activeSubmodule);
  }

  syncAdminPanelsVisibility();
  renderModuleNav(state.access.modules);

  if (elements.workspace) {
    elements.workspace.innerHTML = `
      <section class="submodule-content">
        <article class="info-card"><p>Cargando modulo...</p></article>
      </section>
    `;
  }

  try {
    const submoduleContentHtml = await renderSubmoduleContent(moduleKey, state.activeSubmodule, moduleConfig);
    if (elements.workspace) {
      elements.workspace.innerHTML = `<section class="submodule-content">${submoduleContentHtml}</section>`;
    }
  } catch (error) {
    if (elements.workspace) {
      elements.workspace.innerHTML = `
        <section class="submodule-content">
          <article class="info-card">
            <h3>No fue posible cargar este modulo</h3>
            <p>${escapeHtml(error.message)}</p>
          </article>
        </section>
      `;
    }
  }
}
