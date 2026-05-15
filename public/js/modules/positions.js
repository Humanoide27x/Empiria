import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { escapeHtml, escapeAttr } from '../utils.js';
import { showSuccess, showError, showWarning, showInfo } from '../toast.js';
import { openModule } from '../nav.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  OFERTA: "Oferta", EXTRA: "Extra", ADMINISTRATIVO: "Administrativo",
  OPERATIVO: "Operativo", PROFESIONAL: "Profesional",
};

const SALARY_TYPE_LABELS = {
  mensual: "Mensual", diario: "Diario",
  por_hora: "Por hora", prestacion_servicios: "Prestación de servicios",
};

function catBadge(cat) {
  const cls = {
    OFERTA: "pos-cat-oferta", EXTRA: "pos-cat-extra",
    ADMINISTRATIVO: "pos-cat-admin", OPERATIVO: "pos-cat-op",
    PROFESIONAL: "pos-cat-pro",
  }[cat] || "pos-cat-op";
  return `<span class="pos-cat-badge ${cls}">${CATEGORY_LABELS[cat] || cat || "—"}</span>`;
}

function fmtCOP(n) {
  if (!n && n !== 0) return "—";
  return Number(n).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
}

function fmtDate(d) { return d ? new Date(d).toLocaleDateString("es-CO") : "—"; }

function isAdminUser() {
  return String(state.currentUser?.role || "").toLowerCase() === "administrador";
}

function reload() { return openModule("administracion_configuraciones"); }

// ── VISTA PRINCIPAL — despachador ─────────────────────────────────────────────

export async function loadPositionsModule() {
  if (state.posViewMode === "detail" && state.posSelectedId) {
    return loadPositionDetail();
  }
  if (state.posViewMode === "create") {
    return loadPositionCreate();
  }
  return loadPositionList();
}

// ── LISTA ─────────────────────────────────────────────────────────────────────

async function loadPositionList() {
  let positions = [];
  let companies = [];
  let contracts = [];
  let loadErr   = "";

  const f = state.posFilters || {};

  try {
    const params = new URLSearchParams();
    if (f.companyId)  params.set("companyId",  f.companyId);
    if (f.contractId) params.set("contractId", f.contractId);
    if (f.area)       params.set("area",       f.area);
    if (f.search)     params.set("search",     f.search);
    if (f.status !== "") params.set("active", f.status === "activo" ? "true" : f.status === "inactivo" ? "false" : "");

    const [pr, cr, ctr] = await Promise.all([
      apiFetch(`/admin/positions?${params}`),
      apiFetch("/companies").catch(() => ({ data: [] })),
      apiFetch("/contracts").catch(() => ({ data: [] })),
    ]);
    positions = Array.isArray(pr.data) ? pr.data : [];
    companies = Array.isArray(cr.data) ? cr.data : [];
    contracts = Array.isArray(ctr.data) ? ctr.data : [];
  } catch (e) {
    loadErr = e.message || "Error al cargar los cargos";
  }

  const areas = [...new Set(positions.map(p => p.area).filter(Boolean))].sort();
  const admin  = isAdminUser();

  return `
    <div class="pos-wrap">
      <section class="personnel-premium-hero">
        <div>
          <span class="personnel-premium-eyebrow">Administración</span>
          <h2>Configuración de Cargos</h2>
          <p>${positions.length} cargo(s) — perfiles, valores de nómina y documentos requeridos</p>
        </div>
        ${admin ? `<button id="posNewBtn" class="btn btn-primary">+ Nuevo cargo</button>` : ""}
      </section>

      <div class="pos-filter-bar">
        <input id="posSearch" type="text" class="pos-input" placeholder="Buscar por nombre..." value="${escapeAttr(f.search || "")}" style="min-width:200px" />
        <select id="posCompany" class="pos-select">
          <option value="">Todas las empresas</option>
          ${companies.map(c => `<option value="${c.id}" ${String(f.companyId) === String(c.id) ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
        </select>
        <select id="posContract" class="pos-select">
          <option value="">Todos los contratos</option>
          ${contracts.map(c => `<option value="${c.id}" ${String(f.contractId) === String(c.id) ? "selected" : ""}>${escapeHtml(c.name || `Contrato ${c.id}`)}</option>`).join("")}
        </select>
        <select id="posArea" class="pos-select">
          <option value="">Todas las áreas</option>
          ${areas.map(a => `<option value="${escapeAttr(a)}" ${f.area === a ? "selected" : ""}>${escapeHtml(a)}</option>`).join("")}
        </select>
        <select id="posStatus" class="pos-select">
          <option value=""  ${!f.status               ? "selected" : ""}>Todos</option>
          <option value="activo"   ${f.status === "activo"   ? "selected" : ""}>Activos</option>
          <option value="inactivo" ${f.status === "inactivo" ? "selected" : ""}>Inactivos</option>
        </select>
        <button id="posClearFilters" class="btn btn-secondary">Limpiar</button>
      </div>

      ${loadErr ? `<div class="pw-error">${escapeHtml(loadErr)}</div>` : ""}

      ${positions.length === 0 && !loadErr ? `
        <div class="pw-empty">
          <div class="pw-empty-icon">🏷️</div>
          <p>No hay cargos configurados aún.</p>
          ${admin ? "<p>Crea el primer cargo con <strong>+ Nuevo cargo</strong>.</p>" : ""}
        </div>` : `
        <div class="pos-table-wrap">
          <table class="pos-table">
            <thead>
              <tr>
                <th>Cargo</th>
                <th>Empresa / Contrato</th>
                <th>Área</th>
                <th>Categoría</th>
                <th>Cobertura</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${positions.map(p => `
                <tr class="${p.active ? "" : "pos-row-inactive"}">
                  <td>
                    <div class="pos-name-cell">
                      <span class="pos-name">${escapeHtml(p.name)}</span>
                      ${p.profileLevel ? `<span class="pos-level">${escapeHtml(p.profileLevel)}</span>` : ""}
                    </div>
                  </td>
                  <td>
                    <div class="pos-company-cell">
                      <span>${escapeHtml(p.companyName || `Empresa ${p.companyId}`)}</span>
                      ${p.contractName ? `<span class="pos-contract-tag">${escapeHtml(p.contractName)}</span>` : ""}
                    </div>
                  </td>
                  <td style="font-size:12px;color:#4b5563">${escapeHtml(p.area || "—")}</td>
                  <td>${catBadge(p.category)}</td>
                  <td>
                    <span class="pos-bool-badge ${p.appliesCoverage ? "pos-bool-yes" : "pos-bool-no"}">
                      ${p.appliesCoverage ? "✓ Sí" : "✗ No"}
                    </span>
                  </td>
                  <td>
                    <span class="pos-status-badge ${p.active ? "pos-active" : "pos-inactive"}">
                      ${p.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td>
                    <div class="pos-actions">
                      <button class="pos-action-btn pos-btn-view" data-id="${p.id}" title="Ver / Editar">Ver</button>
                      ${admin ? `
                        <button class="pos-action-btn pos-btn-toggle" data-id="${p.id}" data-active="${p.active}" title="${p.active ? "Inactivar" : "Activar"}">
                          ${p.active ? "Inactivar" : "Activar"}
                        </button>
                      ` : ""}
                    </div>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>`}
    </div>`;
}

// ── CREAR CARGO ───────────────────────────────────────────────────────────────

async function loadPositionCreate() {
  let companies = [];
  let contracts = [];
  try {
    const [cr, ctr] = await Promise.all([
      apiFetch("/companies").catch(() => ({ data: [] })),
      apiFetch("/contracts").catch(() => ({ data: [] })),
    ]);
    companies = Array.isArray(cr.data) ? cr.data : [];
    contracts = Array.isArray(ctr.data) ? ctr.data : [];
  } catch { /* silencio */ }

  return `
    <div class="pos-wrap">
      <div class="pw-breadcrumb">
        <button id="posBtnBackList" class="pw-back-btn">← Cargos</button>
        <span class="pw-bc-sep">/</span>
        <span>Nuevo cargo</span>
      </div>
      ${_positionForm(null, companies, contracts)}
    </div>`;
}

// ── DETALLE / EDITAR ──────────────────────────────────────────────────────────

async function loadPositionDetail() {
  const id = state.posSelectedId;
  const tab = state.posTab || "datos";
  let position = null;
  let profile   = null;
  let payrollVals = [];
  let docReqs   = [];
  let docTypes  = [];
  let companies = [];
  let contracts = [];
  let err = "";

  try {
    const [pr, cr, ctr] = await Promise.all([
      apiFetch(`/admin/positions/${id}`),
      apiFetch("/companies").catch(() => ({ data: [] })),
      apiFetch("/contracts").catch(() => ({ data: [] })),
    ]);
    position  = pr.data;
    companies = Array.isArray(cr.data) ? cr.data : [];
    contracts = Array.isArray(ctr.data) ? ctr.data : [];

    if (tab === "perfil") {
      const pfr = await apiFetch(`/admin/positions/${id}/profile`);
      profile = pfr.data;
    }
    if (tab === "nomina") {
      const pvr = await apiFetch(`/admin/positions/${id}/payroll-values`);
      payrollVals = Array.isArray(pvr.data) ? pvr.data : [];
    }
    if (tab === "documentos") {
      const [dr, dtr] = await Promise.all([
        apiFetch(`/admin/positions/${id}/document-requirements`),
        apiFetch("/admin/document-types").catch(() => ({ data: [] })),
      ]);
      docReqs  = Array.isArray(dr.data) ? dr.data : [];
      docTypes = Array.isArray(dtr.data) ? dtr.data : [];
    }
  } catch (e) {
    err = e.message || "Error al cargar el cargo";
  }

  if (!position && err) {
    return `<div class="pos-wrap"><div class="pw-error">${escapeHtml(err)}</div></div>`;
  }

  const admin = isAdminUser();
  const tabs = [
    { key: "datos",       label: "Datos del cargo" },
    { key: "perfil",      label: "Perfil" },
    { key: "nomina",      label: "Nómina" },
    { key: "documentos",  label: "Documentos" },
  ];

  return `
    <div class="pos-wrap">
      <div class="pw-breadcrumb">
        <button id="posBtnBackList" class="pw-back-btn">← Cargos</button>
        <span class="pw-bc-sep">/</span>
        <span class="pos-detail-name">${escapeHtml(position?.name || "")}</span>
        ${position ? catBadge(position.category) : ""}
        <span class="pos-status-badge ${position?.active ? "pos-active" : "pos-inactive"}" style="margin-left:4px">
          ${position?.active ? "Activo" : "Inactivo"}
        </span>
      </div>

      <div class="pos-tabs">
        ${tabs.map(t => `
          <button class="pos-tab ${tab === t.key ? "pos-tab-active" : ""}" data-tab="${t.key}">
            ${t.label}
          </button>`).join("")}
      </div>

      <div class="pos-tab-content">
        ${tab === "datos"      ? _positionForm(position, companies, contracts, true) : ""}
        ${tab === "perfil"     ? _profileTab(profile, admin) : ""}
        ${tab === "nomina"     ? _nominaTab(payrollVals, admin) : ""}
        ${tab === "documentos" ? _documentosTab(docReqs, docTypes, admin) : ""}
      </div>
    </div>`;
}

// ── TAB: DATOS DEL CARGO ──────────────────────────────────────────────────────

function _positionForm(pos, companies, contracts, isEdit = false) {
  const admin = isAdminUser();
  const CATEGORIES = ["OFERTA", "EXTRA", "ADMINISTRATIVO", "OPERATIVO", "PROFESIONAL"];
  const LEVELS = ["Nivel 1", "Nivel 2", "Nivel 3", "Nivel 4", "Nivel 5"];

  return `
    <div class="pos-form-card">
      <h4 class="pos-section-hdr">${isEdit ? "Editar datos del cargo" : "Nuevo cargo"}</h4>
      <div class="pos-form-grid">
        <div class="pos-field pos-field-wide">
          <label class="pos-label">Nombre del cargo <span class="req">*</span></label>
          <input id="posName" type="text" class="pos-input" placeholder="Ej: Manipulador de Alimentos" value="${escapeAttr(pos?.name || "")}" ${!admin ? "disabled" : ""} />
        </div>
        <div class="pos-field">
          <label class="pos-label">Empresa <span class="req">*</span></label>
          <select id="posCompanyId" class="pos-select" ${!admin || isEdit ? "disabled" : ""}>
            <option value="">Selecciona empresa</option>
            ${companies.map(c => `<option value="${c.id}" ${String(pos?.companyId) === String(c.id) ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="pos-field">
          <label class="pos-label">Contrato</label>
          <select id="posContractId" class="pos-select" ${!admin ? "disabled" : ""}>
            <option value="">Sin contrato específico</option>
            ${contracts.map(c => `<option value="${c.id}" ${String(pos?.contractId) === String(c.id) ? "selected" : ""}>${escapeHtml(c.name || `Contrato ${c.id}`)}</option>`).join("")}
          </select>
        </div>
        <div class="pos-field">
          <label class="pos-label">Área</label>
          <input id="posArea" type="text" class="pos-input" placeholder="Ej: Operaciones, RRHH..." value="${escapeAttr(pos?.area || "")}" ${!admin ? "disabled" : ""} />
        </div>
        <div class="pos-field">
          <label class="pos-label">Nivel del perfil</label>
          <select id="posProfileLevel" class="pos-select" ${!admin ? "disabled" : ""}>
            <option value="">Sin nivel</option>
            ${LEVELS.map(l => `<option value="${l}" ${pos?.profileLevel === l ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
        <div class="pos-field">
          <label class="pos-label">Tipo de cargo</label>
          <input id="posPositionType" type="text" class="pos-input" placeholder="Ej: Técnico, Auxiliar..." value="${escapeAttr(pos?.positionType || "")}" ${!admin ? "disabled" : ""} />
        </div>
        <div class="pos-field">
          <label class="pos-label">Categoría</label>
          <select id="posCategory" class="pos-select" ${!admin ? "disabled" : ""}>
            <option value="">Sin categoría</option>
            ${CATEGORIES.map(c => `<option value="${c}" ${pos?.category === c ? "selected" : ""}>${CATEGORY_LABELS[c]}</option>`).join("")}
          </select>
        </div>
        <div class="pos-field pos-field-inline">
          <label class="pos-label">Aplica para cobertura</label>
          <label class="pos-toggle">
            <input type="checkbox" id="posAppliesCoverage" ${pos?.appliesCoverage ? "checked" : ""} ${!admin ? "disabled" : ""} />
            <span class="pos-toggle-slider"></span>
          </label>
        </div>
        ${isEdit ? `
        <div class="pos-field pos-field-inline">
          <label class="pos-label">Cargo activo</label>
          <label class="pos-toggle">
            <input type="checkbox" id="posActive" ${pos?.active ? "checked" : ""} ${!admin ? "disabled" : ""} />
            <span class="pos-toggle-slider"></span>
          </label>
        </div>` : ""}
      </div>
      ${admin ? `
        <div class="pos-form-actions">
          <button id="posBtnBackList2" class="btn btn-secondary">Cancelar</button>
          <button id="posBtnSaveDatos" class="btn btn-primary" data-edit="${isEdit}" data-id="${pos?.id || ""}">
            ${isEdit ? "Guardar cambios" : "Crear cargo"}
          </button>
        </div>` : ""}
    </div>`;
}

// ── TAB: PERFIL ───────────────────────────────────────────────────────────────

function _profileTab(profile, admin) {
  const fields = [
    { id: "profObjective",      label: "Objetivo del cargo",        val: profile?.objective      || "" },
    { id: "profMainFunctions",  label: "Funciones principales",     val: profile?.mainFunctions  || "" },
    { id: "profEducationReq",   label: "Requisitos de formación",   val: profile?.educationReq   || "" },
    { id: "profMinExperience",  label: "Experiencia mínima",        val: profile?.minExperience  || "" },
    { id: "profCertifications", label: "Certificaciones requeridas",val: profile?.certifications || "" },
    { id: "profResponsibilities",label: "Responsabilidades",        val: profile?.responsibilities|| "" },
    { id: "profObservations",   label: "Observaciones",             val: profile?.observations   || "" },
  ];

  return `
    <div class="pos-form-card">
      <h4 class="pos-section-hdr">Perfil del cargo</h4>
      <div class="pos-profile-grid">
        ${fields.map(f => `
          <div class="pos-field">
            <label class="pos-label">${f.label}</label>
            <textarea id="${f.id}" class="pos-textarea" rows="3" ${!admin ? "disabled" : ""}
              placeholder="${f.label}...">${escapeHtml(f.val)}</textarea>
          </div>`).join("")}
      </div>
      ${admin ? `
        <div class="pos-form-actions">
          <button id="posBtnSaveProfile" class="btn btn-primary">Guardar perfil</button>
        </div>` : ""}
    </div>`;
}

// ── TAB: NÓMINA ───────────────────────────────────────────────────────────────

function _nominaTab(payrollVals, admin) {
  const activeVal = payrollVals.find(v => v.active) || null;
  const SALARY_TYPES = [
    { v: "mensual", l: "Mensual" }, { v: "diario", l: "Diario" },
    { v: "por_hora", l: "Por hora" }, { v: "prestacion_servicios", l: "Prestación de servicios" },
  ];

  return `
    <div class="pos-form-card">
      <div class="pos-panel-hdr-row">
        <h4 class="pos-section-hdr">Valores de nómina</h4>
        ${admin ? `<button id="posBtnAddPayroll" class="btn btn-secondary" style="font-size:12px">+ Agregar vigencia</button>` : ""}
      </div>

      ${payrollVals.length === 0 ? `<div class="pw-empty" style="padding:24px">No hay valores de nómina configurados.</div>` : ""}

      ${payrollVals.map(v => `
        <div class="pos-payroll-card ${v.active ? "pos-payroll-active" : "pos-payroll-inactive"}">
          <div class="pos-payroll-header">
            <div>
              <span class="pos-payroll-type">${SALARY_TYPE_LABELS[v.salaryType] || v.salaryType}</span>
              ${v.validFrom ? `<span class="pos-payroll-range">Vigente: ${fmtDate(v.validFrom)}${v.validUntil ? " — " + fmtDate(v.validUntil) : " en adelante"}</span>` : ""}
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="pos-status-badge ${v.active ? "pos-active" : "pos-inactive"}">${v.active ? "Vigente" : "Vencido"}</span>
              ${admin ? `<button class="pos-action-btn pos-btn-edit-pv" data-id="${v.id}">Editar</button>` : ""}
            </div>
          </div>
          <div class="pos-payroll-grid">
            <div><span class="pos-pv-lbl">Salario base</span><span class="pos-pv-val">${fmtCOP(v.baseSalary)}</span></div>
            <div><span class="pos-pv-lbl">Aux. transporte</span><span class="pos-pv-val">${fmtCOP(v.transportAllowance)}</span></div>
            <div><span class="pos-pv-lbl">Valor día</span><span class="pos-pv-val">${fmtCOP(v.dayValue)}</span></div>
            <div><span class="pos-pv-lbl">Valor hora</span><span class="pos-pv-val">${fmtCOP(v.hourValue)}</span></div>
            <div><span class="pos-pv-lbl">Bonificación fija</span><span class="pos-pv-val">${fmtCOP(v.fixedBonus)}</span></div>
            <div><span class="pos-pv-lbl">Recargo dom./fest.</span><span class="pos-pv-val">${fmtCOP(v.sundaySurcharge)}</span></div>
            <div><span class="pos-pv-lbl">Prestaciones sociales</span><span class="pos-pv-val ${v.appliesBenefits ? "pos-bool-yes" : "pos-bool-no"}">${v.appliesBenefits ? "Sí" : "No"}</span></div>
            <div><span class="pos-pv-lbl">Seguridad social</span><span class="pos-pv-val ${v.appliesSocialSecurity ? "pos-bool-yes" : "pos-bool-no"}">${v.appliesSocialSecurity ? "Sí" : "No"}</span></div>
          </div>
          ${v.notes ? `<div class="pos-pv-notes">${escapeHtml(v.notes)}</div>` : ""}
        </div>`).join("")}

      <!-- Formulario para nueva vigencia (oculto por defecto) -->
      <div id="posPayrollForm" class="pos-payroll-form-wrap" style="display:none">
        <h5 class="pos-section-hdr" style="margin-top:16px">Nueva vigencia de nómina</h5>
        <div class="pos-form-grid">
          <div class="pos-field">
            <label class="pos-label">Tipo de salario</label>
            <select id="pvSalaryType" class="pos-select">
              ${SALARY_TYPES.map(t => `<option value="${t.v}">${t.l}</option>`).join("")}
            </select>
          </div>
          <div class="pos-field">
            <label class="pos-label">Salario base</label>
            <input id="pvBaseSalary" type="number" min="0" class="pos-input" placeholder="1423500" />
          </div>
          <div class="pos-field">
            <label class="pos-label">Aux. transporte</label>
            <input id="pvTransport" type="number" min="0" class="pos-input" placeholder="202050" />
          </div>
          <div class="pos-field">
            <label class="pos-label">Valor día</label>
            <input id="pvDayValue" type="number" min="0" class="pos-input" placeholder="Auto" />
          </div>
          <div class="pos-field">
            <label class="pos-label">Valor hora</label>
            <input id="pvHourValue" type="number" min="0" class="pos-input" placeholder="Auto" />
          </div>
          <div class="pos-field">
            <label class="pos-label">Bonificación fija</label>
            <input id="pvFixedBonus" type="number" min="0" class="pos-input" placeholder="0" />
          </div>
          <div class="pos-field">
            <label class="pos-label">Recargo dom./fest.</label>
            <input id="pvSundaySurcharge" type="number" min="0" class="pos-input" placeholder="0" />
          </div>
          <div class="pos-field">
            <label class="pos-label">Vigente desde</label>
            <input id="pvValidFrom" type="date" class="pos-input" />
          </div>
          <div class="pos-field">
            <label class="pos-label">Vigente hasta</label>
            <input id="pvValidUntil" type="date" class="pos-input" />
          </div>
          <div class="pos-field pos-field-inline">
            <label class="pos-label">Prestaciones sociales</label>
            <label class="pos-toggle"><input type="checkbox" id="pvBenefits" checked /><span class="pos-toggle-slider"></span></label>
          </div>
          <div class="pos-field pos-field-inline">
            <label class="pos-label">Seguridad social</label>
            <label class="pos-toggle"><input type="checkbox" id="pvSocialSec" checked /><span class="pos-toggle-slider"></span></label>
          </div>
          <div class="pos-field pos-field-wide">
            <label class="pos-label">Notas</label>
            <input id="pvNotes" type="text" class="pos-input" placeholder="Observaciones..." />
          </div>
        </div>
        <div class="pos-form-actions">
          <button id="posBtnCancelPayroll" class="btn btn-secondary">Cancelar</button>
          <button id="posBtnSavePayroll" class="btn btn-primary">Guardar vigencia</button>
        </div>
      </div>
    </div>`;
}

// ── TAB: DOCUMENTOS ───────────────────────────────────────────────────────────

function _documentosTab(docReqs, docTypes, admin) {
  const reqIds = new Set(docReqs.map(d => d.documentTypeId));

  return `
    <div class="pos-form-card">
      <div class="pos-panel-hdr-row">
        <h4 class="pos-section-hdr">Documentos requeridos</h4>
      </div>
      <p class="pos-help-text">Marca los documentos que se exigen para este cargo. Los cambios se guardan al hacer clic en cada ítem.</p>

      ${docTypes.length === 0 ? `<div class="pw-empty" style="padding:16px">No hay tipos de documento configurados.</div>` : `
        <div class="pos-doc-list">
          ${docTypes.map(dt => {
            const req = docReqs.find(r => r.documentTypeId === dt.id);
            const checked = !!req;
            return `
              <div class="pos-doc-item ${checked ? "pos-doc-checked" : ""}">
                <label class="pos-doc-check-label">
                  ${admin ? `<input type="checkbox" class="pos-doc-checkbox" data-dt-id="${dt.id}" ${checked ? "checked" : ""} />` : ""}
                  <div class="pos-doc-info">
                    <span class="pos-doc-name">${escapeHtml(dt.name)}</span>
                    <span class="pos-doc-code">${escapeHtml(dt.code || "")}</span>
                    ${dt.phase ? `<span class="pos-doc-phase">${escapeHtml(dt.phase)}</span>` : ""}
                  </div>
                  ${checked ? '<span class="pos-doc-required-tag">Requerido</span>' : ""}
                </label>
                ${checked && req.notes ? `<div class="pos-doc-notes">${escapeHtml(req.notes)}</div>` : ""}
              </div>`;
          }).join("")}
        </div>`}
    </div>`;
}

// ── EVENT WIRING ──────────────────────────────────────────────────────────────

export function wirePositionsEvents() {
  setTimeout(() => {
    // Back to list
    const backList = () => {
      state.posViewMode  = "list";
      state.posSelectedId = null;
      state.posTab = "datos";
      reload();
    };
    document.getElementById("posBtnBackList")?.addEventListener("click", backList);
    document.getElementById("posBtnBackList2")?.addEventListener("click", backList);

    // New cargo
    document.getElementById("posNewBtn")?.addEventListener("click", () => {
      state.posViewMode = "create";
      reload();
    });

    // Filters
    const applyFilters = () => {
      state.posFilters = {
        search:     document.getElementById("posSearch")?.value   || "",
        companyId:  document.getElementById("posCompany")?.value  || "",
        contractId: document.getElementById("posContract")?.value || "",
        area:       document.getElementById("posArea")?.value     || "",
        status:     document.getElementById("posStatus")?.value   || "",
      };
      reload();
    };
    ["posSearch"].forEach(id => document.getElementById(id)?.addEventListener("input", applyFilters));
    ["posCompany","posContract","posArea","posStatus"].forEach(id =>
      document.getElementById(id)?.addEventListener("change", applyFilters)
    );
    document.getElementById("posClearFilters")?.addEventListener("click", () => {
      state.posFilters = { companyId: "", contractId: "", area: "", status: "", search: "" };
      reload();
    });

    // Open detail
    document.querySelectorAll(".pos-btn-view").forEach(btn => {
      btn.addEventListener("click", () => {
        state.posSelectedId = Number(btn.dataset.id);
        state.posViewMode   = "detail";
        state.posTab        = "datos";
        reload();
      });
    });

    // Toggle status from list
    document.querySelectorAll(".pos-btn-toggle").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id     = Number(btn.dataset.id);
        const active = btn.dataset.active === "true";
        if (!confirm(`¿${active ? "Inactivar" : "Activar"} este cargo?`)) return;
        try {
          await apiFetch(`/admin/positions/${id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: !active }),
          });
          showSuccess(`Cargo ${!active ? "activado" : "inactivado"}.`, "Listo");
          reload();
        } catch (err) { showError(err.message); }
      });
    });

    // Tabs
    document.querySelectorAll(".pos-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        state.posTab = btn.dataset.tab;
        reload();
      });
    });

    // Save Datos (create or edit)
    document.getElementById("posBtnSaveDatos")?.addEventListener("click", async (e) => {
      const btn    = e.currentTarget;
      const isEdit = btn.dataset.edit === "true";
      const posId  = btn.dataset.id;
      const payload = {
        name:             document.getElementById("posName")?.value || "",
        companyId:        document.getElementById("posCompanyId")?.value || "",
        contractId:       document.getElementById("posContractId")?.value || null,
        area:             document.getElementById("posArea")?.value || "",
        profileLevel:     document.getElementById("posProfileLevel")?.value || "",
        positionType:     document.getElementById("posPositionType")?.value || "",
        category:         document.getElementById("posCategory")?.value || "",
        appliesCoverage:  document.getElementById("posAppliesCoverage")?.checked ?? false,
        active:           isEdit ? (document.getElementById("posActive")?.checked ?? true) : true,
      };
      if (!payload.name) { showWarning("El nombre del cargo es obligatorio."); return; }
      if (!payload.companyId) { showWarning("Selecciona la empresa."); return; }
      btn.disabled = true; btn.textContent = isEdit ? "Guardando..." : "Creando...";
      try {
        if (isEdit) {
          await apiFetch(`/admin/positions/${posId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          showSuccess("Cargo actualizado.", "Listo");
          reload();
        } else {
          const r = await apiFetch("/admin/positions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          showSuccess("Cargo creado.", "Listo");
          state.posViewMode   = "detail";
          state.posSelectedId = r.data.id;
          state.posTab        = "perfil";
          reload();
        }
      } catch (err) {
        showError(err.message || "Error al guardar.");
        btn.disabled = false; btn.textContent = isEdit ? "Guardar cambios" : "Crear cargo";
      }
    });

    // Save Profile
    document.getElementById("posBtnSaveProfile")?.addEventListener("click", async () => {
      const btn = document.getElementById("posBtnSaveProfile");
      btn.disabled = true; btn.textContent = "Guardando...";
      try {
        await apiFetch(`/admin/positions/${state.posSelectedId}/profile`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objective:        document.getElementById("profObjective")?.value       || "",
            mainFunctions:    document.getElementById("profMainFunctions")?.value   || "",
            educationReq:     document.getElementById("profEducationReq")?.value    || "",
            minExperience:    document.getElementById("profMinExperience")?.value   || "",
            certifications:   document.getElementById("profCertifications")?.value  || "",
            responsibilities: document.getElementById("profResponsibilities")?.value || "",
            observations:     document.getElementById("profObservations")?.value    || "",
          }),
        });
        showSuccess("Perfil guardado.", "Listo");
        reload();
      } catch (err) {
        showError(err.message || "Error al guardar.");
        btn.disabled = false; btn.textContent = "Guardar perfil";
      }
    });

    // Payroll: show/hide form
    document.getElementById("posBtnAddPayroll")?.addEventListener("click", () => {
      const f = document.getElementById("posPayrollForm");
      if (f) f.style.display = f.style.display === "none" ? "block" : "none";
    });
    document.getElementById("posBtnCancelPayroll")?.addEventListener("click", () => {
      const f = document.getElementById("posPayrollForm");
      if (f) f.style.display = "none";
    });

    // Payroll: save new value
    document.getElementById("posBtnSavePayroll")?.addEventListener("click", async () => {
      const btn = document.getElementById("posBtnSavePayroll");
      btn.disabled = true; btn.textContent = "Guardando...";
      try {
        await apiFetch(`/admin/positions/${state.posSelectedId}/payroll-values`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            salaryType:            document.getElementById("pvSalaryType")?.value || "mensual",
            baseSalary:            document.getElementById("pvBaseSalary")?.value || 0,
            transportAllowance:    document.getElementById("pvTransport")?.value  || 0,
            dayValue:              document.getElementById("pvDayValue")?.value   || null,
            hourValue:             document.getElementById("pvHourValue")?.value  || null,
            fixedBonus:            document.getElementById("pvFixedBonus")?.value || 0,
            sundaySurcharge:       document.getElementById("pvSundaySurcharge")?.value || 0,
            validFrom:             document.getElementById("pvValidFrom")?.value  || null,
            validUntil:            document.getElementById("pvValidUntil")?.value || null,
            appliesBenefits:       document.getElementById("pvBenefits")?.checked ?? true,
            appliesSocialSecurity: document.getElementById("pvSocialSec")?.checked ?? true,
            notes:                 document.getElementById("pvNotes")?.value || "",
          }),
        });
        showSuccess("Vigencia de nómina creada.", "Listo");
        reload();
      } catch (err) {
        showError(err.message || "Error al guardar.");
        btn.disabled = false; btn.textContent = "Guardar vigencia";
      }
    });

    // Document requirements: toggle on checkbox change
    document.querySelectorAll(".pos-doc-checkbox").forEach(chk => {
      chk.addEventListener("change", async () => {
        const dtId = Number(chk.dataset.dtId);
        try {
          if (chk.checked) {
            await apiFetch(`/admin/positions/${state.posSelectedId}/document-requirements`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ documentTypeId: dtId, required: true }),
            });
            showInfo("Documento requerido agregado.", "Actualizado");
          } else {
            // Find the requirement id via current docReqs (we need to refetch)
            const r = await apiFetch(`/admin/positions/${state.posSelectedId}/document-requirements`);
            const reqs = Array.isArray(r.data) ? r.data : [];
            const req  = reqs.find(x => x.documentTypeId === dtId);
            if (req) {
              await apiFetch(`/admin/position-document-requirements/${req.id}`, { method: "DELETE" });
              showInfo("Documento removido.", "Actualizado");
            }
          }
          // Visual update without full reload
          const item = chk.closest(".pos-doc-item");
          if (item) {
            item.classList.toggle("pos-doc-checked", chk.checked);
            const tag = item.querySelector(".pos-doc-required-tag");
            if (chk.checked && !tag) {
              const span = document.createElement("span");
              span.className = "pos-doc-required-tag";
              span.textContent = "Requerido";
              chk.closest(".pos-doc-check-label").appendChild(span);
            } else if (!chk.checked && tag) {
              tag.remove();
            }
          }
        } catch (err) {
          showError(err.message || "Error al actualizar.");
          chk.checked = !chk.checked;
        }
      });
    });
  }, 80);
}
