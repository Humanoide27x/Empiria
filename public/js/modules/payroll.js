import { state } from "../state.js";
import { apiFetch } from "../api.js";
import { escapeHtml } from "../utils.js";
import { showSuccess, showError } from "../toast.js";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS OFICIALES DE NOVEDAD (12 — sincronizados con payroll_novelty_types)
// ─────────────────────────────────────────────────────────────────────────────
const NOVELTY_TYPES = [
  { code: "DIAS_NO_CLASE",                 name: "Días de No Clase",                 affects_salary: false, affects_transport: true,  requires_turn_cover: true  },
  { code: "CITA_MEDICA",                   name: "Cita Médica",                      affects_salary: false, affects_transport: true,  requires_turn_cover: false },
  { code: "INCAPACIDAD_MEDICA",            name: "Incapacidad Médica",               affects_salary: false, affects_transport: true,  requires_turn_cover: false },
  { code: "INCAPACIDAD_ACCIDENTE_LABORAL", name: "Incapacidad por Accidente Laboral",affects_salary: false, affects_transport: true,  requires_turn_cover: false },
  { code: "CALAMIDAD_FAMILIAR",            name: "Calamidad Familiar",               affects_salary: false, affects_transport: true,  requires_turn_cover: false },
  { code: "LUTO",                          name: "Luto",                             affects_salary: false, affects_transport: true,  requires_turn_cover: false },
  { code: "PERMISOS_NO_REMUNERADOS",       name: "Permisos No Remunerados",          affects_salary: true,  affects_transport: false, requires_turn_cover: false },
  { code: "CITACION_COLEGIO",              name: "Citación en Colegio",              affects_salary: false, affects_transport: true,  requires_turn_cover: false },
  { code: "LICENCIA_MATERNIDAD_PATERNIDAD",name: "Licencia de Maternidad/Paternidad",affects_salary: false, affects_transport: true,  requires_turn_cover: false },
  { code: "SUSPENSION",                    name: "Suspensión",                       affects_salary: true,  affects_transport: false, requires_turn_cover: false },
  { code: "FECHA_INGRESO",                 name: "Fecha de Ingreso",                 affects_salary: true,  affects_transport: false, requires_turn_cover: false },
  { code: "FECHA_RETIRO",                  name: "Fecha de Retiro",                  affects_salary: true,  affects_transport: false, requires_turn_cover: false },
  { code: "CAMBIO_OPERATIVO_COBERTURA",    name: "Cambio Operativo de Cobertura",    affects_salary: true,  affects_transport: true,  requires_turn_cover: false },
];

function noveltyByCode(code) {
  return NOVELTY_TYPES.find((t) => t.code === String(code).toUpperCase()) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO DEL MÓDULO
// ─────────────────────────────────────────────────────────────────────────────
let periods          = [];
let activePeriod     = null;
let groupsState      = { positions: [], groups: [] };
let activePosition   = "";
let activeGroupId    = null;
let activeGroupDetail = null;
let periodMonth      = new Date().toISOString().slice(0, 7);
let municipalitySearch = "";
let activeDetailTab  = "nomina"; // "nomina" | "novedades"

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE CONTEXTO
// ─────────────────────────────────────────────────────────────────────────────
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
    style: "currency", currency: "COP", maximumFractionDigits: 0,
  });
}
function normalized(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}
function statusBadge(status) {
  const s = String(status || "pendiente");
  const label = {
    pendiente: "Pendiente", en_revision: "En revision",
    revisada: "Revisada", cerrada: "Cerrada",
    BORRADOR: "Borrador", CALCULADO: "Calculado", CERRADO: "Cerrado",
  }[s] || s;
  return `<span class="nm-pay-badge nm-pay-badge--${escapeHtml(s.toLowerCase())}">${escapeHtml(label)}</span>`;
}
function pendingSupportBadge(count) {
  const total = Number(count || 0);
  return total
    ? `<span class="nm-pay-doc">Soportes pendientes: ${total}</span>`
    : `<span class="nm-pay-ok">Soportes al dia</span>`;
}
function noveltyImpactBadges(noveltyOrCode) {
  const meta = typeof noveltyOrCode === "string" ? noveltyByCode(noveltyOrCode) : noveltyOrCode;
  if (!meta) return "";
  const parts = [];
  if (meta.affects_salary)    parts.push(`<span class="nm-badge-sal">↓ Salario</span>`);
  if (meta.affects_transport) parts.push(`<span class="nm-badge-tra">↓ Transporte</span>`);
  return parts.join(" ");
}
function currentPositionData() {
  return groupsState.positions.find((p) => p.position === activePosition) || groupsState.positions[0] || null;
}
function noveltyImpactText(noveltyOrCode) {
  const meta = typeof noveltyOrCode === "string" ? noveltyByCode(noveltyOrCode) : noveltyOrCode;
  if (!meta) return "Sin impacto economico";
  const parts = [];
  if (meta.affects_salary) parts.push("descuenta salario");
  if (meta.affects_transport) parts.push("descuenta transporte");
  return parts.length ? parts.join(" · ") : "sin impacto economico";
}
function noveltyImpactChipsHtml(noveltyOrCode) {
  const meta = typeof noveltyOrCode === "string" ? noveltyByCode(noveltyOrCode) : noveltyOrCode;
  if (!meta) return "";
  const parts = [];
  if (meta.affects_salary)    parts.push(`<span class="nm-badge-sal">Descuenta salario</span>`);
  if (meta.affects_transport) parts.push(`<span class="nm-badge-tra">Descuenta transporte</span>`);
  return parts.join(" ");
}
function noveltyImpactNoticeHtml(noveltyOrCode) {
  return `
    <div class="nm-pay-impact-note">
      <div class="nm-pay-impact-badges">${noveltyImpactChipsHtml(noveltyOrCode)}</div>
      <div class="nm-pay-impact-text">Impacto: ${escapeHtml(noveltyImpactText(noveltyOrCode))}</div>
    </div>`;
}
function currentMunicipalityData() {
  const position = currentPositionData();
  return position?.municipalities?.find((m) => Number(m.id) === Number(activeGroupId)) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS DEL MÓDULO
// ─────────────────────────────────────────────────────────────────────────────
function shell() {
  return `
<style>
/* ── Shell ───────────────────────────────────────────────────────────── */
.nm-pay-shell{display:flex;flex-direction:column;min-height:0}
.nm-pay-card-main{display:flex;flex-direction:column;min-height:0;overflow:hidden;height:calc(100vh - 100px);background:#fff;border:1px solid #E2E8F0;border-radius:8px}

/* ── Encabezado: UNA SOLA FILA compacta, sin wrap ────────────────────── */
.nm-pay-head{padding:4px 10px;display:flex;align-items:center;gap:5px;flex-wrap:nowrap;border-bottom:1px solid #E2E8F0;background:#fff;height:36px;flex:0 0 36px;overflow-x:auto;overflow-y:hidden}
.nm-pay-title{font-size:13px;font-weight:800;color:#0F172A;margin:0;white-space:nowrap;letter-spacing:.01em;flex-shrink:0}
.nm-pay-head-sep{width:1px;height:18px;background:#E2E8F0;flex-shrink:0}
.nm-pay-head-spacer{flex:1 1 auto;min-width:8px}

/* ── Inputs/Selects del encabezado: tamaño compacto ─────────────────── */
.nm-pay-input,.nm-pay-select{border:1px solid #CBD5E1;border-radius:5px;background:#fff;color:#0F172A;font-size:12px;padding:3px 7px;height:26px;line-height:1}
.nm-pay-input--sm{font-size:12px;padding:3px 7px;height:26px}
.nm-pay-textarea{width:100%;min-height:70px;resize:vertical;border:1px solid #CBD5E1;border-radius:6px;padding:7px 9px;font-size:13px}
.nm-pay-btn{border:1px solid #CBD5E1;background:#fff;border-radius:5px;padding:4px 9px;cursor:pointer;color:#0F172A;font-weight:700;font-size:12px;white-space:nowrap;flex-shrink:0}
.nm-pay-btn:hover{background:#F8FAFC}
.nm-pay-btn--primary{background:#0F766E;color:#fff;border-color:#0F766E}
.nm-pay-btn--danger{background:#B91C1C;color:#fff;border-color:#B91C1C}
.nm-pay-btn--sm{padding:3px 8px;font-size:12px}

/* ── Pestañas de cargos: barra propia, no mezclada ──────────────────── */
.nm-pay-cargo-tabs{display:flex;gap:5px;overflow-x:auto;overflow-y:hidden;padding:5px 10px;border-bottom:1px solid #E2E8F0;background:#F8FAFC;flex:0 0 auto;align-items:center;min-height:36px}
.nm-pay-tab{border:1px solid #CBD5E1;background:#fff;border-radius:5px;padding:4px 10px;cursor:pointer;white-space:nowrap;text-align:left;font-size:12px;font-weight:600;flex-shrink:0}
.nm-pay-tab.active{border-color:#0F766E;background:#ECFDF5;color:#0F766E;font-weight:700}
.nm-pay-count{display:inline-flex;min-width:18px;height:18px;align-items:center;justify-content:center;border-radius:999px;background:#E2E8F0;font-size:11px;margin-left:4px;color:#334155}

/* ── KPIs del municipio seleccionado ────────────────────────────────── */
.nm-pay-kpis{display:grid;grid-template-columns:minmax(110px,1.4fr) repeat(5,minmax(90px,1fr));gap:0;border-bottom:1px solid #E2E8F0;background:#F8FAFC;flex:0 0 auto}
.nm-pay-kpi{padding:5px 10px;border-right:1px solid #E2E8F0;min-width:0}
.nm-pay-kpi:last-child{border-right:0}
.nm-pay-kpi span{display:block;font-size:10px;color:#64748B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase;letter-spacing:.02em}
.nm-pay-kpi b{display:block;margin-top:1px;color:#0F172A;font-size:13px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nm-pay-kpi--ctx span{color:#0F766E;font-weight:700}
.nm-pay-kpi--ctx b{color:#0F766E;font-size:12px}

/* ── Área de trabajo: panel municipios + contenido ──────────────────── */
.nm-pay-workspace{flex:1 1 auto;min-height:0;overflow:hidden;display:flex}
.nm-pay-municipality-panel{width:220px;flex:0 0 220px;min-height:0;overflow:hidden;border-right:1px solid #E2E8F0;background:#F8FAFC;display:flex;flex-direction:column}
.nm-pay-mun-head{padding:10px;border-bottom:1px solid #E2E8F0}
.nm-pay-mun-title{font-size:12px;font-weight:800;color:#334155;text-transform:uppercase;margin-bottom:8px}
.nm-pay-mun-head{padding:8px 10px;border-bottom:1px solid #E2E8F0;flex:0 0 auto}
.nm-pay-mun-title{font-size:11px;font-weight:800;color:#334155;text-transform:uppercase;margin-bottom:6px}
.nm-pay-mun-search{width:100%;border:1px solid #CBD5E1;border-radius:5px;padding:4px 8px;font-size:12px;background:#fff}
.nm-pay-mun-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:4px}
.nm-pay-mun{width:100%;border:0;background:transparent;border-radius:5px;padding:6px 8px;cursor:pointer;text-align:left;display:grid;grid-template-columns:1fr auto;gap:2px 6px;align-items:center;color:#0F172A}
.nm-pay-mun:hover{background:#EEF2F7}
.nm-pay-mun.active{background:#ECFDF5;color:#0F766E;box-shadow:inset 3px 0 0 #0F766E}
.nm-pay-mun-name{font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nm-pay-mun-meta{font-size:11px;color:#64748B}
.nm-pay-mun-alert{font-size:11px;background:#FEF3C7;color:#92400E;border-radius:999px;padding:2px 6px;justify-self:end}

/* ── Panel de contenido: flex column, toolbar fijo, body scrollable ── */
.nm-pay-content{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:#fff}
.nm-pay-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex:0 0 auto;padding:8px 10px;border-bottom:1px solid #E2E8F0;background:#fff}
.nm-pay-scroll-body{flex:1 1 auto;min-height:0;overflow:auto;padding:10px}
.nm-pay-section-title{font-size:14px;font-weight:800;color:#0F172A;margin:0}
.nm-pay-section-meta{font-size:12px;color:#64748B;margin-top:1px}
.nm-pay-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}

/* ── Tabla: el wrapper es el scroll container; thead sticky dentro de él ─ */
.nm-pay-table-wrap{overflow:auto;border:1px solid #E2E8F0;border-radius:6px;max-height:calc(100vh - 400px);min-height:120px}
.nm-pay-table{width:100%;border-collapse:collapse;font-size:13px}
.nm-pay-table thead th{background:#F1F5F9;color:#334155;text-align:left;padding:6px 8px;border-bottom:1px solid #CBD5E1;position:sticky;top:0;z-index:4;white-space:nowrap;box-shadow:0 1px 0 #CBD5E1}
.nm-pay-table td{padding:6px 8px;border-bottom:1px solid #E2E8F0;vertical-align:middle}
.nm-pay-table td.num,.nm-pay-table thead th.num{text-align:right}
.nm-pay-badge,.nm-pay-doc,.nm-pay-ok{display:inline-flex;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700}
.nm-pay-badge{background:#E2E8F0;color:#334155}
.nm-pay-doc{background:#FEF3C7;color:#92400E}
.nm-pay-ok{background:#DCFCE7;color:#166534}
.nm-pay-empty{padding:20px;text-align:center;color:#64748B;border:1px dashed #CBD5E1;border-radius:6px;background:#F8FAFC;font-size:13px}

/* ── Pestañas internas de detalle (Nómina | Novedades) ───────────────── */
.nm-detail-tabs{display:flex;gap:0;border-bottom:2px solid #E2E8F0;margin-bottom:10px;flex-shrink:0}
.nm-detail-tab{border:0;background:none;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer;color:#64748B;border-bottom:2px solid transparent;margin-bottom:-2px;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}
.nm-detail-tab:hover{color:#0F766E}
.nm-detail-tab.active{color:#0F766E;border-bottom-color:#0F766E}
.nm-detail-tab.active .nm-pay-count{background:#DCFCE7;color:#0F766E}

/* ── Modal ────────────────────────────────────────────────────────────── */
.nm-pay-modal{position:fixed;inset:0;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
.nm-pay-modal[hidden]{display:none}
.nm-pay-dialog{width:min(820px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:8px;border:1px solid #CBD5E1}
.nm-pay-dialog-h{padding:12px 16px;border-bottom:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center}
.nm-pay-dialog-b{padding:16px;display:grid;gap:12px}
.nm-pay-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.nm-pay-form-grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.nm-pay-field label{display:block;font-size:12px;color:#475569;margin-bottom:4px;font-weight:700}
.nm-pay-field input,.nm-pay-field select,.nm-pay-field textarea{width:100%;border:1px solid #CBD5E1;border-radius:5px;padding:6px 9px;font-size:13px}
.nm-pay-cover-section{border:1px solid #E2E8F0;border-radius:6px;padding:10px;margin-top:4px}
.nm-pay-cover-title{font-size:12px;font-weight:800;color:#334155;margin-bottom:8px;text-transform:uppercase}

/* ── Badges de impacto ───────────────────────────────────────────────── */
.nm-badge-sal{background:#FEE2E2;color:#991B1B;border-radius:999px;padding:2px 7px;font-size:11px;font-weight:700}
.nm-badge-tra{background:#DBEAFE;color:#1E40AF;border-radius:999px;padding:2px 7px;font-size:11px;font-weight:700}

/* ── Desprendible ────────────────────────────────────────────────────── */
.nm-pay-impact-note{display:flex;flex-direction:column;gap:4px}
.nm-pay-impact-badges{display:flex;flex-wrap:wrap;gap:4px}
.nm-pay-impact-text{font-size:12px;color:#64748B}
.nm-slip-section{border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;margin-bottom:10px}
.nm-slip-section-h{padding:7px 12px;background:#F8FAFC;font-size:12px;font-weight:800;color:#334155;text-transform:uppercase;border-bottom:1px solid #E2E8F0}
.nm-slip-row{display:flex;justify-content:space-between;padding:5px 12px;border-bottom:1px solid #F1F5F9;font-size:13px}
.nm-slip-row:last-child{border-bottom:0}
.nm-slip-row b{color:#0F172A}
.nm-slip-total{background:#F0FDF4;font-weight:700}
.nm-slip-nov-h{padding:5px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #F1F5F9}
.nm-slip-nov-h--sal{background:#FFF1F2;color:#BE123C;border-left:3px solid #F43F5E}
.nm-slip-nov-h--tra{background:#FFFBEB;color:#B45309;border-left:3px solid #F59E0B}
.nm-slip-nov-item{display:flex;justify-content:space-between;padding:4px 12px 4px 16px;font-size:12px;color:#475569;border-bottom:1px solid #F1F5F9}
.nm-slip-nov-item:last-child{border-bottom:0}

/* ── Revisada: fila opaca (novedad) ─────────────────────────────────── */
.nm-pay-table tr.reviewed-row td{opacity:.6}

/* ── Item revisado: registro completo bloqueado ──────────────────────── */
.nm-pay-table tr.item-reviewed-row td{background:#F0FDF4}
.nm-item-reviewed-badge{display:inline-flex;align-items:center;gap:3px;background:#DCFCE7;color:#166534;border-radius:999px;padding:2px 7px;font-size:11px;font-weight:700}
.nm-item-review-label{display:flex;align-items:center;gap:5px;cursor:pointer;white-space:nowrap}
.nm-item-review-cb{accent-color:#0F766E;width:15px;height:15px;cursor:pointer;flex-shrink:0}
.nm-pay-btn[disabled]{opacity:.4;cursor:not-allowed}
.nm-pay-btn--warning{background:#D97706;color:#fff;border-color:#D97706}
.nm-pay-btn--warning:hover{background:#B45309}
.nm-prompt-field{margin-top:8px}
.nm-prompt-field label{display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:4px}
.nm-prompt-input{width:100%;border:1px solid #CBD5E1;border-radius:5px;padding:7px 9px;font-size:13px;color:#0F172A}

/* ── Responsive ──────────────────────────────────────────────────────── */
@media (max-width:900px){
  .nm-pay-card-main{height:auto}
  .nm-pay-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
  .nm-pay-form-grid,.nm-pay-form-grid-3{grid-template-columns:repeat(2,minmax(0,1fr))}
  .nm-pay-workspace{flex-direction:column}
  .nm-pay-municipality-panel{width:auto;flex:0 0 auto;max-height:180px;border-right:0;border-bottom:1px solid #E2E8F0}
  .nm-pay-table{font-size:12px}
}
</style>
<div class="nm-pay-shell">
  <div id="nmPayRoot"></div>
  <div class="nm-pay-modal" id="nmPayModal" hidden></div>
</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CARGA DE DATOS
// ─────────────────────────────────────────────────────────────────────────────
async function loadPeriods() {
  const cId = contractId();
  if (!cId) { periods = []; return; }
  const response = await apiFetch(`/payroll/periods?contractId=${cId}`);
  periods = Array.isArray(response.data) ? response.data : [];
  if (!activePeriod && periods.length) activePeriod = periods[0];
}

async function loadGroups() {
  if (!activePeriod) { groupsState = { positions: [], groups: [] }; return; }
  const response = await apiFetch(`/payroll/${activePeriod.id}/groups`);
  groupsState = response.data || { positions: [], groups: [] };
  if (!activePosition && groupsState.positions.length) activePosition = groupsState.positions[0].position;
  const currentPosition = groupsState.positions.find((p) => p.position === activePosition) || groupsState.positions[0];
  const available = Array.isArray(currentPosition?.municipalities) ? currentPosition.municipalities : [];
  if (activeGroupId && !available.some((m) => Number(m.id) === Number(activeGroupId))) activeGroupId = null;
}

async function loadGroupDetail() {
  if (!activePeriod || !activeGroupId) { activeGroupDetail = null; return; }
  const response = await apiFetch(`/payroll/${activePeriod.id}/groups/${activeGroupId}`);
  activeGroupDetail = response.data || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
function periodOptions() {
  return periods.map((p) => `
    <option value="${p.id}" ${activePeriod?.id === p.id ? "selected" : ""}>
      ${escapeHtml(p.label || `${p.period_start} – ${p.period_end}`)}
    </option>`).join("");
}

// KPIs del municipio seleccionado (no del total general)
function municipalityTotals() {
  // Municipio seleccionado → leer del detalle del grupo
  if (activeGroupId && activeGroupDetail) {
    const t = activeGroupDetail.totals || {};
    return {
      employees:         Number(t.employees || 0),
      novelties:         Number(t.novelties || 0),
      reviewed:          Number(t.reviewed || 0),
      items_reviewed:    Number(t.items_reviewed || 0),
      items_pending:     Number(t.items_pending || 0),
      pending_supports:  Number(t.pending_supports || 0),
      total_devengado:   Number(t.total_devengado || 0),
      total_deducciones: Number(t.total_deducciones || 0),
      neto:              Number(t.neto || 0),
    };
  }
  // Sin municipio → usar datos del cargo activo
  const pos = currentPositionData();
  if (pos) {
    return {
      employees:         Number(pos.employees || 0),
      novelties:         Number(pos.novelties || 0),
      reviewed:          Number(pos.reviewed || 0),
      items_reviewed:    Number(pos.items_reviewed || 0),
      items_pending:     Number(pos.employees || 0) - Number(pos.items_reviewed || 0),
      pending_supports:  Number(pos.pending_supports || 0),
      total_devengado:   Number(pos.total_devengado || 0),
      total_deducciones: Number(pos.total_deducciones || 0),
      neto:              Number(pos.neto || 0),
    };
  }
  return { employees: 0, novelties: 0, reviewed: 0, items_reviewed: 0, items_pending: 0, pending_supports: 0, total_devengado: 0, total_deducciones: 0, neto: 0 };
}

// Etiqueta de contexto para los KPIs
function kpiContextLabel() {
  if (activeGroupId && activeGroupDetail) {
    return currentMunicipalityData()?.municipality_name || "Municipio";
  }
  const pos = currentPositionData()?.position || "";
  return pos.length > 18 ? pos.split(" ").slice(0, 2).join(" ") : pos || "General";
}

// Barra de pestañas de cargos (fila propia, debajo del encabezado)
function renderCargoTabsBar() {
  if (!activePeriod || !groupsState.positions.length) return "";
  const current = groupsState.positions.find((p) => p.position === activePosition) || groupsState.positions[0];
  return `<div class="nm-pay-cargo-tabs">
    ${groupsState.positions.map((pos) => `
      <button class="nm-pay-tab ${pos.position === current?.position ? "active" : ""}" data-position="${escapeHtml(pos.position)}">
        ${escapeHtml(pos.position)}<span class="nm-pay-count">${pos.employees}</span>
      </button>`).join("")}
  </div>`;
}

function render() {
  const root = document.getElementById("nmPayRoot");
  if (!root) return;
  const totals = municipalityTotals();
  const ctx    = kpiContextLabel();
  root.innerHTML = `
<div class="nm-pay-card-main">

<!-- ── Encabezado: una sola fila compacta ─────────────────────────── -->
<div class="nm-pay-head">
  <span class="nm-pay-title">Nómina</span>
  <div class="nm-pay-head-sep"></div>
  <input class="nm-pay-input nm-pay-input--sm" type="month" id="nmPayMonth" value="${escapeHtml(periodMonth)}" style="width:128px">
  <select class="nm-pay-select nm-pay-input--sm" id="nmPayPeriod" style="max-width:190px">
    ${periodOptions() || `<option value="">Sin periodos</option>`}
  </select>
  <div class="nm-pay-head-spacer"></div>
  ${isTH() ? `<button class="nm-pay-btn nm-pay-btn--sm nm-pay-btn--primary" id="nmPayCreate">+ Periodo</button>` : ""}
  <button class="nm-pay-btn nm-pay-btn--sm" id="nmPaySupports">Soportes</button>
</div>

<!-- ── Pestañas de cargo: fila propia ─────────────────────────────── -->
${renderCargoTabsBar()}

<!-- ── KPIs: datos del municipio seleccionado ─────────────────────── -->
<div class="nm-pay-kpis">
  <div class="nm-pay-kpi nm-pay-kpi--ctx"><span>${activeGroupId ? "Municipio" : "Cargo activo"}</span><b title="${escapeHtml(ctx)}">${escapeHtml(ctx)}</b></div>
  <div class="nm-pay-kpi"><span>Empleados</span><b>${totals.employees}</b></div>
  <div class="nm-pay-kpi"><span>Novedades</span><b>${totals.novelties}</b></div>
  <div class="nm-pay-kpi"><span>Revisadas</span><b>${totals.items_reviewed}/${totals.employees}</b></div>
  <div class="nm-pay-kpi"><span>Devengado</span><b>${fmtCOP(totals.total_devengado)}</b></div>
  <div class="nm-pay-kpi"><span>Neto</span><b>${fmtCOP(totals.neto)}</b></div>
</div>

${activePeriod ? renderOperationalBody() : `<div style="padding:20px"><div class="nm-pay-empty">Crea o selecciona un periodo de nómina.</div></div>`}
</div>
`;
  wireStaticEvents();
}

function renderOperationalBody() {
  if (!groupsState.positions.length) {
    return `<div style="padding:16px"><div class="nm-pay-empty">No hay cargos activos con empleados asignados a este contrato.</div></div>`;
  }
  const current = groupsState.positions.find((p) => p.position === activePosition) || groupsState.positions[0];
  return `
<div class="nm-pay-workspace">
  ${renderMunicipalityPanel(current)}
  <div class="nm-pay-content">${renderGroupDetail()}</div>
</div>`;
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
        ${Number(mun.items_reviewed || 0) > 0 ? `<span class="nm-pay-ok" style="font-size:10px;padding:1px 5px">${mun.items_reviewed}/${mun.employees} rev.</span>` : ""}
      </button>`).join("") : `<div class="nm-pay-empty" style="padding:16px">Sin municipios.</div>`}
  </div>
</aside>`;
}

function renderGroupDetail() {
  if (!activeGroupDetail) return `
    <div class="nm-pay-toolbar" style="border:0;padding:16px">
      <div class="nm-pay-empty" style="flex:1">Selecciona un municipio para ver su nómina.</div>
    </div>`;
  const { group, items, novelties, totals } = activeGroupDetail;
  const municipality = currentMunicipalityData();
  const municipalityName = municipality?.municipality_name || group?.municipality_name || "";
  const isClosed = group?.status === "cerrada";
  const allReviewed = totals.employees > 0 && totals.items_reviewed === totals.employees;
  const showCloseBtn = allReviewed && !isClosed;
  return `
<!-- Toolbar fijo (sin sticky, el contenedor flex lo mantiene arriba) -->
<div class="nm-pay-toolbar">
  <div>
    <h3 class="nm-pay-section-title">${escapeHtml(municipalityName || "Municipio")}</h3>
    <div class="nm-pay-section-meta">${escapeHtml(group?.operational_position || activePosition)} · ${statusBadge(group?.status)} ${pendingSupportBadge(totals.pending_supports)}</div>
  </div>
  <div class="nm-pay-actions">
    ${isClosed ? "" : `<button class="nm-pay-btn nm-pay-btn--primary nm-pay-btn--sm" id="nmPayCalculate">Calcular</button>`}
    <button class="nm-pay-btn nm-pay-btn--sm" id="nmPayExport">Exportar</button>
    ${showCloseBtn ? `<button class="nm-pay-btn nm-pay-btn--warning nm-pay-btn--sm" id="nmPayClose">Cerrar y enviar nómina</button>` : ""}
  </div>
</div>

<!-- Cuerpo scrollable con pestañas Nómina / Novedades -->
<div class="nm-pay-scroll-body">
  <div class="nm-detail-tabs">
    <button class="nm-detail-tab ${activeDetailTab === "nomina" ? "active" : ""}" data-detail-tab="nomina">Nómina</button>
    <button class="nm-detail-tab ${activeDetailTab === "novedades" ? "active" : ""}" data-detail-tab="novedades">
      Novedades <span class="nm-pay-count">${novelties.length}</span>
    </button>
  </div>
  ${activeDetailTab === "nomina"
    ? (items.length
        ? renderItemsTable(items)
        : `<div class="nm-pay-empty">Pulsa "Calcular" para cargar los empleados activos.</div>`)
    : (novelties.length
        ? `<div class="nm-pay-table-wrap">${renderNoveltiesTable(novelties)}</div>`
        : `<div class="nm-pay-empty">Sin novedades registradas en este municipio.</div>`)}
</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLA DE ÍTEMS (empleados)
// ─────────────────────────────────────────────────────────────────────────────
function salaryCategoryBadge(code) {
  if (!code) return "";
  const colors = {
    CAA1: "#0E7490", CAA2: "#0369A1",
    CAARES1: "#7C3AED", CAARES2: "#6D28D9",
    CAARES3: "#5B21B6", CAARES4: "#4C1D95",
    RI: "#0F766E",
  };
  const bg = colors[String(code).toUpperCase()] || "#475569";
  return `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;color:#fff;background:${bg};letter-spacing:.4px">${escapeHtml(code)}</span>`;
}

function renderItemsTable(items) {
  return `
<div class="nm-pay-table-wrap">
<table class="nm-pay-table">
  <thead>
    <tr>
      <th>Empleado</th><th>Sede · Modalidad · Categoría</th>
      <th class="num">Devengado</th><th class="num">Deducciones</th><th class="num">Neto</th>
      <th>Nov.</th><th>Acciones</th><th>REVISADA</th>
    </tr>
  </thead>
  <tbody>
    ${items.map((item) => {
      const isReviewed = Boolean(item.reviewed);
      return `
      <tr class="${isReviewed ? "item-reviewed-row" : ""}">
        <td>
          <b>${escapeHtml(item.employee_name)}</b><br>
          <small style="color:#64748B">${escapeHtml(item.document_number || "")}</small>
        </td>
        <td>
          <small>${escapeHtml(item.institution_name || "-")}</small><br>
          <small>${escapeHtml(item.site_name || "-")}</small><br>
          <small>${escapeHtml(item.modality || "-")} · ${escapeHtml(item.work_time_type || "-")} &nbsp;${salaryCategoryBadge(item.salary_category)}</small>
        </td>
        <td class="num">${fmtCOP(item.total_devengado)}</td>
        <td class="num">${fmtCOP(item.total_deducciones)}</td>
        <td class="num"><b>${fmtCOP(item.neto_pagar)}</b></td>
        <td>${Number(item.novelty_count || 0) ? `${Number(item.reviewed_count || 0)}/${Number(item.novelty_count || 0)} rev.` : "—"}</td>
        <td>
          ${isReviewed
            ? `<button class="nm-pay-btn nm-pay-btn--sm" data-payslip="${item.id}">Desprendible</button>
               <span style="display:block;margin-top:3px;font-size:10px;color:#64748B">Bloqueado</span>`
            : `<button class="nm-pay-btn nm-pay-btn--sm" data-new-novelty="${item.id}">+ Novedad</button>
               <button class="nm-pay-btn nm-pay-btn--sm" data-cambio-operativo="${item.id}" title="Registrar cambio temporal/definitivo de modalidad, sede o jornada">Cambio op.</button>
               <button class="nm-pay-btn nm-pay-btn--sm" data-payslip="${item.id}">Desprendible</button>`}
        </td>
        <td>
          <label class="nm-item-review-label" title="${isReviewed ? `Revisado · Para editar quite la marca` : `Marcar como revisado y bloquear`}">
            <input type="checkbox" class="nm-item-review-cb" data-item-reviewed="${item.id}" ${isReviewed ? "checked" : ""}>
            ${isReviewed
              ? `<span class="nm-item-reviewed-badge">&#10003; Revisada</span>`
              : `<span style="font-size:11px;color:#94A3B8">Pendiente</span>`}
          </label>
        </td>
      </tr>`;
    }).join("")}
  </tbody>
</table>
</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLA DE NOVEDADES
// ─────────────────────────────────────────────────────────────────────────────
function renderNoveltiesTable(novelties) {
  return `
<table class="nm-pay-table">
  <thead>
    <tr>
      <th>Empleado</th><th>Tipo de novedad</th><th>Impacto</th>
      <th>Fechas</th><th class="num">Días</th><th class="num">Valor</th>
      <th>Soporte</th><th>REVISADA</th><th></th>
    </tr>
  </thead>
  <tbody>
    ${novelties.map((nov) => {
      const meta = noveltyByCode(nov.novelty_type);
      const isReviewed     = Boolean(nov.reviewed);
      const isItemLocked   = Boolean(nov.item_reviewed);
      const isLocked       = isReviewed || isItemLocked;
      const lockTitle      = isItemLocked ? "Registro de nómina bloqueado por revisión" : "Novedad revisada — quite la revisión para editar";
      // Impacto económico: usa computed_impact si viene del API, si no: nov.value
      const impactAmt      = Number(nov.computed_impact || nov.value || 0);
      const impactLabel    = nov.impact_type === "salary" ? "↓ Sal." : nov.impact_type === "transport" ? "↓ Transp." : "";
      return `
      <tr class="${isReviewed ? "reviewed-row" : ""}">
        <td>
          ${escapeHtml(nov.employee_name || "")}<br>
          <small>${escapeHtml(nov.document_number || "")}</small>
        </td>
        <td>
          <b>${escapeHtml(nov.novelty_name || nov.novelty_type || "")}</b><br>
          <small style="color:#64748B">${escapeHtml(nov.description || nov.observations || "")}</small>
        </td>
        <td>${noveltyImpactNoticeHtml(meta || nov)}</td>
        <td>
          <small>${escapeHtml(String(nov.start_date || "—").slice(0, 10))}</small><br>
          <small>${escapeHtml(String(nov.end_date || "—").slice(0, 10))}</small>
        </td>
        <td class="num">${Number(nov.days || 0)}</td>
        <td class="num">
          ${impactAmt ? `<b style="color:#991B1B">-${fmtCOP(impactAmt)}</b>${impactLabel ? `<br><small style="color:#94A3B8">${impactLabel}</small>` : ""}` : "—"}
        </td>
        <td>${nov.support_status === "pendiente"
          ? `<span class="nm-pay-doc">Pendiente</span>`
          : `<span class="nm-pay-ok">${escapeHtml(nov.support_status || "—")}</span>`}</td>
        <td>
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer">
            <input type="checkbox" data-reviewed="${nov.id}" ${isReviewed ? "checked" : ""}>
            ${isReviewed ? `<span class="nm-pay-ok" style="font-size:11px">Revisada</span>` : `<span style="font-size:11px;color:#64748B">Sin revisar</span>`}
          </label>
        </td>
        <td>
          <button class="nm-pay-btn nm-pay-btn--sm" data-edit-novelty="${nov.id}" ${isLocked ? `disabled title="${lockTitle}"` : ""}>Editar</button>
          <button class="nm-pay-btn nm-pay-btn--sm" data-cover-novelty="${nov.id}" data-cover-item="${nov.payroll_item_id}" ${isLocked ? "disabled" : ""}>Cubrió</button>
          <button class="nm-pay-btn nm-pay-btn--sm" data-delete-novelty="${nov.id}" ${isLocked ? `disabled title="${lockTitle}"` : ""} style="color:#B91C1C;border-color:#FECACA">Eliminar</button>
          ${nov.cover_type === "EXTERNA" && nov.turn_cover_id
            ? `<button class="nm-pay-btn nm-pay-btn--sm" data-charge-account="${nov.turn_cover_id}">Cta. cobro</button>`
            : ""}
        </td>
      </tr>`;
    }).join("")}
  </tbody>
</table>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT WIRING
// ─────────────────────────────────────────────────────────────────────────────
function wireStaticEvents() {
  document.getElementById("nmPayMonth")?.addEventListener("change", (e) => { periodMonth = e.target.value; });
  document.getElementById("nmPayPeriod")?.addEventListener("change", async (e) => {
    activePeriod       = periods.find((p) => String(p.id) === String(e.target.value)) || null;
    activePosition     = "";
    activeGroupId      = null;
    municipalitySearch = "";
    activeDetailTab    = "nomina";
    await reloadWorkArea();
  });
  document.getElementById("nmPayCreate")?.addEventListener("click", createPeriod);
  document.getElementById("nmPaySupports")?.addEventListener("click", openSupportsModal);
  document.getElementById("nmPayMunSearch")?.addEventListener("input", (e) => {
    municipalitySearch = e.target.value || "";
    render();
    document.getElementById("nmPayMunSearch")?.focus();
  });
  document.querySelectorAll(".nm-pay-tab").forEach((btn) => btn.addEventListener("click", async () => {
    activePosition     = btn.dataset.position || "";
    activeGroupId      = null;
    municipalitySearch = "";
    activeDetailTab    = "nomina";
    await reloadDetailOnly();
  }));
  document.querySelectorAll("[data-detail-tab]").forEach((btn) => btn.addEventListener("click", () => {
    activeDetailTab = btn.dataset.detailTab || "nomina";
    render();
  }));
  document.querySelectorAll(".nm-pay-mun").forEach((btn) => btn.addEventListener("click", async () => {
    activeGroupId = Number(btn.dataset.groupId);
    await reloadDetailOnly();
  }));
  document.getElementById("nmPayCalculate")?.addEventListener("click", calculateGroup);
  document.getElementById("nmPayExport")?.addEventListener("click",   exportMunicipality);
  document.getElementById("nmPayClose")?.addEventListener("click",    closeAndSendGroup);
  document.querySelectorAll("[data-new-novelty]").forEach((btn) => btn.addEventListener("click", () => openNoveltyModal(Number(btn.dataset.newNovelty))));
  document.querySelectorAll("[data-cambio-operativo]").forEach((btn) => btn.addEventListener("click", () => openCambioOperativoModal(Number(btn.dataset.cambioOperativo))));
  document.querySelectorAll("[data-payslip]").forEach((btn)        => btn.addEventListener("click", () => openPayslipModal(Number(btn.dataset.payslip))));
  document.querySelectorAll("[data-edit-novelty]").forEach((btn)   => btn.addEventListener("click", () => openEditNoveltyModal(Number(btn.dataset.editNovelty))));
  document.querySelectorAll("[data-cover-novelty]").forEach((btn)  => btn.addEventListener("click", () => openCoverModal(Number(btn.dataset.coverNovelty), Number(btn.dataset.coverItem))));
  document.querySelectorAll("[data-charge-account]").forEach((btn) => btn.addEventListener("click", () => openChargeAccount(Number(btn.dataset.chargeAccount))));
  document.querySelectorAll("[data-reviewed]").forEach((input)     => input.addEventListener("change", () => toggleReviewed(Number(input.dataset.reviewed), input.checked, input)));
  document.querySelectorAll("[data-item-reviewed]").forEach((input) => input.addEventListener("change", () => toggleItemReviewed(Number(input.dataset.itemReviewed), input.checked, input)));
  document.querySelectorAll("[data-delete-novelty]").forEach((btn)  => btn.addEventListener("click", () => confirmDeleteNovelty(Number(btn.dataset.deleteNovelty))));
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCIONES DE PERÍODO
// ─────────────────────────────────────────────────────────────────────────────
async function createPeriod() {
  try {
    const response = await apiFetch("/payroll/periods", {
      method: "POST",
      body: JSON.stringify({ companyId: companyId(), contractId: contractId(), period: periodMonth }),
    });
    activePeriod   = response.data;
    activePosition = "";
    activeGroupId  = null;
    municipalitySearch = "";
    await loadPeriods();
    await reloadWorkArea();
    showSuccess("Periodo creado");
  } catch (err) {
    showError(err.message);
  }
}

async function reloadWorkArea() { await loadGroups(); await loadGroupDetail(); render(); }
async function reloadDetailOnly() { await loadGroupDetail(); render(); }

async function calculateGroup() {
  if (!activeGroupId) return;
  try {
    await apiFetch(`/payroll/groups/${activeGroupId}/calculate`, { method: "POST" });
    await reloadWorkArea();
    showSuccess("Nómina municipal calculada");
  } catch (err) { showError(err.message); }
}

async function exportMunicipality() {
  if (!activeGroupId) return;
  try {
    const token = state.token || localStorage.getItem("empiria_token") || "";
    const res = await fetch(`/payroll/groups/${activeGroupId}/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { showError("Error al exportar nómina"); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `nomina-${(activeGroupDetail?.group?.municipality_name || "municipio").replace(/[^a-z0-9]/gi, "-")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showError(err.message || "Error al exportar");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: calcular días automáticamente entre dos fechas
// ─────────────────────────────────────────────────────────────────────────────
function wireDateAutocalc(startId, endId, daysId) {
  const calc = () => {
    const s = document.getElementById(startId)?.value;
    const e = document.getElementById(endId)?.value;
    if (s && e) {
      const diff = (new Date(e) - new Date(s)) / 86400000;
      const days = Math.max(1, Math.round(diff) + 1);
      const daysEl = document.getElementById(daysId);
      if (daysEl && !daysEl._manualOverride) daysEl.value = days;
    }
  };
  document.getElementById(startId)?.addEventListener("change", calc);
  document.getElementById(endId)?.addEventListener("change",   calc);
  document.getElementById(daysId)?.addEventListener("input",   () => {
    const el = document.getElementById(daysId);
    if (el) el._manualOverride = true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL: REGISTRAR NOVEDAD
// ─────────────────────────────────────────────────────────────────────────────
function openNoveltyModal(itemId) {
  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<div class="nm-pay-dialog">
  <div class="nm-pay-dialog-h">
    <b>Registrar novedad</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
  </div>
  <div class="nm-pay-dialog-b">
    <div class="nm-pay-field">
      <label>Tipo de novedad</label>
      <select class="nm-pay-select" id="novType">
        ${NOVELTY_TYPES.filter((t) => t.code !== "CAMBIO_OPERATIVO_COBERTURA").map((t) => `<option value="${t.code}">${t.name}</option>`).join("")}
      </select>
    </div>
    <div id="novImpactInfo"></div>
    <div class="nm-pay-form-grid">
      <div class="nm-pay-field"><label>Fecha inicio</label><input class="nm-pay-input" id="novStart" type="date"></div>
      <div class="nm-pay-field"><label>Fecha fin</label><input class="nm-pay-input" id="novEnd" type="date"></div>
      <div class="nm-pay-field">
        <label>Días <small style="color:#94A3B8;font-weight:400">(auto)</small></label>
        <input class="nm-pay-input" id="novDays" type="number" min="1" value="1">
      </div>
      <div class="nm-pay-field">
        <label>Soporte requerido</label>
        <select class="nm-pay-select" id="novSupport"><option value="false">No</option><option value="true">Sí</option></select>
      </div>
    </div>
    <div class="nm-pay-field"><label>Observaciones</label><textarea class="nm-pay-textarea" id="novDesc"></textarea></div>
    <button class="nm-pay-btn nm-pay-btn--primary" id="novSave">Guardar novedad</button>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();
  wireDateAutocalc("novStart", "novEnd", "novDays");

  // Mostrar descripción del impacto al cambiar tipo
  const updateImpact = () => {
    const code = document.getElementById("novType")?.value;
    const meta = noveltyByCode(code);
    const el   = document.getElementById("novImpactInfo");
    if (!el || !meta) return;
    el.innerHTML = noveltyImpactNoticeHtml(meta);
    return;
    const parts = [];
    if (meta.affects_salary)    parts.push("Descuenta del <b>salario</b>");
    if (meta.affects_transport) parts.push("Descuenta del <b>transporte</b>");
    if (!parts.length) parts.push("Sin descuento económico");
    el.innerHTML = `Impacto: ${parts.join(" · ")}`;
  };
  document.getElementById("novType")?.addEventListener("change", updateImpact);
  updateImpact();

  document.getElementById("novSave")?.addEventListener("click", async () => {
    try {
      const days = Number(document.getElementById("novDays").value);
      if (!days || days < 1) { showError("Los días deben ser mayor a 0"); return; }
      await apiFetch(`/payroll/items/${itemId}/novelties`, {
        method: "POST",
        body: JSON.stringify({
          novelty_type:    document.getElementById("novType").value,
          start_date:      document.getElementById("novStart").value || null,
          end_date:        document.getElementById("novEnd").value   || null,
          days,
          support_required: document.getElementById("novSupport").value === "true",
          observations:    document.getElementById("novDesc").value,
        }),
      });
      closeModal();
      await reloadWorkArea();
      showSuccess("Novedad registrada");
    } catch (err) { showError(err.message); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL: CAMBIO OPERATIVO DE COBERTURA (selects dependientes del catálogo)
// ─────────────────────────────────────────────────────────────────────────────
async function openCambioOperativoModal(itemId) {
  const item = activeGroupDetail?.items?.find((x) => Number(x.id) === Number(itemId));
  if (!item) { showError("Empleado no encontrado en el grupo"); return; }

  const modal = document.getElementById("nmPayModal");

  // Derivar categoría desde modalidad + jornada (sin contar peers CAARES desde frontend)
  function deriveCat(modality, time) {
    const m = String(modality || "").toUpperCase();
    const t = String(time || "TC").toUpperCase();
    if (m === "RI") return "RI";
    if (m.startsWith("CAARES")) return t === "TC" ? "CAARES1" : "CAARES2";
    return t === "TC" ? "CAA1" : "CAA2";
  }

  function optionsFrom(rows, idKey, nameKey, placeholder) {
    return `<option value="">— ${escapeHtml(placeholder)} —</option>` +
      rows.map((r) => `<option value="${Number(r[idKey])}">${escapeHtml(r[nameKey] || "")}</option>`).join("");
  }

  function setSelectDisabled(id, disabled) {
    const el = document.getElementById(id);
    if (el) { el.disabled = disabled; if (disabled) el.innerHTML = `<option value="">Cargando…</option>`; }
  }

  // Mostrar modal con estado inicial
  modal.innerHTML = `
<div class="nm-pay-dialog" style="max-width:560px">
  <div class="nm-pay-dialog-h">
    <b>Cambio Operativo de Cobertura</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
  </div>
  <div class="nm-pay-dialog-b">

    <!-- Empleado actual (solo lectura) -->
    <div style="font-size:12px;color:#334155;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:8px 10px;margin-bottom:10px">
      <div style="font-weight:600;margin-bottom:4px">${escapeHtml(item.employee_name || "")} — CC ${escapeHtml(item.document_number || "")}</div>
      <div style="color:#64748B">
        Municipio actual: <b>${escapeHtml(item.municipality_name || "—")}</b> &nbsp;·&nbsp;
        Institución: <b>${escapeHtml(item.institution_name || "—")}</b><br>
        Sede: <b>${escapeHtml(item.site_name || "—")}</b> &nbsp;·&nbsp;
        Modalidad: <b>${escapeHtml(item.modality || "—")} · ${escapeHtml(item.work_time_type || "—")}</b> &nbsp;·&nbsp;
        Categoría: <b>${escapeHtml(item.salary_category || "—")}</b>
      </div>
    </div>

    <div style="font-size:11px;font-weight:600;color:#0F766E;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Nueva ubicación operativa</div>

    <!-- Selects dependientes -->
    <div class="nm-pay-field">
      <label>Nuevo municipio <span style="color:#EF4444">*</span></label>
      <select class="nm-pay-select" id="coMunicipio"><option value="">Cargando municipios…</option></select>
    </div>
    <div class="nm-pay-field">
      <label>Nueva institución <span style="color:#EF4444">*</span></label>
      <select class="nm-pay-select" id="coInstitucion" disabled><option value="">— Seleccione municipio primero —</option></select>
    </div>
    <div class="nm-pay-field">
      <label>Nueva sede <span style="color:#EF4444">*</span></label>
      <select class="nm-pay-select" id="coSede" disabled><option value="">— Seleccione institución primero —</option></select>
    </div>
    <div class="nm-pay-form-grid">
      <div class="nm-pay-field">
        <label>Nueva modalidad <span style="color:#EF4444">*</span></label>
        <select class="nm-pay-select" id="coModalidad" disabled><option value="">— Seleccione sede primero —</option></select>
      </div>
      <div class="nm-pay-field">
        <label>Nueva jornada <span style="color:#EF4444">*</span></label>
        <select class="nm-pay-select" id="coJornada">
          <option value="TC">TC — Tiempo completo</option>
          <option value="MT">MT — Medio tiempo</option>
        </select>
      </div>
    </div>
    <div class="nm-pay-field">
      <label>Categoría salarial calculada</label>
      <input class="nm-pay-input" id="coCat" readonly style="background:#F1F5F9;cursor:not-allowed" value="">
      <small style="color:#94A3B8">Se calcula automáticamente desde modalidad + jornada</small>
    </div>

    <div style="font-size:11px;font-weight:600;color:#0F766E;text-transform:uppercase;letter-spacing:.5px;margin:10px 0 6px">Período del cambio</div>
    <div class="nm-pay-form-grid">
      <div class="nm-pay-field"><label>Fecha inicio <span style="color:#EF4444">*</span></label><input class="nm-pay-input" id="coStart" type="date"></div>
      <div class="nm-pay-field"><label>Fecha fin <small style="color:#94A3B8;font-weight:400">(vacío = resto del mes)</small></label><input class="nm-pay-input" id="coEnd" type="date"></div>
      <div class="nm-pay-field"><label>Días en nueva condición <small style="color:#94A3B8;font-weight:400">(auto)</small></label><input class="nm-pay-input" id="coDays" type="number" min="1" max="29" value="15"></div>
    </div>
    <div id="coPreview" style="font-size:12px;color:#475569;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:6px;padding:8px 10px;margin-bottom:8px;display:none"></div>

    <div class="nm-pay-field">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="coUpdateEmp">
        <span>Actualizar también datos institucionales del empleado en Personal</span>
      </label>
      <small style="color:#94A3B8;display:block;margin-top:2px">Actualizará municipio, institución, sede, modalidad y jornada en el registro del empleado. Para cambios definitivos.</small>
    </div>

    <div class="nm-pay-field"><label>Motivo / observaciones</label><textarea class="nm-pay-textarea" id="coObs" rows="2" placeholder="Justificación del cambio operativo"></textarea></div>

    <div style="background:#FEF9C3;border:1px solid #FDE047;border-radius:6px;padding:8px 10px;font-size:12px;color:#854D0E;margin-bottom:10px">
      Después de guardar, recalcule el grupo para aplicar el cambio a la nómina.
      Si marca "Actualizar empleado", la cobertura se recalculará automáticamente.
    </div>

    <button class="nm-pay-btn nm-pay-btn--primary" id="coSave">Guardar cambio operativo</button>
  </div>
</div>`;

  modal.hidden = false;
  wireModalClose();
  wireDateAutocalc("coStart", "coEnd", "coDays");

  // Estado interno de los IDs seleccionados
  let selMunicipioId = null, selMunicipioName = "";
  let selInstId = null,      selInstName = "";
  let selSiteId = null,      selSiteName = "";

  // Actualizar categoría y preview
  function updateCatAndPreview() {
    const mod  = document.getElementById("coModalidad")?.value || "";
    const time = document.getElementById("coJornada")?.value   || "TC";
    const days = Number(document.getElementById("coDays")?.value || 0);
    const cat  = mod ? deriveCat(mod, time) : "";
    const catEl = document.getElementById("coCat");
    if (catEl) catEl.value = cat;
    const prev = document.getElementById("coPreview");
    if (prev) {
      if (days > 0 && cat) {
        prev.style.display = "";
        prev.innerHTML = `<b>Distribución del período:</b><br>· ${30 - days} días → condición original (${escapeHtml(item.salary_category || "actual")})<br>· ${days} días → nueva condición (${escapeHtml(cat)}: ${escapeHtml(mod)} ${escapeHtml(time)})`;
      } else {
        prev.style.display = "none";
      }
    }
  }
  document.getElementById("coJornada")?.addEventListener("change", updateCatAndPreview);
  document.getElementById("coDays")?.addEventListener("input", updateCatAndPreview);

  // Cargar municipios
  try {
    const r = await apiFetch("/education/municipalities");
    const munList = Array.isArray(r.data) ? r.data : (Array.isArray(r) ? r : []);
    const munSel = document.getElementById("coMunicipio");
    if (munSel) munSel.innerHTML = optionsFrom(munList, "id", "name", "Seleccione municipio");
  } catch { document.getElementById("coMunicipio").innerHTML = `<option value="">Error cargando municipios</option>`; }

  // Municipio → cargar instituciones
  document.getElementById("coMunicipio")?.addEventListener("change", async (e) => {
    selMunicipioId   = e.target.value ? Number(e.target.value) : null;
    selMunicipioName = e.target.options[e.target.selectedIndex]?.text || "";
    selInstId = null; selSiteId = null;

    const instSel = document.getElementById("coInstitucion");
    const sedeSel = document.getElementById("coSede");
    const modSel  = document.getElementById("coModalidad");
    instSel.disabled = true; instSel.innerHTML = `<option value="">Cargando…</option>`;
    sedeSel.disabled = true; sedeSel.innerHTML = `<option value="">— Seleccione institución —</option>`;
    modSel.disabled  = true; modSel.innerHTML  = `<option value="">— Seleccione sede —</option>`;
    updateCatAndPreview();
    if (!selMunicipioId) return;

    try {
      const r = await apiFetch(`/education/institutions?municipalityId=${selMunicipioId}`);
      const list = Array.isArray(r.data) ? r.data : (Array.isArray(r) ? r : []);
      instSel.innerHTML = optionsFrom(list, "id", "name", "Seleccione institución");
      instSel.disabled = false;
    } catch { instSel.innerHTML = `<option value="">Error cargando instituciones</option>`; }
  });

  // Institución → cargar sedes
  document.getElementById("coInstitucion")?.addEventListener("change", async (e) => {
    selInstId   = e.target.value ? Number(e.target.value) : null;
    selInstName = e.target.options[e.target.selectedIndex]?.text || "";
    selSiteId = null;

    const sedeSel = document.getElementById("coSede");
    const modSel  = document.getElementById("coModalidad");
    sedeSel.disabled = true; sedeSel.innerHTML = `<option value="">Cargando…</option>`;
    modSel.disabled  = true; modSel.innerHTML  = `<option value="">— Seleccione sede —</option>`;
    updateCatAndPreview();
    if (!selInstId) return;

    try {
      const r = await apiFetch(`/education/sites?institutionId=${selInstId}`);
      const list = Array.isArray(r.data) ? r.data : (Array.isArray(r) ? r : []);
      sedeSel.innerHTML = optionsFrom(list, "id", "name", "Seleccione sede");
      sedeSel.disabled = false;
    } catch { sedeSel.innerHTML = `<option value="">Error cargando sedes</option>`; }
  });

  // Sede → cargar modalidades
  document.getElementById("coSede")?.addEventListener("change", async (e) => {
    selSiteId   = e.target.value ? Number(e.target.value) : null;
    selSiteName = e.target.options[e.target.selectedIndex]?.text || "";

    const modSel = document.getElementById("coModalidad");
    modSel.disabled = true; modSel.innerHTML = `<option value="">Cargando…</option>`;
    updateCatAndPreview();
    if (!selSiteId) return;

    try {
      const r = await apiFetch(`/education/modalities?siteId=${selSiteId}`);
      const list = Array.isArray(r.data) ? r.data : (Array.isArray(r) ? r : []);
      // La API devuelve { id, modality } — usamos el campo modality como valor y etiqueta
      if (list.length) {
        modSel.innerHTML = `<option value="">— Seleccione modalidad —</option>` +
          list.map((m) => `<option value="${escapeHtml(m.modality || m.name || "")}">${escapeHtml(m.modality || m.name || "")}</option>`).join("");
      } else {
        // Fallback: mostrar opciones estándar si la sede no tiene modalidades registradas
        modSel.innerHTML = `<option value="">— Seleccione modalidad —</option><option value="CAA">CAA</option><option value="CAARES">CAARES</option><option value="RI">RI</option>`;
      }
      modSel.disabled = false;
      updateCatAndPreview();
    } catch { modSel.innerHTML = `<option value="">Error cargando modalidades</option>`; }
  });

  document.getElementById("coModalidad")?.addEventListener("change", updateCatAndPreview);

  // Guardar
  document.getElementById("coSave")?.addEventListener("click", async () => {
    const municipioId = selMunicipioId;
    const instId      = selInstId;
    const siteId      = selSiteId;
    const modalidad   = document.getElementById("coModalidad")?.value;
    const jornada     = document.getElementById("coJornada")?.value;
    const startDate   = document.getElementById("coStart")?.value;
    const days        = Number(document.getElementById("coDays")?.value);
    const newCat      = document.getElementById("coCat")?.value;

    if (!municipioId)  { showError("Seleccione el nuevo municipio");    return; }
    if (!instId)       { showError("Seleccione la nueva institución");  return; }
    if (!siteId)       { showError("Seleccione la nueva sede");         return; }
    if (!modalidad)    { showError("Seleccione la nueva modalidad");    return; }
    if (!jornada)      { showError("Seleccione la nueva jornada");      return; }
    if (!startDate)    { showError("Indique la fecha de inicio del cambio"); return; }
    if (!days || days < 1 || days > 29) { showError("Los días deben estar entre 1 y 29"); return; }

    try {
      await apiFetch(`/payroll/items/${itemId}/cambio-operativo`, {
        method: "POST",
        body: JSON.stringify({
          new_salary_category:    newCat,
          new_modality:           modalidad,
          new_work_time_type:     jornada,
          new_municipality_id:    municipioId,
          new_municipality_name:  selMunicipioName,
          new_institution_id:     instId,
          new_institution_name:   selInstName,
          new_site_id:            siteId,
          new_site_name:          selSiteName,
          start_date:             startDate,
          end_date:               document.getElementById("coEnd")?.value || null,
          days,
          update_employee_record: document.getElementById("coUpdateEmp")?.checked || false,
          observations:           document.getElementById("coObs")?.value || "",
        }),
      });
      closeModal();
      await reloadWorkArea();
      showSuccess("Cambio operativo registrado. Recalcule el grupo para aplicar a la nómina.");
    } catch (err) {
      showError(err.message);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL: EDITAR NOVEDAD
// ─────────────────────────────────────────────────────────────────────────────
function openEditNoveltyModal(noveltyId) {
  const novelty = activeGroupDetail?.novelties?.find((x) => Number(x.id) === Number(noveltyId));
  if (!novelty) return;
  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<div class="nm-pay-dialog">
  <div class="nm-pay-dialog-h">
    <b>Editar novedad</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
  </div>
  <div class="nm-pay-dialog-b">
    <div class="nm-pay-field">
      <label>Tipo de novedad</label>
      <select class="nm-pay-select" id="novType">
        ${NOVELTY_TYPES.map((t) => `<option value="${t.code}" ${t.code === novelty.novelty_type ? "selected" : ""}>${t.name}</option>`).join("")}
      </select>
    </div>
    <div id="novImpactInfo"></div>
    <div class="nm-pay-form-grid">
      <div class="nm-pay-field"><label>Fecha inicio</label><input class="nm-pay-input" id="novStart" type="date" value="${escapeHtml(String(novelty.start_date || "").slice(0, 10))}"></div>
      <div class="nm-pay-field"><label>Fecha fin</label><input class="nm-pay-input" id="novEnd" type="date" value="${escapeHtml(String(novelty.end_date || "").slice(0, 10))}"></div>
      <div class="nm-pay-field">
        <label>Días <small style="color:#94A3B8;font-weight:400">(auto)</small></label>
        <input class="nm-pay-input" id="novDays" type="number" min="1" value="${Number(novelty.days || 1)}">
      </div>
      <div class="nm-pay-field"><label>Valor aplicado</label><input class="nm-pay-input" id="novValue" type="number" min="0" value="${Number(novelty.value || 0)}"></div>
    </div>
    <div class="nm-pay-field"><label>Observaciones</label><textarea class="nm-pay-textarea" id="novDesc">${escapeHtml(novelty.description || novelty.observations || "")}</textarea></div>
    <button class="nm-pay-btn nm-pay-btn--primary" id="novSave">Guardar cambios</button>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();
  wireDateAutocalc("novStart", "novEnd", "novDays");

  const updateImpact = () => {
    const code = document.getElementById("novType")?.value;
    const meta = noveltyByCode(code);
    const el   = document.getElementById("novImpactInfo");
    if (!el || !meta) return;
    el.innerHTML = noveltyImpactNoticeHtml(meta);
  };
  document.getElementById("novType")?.addEventListener("change", updateImpact);
  updateImpact();

  document.getElementById("novSave")?.addEventListener("click", async () => {
    try {
      await apiFetch(`/payroll/novelties/${noveltyId}`, {
        method: "PATCH",
        body: JSON.stringify({
          novelty_type: document.getElementById("novType").value,
          start_date:   document.getElementById("novStart").value || null,
          end_date:     document.getElementById("novEnd").value   || null,
          days:         Number(document.getElementById("novDays").value),
          value:        Number(document.getElementById("novValue").value),
          description:  document.getElementById("novDesc").value,
        }),
      });
      closeModal();
      await reloadWorkArea();
      showSuccess("Novedad actualizada");
    } catch (err) { showError(err.message); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL: COBERTURA DE TURNO (interno / externo)
// ─────────────────────────────────────────────────────────────────────────────
function openCoverModal(noveltyId, itemId) {
  const novelty = activeGroupDetail?.novelties?.find((x) => Number(x.id) === Number(noveltyId));
  if (!novelty) return;

  // Empleados del grupo para cobertura interna
  const employees = activeGroupDetail?.items || [];
  const internalOptions = employees
    .filter((e) => String(e.employee_id) !== String(novelty.employee_id))
    .map((e) => `<option value="${e.employee_id}">${escapeHtml(e.employee_name)} — ${escapeHtml(e.document_number || "")}</option>`)
    .join("");

  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<div class="nm-pay-dialog">
  <div class="nm-pay-dialog-h">
    <b>Registrar cobertura de turno</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
  </div>
  <div class="nm-pay-dialog-b">
    <div class="nm-pay-form-grid">
      <div class="nm-pay-field">
        <label>Tipo de cobertura</label>
        <select class="nm-pay-select" id="coverType">
          <option value="INTERNA">Personal interno</option>
          <option value="EXTERNA">Personal externo</option>
        </select>
      </div>
      <div class="nm-pay-field">
        <label>Días cubiertos</label>
        <input class="nm-pay-input" id="coverDays" type="number" min="1" value="${Number(novelty.days || 1)}">
      </div>
      <div class="nm-pay-field">
        <label>Valor día <small style="color:#94A3B8;font-weight:400">(0 = automático)</small></label>
        <input class="nm-pay-input" id="coverValueDay" type="number" min="0" value="0">
      </div>
    </div>

    <div class="nm-pay-cover-section" id="coverSectionInterna">
      <div class="nm-pay-cover-title">Personal interno</div>
      <div class="nm-pay-field">
        <label>Empleado que cubrió</label>
        <select class="nm-pay-select" id="coverInternal">
          <option value="">— Seleccionar empleado —</option>
          ${internalOptions}
        </select>
      </div>
    </div>

    <div class="nm-pay-cover-section" id="coverSectionExterna" hidden>
      <div class="nm-pay-cover-title">Personal externo (no vinculado)</div>
      <div class="nm-pay-form-grid">
        <div class="nm-pay-field"><label>Nombre completo <span style="color:#EF4444">*</span></label><input class="nm-pay-input" id="extName" placeholder="Nombre completo"></div>
        <div class="nm-pay-field"><label>Cédula <span style="color:#EF4444">*</span></label><input class="nm-pay-input" id="extDoc" placeholder="Sin puntos ni guiones"></div>
        <div class="nm-pay-field"><label>Teléfono</label><input class="nm-pay-input" id="extPhone" placeholder="Opcional"></div>
        <div class="nm-pay-field"><label>Banco</label><input class="nm-pay-input" id="extBank" placeholder="Opcional"></div>
        <div class="nm-pay-field">
          <label>Tipo de cuenta</label>
          <select class="nm-pay-select" id="extAccountType">
            <option value="AHORROS">Ahorros</option>
            <option value="CORRIENTE">Corriente</option>
          </select>
        </div>
        <div class="nm-pay-field"><label>Número de cuenta</label><input class="nm-pay-input" id="extAccount" placeholder="Opcional"></div>
      </div>
      <div style="margin-top:8px;font-size:12px;color:#64748B;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:8px">
        <b>Sin deducciones</b> — El externo recibe el valor bruto sin descuento de salud o pensión.<br>
        Se generarán soportes: cédula, certificación bancaria, cuenta de cobro.
      </div>
    </div>

    <button class="nm-pay-btn nm-pay-btn--primary" id="coverSave">Guardar cobertura</button>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();

  // Alternar secciones al cambiar tipo
  document.getElementById("coverType")?.addEventListener("change", (e) => {
    const isExt = e.target.value === "EXTERNA";
    document.getElementById("coverSectionInterna").hidden =  isExt;
    document.getElementById("coverSectionExterna").hidden = !isExt;
  });

  document.getElementById("coverSave")?.addEventListener("click", async () => {
    try {
      const coverType = document.getElementById("coverType").value;
      const days      = Number(document.getElementById("coverDays").value) || 1;
      const valueDia  = Number(document.getElementById("coverValueDay").value) || 0;

      const body = { cover_type: coverType, days, value_per_day: valueDia || undefined };

      if (coverType === "INTERNA") {
        body.internal_employee_id = document.getElementById("coverInternal").value;
        if (!body.internal_employee_id) { showError("Debe seleccionar el empleado interno"); return; }
      } else {
        body.full_name      = document.getElementById("extName").value.trim();
        body.document_number = document.getElementById("extDoc").value.trim();
        if (!body.full_name)       { showError("El nombre del externo es obligatorio"); return; }
        if (!body.document_number) { showError("La cédula del externo es obligatoria"); return; }
        body.phone        = document.getElementById("extPhone").value.trim();
        body.bank         = document.getElementById("extBank").value.trim();
        body.account_type = document.getElementById("extAccountType").value;
        body.account_number = document.getElementById("extAccount").value.trim();
      }

      await apiFetch(`/payroll/novelties/${noveltyId}/cover`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      closeModal();
      await reloadWorkArea();
      showSuccess("Cobertura registrada");
    } catch (err) { showError(err.message); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CUENTA DE COBRO (HTML/impresión) para turno externo
// ─────────────────────────────────────────────────────────────────────────────
function openChargeAccount(coverId) {
  window.open(`/payroll/turn-covers/${coverId}/charge-account`, "_blank");
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL: DESPRENDIBLE DE PAGO (por empleado/item)
// ─────────────────────────────────────────────────────────────────────────────

function buildPayslipHtmlDoc(data, forPrint = false) {
  const { employee, earnings, deductions, net, worked_days, covers, period, cambio_operativo, payslip } = data;
  const fmt = fmtCOP;

  // ── Novedades agrupadas ──────────────────────────────────────────────────
  let novSectionHtml = "";
  if (payslip && !cambio_operativo) {
    const salNovs  = payslip.salary_affecting_novelties    || [];
    const tranNovs = payslip.transport_affecting_novelties || [];
    if (salNovs.length || tranNovs.length) {
      let inner = "";
      if (salNovs.length) {
        inner += `<div class="nov-h nov-h--sal">Reducen salario, transporte y adicionales</div>`;
        salNovs.forEach((nov) => { inner += `<div class="nov-item"><span>${escapeHtml(nov.name)}</span><span>${nov.days}d</span></div>`; });
      }
      if (tranNovs.length) {
        inner += `<div class="nov-h nov-h--tra">Afectan transporte y adicionales</div>`;
        tranNovs.forEach((nov) => { inner += `<div class="nov-item"><span>${escapeHtml(nov.name)}</span><span>${nov.days}d</span></div>`; });
      }
      novSectionHtml = `<div class="section">${inner}</div>`;
    }
  }

  // ── Devengados ───────────────────────────────────────────────────────────
  let devRows = "";
  if (cambio_operativo) {
    devRows = `
      <div class="cambio-label">Cambio operativo de cobertura</div>
      <div class="row cambio"><span>${Number(cambio_operativo.days_original)} días — ${escapeHtml(cambio_operativo.original_category)}</span><b>${fmt(cambio_operativo.base_original + cambio_operativo.transport_original + cambio_operativo.other_original)}</b></div>
      <div class="row cambio"><span>${Number(cambio_operativo.days_new)} días — ${escapeHtml(cambio_operativo.new_category)}</span><b>${fmt(cambio_operativo.base_new + cambio_operativo.transport_new + cambio_operativo.other_new)}</b></div>`;
  } else {
    const sp  = payslip || {};
    const wd  = sp.worked_days           != null ? sp.worked_days           : worked_days;
    const spd = sp.salary_paid_days      != null ? sp.salary_paid_days      : wd;
    const tpd = sp.transport_paid_days   != null ? sp.transport_paid_days   : wd;
    devRows = `
      <div class="row"><span>Salario prop. (${spd}/${wd})</span><b>${fmt(earnings.base_salary)}</b></div>
      <div class="row"><span>Aux. transporte prop. (${tpd}/${wd})</span><b>${fmt(earnings.transport_allowance)}</b></div>
      ${Number(earnings.other_recargos_value) ? `<div class="row"><span>Otros recargos prop. (${tpd}/${wd})</span><b>${fmt(earnings.other_recargos_value)}</b></div>` : ""}`;
  }

  const coverHtml = (covers || []).map((c) =>
    `<div class="row"><span>Turno cubierto (${c.cover_type === "EXTERNA" ? `Ext: ${escapeHtml(c.ext_name || "")}` : `Int: ${escapeHtml(c.int_name || "")}`})</span><b>+${fmt(c.total_value)}</b></div>`
  ).join("");

  const printScript = forPrint ? `<script>window.onload=function(){window.print();}<\/script>` : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Desprendible — ${escapeHtml(employee.document)} — ${escapeHtml(period.label || "")}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1E293B;background:#fff;padding:24px}
  .slip{max-width:600px;margin:0 auto;border:1px solid #CBD5E1;border-radius:8px;overflow:hidden}
  .slip-header{background:#1E3A5F;color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center}
  .slip-header h1{font-size:16px;font-weight:700;letter-spacing:.5px}
  .slip-header span{font-size:11px;opacity:.75}
  .slip-info{background:#F8FAFC;border-bottom:1px solid #E2E8F0;padding:12px 20px;line-height:1.6}
  .slip-info strong{font-size:14px;color:#0F172A}
  .slip-info small{color:#64748B;font-size:12px}
  .section{border-bottom:1px solid #E2E8F0}
  .section-h{background:#F1F5F9;padding:8px 20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569}
  .row{display:flex;justify-content:space-between;align-items:baseline;padding:6px 20px;border-top:1px solid #F1F5F9}
  .row b{font-weight:600;white-space:nowrap;padding-left:12px}
  .row.total{background:#F8FAFC;font-weight:700;font-size:14px;border-top:2px solid #E2E8F0}
  .section-net{border:none}
  .section-net .section-h{background:#ECFDF5;color:#0F766E}
  .section-net .row.total{font-size:17px;padding:14px 20px;color:#0F766E}
  .nov-h{padding:6px 20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
  .nov-h--sal{background:#FFF1F2;color:#BE123C;border-left:3px solid #F43F5E}
  .nov-h--tra{background:#FFFBEB;color:#B45309;border-left:3px solid #F59E0B}
  .nov-item{display:flex;justify-content:space-between;padding:4px 20px 4px 26px;font-size:12px;color:#475569;border-top:1px solid #F1F5F9}
  .cambio-label{padding:8px 20px 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#7C3AED}
  .row.cambio{border-left:3px solid #DDD6FE;padding-left:17px;margin-left:20px}
  .slip-footer{padding:10px 20px;font-size:11px;color:#94A3B8;text-align:center}
  @media print{body{padding:0}.slip{border:none;border-radius:0;max-width:100%}}
</style>
${printScript}
</head>
<body>
<div class="slip">
  <div class="slip-header">
    <h1>EMPIRIA — Desprendible de Pago</h1>
    <span>Generado ${new Date().toLocaleDateString("es-CO")}</span>
  </div>
  <div class="slip-info">
    <strong>${escapeHtml(employee.name)}</strong><br>
    <small>CC ${escapeHtml(employee.document)} &nbsp;·&nbsp; ${escapeHtml(employee.municipality || "")} &nbsp;·&nbsp; ${escapeHtml(employee.institution || "")} &nbsp;·&nbsp; ${escapeHtml(employee.site || "")}</small><br>
    <small>${escapeHtml(employee.modality || "")} &nbsp;·&nbsp; ${escapeHtml(employee.work_time || "")} &nbsp;·&nbsp; Período: <b>${escapeHtml(period.label || "")}</b>${data.salary_category ? ` &nbsp;·&nbsp; <b style="color:#6D28D9">${escapeHtml(data.salary_category)}</b>` : ""}</small>
  </div>

  ${novSectionHtml}

  <div class="section">
    <div class="section-h">Devengados</div>
    ${devRows}
    ${Number(earnings.internal_cover_value) ? `<div class="row"><span>Turno cubierto (cobro)</span><b>+${fmt(earnings.internal_cover_value)}</b></div>` : ""}
    ${coverHtml}
    <div class="row total"><span>Total Devengado</span><b>${fmt(earnings.total_devengado)}</b></div>
  </div>

  <div class="section">
    <div class="section-h">Deducciones</div>
    <div class="row"><span>Salud (4 %)</span><b>-${fmt(deductions.salud)}</b></div>
    <div class="row"><span>Pensión (4 %)</span><b>-${fmt(deductions.pension)}</b></div>
    <div class="row total"><span>Total Deducciones</span><b>-${fmt(deductions.total_deducciones)}</b></div>
  </div>

  <div class="section section-net">
    <div class="section-h">Neto a pagar</div>
    <div class="row total"><span>NETO A PAGAR</span><b>${fmt(net)}</b></div>
  </div>

  <div class="slip-footer">EMPIRIA — Sistema de Gestión de Nómina Operativa</div>
</div>
</body>
</html>`;
}

function printPayslip(data) {
  const w = window.open("", "_blank", "width=700,height=900");
  if (!w) { showError("El navegador bloqueó la ventana emergente. Permite ventanas emergentes e intenta de nuevo."); return; }
  w.document.write(buildPayslipHtmlDoc(data, false));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

function downloadPayslipPdf(data) {
  const { employee, period } = data;
  const doc = data.document || employee.document || "empleado";
  const per = (period.label || "periodo").replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `desprendible_${doc}_${per}.pdf`;
  const w = window.open("", "_blank", "width=700,height=900");
  if (!w) { showError("El navegador bloqueó la ventana emergente. Permite ventanas emergentes e intenta de nuevo."); return; }
  w.document.title = filename;
  w.document.write(buildPayslipHtmlDoc(data, true));
  w.document.close();
  w.focus();
}

async function openPayslipModal(itemId) {
  try {
    const response = await apiFetch(`/payroll/items/${itemId}/slip`);
    const data = response.data;
    if (!data) { showError("No se pudo cargar el desprendible"); return; }

    const { employee, earnings, deductions, net, worked_days, covers, period, cambio_operativo, payslip } = data;
    const fmt = fmtCOP;

    // ── Cabecera del empleado ──────────────────────────────────────────────
    const headerHtml = `
<div style="font-size:13px;color:#334155;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:10px;margin-bottom:10px">
  <b>${escapeHtml(employee.name)}</b> — CC ${escapeHtml(employee.document)}<br>
  <span style="color:#64748B">${escapeHtml(employee.municipality || "")} &nbsp;·&nbsp; ${escapeHtml(employee.institution || "")} &nbsp;·&nbsp; ${escapeHtml(employee.site || "")}</span><br>
  <span style="color:#64748B">${escapeHtml(employee.modality || "")} &nbsp;·&nbsp; ${escapeHtml(employee.work_time || "")} &nbsp;·&nbsp; Período: <b>${escapeHtml(period.label || "")}</b>${data.salary_category ? ` &nbsp;·&nbsp; ${salaryCategoryBadge(data.salary_category)}` : ""}</span>
</div>`;

    // ── Novedades agrupadas (solo si no es cambio operativo) ───────────────
    let novSectionHtml = "";
    if (payslip && !cambio_operativo) {
      const salNovs  = payslip.salary_affecting_novelties    || [];
      const tranNovs = payslip.transport_affecting_novelties || [];
      if (salNovs.length || tranNovs.length) {
        let inner = "";
        if (salNovs.length) {
          inner += `<div class="nm-slip-nov-h nm-slip-nov-h--sal">Reducen salario, transporte y adicionales</div>`;
          salNovs.forEach((nov) => {
            inner += `<div class="nm-slip-nov-item"><span>${escapeHtml(nov.name)}</span><span style="color:#BE123C;font-weight:600">${nov.days}d</span></div>`;
          });
        }
        if (tranNovs.length) {
          inner += `<div class="nm-slip-nov-h nm-slip-nov-h--tra">Afectan transporte y adicionales</div>`;
          tranNovs.forEach((nov) => {
            inner += `<div class="nm-slip-nov-item"><span>${escapeHtml(nov.name)}</span><span style="color:#B45309;font-weight:600">${nov.days}d</span></div>`;
          });
        }
        novSectionHtml = `<div class="nm-slip-section">${inner}</div>`;
      }
    }

    // ── Devengados ─────────────────────────────────────────────────────────
    let devHtml = "";
    if (cambio_operativo) {
      devHtml = `
        <div style="font-size:11px;font-weight:600;color:#7C3AED;text-transform:uppercase;letter-spacing:.5px;padding:6px 12px 2px">Cambio operativo de cobertura</div>
        <div class="nm-slip-row" style="border-left:3px solid #DDD6FE;padding-left:8px">
          <span>${Number(cambio_operativo.days_original)} días — ${escapeHtml(cambio_operativo.original_category)}</span>
          <b>${fmt(cambio_operativo.base_original + cambio_operativo.transport_original + cambio_operativo.other_original)}</b>
        </div>
        <div class="nm-slip-row" style="border-left:3px solid #DDD6FE;padding-left:8px">
          <span>${Number(cambio_operativo.days_new)} días — ${escapeHtml(cambio_operativo.new_category)}</span>
          <b>${fmt(cambio_operativo.base_new + cambio_operativo.transport_new + cambio_operativo.other_new)}</b>
        </div>`;
    } else {
      const sp  = payslip || {};
      const wd  = sp.worked_days         != null ? sp.worked_days         : worked_days;
      const spd = sp.salary_paid_days    != null ? sp.salary_paid_days    : wd;
      const tpd = sp.transport_paid_days != null ? sp.transport_paid_days : wd;
      devHtml = `
        <div class="nm-slip-row"><span>Salario prop. (${spd}/${wd})</span><b>${fmt(earnings.base_salary)}</b></div>
        <div class="nm-slip-row"><span>Aux. transporte prop. (${tpd}/${wd})</span><b>${fmt(earnings.transport_allowance)}</b></div>
        ${Number(earnings.other_recargos_value) ? `<div class="nm-slip-row"><span>Otros recargos prop. (${tpd}/${wd})</span><b>${fmt(earnings.other_recargos_value)}</b></div>` : ""}`;
    }

    const coverRows = (covers || []).map((c) => `
      <div class="nm-slip-row">
        <span>Turno cubierto (${c.cover_type === "EXTERNA" ? `Ext: ${escapeHtml(c.ext_name || "")}` : `Int: ${escapeHtml(c.int_name || "")}`})</span>
        <b>+${fmt(c.total_value)}</b>
      </div>`).join("");

    const modal = document.getElementById("nmPayModal");
    modal.innerHTML = `
<div class="nm-pay-dialog">
  <div class="nm-pay-dialog-h">
    <b>Desprendible de pago</b>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="nm-pay-btn nm-pay-btn--sm" id="nmSlipPrint">Imprimir</button>
      <button class="nm-pay-btn nm-pay-btn--sm" id="nmSlipPdf">Descargar PDF</button>
      <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
    </div>
  </div>
  <div class="nm-pay-dialog-b">
    ${headerHtml}
    ${novSectionHtml}
    <div class="nm-slip-section">
      <div class="nm-slip-section-h">Devengados</div>
      ${devHtml}
      ${Number(earnings.internal_cover_value) ? `<div class="nm-slip-row"><span>Turno cubierto (cobro)</span><b>+${fmt(earnings.internal_cover_value)}</b></div>` : ""}
      ${coverRows}
      <div class="nm-slip-row nm-slip-total"><span>Total Devengado</span><b>${fmt(earnings.total_devengado)}</b></div>
    </div>
    <div class="nm-slip-section">
      <div class="nm-slip-section-h">Deducciones</div>
      <div class="nm-slip-row"><span>Salud (4 %)</span><b>-${fmt(deductions.salud)}</b></div>
      <div class="nm-slip-row"><span>Pensión (4 %)</span><b>-${fmt(deductions.pension)}</b></div>
      <div class="nm-slip-row nm-slip-total"><span>Total Deducciones</span><b>-${fmt(deductions.total_deducciones)}</b></div>
    </div>
    <div class="nm-slip-section" style="border-color:#0F766E">
      <div class="nm-slip-section-h" style="background:#ECFDF5;color:#0F766E">Neto a pagar</div>
      <div class="nm-slip-row nm-slip-total" style="font-size:17px;padding:12px">
        <span>NETO A PAGAR</span>
        <b style="color:#0F766E">${fmt(net)}</b>
      </div>
    </div>
  </div>
</div>`;
    modal.hidden = false;
    wireModalClose();
    document.getElementById("nmSlipPrint")?.addEventListener("click", () => printPayslip(data));
    document.getElementById("nmSlipPdf")?.addEventListener("click",   () => downloadPayslipPdf(data));
  } catch (err) {
    showError(err.message || "Error cargando desprendible");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE MODAL INTERNO (reemplazan prompt/confirm nativos)
// ─────────────────────────────────────────────────────────────────────────────
function showConfirmModal(title, bodyHtml, onConfirm, { confirmLabel = "Confirmar", danger = false } = {}) {
  const modal = document.getElementById("nmPayModal");
  const btnCls = danger ? "nm-pay-btn nm-pay-btn--danger" : "nm-pay-btn nm-pay-btn--primary";
  modal.innerHTML = `
<div class="nm-pay-dialog" style="max-width:460px">
  <div class="nm-pay-dialog-h">
    <b>${escapeHtml(title)}</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cancelar</button>
  </div>
  <div class="nm-pay-dialog-b" style="gap:14px">
    <div style="font-size:13px;line-height:1.5;color:#334155">${bodyHtml}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="nm-pay-btn" data-close-modal>Cancelar</button>
      <button class="${btnCls}" id="nmConfirmOkBtn">${escapeHtml(confirmLabel)}</button>
    </div>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();
  document.getElementById("nmConfirmOkBtn")?.addEventListener("click", () => {
    closeModal();
    onConfirm();
  });
}

function showPromptModal(title, label, placeholder, onConfirm) {
  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<div class="nm-pay-dialog" style="max-width:460px">
  <div class="nm-pay-dialog-h">
    <b>${escapeHtml(title)}</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cancelar</button>
  </div>
  <div class="nm-pay-dialog-b" style="gap:14px">
    <div class="nm-prompt-field">
      <label>${escapeHtml(label)}</label>
      <input class="nm-prompt-input" id="nmPromptInput" type="text" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="nm-pay-btn" data-close-modal>Cancelar</button>
      <button class="nm-pay-btn nm-pay-btn--primary" id="nmPromptOkBtn">Confirmar</button>
    </div>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();
  const input = document.getElementById("nmPromptInput");
  const ok    = document.getElementById("nmPromptOkBtn");
  input?.focus();
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter") ok?.click(); });
  ok?.addEventListener("click", () => {
    const value = (input?.value || "").trim();
    if (!value) { input?.focus(); input?.style && (input.style.borderColor = "#F43F5E"); return; }
    closeModal();
    onConfirm(value);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// REVISIÓN DE NOVEDADES
// ─────────────────────────────────────────────────────────────────────────────
async function toggleReviewed(noveltyId, reviewed, input) {
  if (!reviewed) {
    // Quitar revisión: pedir motivo con modal interno
    showPromptModal(
      "Quitar revisión de novedad",
      "Motivo para quitar la marca de revisada",
      "Escribe el motivo aquí…",
      async (reason) => {
        try {
          await apiFetch(`/payroll/novelties/${noveltyId}/reviewed`, {
            method: "PATCH",
            body: JSON.stringify({ reviewed: false, reason }),
          });
          await reloadWorkArea();
          showSuccess("Revisión removida — novedad editable");
        } catch (err) {
          input.checked = true;
          showError(err.message);
        }
      }
    );
    // Revertir checkbox visualmente hasta que el usuario confirme
    input.checked = true;
  } else {
    try {
      await apiFetch(`/payroll/novelties/${noveltyId}/reviewed`, {
        method: "PATCH",
        body: JSON.stringify({ reviewed: true, reason: "" }),
      });
      await reloadWorkArea();
      showSuccess("Novedad marcada como revisada");
    } catch (err) {
      input.checked = false;
      showError(err.message);
    }
  }
}

async function toggleItemReviewed(itemId, checked, inputEl) {
  if (checked) {
    showConfirmModal(
      "Marcar como revisado",
      `¿Marcar este registro de nómina como <b>REVISADO</b>?<br><br>
      El registro quedará completamente bloqueado para edición. Solo podrá ver el desprendible.`,
      async () => {
        try {
          await apiFetch(`/payroll/items/${itemId}/reviewed`, {
            method: "PATCH",
            body: JSON.stringify({ reviewed: true }),
          });
          await reloadDetailOnly();
          showSuccess("Registro de nómina revisado y bloqueado.");
        } catch (err) {
          inputEl.checked = false;
          showError(err.message);
        }
      },
      { confirmLabel: "Marcar revisado" }
    );
    inputEl.checked = false; // revertir visualmente hasta confirmar
  } else {
    showPromptModal(
      "Desbloquear registro",
      "Motivo para quitar la revisión (obligatorio)",
      "Escribe el motivo aquí…",
      async (reason) => {
        try {
          await apiFetch(`/payroll/items/${itemId}/reviewed`, {
            method: "PATCH",
            body: JSON.stringify({ reviewed: false, reason }),
          });
          await reloadDetailOnly();
          showSuccess("Registro de nómina desbloqueado.");
        } catch (err) {
          inputEl.checked = true;
          showError(err.message);
        }
      }
    );
    inputEl.checked = true; // revertir visualmente hasta confirmar
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ELIMINAR NOVEDAD
// ─────────────────────────────────────────────────────────────────────────────
async function confirmDeleteNovelty(noveltyId) {
  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<div class="nm-pay-dialog">
  <div class="nm-pay-dialog-h">
    <b>Eliminar novedad</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cancelar</button>
  </div>
  <div class="nm-pay-dialog-b" style="gap:16px">
    <div style="padding:14px;background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;color:#991B1B;font-size:13px;line-height:1.5">
      ¿Desea eliminar esta novedad?<br>
      <b>Esta acción revertirá los cálculos relacionados.</b><br>
      <small style="color:#B91C1C">Los soportes y coberturas asociadas también serán eliminados.</small>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="nm-pay-btn" data-close-modal>Cancelar</button>
      <button class="nm-pay-btn nm-pay-btn--danger" id="doDeleteNoveltyBtn">Eliminar novedad</button>
    </div>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();
  document.getElementById("doDeleteNoveltyBtn")?.addEventListener("click", async () => {
    document.getElementById("doDeleteNoveltyBtn").disabled = true;
    document.getElementById("doDeleteNoveltyBtn").textContent = "Eliminando…";
    try {
      await apiFetch(`/payroll/novelties/${noveltyId}`, { method: "DELETE" });
      closeModal();
      await reloadWorkArea();
      showSuccess("Novedad eliminada — nómina recalculada.");
    } catch (err) {
      closeModal();
      showError(err.message);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CERRAR NÓMINA MUNICIPAL
// ─────────────────────────────────────────────────────────────────────────────
function closeAndSendGroup() {
  if (!activeGroupId) return;
  showConfirmModal(
    "Cerrar y enviar nómina",
    `Esta acción <b>cerrará la nómina</b> del municipio y bloqueará nuevas modificaciones.<br><br>
    Solo quedará habilitado:<br>
    <ul style="margin:8px 0 0 16px;font-size:12px;color:#475569">
      <li>Ver desprendibles</li>
      <li>Imprimir / descargar PDF</li>
      <li>Exportar Excel</li>
    </ul><br>
    ¿Desea continuar?`,
    async () => {
      try {
        await apiFetch(`/payroll/groups/${activeGroupId}/close`, { method: "PATCH" });
        await reloadWorkArea();
        showSuccess("Nómina cerrada correctamente.");
      } catch (err) {
        showError(err.message);
      }
    },
    { confirmLabel: "Cerrar nómina", danger: true }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL: SOPORTES
// ─────────────────────────────────────────────────────────────────────────────
async function openSupportsModal() {
  try {
    const params   = activePeriod ? `?periodId=${activePeriod.id}` : "";
    const response = await apiFetch(`/payroll/supports${params}`);
    const supports = Array.isArray(response.data) ? response.data : [];
    const statusLabel = { pendiente: "Pendiente", cargado: "Cargado", aprobado: "Aprobado", rechazado: "Rechazado" };
    const modal = document.getElementById("nmPayModal");
    modal.innerHTML = `
<div class="nm-pay-dialog">
  <div class="nm-pay-dialog-h">
    <b>Control de soportes documentales</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
  </div>
  <div class="nm-pay-dialog-b">
    ${supports.length ? `
    <div style="overflow:auto">
    <table class="nm-pay-table">
      <thead><tr><th>Empleado</th><th>Municipio</th><th>Novedad</th><th>Soporte</th><th>Estado</th><th>Obs.</th><th></th></tr></thead>
      <tbody>${supports.map((s) => `
        <tr>
          <td>${escapeHtml(s.employee_name || "")}<br><small>${escapeHtml(s.document_number || "")}</small></td>
          <td>${escapeHtml(s.municipality_name || "")}</td>
          <td>${escapeHtml(s.novelty_type || "")}</td>
          <td>${escapeHtml(s.support_type || "")}</td>
          <td>${escapeHtml(statusLabel[s.status] || s.status || "")}</td>
          <td>${escapeHtml(s.observations || "")}</td>
          <td style="white-space:nowrap">
            <button class="nm-pay-btn nm-pay-btn--sm" data-support-status="${s.id}" data-status="cargado">Cargado</button>
            <button class="nm-pay-btn nm-pay-btn--sm" data-support-status="${s.id}" data-status="aprobado">Aprobar</button>
            <button class="nm-pay-btn nm-pay-btn--sm nm-pay-btn--danger" data-support-status="${s.id}" data-status="rechazado">Rechazar</button>
          </td>
        </tr>`).join("")}</tbody>
    </table>
    </div>` : `<div class="nm-pay-empty">No hay soportes registrados en este período.</div>`}
    <div class="nm-pay-doc" style="font-size:12px">Los soportes son informativos y NO bloquean cálculo, revisión, cierre ni exportación de la nómina.</div>
  </div>
</div>`;
    modal.hidden = false;
    wireModalClose();
    modal.querySelectorAll("[data-support-status]").forEach((btn) => btn.addEventListener("click", async () => {
      await apiFetch("/payroll/supports", {
        method: "POST",
        body: JSON.stringify({ id: btn.dataset.supportStatus, status: btn.dataset.status }),
      });
      closeModal();
      await reloadWorkArea();
      showSuccess("Soporte actualizado");
    }));
  } catch (err) { showError(err.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES DE MODAL
// ─────────────────────────────────────────────────────────────────────────────
function wireModalClose() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", closeModal));
}
function closeModal() {
  const modal = document.getElementById("nmPayModal");
  if (modal) { modal.hidden = true; modal.innerHTML = ""; }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRYPOINTS EXPORTADOS
// ─────────────────────────────────────────────────────────────────────────────
export async function loadPayrollModule() {
  periods           = [];
  activePeriod      = null;
  groupsState       = { positions: [], groups: [] };
  activePosition    = "";
  activeGroupId     = null;
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
