import { state } from "../state.js";
import { apiFetch } from "../api.js";
import { escapeHtml } from "../utils.js";
import { showSuccess, showError } from "../toast.js";

const NOVELTY_TYPES = [
  "incapacidad",
  "ausencia",
  "permiso",
  "licencia",
  "reemplazo",
  "turno_adicional",
  "descuento",
  "bonificacion",
  "recargo",
  "suspension",
  "ingreso",
  "retiro",
  "dias_no_laborados",
  "otros",
];

let periods = [];
let activePeriod = null;
let groupsState = { positions: [], groups: [] };
let activePosition = "";
let activeGroupId = null;
let activeGroupDetail = null;
let periodMonth = new Date().toISOString().slice(0, 7);
let municipalitySearch = "";

function contractId() {
  return state.currentUser?.contractId || state.currentUser?.contract_id || null;
}

function companyId() {
  return state.currentUser?.companyId || state.currentUser?.company_id || null;
}

function isTH() {
  const role = String(state.currentUser?.role || "").toLowerCase();
  return role === "administrador" || role === "talento_humano";
}

function fmtCOP(value) {
  return Number(value || 0).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });
}

function statusBadge(status) {
  const s = String(status || "pendiente");
  const label = {
    pendiente: "Pendiente",
    en_revision: "En revision",
    revisada: "Revisada",
    cerrada: "Cerrada",
    BORRADOR: "Borrador",
    CALCULADO: "Calculado",
    CERRADO: "Cerrado",
  }[s] || s;
  return `<span class="nm-pay-badge nm-pay-badge--${escapeHtml(s.toLowerCase())}">${escapeHtml(label)}</span>`;
}

function pendingSupportBadge(count) {
  const total = Number(count || 0);
  return total
    ? `<span class="nm-pay-doc">Soportes pendientes: ${total}</span>`
    : `<span class="nm-pay-ok">Soportes al dia</span>`;
}

function currentPositionData() {
  return groupsState.positions.find((p) => p.position === activePosition) || groupsState.positions[0] || null;
}

function currentMunicipalityData() {
  const position = currentPositionData();
  return position?.municipalities?.find((m) => Number(m.id) === Number(activeGroupId)) || null;
}

function normalized(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function shell() {
  return `
<style>
.nm-pay-shell{display:flex;flex-direction:column;min-height:0}
.nm-pay-card-main{display:flex;flex-direction:column;min-height:0;overflow:hidden;max-height:calc(100vh - 180px);background:#fff;border:1px solid #E2E8F0;border-radius:8px}
.nm-pay-panel{padding:12px}
.nm-pay-head{padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:1px solid #E2E8F0;background:#fff}
.nm-pay-title{font-size:17px;font-weight:800;color:#0F172A;margin:0}
.nm-pay-sub{font-size:12px;color:#64748B;margin-top:2px}
.nm-pay-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.nm-pay-input,.nm-pay-select,.nm-pay-textarea{border:1px solid #CBD5E1;border-radius:6px;padding:7px 9px;background:#fff;color:#0F172A;min-height:34px}
.nm-pay-textarea{width:100%;min-height:70px;resize:vertical}
.nm-pay-btn{border:1px solid #CBD5E1;background:#fff;border-radius:6px;padding:7px 10px;cursor:pointer;color:#0F172A;font-weight:700}
.nm-pay-btn:hover{background:#F8FAFC}
.nm-pay-btn--primary{background:#0F766E;color:#fff;border-color:#0F766E}
.nm-pay-btn--danger{background:#B91C1C;color:#fff;border-color:#B91C1C}
.nm-pay-btn--sm{padding:5px 8px;font-size:12px}
.nm-pay-kpis{display:grid;grid-template-columns:repeat(6,minmax(100px,1fr));gap:0;border-bottom:1px solid #E2E8F0;background:#F8FAFC}
.nm-pay-kpi{padding:7px 10px;border-right:1px solid #E2E8F0;min-width:0}
.nm-pay-kpi:last-child{border-right:0}
.nm-pay-kpi span{display:block;font-size:11px;color:#64748B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nm-pay-kpi b{display:block;margin-top:2px;color:#0F172A;font-size:14px}
.nm-pay-cargo-tabs{display:flex;gap:6px;overflow:auto;padding:8px 10px;border-bottom:1px solid #E2E8F0;background:#fff;flex:0 0 auto}
.nm-pay-tab{border:1px solid #CBD5E1;background:#fff;border-radius:6px;padding:7px 9px;cursor:pointer;white-space:nowrap;text-align:left;font-size:12px}
.nm-pay-tab.active{border-color:#0F766E;background:#ECFDF5;color:#0F766E}
.nm-pay-count{display:inline-flex;min-width:19px;height:19px;align-items:center;justify-content:center;border-radius:999px;background:#E2E8F0;font-size:11px;margin-left:5px;color:#334155}
.nm-pay-workspace{flex:1 1 auto;min-height:0;overflow:hidden;display:flex}
.nm-pay-municipality-panel{width:260px;flex:0 0 260px;min-height:0;overflow:hidden;border-right:1px solid #E2E8F0;background:#F8FAFC;display:flex;flex-direction:column}
.nm-pay-mun-head{padding:10px;border-bottom:1px solid #E2E8F0}
.nm-pay-mun-title{font-size:12px;font-weight:800;color:#334155;text-transform:uppercase;margin-bottom:8px}
.nm-pay-mun-search{width:100%;border:1px solid #CBD5E1;border-radius:6px;padding:7px 9px;font-size:12px;background:#fff}
.nm-pay-mun-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px}
.nm-pay-mun{width:100%;border:0;background:transparent;border-radius:6px;padding:8px;cursor:pointer;text-align:left;display:grid;grid-template-columns:1fr auto;gap:4px 8px;align-items:center;color:#0F172A}
.nm-pay-mun:hover{background:#EEF2F7}
.nm-pay-mun.active{background:#ECFDF5;color:#0F766E;box-shadow:inset 3px 0 0 #0F766E}
.nm-pay-mun-name{font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nm-pay-mun-meta{font-size:11px;color:#64748B}
.nm-pay-mun-alert{font-size:11px;background:#FEF3C7;color:#92400E;border-radius:999px;padding:2px 6px;justify-self:end}
.nm-pay-content{flex:1 1 auto;min-width:0;min-height:0;overflow:auto;padding:10px;background:#fff}
.nm-pay-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;position:sticky;top:0;background:#fff;z-index:2;padding-bottom:8px;border-bottom:1px solid #E2E8F0;margin-bottom:8px}
.nm-pay-section-title{font-size:15px;font-weight:800;color:#0F172A;margin:0}
.nm-pay-section-meta{font-size:12px;color:#64748B;margin-top:2px}
.nm-pay-table-wrap{overflow:auto;min-height:0;max-height:46vh;border:1px solid #E2E8F0;border-radius:8px}
.nm-pay-table{width:100%;border-collapse:collapse;font-size:13px}
.nm-pay-table th{background:#F1F5F9;color:#334155;text-align:left;padding:7px 8px;border-bottom:1px solid #CBD5E1;position:sticky;top:0;z-index:1}
.nm-pay-table td{padding:7px 8px;border-bottom:1px solid #E2E8F0;vertical-align:middle}
.nm-pay-table td.num,.nm-pay-table th.num{text-align:right}
.nm-pay-badge,.nm-pay-doc,.nm-pay-ok{display:inline-flex;border-radius:999px;padding:3px 8px;font-size:12px;font-weight:700}
.nm-pay-badge{background:#E2E8F0;color:#334155}
.nm-pay-doc{background:#FEF3C7;color:#92400E}
.nm-pay-ok{background:#DCFCE7;color:#166534}
.nm-pay-empty{padding:24px;text-align:center;color:#64748B;border:1px dashed #CBD5E1;border-radius:8px;background:#F8FAFC}
.nm-pay-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.nm-pay-novelties{margin-top:10px;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden}
.nm-pay-novelties-h{padding:8px 10px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between}
.nm-pay-novelties-b{max-height:25vh;overflow:auto}
.nm-pay-modal{position:fixed;inset:0;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
.nm-pay-modal[hidden]{display:none}
.nm-pay-dialog{width:min(760px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:8px;border:1px solid #CBD5E1}
.nm-pay-dialog-h{padding:14px 16px;border-bottom:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center}
.nm-pay-dialog-b{padding:16px;display:grid;gap:12px}
.nm-pay-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.nm-pay-field label{display:block;font-size:12px;color:#475569;margin-bottom:4px;font-weight:700}
.nm-pay-field input,.nm-pay-field select{width:100%}
@media (max-width:900px){.nm-pay-card-main{max-height:none}.nm-pay-kpis,.nm-pay-form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.nm-pay-head{align-items:stretch}.nm-pay-controls{width:100%}.nm-pay-workspace{flex-direction:column}.nm-pay-municipality-panel{width:auto;flex:0 0 210px;border-right:0;border-bottom:1px solid #E2E8F0}.nm-pay-table{font-size:12px}.nm-pay-table-wrap{max-height:45vh}}
</style>
<div class="nm-pay-shell">
  <div id="nmPayRoot"></div>
  <div class="nm-pay-modal" id="nmPayModal" hidden></div>
</div>`;
}

async function loadPeriods() {
  const cId = contractId();
  if (!cId) {
    periods = [];
    return;
  }
  const response = await apiFetch(`/payroll/periods?contractId=${cId}`);
  periods = Array.isArray(response.data) ? response.data : [];
  if (!activePeriod && periods.length) activePeriod = periods[0];
}

async function loadGroups() {
  if (!activePeriod) {
    groupsState = { positions: [], groups: [] };
    return;
  }
  const response = await apiFetch(`/payroll/${activePeriod.id}/groups`);
  groupsState = response.data || { positions: [], groups: [] };
  if (!activePosition && groupsState.positions.length) activePosition = groupsState.positions[0].position;
  const currentPosition = groupsState.positions.find((p) => p.position === activePosition) || groupsState.positions[0];
  if (!activeGroupId && currentPosition?.municipalities?.length) activeGroupId = currentPosition.municipalities[0].id;
}

async function loadGroupDetail() {
  if (!activePeriod || !activeGroupId) {
    activeGroupDetail = null;
    return;
  }
  const response = await apiFetch(`/payroll/${activePeriod.id}/groups/${activeGroupId}`);
  activeGroupDetail = response.data || null;
}

function periodOptions() {
  return periods.map((p) => `
    <option value="${p.id}" ${activePeriod?.id === p.id ? "selected" : ""}>
      ${escapeHtml(p.label || `${p.period_start} - ${p.period_end}`)}
    </option>`).join("");
}

function summaryTotals() {
  const positions = groupsState.positions || [];
  return positions.reduce((acc, pos) => {
    acc.employees += Number(pos.employees || 0);
    acc.novelties += Number(pos.novelties || 0);
    acc.reviewed += Number(pos.reviewed || 0);
    acc.pending_supports += Number(pos.pending_supports || 0);
    acc.total_devengado += Number(pos.total_devengado || 0);
    acc.total_deducciones += Number(pos.total_deducciones || 0);
    acc.neto += Number(pos.neto || 0);
    return acc;
  }, { employees: 0, novelties: 0, reviewed: 0, pending_supports: 0, total_devengado: 0, total_deducciones: 0, neto: 0 });
}

function render() {
  const root = document.getElementById("nmPayRoot");
  if (!root) return;
  const totals = summaryTotals();
  root.innerHTML = `
<div class="nm-pay-card-main">
<div class="nm-pay-head">
  <div>
    <h2 class="nm-pay-title">Nomina y novedades</h2>
    <div class="nm-pay-sub">Flujo por cargo real, municipio, novedades, revision y soportes documentales.</div>
  </div>
  <div class="nm-pay-controls">
    <input class="nm-pay-input" type="month" id="nmPayMonth" value="${escapeHtml(periodMonth)}">
    <select class="nm-pay-select" id="nmPayPeriod">
      ${periodOptions() || `<option value="">Sin periodos</option>`}
    </select>
    ${isTH() ? `<button class="nm-pay-btn nm-pay-btn--primary" id="nmPayCreate">Crear periodo</button>` : ""}
    <button class="nm-pay-btn" id="nmPaySupports">Control de soportes</button>
  </div>
</div>

<div class="nm-pay-kpis">
  <div class="nm-pay-kpi"><span>Empleados</span><b>${totals.employees}</b></div>
  <div class="nm-pay-kpi"><span>Novedades</span><b>${totals.novelties}</b></div>
  <div class="nm-pay-kpi"><span>Revisadas</span><b>${totals.reviewed}</b></div>
  <div class="nm-pay-kpi"><span>Pendientes</span><b>${Math.max(0, totals.novelties - totals.reviewed)}</b></div>
  <div class="nm-pay-kpi"><span>Devengado</span><b>${fmtCOP(totals.total_devengado)}</b></div>
  <div class="nm-pay-kpi"><span>Neto</span><b>${fmtCOP(totals.neto)}</b></div>
</div>

${activePeriod ? renderOperationalBody() : `<div class="nm-pay-empty">Crea o selecciona un periodo de nomina.</div>`}
</div>
`;
  wireStaticEvents();
}

function renderOperationalBody() {
  if (!groupsState.positions.length) {
    return `<div class="nm-pay-panel"><div class="nm-pay-empty">No hay cargos reales activos con empleados asignados a este contrato.</div></div>`;
  }
  const current = groupsState.positions.find((p) => p.position === activePosition) || groupsState.positions[0];
  return `
<div class="nm-pay-cargo-tabs">
    ${groupsState.positions.map((pos) => `
      <button class="nm-pay-tab ${pos.position === current.position ? "active" : ""}" data-position="${escapeHtml(pos.position)}">
        ${escapeHtml(pos.position)} <span class="nm-pay-count">${pos.employees}</span>
      </button>
    `).join("")}
</div>
<div class="nm-pay-workspace">
  ${renderMunicipalityPanel(current)}
  <div class="nm-pay-content">
    ${renderGroupDetail()}
  </div>
</div>
`;
}

function renderMunicipalityPanel(position) {
  const municipalities = Array.isArray(position?.municipalities) ? position.municipalities : [];
  const filtered = municipalities.filter((mun) =>
    !municipalitySearch || normalized(mun.municipality_name).includes(normalized(municipalitySearch))
  );
  return `
<aside class="nm-pay-municipality-panel">
  <div class="nm-pay-mun-head">
    <div class="nm-pay-mun-title">Municipios</div>
    <input class="nm-pay-mun-search" id="nmPayMunSearch" placeholder="Buscar municipio" value="${escapeHtml(municipalitySearch)}">
  </div>
  <div class="nm-pay-mun-list">
    ${filtered.length ? filtered.map((mun) => `
      <button class="nm-pay-mun ${Number(mun.id) === Number(activeGroupId) ? "active" : ""}" data-group-id="${mun.id}">
        <span class="nm-pay-mun-name">${escapeHtml(mun.municipality_name)}</span>
        <span class="nm-pay-count">${mun.employees}</span>
        <span class="nm-pay-mun-meta">${statusBadge(mun.status)}</span>
        ${Number(mun.pending_supports || 0) ? `<span class="nm-pay-mun-alert">${Number(mun.pending_supports)} doc</span>` : ""}
      </button>
    `).join("") : `<div class="nm-pay-empty" style="padding:16px">Sin municipios.</div>`}
  </div>
</aside>`;
}

function renderGroupDetail() {
  if (!activeGroupDetail) return `<div class="nm-pay-panel"><div class="nm-pay-empty">Selecciona un municipio para trabajar su nomina.</div></div>`;
  const { group, items, novelties, totals } = activeGroupDetail;
  const municipality = currentMunicipalityData();
  const municipalityName = municipality?.municipality_name || group.municipality_name || "";
  return `
<div class="nm-pay-toolbar">
    <div>
      <h3 class="nm-pay-section-title">${escapeHtml(municipalityName || "Municipio")}</h3>
      <div class="nm-pay-section-meta">${escapeHtml(group.operational_position || activePosition)} · ${statusBadge(group.status)} ${pendingSupportBadge(totals.pending_supports)}</div>
    </div>
    <div class="nm-pay-actions">
      <button class="nm-pay-btn nm-pay-btn--primary" id="nmPayCalculate">Calcular municipio</button>
      <button class="nm-pay-btn" id="nmPayExport">Exportar municipio</button>
    </div>
</div>

<div>
  ${items.length ? renderItemsTable(items) : `<div class="nm-pay-empty">Pulsa Calcular municipio para cargar los empleados activos de este municipio.</div>`}
</div>

<div class="nm-pay-novelties">
  <div class="nm-pay-novelties-h">
    <strong>Novedades</strong>
    <span class="nm-pay-mun-meta">${novelties.length} registradas · ${totals.reviewed || 0} revisadas</span>
  </div>
  <div class="nm-pay-novelties-b">
    ${novelties.length ? renderNoveltiesTable(novelties) : `<div class="nm-pay-empty" style="border:0;border-radius:0">Sin novedades registradas en este municipio.</div>`}
  </div>
</div>`;
}

function renderItemsTable(items) {
  return `
<div class="nm-pay-table-wrap">
<table class="nm-pay-table">
  <thead>
    <tr>
      <th>Empleado</th><th>Documento</th><th>Municipio</th><th>Cargo</th><th class="num">Salario</th>
      <th>Novedades</th><th>Revisada</th><th class="num">Devengado</th><th class="num">Deducciones</th><th class="num">Neto</th><th>Acciones</th>
    </tr>
  </thead>
  <tbody>
    ${items.map((item) => `
      <tr>
        <td>${escapeHtml(item.employee_name)}</td>
        <td>${escapeHtml(item.document_number || "")}</td>
        <td>${escapeHtml(item.municipality_name || "-")}</td>
        <td>${escapeHtml(item.operational_position || "-")}<br><small>${escapeHtml(item.modality || "-")} · ${escapeHtml(item.work_time_type || "-")}</small></td>
        <td class="num">${fmtCOP(item.base_salary)}</td>
        <td>${Number(item.novelty_count || 0)}</td>
        <td>${Number(item.novelty_count || 0) ? `${Number(item.reviewed_count || 0)}/${Number(item.novelty_count || 0)}` : "-"}</td>
        <td class="num">${fmtCOP(item.total_devengado)}</td>
        <td class="num">${fmtCOP(item.total_deducciones)}</td>
        <td class="num"><b>${fmtCOP(item.neto_pagar)}</b></td>
        <td><button class="nm-pay-btn nm-pay-btn--sm" data-new-novelty="${item.id}">Novedad</button></td>
      </tr>`).join("")}
  </tbody>
</table>
</div>`;
}

function renderNoveltiesTable(novelties) {
  return `
<table class="nm-pay-table">
  <thead>
    <tr>
      <th>Empleado</th><th>Novedad</th><th>Fechas</th><th class="num">Dias</th><th class="num">Valor</th><th>Soporte</th><th>Revisada</th><th></th>
    </tr>
  </thead>
  <tbody>
    ${novelties.map((novelty) => `
      <tr>
        <td>${escapeHtml(novelty.employee_name || "")}<br><small>${escapeHtml(novelty.document_number || "")}</small></td>
        <td>${escapeHtml(novelty.novelty_type || "")}<br><small>${escapeHtml(novelty.description || novelty.observations || "")}</small></td>
        <td>${escapeHtml(novelty.start_date || "-")} / ${escapeHtml(novelty.end_date || "-")}</td>
        <td class="num">${Number(novelty.days || 0)}</td>
        <td class="num">${fmtCOP(novelty.value)}</td>
        <td>${pendingSupportBadge(novelty.support_status === "pendiente" ? 1 : 0)}</td>
        <td><input type="checkbox" data-reviewed="${novelty.id}" ${novelty.reviewed ? "checked" : ""}></td>
        <td>
          <button class="nm-pay-btn nm-pay-btn--sm" data-edit-novelty="${novelty.id}" ${novelty.reviewed ? "disabled" : ""}>Editar</button>
          <button class="nm-pay-btn nm-pay-btn--sm" data-cover-novelty="${novelty.id}" ${novelty.reviewed ? "disabled" : ""}>Cubrio</button>
        </td>
      </tr>`).join("")}
  </tbody>
</table>`;
}

function wireStaticEvents() {
  document.getElementById("nmPayMonth")?.addEventListener("change", (event) => { periodMonth = event.target.value; });
  document.getElementById("nmPayPeriod")?.addEventListener("change", async (event) => {
    activePeriod = periods.find((p) => String(p.id) === String(event.target.value)) || null;
    activePosition = "";
    activeGroupId = null;
    municipalitySearch = "";
    await reloadWorkArea();
  });
  document.getElementById("nmPayCreate")?.addEventListener("click", createPeriod);
  document.getElementById("nmPaySupports")?.addEventListener("click", openSupportsModal);
  document.getElementById("nmPayMunSearch")?.addEventListener("input", (event) => {
    municipalitySearch = event.target.value || "";
    render();
    document.getElementById("nmPayMunSearch")?.focus();
  });
  document.querySelectorAll(".nm-pay-tab").forEach((button) => button.addEventListener("click", async () => {
    activePosition = button.dataset.position || "";
    const position = groupsState.positions.find((p) => p.position === activePosition);
    activeGroupId = position?.municipalities?.[0]?.id || null;
    municipalitySearch = "";
    await reloadDetailOnly();
  }));
  document.querySelectorAll(".nm-pay-mun").forEach((button) => button.addEventListener("click", async () => {
    activeGroupId = Number(button.dataset.groupId);
    await reloadDetailOnly();
  }));
  document.getElementById("nmPayCalculate")?.addEventListener("click", calculateGroup);
  document.getElementById("nmPayExport")?.addEventListener("click", exportMunicipality);
  document.querySelectorAll("[data-new-novelty]").forEach((button) => button.addEventListener("click", () => openNoveltyModal(Number(button.dataset.newNovelty))));
  document.querySelectorAll("[data-edit-novelty]").forEach((button) => button.addEventListener("click", () => openEditNoveltyModal(Number(button.dataset.editNovelty))));
  document.querySelectorAll("[data-cover-novelty]").forEach((button) => button.addEventListener("click", () => openCoverModal(Number(button.dataset.coverNovelty))));
  document.querySelectorAll("[data-reviewed]").forEach((input) => input.addEventListener("change", () => toggleReviewed(Number(input.dataset.reviewed), input.checked, input)));
}

async function createPeriod() {
  try {
    const response = await apiFetch("/payroll/periods", {
      method: "POST",
      body: JSON.stringify({ companyId: companyId(), contractId: contractId(), period: periodMonth }),
    });
    activePeriod = response.data;
    activePosition = "";
    activeGroupId = null;
    municipalitySearch = "";
    await loadPeriods();
    await reloadWorkArea();
    showSuccess("Periodo creado");
  } catch (err) {
    showError(err.message);
  }
}

async function reloadWorkArea() {
  await loadGroups();
  await loadGroupDetail();
  render();
}

async function reloadDetailOnly() {
  await loadGroupDetail();
  render();
}

async function calculateGroup() {
  if (!activeGroupId) return;
  try {
    await apiFetch(`/payroll/groups/${activeGroupId}/calculate`, { method: "POST" });
    await reloadWorkArea();
    showSuccess("Nomina municipal calculada");
  } catch (err) {
    showError(err.message);
  }
}

function exportMunicipality() {
  const detail = activeGroupDetail;
  if (!detail?.items?.length) return;
  const rows = [
    ["Empleado", "Documento", "Municipio", "Institucion", "Sede", "Modalidad", "Jornada", "Devengado", "Deducciones", "Neto"],
    ...detail.items.map((x) => [
      x.employee_name, x.document_number, x.municipality_name, x.institution_name, x.site_name,
      x.modality, x.work_time_type, x.total_devengado, x.total_deducciones, x.neto_pagar,
    ]),
  ];
  const csv = rows.map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `nomina-${detail.group.municipality_name || "municipio"}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function openNoveltyModal(itemId) {
  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<div class="nm-pay-dialog">
  <div class="nm-pay-dialog-h"><b>Registrar novedad</b><button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button></div>
  <div class="nm-pay-dialog-b">
    <div class="nm-pay-form-grid">
      <div class="nm-pay-field"><label>Tipo</label><select class="nm-pay-select" id="novType">${NOVELTY_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("")}</select></div>
      <div class="nm-pay-field"><label>Dias</label><input class="nm-pay-input" id="novDays" type="number" min="0" value="1"></div>
      <div class="nm-pay-field"><label>Inicio</label><input class="nm-pay-input" id="novStart" type="date"></div>
      <div class="nm-pay-field"><label>Fin</label><input class="nm-pay-input" id="novEnd" type="date"></div>
      <div class="nm-pay-field"><label>Valor</label><input class="nm-pay-input" id="novValue" type="number" min="0" value="0"></div>
      <div class="nm-pay-field"><label>Soporte requerido</label><select class="nm-pay-select" id="novSupport"><option value="false">No</option><option value="true">Si</option></select></div>
    </div>
    <div class="nm-pay-field"><label>Descripcion</label><textarea class="nm-pay-textarea" id="novDesc"></textarea></div>
    <button class="nm-pay-btn nm-pay-btn--primary" id="novSave">Guardar novedad</button>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();
  document.getElementById("novSave")?.addEventListener("click", async () => {
    try {
      await apiFetch(`/payroll/items/${itemId}/novelties`, {
        method: "POST",
        body: JSON.stringify({
          novelty_type: document.getElementById("novType").value,
          days: document.getElementById("novDays").value,
          start_date: document.getElementById("novStart").value,
          end_date: document.getElementById("novEnd").value,
          value: document.getElementById("novValue").value,
          support_required: document.getElementById("novSupport").value === "true",
          description: document.getElementById("novDesc").value,
        }),
      });
      closeModal();
      await reloadWorkArea();
      showSuccess("Novedad registrada");
    } catch (err) {
      showError(err.message);
    }
  });
}

function openEditNoveltyModal(noveltyId) {
  const novelty = activeGroupDetail?.novelties?.find((x) => Number(x.id) === Number(noveltyId));
  if (!novelty) return;
  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<div class="nm-pay-dialog">
  <div class="nm-pay-dialog-h"><b>Editar novedad</b><button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button></div>
  <div class="nm-pay-dialog-b">
    <div class="nm-pay-form-grid">
      <div class="nm-pay-field"><label>Tipo</label><select class="nm-pay-select" id="novType">${NOVELTY_TYPES.map((t) => `<option value="${t}" ${t === novelty.novelty_type ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="nm-pay-field"><label>Dias</label><input class="nm-pay-input" id="novDays" type="number" min="0" value="${Number(novelty.days || 0)}"></div>
      <div class="nm-pay-field"><label>Inicio</label><input class="nm-pay-input" id="novStart" type="date" value="${escapeHtml(String(novelty.start_date || "").slice(0, 10))}"></div>
      <div class="nm-pay-field"><label>Fin</label><input class="nm-pay-input" id="novEnd" type="date" value="${escapeHtml(String(novelty.end_date || "").slice(0, 10))}"></div>
      <div class="nm-pay-field"><label>Valor</label><input class="nm-pay-input" id="novValue" type="number" min="0" value="${Number(novelty.value || 0)}"></div>
    </div>
    <div class="nm-pay-field"><label>Descripcion</label><textarea class="nm-pay-textarea" id="novDesc">${escapeHtml(novelty.description || novelty.observations || "")}</textarea></div>
    <button class="nm-pay-btn nm-pay-btn--primary" id="novSave">Guardar cambios</button>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();
  document.getElementById("novSave")?.addEventListener("click", async () => {
    try {
      await apiFetch(`/payroll/novelties/${noveltyId}`, {
        method: "PATCH",
        body: JSON.stringify({
          novelty_type: document.getElementById("novType").value,
          days: document.getElementById("novDays").value,
          start_date: document.getElementById("novStart").value,
          end_date: document.getElementById("novEnd").value,
          value: document.getElementById("novValue").value,
          description: document.getElementById("novDesc").value,
        }),
      });
      closeModal();
      await reloadWorkArea();
      showSuccess("Novedad actualizada");
    } catch (err) {
      showError(err.message);
    }
  });
}

function openCoverModal(noveltyId) {
  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<div class="nm-pay-dialog">
  <div class="nm-pay-dialog-h"><b>Quien cubrio esta novedad</b><button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button></div>
  <div class="nm-pay-dialog-b">
    <div class="nm-pay-field"><label>Tipo de cobertura</label><select class="nm-pay-select" id="coverType"><option value="INTERNA">Interna</option><option value="EXTERNA">Externa</option></select></div>
    <div class="nm-pay-form-grid">
      <div class="nm-pay-field"><label>ID empleado interno</label><input class="nm-pay-input" id="coverInternal" placeholder="Solo para interna"></div>
      <div class="nm-pay-field"><label>Nombre externo</label><input class="nm-pay-input" id="coverName" placeholder="Solo para externa"></div>
      <div class="nm-pay-field"><label>Documento externo</label><input class="nm-pay-input" id="coverDoc"></div>
      <div class="nm-pay-field"><label>Telefono</label><input class="nm-pay-input" id="coverPhone"></div>
      <div class="nm-pay-field"><label>Banco</label><input class="nm-pay-input" id="coverBank"></div>
      <div class="nm-pay-field"><label>Cuenta</label><input class="nm-pay-input" id="coverAccount"></div>
      <div class="nm-pay-field"><label>Dias</label><input class="nm-pay-input" id="coverDays" type="number" value="1"></div>
      <div class="nm-pay-field"><label>Valor dia</label><input class="nm-pay-input" id="coverValue" type="number" value="0"></div>
    </div>
    <button class="nm-pay-btn nm-pay-btn--primary" id="coverSave">Guardar cobertura</button>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();
  document.getElementById("coverSave")?.addEventListener("click", async () => {
    try {
      await apiFetch(`/payroll/novelties/${noveltyId}/cover`, {
        method: "POST",
        body: JSON.stringify({
          cover_type: document.getElementById("coverType").value,
          internal_employee_id: document.getElementById("coverInternal").value,
          full_name: document.getElementById("coverName").value,
          document_number: document.getElementById("coverDoc").value,
          phone: document.getElementById("coverPhone").value,
          bank: document.getElementById("coverBank").value,
          account_number: document.getElementById("coverAccount").value,
          days: document.getElementById("coverDays").value,
          value_per_day: document.getElementById("coverValue").value,
        }),
      });
      closeModal();
      await reloadWorkArea();
      showSuccess("Cobertura registrada");
    } catch (err) {
      showError(err.message);
    }
  });
}

async function toggleReviewed(noveltyId, reviewed, input) {
  let reason = "";
  if (!reviewed) {
    reason = prompt("Motivo para quitar la marca de revisada") || "";
    if (!reason.trim()) {
      input.checked = true;
      return;
    }
  }
  try {
    await apiFetch(`/payroll/novelties/${noveltyId}/reviewed`, {
      method: "PATCH",
      body: JSON.stringify({ reviewed, reason }),
    });
    await reloadWorkArea();
    showSuccess("Revision actualizada");
  } catch (err) {
    input.checked = !reviewed;
    showError(err.message);
  }
}

async function openSupportsModal() {
  try {
    const params = activePeriod ? `?periodId=${activePeriod.id}` : "";
    const response = await apiFetch(`/payroll/supports${params}`);
    const supports = Array.isArray(response.data) ? response.data : [];
    const modal = document.getElementById("nmPayModal");
    modal.innerHTML = `
<div class="nm-pay-dialog">
  <div class="nm-pay-dialog-h"><b>Control de soportes de novedades</b><button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button></div>
  <div class="nm-pay-dialog-b">
    ${supports.length ? `
    <table class="nm-pay-table">
      <thead><tr><th>Empleado</th><th>Municipio</th><th>Novedad</th><th>Soporte</th><th>Estado</th><th>Observaciones</th><th></th></tr></thead>
      <tbody>${supports.map((s) => `
        <tr>
          <td>${escapeHtml(s.employee_name || "")}<br><small>${escapeHtml(s.document_number || "")}</small></td>
          <td>${escapeHtml(s.municipality_name || "")}</td>
          <td>${escapeHtml(s.novelty_type || "")}</td>
          <td>${escapeHtml(s.support_type || "")}</td>
          <td>${escapeHtml(s.status || "")}</td>
          <td>${escapeHtml(s.observations || "")}</td>
          <td>
            <button class="nm-pay-btn nm-pay-btn--sm" data-support-status="${s.id}" data-status="cargado">Cargado</button>
            <button class="nm-pay-btn nm-pay-btn--sm" data-support-status="${s.id}" data-status="aprobado">Aprobar</button>
            <button class="nm-pay-btn nm-pay-btn--sm" data-support-status="${s.id}" data-status="rechazado">Rechazar</button>
          </td>
        </tr>`).join("")}</tbody>
    </table>` : `<div class="nm-pay-empty">No hay soportes pendientes o registrados.</div>`}
    <div class="nm-pay-doc">Los soportes son informativos y no bloquean calculo, revision, cierre, exportacion ni pago.</div>
  </div>
</div>`;
    modal.hidden = false;
    wireModalClose();
    modal.querySelectorAll("[data-support-status]").forEach((button) => button.addEventListener("click", async () => {
      await apiFetch("/payroll/supports", {
        method: "POST",
        body: JSON.stringify({ id: button.dataset.supportStatus, status: button.dataset.status }),
      });
      closeModal();
      await reloadWorkArea();
      showSuccess("Soporte actualizado");
    }));
  } catch (err) {
    showError(err.message);
  }
}

function wireModalClose() {
  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModal));
}

function closeModal() {
  const modal = document.getElementById("nmPayModal");
  if (modal) {
    modal.hidden = true;
    modal.innerHTML = "";
  }
}

export async function loadPayrollModule() {
  periods = [];
  activePeriod = null;
  groupsState = { positions: [], groups: [] };
  activePosition = "";
  activeGroupId = null;
  activeGroupDetail = null;
  municipalitySearch = "";
  await loadPeriods();
  await loadGroups();
  await loadGroupDetail();
  return shell();
}

export function wirePayrollEvents() {
  render();
}
