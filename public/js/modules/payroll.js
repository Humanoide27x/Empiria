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
  { code: "INCAPACIDAD_MEDICA",            name: "Incapacidad Médica",               affects_salary: false, affects_transport: true,  requires_turn_cover: true  },
  { code: "INCAPACIDAD_ACCIDENTE_LABORAL", name: "Incapacidad por Accidente Laboral",affects_salary: false, affects_transport: true,  requires_turn_cover: true  },
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
let activeGroupTurns  = null;  // null = sin cargar, [] = sin turnos
let turnosFilter      = { type: "TODOS", search: "" };
let periodMonth      = new Date().toISOString().slice(0, 7);
let municipalitySearch = "";
let activeDetailTab  = "nomina"; // "nomina" | "novedades" | "turnos"

// ── Soportes tab state ────────────────────────────────────────────────────────
let activePrimaryTab = "nomina"; // "nomina" | "soportes"
let supportsData     = [];
let supportsFilters  = { municipalityId: "", status: "", noveltyType: "", employee: "" };
let viewerSupportId  = null;

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
function canEditBankInfo() {
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
  const s = String(status || "IN_REVIEW");
  const label = {
    pendiente: "Pendiente", en_revision: "En revisión",
    revisada: "Revisada", cerrada: "Cerrada",
    DRAFT: "Borrador", IN_REVIEW: "En revisión", CLOSED: "Cerrada",
    REOPENED: "Reabierta", SENT: "Enviada", PAID: "Pagada",
  }[s] || s;
  const cls = {
    DRAFT: "draft", IN_REVIEW: "en_revision", CLOSED: "cerrada",
    REOPENED: "reopened", SENT: "sent", PAID: "paid",
    pendiente: "pendiente", en_revision: "en_revision", revisada: "revisada", cerrada: "cerrada",
  }[s] || s.toLowerCase();
  return `<span class="nm-pay-badge nm-pay-badge--${escapeHtml(cls)}">${escapeHtml(label)}</span>`;
}
function isGroupClosed(group) {
  return group?.status === "CLOSED" || group?.status === "cerrada";
}
function isGroupReopened(group) {
  return group?.status === "REOPENED";
}
function isGroupEditable(group) {
  const s = group?.status;
  return !s || s === "DRAFT" || s === "IN_REVIEW" || s === "REOPENED" ||
         s === "pendiente" || s === "en_revision" || s === "revisada";
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
.nm-pay-badge--in_review{background:#DBEAFE;color:#1E40AF}
.nm-pay-badge--en_revision{background:#DBEAFE;color:#1E40AF}
.nm-pay-badge--closed,.nm-pay-badge--cerrada{background:#1E293B;color:#F8FAFC}
.nm-pay-badge--reopened{background:#FEF3C7;color:#92400E;animation:nm-blink .8s ease infinite alternate}
.nm-pay-badge--sent{background:#DCFCE7;color:#166534}
.nm-pay-badge--paid{background:#F3E8FF;color:#7C3AED}
.nm-pay-badge--draft,.nm-pay-badge--pendiente{background:#F1F5F9;color:#64748B}
.nm-pay-badge--revisada{background:#D1FAE5;color:#065F46}
@keyframes nm-blink{from{opacity:1}to{opacity:.65}}
.nm-pay-doc{background:#FEF3C7;color:#92400E}
.nm-pay-ok{background:#DCFCE7;color:#166534}
/* Banners de estado */
.nm-banner{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-radius:6px;font-size:13px;margin-bottom:8px;border:1px solid transparent}
.nm-banner--closed{background:#F1F5F9;border-color:#CBD5E1;color:#334155}
.nm-banner--reopened{background:#FFFBEB;border-color:#F59E0B;color:#92400E}
.nm-banner--recalc{background:#FFF7ED;border-color:#FB923C;color:#7C2D12}
.nm-banner__icon{font-size:16px;flex-shrink:0;margin-top:1px}
.nm-banner__body{flex:1}
.nm-banner__title{font-weight:700;margin-bottom:2px}
.nm-banner__detail{font-size:12px;opacity:.8}
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
  .nm-sup-viewer-panel{display:none}
}

/* ── Pestañas primarias (Nómina | Soportes) ──────────────────────── */
.nm-primary-tabs{display:flex;gap:0;border-bottom:2px solid #E2E8F0;background:#fff;flex:0 0 auto;padding:0 10px}
.nm-primary-tab{border:0;background:none;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;color:#64748B;border-bottom:3px solid transparent;margin-bottom:-2px;white-space:nowrap}
.nm-primary-tab:hover{color:#0F766E}
.nm-primary-tab.active{color:#0F766E;border-bottom-color:#0F766E}
.nm-primary-tab .nm-pay-count{background:#FEF3C7;color:#92400E;font-size:11px;display:inline-flex;min-width:16px;height:16px;align-items:center;justify-content:center;border-radius:999px;margin-left:4px;padding:0 4px}

/* ── Vista de Soportes ──────────────────────────────────────────── */
.nm-sup-view{flex:1 1 auto;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.nm-sup-filters{display:flex;gap:6px;flex-wrap:wrap;padding:7px 10px;border-bottom:1px solid #E2E8F0;background:#F8FAFC;flex:0 0 auto;align-items:center}
.nm-sup-filters label{font-size:11px;font-weight:700;color:#475569}
.nm-sup-metrics{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #E2E8F0;background:#fff;flex:0 0 auto}
.nm-sup-metric{padding:8px 12px;border-right:1px solid #E2E8F0;text-align:center}
.nm-sup-metric:last-child{border-right:0}
.nm-sup-metric span{display:block;font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:.03em}
.nm-sup-metric b{display:block;font-size:18px;font-weight:800;color:#0F172A;margin-top:2px}
.nm-sup-metric--pending b{color:#D97706}
.nm-sup-metric--approved b{color:#166534}
.nm-sup-metric--rejected b{color:#B91C1C}
.nm-sup-metric--nofile b{color:#64748B}

/* ── Layout tabla + visor ────────────────────────────────────────── */
.nm-sup-body{flex:1 1 auto;min-height:0;overflow:hidden;display:flex}
.nm-sup-table-panel{flex:1 1 auto;min-width:0;overflow:auto}
.nm-sup-viewer-panel{width:400px;flex:0 0 400px;border-left:1px solid #E2E8F0;display:flex;flex-direction:column;background:#fff}
.nm-sup-viewer-panel[hidden]{display:none!important}
.nm-sup-viewer-head{padding:8px 10px;border-bottom:1px solid #E2E8F0;font-size:12px;font-weight:700;color:#334155;display:flex;justify-content:space-between;align-items:center;flex:0 0 auto;background:#F8FAFC;gap:6px}
.nm-sup-viewer-head span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
.nm-sup-viewer-body{flex:1 1 auto;min-height:0;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#F1F5F9;position:relative}
.nm-sup-viewer-iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.nm-sup-viewer-img{max-width:100%;max-height:100%;object-fit:contain;padding:8px}
.nm-sup-review-panel{flex:0 0 auto;border-top:1px solid #E2E8F0;padding:10px;display:flex;flex-direction:column;gap:6px;background:#fff}

/* ── Badges de estado de soporte ────────────────────────────────── */
.nm-sup-badge{display:inline-flex;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:700;white-space:nowrap}
.nm-sup-badge--pendiente{background:#FEF3C7;color:#92400E}
.nm-sup-badge--cargado{background:#DBEAFE;color:#1E40AF}
.nm-sup-badge--aprobado{background:#DCFCE7;color:#166534}
.nm-sup-badge--rechazado{background:#FEE2E2;color:#991B1B}
.nm-sup-badge--correccion_solicitada{background:#FFEDD5;color:#C2410C}

/* ── Tabla de soportes ───────────────────────────────────────────── */
.nm-sup-row-active td{background:#ECFDF5!important}
.nm-sup-table td{padding:5px 7px;font-size:12px}
.nm-sup-table thead th{font-size:11px;padding:5px 7px;white-space:nowrap}
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
  if (!activePeriod || !activeGroupId) { activeGroupDetail = null; activeGroupTurns = null; return; }
  const response = await apiFetch(`/payroll/${activePeriod.id}/groups/${activeGroupId}`);
  activeGroupDetail = response.data || null;
  activeGroupTurns  = null; // reset para forzar recarga al entrar a la pestaña
}

async function loadGroupTurns() {
  if (!activeGroupId) { activeGroupTurns = []; return; }
  try {
    const response = await apiFetch(`/payroll/groups/${activeGroupId}/turns`);
    activeGroupTurns = response.turns || [];
  } catch (_) {
    activeGroupTurns = [];
  }
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
</div>

<!-- ── Pestañas primarias: Nómina | Soportes ──────────────────────── -->
${renderPrimaryTabs()}

${activePrimaryTab === "soportes" ? renderSupportsShell() : renderNominaPanel()}
</div>
`;
  wireStaticEvents();
}

function renderPrimaryTabs() {
  if (!activePeriod) return "";
  const pendingCount = activePrimaryTab === "soportes"
    ? supportsData.filter((s) => (s.status || s.support_status) === "pendiente").length
    : groupsState.positions.reduce((s, p) => s + Number(p.pending_supports || 0), 0);
  return `
<div class="nm-primary-tabs">
  <button class="nm-primary-tab ${activePrimaryTab === "nomina" ? "active" : ""}" data-primary-tab="nomina">Nómina</button>
  <button class="nm-primary-tab ${activePrimaryTab === "soportes" ? "active" : ""}" data-primary-tab="soportes">
    Soportes${pendingCount > 0 ? ` <span class="nm-pay-count">${pendingCount}</span>` : ""}
  </button>
</div>`;
}

function renderNominaPanel() {
  const totals = municipalityTotals();
  const ctx    = kpiContextLabel();
  return `
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

${activePeriod ? renderOperationalBody() : `<div style="padding:20px"><div class="nm-pay-empty">Crea o selecciona un periodo de nómina.</div></div>`}`;
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
        ${(() => {
          const rev = Number(mun.items_reviewed || 0);
          const tot = Number(mun.employees || 0);
          if (!tot) return "";
          if (rev >= tot) return `<span class="nm-pay-ok" style="font-size:10px;padding:1px 5px">&#10003; ${tot}/${tot} rev.</span>`;
          if (rev > 0) return `<span style="font-size:10px;padding:1px 5px;background:#FEF3C7;color:#92400E;border-radius:3px;display:inline-block">${rev}/${tot} rev.</span>`;
          return "";
        })()}
      </button>`).join("") : `<div class="nm-pay-empty" style="padding:16px">Sin municipios.</div>`}
  </div>
</aside>`;
}

function renderGroupDetail() {
  if (!activeGroupDetail) return `
    <div class="nm-pay-toolbar" style="border:0;padding:16px">
      <div class="nm-pay-empty" style="flex:1">Selecciona un municipio para ver su nómina.</div>
    </div>`;
  const { group, items, novelties, covers, totals } = activeGroupDetail;
  const municipality = currentMunicipalityData();
  const municipalityName = municipality?.municipality_name || group?.municipality_name || "";
  const isClosed    = isGroupClosed(group);
  const isReopened  = isGroupReopened(group);
  const editable    = isGroupEditable(group);
  const allReviewed = totals.employees > 0 && totals.items_reviewed === totals.employees;
  const needsRecalc = Boolean(group?.needs_recalculation);
  const version     = Number(group?.version_number || 1);
  const canClose    = allReviewed && editable && !needsRecalc;
  const canReopen   = isClosed && isTH();

  const bannerHtml = (() => {
    if (isClosed) return `
<div class="nm-banner nm-banner--closed">
  <span class="nm-banner__icon">🔒</span>
  <div class="nm-banner__body">
    <div class="nm-banner__title">Nómina cerrada — v${version}</div>
    <div class="nm-banner__detail">Cerrada el ${group.closed_at ? new Date(group.closed_at).toLocaleString("es-CO") : "—"}. Solo lectura.</div>
  </div>
  ${canReopen ? `<button class="nm-pay-btn nm-pay-btn--sm" id="nmPayReopen" style="align-self:center;flex-shrink:0">Reabrir nómina</button>` : ""}
</div>`;
    if (isReopened) return `
<div class="nm-banner nm-banner--reopened">
  <span class="nm-banner__icon">⚠</span>
  <div class="nm-banner__body">
    <div class="nm-banner__title">Nómina reabierta para corrección — v${version}</div>
    <div class="nm-banner__detail">Motivo: ${escapeHtml(group.reopen_reason || "—")} · Reabierta el ${group.reopened_at ? new Date(group.reopened_at).toLocaleString("es-CO") : "—"}</div>
  </div>
</div>`;
    return "";
  })();

  const recalcBanner = (needsRecalc && !isClosed) ? `
<div class="nm-banner nm-banner--recalc">
  <span class="nm-banner__icon">⟳</span>
  <div class="nm-banner__body">
    <div class="nm-banner__title">Recalculación pendiente</div>
    <div class="nm-banner__detail">Se realizaron cambios. Recalcule antes de cerrar nuevamente.</div>
  </div>
</div>` : "";

  return `
<!-- Toolbar fijo (sin sticky, el contenedor flex lo mantiene arriba) -->
<div class="nm-pay-toolbar">
  <div>
    <h3 class="nm-pay-section-title">${escapeHtml(municipalityName || "Municipio")}</h3>
    <div class="nm-pay-section-meta">${escapeHtml(group?.operational_position || activePosition)} · ${statusBadge(group?.status)} v${version} ${pendingSupportBadge(totals.pending_supports)}</div>
  </div>
  <div class="nm-pay-actions">
    ${editable ? `<button class="nm-pay-btn nm-pay-btn--primary nm-pay-btn--sm" id="nmPayCalculate">${isReopened ? "Recalcular" : "Calcular"}</button>` : ""}
    <button class="nm-pay-btn nm-pay-btn--sm" id="nmPayExport">Exportar</button>
    <button class="nm-pay-btn nm-pay-btn--sm" id="nmPayHistory" title="Historial de cambios">Historial</button>
    ${canClose ? `<button class="nm-pay-btn nm-pay-btn--warning nm-pay-btn--sm" id="nmPayClose">${isReopened ? "Cerrar nuevamente" : "Cerrar y enviar nómina"}</button>` : ""}
    ${isClosed && canReopen ? `<button class="nm-pay-btn nm-pay-btn--sm" id="nmPayReopen">Reabrir nómina</button>` : ""}
  </div>
</div>
${bannerHtml}
${recalcBanner}

<!-- Cuerpo scrollable con pestañas Nómina / Novedades / Turnos -->
<div class="nm-pay-scroll-body">
  <div class="nm-detail-tabs">
    <button class="nm-detail-tab ${activeDetailTab === "nomina" ? "active" : ""}" data-detail-tab="nomina">Nómina</button>
    <button class="nm-detail-tab ${activeDetailTab === "novedades" ? "active" : ""}" data-detail-tab="novedades">
      Novedades <span class="nm-pay-count">${novelties.length}</span>
    </button>
    <button class="nm-detail-tab ${activeDetailTab === "turnos" ? "active" : ""}" data-detail-tab="turnos">
      Turnos${activeGroupTurns !== null ? ` <span class="nm-pay-count">${activeGroupTurns.length}</span>` : ""}
    </button>
  </div>
  ${activeDetailTab === "nomina"
    ? (items.length
        ? renderItemsTable(items)
        : `<div class="nm-pay-empty">Pulsa "Calcular" para cargar los empleados activos.</div>`)
    : activeDetailTab === "novedades"
    ? (novelties.length
        ? `<div class="nm-pay-table-wrap">${renderNoveltiesTable(novelties)}</div>`
        : `<div class="nm-pay-empty">Sin novedades registradas en este municipio.</div>`)
    : (activeGroupTurns === null
        ? `<div class="nm-pay-empty">Cargando turnos…</div>`
        : renderTurnosSection(activeGroupTurns, isClosed))}
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
  const groupLocked = !isGroupEditable(activeGroupDetail?.group);
  const extCoverItemIds = new Set(
    ((activeGroupDetail?.covers) || [])
      .filter((c) => c.cover_type === "EXTERNA")
      .map((c) => c.payroll_item_id)
  );
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
      const locked = groupLocked || isReviewed;
      const hasExtCover = extCoverItemIds.has(item.id);
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
        <td class="num">
          ${fmtCOP(item.total_devengado)}
          ${hasExtCover ? `<br><small style="color:#92400E;font-size:10px;font-weight:600">Turno ext. registrado</small>` : ""}
        </td>
        <td class="num">${fmtCOP(item.total_deducciones)}</td>
        <td class="num"><b>${fmtCOP(item.neto_pagar)}</b></td>
        <td>${(() => {
          const total    = Number(item.novelty_count  || 0);
          const reviewed = Number(item.reviewed_count || 0);
          const pending  = total - reviewed;
          if (!total) return "—";
          return pending > 0
            ? `<span style="font-size:11px;white-space:nowrap">${total} nov. · <span style="color:#B91C1C;font-weight:600">${pending} pend.</span></span>`
            : `<span style="font-size:11px;white-space:nowrap">${total} nov. · <span style="color:#047857">${reviewed} rev.</span></span>`;
        })()}</td>
        <td>
          ${groupLocked
            ? `<button class="nm-pay-btn nm-pay-btn--sm" data-payslip="${item.id}">Desprendible</button>
               <span style="display:block;margin-top:3px;font-size:10px;color:#94A3B8">Bloqueado por cierre</span>`
            : locked
              ? `<button class="nm-pay-btn nm-pay-btn--sm" data-payslip="${item.id}">Desprendible</button>
                 <span style="display:block;margin-top:3px;font-size:10px;color:#64748B">Bloqueado</span>`
              : `<button class="nm-pay-btn nm-pay-btn--sm" data-new-novelty="${item.id}">+ Novedad</button>
                 <button class="nm-pay-btn nm-pay-btn--sm" data-cambio-operativo="${item.id}" title="Registrar cambio temporal/definitivo de modalidad, sede o jornada">Cambio op.</button>
                 <button class="nm-pay-btn nm-pay-btn--sm" data-payslip="${item.id}">Desprendible</button>`}
        </td>
        <td>
          <label class="nm-item-review-label" title="${isReviewed ? `Revisado · Para editar quite la marca` : `Marcar como revisado y bloquear`}">
            <input type="checkbox" class="nm-item-review-cb" data-item-reviewed="${item.id}" ${isReviewed ? "checked" : ""} ${groupLocked ? "disabled" : ""}>
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
  const groupLocked = !isGroupEditable(activeGroupDetail?.group);
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
      // Impacto del afectado: nunca usar el valor del reemplazo como fallback.
      const impactAmt      = Number(nov.affected_amount ?? nov.computed_impact ?? 0);
      const impactLabel    = nov.impact_type === "salary" ? "↓ Sal." : nov.impact_type === "transport" ? "↓ Transp." : "";
      const replacementText = Number(nov.replacement_amount || 0)
        ? `<br><small style="color:#047857">Reemplazo: ${escapeHtml(nov.replacement_employee_name || "interno")} · ${Number(nov.covered_days || 0)}d · +${fmtCOP(nov.replacement_amount)}</small>`
        : "";
      return `
      <tr class="${isReviewed ? "reviewed-row" : ""}">
        <td>
          ${escapeHtml(nov.employee_name || "")}<br>
          <small>${escapeHtml(nov.document_number || "")}</small>
        </td>
        <td>
          <b>${escapeHtml(nov.novelty_name || nov.novelty_type || "")}</b><br>
          <small style="color:#64748B">${escapeHtml(nov.description || nov.observations || "")}</small>${replacementText}
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
          <label style="display:flex;align-items:center;gap:5px;cursor:${groupLocked ? "default" : "pointer"}">
            <input type="checkbox" data-reviewed="${nov.id}" ${isReviewed ? "checked" : ""} ${groupLocked ? "disabled" : ""}>
            ${isReviewed ? `<span class="nm-pay-ok" style="font-size:11px">Revisada</span>` : `<span style="font-size:11px;color:#64748B">Sin revisar</span>`}
          </label>
        </td>
        <td>
          <button class="nm-pay-btn nm-pay-btn--sm" data-edit-novelty="${nov.id}" ${isLocked ? `disabled title="${lockTitle}"` : ""}>Editar</button>
          <button class="nm-pay-btn nm-pay-btn--sm" data-cover-novelty="${nov.id}" data-cover-item="${nov.payroll_item_id}" ${isLocked ? "disabled" : ""}>Cubrió</button>
          ${nov.turn_cover_id ? `<button class="nm-pay-btn nm-pay-btn--sm" data-remove-cover="${nov.id}" ${isLocked ? `disabled title="${lockTitle}"` : ""}>Quitar cubrió</button>` : ""}
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
// TABLA DE TURNOS
// ─────────────────────────────────────────────────────────────────────────────
function renderTurnosSection(turns, isClosed) {
  const { type, search } = turnosFilter;
  let rows = turns;

  if (type !== "TODOS") {
    rows = rows.filter((t) => t.cover_type === type);
  }
  if (search) {
    const q = normalized(search);
    rows = rows.filter((t) =>
      normalized(t.origin_employee_name || "").includes(q) ||
      normalized(t.origin_document     || "").includes(q) ||
      normalized(t.internal_employee_name || "").includes(q) ||
      normalized(t.external_worker_name   || "").includes(q) ||
      normalized(t.internal_document      || "").includes(q) ||
      normalized(t.external_document      || "").includes(q)
    );
  }

  const filterBar = `
<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
  <select class="nm-pay-select nm-pay-input--sm" id="turnoFilter" style="width:auto">
    <option value="TODOS" ${type === "TODOS" ? "selected" : ""}>Todos los tipos</option>
    <option value="INTERNA" ${type === "INTERNA" ? "selected" : ""}>Solo internos</option>
    <option value="EXTERNA" ${type === "EXTERNA" ? "selected" : ""}>Solo externos</option>
  </select>
  <input class="nm-pay-input nm-pay-input--sm" id="turnoSearch" placeholder="Buscar nombre o documento…"
         value="${escapeHtml(search)}" style="min-width:200px">
  <span style="font-size:12px;color:#94A3B8">${rows.length} turno(s)</span>
</div>`;

  if (!rows.length) {
    return `<div class="nm-pay-table-wrap">${filterBar}<div class="nm-pay-empty">Sin turnos que coincidan con los filtros.</div></div>`;
  }

  const tableRows = rows.map((t) => {
    const isInterna = t.cover_type === "INTERNA";
    const coverBadge = isInterna
      ? `<span style="background:#DBEAFE;color:#1D4ED8;padding:1px 7px;border-radius:3px;font-size:10px;font-weight:700;white-space:nowrap">INTERNO</span>`
      : `<span style="background:#FEF9C3;color:#92400E;padding:1px 7px;border-radius:3px;font-size:10px;font-weight:700;white-space:nowrap">EXTERNO</span>`;
    const cubrioName = isInterna ? (t.internal_employee_name || "—") : (t.external_worker_name || "—");
    const cubrioDoc  = isInterna ? (t.internal_document      || "") : (t.external_document     || "");
    const cubrioPos  = isInterna ? (t.internal_position      || "") : "";
    const bankInfo   = !isInterna && (t.external_bank || t.external_account_number)
      ? `<br><small style="color:#64748B">${escapeHtml(t.external_bank || "")} ${escapeHtml(t.external_account_number || "")}</small>`
      : "";
    const chargeBtn  = !isInterna && t.id
      ? `<button class="nm-pay-btn nm-pay-btn--sm" data-charge-account="${t.id}" title="Ver cuenta de cobro">Cta. cobro</button>
         <button class="nm-pay-btn nm-pay-btn--sm" style="margin-top:3px" data-dl-charge="${t.id}" data-ext-doc="${escapeHtml(t.external_document || String(t.id))}" title="Descargar cuenta de cobro">Descargar</button>
         ${canEditBankInfo() ? `<button class="nm-pay-btn nm-pay-btn--sm" style="margin-top:3px;background:#F59E0B;color:#fff" data-edit-bank="${t.id}" data-bank="${escapeHtml(t.external_bank || "")}" data-account-type="${escapeHtml(t.external_account_type || "AHORROS")}" data-account-number="${escapeHtml(t.external_account_number || "")}" title="Editar datos bancarios">Datos bancarios</button>` : ""}`
      : "";
    const noveltyDate = t.novelty_start ? String(t.novelty_start).slice(0, 10) : "—";

    return `
<tr>
  <td><small>${escapeHtml(noveltyDate)}</small></td>
  <td>
    <b>${escapeHtml(t.origin_employee_name || "—")}</b><br>
    <small style="color:#64748B">${escapeHtml(t.origin_document || "")}</small>
  </td>
  <td><small>${escapeHtml(t.novelty_type || "—")}</small></td>
  <td>
    <b>${escapeHtml(cubrioName)}</b><br>
    <small style="color:#64748B">${escapeHtml(cubrioDoc)}</small>
    ${cubrioPos ? `<br><small style="color:#94A3B8">${escapeHtml(cubrioPos)}</small>` : ""}${bankInfo}
  </td>
  <td>${coverBadge}</td>
  <td>
    <small>${escapeHtml(t.municipality_name || "—")}</small><br>
    <small style="color:#64748B">${escapeHtml(t.institution_name || "—")}</small><br>
    <small style="color:#94A3B8">${escapeHtml(t.site_name || "")} ${escapeHtml(t.modality || "")}</small>
  </td>
  <td class="num">${Number(t.covered_days || 0)}</td>
  <td class="num">${fmtCOP(t.calculated_day_value)}</td>
  <td class="num"><b>${fmtCOP(t.total_value)}</b></td>
  <td>${chargeBtn}</td>
</tr>`;
  }).join("");

  return `
<div class="nm-pay-table-wrap">
${filterBar}
<table class="nm-pay-table">
  <thead>
    <tr>
      <th>Fecha turno</th>
      <th>Empleado con novedad</th>
      <th>Tipo novedad</th>
      <th>Quién cubrió</th>
      <th>Tipo</th>
      <th>Municipio / Institución / Sede</th>
      <th class="num">Días</th>
      <th class="num">Valor día</th>
      <th class="num">Valor total</th>
      <th>Acciones</th>
    </tr>
  </thead>
  <tbody>${tableRows}</tbody>
</table>
</div>`;
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
    supportsData       = [];
    viewerSupportId    = null;
    supportsFilters    = { municipalityId: "", status: "", noveltyType: "", employee: "" };
    await reloadWorkArea();
  });
  document.getElementById("nmPayCreate")?.addEventListener("click", createPeriod);

  // ── Pestañas primarias ────────────────────────────────────────────────────
  document.querySelectorAll("[data-primary-tab]").forEach((btn) => btn.addEventListener("click", async () => {
    activePrimaryTab = btn.dataset.primaryTab;
    if (activePrimaryTab === "soportes" && !supportsData.length) await loadSupports();
    render();
  }));

  if (activePrimaryTab === "soportes") {
    wireSupportEvents();
    return;
  }

  // ── Eventos de pestaña Nómina ─────────────────────────────────────────────
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
  document.querySelectorAll("[data-detail-tab]").forEach((btn) => btn.addEventListener("click", async () => {
    activeDetailTab = btn.dataset.detailTab || "nomina";
    if (activeDetailTab === "turnos" && activeGroupTurns === null && activeGroupId) {
      await loadGroupTurns();
    }
    render();
  }));
  document.querySelectorAll(".nm-pay-mun").forEach((btn) => btn.addEventListener("click", async () => {
    activeGroupId = Number(btn.dataset.groupId);
    await reloadDetailOnly();
  }));
  document.getElementById("nmPayCalculate")?.addEventListener("click", calculateGroup);
  document.getElementById("nmPayExport")?.addEventListener("click",   exportMunicipality);
  document.getElementById("nmPayClose")?.addEventListener("click",    closeAndSendGroup);
  document.getElementById("nmPayReopen")?.addEventListener("click",   openReopenModal);
  document.getElementById("nmPayHistory")?.addEventListener("click",  openHistoryModal);
  document.querySelectorAll("[data-new-novelty]").forEach((btn) => btn.addEventListener("click", () => openNoveltyModal(Number(btn.dataset.newNovelty))));
  document.querySelectorAll("[data-cambio-operativo]").forEach((btn) => btn.addEventListener("click", () => openCambioOperativoModal(Number(btn.dataset.cambioOperativo))));
  document.querySelectorAll("[data-payslip]").forEach((btn)        => btn.addEventListener("click", () => openPayslipModal(Number(btn.dataset.payslip))));
  document.querySelectorAll("[data-edit-novelty]").forEach((btn)   => btn.addEventListener("click", () => openEditNoveltyModal(Number(btn.dataset.editNovelty))));
  document.querySelectorAll("[data-cover-novelty]").forEach((btn)  => btn.addEventListener("click", () => openCoverModal(Number(btn.dataset.coverNovelty), Number(btn.dataset.coverItem))));
  document.querySelectorAll("[data-remove-cover]").forEach((btn)   => btn.addEventListener("click", () => removeCover(Number(btn.dataset.removeCover))));
  document.querySelectorAll("[data-charge-account]").forEach((btn) => btn.addEventListener("click", () => openChargeAccount(Number(btn.dataset.chargeAccount))));
  document.querySelectorAll("[data-dl-charge]").forEach((btn) => btn.addEventListener("click", () => {
    const periodLabel = activePeriod?.label || "";
    downloadChargeAccount(Number(btn.dataset.dlCharge), btn.dataset.extDoc, periodLabel);
  }));
  document.querySelectorAll("[data-edit-bank]").forEach((btn) => btn.addEventListener("click", () => {
    openBankEditModal(
      Number(btn.dataset.editBank),
      btn.dataset.bank || "",
      btn.dataset.accountType || "AHORROS",
      btn.dataset.accountNumber || "",
    );
  }));
  document.querySelectorAll("[data-reviewed]").forEach((input)     => input.addEventListener("change", () => toggleReviewed(Number(input.dataset.reviewed), input.checked, input)));
  document.querySelectorAll("[data-item-reviewed]").forEach((input) => input.addEventListener("change", () => toggleItemReviewed(Number(input.dataset.itemReviewed), input.checked, input)));
  document.querySelectorAll("[data-delete-novelty]").forEach((btn)  => btn.addEventListener("click", () => confirmDeleteNovelty(Number(btn.dataset.deleteNovelty))));
  document.getElementById("turnoFilter")?.addEventListener("change", (e) => { turnosFilter.type = e.target.value; render(); });
  document.getElementById("turnoSearch")?.addEventListener("input",  (e) => { turnosFilter.search = e.target.value || ""; render(); document.getElementById("turnoSearch")?.focus(); });
}

async function removeCover(noveltyId) {
  try {
    await apiFetch(`/payroll/novelties/${noveltyId}/cover`, {
      method: "POST",
      body: JSON.stringify({ remove: true }),
    });
    await reloadWorkArea();
    showSuccess("Cobertura eliminada");
  } catch (err) { showError(err.message); }
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

async function reloadWorkArea() {
  await loadGroups();
  await loadGroupDetail();
  if (activePrimaryTab === "soportes") await loadSupports();
  if (activeDetailTab === "turnos" && activeGroupId) await loadGroupTurns();
  render();
}
async function reloadDetailOnly() {
  await loadGroupDetail();
  if (activeGroupId && activeGroupDetail) {
    const { totals } = activeGroupDetail;
    for (const pos of groupsState.positions) {
      const mun = pos.municipalities.find((m) => Number(m.id) === Number(activeGroupId));
      if (mun) {
        mun.items_reviewed = totals.items_reviewed;
        pos.items_reviewed = pos.municipalities.reduce((s, m) => s + (m.items_reviewed || 0), 0);
        break;
      }
    }
  }
  if (activeDetailTab === "turnos" && activeGroupId) await loadGroupTurns();
  render();
}

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
  const DATE_TYPES = new Set(["FECHA_INGRESO", "FECHA_RETIRO"]);
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
    <!-- Sección fecha exacta (solo INGRESO / RETIRO) -->
    <div id="novDateSection" hidden>
      <div class="nm-pay-field">
        <label id="novDateLabel">Fecha exacta <span style="color:#EF4444">*</span></label>
        <input class="nm-pay-input" id="novDate" type="date">
        <small id="novDateHelp" style="color:#94A3B8"></small>
      </div>
    </div>
    <!-- Sección fechas generales (resto de tipos) -->
    <div id="novRangeSection">
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
    </div>
    <div class="nm-pay-field"><label>Observaciones</label><textarea class="nm-pay-textarea" id="novDesc"></textarea></div>
    <button class="nm-pay-btn nm-pay-btn--primary" id="novSave">Guardar novedad</button>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();
  wireDateAutocalc("novStart", "novEnd", "novDays");

  const updateImpact = () => {
    const code      = document.getElementById("novType")?.value;
    const meta      = noveltyByCode(code);
    const el        = document.getElementById("novImpactInfo");
    const dateSection  = document.getElementById("novDateSection");
    const rangeSection = document.getElementById("novRangeSection");
    const dateLabel    = document.getElementById("novDateLabel");
    const dateHelp     = document.getElementById("novDateHelp");
    if (!el || !meta) return;
    el.innerHTML = noveltyImpactNoticeHtml(meta);
    const isDateType = DATE_TYPES.has(code);
    dateSection.hidden  = !isDateType;
    rangeSection.hidden = isDateType;
    if (isDateType) {
      if (code === "FECHA_INGRESO") {
        dateLabel.innerHTML = `Fecha real de ingreso <span style="color:#EF4444">*</span>`;
        dateHelp.textContent = "La nómina se liquidará desde este día hasta el fin del período.";
      } else {
        dateLabel.innerHTML = `Fecha real de retiro <span style="color:#EF4444">*</span>`;
        dateHelp.textContent = "La nómina se liquidará desde el inicio del período hasta este día.";
      }
    }
  };
  document.getElementById("novType")?.addEventListener("change", updateImpact);
  updateImpact();

  let _savingNovelty = false;
  document.getElementById("novSave")?.addEventListener("click", async () => {
    if (_savingNovelty) return;
    _savingNovelty = true;
    const btn = document.getElementById("novSave");
    if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
    try {
      const code = document.getElementById("novType").value;
      const isDateType = DATE_TYPES.has(code);
      let body;
      if (isDateType) {
        const noveltyDate = document.getElementById("novDate").value;
        if (!noveltyDate) {
          const label = code === "FECHA_INGRESO" ? "ingreso" : "retiro";
          showError(`Debe ingresar la fecha exacta de ${label}.`);
          return;
        }
        body = {
          novelty_type: code,
          novelty_date: noveltyDate,
          observations: document.getElementById("novDesc").value,
        };
      } else {
        const days = Number(document.getElementById("novDays").value);
        if (!days || days < 1) { showError("Los días deben ser mayor a 0"); return; }
        body = {
          novelty_type:     code,
          start_date:       document.getElementById("novStart").value || null,
          end_date:         document.getElementById("novEnd").value   || null,
          days,
          support_required: document.getElementById("novSupport").value === "true",
          observations:     document.getElementById("novDesc").value,
        };
      }
      await apiFetch(`/payroll/items/${itemId}/novelties`, { method: "POST", body: JSON.stringify(body) });
      closeModal();
      await reloadWorkArea();
      showSuccess("Novedad registrada");
    } catch (err) {
      showError(err.message);
    } finally {
      _savingNovelty = false;
      if (btn) { btn.disabled = false; btn.textContent = "Guardar novedad"; }
    }
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
  const DATE_TYPES = new Set(["FECHA_INGRESO", "FECHA_RETIRO"]);
  const isDateType = DATE_TYPES.has(novelty.novelty_type);
  const currentDate = String(novelty.start_date || "").slice(0, 10);
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
    <!-- Sección fecha exacta (solo INGRESO / RETIRO) -->
    <div id="novDateSection" ${isDateType ? "" : "hidden"}>
      <div class="nm-pay-field">
        <label id="novDateLabel">${novelty.novelty_type === "FECHA_INGRESO" ? "Fecha real de ingreso" : "Fecha real de retiro"} <span style="color:#EF4444">*</span></label>
        <input class="nm-pay-input" id="novDate" type="date" value="${escapeHtml(currentDate)}">
        <small id="novDateHelp" style="color:#94A3B8">${novelty.novelty_type === "FECHA_INGRESO" ? "La nómina se liquidará desde este día hasta el fin del período." : "La nómina se liquidará desde el inicio del período hasta este día."}</small>
      </div>
    </div>
    <!-- Sección fechas generales -->
    <div id="novRangeSection" ${isDateType ? "hidden" : ""}>
      <div class="nm-pay-form-grid">
        <div class="nm-pay-field"><label>Fecha inicio</label><input class="nm-pay-input" id="novStart" type="date" value="${escapeHtml(currentDate)}"></div>
        <div class="nm-pay-field"><label>Fecha fin</label><input class="nm-pay-input" id="novEnd" type="date" value="${escapeHtml(String(novelty.end_date || "").slice(0, 10))}"></div>
        <div class="nm-pay-field">
          <label>Días <small style="color:#94A3B8;font-weight:400">(auto)</small></label>
          <input class="nm-pay-input" id="novDays" type="number" min="1" value="${Number(novelty.days || 1)}">
        </div>
        <div class="nm-pay-field"><label>Valor aplicado</label><input class="nm-pay-input" id="novValue" type="number" min="0" value="${Number(novelty.value || 0)}"></div>
      </div>
    </div>
    <div class="nm-pay-field"><label>Observaciones</label><textarea class="nm-pay-textarea" id="novDesc">${escapeHtml(novelty.description || novelty.observations || "")}</textarea></div>
    <button class="nm-pay-btn nm-pay-btn--primary" id="novSave">Guardar cambios</button>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();
  wireDateAutocalc("novStart", "novEnd", "novDays");

  const updateImpact = () => {
    const code         = document.getElementById("novType")?.value;
    const meta         = noveltyByCode(code);
    const el           = document.getElementById("novImpactInfo");
    const dateSection  = document.getElementById("novDateSection");
    const rangeSection = document.getElementById("novRangeSection");
    const dateLabel    = document.getElementById("novDateLabel");
    const dateHelp     = document.getElementById("novDateHelp");
    if (!el || !meta) return;
    el.innerHTML = noveltyImpactNoticeHtml(meta);
    const isDate = DATE_TYPES.has(code);
    dateSection.hidden  = !isDate;
    rangeSection.hidden = isDate;
    if (isDate && dateLabel && dateHelp) {
      if (code === "FECHA_INGRESO") {
        dateLabel.innerHTML = `Fecha real de ingreso <span style="color:#EF4444">*</span>`;
        dateHelp.textContent = "La nómina se liquidará desde este día hasta el fin del período.";
      } else {
        dateLabel.innerHTML = `Fecha real de retiro <span style="color:#EF4444">*</span>`;
        dateHelp.textContent = "La nómina se liquidará desde el inicio del período hasta este día.";
      }
    }
  };
  document.getElementById("novType")?.addEventListener("change", updateImpact);
  updateImpact();

  let _savingEdit = false;
  document.getElementById("novSave")?.addEventListener("click", async () => {
    if (_savingEdit) return;
    _savingEdit = true;
    const btn = document.getElementById("novSave");
    if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
    try {
      const code   = document.getElementById("novType").value;
      const isDate = DATE_TYPES.has(code);
      let body;
      if (isDate) {
        const noveltyDate = document.getElementById("novDate").value;
        if (!noveltyDate) {
          const label = code === "FECHA_INGRESO" ? "ingreso" : "retiro";
          showError(`Debe ingresar la fecha exacta de ${label}.`);
          return;
        }
        body = {
          novelty_type: code,
          novelty_date: noveltyDate,
          description:  document.getElementById("novDesc").value,
        };
      } else {
        body = {
          novelty_type: code,
          start_date:   document.getElementById("novStart").value || null,
          end_date:     document.getElementById("novEnd").value   || null,
          days:         Number(document.getElementById("novDays").value),
          value:        Number(document.getElementById("novValue").value),
          description:  document.getElementById("novDesc").value,
        };
      }
      await apiFetch(`/payroll/novelties/${noveltyId}`, { method: "PATCH", body: JSON.stringify(body) });
      closeModal();
      await reloadWorkArea();
      showSuccess("Novedad actualizada");
    } catch (err) {
      showError(err.message);
    } finally {
      _savingEdit = false;
      if (btn) { btn.disabled = false; btn.textContent = "Guardar cambios"; }
    }
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
    .map((e) => `<option value="${e.employee_id}" ${String(e.employee_id) === String(novelty.replacement_employee_id || "") ? "selected" : ""}>${escapeHtml(e.employee_name)} — ${escapeHtml(e.document_number || "")}</option>`)
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
        <input class="nm-pay-input" id="coverDays" type="number" min="1" max="${Number(novelty.days || 1)}" value="${Number(novelty.covered_days || novelty.days || 1)}">
      </div>
      <div class="nm-pay-field">
        <label>Valor día <small style="color:#94A3B8;font-weight:400">(0 = automático)</small></label>
        <input class="nm-pay-input" id="coverValueDay" type="number" min="0" value="${Number(novelty.replacement_value_per_day || 0)}">
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
      if (days > Number(novelty.days || 0)) {
        showError("Los días cubiertos no pueden superar los días de incapacidad");
        return;
      }

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
// Usa fetch autenticado en lugar de window.open directo para enviar el token
// ─────────────────────────────────────────────────────────────────────────────
async function fetchChargeAccountHtml(coverId) {
  const token = state.token || localStorage.getItem("empiria_token") || "";
  const res = await fetch(`/payroll/turn-covers/${coverId}/charge-account`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = "No se pudo cargar la cuenta de cobro";
    try { const j = await res.json(); msg = j.message || msg; } catch { /* noop */ }
    throw new Error(msg);
  }
  return res.text();
}

async function openChargeAccount(coverId) {
  try {
    const html = await fetchChargeAccountHtml(coverId);
    const blob = new Blob([html], { type: "text/html; charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const w = window.open(blobUrl, "_blank");
    if (!w) showError("El navegador bloqueó la ventana emergente. Permite ventanas emergentes e intenta de nuevo.");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
  } catch (err) {
    showError(err.message || "Error generando cuenta de cobro");
  }
}

async function downloadChargeAccount(coverId, extDoc, periodLabel) {
  try {
    const html = await fetchChargeAccountHtml(coverId);
    const blob = new Blob([html], { type: "text/html; charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const doc = String(extDoc || coverId).replace(/[^a-z0-9]/gi, "-");
    const per = String(periodLabel || "").replace(/[^a-z0-9]/gi, "-") || "periodo";
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `cuenta_cobro_${doc}_${per}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
  } catch (err) {
    showError(err.message || "Error descargando cuenta de cobro");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL: EDICIÓN BANCARIA DE COBERTURA EXTERNA
// ─────────────────────────────────────────────────────────────────────────────
function openBankEditModal(coverId, currentBank, currentAccountType, currentAccountNumber) {
  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<div class="nm-pay-dialog">
  <div class="nm-pay-dialog-h">
    <b>Editar datos bancarios — cuenta de cobro</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
  </div>
  <div class="nm-pay-dialog-b">
    <div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#92400E">
      <b>Solo se actualizarán los datos bancarios de la cuenta de cobro.</b><br>
      La nómina y el turno permanecerán bloqueados.
    </div>
    <div class="nm-pay-form-grid">
      <div class="nm-pay-field">
        <label>Banco</label>
        <input class="nm-pay-input" id="bankInfoBanco" placeholder="Nombre del banco" value="${escapeHtml(currentBank)}">
      </div>
      <div class="nm-pay-field">
        <label>Tipo de cuenta</label>
        <select class="nm-pay-select" id="bankInfoTipo">
          <option value="AHORROS" ${currentAccountType === "AHORROS" ? "selected" : ""}>Ahorros</option>
          <option value="CORRIENTE" ${currentAccountType === "CORRIENTE" ? "selected" : ""}>Corriente</option>
        </select>
      </div>
      <div class="nm-pay-field">
        <label>Número de cuenta</label>
        <input class="nm-pay-input" id="bankInfoCuenta" placeholder="Número de cuenta" value="${escapeHtml(currentAccountNumber)}">
      </div>
      <div class="nm-pay-field" style="grid-column:1/-1">
        <label>Observación interna <small style="color:#94A3B8;font-weight:400">(opcional)</small></label>
        <input class="nm-pay-input" id="bankInfoObs" placeholder="Motivo del ajuste bancario">
      </div>
    </div>
    <button class="nm-pay-btn nm-pay-btn--primary" id="bankInfoSave">Guardar datos bancarios</button>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();

  let _saving = false;
  document.getElementById("bankInfoSave")?.addEventListener("click", async () => {
    if (_saving) return;
    _saving = true;
    const btn = document.getElementById("bankInfoSave");
    if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
    try {
      await apiFetch(`/payroll/turn-covers/${coverId}/bank-info`, {
        method: "PATCH",
        body: JSON.stringify({
          banco:        document.getElementById("bankInfoBanco").value.trim(),
          tipoCuenta:   document.getElementById("bankInfoTipo").value,
          numeroCuenta: document.getElementById("bankInfoCuenta").value.trim(),
          observacion:  document.getElementById("bankInfoObs").value.trim(),
        }),
      });
      closeModal();
      await loadGroupTurns();
      render();
      showSuccess("Datos bancarios actualizados correctamente.");
    } catch (err) {
      showError(err.message || "Error al guardar los datos bancarios.");
    } finally {
      _saving = false;
      if (btn) { btn.disabled = false; btn.textContent = "Guardar datos bancarios"; }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL: DESPRENDIBLE DE PAGO (por empleado/item)
// ─────────────────────────────────────────────────────────────────────────────

function buildPayslipHtmlDoc(data, forPrint = false) {
  const { employee, earnings, deductions, net, worked_days, covers, period, cambio_operativo, payslip, performed_covers } = data;
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

  // Coberturas internas realizadas POR este empleado (suman a su devengado)
  const performedCoverHtmlDoc = (performed_covers || []).map((c) =>
    `<div class="row"><span>Reemplazo — ${escapeHtml(c.covered_employee_name || "Empleado")} (${c.days}d)</span><b>+${fmt(c.total_value)}</b></div>`
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
    ${performedCoverHtmlDoc}
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

    const { employee, earnings, deductions, net, worked_days, period, cambio_operativo, payslip } = data;
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

    // Coberturas internas que realizó este empleado (suman a su devengado)
    const performedCoverHtml = (data.performed_covers || []).map((c) => `
      <div class="nm-slip-row">
        <span>Reemplazo — ${escapeHtml(c.covered_employee_name || "Empleado")} (${c.days}d)</span>
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
      ${performedCoverHtml}
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
  const group   = activeGroupDetail?.group;
  const version = Number(group?.version_number || 1);
  const label   = isGroupReopened(group) ? "Cerrar nuevamente" : "Cerrar y enviar nómina";
  showConfirmModal(
    label,
    `Esta acción <b>cerrará la nómina</b> (v${version}) del municipio y bloqueará nuevas modificaciones.<br><br>
    Se generará un snapshot histórico inmutable.<br>
    Solo quedará habilitado:<br>
    <ul style="margin:8px 0 0 16px;font-size:12px;color:#475569">
      <li>Ver desprendibles</li>
      <li>Exportar Excel</li>
      <li>Consultar historial</li>
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
    { confirmLabel: label, danger: true }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REABRIR NÓMINA — modal con motivo obligatorio
// ─────────────────────────────────────────────────────────────────────────────
function openReopenModal() {
  if (!activeGroupId) return;
  const group   = activeGroupDetail?.group;
  const version = Number(group?.version_number || 1);
  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<div class="nm-pay-dialog" style="max-width:480px">
  <div class="nm-pay-dialog-h">
    <b>Reabrir nómina</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
  </div>
  <div class="nm-pay-dialog-b">
    <div style="background:#FFFBEB;border:1px solid #F59E0B;border-radius:6px;padding:10px;font-size:13px;color:#92400E">
      <b>Advertencia</b> — Estás reabriendo la nómina v${version}.<br>
      Esta acción queda registrada en el historial de auditoría.
    </div>
    <div class="nm-pay-field">
      <label>Motivo de reapertura <span style="color:#EF4444">*</span></label>
      <input class="nm-pay-input" id="reopenReason" placeholder="Ej: Faltó registrar incapacidad médica" maxlength="300">
    </div>
    <div class="nm-pay-field">
      <label>Observaciones adicionales</label>
      <textarea class="nm-pay-textarea" id="reopenObs" rows="2" placeholder="Observaciones opcionales"></textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cancelar</button>
      <button class="nm-pay-btn nm-pay-btn--warning nm-pay-btn--sm" id="reopenConfirm">Confirmar reapertura</button>
    </div>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();
  document.getElementById("reopenConfirm")?.addEventListener("click", async () => {
    const reason = (document.getElementById("reopenReason")?.value || "").trim();
    if (!reason) { showError("El motivo de reapertura es obligatorio."); return; }
    const btn = document.getElementById("reopenConfirm");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Reabriendo…"; }
      await apiFetch(`/payroll/groups/${activeGroupId}/reopen`, {
        method: "POST",
        body: JSON.stringify({
          reason,
          observations: document.getElementById("reopenObs")?.value || "",
        }),
      });
      closeModal();
      await reloadWorkArea();
      showSuccess("Nómina reabierta. Se han habilitado las modificaciones.");
    } catch (err) {
      showError(err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Confirmar reapertura"; }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORIAL DE NÓMINA
// ─────────────────────────────────────────────────────────────────────────────
async function openHistoryModal() {
  if (!activeGroupId) return;
  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<div class="nm-pay-dialog" style="max-width:680px">
  <div class="nm-pay-dialog-h">
    <b>Historial de nómina</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
  </div>
  <div class="nm-pay-dialog-b" id="historyContent" style="min-height:100px">
    <div class="nm-pay-empty">Cargando historial…</div>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();
  try {
    const resp = await apiFetch(`/payroll/groups/${activeGroupId}/history`);
    const { group, logs, snapshots } = resp.data || {};
    const el = document.getElementById("historyContent");
    if (!el) return;
    const fmtDate = (d) => d ? new Date(d).toLocaleString("es-CO") : "—";
    const snapshotRows = (snapshots || []).map((s) => `
      <tr>
        <td>v${s.version_number}</td>
        <td>${escapeHtml(s.closed_by_name || "—")}</td>
        <td>${fmtDate(s.closed_at)}</td>
        <td><span class="nm-pay-badge nm-pay-badge--closed">Snapshot</span></td>
      </tr>`).join("");
    const logRows = (logs || []).map((l) => `
      <tr>
        <td>${fmtDate(l.reopened_at)}</td>
        <td>${escapeHtml(l.reopened_by_name || "—")}</td>
        <td>${escapeHtml(l.previous_status)} → ${escapeHtml(l.new_status)}</td>
        <td style="max-width:200px">${escapeHtml(l.reason)}</td>
        <td>${escapeHtml(l.observations || "—")}</td>
      </tr>`).join("");
    el.innerHTML = `
<div style="font-size:13px;color:#334155;font-weight:700;margin-bottom:4px">Grupo: ${escapeHtml(group?.operational_position || "")} — ${escapeHtml(group?.municipality_name || "")} · ${statusBadge(group?.status)} v${group?.version_number || 1}</div>
${snapshots?.length ? `
<div style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#475569;margin:8px 0 4px">Cierres / Snapshots</div>
<table class="nm-pay-table" style="font-size:12px;width:100%">
  <thead><tr><th>Versión</th><th>Cerrado por</th><th>Fecha cierre</th><th>Estado</th></tr></thead>
  <tbody>${snapshotRows}</tbody>
</table>` : `<div class="nm-pay-empty" style="margin-bottom:8px">Sin snapshots registrados.</div>`}
${logs?.length ? `
<div style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#475569;margin:12px 0 4px">Reaperturas</div>
<table class="nm-pay-table" style="font-size:12px;width:100%">
  <thead><tr><th>Fecha</th><th>Reabierto por</th><th>Cambio estado</th><th>Motivo</th><th>Observaciones</th></tr></thead>
  <tbody>${logRows}</tbody>
</table>` : `<div class="nm-pay-empty">Sin reaperturas registradas.</div>`}`;
  } catch (err) {
    const el = document.getElementById("historyContent");
    if (el) el.innerHTML = `<div class="nm-pay-empty" style="color:#EF4444">${escapeHtml(err.message)}</div>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL: SOPORTES
// ─────────────────────────────────────────────────────────────────────────────
async function openSupportsModal() {
  try {
    const params   = activePeriod ? `?periodId=${activePeriod.id}` : "";
    const response = await apiFetch(`/payroll/supports${params}`);
    const supports = Array.isArray(response.data) ? response.data : [];
    void supports; // unused in modal — logic moved to Soportes tab
    const modal = document.getElementById("nmPayModal");
    modal.innerHTML = `
<div class="nm-pay-dialog" style="max-width:440px">
  <div class="nm-pay-dialog-h">
    <b>Soportes</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
  </div>
  <div class="nm-pay-dialog-b">
    <div style="font-size:13px;color:#334155;padding:8px 0">
      Los soportes ahora se gestionan en la pestaña <b>Soportes</b> dentro del módulo de Nómina.
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="nm-pay-btn nm-pay-btn--primary nm-pay-btn--sm" id="nmGoSupTab">Ir a Soportes</button>
      <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
    </div>
    ${false ? `
    <div style="overflow:auto">
    <table class="nm-pay-table">
      <thead><tr><th>Empleado</th><th>Municipio</th><th>Novedad</th><th>Soporte</th><th>Estado</th><th>Obs.</th><th></th></tr></thead>
      <tbody>${supports.map((s) => `
        <tr>
          <td>${escapeHtml(s.employee_name || "")}<br><small>${escapeHtml(s.document_number || "")}</small></td>
          <td>${escapeHtml(s.municipality_name || "")}</td>
          <td>${escapeHtml(s.novelty_type || "")}</td>
          <td>${escapeHtml(s.support_type || (s.id ? "" : "Pendiente por registrar"))}</td>
          <td>${escapeHtml(statusLabel[s.support_status || s.status] || s.support_status || s.status || "")}</td>
          <td>${escapeHtml(s.observations || "")}</td>
          <td style="white-space:nowrap">
            ${s.id ? `
            <button class="nm-pay-btn nm-pay-btn--sm" data-support-status="${s.id}" data-status="cargado">Cargado</button>
            <button class="nm-pay-btn nm-pay-btn--sm" data-support-status="${s.id}" data-status="aprobado">Aprobar</button>
            <button class="nm-pay-btn nm-pay-btn--sm nm-pay-btn--danger" data-support-status="${s.id}" data-status="rechazado">Rechazar</button>
            ` : `<span style="color:#64748B;font-size:12px">Sin soporte cargado</span>`}
          </td>
        </tr>`).join("")}</tbody>
    </table>
    </div>` : `<div class="nm-pay-empty">No hay soportes registrados en este período.</div>`}
    <div class="nm-pay-doc" style="font-size:12px">Los soportes son informativos y NO bloquean cálculo, revisión, cierre ni exportación de la nómina.</div>
  </div>
</div>`;
    modal.hidden = false;
    wireModalClose();
    document.getElementById("nmGoSupTab")?.addEventListener("click", async () => {
      closeModal();
      activePrimaryTab = "soportes";
      if (!supportsData.length) await loadSupports();
      render();
    });
  } catch (err) { showError(err.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// PESTAÑA SOPORTES — CARGA DE DATOS
// ─────────────────────────────────────────────────────────────────────────────
async function loadSupports() {
  if (!activePeriod) { supportsData = []; return; }
  try {
    const params = new URLSearchParams({ periodId: activePeriod.id });
    if (supportsFilters.municipalityId) params.set("municipalityId", supportsFilters.municipalityId);
    if (supportsFilters.status) params.set("status", supportsFilters.status);
    const response = await apiFetch(`/payroll/supports?${params}`);
    supportsData = Array.isArray(response.data) ? response.data : [];
  } catch (err) {
    showError("Error cargando soportes: " + (err.message || ""));
    supportsData = [];
  }
}

function filteredSupports() {
  let data = supportsData;
  if (supportsFilters.noveltyType) data = data.filter((s) => s.novelty_type === supportsFilters.noveltyType);
  if (supportsFilters.employee) {
    const q = normalized(supportsFilters.employee);
    data = data.filter((s) => normalized(s.employee_name).includes(q) || normalized(s.document_number).includes(q));
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// PESTAÑA SOPORTES — RENDER
// ─────────────────────────────────────────────────────────────────────────────
function supportStatusBadge(status) {
  const s = String(status || "pendiente");
  const labels = {
    pendiente: "Pendiente", cargado: "Cargado", aprobado: "Aprobado",
    rechazado: "Rechazado", correccion_solicitada: "Corrección solicitada",
  };
  return `<span class="nm-sup-badge nm-sup-badge--${escapeHtml(s)}">${escapeHtml(labels[s] || s)}</span>`;
}

function renderSupportsShell() {
  if (!activePeriod) {
    return `<div style="padding:20px"><div class="nm-pay-empty">Selecciona un periodo de nómina para ver sus soportes.</div></div>`;
  }
  const data = filteredSupports();

  // Métricas globales (sobre supportsData completo, no filtrado)
  const pending  = supportsData.filter((s) => (s.status || s.support_status) === "pendiente").length;
  const approved = supportsData.filter((s) => (s.status || s.support_status) === "aprobado").length;
  const rejected = supportsData.filter((s) => (s.status || s.support_status) === "rechazado").length;
  const noFile   = supportsData.filter((s) => !s.file_url || s.file_url === "").length;

  // Municipios únicos para el filtro
  const allMunis = [...new Map(
    supportsData.filter((s) => s.municipality_id).map((s) => [s.municipality_id, s.municipality_name])
  ).entries()].sort(([, a], [, b]) => (a || "").localeCompare(b || "", "es"));

  // Visor seleccionado
  const viewerSupport = viewerSupportId
    ? supportsData.find((s) => String(s.support_id || s.id) === String(viewerSupportId) || String(s.novelty_id) === String(viewerSupportId))
    : null;

  return `
<div class="nm-sup-view">

  <!-- Filtros -->
  <div class="nm-sup-filters">
    <label>Municipio</label>
    <select class="nm-pay-select nm-pay-input--sm" id="supFltMun" style="min-width:130px">
      <option value="">Todos</option>
      ${allMunis.map(([id, name]) => `<option value="${id}" ${String(supportsFilters.municipalityId) === String(id) ? "selected" : ""}>${escapeHtml(name || "")}</option>`).join("")}
    </select>
    <label>Estado</label>
    <select class="nm-pay-select nm-pay-input--sm" id="supFltStatus">
      <option value="">Todos</option>
      <option value="pendiente" ${supportsFilters.status === "pendiente" ? "selected" : ""}>Pendiente</option>
      <option value="cargado" ${supportsFilters.status === "cargado" ? "selected" : ""}>Cargado</option>
      <option value="aprobado" ${supportsFilters.status === "aprobado" ? "selected" : ""}>Aprobado</option>
      <option value="rechazado" ${supportsFilters.status === "rechazado" ? "selected" : ""}>Rechazado</option>
      <option value="correccion_solicitada" ${supportsFilters.status === "correccion_solicitada" ? "selected" : ""}>Corrección solicitada</option>
    </select>
    <label>Tipo novedad</label>
    <select class="nm-pay-select nm-pay-input--sm" id="supFltNovType" style="min-width:150px">
      <option value="">Todos</option>
      ${NOVELTY_TYPES.map((t) => `<option value="${t.code}" ${supportsFilters.noveltyType === t.code ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}
    </select>
    <label>Empleado</label>
    <input class="nm-pay-input nm-pay-input--sm" id="supFltEmp" placeholder="Nombre o documento" value="${escapeHtml(supportsFilters.employee)}" style="min-width:140px">
    <button class="nm-pay-btn nm-pay-btn--sm" id="supFltClear">Limpiar</button>
    <div style="flex:1"></div>
    <span style="font-size:11px;color:#64748B;white-space:nowrap">${data.length} resultado${data.length !== 1 ? "s" : ""}</span>
  </div>

  <!-- Métricas -->
  <div class="nm-sup-metrics">
    <div class="nm-sup-metric nm-sup-metric--pending"><span>Pendientes</span><b>${pending}</b></div>
    <div class="nm-sup-metric nm-sup-metric--approved"><span>Aprobados</span><b>${approved}</b></div>
    <div class="nm-sup-metric nm-sup-metric--rejected"><span>Rechazados</span><b>${rejected}</b></div>
    <div class="nm-sup-metric nm-sup-metric--nofile"><span>Sin archivo</span><b>${noFile}</b></div>
  </div>

  <!-- Cuerpo: tabla + visor -->
  <div class="nm-sup-body">
    <div class="nm-sup-table-panel">${renderSupportsTable(data)}</div>
    <div class="nm-sup-viewer-panel" id="nmSupViewer" ${viewerSupport ? "" : "hidden"}>
      ${viewerSupport ? renderSupportViewerContent(viewerSupport) : ""}
    </div>
  </div>
</div>`;
}

function renderSupportsTable(data) {
  if (!data.length) {
    return `<div class="nm-pay-empty" style="margin:20px">No hay soportes con los filtros actuales.<br><small style="color:#94A3B8">Los soportes aparecen cuando una novedad tiene "Soporte requerido: Sí".</small></div>`;
  }
  return `
<table class="nm-pay-table nm-sup-table">
  <thead>
    <tr>
      <th>Empleado</th><th>Documento</th><th>Tipo novedad</th><th>Municipio</th>
      <th>Institución</th><th>Fecha nov.</th><th>Tipo soporte</th><th>Archivo</th>
      <th>Estado</th><th>Revisado por</th><th>Fecha rev.</th><th>Observación</th><th>Acciones</th>
    </tr>
  </thead>
  <tbody>
    ${data.map((s) => {
      const supId    = s.support_id || s.id;
      const status   = s.status || s.support_status || "pendiente";
      const isActive = supId
        ? String(supId) === String(viewerSupportId)
        : String(s.novelty_id) === String(viewerSupportId);
      const hasFile  = Boolean(s.file_url && s.file_url !== "");
      const nm       = noveltyByCode(s.novelty_type);
      const nmName   = nm?.name || escapeHtml(s.novelty_type || "—");
      const isLocked = status === "aprobado" || status === "rechazado";
      const viewKey  = supId || s.novelty_id;
      const revDate  = s.reviewed_at ? new Date(s.reviewed_at).toLocaleDateString("es-CO", { year:"2-digit", month:"2-digit", day:"2-digit" }) : "—";
      return `
<tr class="${isActive ? "nm-sup-row-active" : ""}">
  <td><b style="font-size:12px">${escapeHtml(s.employee_name || "—")}</b></td>
  <td><small>${escapeHtml(s.document_number || "—")}</small></td>
  <td style="white-space:nowrap;font-size:11px">${escapeHtml(nmName)}</td>
  <td style="font-size:11px">${escapeHtml(s.municipality_name || "—")}</td>
  <td style="font-size:11px"><small>${escapeHtml(s.institution_name || "—")}</small></td>
  <td style="font-size:11px;white-space:nowrap">${escapeHtml(String(s.novelty_date || "—").slice(0, 10))}</td>
  <td style="font-size:11px">${escapeHtml(s.support_type || "—")}</td>
  <td>
    ${hasFile
      ? `<button class="nm-pay-btn nm-pay-btn--sm" data-view-support="${viewKey}" title="${escapeHtml(s.file_name || "Ver archivo")}">&#128206; Ver</button>`
      : supId
        ? `<label class="nm-pay-btn nm-pay-btn--sm" style="cursor:pointer" title="Cargar archivo para este soporte">
             &#8593; Cargar
             <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style="display:none" data-upload-support="${supId}" data-novelty-id="${s.novelty_id}">
           </label>`
        : `<label class="nm-pay-btn nm-pay-btn--sm" style="cursor:pointer;opacity:.7" title="Cargar soporte">
             &#8593; Cargar
             <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style="display:none" data-upload-support="" data-novelty-id="${s.novelty_id}">
           </label>`}
  </td>
  <td style="white-space:nowrap">${supportStatusBadge(status)}</td>
  <td style="font-size:11px">${escapeHtml(s.reviewed_by_name || (s.reviewed_by ? `ID:${s.reviewed_by}` : "—"))}</td>
  <td style="font-size:11px;white-space:nowrap">${revDate}</td>
  <td style="max-width:130px"><small style="display:block;overflow:hidden;max-height:36px;line-height:1.4">${escapeHtml(s.observations || "—")}</small></td>
  <td style="white-space:nowrap">
    ${supId ? `
      ${!isLocked ? `
        <button class="nm-pay-btn nm-pay-btn--sm" data-sup-approve="${supId}" style="color:#166534;border-color:#A7F3D0">&#10003;</button>
        <button class="nm-pay-btn nm-pay-btn--sm nm-pay-btn--danger" data-sup-reject="${supId}" style="font-size:11px">&#10007;</button>
        <button class="nm-pay-btn nm-pay-btn--sm" data-sup-correction="${supId}" style="color:#C2410C;border-color:#FED7AA;font-size:10px">&#8629;</button>
      ` : `<button class="nm-pay-btn nm-pay-btn--sm" data-sup-undo="${supId}" style="font-size:10px">Revertir</button>`}
      <button class="nm-pay-btn nm-pay-btn--sm" data-sup-obs="${supId}" style="font-size:10px">Obs.</button>
    ` : `<span style="font-size:10px;color:#94A3B8">Sin registro</span>`}
  </td>
</tr>`;
    }).join("")}
  </tbody>
</table>`;
}

function renderSupportViewerContent(support) {
  if (!support) return "";
  const url  = support.file_url || "";
  const name = support.file_name || "Archivo";
  const status = support.status || support.support_status || "pendiente";
  const supId = support.support_id || support.id;

  let viewerHtml;
  if (!url || url === "") {
    viewerHtml = `<div class="nm-pay-empty" style="padding:20px;text-align:center">Sin archivo adjunto</div>`;
  } else {
    const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(url) || /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
    viewerHtml = isImg
      ? `<img src="${escapeHtml(url)}" class="nm-sup-viewer-img" alt="${escapeHtml(name)}">`
      : `<iframe src="${escapeHtml(url)}" class="nm-sup-viewer-iframe" title="${escapeHtml(name)}"></iframe>`;
  }

  return `
<div class="nm-sup-viewer-head">
  <span title="${escapeHtml(name)}">${escapeHtml(name)}</span>
  <button class="nm-pay-btn nm-pay-btn--sm" id="nmSupViewerClose">&#10005;</button>
</div>
<div class="nm-sup-viewer-body">${viewerHtml}</div>
<div class="nm-sup-review-panel">
  <div style="font-size:12px;font-weight:700;color:#0F172A">${escapeHtml(support.employee_name || "")}</div>
  <div style="font-size:11px;color:#64748B;margin-bottom:2px">
    ${escapeHtml(noveltyByCode(support.novelty_type)?.name || support.novelty_type || "")}
    ${support.municipality_name ? ` · ${escapeHtml(support.municipality_name)}` : ""}
  </div>
  <div>${supportStatusBadge(status)}</div>
  ${supId ? `
  <textarea class="nm-pay-textarea" id="supViewObs" placeholder="Observación…" rows="2" style="min-height:44px">${escapeHtml(support.observations || "")}</textarea>
  <div style="display:flex;gap:5px;flex-wrap:wrap">
    ${status !== "aprobado" ? `<button class="nm-pay-btn nm-pay-btn--primary nm-pay-btn--sm" data-viewer-approve="${supId}">&#10003; Aprobar</button>` : ""}
    ${status !== "rechazado" ? `<button class="nm-pay-btn nm-pay-btn--danger nm-pay-btn--sm" data-viewer-reject="${supId}">&#10007; Rechazar</button>` : ""}
    ${status !== "correccion_solicitada" ? `<button class="nm-pay-btn nm-pay-btn--sm" data-viewer-correction="${supId}" style="color:#C2410C;border-color:#FED7AA">&#8629; Corrección</button>` : ""}
    <button class="nm-pay-btn nm-pay-btn--sm" data-viewer-obs="${supId}">Guardar obs.</button>
  </div>` : `<div style="font-size:11px;color:#94A3B8">Sin registro de soporte — carga el archivo primero.</div>`}
</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PESTAÑA SOPORTES — EVENTOS
// ─────────────────────────────────────────────────────────────────────────────
function wireSupportEvents() {
  // Filtros
  document.getElementById("supFltMun")?.addEventListener("change", async (e) => {
    supportsFilters.municipalityId = e.target.value;
    await loadSupports(); // recargar con filtro de municipio en backend
    render();
  });
  document.getElementById("supFltStatus")?.addEventListener("change", async (e) => {
    supportsFilters.status = e.target.value;
    await loadSupports();
    render();
  });
  document.getElementById("supFltNovType")?.addEventListener("change", (e) => {
    supportsFilters.noveltyType = e.target.value;
    render();
  });
  document.getElementById("supFltEmp")?.addEventListener("input", (e) => {
    supportsFilters.employee = e.target.value;
    render();
    document.getElementById("supFltEmp")?.focus();
  });
  document.getElementById("supFltClear")?.addEventListener("click", async () => {
    supportsFilters = { municipalityId: "", status: "", noveltyType: "", employee: "" };
    await loadSupports();
    render();
  });

  // Visor de archivo
  document.querySelectorAll("[data-view-support]").forEach((btn) => btn.addEventListener("click", () => {
    const key = btn.dataset.viewSupport;
    viewerSupportId = viewerSupportId === key ? null : key;
    render();
  }));
  document.getElementById("nmSupViewerClose")?.addEventListener("click", () => {
    viewerSupportId = null;
    render();
  });

  // Acciones desde tabla
  document.querySelectorAll("[data-sup-approve]").forEach((btn) => btn.addEventListener("click", async () => {
    await updateSupportStatus(btn.dataset.supApprove, "aprobado", "");
  }));
  document.querySelectorAll("[data-sup-reject]").forEach((btn) => btn.addEventListener("click", () => {
    showPromptModal("Rechazar soporte", "Motivo del rechazo (obligatorio)", "Describe el motivo…", async (obs) => {
      await updateSupportStatus(btn.dataset.supReject, "rechazado", obs);
    });
  }));
  document.querySelectorAll("[data-sup-correction]").forEach((btn) => btn.addEventListener("click", () => {
    showPromptModal("Solicitar corrección", "Indica qué debe corregirse", "Descripción…", async (obs) => {
      await updateSupportStatus(btn.dataset.supCorrection, "correccion_solicitada", obs);
    });
  }));
  document.querySelectorAll("[data-sup-undo]").forEach((btn) => btn.addEventListener("click", async () => {
    await updateSupportStatus(btn.dataset.supUndo, "pendiente", "");
  }));
  document.querySelectorAll("[data-sup-obs]").forEach((btn) => btn.addEventListener("click", () => {
    showPromptModal("Añadir observación", "Observación para este soporte", "Escribe aquí…", async (obs) => {
      await updateSupportStatus(btn.dataset.supObs, null, obs);
    });
  }));

  // Carga de archivo
  document.querySelectorAll("[data-upload-support]").forEach((input) => input.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadSupportFile(input.dataset.uploadSupport, input.dataset.noveltyId, file);
  }));

  // Acciones desde visor
  document.querySelectorAll("[data-viewer-approve]").forEach((btn) => btn.addEventListener("click", async () => {
    const obs = document.getElementById("supViewObs")?.value || "";
    await updateSupportStatus(btn.dataset.viewerApprove, "aprobado", obs);
  }));
  document.querySelectorAll("[data-viewer-reject]").forEach((btn) => btn.addEventListener("click", async () => {
    const obs = document.getElementById("supViewObs")?.value || "";
    if (!obs.trim()) { showError("Escribe el motivo del rechazo"); return; }
    await updateSupportStatus(btn.dataset.viewerReject, "rechazado", obs);
  }));
  document.querySelectorAll("[data-viewer-correction]").forEach((btn) => btn.addEventListener("click", async () => {
    const obs = document.getElementById("supViewObs")?.value || "";
    if (!obs.trim()) { showError("Indica qué debe corregirse"); return; }
    await updateSupportStatus(btn.dataset.viewerCorrection, "correccion_solicitada", obs);
  }));
  document.querySelectorAll("[data-viewer-obs]").forEach((btn) => btn.addEventListener("click", async () => {
    const obs = document.getElementById("supViewObs")?.value || "";
    await updateSupportStatus(btn.dataset.viewerObs, null, obs);
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// PESTAÑA SOPORTES — ACCIONES API
// ─────────────────────────────────────────────────────────────────────────────
async function updateSupportStatus(supportId, status, observations) {
  try {
    const body = { id: supportId };
    if (status !== null && status !== undefined) body.status = status;
    if (observations !== undefined && observations !== null) body.observations = observations;
    await apiFetch("/payroll/supports", { method: "POST", body: JSON.stringify(body) });
    await loadSupports();
    const msg = !status ? "Observación guardada"
      : status === "aprobado" ? "Soporte aprobado"
      : status === "rechazado" ? "Soporte rechazado"
      : status === "correccion_solicitada" ? "Corrección solicitada"
      : "Soporte actualizado";
    showSuccess(msg);
    render();
  } catch (err) {
    showError(err.message || "Error al actualizar soporte");
  }
}

async function uploadSupportFile(supportId, noveltyId, file) {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("noveltyId", noveltyId || "");
    const token = state.token || localStorage.getItem("empiria_token") || "";
    const res = await fetch("/payroll/supports/upload", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || "Error al subir archivo");
    // Actualiza el soporte con la URL del archivo
    await apiFetch("/payroll/supports", {
      method: "POST",
      body: JSON.stringify({
        id: supportId || null,
        novelty_id: noveltyId,
        file_url: json.data.url,
        file_name: json.data.fileName,
        status: "cargado",
      }),
    });
    await loadSupports();
    showSuccess("Archivo cargado correctamente");
    render();
  } catch (err) {
    showError(err.message || "Error al cargar archivo");
  }
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
  periods            = [];
  activePeriod       = null;
  groupsState        = { positions: [], groups: [] };
  activePosition     = "";
  activeGroupId      = null;
  activeGroupDetail  = null;
  activeGroupTurns   = null;
  turnosFilter       = { type: "TODOS", search: "" };
  municipalitySearch = "";
  activePrimaryTab   = "nomina";
  supportsData       = [];
  supportsFilters    = { municipalityId: "", status: "", noveltyType: "", employee: "" };
  viewerSupportId    = null;
  await loadPeriods();
  await loadGroups();
  await loadGroupDetail();
  return shell();
}

export function wirePayrollEvents() {
  render();
}
