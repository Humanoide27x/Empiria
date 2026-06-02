import { state } from "../state.js";
import { apiFetch } from "../api.js";
import { escapeHtml } from "../utils.js";
import { showSuccess, showError } from "../toast.js";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS OFICIALES DE NOVEDAD (13 — sincronizados con payroll_novelty_types)
// ─────────────────────────────────────────────────────────────────────────────
const NOVELTY_TYPES = [
  { code: "DIAS_NO_CLASE",                 name: "Días de No Clase",                  affects_salary: false, affects_transport: true,  affects_additional: false, requires_turn_cover: true  },
  { code: "CITA_MEDICA",                   name: "Cita Médica",                       affects_salary: false, affects_transport: true,  affects_additional: false, requires_turn_cover: false },
  { code: "CITA_MEDICA_FAMILIAR",          name: "Cita Médica de un Familiar",        affects_salary: false, affects_transport: true,  affects_additional: true,  requires_turn_cover: false },
  { code: "INCAPACIDAD_MEDICA",            name: "Incapacidad Médica",                affects_salary: false, affects_transport: true,  affects_additional: true,  requires_turn_cover: true  },
  { code: "INCAPACIDAD_ACCIDENTE_LABORAL", name: "Incapacidad por Accidente Laboral", affects_salary: false, affects_transport: true,  affects_additional: true,  requires_turn_cover: true  },
  { code: "CALAMIDAD_FAMILIAR",            name: "Calamidad Familiar",                affects_salary: false, affects_transport: true,  affects_additional: true,  requires_turn_cover: false },
  { code: "LUTO",                          name: "Luto",                              affects_salary: false, affects_transport: true,  affects_additional: true,  requires_turn_cover: false },
  { code: "PERMISOS_NO_REMUNERADOS",       name: "Permisos No Remunerados",           affects_salary: true,  affects_transport: true,  affects_additional: true,  requires_turn_cover: false },
  { code: "CITACIONES_OFICIALES",          name: "Citaciones Oficiales",              affects_salary: false, affects_transport: true,  affects_additional: false, requires_turn_cover: false },
  { code: "LICENCIA_MATERNIDAD_PATERNIDAD",name: "Licencia de Maternidad/Paternidad", affects_salary: false, affects_transport: true,  affects_additional: true,  requires_turn_cover: false },
  { code: "SUSPENSION",                    name: "Suspensión",                        affects_salary: true,  affects_transport: true,  affects_additional: true,  requires_turn_cover: false },
  { code: "FECHA_INGRESO",                 name: "Fecha de Ingreso",                  affects_salary: true,  affects_transport: false, affects_additional: false, requires_turn_cover: false },
  { code: "FECHA_RETIRO",                  name: "Fecha de Retiro",                   affects_salary: true,  affects_transport: false, affects_additional: false, requires_turn_cover: false },
  { code: "CAMBIO_OPERATIVO_COBERTURA",    name: "Cambio Operativo de Cobertura",     affects_salary: true,  affects_transport: true,  affects_additional: false, requires_turn_cover: false },
  { code: "CORRECCION_SEGURIDAD_SOCIAL",   name: "Corrección Seguridad Social",       affects_salary: false, affects_transport: false, affects_additional: false, requires_turn_cover: false },
];

// Documentos de soporte requeridos por tipo de novedad (espejo del backend)
const SUPPORT_REQUIREMENTS = {
  CITA_MEDICA:                    ["COMPROBANTE_CITA_MEDICA"],
  CITA_MEDICA_FAMILIAR:           ["COMPROBANTE_CITA_MEDICA"],
  INCAPACIDAD_MEDICA:             ["HISTORIA_CLINICA", "INCAPACIDAD_MEDICA_DOC"],
  INCAPACIDAD_ACCIDENTE_LABORAL:  ["HISTORIA_CLINICA", "INCAPACIDAD_MEDICA_DOC"],
  PERMISOS_NO_REMUNERADOS:        ["AUTORIZACION_DESCUENTO"],
  CITACIONES_OFICIALES:           ["COMPROBANTE_CITACION"],
  CALAMIDAD_FAMILIAR:             ["COMPROBANTE_CALAMIDAD"],
  LUTO:                           ["ACTA_DEFUNCION"],
  LICENCIA_MATERNIDAD_PATERNIDAD: ["HISTORIA_CLINICA", "INCAPACIDAD_MEDICA_DOC"],
};

const SUPPORT_TYPE_LABELS = {
  COMPROBANTE_CITA_MEDICA:  "Comprobante de asistencia a la cita",
  HISTORIA_CLINICA:         "Historia Clínica",
  INCAPACIDAD_MEDICA_DOC:   "Incapacidad Médica",
  INCAPACIDAD_MEDICA:       "Incapacidad Médica",
  AUTORIZACION_DESCUENTO:   "Autorización de Descuento",
  COMPROBANTE_CITACION:     "Soporte de Citación",
  COMPROBANTE_ASISTENCIA:   "Soporte de Citación",
  COMPROBANTE_CALAMIDAD:    "Soporte de la Calamidad",
  ACTA_DEFUNCION:           "Acta de Defunción",
  CEDULA_CIUDADANIA:        "Cédula de Ciudadanía",
  CUENTA_COBRO:             "Cuenta de Cobro",
  CERTIFICACION_BANCARIA:   "Certificación Bancaria",
};

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
let turnosFilter      = { search: "", hasCuentaCobro: "" };
let supportsFilter    = { status: "", noveltyType: "", search: "" };
let supportsViewer    = null;   // { url, name, type: "image"|"doc" }
let periodMonth      = new Date().toISOString().slice(0, 7);
let municipalitySearch = "";
let activeDetailTab  = "nomina"; // "nomina" | "novedades" | "turnos" | "soportes"

// ── Soportes tab state ────────────────────────────────────────────────────────
let activePrimaryTab = "nomina"; // "nomina" | "soportes"
let supportsData     = [];
let supportsFilters  = { municipalityId: "", status: "", noveltyType: "", employee: "" };
let viewerSupportId  = null;

// ── Filtro de novedades (pestaña Novedades del grupo) ────────────────────────
let noveltiesFilter    = { type: "", reviewed: "", withSupport: "", search: "" };
let noveltiesViewMode  = "table"; // "table" | "grouped"
let selectedItemIds    = new Set(); // IDs de ítems de nómina seleccionados para acción masiva

// ── Filtros de tabla de empleados (nómina) ────────────────────────────────────
let itemsFilter = {
  institution_id: "",
  site_id:        "",
  modality:       "",
  cargo:          "",
  has_novelties:  "",
  reviewed:       "",
  support_status: "",
  sort_by:        "",
  sort_dir:       "asc",
};
let groupFilterCatalog = { institutions: [], sites: [], modalities: [], cargos: [] };

// ── Configuración salarial individual (modal) ─────────────────────────────────
let salaryCfgState = { employeeId: null, employeeName: "", docNumber: "", history: [], loading: false };

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
function fmtDateDMY(d) {
  if (!d) return "—";
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split("-");
  return `${day}/${m}/${y}`;
}
function fmtDateRange(start, end) {
  const s = start ? String(start).slice(0, 10) : "";
  const e = end   ? String(end).slice(0, 10)   : "";
  if (!s && !e) return "—";
  if (!s) return fmtDateDMY(end);
  if (!e || s === e) return fmtDateDMY(start);
  return `${fmtDateDMY(start)} al ${fmtDateDMY(end)}`;
}
function expandNovDates(nov) {
  const raw = nov.novelty_date || nov.start_date;
  if (!raw) return [];
  const start = String(raw).slice(0, 10);
  const endRaw = nov.end_date ? String(nov.end_date).slice(0, 10) : start;
  if (start === endRaw) return [start];
  const dates = [];
  const cur = new Date(start + "T12:00:00");
  const end = new Date(endRaw + "T12:00:00");
  while (cur <= end && dates.length < 366) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
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
  if (meta.affects_salary)     parts.push(`<span class="nm-badge-sal">↓ Salario</span>`);
  if (meta.affects_transport)  parts.push(`<span class="nm-badge-tra">↓ Transporte</span>`);
  if (meta.affects_additional) parts.push(`<span class="nm-badge-add">↓ Adicionales</span>`);
  return parts.join(" ");
}
function currentPositionData() {
  return groupsState.positions.find((p) => p.position === activePosition) || groupsState.positions[0] || null;
}
function noveltyImpactText(noveltyOrCode) {
  const meta = typeof noveltyOrCode === "string" ? noveltyByCode(noveltyOrCode) : noveltyOrCode;
  if (!meta) return "Sin impacto economico";
  const parts = [];
  if (meta.affects_salary)     parts.push("descuenta salario");
  if (meta.affects_transport)  parts.push("descuenta transporte");
  if (meta.affects_additional) parts.push("descuenta adicionales");
  return parts.length ? parts.join(" · ") : "sin impacto economico";
}
function noveltyImpactChipsHtml(noveltyOrCode) {
  const meta = typeof noveltyOrCode === "string" ? noveltyByCode(noveltyOrCode) : noveltyOrCode;
  if (!meta) return "";
  const parts = [];
  if (meta.affects_salary)     parts.push(`<span class="nm-badge-sal">Descuenta salario</span>`);
  if (meta.affects_transport)  parts.push(`<span class="nm-badge-tra">Descuenta transporte</span>`);
  if (meta.affects_additional) parts.push(`<span class="nm-badge-add">Descuenta adicionales</span>`);
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
function isConsolidatedView() {
  return activeGroupDetail?.group?.municipality_id === null || activeGroupDetail?.group?.group_type === "CONSOLIDATED";
}
function isCurrentUserAdmin() {
  const role = String(state.user?.role || "").toLowerCase();
  return ["administrador", "administrator", "talento_humano", "human_resources"].some((r) => role.includes(r));
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
.nm-pay-mun-head{padding:6px 8px;border-bottom:1px solid #E2E8F0;flex:0 0 auto}
.nm-pay-mun-title{font-size:10px;font-weight:800;color:#334155;text-transform:uppercase;margin-bottom:4px}
.nm-pay-mun-search{width:100%;border:1px solid #CBD5E1;border-radius:5px;padding:4px 8px;font-size:12px;background:#fff}
.nm-pay-mun-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:2px}
.nm-pay-mun{flex:1;min-width:0;border:0;background:transparent;border-radius:4px;padding:3px 5px;cursor:pointer;text-align:left;display:flex;align-items:center;gap:3px;color:#0F172A;overflow:hidden}
.nm-pay-mun:hover{background:#EEF2F7}
.nm-pay-mun.active{background:#ECFDF5;color:#0F766E;box-shadow:inset 2px 0 0 #0F766E}
.nm-pay-mc-name{font-size:11px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:30px}
.nm-pay-mc-chips{display:flex;gap:2px;align-items:center;flex-shrink:0}
.nm-pay-mc-chip{font-size:9px;font-weight:700;padding:1px 3px;border-radius:2px;white-space:nowrap;line-height:1.5;letter-spacing:.02em}
.nm-pay-mc-chip--s{background:#E2E8F0;color:#475569}
.nm-pay-mc-chip--rev{background:#DBEAFE;color:#1E40AF}
.nm-pay-mc-chip--ok{background:#DCFCE7;color:#166534}
.nm-pay-mc-chip--partial{background:#FEF9C3;color:#854D0E}
.nm-pay-mc-chip--doc{background:#FEE2E2;color:#991B1B}
.nm-pay-mc-chip--closed{background:#1E293B;color:#F8FAFC}
.nm-pay-mc-chip--reopened{background:#FEF3C7;color:#92400E}

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
.nm-badge-add{background:#F3E8FF;color:#7C3AED;border-radius:999px;padding:2px 7px;font-size:11px;font-weight:700}

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

/* ── Selección masiva de ítems de nómina ─────────────────────────── */
.nm-sel-col{width:36px;text-align:center;padding:4px 4px !important}
.nm-item-sel-cb{width:16px;height:16px;accent-color:#0F766E;cursor:pointer;vertical-align:middle}
.nm-item-selected-row td{background:#EFF6FF !important}
.nm-item-selected-row.item-reviewed-row td{background:#EFF6FF !important;opacity:1}
.nm-bulk-bar{display:flex;align-items:center;gap:10px;padding:8px 14px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:7px;margin:6px 0 4px;flex-wrap:wrap}
.nm-bulk-bar-count{font-size:13px;font-weight:700;color:#1D4ED8;flex:1;min-width:max-content}
.nm-bulk-bar-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
/* ── Modal multi-selección de novedades ──────────────────────────── */
.nm-nov-multi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:8px;max-height:220px;overflow-y:auto}
.nm-nov-multi-label{display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:5px;cursor:pointer;font-size:13px;color:#334155;transition:background .12s}
.nm-nov-multi-label:hover{background:#EFF6FF}
.nm-nov-multi-label input[type=checkbox]{width:15px;height:15px;accent-color:#0F766E;flex-shrink:0}
.nm-nov-multi-section{border:1px solid #E2E8F0;border-radius:8px;padding:10px 12px;margin-top:8px;background:#fff}
.nm-nov-multi-section-hdr{display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:6px;flex-wrap:wrap}
.nm-nov-multi-section-body{}
/* ── Vista agrupada por colaborador ──────────────────────────────── */
.nm-nov-grouped-wrap{display:flex;flex-direction:column;gap:10px;margin-top:6px}
.nm-nov-grp-card{border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;background:#fff}
.nm-nov-grp-card-hdr{display:flex;justify-content:space-between;align-items:center;padding:9px 13px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;gap:8px}
.nm-nov-grp-emp-name{font-weight:700;font-size:13px;color:#0F172A}
.nm-nov-grp-count{font-size:12px;font-weight:600;color:#475569;background:#E2E8F0;border-radius:99px;padding:1px 8px}
.nm-nov-grp-pending{font-size:11px;font-weight:700;color:#B45309;background:#FEF3C7;border-radius:99px;padding:1px 7px}
.nm-nov-grp-ok{font-size:11px;font-weight:700;color:#15803D;background:#DCFCE7;border-radius:99px;padding:1px 7px}
.nm-nov-grp-rows{display:flex;flex-direction:column}
.nm-nov-grp-row{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:8px 13px;border-bottom:1px solid #F1F5F9;font-size:13px}
.nm-nov-grp-row:last-child{border-bottom:none}
.nm-nov-grp-row.reviewed-row{opacity:.65}
.nm-nov-grp-row-type{min-width:0}
.nm-nov-grp-row-meta{display:flex;align-items:center;gap:10px;white-space:nowrap;font-size:12px;color:#475569}
.nm-nov-grp-days{font-weight:700;background:#F1F5F9;border-radius:4px;padding:1px 6px}
.nm-nov-grp-row-actions{display:flex;align-items:center;gap:4px}
.nm-nov-grp-chip{font-size:10px;font-weight:700;border-radius:3px;padding:1px 5px;vertical-align:middle;display:inline-block;margin-left:3px}
.nm-nov-grp-chip--cont{background:#EEF2FF;color:#4338CA}
.nm-nov-grp-chip--multi{background:#FEF3C7;color:#92400E}
/* Botón agrupar activo */
.nm-fbar-active{background:#E0F2FE;border-color:#BAE6FD;color:#0369A1}
/* ── Registro masivo de novedades ────────────────────────────────── */
.nm-bulk-block{border:1px solid #E2E8F0;border-radius:6px;padding:10px 12px;margin-bottom:8px;background:#F8FAFC}
.nm-bulk-block-label{font-size:11px;font-weight:700;color:#0F766E;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.nm-bulk-singles{display:grid;gap:6px;max-height:320px;overflow-y:auto;padding:2px}
.nm-bulk-single-row{display:flex;align-items:center;gap:10px}
.nm-bulk-single-label{font-size:12px;font-weight:600;color:#475569;min-width:58px;flex-shrink:0}
.nm-bulk-summary{background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:12px 14px}
.nm-bulk-summary-title{font-size:12px;font-weight:700;color:#166534;margin-bottom:6px}
.nm-bulk-summary-list{margin:0;padding-left:18px;font-size:13px;color:#14532D;line-height:1.8;max-height:260px;overflow-y:auto}
.nm-bulk-summary-total{margin-top:8px;font-size:12px;color:#166534;font-weight:600;border-top:1px solid #BBF7D0;padding-top:6px}

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

/* ── Municipio: wrap con botón de revisión ───────────────────────── */
.nm-pay-mun-wrap{display:flex;align-items:center;gap:1px;padding:0 2px}
.nm-pay-mc-rev-btn{flex-shrink:0;border:1px solid transparent;cursor:pointer;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;line-height:1.5;white-space:nowrap;background:transparent;color:#CBD5E1}
.nm-pay-mc-rev-btn:hover{background:#DBEAFE;color:#1D4ED8;border-color:#BFDBFE}
.nm-pay-mc-rev-btn--done{color:#10B981}
.nm-pay-mc-rev-btn--done:hover{background:#FEF3C7;color:#92400E;border-color:#FDE68A}

/* ── Barra de filtros de items de nómina ────────────────────────── */
.nm-items-fbar{display:flex;gap:5px;flex-wrap:wrap;align-items:center;padding:6px 10px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;flex:0 0 auto}
.nm-items-fbar label{font-size:11px;font-weight:700;color:#475569;white-space:nowrap;flex-shrink:0}
.nm-fbar-sep{width:1px;height:18px;background:#E2E8F0;flex-shrink:0;margin:0 2px}
.nm-fbar-active{background:#ECFDF5!important;border-color:#0F766E!important;color:#0F766E!important}

/* ── Tarjetas de turnos agrupados ───────────────────────────────── */
.nm-turn-group-card{border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;margin-bottom:12px}
.nm-turn-group--ext{border-color:#FDE68A}
.nm-turn-group--int{border-color:#BFDBFE}
.nm-turn-group-hd{display:flex;align-items:center;gap:10px;padding:9px 12px;flex-wrap:wrap}
.nm-turn-group--ext .nm-turn-group-hd{background:#FFFBEB}
.nm-turn-group--int .nm-turn-group-hd{background:#EFF6FF}
.nm-turn-type-badge{display:inline-flex;border-radius:3px;padding:2px 8px;font-size:11px;font-weight:800;letter-spacing:.5px;flex-shrink:0;white-space:nowrap}
.nm-turn-badge--ext{background:#FEF9C3;color:#92400E}
.nm-turn-badge--int{background:#DBEAFE;color:#1E40AF}
.nm-turn-group-ft{padding:8px 12px;background:#F8FAFC;border-top:1px solid #E2E8F0;display:flex;flex-direction:column;gap:6px}

/* ── Filtro de novedades ─────────────────────────────────────────── */
.nm-nov-fbar{display:flex;gap:5px;flex-wrap:wrap;align-items:center;padding:6px 10px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;flex:0 0 auto}

/* ── Días SS ─────────────────────────────────────────────────────── */
.nm-ss-cell{display:flex;flex-direction:column;gap:2px}
.nm-ss-val{font-size:13px;font-weight:800;color:#0F172A}
.nm-ss-reason{font-size:10px;font-weight:700;border-radius:3px;padding:1px 5px;white-space:nowrap;display:inline-block;margin-top:1px}
.nm-ss-reason--cupos{background:#DCFCE7;color:#166534}
.nm-ss-reason--renuncia{background:#FEF3C7;color:#92400E}
.nm-ss-reason--terminacion{background:#FEE2E2;color:#991B1B}
.nm-ss-repl{font-size:10px;color:#0F766E;font-weight:600}
.nm-ss-norepl{font-size:10px;color:#B91C1C;font-weight:600}
.nm-ss-alert{display:flex;align-items:center;gap:4px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:4px;padding:3px 6px;font-size:11px;color:#92400E;margin-top:3px}

/* ── Soportes inline (pestaña Soportes dentro del grupo) ─────────── */
.nm-sup-inline{display:flex;flex-direction:column;gap:0;overflow:auto;max-height:calc(100vh - 380px)}
.nm-sup-inline-bar{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;flex-wrap:wrap;flex:0 0 auto}
.nm-sup-inline-stat{display:flex;flex-direction:column;align-items:center;min-width:56px;padding:4px 8px;border-radius:5px;background:#fff;border:1px solid #E2E8F0;font-size:11px}
.nm-sup-inline-stat b{font-size:16px;font-weight:800;color:#0F172A;line-height:1.1}
.nm-sup-inline-stat span{color:#64748B;text-transform:uppercase;letter-spacing:.03em}
.nm-sup-inline-stat--ok b{color:#166534}
.nm-sup-inline-stat--warn b{color:#92400E}
.nm-sup-inline-progress{display:flex;align-items:center;gap:6px;flex:1 1 120px;min-width:120px;height:20px;position:relative;background:#E2E8F0;border-radius:999px;overflow:hidden}
.nm-sup-inline-progress-bar{position:absolute;left:0;top:0;bottom:0;background:#22C55E;border-radius:999px;transition:width .3s}
.nm-sup-inline-progress span{position:relative;z-index:1;font-size:11px;font-weight:700;padding-left:8px;color:#0F172A}
.nm-sup-inline-alert{font-size:11px;font-weight:700;color:#92400E;background:#FEF3C7;padding:3px 8px;border-radius:4px}
.nm-sup-inline-ok{font-size:11px;font-weight:700;color:#166534;background:#DCFCE7;padding:3px 8px;border-radius:4px}
.nm-sup-inline-list{flex:1 1 auto;overflow:auto;padding:8px}
.nm-sup-inline-group{background:#fff;border:1px solid #E2E8F0;border-radius:7px;margin-bottom:8px;overflow:hidden}
.nm-sup-inline-nov-hd{display:flex;align-items:center;gap:8px;padding:7px 12px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;flex-wrap:wrap}
.nm-sup-inline-nov-type{font-size:12px;font-weight:700;color:#0F172A}
.nm-sup-inline-nov-emp{font-size:12px;color:#334155;background:#E2E8F0;padding:1px 7px;border-radius:999px}
.nm-sup-inline-nov-date{font-size:11px;color:#64748B}
.nm-sup-inline-nov-doc{font-size:11px;color:#94A3B8}
.nm-sup-inline-docs{display:flex;flex-direction:column;gap:0}
.nm-sup-inline-doc{display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid #F1F5F9;flex-wrap:wrap}
.nm-sup-inline-doc:last-child{border-bottom:0}
.nm-sup-inline-doc-label{font-size:12px;color:#334155;flex:1 1 160px}
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

function resetItemsFilter() {
  itemsFilter = { institution_id: "", site_id: "", modality: "", cargo: "", has_novelties: "", reviewed: "", support_status: "", sort_by: "", sort_dir: "asc" };
  groupFilterCatalog = { institutions: [], sites: [], modalities: [], cargos: [] };
}

function buildFilterParams() {
  const p = new URLSearchParams();
  if (itemsFilter.institution_id) p.set("institution_id", itemsFilter.institution_id);
  if (itemsFilter.site_id)        p.set("site_id",        itemsFilter.site_id);
  if (itemsFilter.modality)       p.set("modality",       itemsFilter.modality);
  if (itemsFilter.cargo)          p.set("cargo",          itemsFilter.cargo);
  if (itemsFilter.has_novelties !== "") p.set("has_novelties", itemsFilter.has_novelties);
  if (itemsFilter.reviewed !== "")      p.set("reviewed",      itemsFilter.reviewed);
  if (itemsFilter.support_status)       p.set("support_status",itemsFilter.support_status);
  if (itemsFilter.sort_by)              p.set("sort_by",       itemsFilter.sort_by);
  if (itemsFilter.sort_dir && itemsFilter.sort_dir !== "asc") p.set("sort_dir", itemsFilter.sort_dir);
  return p;
}

function isFilterActive() {
  const f = itemsFilter;
  return !!(f.institution_id || f.site_id || f.modality || f.cargo || f.has_novelties || f.reviewed || f.support_status || f.sort_by || (f.sort_dir && f.sort_dir !== "asc"));
}

async function loadGroupDetail() {
  if (!activePeriod || !activeGroupId) { activeGroupDetail = null; activeGroupTurns = null; return; }
  const qs = buildFilterParams().toString();
  const response = await apiFetch(`/payroll/${activePeriod.id}/groups/${activeGroupId}${qs ? "?" + qs : ""}`);
  activeGroupDetail = response.data || null;
  activeGroupTurns  = null;

  // Rebuild catalog only when no filters are active (stores all institutions/sites/modalities/cargos)
  if (!isFilterActive() && activeGroupDetail?.items?.length) {
    const institutions = new Map();
    const sites = new Map();
    const modalities = new Set();
    const cargos = new Set();
    for (const item of activeGroupDetail.items) {
      if (item.institution_id && item.institution_name)
        institutions.set(Number(item.institution_id), item.institution_name);
      if (item.site_id && item.site_name)
        sites.set(Number(item.site_id), item.site_name);
      if (item.modality) modalities.add(item.modality);
      if (item.operational_position) cargos.add(item.operational_position);
    }
    groupFilterCatalog = {
      institutions: Array.from(institutions.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es")),
      sites:        Array.from(sites.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es")),
      modalities:   Array.from(modalities).sort(),
      cargos:       Array.from(cargos).sort((a, b) => a.localeCompare(b, "es")),
    };
  }
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

${renderNominaPanel()}
</div>
`;
  wireStaticEvents();
}

function renderPrimaryTabs() {
  return ""; // Primary Soportes tab removed — soportes are managed within the inline group detail
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

function munStatusChip(status) {
  const s = String(status || "");
  const map = {
    pendiente:   ["PEND",  "s"],
    DRAFT:       ["BORRA", "s"],
    en_revision: ["REV",   "rev"],
    IN_REVIEW:   ["REV",   "rev"],
    revisada:    ["OK",    "ok"],
    cerrada:     ["CER",   "closed"],
    CLOSED:      ["CER",   "closed"],
    REOPENED:    ["REAB",  "reopened"],
    SENT:        ["ENV",   "rev"],
    PAID:        ["PAG",   "ok"],
  };
  const [label, cls] = map[s] || [s.slice(0, 4).toUpperCase() || "?", "s"];
  return `<span class="nm-pay-mc-chip nm-pay-mc-chip--${cls}">${label}</span>`;
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
    ${filtered.length ? filtered.map((mun) => {
      const rev      = Number(mun.items_reviewed || 0);
      const tot      = Number(mun.employees || 0);
      const docs     = Number(mun.pending_supports || 0);
      const isReviewed = Boolean(mun.municipality_reviewed);
      const isCons     = Boolean(mun.is_consolidated);
      const isActive   = Number(mun.id) === Number(activeGroupId);

      // Chip de progreso de revisión
      const revChip = isReviewed
        ? `<span class="nm-pay-mc-chip nm-pay-mc-chip--ok" title="Revisado por ${escapeHtml(mun.municipality_reviewed_by || '')}">&#10003;${tot}/${tot}</span>`
        : (tot > 0 && rev >= tot)
          ? `<span class="nm-pay-mc-chip nm-pay-mc-chip--ok">&#10003;${tot}/${tot}</span>`
          : (tot > 0 && rev > 0)
            ? `<span class="nm-pay-mc-chip nm-pay-mc-chip--partial">${rev}/${tot}</span>`
            : "";

      // Botón de revisión compacto (solo para no-consolidados)
      const revBtn = isCons ? "" : isReviewed
        ? `<button class="nm-pay-mc-rev-btn nm-pay-mc-rev-btn--done" data-mun-unreview="${mun.municipality_id || ""}" data-mun-name="${escapeHtml(mun.municipality_name)}" title="Quitar revisión">&#8635;</button>`
        : `<button class="nm-pay-mc-rev-btn" data-mun-review="${mun.municipality_id || ""}" data-mun-name="${escapeHtml(mun.municipality_name)}" title="Marcar como revisado">&#10003;</button>`;

      return `
      <div class="nm-pay-mun-wrap">
        <button class="nm-pay-mun ${isActive ? "active" : ""}" data-group-id="${mun.id}">
          <span class="nm-pay-mc-name">${isCons ? "Consolidado" : escapeHtml(mun.municipality_name)}</span>
          <span class="nm-pay-mc-chips">
            ${munStatusChip(mun.status)}
            ${docs > 0 ? `<span class="nm-pay-mc-chip nm-pay-mc-chip--doc">DOC:${docs}</span>` : ""}
            ${revChip}
          </span>
        </button>
        ${revBtn}
      </div>`;
    }).join("") : `<div class="nm-pay-empty" style="padding:16px">Sin municipios.</div>`}
  </div>
</aside>`;
}

function renderGroupDetail() {
  if (!activeGroupDetail) return `
    <div class="nm-pay-toolbar" style="border:0;padding:16px">
      <div class="nm-pay-empty" style="flex:1">Selecciona un municipio para ver su nómina.</div>
    </div>`;
  const { group, items, novelties, covers, supports, totals } = activeGroupDetail;
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
    <div class="nm-banner__detail">Cerrada el ${group.closed_at ? new Date(group.closed_at).toLocaleString("es-CO") : "—"}.
      Liquidación protegida · Soportes y turnos externos disponibles.</div>
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
    <button class="nm-pay-btn nm-pay-btn--sm" id="nmPayTemplateDownload" title="Descargar plantilla Excel para registrar novedades día a día">&#11015; Plantilla</button>
    <button class="nm-pay-btn nm-pay-btn--sm" id="nmPayTemplateImport"   title="Importar plantilla de novedades diarias completada">&#8679; Importar</button>
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
    <button class="nm-detail-tab ${activeDetailTab === "nomina" ? "active" : ""}" data-detail-tab="nomina">
      Nómina <span class="nm-pay-count">${items.length}</span>${isFilterActive() ? ` <span style="font-size:10px;color:#0F766E;font-weight:600">filtrado</span>` : ""}
    </button>
    <button class="nm-detail-tab ${activeDetailTab === "novedades" ? "active" : ""}" data-detail-tab="novedades">
      Novedades <span class="nm-pay-count">${novelties.length}</span>
    </button>
    <button class="nm-detail-tab ${activeDetailTab === "turnos" ? "active" : ""}" data-detail-tab="turnos">
      Turnos${activeGroupTurns !== null ? ` <span class="nm-pay-count">${activeGroupTurns.filter((t) => t.cover_type === "EXTERNA").length}</span>` : ""}
    </button>
    <button class="nm-detail-tab ${activeDetailTab === "soportes" ? "active" : ""}" data-detail-tab="soportes">
      Soportes${totals.pending_supports > 0 ? ` <span class="nm-pay-count" style="background:#FEF3C7;color:#92400E">${totals.pending_supports} pend.</span>` : (supports && supports.length ? ` <span class="nm-pay-count">${supports.length}</span>` : "")}
    </button>
  </div>
  ${activeDetailTab === "nomina"
    ? `${renderNominaItemsFilterBar(items.length)}${renderBulkActionBar(items)}${items.length
        ? renderItemsTable(items)
        : `<div class="nm-pay-empty" style="margin:10px">${isFilterActive() ? "Ningún empleado coincide con los filtros aplicados." : "Pulsa \"Calcular\" para cargar los empleados activos."}</div>`}`
    : activeDetailTab === "novedades"
    ? renderNoveltiesWithFilter(novelties)
    : activeDetailTab === "soportes"
    ? renderSupportsSection(supports || [], isClosed, covers)
    : (activeGroupTurns === null
        ? `<div class="nm-pay-empty">Cargando turnos…</div>`
        : renderTurnosSection(activeGroupTurns, isClosed))}
</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// BARRA DE FILTROS DE ITEMS DE NÓMINA
// ─────────────────────────────────────────────────────────────────────────────
function renderNominaItemsFilterBar(itemCount) {
  const f = itemsFilter;
  const active = isFilterActive();
  const selClass = (val) => val ? "nm-pay-select nm-pay-input--sm nm-fbar-active" : "nm-pay-select nm-pay-input--sm";
  return `
<div class="nm-items-fbar">
  <label>Filtros:</label>
  ${groupFilterCatalog.institutions.length ? `
  <select class="${selClass(f.institution_id)}" id="fltInstitution" style="max-width:160px">
    <option value="">Institución</option>
    ${groupFilterCatalog.institutions.map(i => `<option value="${i.id}" ${String(f.institution_id) === String(i.id) ? "selected" : ""}>${escapeHtml(i.name)}</option>`).join("")}
  </select>` : ""}
  ${groupFilterCatalog.sites.length ? `
  <select class="${selClass(f.site_id)}" id="fltSite" style="max-width:140px">
    <option value="">Sede</option>
    ${groupFilterCatalog.sites.map(s => `<option value="${s.id}" ${String(f.site_id) === String(s.id) ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
  </select>` : ""}
  ${groupFilterCatalog.modalities.length ? `
  <select class="${selClass(f.modality)}" id="fltModality" style="max-width:100px">
    <option value="">Modalidad</option>
    ${groupFilterCatalog.modalities.map(m => `<option value="${escapeHtml(m)}" ${f.modality === m ? "selected" : ""}>${escapeHtml(m)}</option>`).join("")}
  </select>` : ""}
  ${groupFilterCatalog.cargos.length ? `
  <select class="${selClass(f.cargo)}" id="fltCargo" style="max-width:160px">
    <option value="">Cargo</option>
    ${groupFilterCatalog.cargos.map(c => `<option value="${escapeHtml(c)}" ${f.cargo === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
  </select>` : ""}
  <select class="${selClass(f.has_novelties)}" id="fltNovedades" style="max-width:140px">
    <option value="">Novedades: todas</option>
    <option value="true"  ${f.has_novelties === "true"  ? "selected" : ""}>Con novedades</option>
    <option value="false" ${f.has_novelties === "false" ? "selected" : ""}>Sin novedades</option>
  </select>
  <select class="${selClass(f.reviewed)}" id="fltReviewed" style="max-width:130px">
    <option value="">Revisión: todas</option>
    <option value="true"  ${f.reviewed === "true"  ? "selected" : ""}>Revisados</option>
    <option value="false" ${f.reviewed === "false" ? "selected" : ""}>Pendientes</option>
  </select>
  <select class="${selClass(f.support_status)}" id="fltSupports" style="max-width:130px">
    <option value="">Soportes: todos</option>
    <option value="pending"  ${f.support_status === "pending"  ? "selected" : ""}>Pendientes</option>
    <option value="complete" ${f.support_status === "complete" ? "selected" : ""}>Completos</option>
  </select>
  <div class="nm-fbar-sep"></div>
  <label>Ordenar:</label>
  <select class="nm-pay-select nm-pay-input--sm" id="fltSortBy" style="max-width:130px">
    <option value="">Nombre (A-Z)</option>
    <option value="documento"  ${f.sort_by === "documento"  ? "selected" : ""}>Documento</option>
    <option value="institucion"${f.sort_by === "institucion"? "selected" : ""}>Institución</option>
    <option value="sede"       ${f.sort_by === "sede"       ? "selected" : ""}>Sede</option>
    <option value="modalidad"  ${f.sort_by === "modalidad"  ? "selected" : ""}>Modalidad</option>
    <option value="cargo"      ${f.sort_by === "cargo"      ? "selected" : ""}>Cargo</option>
    <option value="devengado"  ${f.sort_by === "devengado"  ? "selected" : ""}>Devengado</option>
    <option value="neto"       ${f.sort_by === "neto"       ? "selected" : ""}>Neto</option>
    <option value="novedades"  ${f.sort_by === "novedades"  ? "selected" : ""}>N° novedades</option>
  </select>
  <select class="nm-pay-select nm-pay-input--sm" id="fltSortDir" style="max-width:70px">
    <option value="asc"  ${f.sort_dir !== "desc" ? "selected" : ""}>↑ Asc</option>
    <option value="desc" ${f.sort_dir === "desc" ? "selected" : ""}>↓ Desc</option>
  </select>
  ${active ? `<button class="nm-pay-btn nm-pay-btn--sm" id="fltClear" style="color:#B91C1C;border-color:#FECACA;flex-shrink:0">✕ Limpiar</button>` : ""}
  <span style="font-size:11px;color:#94A3B8;margin-left:4px;white-space:nowrap">${active ? `${itemCount} resultado(s)` : ""}</span>
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

// ─────────────────────────────────────────────────────────────────────────────
// BARRA DE ACCIONES MASIVAS
// ─────────────────────────────────────────────────────────────────────────────
function renderBulkActionBar(items = []) {
  const count        = selectedItemIds.size;
  const groupLocked  = !isGroupEditable(activeGroupDetail?.group);
  // Contar cuántos de los seleccionados no están aún revisados
  const selectableItems = items.filter((i) => !i.reviewed);
  const pendingSelected = items.filter((i) => selectedItemIds.has(i.id) && !i.reviewed).length;
  const reviewedSelected= items.filter((i) => selectedItemIds.has(i.id) &&  i.reviewed).length;

  if (!count || groupLocked) return "";

  return `
<div class="nm-bulk-bar" id="nmBulkBar">
  <span class="nm-bulk-bar-count">
    &#9745; <b>${count}</b> colaborador${count !== 1 ? "es" : ""} seleccionado${count !== 1 ? "s" : ""}
    ${pendingSelected > 0 ? `<small style="color:#64748B"> · ${pendingSelected} pendiente${pendingSelected !== 1 ? "s" : ""}</small>` : ""}
  </span>
  <div class="nm-bulk-bar-actions">
    ${pendingSelected > 0
      ? `<button class="nm-pay-btn nm-pay-btn--primary nm-pay-btn--sm" id="nmBulkReview">
           &#10003; Marcar ${pendingSelected} como revisado${pendingSelected !== 1 ? "s" : ""}
         </button>`
      : ""}
    ${reviewedSelected > 0
      ? `<button class="nm-pay-btn nm-pay-btn--sm" id="nmBulkUnreview" style="color:#B91C1C;border-color:#FECACA">
           &#8617; Desmarcar ${reviewedSelected} revisión
         </button>`
      : ""}
    <button class="nm-pay-btn nm-pay-btn--sm" id="nmBulkClear">&#10005; Limpiar selección</button>
  </div>
</div>`;
}

function renderItemsTable(items) {
  const groupLocked    = !isGroupEditable(activeGroupDetail?.group);
  const consolidated   = isConsolidatedView();
  const canCfgSalary   = consolidated && isCurrentUserAdmin();
  const extCoverItemIds = new Set(
    ((activeGroupDetail?.covers) || [])
      .filter((c) => c.cover_type === "EXTERNA")
      .map((c) => c.payroll_item_id)
  );
  const MOTIVO_LABEL = {
    disminucion_cupos:    { label: "Disminución de cupos", cls: "nm-ss-reason--cupos" },
    renuncia:             { label: "Renuncia",             cls: "nm-ss-reason--renuncia" },
    terminacion_contrato: { label: "Terminación contrato", cls: "nm-ss-reason--terminacion" },
  };

  // Seleccionables = todos los items (pendientes para marcar, revisados para desmarcar)
  const allIds     = items.map((i) => i.id);
  const allCount   = allIds.length;
  const allSelected  = allCount > 0 && allIds.every((id) => selectedItemIds.has(id));
  const someSelected = !allSelected && allIds.some((id) => selectedItemIds.has(id));

  return `
<div class="nm-pay-table-wrap">
<table class="nm-pay-table">
  <thead>
    <tr>
      ${!groupLocked && allCount > 0 ? `
      <th class="nm-sel-col" title="Seleccionar / Deseleccionar todos">
        <input type="checkbox" id="nmSelAll"
               ${allSelected ? "checked" : ""}
               ${someSelected ? `style="opacity:.7"` : ""}
               title="Seleccionar todos">
      </th>` : `<th class="nm-sel-col"></th>`}
      <th>Empleado</th><th>Sede · Modalidad · Categoría</th>
      <th class="num">Devengado</th><th class="num">Deducciones</th><th class="num">Neto</th>
      <th class="num">Días lab.</th><th class="num">Días SS</th>
      <th>Nov.</th><th>Acciones</th><th>REVISADA</th>
    </tr>
  </thead>
  <tbody>
    ${items.map((item) => {
      const isReviewed = Boolean(item.reviewed);
      const locked = groupLocked || isReviewed;
      const isSelected = selectedItemIds.has(item.id);
      const hasExtCover = extCoverItemIds.has(item.id);
<<<<<<< HEAD
      const retiredInPeriod = item.payroll_inclusion_status === "RETIRADA_EN_PERIODO" || item.fecha_retiro_aplicada;
=======
      const ssDays = item.ss_days != null ? item.ss_days : 30;
      const motivoMeta = item.retirement_reason ? MOTIVO_LABEL[item.retirement_reason] : null;
      const ssHtml = (() => {
        if (!item.retirement_reason && item.ss_days == null) return `<span class="nm-ss-val">30</span>`;
        const parts = [`<span class="nm-ss-val">${ssDays}</span>`];
        if (motivoMeta) parts.push(`<span class="nm-ss-reason ${motivoMeta.cls}">${motivoMeta.label}</span>`);
        if (item.requires_replacement === true) {
          if (item.replacement_found === true && item.replacement_employee_name) {
            parts.push(`<span class="nm-ss-repl">↪ ${escapeHtml(item.replacement_employee_name)}</span>`);
          } else if (item.replacement_found === false) {
            parts.push(`<span class="nm-ss-norepl">Sin reemplazo</span>`);
          }
        } else if (item.requires_replacement === false) {
          parts.push(`<span style="font-size:10px;color:#64748B">Sin reemplazo</span>`);
        }
        return parts.join("");
      })();
      const ssAlert = (item.requires_replacement === true && item.replacement_found === false)
        ? `<div class="nm-ss-alert" title="Retiro requiere reemplazo, pero no se encontró ingreso asociado para la misma sede.">⚠ Sin reemplazo</div>`
        : "";
>>>>>>> 03d3100d9fea6178f36fc2e8b2bcbd241043fdde
      return `
      <tr class="${isReviewed ? "item-reviewed-row" : ""}${isSelected ? " nm-item-selected-row" : ""}">
        <td class="nm-sel-col">
          ${!groupLocked
            ? `<input type="checkbox" class="nm-item-sel-cb" data-sel-item="${item.id}"
                      ${isSelected ? "checked" : ""}
                      title="${isReviewed ? "Seleccionar para desmarcar revisión" : "Seleccionar para marcar como revisado"}">`
            : ""}
        </td>
        <td>
          <b>${escapeHtml(item.employee_name)}</b><br>
          <small style="color:#64748B">${escapeHtml(item.document_number || "")}</small>
<<<<<<< HEAD
          ${retiredInPeriod ? `<br><small style="color:#B45309;font-weight:700">Retirado en este periodo${item.fecha_retiro_aplicada ? ` · ${escapeHtml(String(item.fecha_retiro_aplicada).slice(0, 10))}` : ""}</small>` : ""}
          ${item.worked_days ? `<br><small style="color:#475569">Días laborados: ${Number(item.worked_days || 0)}</small>` : ""}
=======
          ${consolidated ? `<br><small style="color:#7C3AED;font-weight:600">${escapeHtml(item.municipality_name || "")}</small>` : ""}
          ${ssAlert}
>>>>>>> 03d3100d9fea6178f36fc2e8b2bcbd241043fdde
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
        <td class="num" style="white-space:nowrap">${item.display_worked_days ?? item.worked_days ?? 30}</td>
        <td class="num"><div class="nm-ss-cell">${ssHtml}</div></td>
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
               ${canCfgSalary ? `<button class="nm-pay-btn nm-pay-btn--sm" style="background:#7C3AED;color:#fff" data-salary-cfg="${item.employee_id}" data-salary-name="${escapeHtml(item.employee_name)}" data-salary-doc="${escapeHtml(item.document_number || "")}">Salario</button>` : ""}
               <span style="display:block;margin-top:3px;font-size:10px;color:#94A3B8">Bloqueado por cierre</span>`
            : locked
              ? `<button class="nm-pay-btn nm-pay-btn--sm" data-payslip="${item.id}">Desprendible</button>
                 ${canCfgSalary ? `<button class="nm-pay-btn nm-pay-btn--sm" style="background:#7C3AED;color:#fff" data-salary-cfg="${item.employee_id}" data-salary-name="${escapeHtml(item.employee_name)}" data-salary-doc="${escapeHtml(item.document_number || "")}">Salario</button>` : ""}
                 <span style="display:block;margin-top:3px;font-size:10px;color:#64748B">Bloqueado</span>`
              : `<button class="nm-pay-btn nm-pay-btn--sm" data-new-novelty="${item.id}">+ Novedad</button>
                 <button class="nm-pay-btn nm-pay-btn--sm" data-cambio-operativo="${item.id}" title="Registrar cambio temporal/definitivo de modalidad, sede o jornada">Cambio op.</button>
                 <button class="nm-pay-btn nm-pay-btn--sm" data-payslip="${item.id}">Desprendible</button>
                 ${canCfgSalary ? `<button class="nm-pay-btn nm-pay-btn--sm" style="background:#7C3AED;color:#fff" data-salary-cfg="${item.employee_id}" data-salary-name="${escapeHtml(item.employee_name)}" data-salary-doc="${escapeHtml(item.document_number || "")}">Salario</button>` : ""}`}
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
// FILTRO + TABLA DE NOVEDADES
// ─────────────────────────────────────────────────────────────────────────────
function applyNoveltiesFilter(novelties) {
  let rows = novelties;
  if (noveltiesFilter.type)
    rows = rows.filter((n) => n.novelty_type === noveltiesFilter.type);
  if (noveltiesFilter.reviewed === "true")
    rows = rows.filter((n) => Boolean(n.reviewed));
  else if (noveltiesFilter.reviewed === "false")
    rows = rows.filter((n) => !n.reviewed);
  if (noveltiesFilter.withSupport === "true")
    rows = rows.filter((n) => n.support_status && n.support_status !== "aprobado");
  else if (noveltiesFilter.withSupport === "false")
    rows = rows.filter((n) => !n.support_status || n.support_status === "aprobado");
  if (noveltiesFilter.search) {
    const q = normalized(noveltiesFilter.search);
    rows = rows.filter((n) =>
      normalized(n.employee_name || "").includes(q) ||
      normalized(n.document_number || "").includes(q)
    );
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// VISTA AGRUPADA POR COLABORADOR
// ─────────────────────────────────────────────────────────────────────────────
function renderNoveltiesGrouped(novelties) {
  if (!novelties.length) return `<div class="nm-pay-empty" style="margin:10px">Sin novedades registradas en este municipio.</div>`;

  const groupLocked = !isGroupEditable(activeGroupDetail?.group);

  // Agrupar por employee_id, conservando el orden de aparición (ya vienen
  // ordenadas del backend — aquí solo agrupamos visualmente)
  const byEmp = new Map();
  for (const nov of novelties) {
    const key = String(nov.employee_id || nov.employee_name || "?");
    if (!byEmp.has(key)) {
      byEmp.set(key, { name: nov.employee_name || "—", doc: nov.document_number || "", rows: [] });
    }
    byEmp.get(key).rows.push(nov);
  }

  const groups = [...byEmp.values()];

  return groups.map((g) => {
    const total = g.rows.length;
    const pending  = g.rows.filter((n) => !n.reviewed).length;

    const novRows = g.rows.map((nov) => {
      const meta         = noveltyByCode(nov.novelty_type);
      const isReviewed   = Boolean(nov.reviewed);
      const isItemLocked = Boolean(nov.item_reviewed);
      const isLocked     = groupLocked || isReviewed || isItemLocked;
      const isCoverLocked= isReviewed || isItemLocked;
      const impactAmt    = Number(nov.affected_amount ?? nov.computed_impact ?? nov.value ?? 0);
      const impactLabel  = nov.impact_type === "salary"
        ? "↓ Sal."
        : nov.impact_type === "transport"
          ? "↓ Transp."
          : nov.impact_type === "turn_cover"
            ? "↓ Turno"
            : "";
      const dateStr      = nov.original_end_date
        ? fmtDateRange(nov.original_start_date || nov.start_date, nov.original_end_date)
        : fmtDateRange(nov.start_date, nov.end_date) || fmtDateDMY(nov.novelty_date);

      return `
<div class="nm-nov-grp-row ${isReviewed ? "reviewed-row" : ""}">
  <div class="nm-nov-grp-row-type">
    <b>${escapeHtml(nov.novelty_name || nov.novelty_type || "")}</b>
    ${nov.is_continuation ? `<span class="nm-nov-grp-chip nm-nov-grp-chip--cont">↩ Cont.</span>` : ""}
    ${nov.original_end_date && !nov.is_continuation ? `<span class="nm-nov-grp-chip nm-nov-grp-chip--multi">↔ Multi</span>` : ""}
    <br><small style="color:#64748B">${escapeHtml(nov.description || nov.observations || "")}</small>
  </div>
  <div class="nm-nov-grp-row-meta">
    <span>${dateStr || "—"}</span>
    <span class="nm-nov-grp-days">${Number(nov.period_days ?? nov.days ?? 0)}d</span>
    ${impactAmt ? `<span style="color:#991B1B;font-weight:600">-${fmtCOP(impactAmt)}<small style="color:#94A3B8;font-weight:400"> ${impactLabel}</small></span>` : ""}
  </div>
  <div class="nm-nov-grp-row-actions">
    ${!isLocked ? `
      <button class="nm-pay-btn nm-pay-btn--sm" title="Editar" data-edit-novelty="${nov.id}">&#9998;</button>
      ${!isCoverLocked && meta?.requires_turn_cover
        ? `<button class="nm-pay-btn nm-pay-btn--sm" title="Registrar cobertura" data-cover-novelty="${nov.id}" data-cover-item="${nov.payroll_item_id}">&#9200;</button>`
        : ""}
      <button class="nm-pay-btn nm-pay-btn--sm" style="color:#B91C1C" title="Eliminar" data-del-novelty="${nov.id}">&#128465;</button>` : ""}
    <label class="nm-item-review-label" title="${isReviewed ? "Revisada" : "Marcar como revisada"}">
      <input type="checkbox" class="nm-item-novelty-review-cb" data-novelty-reviewed="${nov.id}" ${isReviewed ? "checked" : ""} ${isLocked && !isReviewed ? "disabled" : ""}>
      ${isReviewed ? `<span class="nm-item-reviewed-badge">&#10003;</span>` : `<span style="font-size:10px;color:#94A3B8">Pdte.</span>`}
    </label>
  </div>
</div>`;
    }).join("");

    return `
<div class="nm-nov-grp-card">
  <div class="nm-nov-grp-card-hdr">
    <div>
      <span class="nm-nov-grp-emp-name">${escapeHtml(g.name)}</span>
      <small style="color:#94A3B8"> · ${escapeHtml(g.doc)}</small>
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      <span class="nm-nov-grp-count">${total} novedad${total !== 1 ? "es" : ""}</span>
      ${pending > 0 ? `<span class="nm-nov-grp-pending">${pending} pendiente${pending !== 1 ? "s" : ""}</span>` : `<span class="nm-nov-grp-ok">&#10003; al día</span>`}
    </div>
  </div>
  <div class="nm-nov-grp-rows">${novRows}</div>
</div>`;
  }).join("");
}

function renderNoveltiesWithFilter(allNovelties) {
  const filtered  = applyNoveltiesFilter(allNovelties);
  const hasFilter = noveltiesFilter.type || noveltiesFilter.reviewed || noveltiesFilter.withSupport || noveltiesFilter.search;
  const selClass  = (v) => v ? "nm-pay-select nm-pay-input--sm nm-fbar-active" : "nm-pay-select nm-pay-input--sm";
  const isGrouped = noveltiesViewMode === "grouped";

  const filterBar = `
<div class="nm-nov-fbar">
  <label style="font-size:11px;font-weight:700;color:#475569">Filtrar:</label>
  <select class="${selClass(noveltiesFilter.type)}" id="novFltType" style="max-width:180px">
    <option value="">Tipo: todos</option>
    ${NOVELTY_TYPES.filter((t) => t.code !== "CAMBIO_OPERATIVO_COBERTURA").map((t) =>
      `<option value="${t.code}" ${noveltiesFilter.type === t.code ? "selected" : ""}>${escapeHtml(t.name)}</option>`
    ).join("")}
  </select>
  <select class="${selClass(noveltiesFilter.reviewed)}" id="novFltReviewed" style="max-width:120px">
    <option value="">Revisión: todas</option>
    <option value="true"  ${noveltiesFilter.reviewed === "true"  ? "selected" : ""}>Revisadas</option>
    <option value="false" ${noveltiesFilter.reviewed === "false" ? "selected" : ""}>Pendientes</option>
  </select>
  <select class="${selClass(noveltiesFilter.withSupport)}" id="novFltSupport" style="max-width:140px">
    <option value="">Soporte: todos</option>
    <option value="true"  ${noveltiesFilter.withSupport === "true"  ? "selected" : ""}>Con soporte pendiente</option>
    <option value="false" ${noveltiesFilter.withSupport === "false" ? "selected" : ""}>Sin pendiente</option>
  </select>
  <input class="nm-pay-input nm-pay-input--sm" id="novFltSearch" placeholder="Buscar empleado…"
         value="${escapeHtml(noveltiesFilter.search)}" style="min-width:150px">
  ${hasFilter ? `<button class="nm-pay-btn nm-pay-btn--sm" id="novFltClear" style="color:#B91C1C;border-color:#FECACA">✕ Limpiar</button>` : ""}
  <span style="font-size:11px;color:#94A3B8;margin-left:auto">${filtered.length}/${allNovelties.length}</span>
  <button class="nm-pay-btn nm-pay-btn--sm${isGrouped ? " nm-fbar-active" : ""}" id="novToggleGroup"
          title="${isGrouped ? "Ver como tabla" : "Agrupar por colaborador"}">
    ${isGrouped ? "&#9776; Tabla" : "&#128101; Agrupar"}
  </button>
</div>`;

  let contentHtml;
  if (!filtered.length) {
    contentHtml = `<div class="nm-pay-empty" style="margin:10px">${hasFilter ? "Ninguna novedad coincide con los filtros." : "Sin novedades registradas en este municipio."}</div>`;
  } else if (isGrouped) {
    contentHtml = `<div class="nm-nov-grouped-wrap">${renderNoveltiesGrouped(filtered)}</div>`;
  } else {
    contentHtml = `<div class="nm-pay-table-wrap">${renderNoveltiesTable(filtered)}</div>`;
  }

  return filterBar + contentHtml;
}

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
      const isLocked       = groupLocked || isReviewed || isItemLocked;
      const lockTitle      = groupLocked ? "Nómina cerrada — reabrir para editar" : isItemLocked ? "Registro de nómina bloqueado por revisión" : "Novedad revisada — quite la revisión para editar";
      // El botón "Cubrió" tiene lock propio: permite registrar coberturas externas aunque la nómina esté cerrada
      const isCoverLocked  = isReviewed || isItemLocked;
      const impactAmt      = Number(nov.affected_amount ?? nov.computed_impact ?? nov.value ?? 0);
      const impactLabel    = nov.impact_type === "salary"
        ? "↓ Sal."
        : nov.impact_type === "transport"
          ? "↓ Transp."
          : nov.impact_type === "turn_cover"
            ? "↓ Turno"
            : "";
      const replacementText = Number(nov.replacement_amount || 0)
        ? `<br><small style="color:#047857">Reemplazo: ${escapeHtml(nov.replacement_employee_name || "interno")} · ${escapeHtml(nov.origin_salary_category || "—")} · ${Number(nov.covered_days || 0)}d · ${fmtCOP(Number(nov.replacement_value_per_day || 0))}/d · +${fmtCOP(nov.replacement_amount)}</small>`
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
        <td style="white-space:nowrap">
          ${nov.is_continuation
            ? `<span style="font-size:10px;background:#EEF2FF;color:#4338CA;border-radius:4px;padding:1px 5px;font-weight:700;display:inline-block;margin-bottom:2px">↩ Continuación</span><br>`
            : nov.original_end_date
              ? `<span style="font-size:10px;background:#FEF3C7;color:#92400E;border-radius:4px;padding:1px 5px;font-weight:700;display:inline-block;margin-bottom:2px">↔ Multi-período</span><br>`
              : ""}
          <small>${
            nov.original_end_date
              ? fmtDateRange(nov.original_start_date || nov.start_date, nov.original_end_date)
              : fmtDateRange(nov.start_date, nov.end_date) || fmtDateDMY(nov.novelty_date)
          }</small>
          ${nov.original_end_date && !nov.is_continuation
            ? `<br><small style="color:#7C3AED;font-size:10px;font-weight:600">
                &#x1F4C5; Este período: ${nov.period_days ?? nov.days} d
                ${nov.original_days && Number(nov.original_days) !== Number(nov.period_days ?? nov.days)
                  ? `<span style="color:#94A3B8;font-weight:400">/ ${nov.original_days} totales</span>`
                  : ""}
               </small>`
            : nov.is_continuation && nov.original_days
              ? `<br><small style="color:#0891B2;font-size:10px">&#x21BA; Continuación · ${nov.period_days ?? nov.days} d de este período</small>`
              : ""}
        </td>
        <td class="num">${Number(nov.period_days ?? nov.days ?? 0)}</td>
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
          <button class="nm-pay-btn nm-pay-btn--sm" data-cover-novelty="${nov.id}" data-cover-item="${nov.payroll_item_id}" ${isCoverLocked ? "disabled" : ""} title="${groupLocked ? "Nómina cerrada — solo coberturas externas" : ""}">Cubrió</button>
          ${nov.turn_cover_id ? `<button class="nm-pay-btn nm-pay-btn--sm" data-remove-cover="${nov.id}" ${isCoverLocked ? `disabled title="${groupLocked ? "Nómina cerrada" : lockTitle}"` : ""}>Quitar cubrió</button>` : ""}
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
// TABLA DE TURNOS (embebida en pestaña Novedades — usa datos del grupo cargado)
// ─────────────────────────────────────────────────────────────────────────────
function renderTurnsTable(covers) {
  const groupLocked = !isGroupEditable(activeGroupDetail?.group);
  return `
<table class="nm-pay-table">
  <thead>
    <tr>
      <th>Empleado origen</th>
      <th>Tipo novedad</th>
      <th>Municipio / Institución</th>
      <th>Cobertura</th>
      <th>Quien cubrió</th>
      <th>Categoría</th>
      <th class="num">Días</th>
      <th class="num">Valor día</th>
      <th class="num">Total</th>
      <th>Acción</th>
    </tr>
  </thead>
  <tbody>
    ${(covers || []).map((c) => {
      const coverName = c.cover_type === "INTERNA"
        ? (c.internal_cover_name || "—")
        : (c.external_worker_name || "—");
      const coverDoc  = c.cover_type === "INTERNA"
        ? (c.internal_cover_doc || "")
        : (c.external_worker_doc || "");
      const coverBadge = c.cover_type === "INTERNA"
        ? `<span class="nm-pay-badge" style="background:#DBEAFE;color:#1E40AF">INTERNA</span>`
        : `<span class="nm-pay-badge" style="background:#FEF3C7;color:#92400E">EXTERNA</span>`;
      return `
      <tr>
        <td>
          <b>${escapeHtml(c.origin_employee_name || "—")}</b><br>
          <small style="color:#64748B">${escapeHtml(c.origin_document || "")}</small>
        </td>
        <td>
          <small>${escapeHtml(c.novelty_type_name || c.novelty_type || "—")}</small><br>
          <small style="color:#94A3B8">${fmtDateRange(c.novelty_start, c.novelty_end)}</small>
        </td>
        <td>
          <small>${escapeHtml(c.municipality_name || "—")}</small><br>
          <small style="color:#64748B">${escapeHtml(c.institution_name || "—")} · ${escapeHtml(c.site_name || "—")}</small>
        </td>
        <td>${coverBadge}</td>
        <td>
          <b>${escapeHtml(coverName)}</b><br>
          <small style="color:#64748B">${escapeHtml(coverDoc)}</small>
        </td>
        <td><small>${escapeHtml(c.origin_category || "—")}</small></td>
        <td class="num">${Number(c.days || 0)}</td>
        <td class="num">${fmtCOP(c.value_per_day)}</td>
        <td class="num"><b>${fmtCOP(c.total_value)}</b></td>
        <td>
          ${c.cover_type === "EXTERNA"
            ? `<button class="nm-pay-btn nm-pay-btn--sm" data-charge-account="${c.turn_cover_id}" title="Ver cuenta de cobro consolidada">Ver cta. cobro</button>`
            : "—"}
        </td>
      </tr>`;
    }).join("")}
  </tbody>
</table>`;
}

// SECCIÓN TURNOS — solo personal externo, agrupado por persona que cubrió
// ─────────────────────────────────────────────────────────────────────────────
function renderTurnosSection(turns, isClosed) {
  const { search, hasCuentaCobro } = turnosFilter;

  // Solo coberturas externas
  const totalExt = (turns || []).filter((t) => t.cover_type === "EXTERNA").length;
  let rows = (turns || []).filter((t) => t.cover_type === "EXTERNA");

  if (search) {
    const q = normalized(search);
    rows = rows.filter((t) =>
      normalized(t.external_worker_name || "").includes(q) ||
      normalized(t.external_worker_doc  || "").includes(q) ||
      normalized(t.origin_employee_name || "").includes(q) ||
      normalized(t.origin_document      || "").includes(q)
    );
  }

  // Agrupar por persona externa
  const extGroups = new Map();
  for (const t of rows) {
    const key = t.external_worker_id || t.external_document || "ext_unknown";
    if (!extGroups.has(key)) {
      extGroups.set(key, {
        workerId:        t.external_worker_id,
        name:            t.external_worker_name || "—",
        document:        t.external_document || "",
        bank:            t.external_bank || "",
        accountType:     t.external_account_type || "AHORROS",
        accountNumber:   t.external_account_number || "",
        cedulaUrl:       t.cedula_url || "",
        certBancariaUrl: t.cert_bancaria_url || "",
        cuentaCobroUrl:  t.cuenta_cobro_url || "",
        turns:           [],
        totalDays:       0,
        totalValue:      0,
        anyTurnId:       t.id,
        extDoc:          t.external_document || String(t.id),
      });
    }
    const g = extGroups.get(key);
    g.turns.push(t);
    g.totalDays  += Number(t.covered_days || 0);
    g.totalValue += Number(t.total_value  || 0);
  }

  // Aplicar filtro con/sin cuenta de cobro sobre grupos
  let groupList = [...extGroups.values()];
  if (hasCuentaCobro === "true")  groupList = groupList.filter((g) => Boolean(g.cuentaCobroUrl));
  if (hasCuentaCobro === "false") groupList = groupList.filter((g) => !g.cuentaCobroUrl);

  const filterBar = `
<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
  <input class="nm-pay-input nm-pay-input--sm" id="turnoSearch" placeholder="Buscar externo o empleado…"
         value="${escapeHtml(search)}" style="min-width:200px">
  <select class="nm-pay-select nm-pay-input--sm" id="turnoFltCuentaCobro" style="width:auto">
    <option value=""      ${hasCuentaCobro === ""      ? "selected" : ""}>Cta. cobro: todas</option>
    <option value="true"  ${hasCuentaCobro === "true"  ? "selected" : ""}>Con cta. cobro</option>
    <option value="false" ${hasCuentaCobro === "false" ? "selected" : ""}>Sin cta. cobro</option>
  </select>
  <span style="font-size:12px;color:#94A3B8">${totalExt} turno(s) externo(s)</span>
</div>`;

  if (!groupList.length) {
    return `<div style="padding:10px">${filterBar}<div class="nm-pay-empty">${totalExt === 0 ? "Sin turnos externos registrados en este grupo." : "Ningún externo coincide con los filtros."}</div></div>`;
  }

  const turnTableHtml = (gTurns) => `
<table class="nm-pay-table" style="margin:0;border:0;border-radius:0">
  <thead>
    <tr>
      <th>Fecha</th>
      <th>Empleado con novedad</th>
      <th>Tipo de novedad</th>
      <th class="num">Días</th>
      <th class="num">Valor día</th>
      <th class="num">Total</th>
    </tr>
  </thead>
  <tbody>
    ${gTurns.map((t) => `
    <tr>
      <td style="white-space:nowrap"><small>${fmtDateRange(t.novelty_start, t.novelty_end)}</small></td>
      <td>
        <b>${escapeHtml(t.origin_employee_name || "—")}</b><br>
        <small style="color:#64748B">${escapeHtml(t.origin_document || "")}</small>
      </td>
      <td><small>${escapeHtml(t.novelty_type || "—")}</small></td>
      <td class="num">${Number(t.covered_days || 0)}</td>
      <td class="num">${fmtCOP(t.calculated_day_value)}</td>
      <td class="num"><b>${fmtCOP(t.total_value)}</b></td>
    </tr>`).join("")}
  </tbody>
</table>`;

  const extCards = groupList.map((g) => {
    const docStatus = (url, label) =>
      `<span style="font-size:11px;font-weight:600;${url ? "color:#166534" : "color:#B91C1C"}">${url ? "✓" : "✗"} ${label}</span>`;
    const allDocsOk = g.cedulaUrl && g.certBancariaUrl && g.cuentaCobroUrl;
    return `
<div class="nm-turn-group-card nm-turn-group--ext">
  <div class="nm-turn-group-hd">
    <span class="nm-turn-type-badge nm-turn-badge--ext">EXTERNO</span>
    <div style="flex:1;min-width:0">
      <b>${escapeHtml(g.name)}</b>
      <br><small style="color:#64748B">CC ${escapeHtml(g.document)}</small>
    </div>
    <small style="color:#64748B;white-space:nowrap">${g.bank ? `${escapeHtml(g.bank)} · ${escapeHtml(g.accountType)} · ${escapeHtml(g.accountNumber)}` : "<i>Sin datos bancarios</i>"}</small>
    ${canEditBankInfo()
      ? `<button class="nm-pay-btn nm-pay-btn--sm" style="background:#F59E0B;color:#fff;border-color:#F59E0B"
           data-edit-bank="${g.anyTurnId}"
           data-bank="${escapeHtml(g.bank)}"
           data-account-type="${escapeHtml(g.accountType)}"
           data-account-number="${escapeHtml(g.accountNumber)}">Datos bancarios</button>`
      : ""}
  </div>
  ${turnTableHtml(g.turns)}
  <div class="nm-turn-group-ft">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <b style="font-size:12px">Total: ${g.totalDays} día(s) · ${fmtCOP(g.totalValue)}</b>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${docStatus(g.cedulaUrl, "Cédula")}
        ${docStatus(g.certBancariaUrl, "Cert. bancaria")}
        ${docStatus(g.cuentaCobroUrl, "Cta. cobro")}
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
      <button class="nm-pay-btn nm-pay-btn--sm" data-charge-account="${g.anyTurnId}">Ver cta. cobro</button>
      <button class="nm-pay-btn nm-pay-btn--sm" data-dl-charge="${g.anyTurnId}" data-ext-doc="${escapeHtml(g.extDoc)}"
        ${!allDocsOk ? `disabled title="Faltan documentos: ${[!g.cedulaUrl && "cédula", !g.certBancariaUrl && "cert. bancaria", !g.cuentaCobroUrl && "cta. cobro"].filter(Boolean).join(", ")}"` : ""}>Descargar</button>
      ${g.workerId
        ? `<button class="nm-pay-btn nm-pay-btn--sm" data-ext-docs="${g.workerId}" data-ext-name="${escapeHtml(g.name)}">Cargar soportes</button>`
        : ""}
    </div>
  </div>
</div>`;
  }).join("");

  return `<div style="padding:10px">${filterBar}${extCards}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANTILLA MENSUAL DE NOVEDADES
// ─────────────────────────────────────────────────────────────────────────────

async function downloadNoveltiesTemplate() {
  if (!activePeriod) { showError("Seleccione un período primero."); return; }
  const btn = document.getElementById("nmPayTemplateDownload");
  const origLabel = btn?.textContent || "⬇ Plantilla";
  if (btn) { btn.disabled = true; btn.textContent = "Generando…"; }
  try {
    const token = state.token || localStorage.getItem("empiria_token") || "";
    const res = await fetch(`/payroll/periods/${activePeriod.id}/novelties-template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showError(err.message || "Error al generar la plantilla");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const safeLbl = (activePeriod.label || String(activePeriod.id)).replace(/[^a-zA-Z0-9_\-]/g, "_");
    a.download = `plantilla-novedades-${safeLbl}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
    showSuccess("Plantilla descargada correctamente.");
  } catch (err) {
    showError(err.message || "Error al descargar la plantilla");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origLabel; }
  }
}

function openImportNoveltiesModal() {
  if (!activePeriod) { showError("Seleccione un período primero."); return; }

  const input = document.createElement("input");
  input.type   = "file";
  input.accept = ".xlsx,.xls";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    const modal = document.getElementById("nmPayModal");
    if (!modal) return;
    modal.innerHTML = `
<div style="padding:20px;min-width:380px;max-width:560px">
  <div style="font-size:15px;font-weight:700;color:#0F172A;margin-bottom:14px">
    Importar novedades — ${escapeHtml(activePeriod.label || "")}
  </div>
  <div id="importNovStatus" style="font-size:13px;color:#64748B;padding:24px;text-align:center">
    <div style="font-size:28px;margin-bottom:10px">⏳</div>
    Procesando <b>${escapeHtml(file.name)}</b>…
  </div>
</div>`;
    modal.hidden = false;
    wireModalClose();

    const formData = new FormData();
    formData.append("file", file);
    const token = state.token || localStorage.getItem("empiria_token") || "";

    try {
      const res = await fetch(`/payroll/periods/${activePeriod.id}/import-novelties-template`, {
        method:  "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body:    formData,
      });
      const json = await res.json().catch(() => ({ ok: false, message: "Error de servidor" }));
      const d    = json.data || {};
      const statusEl = document.getElementById("importNovStatus");
      if (!statusEl) return;

      if (json.ok && d.ok) {
        statusEl.innerHTML = `
          <div style="font-size:28px;margin-bottom:10px">✅</div>
          <div style="font-size:14px;font-weight:700;color:#059669">Importación exitosa</div>
          <div style="margin-top:10px;font-size:13px;color:#475569">
            <b>${d.created}</b> novedad${d.created !== 1 ? "es" : ""} creada${d.created !== 1 ? "s" : ""}
            de <b>${d.total}</b> procesada${d.total !== 1 ? "s" : ""}.
          </div>
          ${d.message ? `<div style="margin-top:8px;font-size:12px;color:#64748B">${escapeHtml(d.message)}</div>` : ""}
          <div style="margin-top:16px;text-align:right">
            <button class="nm-pay-btn nm-pay-btn--primary nm-pay-btn--sm" data-close-modal>Aceptar</button>
          </div>`;
        wireModalClose();
        await reloadDetailOnly();
      } else {
        const errors  = d.errors  || [];
        const created = d.created || 0;
        const total   = d.total   || 0;
        const errHtml = errors.length
          ? `<div style="margin-top:10px;max-height:260px;overflow-y:auto;border:1px solid #FCA5A5;border-radius:6px;background:#FFF5F5">
               ${errors.map((e) => `<div style="padding:6px 10px;border-bottom:1px solid #FEE2E2;font-size:12px;color:#B91C1C">
                 ${escapeHtml(e.message || JSON.stringify(e))}
               </div>`).join("")}
             </div>`
          : "";
        statusEl.innerHTML = `
          <div style="font-size:28px;margin-bottom:10px">⚠️</div>
          <div style="font-size:14px;font-weight:700;color:#DC2626">
            ${errors.length ? "Errores de validación — no se importó nada" : "Errores al crear novedades"}
          </div>
          <div style="margin-top:8px;font-size:13px;color:#475569">
            ${errors.length
              ? `Se encontraron <b>${errors.length}</b> error${errors.length !== 1 ? "es" : ""}. Corrija el archivo e intente nuevamente.`
              : `Se crearon <b>${created}</b> de <b>${total}</b> novedades. Algunos registros fallaron.`}
          </div>
          ${errHtml}
          <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
            <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cancelar</button>
            <button class="nm-pay-btn nm-pay-btn--primary nm-pay-btn--sm" id="importNovRetry">Intentar con otro archivo</button>
          </div>`;
        wireModalClose();
        document.getElementById("importNovRetry")?.addEventListener("click", () => {
          closeModal();
          openImportNoveltiesModal();
        });
        if (created > 0) await reloadDetailOnly();
      }
    } catch (err) {
      const statusEl = document.getElementById("importNovStatus");
      if (statusEl) {
        statusEl.innerHTML = `
          <div style="font-size:28px;margin-bottom:10px">❌</div>
          <div style="font-size:14px;font-weight:700;color:#DC2626">Error de conexión</div>
          <div style="margin-top:8px;font-size:13px;color:#475569">${escapeHtml(err.message)}</div>
          <div style="margin-top:16px;text-align:right">
            <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
          </div>`;
        wireModalClose();
      }
    }
  };
  input.click();
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
    resetItemsFilter();
    await reloadWorkArea();
  });
  document.getElementById("nmPayCreate")?.addEventListener("click", createPeriod);

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
    noveltiesFilter    = { type: "", reviewed: "", withSupport: "", search: "" };
    activeDetailTab    = "nomina";
    selectedItemIds.clear();
    resetItemsFilter();
    // Auto-seleccionar grupo consolidado: si la posición tiene un solo grupo sin municipio
    const pos = groupsState.positions.find((p) => p.position === activePosition);
    const munis = pos?.municipalities || [];
    if (munis.length === 1 && munis[0].is_consolidated) {
      activeGroupId = munis[0].id;
    }
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
    activeGroupId      = Number(btn.dataset.groupId);
    activeDetailTab    = "nomina";
    noveltiesFilter    = { type: "", reviewed: "", withSupport: "", search: "" };
    selectedItemIds.clear();
    resetItemsFilter();
    await reloadDetailOnly();
  }));
  document.getElementById("nmPayCalculate")?.addEventListener("click",        calculateGroup);
  document.getElementById("nmPayExport")?.addEventListener("click",            openExportModal);
  document.getElementById("nmPayTemplateDownload")?.addEventListener("click", downloadNoveltiesTemplate);
  document.getElementById("nmPayTemplateImport")?.addEventListener("click",   openImportNoveltiesModal);
  document.getElementById("nmPayClose")?.addEventListener("click",            closeAndSendGroup);
  document.getElementById("nmPayReopen")?.addEventListener("click",           openReopenModal);
  document.getElementById("nmPayHistory")?.addEventListener("click",          openHistoryModal);
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
  document.querySelectorAll("[data-salary-cfg]").forEach((btn) => btn.addEventListener("click", () => {
    openSalaryConfigModal(Number(btn.dataset.salaryCfg), btn.dataset.salaryName || "", btn.dataset.salaryDoc || "");
  }));
  document.querySelectorAll("[data-reviewed]").forEach((input)     => input.addEventListener("change", () => toggleReviewed(Number(input.dataset.reviewed), input.checked, input)));
  document.querySelectorAll("[data-item-reviewed]").forEach((input) => input.addEventListener("change", () => toggleItemReviewed(Number(input.dataset.itemReviewed), input.checked, input)));

  // ── Selección masiva de ítems de nómina ───────────────────────────────────
  document.querySelectorAll(".nm-item-sel-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = Number(cb.dataset.selItem);
      if (cb.checked) selectedItemIds.add(id);
      else            selectedItemIds.delete(id);
      // Re-renderizar solo la barra y el encabezado del checkbox "seleccionar todos"
      // en lugar de un render() completo para evitar perder el foco
      const bar = document.getElementById("nmBulkBar");
      if (bar) {
        const items = activeGroupDetail?.items || [];
        bar.outerHTML = renderBulkActionBar(items);
        wireStaticBulkEvents();
      }
      const selAll = document.getElementById("nmSelAll");
      if (selAll) {
        const allItemIds = (activeGroupDetail?.items || []).map((i) => i.id);
        const allSel     = allItemIds.length > 0 && allItemIds.every((sid) => selectedItemIds.has(sid));
        const someSel    = !allSel && allItemIds.some((sid) => selectedItemIds.has(sid));
        selAll.checked       = allSel;
        selAll.indeterminate = someSel;
      }
    });
  });

  document.getElementById("nmSelAll")?.addEventListener("change", (e) => {
    const items = activeGroupDetail?.items || [];
    // Selecciona / deselecciona TODOS: pendientes y revisados
    items.forEach((i) => {
      if (e.target.checked) selectedItemIds.add(i.id);
      else                  selectedItemIds.delete(i.id);
    });
    render();
  });

  wireStaticBulkEvents();
  document.querySelectorAll("[data-delete-novelty]").forEach((btn)  => btn.addEventListener("click", () => confirmDeleteNovelty(Number(btn.dataset.deleteNovelty))));
  document.getElementById("turnoFltCuentaCobro")?.addEventListener("change", (e) => { turnosFilter.hasCuentaCobro = e.target.value; render(); });
  document.getElementById("turnoSearch")?.addEventListener("input",  (e) => { turnosFilter.search = e.target.value || ""; render(); document.getElementById("turnoSearch")?.focus(); });

  // ── Filtros de novedades ──────────────────────────────────────────────────
  document.getElementById("novFltType")?.addEventListener("change",    (e) => { noveltiesFilter.type = e.target.value; render(); });
  document.getElementById("novFltReviewed")?.addEventListener("change",(e) => { noveltiesFilter.reviewed = e.target.value; render(); });
  document.getElementById("novFltSupport")?.addEventListener("change", (e) => { noveltiesFilter.withSupport = e.target.value; render(); });
  document.getElementById("novFltSearch")?.addEventListener("input",   (e) => { noveltiesFilter.search = e.target.value || ""; render(); document.getElementById("novFltSearch")?.focus(); });
  document.getElementById("novFltClear")?.addEventListener("click",    () => { noveltiesFilter = { type: "", reviewed: "", withSupport: "", search: "" }; render(); });
  document.getElementById("novToggleGroup")?.addEventListener("click", () => { noveltiesViewMode = noveltiesViewMode === "grouped" ? "table" : "grouped"; render(); });

  // ── Filtros de tabla de ítems de nómina ───────────────────────────────────
  const applyFilter = async (key, val) => { itemsFilter[key] = val; await reloadDetailOnly(); };
  document.getElementById("fltInstitution")?.addEventListener("change", (e) => applyFilter("institution_id", e.target.value));
  document.getElementById("fltSite")?.addEventListener("change",        (e) => applyFilter("site_id",        e.target.value));
  document.getElementById("fltModality")?.addEventListener("change",    (e) => applyFilter("modality",       e.target.value));
  document.getElementById("fltCargo")?.addEventListener("change",       (e) => applyFilter("cargo",          e.target.value));
  document.getElementById("fltNovedades")?.addEventListener("change",   (e) => applyFilter("has_novelties",  e.target.value));
  document.getElementById("fltReviewed")?.addEventListener("change",    (e) => applyFilter("reviewed",       e.target.value));
  document.getElementById("fltSupports")?.addEventListener("change",    (e) => applyFilter("support_status", e.target.value));
  document.getElementById("fltSortBy")?.addEventListener("change",      (e) => applyFilter("sort_by",        e.target.value));
  document.getElementById("fltSortDir")?.addEventListener("change",     (e) => applyFilter("sort_dir",       e.target.value));
  document.getElementById("fltClear")?.addEventListener("click", async () => { resetItemsFilter(); await reloadDetailOnly(); });

  // ── Documentos de trabajador externo ─────────────────────────────────────
  document.querySelectorAll("[data-ext-docs]").forEach((btn) => btn.addEventListener("click", () => {
    openExternalWorkerDocsModal(Number(btn.dataset.extDocs), btn.dataset.extName || "Trabajador externo");
  }));

  // ── Revisión / reapertura de municipio ────────────────────────────────────
  document.querySelectorAll("[data-mun-review]").forEach((btn) => btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const munId   = Number(btn.dataset.munReview);
    const munName = btn.dataset.munName || "";
    if (!munId || !activePeriod) return;
    btn.disabled = true;
    try {
      await apiFetch(`/payroll/periods/${activePeriod.id}/municipality-status`, {
        method: "POST",
        body: JSON.stringify({ municipalityId: munId, municipality: munName, isComplete: true }),
      });
      showSuccess(`Municipio "${munName}" marcado como revisado`);
      await reloadWorkArea();
    } catch (err) { showError(err.message); btn.disabled = false; }
  }));
  document.querySelectorAll("[data-mun-unreview]").forEach((btn) => btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const munId   = Number(btn.dataset.munUnreview);
    const munName = btn.dataset.munName || "";
    if (!munId || !activePeriod) return;
    btn.disabled = true;
    try {
      await apiFetch(`/payroll/periods/${activePeriod.id}/municipality-status`, {
        method: "POST",
        body: JSON.stringify({ municipalityId: munId, municipality: munName, isComplete: false }),
      });
      showSuccess(`Revisión de "${munName}" removida — datos conservados`);
      await reloadWorkArea();
    } catch (err) { showError(err.message); btn.disabled = false; }
  }));

  // ── Upload en pestaña soportes inline del grupo ───────────────────────────
  document.querySelectorAll("[data-upload-support]").forEach((input) => input.addEventListener("change", async (e) => {
    const supId     = Number(input.dataset.uploadSupport) || null;  // null si vacío o 0
    const noveltyId = Number(input.dataset.noveltyId);
    const docType   = input.dataset.docType || "";
    const file      = e.target.files?.[0];
    // Permitir carga si tenemos noveltyId válido (supId puede ser null → crea el registro)
    if (!file || !noveltyId) return;
    const form = new FormData();
    form.append("file", file);
    form.append("noveltyId", String(noveltyId));
    input.disabled = true;
    try {
      const up = await apiFetch("/payroll/supports/upload", { method: "POST", body: form, noContentType: true });
      // Si supId existe: actualiza el registro. Si no: crea uno nuevo con el support_type del documento.
      await apiFetch("/payroll/supports", {
        method: "POST",
        body: JSON.stringify({
          id:           supId || undefined,
          novelty_id:   noveltyId,
          file_url:     up.data.url,
          file_name:    up.data.fileName,
          status:       "cargado",
          support_type: supId ? undefined : (docType || "otros"),
        }),
      });
      showSuccess("Soporte cargado correctamente");
      await reloadDetailOnly();
    } catch (err) {
      showError("Error cargando soporte: " + err.message);
      input.disabled = false;
    }
  }));
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

function openExportModal() {
  if (!activePeriod) return;
  const periodLabel     = activePeriod.label || String(activePeriod.id);
  const safeLbl         = periodLabel.replace(/[^a-z0-9]/gi, "-");
  const currentPosition = groupsState.positions.find((p) => p.position === activePosition);
  const posMunis        = Array.isArray(currentPosition?.municipalities) ? currentPosition.municipalities : [];
  const defaultSelected = new Set(
    activeGroupId ? [String(activeGroupId)] : posMunis.map((m) => String(m.id))
  );

  // ── Función que actualiza contadores Y visuales en tiempo real ──────────
  function updateExpCounters() {
    const checked   = [...document.querySelectorAll(".exp-mun-cb:checked")];
    const ids       = new Set(checked.map((cb) => cb.value));
    const selMunis  = posMunis.filter((m) => ids.has(String(m.id)));
    const empCount  = selMunis.reduce((s, m) => s + Number(m.employees || 0), 0);
    const novCount  = selMunis.reduce((s, m) => s + Number(m.novelties || 0), 0);
    const munCount  = selMunis.length;

    if (document.getElementById("expCntMun")) document.getElementById("expCntMun").textContent = munCount;
    if (document.getElementById("expCntEmp")) document.getElementById("expCntEmp").textContent = empCount;
    if (document.getElementById("expCntNov")) document.getElementById("expCntNov").textContent = novCount;

    const btn = document.getElementById("expDoBtn");
    if (btn) {
      btn.disabled = (munCount === 0);
      btn.textContent = munCount > 0
        ? `⬇ Exportar ${munCount} municipio${munCount !== 1 ? "s" : ""} (${empCount} colaboradores)`
        : "⬇ Exportar";
    }

    // BUG FIX #2: actualizar TAMBIÉN el innerHTML del indicador check y la clase CSS
    document.querySelectorAll(".exp-mun-card").forEach((card) => {
      const cb  = card.querySelector(".exp-mun-cb");
      const chk = card.querySelector(".exp-mun-card-check");
      const isChecked = cb?.checked ?? false;
      card.classList.toggle("exp-mun-card--selected", isChecked);
      if (chk) chk.innerHTML = isChecked ? "&#10003;" : "";  // ← antes faltaba esta línea
    });
  }

  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<style>
/* === Modal exportación === */
.exp-dialog-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px 0}
.exp-dialog-body{padding:18px 20px 20px;display:flex;flex-direction:column;gap:18px}
.exp-section-label{font-size:10.5px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px}
/* Grid de tarjetas */
.exp-mun-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px;max-height:300px;overflow-y:auto;padding-right:4px}
.exp-mun-grid::-webkit-scrollbar{width:4px}
.exp-mun-grid::-webkit-scrollbar-track{background:#F1F5F9;border-radius:4px}
.exp-mun-grid::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:4px}
/* Tarjeta */
.exp-mun-card{border:2px solid #E2E8F0;border-radius:10px;padding:14px 14px 12px;cursor:pointer;transition:border-color .15s,box-shadow .15s,background .15s;user-select:none;background:#fff}
.exp-mun-card:hover{border-color:#0D9488;box-shadow:0 2px 8px rgba(13,148,136,.14)}
.exp-mun-card--selected{border-color:#0D9488;background:#F0FDF4;box-shadow:0 0 0 1px #0D9488}
.exp-mun-card input[type=checkbox]{display:none}
/* Indicador check */
.exp-mun-card-check{width:18px;height:18px;border:2px solid #CBD5E1;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;background:#fff;transition:all .15s;font-size:12px;color:transparent;margin-bottom:9px}
.exp-mun-card--selected .exp-mun-card-check{background:#0D9488;border-color:#0D9488;color:#fff}
/* Nombre municipio */
.exp-mun-card-name{font-size:11.5px;font-weight:800;color:#0F172A;text-transform:uppercase;letter-spacing:.04em;line-height:1.25;margin-bottom:7px}
/* Meta datos */
.exp-mun-card-meta{font-size:11px;color:#64748B;line-height:1.85}
.exp-mun-card-meta b{color:#1E293B;font-weight:700}
/* Botones acciones rápidas */
.exp-quick-btn{background:none;border:1px solid #E2E8F0;border-radius:6px;padding:5px 14px;font-size:11.5px;font-weight:600;color:#475569;cursor:pointer;transition:all .15s;white-space:nowrap}
.exp-quick-btn:hover{border-color:#0D9488;color:#0D9488;background:#F0FDF4}
/* Barra de contadores */
.exp-counter-bar{display:flex;gap:0;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;background:#F8FAFC}
.exp-counter{flex:1;display:flex;flex-direction:column;align-items:center;padding:13px 8px;border-right:1px solid #E2E8F0}
.exp-counter:last-child{border-right:none}
.exp-counter-val{font-size:24px;font-weight:800;color:#0D9488;line-height:1}
.exp-counter-lbl{font-size:9.5px;color:#94A3B8;text-transform:uppercase;letter-spacing:.07em;margin-top:4px;font-weight:600}
/* Sección modo exportación */
.exp-mode-box{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px}
.exp-mode-opt{display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;padding:4px 0;color:#334155}
.exp-mode-opt input[type=radio]{accent-color:#0D9488;width:14px;height:14px}
.exp-mode-opt-sub{color:#94A3B8;font-size:11px;margin-left:22px;margin-top:-2px}
/* Footer */
.exp-footer{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:2px}
@media(max-width:540px){.exp-mun-grid{grid-template-columns:repeat(2,1fr)}.exp-counter-val{font-size:19px}}
@media(max-width:380px){.exp-quick-btn span.exp-btn-label{display:none}}
</style>
<div class="nm-pay-dialog" style="max-width:590px;border-radius:14px;overflow:hidden">
  <div class="exp-dialog-header">
    <div>
      <div style="font-size:16px;font-weight:800;color:#0F172A;line-height:1.2">Exportar Nómina</div>
      <div style="font-size:12px;color:#64748B;margin-top:4px">Seleccione los municipios que desea incluir en el archivo Excel.</div>
    </div>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal style="flex-shrink:0;margin-top:2px">&#10005;</button>
  </div>

  <div class="exp-dialog-body">
    ${posMunis.length > 0 ? `
    <!-- Acciones rápidas + etiqueta cargo -->
    <div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div class="exp-section-label" style="margin-bottom:0;flex:1">Cargo: <span style="color:#0D9488;font-style:normal">${escapeHtml(activePosition || "")}</span></div>
        <button class="exp-quick-btn" id="expSelAll"><span class="exp-btn-label">Seleccionar todos</span></button>
        <button class="exp-quick-btn" id="expSelNone"><span class="exp-btn-label">Limpiar selección</span></button>
      </div>
    </div>

    <!-- Tarjetas de municipios -->
    <div class="exp-mun-grid" id="expMuniGrid">
      ${posMunis.map((mun) => `
      <label class="exp-mun-card ${defaultSelected.has(String(mun.id)) ? "exp-mun-card--selected" : ""}">
        <input type="checkbox" class="exp-mun-cb" value="${mun.id}" ${defaultSelected.has(String(mun.id)) ? "checked" : ""}>
        <div class="exp-mun-card-check">${defaultSelected.has(String(mun.id)) ? "&#10003;" : ""}</div>
        <div class="exp-mun-card-name">${escapeHtml(mun.municipality_name)}</div>
        <div class="exp-mun-card-meta">
          <b>${mun.employees || 0}</b> empleados<br>
          <b>${mun.novelties || 0}</b> novedades
        </div>
      </label>`).join("")}
    </div>

    <!-- Barra de contadores en tiempo real -->
    <div class="exp-counter-bar">
      <div class="exp-counter">
        <div class="exp-counter-val" id="expCntMun">${defaultSelected.size}</div>
        <div class="exp-counter-lbl">Municipios seleccionados</div>
      </div>
      <div class="exp-counter">
        <div class="exp-counter-val" id="expCntEmp">${posMunis.filter(m=>defaultSelected.has(String(m.id))).reduce((s,m)=>s+Number(m.employees||0),0)}</div>
        <div class="exp-counter-lbl">Empleados incluidos</div>
      </div>
      <div class="exp-counter">
        <div class="exp-counter-val" id="expCntNov">${posMunis.filter(m=>defaultSelected.has(String(m.id))).reduce((s,m)=>s+Number(m.novelties||0),0)}</div>
        <div class="exp-counter-lbl">Novedades incluidas</div>
      </div>
    </div>

    <!-- Nota informativa -->
    <div style="font-size:11.5px;color:#64748B;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:7px;padding:9px 12px;line-height:1.55">
      &#128196; Incluye: Variables · Nómina · Novedades · Turnos · Resumen comparativo
      ${selectedItemIds.size > 0 && activeGroupId
        ? `<br><span style="color:#0D9488;font-weight:600">&#9745; ${selectedItemIds.size} colaborador${selectedItemIds.size !== 1 ? "es" : ""} seleccionado${selectedItemIds.size !== 1 ? "s" : ""} — se exportará el municipio completo que los contiene.</span>`
        : ""}</div>` : `
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:22px;font-size:13px;color:#64748B;text-align:center;line-height:1.7">
      No hay municipios disponibles para este cargo.<br>
      <span style="color:#94A3B8;font-size:12px">Calcula la nómina primero para ver los municipios disponibles.</span>
    </div>`}

    <!-- Botones finales -->
    <div class="exp-footer">
      <span id="expStatus" style="font-size:12px;color:#64748B;flex:1;min-width:60px"></span>
      <button class="nm-pay-btn nm-pay-btn--sm" id="expFullBtn" title="Exportar todos los cargos del período">&#127760; Todo el período</button>
      <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cancelar</button>
      <button class="nm-pay-btn nm-pay-btn--primary" id="expDoBtn"
              ${!defaultSelected.size ? "disabled" : ""}
              style="padding:7px 18px;font-size:13px">
        &#8595; Exportar ${defaultSelected.size} municipio${defaultSelected.size !== 1 ? "s" : ""} (${posMunis.filter(m=>defaultSelected.has(String(m.id))).reduce((s,m)=>s+Number(m.employees||0),0)} colaboradores)
      </button>
    </div>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();

  // ── Seleccionar / Limpiar todos ──────────────────────────────────────────
  document.getElementById("expSelAll")?.addEventListener("click", () => {
    document.querySelectorAll(".exp-mun-cb").forEach((cb) => { cb.checked = true; });
    updateExpCounters();
  });
  document.getElementById("expSelNone")?.addEventListener("click", () => {
    document.querySelectorAll(".exp-mun-cb").forEach((cb) => { cb.checked = false; });
    updateExpCounters();
  });

  // ── BUG FIX #1: clic en tarjeta — e.preventDefault() evita el doble toggle ─
  // La tarjeta ES un <label>. Sin preventDefault, el clic:
  //   1. Dispara el listener → cb.checked = !cb.checked
  //   2. El comportamiento nativo del <label> también hace cb.checked = !cb.checked
  // Resultado = doble toggle = sin cambio. La solución: cancelar el comportamiento
  // nativo y dejar que solo lo haga el listener.
  document.querySelectorAll(".exp-mun-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      e.preventDefault(); // ← esto corrige el doble-toggle
      const cb  = card.querySelector(".exp-mun-cb");
      const chk = card.querySelector(".exp-mun-card-check");
      if (cb) cb.checked = !cb.checked;
      if (chk) chk.innerHTML = cb?.checked ? "&#10003;" : "";
      updateExpCounters();
    });
  });

  // ── Función de descarga ──────────────────────────────────────────────────
  async function doExport(endpoint, filename) {
    const btn    = document.getElementById("expDoBtn");
    const full   = document.getElementById("expFullBtn");
    const status = document.getElementById("expStatus");
    if (btn)  btn.disabled  = true;
    if (full) full.disabled = true;
    if (status) status.textContent = "Generando archivo…";
    try {
      const token = state.token || localStorage.getItem("empiria_token") || "";
      const res   = await fetch(endpoint, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showError(err.message || "Error al exportar"); return;
      }
      const blob   = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a      = document.createElement("a");
      a.href = objUrl; a.download = filename; a.click();
      URL.revokeObjectURL(objUrl);
      closeModal();
      showSuccess("Exportación completada — " + filename);
    } catch (err) {
      showError(err.message || "Error al exportar");
    } finally {
      if (status) status.textContent = "";
      updateExpCounters(); // re-habilita botones si se mantiene el modal abierto
    }
  }

  // ── Confirmación previa a exportar municipios seleccionados ──────────────
  function confirmAndExport() {
    const checkedIds = [...document.querySelectorAll(".exp-mun-cb:checked")].map((cb) => cb.value);
    if (!checkedIds.length) { showError("Selecciona al menos un municipio antes de exportar."); return; }

    const selMunis  = posMunis.filter((m) => checkedIds.includes(String(m.id)));
    const munCount  = selMunis.length;
    const empCount  = selMunis.reduce((s, m) => s + Number(m.employees || 0), 0);
    const munNames  = selMunis.map((m) => m.municipality_name);
    const munList   = munNames.slice(0, 5).map((n) => `• ${n}`).join("<br>");
    const extra     = munNames.length > 5 ? `<br>• …y ${munNames.length - 5} más` : "";

    showConfirmModal(
      "Confirmar exportación",
      `Va a exportar la nómina de <b>${munCount} municipio${munCount !== 1 ? "s" : ""}</b>
       y <b>${empCount} colaborador${empCount !== 1 ? "es" : ""}</b>.<br><br>
       ${munList}${extra}<br><br>¿Desea continuar?`,
      () => {
        // Generar nombre de archivo con los primeros municipios
        const safeMuns = munNames.slice(0, 2).join("-").replace(/[^a-z0-9]/gi, "-");
        if (checkedIds.length === 1) {
          doExport(
            `/payroll/groups/${checkedIds[0]}/export`,
            `nomina-${safeLbl}-${safeMuns}.xlsx`
          );
        } else {
          doExport(
            `/payroll/groups/multi-export?groupIds=${checkedIds.join(",")}`,
            `nomina-${safeLbl}-${safeMuns}.xlsx`
          );
        }
      },
      { confirmLabel: `⬇ Exportar ${munCount} municipio${munCount !== 1 ? "s" : ""}` }
    );
  }

  // ── Exportar municipios seleccionados ─────────────────────────────────────
  document.getElementById("expDoBtn")?.addEventListener("click", confirmAndExport);

  // ── Exportar todo el período ──────────────────────────────────────────────
  document.getElementById("expFullBtn")?.addEventListener("click", () => {
    showConfirmModal(
      "Exportar período completo",
      `Va a exportar <b>todos los cargos y municipios</b> del período <b>${escapeHtml(periodLabel)}</b>.<br><br>
       Esto puede tardar unos segundos si el período es grande. ¿Desea continuar?`,
      () => {
        doExport(
          `/payroll/periods/${activePeriod.id}/full-export`,
          `nomina-completa-${safeLbl}.xlsx`
        );
      },
      { confirmLabel: "⬇ Exportar todo el período" }
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: calcular días automáticamente entre dos fechas
// ─────────────────────────────────────────────────────────────────────────────
function countBusinessDays(startStr, endStr) {
  if (!startStr || !endStr) return 1;
  const start = new Date(startStr + "T00:00:00Z");
  const end   = new Date(endStr   + "T00:00:00Z");
  if (end < start) return 1;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const d = cur.getUTCDay(); // 0=Dom, 6=Sab
    if (d >= 1 && d <= 5) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return Math.max(1, count);
}

function wireDateAutocalc(startId, endId, daysId) {
  const calc = () => {
    const s     = document.getElementById(startId)?.value;
    const e     = document.getElementById(endId)?.value;
    const daysEl = document.getElementById(daysId);
    if (!s || !e || !daysEl || daysEl._manualOverride) return;
    const isBiz = daysEl.dataset.mode === "biz";
    daysEl.value = isBiz
      ? countBusinessDays(s, e)
      : Math.max(1, Math.round((new Date(e) - new Date(s)) / 86400000) + 1);
  };
  document.getElementById(startId)?.addEventListener("change", calc);
  document.getElementById(endId)?.addEventListener("change",   calc);
  document.getElementById(daysId)?.addEventListener("input",   () => {
    const el = document.getElementById(daysId);
    if (el) el._manualOverride = true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL: CONFIGURACIÓN SALARIAL INDIVIDUAL (grupos consolidados, solo admins)
// ─────────────────────────────────────────────────────────────────────────────
async function openSalaryConfigModal(employeeId, employeeName, docNumber) {
  salaryCfgState = { employeeId, employeeName, docNumber, history: [], loading: true };
  const modal = document.getElementById("nmPayModal");
  if (!modal) return;
  modal.innerHTML = renderSalaryConfigModal();
  modal.removeAttribute("hidden");
  // Cargar historial
  try {
    const r = await apiFetch(`/payroll/employees/${employeeId}/salary-config`);
    salaryCfgState.history  = Array.isArray(r.data) ? r.data : [];
    salaryCfgState.loading  = false;
  } catch {
    salaryCfgState.history = [];
    salaryCfgState.loading = false;
  }
  modal.innerHTML = renderSalaryConfigModal();
  wireSalaryConfigModal();
}

function renderSalaryConfigModal() {
  const { employeeName, docNumber, history, loading } = salaryCfgState;
  const fmtCOP2 = (v) => Number(v || 0).toLocaleString("es-CO");
  return `
<div class="nm-pay-dialog" style="max-width:640px" id="nmSalaryCfgOverlay">
    <div class="nm-pay-dialog-h">
      <span>Configuración Salarial — ${escapeHtml(employeeName)} (${escapeHtml(docNumber)})</span>
      <button class="nm-pay-btn nm-pay-btn--sm" id="nmSalaryCfgClose">&#10005;</button>
    </div>
    <div class="nm-pay-dialog-b" style="padding:16px;display:flex;flex-direction:column;gap:16px">
      <p style="font-size:12px;color:#475569;margin:0">El salario configurado aquí se usa al calcular la nómina de este empleado. El historial se conserva para auditoría.</p>

      <form id="nmSalaryCfgForm" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#334155">Salario Base</label>
          <input type="number" id="scBaseSalary" min="0" step="1000" placeholder="Ej: 2000000" class="nm-pay-input" style="width:100%;margin-top:4px" required>
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#334155">Auxilio Transporte</label>
          <input type="number" id="scTransport" min="0" step="1000" placeholder="Ej: 200000" class="nm-pay-input" style="width:100%;margin-top:4px" value="0">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#334155">Tipo de Salario</label>
          <select id="scSalaryType" class="nm-pay-select" style="width:100%;margin-top:4px">
            <option value="mensual">Mensual</option>
            <option value="quincenal">Quincenal</option>
            <option value="semanal">Semanal</option>
            <option value="jornal">Jornal</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#334155">Fecha de Vigencia</label>
          <input type="date" id="scEffectiveDate" class="nm-pay-input" style="width:100%;margin-top:4px" value="${new Date().toISOString().slice(0,10)}" required>
        </div>
        <div style="grid-column:1/-1">
          <label style="font-size:11px;font-weight:700;color:#334155">Notas (opcional)</label>
          <input type="text" id="scNotes" class="nm-pay-input" style="width:100%;margin-top:4px" placeholder="Ej: Ajuste salarial 2026">
        </div>
        <div style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end">
          <button type="submit" class="nm-pay-btn nm-pay-btn--primary">Guardar Configuración</button>
        </div>
      </form>

      <div>
        <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:6px">Historial Salarial</div>
        ${loading
          ? `<div style="font-size:12px;color:#64748B">Cargando...</div>`
          : !history.length
            ? `<div style="font-size:12px;color:#94A3B8">Sin configuraciones previas. El sistema usará la tarifa de la categoría del cargo.</div>`
            : `<table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead>
                  <tr style="background:#F8FAFC">
                    <th style="padding:5px 8px;text-align:left;border-bottom:1px solid #E2E8F0">Vigencia</th>
                    <th style="padding:5px 8px;text-align:right;border-bottom:1px solid #E2E8F0">Salario Base</th>
                    <th style="padding:5px 8px;text-align:right;border-bottom:1px solid #E2E8F0">Aux. Transporte</th>
                    <th style="padding:5px 8px;border-bottom:1px solid #E2E8F0">Tipo</th>
                    <th style="padding:5px 8px;border-bottom:1px solid #E2E8F0">Notas</th>
                    <th style="padding:5px 8px;border-bottom:1px solid #E2E8F0"></th>
                  </tr>
                </thead>
                <tbody>
                  ${history.map((h) => `
                  <tr>
                    <td style="padding:5px 8px;border-bottom:1px solid #F1F5F9">${escapeHtml(String(h.effective_date || "").slice(0,10))}</td>
                    <td style="padding:5px 8px;text-align:right;border-bottom:1px solid #F1F5F9;font-weight:600">$${fmtCOP2(h.base_salary)}</td>
                    <td style="padding:5px 8px;text-align:right;border-bottom:1px solid #F1F5F9">$${fmtCOP2(h.transport_allowance)}</td>
                    <td style="padding:5px 8px;border-bottom:1px solid #F1F5F9">${escapeHtml(h.salary_type || "mensual")}</td>
                    <td style="padding:5px 8px;border-bottom:1px solid #F1F5F9;color:#64748B">${escapeHtml(h.notes || "")}</td>
                    <td style="padding:5px 8px;border-bottom:1px solid #F1F5F9">
                      <button class="nm-pay-btn nm-pay-btn--sm nm-pay-btn--danger" data-delete-salary-cfg="${h.id}" title="Eliminar esta entrada">&#128465;</button>
                    </td>
                  </tr>`).join("")}
                </tbody>
              </table>`}
      </div>
    </div>
  </div>`;
}

function wireSalaryConfigModal() {
  const closeSalaryModal = () => {
    const m = document.getElementById("nmPayModal");
    if (m) { m.innerHTML = ""; m.setAttribute("hidden", ""); }
  };
  document.getElementById("nmSalaryCfgClose")?.addEventListener("click", closeSalaryModal);
  // Cerrar al hacer click en el fondo del modal (nm-pay-modal)
  document.getElementById("nmPayModal")?.addEventListener("click", (e) => {
    if (e.target.id === "nmPayModal") closeSalaryModal();
  }, { once: true });
  document.getElementById("nmSalaryCfgForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const baseSalary    = Number(document.getElementById("scBaseSalary").value);
    const transport     = Number(document.getElementById("scTransport").value || 0);
    const salaryType    = document.getElementById("scSalaryType").value;
    const effectiveDate = document.getElementById("scEffectiveDate").value;
    const notes         = document.getElementById("scNotes").value.trim();
    if (!baseSalary || baseSalary <= 0) { showError("El salario base debe ser mayor a 0"); return; }
    try {
      await apiFetch(`/payroll/employees/${salaryCfgState.employeeId}/salary-config`, {
        method: "POST",
        body: JSON.stringify({ base_salary: baseSalary, transport_allowance: transport, salary_type: salaryType, effective_date: effectiveDate, notes }),
      });
      showSuccess("Configuración salarial guardada");
      await openSalaryConfigModal(salaryCfgState.employeeId, salaryCfgState.employeeName, salaryCfgState.docNumber);
    } catch (err) {
      showError(err.message || "Error al guardar");
    }
  });
  document.querySelectorAll("[data-delete-salary-cfg]").forEach((btn) => btn.addEventListener("click", async () => {
    const cfgId = Number(btn.dataset.deleteSalaryCfg);
    if (!confirm("¿Eliminar esta configuración salarial?")) return;
    try {
      await apiFetch(`/payroll/employee-salary-config/${cfgId}`, { method: "DELETE" });
      showSuccess("Configuración eliminada");
      await openSalaryConfigModal(salaryCfgState.employeeId, salaryCfgState.employeeName, salaryCfgState.docNumber);
    } catch (err) {
      showError(err.message || "Error al eliminar");
    }
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL: REGISTRAR NOVEDAD (selección múltiple de tipos)
// ─────────────────────────────────────────────────────────────────────────────
function openNoveltyModal(itemId) {
  const DATE_TYPES           = new Set(["FECHA_INGRESO", "FECHA_RETIRO", "CORRECCION_SEGURIDAD_SOCIAL"]);
  const RANGE_TYPES          = new Set(["INCAPACIDAD_MEDICA", "INCAPACIDAD_ACCIDENTE_LABORAL", "CALAMIDAD_FAMILIAR"]);
  const BUSINESS_RANGE_TYPES = new Set(["LUTO"]);
  const MULTI_PERIOD_TYPES   = new Set(["INCAPACIDAD_MEDICA","INCAPACIDAD_ACCIDENTE_LABORAL","PERMISOS_NO_REMUNERADOS","SUSPENSION","LICENCIA_MATERNIDAD_PATERNIDAD","CALAMIDAD_FAMILIAR"]);
  const SELECTABLE           = NOVELTY_TYPES.filter((t) => t.code !== "CAMBIO_OPERATIVO_COBERTURA");

  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<div class="nm-pay-dialog" style="max-width:600px;max-height:88vh;overflow-y:auto">
  <div class="nm-pay-dialog-h" style="position:sticky;top:0;z-index:10;background:#fff">
    <b>Registrar novedad(es)</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
  </div>
  <div class="nm-pay-dialog-b">
    <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">
      &#9745; Selecciona uno o varios tipos de novedad
    </div>
    <div class="nm-nov-multi-grid" id="novMultiGrid">
      ${SELECTABLE.map((t) => `
        <label class="nm-nov-multi-label" title="${escapeHtml(t.name)}">
          <input type="checkbox" class="nm-nov-multi-cb" value="${escapeHtml(t.code)}">
          <span class="nm-nov-multi-name">${escapeHtml(t.name)}</span>
        </label>`).join("")}
    </div>
    <div id="novMultiFields"></div>
    <div class="nm-pay-field" style="margin-top:10px">
      <label>Observaciones <small style="color:#94A3B8;font-weight:400">(aplica a todas)</small></label>
      <textarea class="nm-pay-textarea" id="novDesc" rows="2"></textarea>
    </div>
    <div id="novActions" style="margin-top:8px">
      <button class="nm-pay-btn nm-pay-btn--primary" id="novSave" disabled>
        Selecciona al menos un tipo
      </button>
    </div>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();

  // ── Render campos de fecha para un tipo ───────────────────────────────────
  function renderTypeFields(code) {
    const isDate   = DATE_TYPES.has(code);
    const isRange  = RANGE_TYPES.has(code) || BUSINESS_RANGE_TYPES.has(code);
    const isBiz    = BUSINESS_RANGE_TYPES.has(code);
    const isRetiro = code === "FECHA_RETIRO";
    const isIng    = code === "FECHA_INGRESO";
    const isCorrSS = code === "CORRECCION_SEGURIDAD_SOCIAL";

    if (isDate) {
      const lbl = isIng    ? "Fecha real de ingreso"
                : isCorrSS ? "Fecha de corrección SS"
                           : "Fecha real de retiro";
      const hlp = isIng    ? "La nómina se liquidará desde este día hasta el fin del período."
                : isCorrSS ? "Reemplaza la fecha de ingreso solo para el cálculo de días SS. No afecta días laborados ni salario."
                           : "La nómina se liquidará desde el inicio del período hasta este día.";
      return `
        <div class="nm-pay-field">
          <label>${lbl} <span style="color:#EF4444">*</span></label>
          <input class="nm-pay-input" type="date" id="mnf_date_${code}">
          <small style="color:#94A3B8">${hlp}</small>
        </div>
        ${isRetiro ? `<div class="nm-pay-field">
          <label>Motivo del retiro <span style="color:#EF4444">*</span></label>
          <select class="nm-pay-select" id="mnf_reason_${code}">
            <option value="">— Seleccione motivo —</option>
            <option value="disminucion_cupos">Disminución de cupos</option>
            <option value="renuncia">Renuncia</option>
            <option value="terminacion_contrato">Terminación de contrato</option>
          </select>
          <small style="color:#94A3B8">Determina si el puesto requiere reemplazo y cómo se calculan los Días SS.</small>
        </div>` : ""}`;
    }

    if (isRange) {
      const multiNote = MULTI_PERIOD_TYPES.has(code) && activePeriod?.period_end
        ? `<small style="color:#7C3AED;font-size:10px">&#8596; Multi-período: si la fecha fin supera el período, los días se transfieren al siguiente.</small>`
        : "";
      return `
        <div class="nm-pay-form-grid">
          <div class="nm-pay-field">
            <label>Fecha inicio <span style="color:#EF4444">*</span></label>
            <input class="nm-pay-input" type="date" id="mnf_start_${code}">
          </div>
          <div class="nm-pay-field">
            <label>Fecha fin <span style="color:#EF4444">*</span></label>
            <input class="nm-pay-input" type="date" id="mnf_end_${code}">
          </div>
          <div class="nm-pay-field">
            <label>${isBiz ? "Días hábiles (auto)" : "Días (auto)"}</label>
            <input class="nm-pay-input" type="number" min="1" value="1" id="mnf_days_${code}"
                   data-mode="${isBiz ? "biz" : ""}">
          </div>
        </div>${multiNote}`;
    }

    return `
      <div class="nm-pay-field">
        <label>Fecha de presentación <span style="color:#EF4444">*</span></label>
        <input class="nm-pay-input" type="date" id="mnf_date_${code}">
        <small style="color:#94A3B8">Se registra como 1 día de novedad.</small>
      </div>`;
  }

  // ── Reconstruir secciones al cambiar checkboxes ───────────────────────────
  function updateFields() {
    const checked   = [...document.querySelectorAll(".nm-nov-multi-cb:checked")].map((cb) => cb.value);
    const container = document.getElementById("novMultiFields");
    if (!container) return;

    container.innerHTML = checked.map((code) => {
      const nm = noveltyByCode(code);
      return `
<div class="nm-nov-multi-section">
  <div class="nm-nov-multi-section-hdr">
    <b>${escapeHtml(nm?.name || code)}</b>
    ${nm ? noveltyImpactNoticeHtml(nm) : ""}
  </div>
  <div class="nm-nov-multi-section-body">${renderTypeFields(code)}</div>
</div>`;
    }).join("");

    // Wire auto-calc para rangos
    checked.filter((c) => RANGE_TYPES.has(c) || BUSINESS_RANGE_TYPES.has(c)).forEach((code) => {
      wireDateAutocalc(`mnf_start_${code}`, `mnf_end_${code}`, `mnf_days_${code}`);
    });

    const btn = document.getElementById("novSave");
    if (btn) {
      btn.disabled = !checked.length;
      btn.textContent = checked.length > 1
        ? `Guardar ${checked.length} novedades seleccionadas`
        : checked.length === 1 ? "Guardar novedad" : "Selecciona al menos un tipo";
    }
  }

  // ── Recolectar cuerpos de todas las novedades seleccionadas ───────────────
  function collectMultiBodies() {
    const checked  = [...document.querySelectorAll(".nm-nov-multi-cb:checked")].map((cb) => cb.value);
    const obsText  = document.getElementById("novDesc")?.value || "";
    const bodies   = [];

    for (const code of checked) {
      const nm      = noveltyByCode(code);
      const label   = nm?.name || code;
      const isDate  = DATE_TYPES.has(code);
      const isRange = RANGE_TYPES.has(code) || BUSINESS_RANGE_TYPES.has(code);

      if (isDate) {
        const d = document.getElementById(`mnf_date_${code}`)?.value;
        if (!d) {
          const fldLbl = code === "FECHA_INGRESO" ? "ingreso" : code === "CORRECCION_SEGURIDAD_SOCIAL" ? "corrección SS" : "retiro";
          throw new Error(`[${label}] Ingrese la fecha de ${fldLbl}.`);
        }
        const body = { novelty_type: code, novelty_date: d, observations: obsText };
        if (code === "FECHA_RETIRO") {
          const r = document.getElementById(`mnf_reason_${code}`)?.value || "";
          if (!r) throw new Error(`[${label}] Seleccione el motivo del retiro.`);
          body.retirement_reason = r;
        }
        bodies.push(body);
      } else if (isRange) {
        const s = document.getElementById(`mnf_start_${code}`)?.value;
        const e = document.getElementById(`mnf_end_${code}`)?.value;
        const d = Number(document.getElementById(`mnf_days_${code}`)?.value);
        if (!s) throw new Error(`[${label}] Indique la fecha de inicio.`);
        if (!d || d < 1) throw new Error(`[${label}] Los días deben ser mayor a 0.`);
        if (e && e < s) throw new Error(`[${label}] La fecha fin no puede ser anterior al inicio.`);
        bodies.push({ novelty_type: code, start_date: s, end_date: e || s, days: d, observations: obsText });
      } else {
        const d = document.getElementById(`mnf_date_${code}`)?.value;
        if (!d) throw new Error(`[${label}] Indique la fecha de presentación.`);
        bodies.push({ novelty_type: code, start_date: d, end_date: d, days: 1, observations: obsText });
      }
    }
    return bodies;
  }

  // ── Guardar todas ─────────────────────────────────────────────────────────
  document.getElementById("novSave")?.addEventListener("click", async () => {
    let bodies;
    try { bodies = collectMultiBodies(); } catch (e) { showError(e.message); return; }
    if (!bodies.length) { showError("Selecciona al menos un tipo de novedad."); return; }

    const btn = document.getElementById("novSave");
    if (btn) { btn.disabled = true; btn.textContent = `Guardando ${bodies.length}…`; }

    let ok = 0;
    const errs = [];
    for (const b of bodies) {
      try {
        await apiFetch(`/payroll/items/${itemId}/novelties`, { method: "POST", body: JSON.stringify(b) });
        ok++;
      } catch (e) {
        errs.push(e.message);
      }
    }
    closeModal();
    await reloadWorkArea();
    if (!errs.length) {
      showSuccess(`${ok} novedad${ok !== 1 ? "es" : ""} registrada${ok !== 1 ? "s" : ""} correctamente.`);
    } else {
      showSuccess(`${ok} creada${ok !== 1 ? "s" : ""}. ${errs.length} con error: ${errs[0]}`);
    }
  });

  // ── Wire checkboxes ───────────────────────────────────────────────────────
  document.querySelectorAll(".nm-nov-multi-cb").forEach((cb) =>
    cb.addEventListener("change", updateFields)
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ZONA LEGACY: los métodos internos de la versión anterior ya no son
  // necesarios — el nuevo modal maneja todo con las funciones de arriba.
  // Se mantiene este bloque vacío para evitar que código externo que llamaba
  // a update() o wireSave() falle. Si no hay llamadas externas, se puede
  // eliminar en la próxima limpieza.
  // ─────────────────────────────────────────────────────────────────────────
  const MAX_BULK = 20; // eslint-disable-line no-unused-vars — referenciado en CSS legacy
}

// ─── FUNCIÓN LEGACY INTERNA — ya no usada, se conserva por seguridad ─────────
function _legacyNoveltyModalOld(itemId) {
  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<div class="nm-pay-dialog" style="max-width:520px">
  <div class="nm-pay-dialog-h">
    <b>Registrar novedad</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
  </div>
  <div class="nm-pay-dialog-b">
    <div class="nm-pay-field">
      <label>Tipo de novedad</label>
      <select class="nm-pay-select" id="novType">
        ${NOVELTY_TYPES.filter((t) => t.code !== "CAMBIO_OPERATIVO_COBERTURA")
          .map((t) => `<option value="${t.code}">${t.name}</option>`).join("")}
      </select>
    </div>
    <div id="novImpactInfo"></div>
    <div class="nm-pay-field" id="novQtyRow" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <label style="margin:0;white-space:nowrap;font-size:12px;font-weight:700;color:#475569">Cantidad de registros</label>
      <input class="nm-pay-input" id="novQty" type="number" min="1" max="${MAX_BULK}" value="1" style="width:70px">
      <small style="color:#94A3B8">máx. ${MAX_BULK}</small>
    </div>
    <div id="novDatesSection"></div>
    <div class="nm-pay-field">
      <label>Observaciones</label>
      <textarea class="nm-pay-textarea" id="novDesc" rows="2"></textarea>
    </div>
    <div id="novActions">
      <button class="nm-pay-btn nm-pay-btn--primary" id="novSave">Guardar novedad</button>
    </div>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();

  // ── Leer estado actual ────────────────────────────────────────────────────
  const getCode = () => document.getElementById("novType")?.value || "";
  const getQty  = () => {
    const v = parseInt(document.getElementById("novQty")?.value || "1", 10);
    return Math.max(1, Math.min(MAX_BULK, isNaN(v) ? 1 : v));
  };

  // ── Render de campos de fecha según tipo y cantidad ───────────────────────
  function renderDates(code, qty) {
    const section  = document.getElementById("novDatesSection");
    if (!section) return;
    const isRange  = RANGE_TYPES.has(code) || BUSINESS_RANGE_TYPES.has(code);
    const isBiz    = BUSINESS_RANGE_TYPES.has(code);
    const n        = DATE_TYPES.has(code) ? 1 : qty;

    if (DATE_TYPES.has(code)) {
      const isIng    = code === "FECHA_INGRESO";
      const isCorrSS = code === "CORRECCION_SEGURIDAD_SOCIAL";
      const dateLabel = isIng    ? "Fecha real de ingreso"
                      : isCorrSS ? "Fecha de corrección Seguridad Social"
                                 : "Fecha real de retiro";
      const dateHelp  = isIng    ? "La nómina se liquidará desde este día hasta el fin del período."
                      : isCorrSS ? "Reemplaza la fecha de ingreso solo para el cálculo de días SS. No afecta días laborados ni salario."
                                 : "La nómina se liquidará desde el inicio del período hasta este día.";
      section.innerHTML = `
<div class="nm-pay-field">
  <label>${dateLabel} <span style="color:#EF4444">*</span></label>
  <input class="nm-pay-input" id="novDate_0" type="date">
  <small style="color:#94A3B8">${dateHelp}</small>
</div>
${code === "FECHA_RETIRO" ? `
<div class="nm-pay-field">
  <label>Motivo del retiro <span style="color:#EF4444">*</span></label>
  <select class="nm-pay-select" id="novRetirementReason">
    <option value="">— Seleccione motivo —</option>
    <option value="disminucion_cupos">Disminución de cupos</option>
    <option value="renuncia">Renuncia</option>
    <option value="terminacion_contrato">Terminación de contrato</option>
  </select>
  <small style="color:#94A3B8">Determina si el puesto requiere reemplazo y cómo se calculan los Días SS.</small>
</div>` : ""}`;
      return;
    }

    if (isRange) {
      const daysLbl = isBiz
        ? `Días hábiles <small style="color:#94A3B8;font-weight:400">(lun–vie, auto)</small>`
        : `Días <small style="color:#94A3B8;font-weight:400">(auto)</small>`;
      let html = "";
      for (let i = 0; i < n; i++) {
        html += `
<div class="${n > 1 ? "nm-bulk-block" : ""}">
  ${n > 1 ? `<div class="nm-bulk-block-label">Registro ${i + 1}</div>` : ""}
  <div class="nm-pay-form-grid">
    <div class="nm-pay-field"><label>Fecha inicio <span style="color:#EF4444">*</span></label><input class="nm-pay-input" id="novStart_${i}" type="date"></div>
    <div class="nm-pay-field"><label>Fecha fin <span style="color:#EF4444">*</span></label><input class="nm-pay-input" id="novEnd_${i}" type="date"></div>
    <div class="nm-pay-field"><label>${daysLbl}</label><input class="nm-pay-input" id="novDays_${i}" type="number" min="1" value="1"></div>
  </div>
</div>`;
      }
      section.innerHTML = html;
      for (let i = 0; i < n; i++) {
        const dEl = document.getElementById(`novDays_${i}`);
        if (dEl) dEl.dataset.mode = isBiz ? "biz" : "";
        wireDateAutocalc(`novStart_${i}`, `novEnd_${i}`, `novDays_${i}`);
      }
      return;
    }

    // Aviso de cruce de período para tipos de rango multi-período
    if (isRange && n > 0) {
      const MULTI_TYPES = new Set([
        "INCAPACIDAD_MEDICA","INCAPACIDAD_ACCIDENTE_LABORAL",
        "PERMISOS_NO_REMUNERADOS","SUSPENSION",
        "LICENCIA_MATERNIDAD_PATERNIDAD","CALAMIDAD_FAMILIAR",
      ]);
      if (MULTI_TYPES.has(code) && activePeriod?.period_end) {
        // Adjuntar un listener que muestra el aviso si end_date cruza el período
        const pEnd = String(activePeriod.period_end).slice(0, 10);
        for (let i = 0; i < n; i++) {
          const endId = `novEnd_${i}`;
          setTimeout(() => {
            document.getElementById(endId)?.addEventListener("change", () => {
              const endVal = document.getElementById(endId)?.value;
              const warnId = `novCrossWarn_${i}`;
              let warnEl = document.getElementById(warnId);
              if (endVal && endVal > pEnd) {
                const startVal = document.getElementById(`novStart_${i}`)?.value;
                const daysInPeriod = startVal
                  ? Math.max(0, Math.round((new Date(pEnd) - new Date(startVal)) / 86400000) + 1)
                  : "?";
                const daysNext = Math.max(0, Math.round((new Date(endVal) - new Date(pEnd)) / 86400000));
                if (!warnEl) {
                  warnEl = document.createElement("div");
                  warnEl.id = warnId;
                  warnEl.style.cssText = "background:#FEF3C7;border:1px solid #FDE68A;border-radius:6px;padding:7px 10px;font-size:12px;color:#92400E;margin-top:4px";
                  document.getElementById(endId)?.parentElement?.appendChild(warnEl);
                }
                warnEl.innerHTML = `↔ <b>Multi-período:</b> ${daysInPeriod} d en este período · ${daysNext} d en el siguiente. El sistema los distribuirá automáticamente al calcular.`;
              } else if (warnEl) {
                warnEl.remove();
              }
            });
          }, 0);
        }
      }
    }

    // Tipos de fecha única (citas, permisos, citaciones…)
    if (n === 1) {
      section.innerHTML = `
<div class="nm-pay-field">
  <label>Fecha de presentación <span style="color:#EF4444">*</span></label>
  <input class="nm-pay-input" id="novSingle_0" type="date">
  <small style="color:#94A3B8">Se registra como 1 día de novedad.</small>
</div>`;
    } else {
      let rows = "";
      for (let i = 0; i < n; i++) {
        rows += `<div class="nm-bulk-single-row">
  <span class="nm-bulk-single-label">Fecha ${i + 1}</span>
  <input class="nm-pay-input" id="novSingle_${i}" type="date">
</div>`;
      }
      section.innerHTML = `<div class="nm-bulk-singles">${rows}</div>`;
    }
  }

  // ── Actualización completa del modal (tipo/cantidad cambiaron) ────────────
  function update() {
    const code   = getCode();
    const isDate = DATE_TYPES.has(code);
    const qty    = getQty();
    const n      = isDate ? 1 : qty;

    // Visibilidad del campo cantidad
    const qtyRow = document.getElementById("novQtyRow");
    if (qtyRow) qtyRow.hidden = isDate;

    // Impacto
    const meta  = noveltyByCode(code);
    const impEl = document.getElementById("novImpactInfo");
    if (impEl) impEl.innerHTML = meta ? noveltyImpactNoticeHtml(meta) : "";

    // Campos de fecha
    renderDates(code, qty);

    // Restaurar botón principal (por si venimos de pantalla de confirmación)
    const actEl = document.getElementById("novActions");
    if (actEl) {
      actEl.innerHTML = `<button class="nm-pay-btn nm-pay-btn--primary" id="novSave">${n > 1 ? `Continuar → ${n} registros` : "Guardar novedad"}</button>`;
    }

    wireSave();
  }

  // ── Recolectar y validar todos los cuerpos ────────────────────────────────
  function collectBodies() {
    const code    = getCode();
    const qty     = DATE_TYPES.has(code) ? 1 : getQty();
    const obsText = document.getElementById("novDesc")?.value || "";
    const bodies  = [];
    const seen    = new Set();

    if (DATE_TYPES.has(code)) {
      const d = document.getElementById("novDate_0")?.value;
      const dateLabel = code === "FECHA_INGRESO"              ? "ingreso"
                      : code === "CORRECCION_SEGURIDAD_SOCIAL" ? "corrección SS"
                                                               : "retiro";
      if (!d) throw new Error(`Ingrese la fecha de ${dateLabel}.`);
      const body = { novelty_type: code, novelty_date: d, observations: obsText };
      if (code === "FECHA_RETIRO") {
        const r = document.getElementById("novRetirementReason")?.value || "";
        if (!r) throw new Error("Seleccione el motivo del retiro.");
        body.retirement_reason = r;
      }
      return [body];
    }

    const isRange = RANGE_TYPES.has(code) || BUSINESS_RANGE_TYPES.has(code);
    for (let i = 0; i < qty; i++) {
      const lbl = qty > 1 ? `Registro ${i + 1}: ` : "";
      if (isRange) {
        const s = document.getElementById(`novStart_${i}`)?.value;
        const e = document.getElementById(`novEnd_${i}`)?.value;
        const d = Number(document.getElementById(`novDays_${i}`)?.value);
        if (!s) throw new Error(`${lbl}Indique la fecha de inicio.`);
        if (!d || d < 1) throw new Error(`${lbl}Los días deben ser mayor a 0.`);
        if (e && e < s) throw new Error(`${lbl}La fecha fin no puede ser anterior a la fecha inicio.`);
        const key = `${s}|${e || s}`;
        if (seen.has(key)) throw new Error(`Fechas duplicadas en el registro ${i + 1}.`);
        seen.add(key);
        bodies.push({ novelty_type: code, start_date: s, end_date: e || s, days: d, observations: obsText });
      } else {
        const d = document.getElementById(`novSingle_${i}`)?.value;
        if (!d) throw new Error(`${lbl}Indique la fecha de presentación.`);
        if (seen.has(d)) throw new Error(`Fecha ${d} ya ingresada en otro registro.`);
        seen.add(d);
        bodies.push({ novelty_type: code, start_date: d, end_date: d, days: 1, observations: obsText });
      }
    }
    return bodies;
  }

  // ── Pantalla de confirmación ───────────────────────────────────────────────
  function showConfirm(bodies) {
    const code    = getCode();
    const nm      = noveltyByCode(code);
    const novName = nm?.name || code;
    const isRange = RANGE_TYPES.has(code) || BUSINESS_RANGE_TYPES.has(code);

    const items = bodies.map((b) => {
      if (isRange) {
        const s = fmtDateDMY(b.start_date), e = fmtDateDMY(b.end_date);
        return `<li>${escapeHtml(novName)} — ${s === e ? s : `${s} al ${e}`} · ${b.days} día${b.days !== 1 ? "s" : ""}</li>`;
      }
      return `<li>${escapeHtml(novName)} — ${fmtDateDMY(b.start_date)}</li>`;
    }).join("");

    document.getElementById("novDatesSection").innerHTML = `
<div class="nm-bulk-summary">
  <div class="nm-bulk-summary-title">&#10003; Resumen de creación</div>
  <ul class="nm-bulk-summary-list">${items}</ul>
  <div class="nm-bulk-summary-total">Total a crear: <b>${bodies.length}</b> novedad${bodies.length !== 1 ? "es" : ""}</div>
</div>`;

    document.getElementById("novActions").innerHTML = `
<div style="display:flex;gap:8px;flex-wrap:wrap">
  <button class="nm-pay-btn nm-pay-btn--sm" id="novBack">← Volver</button>
  <button class="nm-pay-btn nm-pay-btn--primary" id="novConfirm">&#10003; Confirmar — crear ${bodies.length} novedad${bodies.length !== 1 ? "es" : ""}</button>
</div>`;

    document.getElementById("novBack")?.addEventListener("click", update);

    let _busy = false;
    document.getElementById("novConfirm")?.addEventListener("click", async () => {
      if (_busy) return;
      _busy = true;
      const btn = document.getElementById("novConfirm");
      if (btn) { btn.disabled = true; btn.textContent = `Creando ${bodies.length}…`; }
      let ok = 0;
      const errs = [];
      for (const b of bodies) {
        try {
          await apiFetch(`/payroll/items/${itemId}/novelties`, { method: "POST", body: JSON.stringify(b) });
          ok++;
        } catch (e) {
          errs.push(e.message);
        }
      }
      closeModal();
      await reloadWorkArea();
      if (!errs.length) {
        showSuccess(`${ok} novedad${ok !== 1 ? "es" : ""} registrada${ok !== 1 ? "s" : ""}`);
      } else {
        showSuccess(`${ok} creada${ok !== 1 ? "s" : ""}. Error en ${errs.length}: ${errs[0]}`);
      }
    });
  }

  // ── Botón principal (guardar o continuar) ─────────────────────────────────
  function wireSave() {
    const btn = document.getElementById("novSave");
    if (!btn) return;
    btn.onclick = async () => {
      let bodies;
      try { bodies = collectBodies(); } catch (e) { showError(e.message); return; }

      if (bodies.length === 1) {
        btn.disabled = true; btn.textContent = "Guardando…";
        try {
          await apiFetch(`/payroll/items/${itemId}/novelties`, { method: "POST", body: JSON.stringify(bodies[0]) });
          closeModal();
          await reloadWorkArea();
          showSuccess("Novedad registrada");
        } catch (e) {
          showError(e.message);
          btn.disabled = false;
          btn.textContent = "Guardar novedad";
        }
      } else {
        showConfirm(bodies);
      }
    };
  }

  document.getElementById("novType")?.addEventListener("change", update);
  document.getElementById("novQty")?.addEventListener("input", () => {
    const el = document.getElementById("novQty");
    if (el) {
      const v = parseInt(el.value, 10);
      if (isNaN(v) || v < 1) el.value = 1;
      else if (v > MAX_BULK) el.value = MAX_BULK;
    }
    update();
  });
  update();
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

  const DATE_TYPES           = new Set(["FECHA_INGRESO", "FECHA_RETIRO", "CORRECCION_SEGURIDAD_SOCIAL"]);
  const RANGE_TYPES          = new Set(["INCAPACIDAD_MEDICA", "INCAPACIDAD_ACCIDENTE_LABORAL", "CALAMIDAD_FAMILIAR"]);
  const BUSINESS_RANGE_TYPES = new Set(["LUTO"]);
  const code0                = novelty.novelty_type;
  const isDate0              = DATE_TYPES.has(code0);
  const isRange0             = RANGE_TYPES.has(code0) || BUSINESS_RANGE_TYPES.has(code0);
  // Para novedades multi-período mostrar las fechas originales, no las recortadas
  const startVal = String(novelty.original_start_date || novelty.start_date || "").slice(0, 10);
  const endVal   = String(novelty.original_end_date   || novelty.end_date   || "").slice(0, 10);

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
        ${NOVELTY_TYPES.filter((t) => t.code !== "CAMBIO_OPERATIVO_COBERTURA").map((t) => `<option value="${t.code}" ${t.code === code0 ? "selected" : ""}>${t.name}</option>`).join("")}
      </select>
    </div>
    <div id="novImpactInfo"></div>

    ${novelty.is_continuation ? `
    <div style="background:#EEF2FF;border:1px solid #C7D2FE;border-radius:6px;padding:8px 12px;font-size:12px;color:#3730A3">
      <b>↩ Continuación automática</b> — Esta novedad fue generada por el sistema a partir de
      una novedad de <b>${escapeHtml(novelty.novelty_name || novelty.novelty_type || "")}</b>
      registrada en el período anterior (${fmtDateDMY(novelty.original_start_date)} al ${fmtDateDMY(novelty.original_end_date)}).
      Para modificar las fechas, edite la novedad original en el período donde se creó.
    </div>` : novelty.original_end_date ? `
    <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:6px;padding:8px 12px;font-size:12px;color:#92400E">
      <b>↔ Novedad multi-período</b> — Abarca del ${fmtDateDMY(novelty.original_start_date || novelty.start_date)}
      al ${fmtDateDMY(novelty.original_end_date)}.
      Los días del período siguiente se cargarán automáticamente al calcular esa nómina.
      Puede editar la fecha fin aquí; el sistema recalculará la distribución.
    </div>` : ""}

    <!-- Sección 1: fecha exacta — FECHA_INGRESO, FECHA_RETIRO, CORRECCION_SEGURIDAD_SOCIAL -->
    <div id="novDateSection" ${isDate0 ? "" : "hidden"}>
      <div class="nm-pay-field">
        <label id="novDateLabel">${
          code0 === "FECHA_INGRESO"              ? "Fecha real de ingreso" :
          code0 === "CORRECCION_SEGURIDAD_SOCIAL" ? "Fecha de corrección Seguridad Social" :
          "Fecha real de retiro"} <span style="color:#EF4444">*</span></label>
        <input class="nm-pay-input" id="novDate" type="date" value="${escapeHtml(startVal)}">
        <small id="novDateHelp" style="color:#94A3B8">${
          code0 === "FECHA_INGRESO"              ? "La nómina se liquidará desde este día hasta el fin del período." :
          code0 === "CORRECCION_SEGURIDAD_SOCIAL" ? "Reemplaza la fecha de ingreso solo para el cálculo de días SS. No afecta días laborados ni salario." :
          "La nómina se liquidará desde el inicio del período hasta este día."}</small>
      </div>
    </div>

    <!-- Sección motivo retiro — solo FECHA_RETIRO -->
    <div id="novRetirementSection" ${code0 === "FECHA_RETIRO" ? "" : "hidden"}>
      <div class="nm-pay-field">
        <label>Motivo del retiro <span style="color:#EF4444">*</span></label>
        <select class="nm-pay-select" id="novRetirementReason">
          <option value="">— Seleccione motivo —</option>
          <option value="disminucion_cupos" ${novelty.retirement_reason === "disminucion_cupos" ? "selected" : ""}>Disminución de cupos</option>
          <option value="renuncia" ${novelty.retirement_reason === "renuncia" ? "selected" : ""}>Renuncia</option>
          <option value="terminacion_contrato" ${novelty.retirement_reason === "terminacion_contrato" ? "selected" : ""}>Terminación de contrato</option>
        </select>
        <small style="color:#94A3B8">Determina si el puesto requiere reemplazo y cómo se calculan los Días SS.</small>
      </div>
    </div>

    <!-- Sección 2: rango de fechas — incapacidades, calamidad, luto -->
    <div id="novRangeSection" ${isRange0 ? "" : "hidden"}>
      <div class="nm-pay-form-grid">
        <div class="nm-pay-field"><label>Fecha inicio <span style="color:#EF4444">*</span></label><input class="nm-pay-input" id="novStart" type="date" value="${escapeHtml(startVal)}"></div>
        <div class="nm-pay-field"><label>Fecha fin <span style="color:#EF4444">*</span></label><input class="nm-pay-input" id="novEnd" type="date" value="${escapeHtml(endVal)}"></div>
        <div class="nm-pay-field">
          <label id="novDaysLabel">${BUSINESS_RANGE_TYPES.has(code0) ? `Días hábiles <small style="color:#94A3B8;font-weight:400">(lun–vie, auto)</small>` : `Días <small style="color:#94A3B8;font-weight:400">(auto)</small>`}</label>
          <input class="nm-pay-input" id="novDays" type="number" min="1" value="${Number(novelty.days || 1)}" data-mode="${BUSINESS_RANGE_TYPES.has(code0) ? "biz" : ""}">
        </div>
      </div>
    </div>

    <!-- Sección 3: fecha de presentación — todos los demás -->
    <div id="novSingleSection" ${!isDate0 && !isRange0 ? "" : "hidden"}>
      <div class="nm-pay-field">
        <label>Fecha de presentación <span style="color:#EF4444">*</span></label>
        <input class="nm-pay-input" id="novSingle" type="date" value="${escapeHtml(startVal)}">
        <small style="color:#94A3B8">Se registra como 1 día de novedad.</small>
      </div>
    </div>

    <div class="nm-pay-field"><label>Observaciones</label><textarea class="nm-pay-textarea" id="novDesc">${escapeHtml(novelty.description || novelty.observations || "")}</textarea></div>
    <button class="nm-pay-btn nm-pay-btn--primary" id="novSave">Guardar cambios</button>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();
  wireDateAutocalc("novStart", "novEnd", "novDays");

  const showSection = (code) => {
    const isDate   = DATE_TYPES.has(code);
    const isRange  = RANGE_TYPES.has(code) || BUSINESS_RANGE_TYPES.has(code);
    const isBiz    = BUSINESS_RANGE_TYPES.has(code);
    const isSingle = !isDate && !isRange;
    document.getElementById("novDateSection").hidden       = !isDate;
    document.getElementById("novRangeSection").hidden      = !isRange;
    document.getElementById("novSingleSection").hidden     = !isSingle;
    document.getElementById("novRetirementSection").hidden = (code !== "FECHA_RETIRO");
    const daysEl = document.getElementById("novDays");
    if (daysEl) {
      daysEl.dataset.mode    = isBiz ? "biz" : "";
      daysEl._manualOverride = false;
    }
    const daysLabel = document.getElementById("novDaysLabel");
    if (daysLabel) {
      daysLabel.innerHTML = isBiz
        ? `Días hábiles <small style="color:#94A3B8;font-weight:400">(lun–vie, auto)</small>`
        : `Días <small style="color:#94A3B8;font-weight:400">(auto)</small>`;
    }
    const dateLabel = document.getElementById("novDateLabel");
    const dateHelp  = document.getElementById("novDateHelp");
    if (isDate && dateLabel && dateHelp) {
      const lbl = code === "FECHA_INGRESO"              ? "Fecha real de ingreso"
                : code === "CORRECCION_SEGURIDAD_SOCIAL" ? "Fecha de corrección Seguridad Social"
                                                         : "Fecha real de retiro";
      const hlp = code === "FECHA_INGRESO"              ? "La nómina se liquidará desde este día hasta el fin del período."
                : code === "CORRECCION_SEGURIDAD_SOCIAL" ? "Reemplaza la fecha de ingreso solo para el cálculo de días SS. No afecta días laborados ni salario."
                                                         : "La nómina se liquidará desde el inicio del período hasta este día.";
      dateLabel.innerHTML  = `${lbl} <span style="color:#EF4444">*</span>`;
      dateHelp.textContent = hlp;
    }
  };

  const updateImpact = () => {
    const code = document.getElementById("novType")?.value;
    const meta = noveltyByCode(code);
    const el   = document.getElementById("novImpactInfo");
    if (el && meta) el.innerHTML = noveltyImpactNoticeHtml(meta);
    if (code) showSection(code);
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
      const code    = document.getElementById("novType").value;
      const obsText = document.getElementById("novDesc").value;
      let body;

      if (DATE_TYPES.has(code)) {
        const noveltyDate = document.getElementById("novDate").value;
        const dateLbl = code === "FECHA_INGRESO"              ? "ingreso"
                      : code === "CORRECCION_SEGURIDAD_SOCIAL" ? "corrección SS"
                                                               : "retiro";
        if (!noveltyDate) { showError(`Ingrese la fecha exacta de ${dateLbl}.`); return; }
        body = { novelty_type: code, novelty_date: noveltyDate, description: obsText };
        if (code === "FECHA_RETIRO") {
          const retirementReason = document.getElementById("novRetirementReason")?.value || "";
          if (!retirementReason) { showError("Seleccione el motivo del retiro."); return; }
          body.retirement_reason = retirementReason;
        }

      } else if (RANGE_TYPES.has(code)) {
        const startDate = document.getElementById("novStart").value;
        if (!startDate) { showError("Indique la fecha de inicio."); return; }
        const days = Number(document.getElementById("novDays").value);
        if (!days || days < 1) { showError("Los días deben ser mayor a 0."); return; }
        body = { novelty_type: code, start_date: startDate, end_date: document.getElementById("novEnd").value || startDate, days, description: obsText };

      } else {
        const singleDate = document.getElementById("novSingle").value;
        if (!singleDate) { showError("Indique la fecha de presentación de la novedad."); return; }
        body = { novelty_type: code, start_date: singleDate, end_date: singleDate, days: 1, description: obsText };
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
  const originItem = employees.find((e) => Number(e.id) === Number(itemId));
  const originCategory = novelty.origin_salary_category || originItem?.salary_category || "—";
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
        <label>Valor día <small style="color:#94A3B8;font-weight:400">(calculado automáticamente)</small></label>
        <input class="nm-pay-input" id="coverValueDay" type="text" value="${novelty.replacement_value_per_day ? fmtCOP(Number(novelty.replacement_value_per_day)) : "Se calculará al guardar"}" readonly>
        <small style="color:#64748B">Categoría aplicada: <b>${escapeHtml(originCategory)}</b></small>
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

  // Cuando la nómina está cerrada: solo coberturas externas
  const closedGroup = isGroupClosed(activeGroupDetail?.group);
  if (closedGroup) {
    const typeEl = document.getElementById("coverType");
    if (typeEl) {
      typeEl.value = "EXTERNA";
      const internaOpt = typeEl.querySelector('option[value="INTERNA"]');
      if (internaOpt) {
        internaOpt.disabled = true;
        internaOpt.text = "Personal interno (no disponible — nómina cerrada)";
      }
    }
    document.getElementById("coverSectionInterna").hidden = true;
    document.getElementById("coverSectionExterna").hidden = false;
    const noticeEl = document.createElement("div");
    noticeEl.style.cssText = "background:#FEF3C7;border:1px solid #FDE68A;border-radius:6px;padding:8px 12px;font-size:12px;color:#92400E;margin-bottom:4px";
    noticeEl.innerHTML = "&#9888; <b>Nómina cerrada.</b> Solo se permiten coberturas de personal externo. La liquidación queda protegida.";
    document.querySelector("#nmPayModal .nm-pay-dialog-b")?.prepend(noticeEl);
  }

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
      if (days > Number(novelty.days || 0)) {
        showError("Los días cubiertos no pueden superar los días de incapacidad");
        return;
      }

      const body = { cover_type: coverType, days };

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

  // ── REPORTE DE NOVEDADES ─────────────────────────────────────────────────
  // CORRECCION_SEGURIDAD_SOCIAL es un ajuste técnico interno — no se muestra al empleado
  const INTERNAL_NOVELTY_TYPES = new Set(["CAMBIO_OPERATIVO_COBERTURA", "CORRECCION_SEGURIDAD_SOCIAL"]);
  let novSectionHtml = "";
  const allNovs = (data.novelties || []).filter((n) => !INTERNAL_NOVELTY_TYPES.has(n.novelty_type));
  if (!cambio_operativo && allNovs.length) {
    const byType = {};
    allNovs.forEach((n) => {
      const key = n.novelty_type;
      if (!byType[key]) byType[key] = { name: n.novelty_name || n.novelty_type, totalDays: 0 };
      byType[key].totalDays += Number(n.days || 0);
    });
    const rows = Object.values(byType).map((g) =>
      `<div class="nov-type-block"><div class="nov-type-name">&#8226; ${escapeHtml(g.name)}: ${g.totalDays} día${g.totalDays !== 1 ? "s" : ""}</div></div>`
    ).join("");
    novSectionHtml = `<div class="section"><div class="section-h">Novedades aplicadas</div>${rows}</div>`;
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

  const performedCoverHtmlDoc = (performed_covers || []).map((c) =>
    `<div class="row"><span>Reemplazo — ${escapeHtml(c.covered_employee_name || "Empleado")} (${c.days}d)</span><b>+${fmt(c.total_value)}</b></div>`
  ).join("");
  const coverDiscountHtmlDoc = (covers || []).map((c) =>
    `<div class="row"><span>Turno cubierto — ${escapeHtml(c.cover_type || "")} · ${escapeHtml(c.covered_salary_category || c.origin_category || "—")} (${c.days}d)</span><b>-${fmt(c.total_value)}</b></div>`
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
  .nov-type-block{padding:8px 20px;border-top:1px solid #F1F5F9;page-break-inside:avoid}
  .nov-type-name{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#1E293B;margin-bottom:5px}
  .nov-type-name--sal{color:#B91C1C}
  .nov-type-name--tra{color:#B45309}
  .nov-date-list{padding-left:4px}
  .nov-date-entry{padding:2px 0;page-break-inside:avoid}
  .nov-date-bullet{font-size:12px;color:#334155}
  .nov-date-obs{font-size:11px;color:#64748B;padding-left:14px}
  .cambio-label{padding:8px 20px 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#7C3AED}
  .row.cambio{border-left:3px solid #DDD6FE;padding-left:17px;margin-left:20px}
  .slip-footer{padding:10px 20px;font-size:11px;color:#94A3B8;text-align:center}
  @media print{body{padding:0}.slip{border:none;border-radius:0;max-width:100%;overflow:visible}}
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
    ${coverDiscountHtmlDoc}
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

    // ── REPORTE DE NOVEDADES (modal) ─────────────────────────────────────────
    // CORRECCION_SEGURIDAD_SOCIAL es un ajuste técnico interno — no se muestra al empleado
    const INTERNAL_NOVELTY_TYPES = new Set(["CAMBIO_OPERATIVO_COBERTURA", "CORRECCION_SEGURIDAD_SOCIAL"]);
    let novSectionHtml = "";
    const allNovs = (data.novelties || []).filter((n) => !INTERNAL_NOVELTY_TYPES.has(n.novelty_type));
    if (!cambio_operativo && allNovs.length) {
      const byType = {};
      allNovs.forEach((n) => {
        const key = n.novelty_type;
        if (!byType[key]) byType[key] = { name: n.novelty_name || n.novelty_type, totalDays: 0 };
        byType[key].totalDays += Number(n.days || 0);
      });
      const novRows = Object.values(byType).map((g) =>
        `<div class="nm-slip-row"><span>&#8226; ${escapeHtml(g.name)}: ${g.totalDays} día${g.totalDays !== 1 ? "s" : ""}</span></div>`
      ).join("");
      novSectionHtml = `
        <div class="nm-slip-section">
          <div class="nm-slip-section-h">Novedades aplicadas</div>
          ${novRows}
        </div>`;
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

    const performedCoverHtml = (data.performed_covers || []).map((c) => `
      <div class="nm-slip-row">
        <span>Reemplazo — ${escapeHtml(c.covered_employee_name || "Empleado")} (${c.days}d)</span>
        <b>+${fmt(c.total_value)}</b>
      </div>`).join("");
    const coverDiscountHtml = (data.covers || []).map((c) => `
      <div class="nm-slip-row">
        <span>Turno cubierto — ${escapeHtml(c.cover_type || "")} · ${escapeHtml(c.covered_salary_category || c.origin_category || "—")} (${c.days}d)</span>
        <b>-${fmt(c.total_value)}</b>
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
      ${coverDiscountHtml}
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

// ─────────────────────────────────────────────────────────────────────────────
// WIRE DE BOTONES DE BARRA MASIVA (re-wirable sin render() completo)
// ─────────────────────────────────────────────────────────────────────────────
function wireStaticBulkEvents() {
  document.getElementById("nmBulkReview")?.addEventListener("click", bulkMarkReviewed);
  document.getElementById("nmBulkUnreview")?.addEventListener("click", bulkUnmarkReviewed);
  document.getElementById("nmBulkClear")?.addEventListener("click", () => { selectedItemIds.clear(); render(); });
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCIONES MASIVAS DE REVISIÓN
// ─────────────────────────────────────────────────────────────────────────────
async function bulkMarkReviewed() {
  const items       = activeGroupDetail?.items || [];
  const pendingIds  = [...selectedItemIds].filter((id) => {
    const item = items.find((i) => i.id === id);
    return item && !item.reviewed;
  });
  const count = pendingIds.length;
  if (!count) { showError("No hay colaboradores pendientes seleccionados."); return; }

  showConfirmModal(
    "Revisión masiva",
    `Va a marcar como revisados <b>${count} colaborador${count !== 1 ? "es" : ""}</b>.<br><br>
     Los registros quedarán <b>bloqueados para edición</b>. Solo podrá ver sus desprendibles.<br><br>
     ¿Desea continuar?`,
    async () => {
      let ok = 0;
      const errs = [];
      for (const id of pendingIds) {
        try {
          await apiFetch(`/payroll/items/${id}/reviewed`, {
            method: "PATCH",
            body: JSON.stringify({ reviewed: true }),
          });
          ok++;
        } catch (e) {
          errs.push(e.message);
        }
      }
      selectedItemIds.clear();
      await reloadDetailOnly();
      if (!errs.length) {
        showSuccess(`${ok} colaborador${ok !== 1 ? "es" : ""} marcado${ok !== 1 ? "s" : ""} como revisado${ok !== 1 ? "s" : ""}.`);
      } else {
        showSuccess(`${ok} revisado${ok !== 1 ? "s" : ""}. ${errs.length} con error: ${errs[0]}`);
      }
    },
    { confirmLabel: `Confirmar — revisar ${count}` }
  );
}

async function bulkUnmarkReviewed() {
  const items       = activeGroupDetail?.items || [];
  const reviewedIds = [...selectedItemIds].filter((id) => {
    const item = items.find((i) => i.id === id);
    return item && item.reviewed;
  });
  const count = reviewedIds.length;
  if (!count) { showError("No hay colaboradores revisados seleccionados."); return; }

  // Modal de confirmación con campo de motivo integrado
  // (el backend exige motivo al desmarcar revisión)
  const modal = document.getElementById("nmPayModal");
  modal.innerHTML = `
<div class="nm-pay-dialog" style="max-width:460px">
  <div class="nm-pay-dialog-h">
    <b>Desmarcar revisión masiva</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cancelar</button>
  </div>
  <div class="nm-pay-dialog-b" style="gap:14px">
    <div style="padding:12px 14px;background:#FEF2F2;border:1px solid #FECACA;border-radius:7px;color:#991B1B;font-size:13px;line-height:1.6">
      Va a desmarcar la revisión de <b>${count} registro${count !== 1 ? "s" : ""}</b>.<br>
      Los registros quedarán <b>desbloqueados para edición</b>.<br>¿Desea continuar?
    </div>
    <div class="nm-pay-field">
      <label>Motivo del desbloqueo <span style="color:#EF4444">*</span></label>
      <textarea class="nm-pay-textarea" id="nmBulkUnreviewReason" rows="2"
                placeholder="Describe el motivo para quitar la revisión…" style="resize:vertical"></textarea>
      <small style="color:#94A3B8">Requerido. Se registrará en auditoría para todos los registros afectados.</small>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cancelar</button>
      <button class="nm-pay-btn nm-pay-btn--sm" id="nmBulkUnreviewConfirm"
              style="background:#B91C1C;color:#fff;border-color:#B91C1C">
        Desmarcar ${count} registro${count !== 1 ? "s" : ""}
      </button>
    </div>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();

  document.getElementById("nmBulkUnreviewConfirm")?.addEventListener("click", async () => {
    const reason = (document.getElementById("nmBulkUnreviewReason")?.value || "").trim();
    if (!reason) {
      document.getElementById("nmBulkUnreviewReason")?.focus();
      showError("El motivo es obligatorio para desbloquear registros de nómina.");
      return;
    }
    const btn = document.getElementById("nmBulkUnreviewConfirm");
    if (btn) { btn.disabled = true; btn.textContent = `Desbloqueando ${count}…`; }

    let ok = 0;
    const errs = [];
    for (const id of reviewedIds) {
      try {
        await apiFetch(`/payroll/items/${id}/reviewed`, {
          method: "PATCH",
          body: JSON.stringify({ reviewed: false, reason }),
        });
        ok++;
      } catch (e) {
        errs.push(e.message);
      }
    }
    closeModal();
    selectedItemIds.clear();
    await reloadDetailOnly();
    if (!errs.length) {
      showSuccess(`${ok} registro${ok !== 1 ? "s" : ""} desbloqueado${ok !== 1 ? "s" : ""} correctamente.`);
    } else {
      showSuccess(`${ok} desbloqueado${ok !== 1 ? "s" : ""}. ${errs.length} con error: ${errs[0]}`);
    }
  });
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
    document.getElementById("nmGoSupTab")?.addEventListener("click", () => {
      closeModal();
      activeDetailTab = "soportes";
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

// ─────────────────────────────────────────────────────────────────────────────
// PESTAÑA SOPORTES INLINE (dentro del detalle de grupo)
// ─────────────────────────────────────────────────────────────────────────────
function supportTypeName(code) {
  return SUPPORT_TYPE_LABELS[code] || escapeHtml(code || "—");
}

function renderSupportsSection(supports, isClosed, covers) {
  // ── 1. Agrupar soportes existentes por novelty_id ─────────────────────────
  // Solo se agregan filas con support_id real; las filas del UNION "pendiente"
  // (sin support_id) se usan solo para el meta del grupo.
  const byNovelty = new Map();
  for (const s of (supports || [])) {
    const key = String(s.novelty_id);
    if (!byNovelty.has(key)) {
      byNovelty.set(key, {
        novelty_id:      s.novelty_id,
        novelty_type:    s.novelty_type,
        employee_name:   s.employee_name,
        document_number: s.document_number,
        novelty_date:    s.novelty_date,
        docs:            [],
      });
    }
    if (s.support_id || s.id) {
      byNovelty.get(key).docs.push(s);
    }
  }

  console.log("[support upload]", {
    municipality:    activeGroupDetail?.group?.municipality_name || activeGroupDetail?.group?.municipality_id,
    groupId:         activeGroupDetail?.group?.id,
    payrollStatus:   activeGroupDetail?.group?.status,
    totalSupportRows: (supports || []).length,
    noveltyGroups:   byNovelty.size,
    rowSources:      [...new Set((supports || []).map((s) => s.row_source || "unknown"))],
    withRealSupport: (supports || []).filter((s) => s.support_id || s.id).length,
    withoutSupport:  (supports || []).filter((s) => !s.support_id && !s.id).length,
  });

  // Excluir DIAS_NO_CLASE: no requiere soporte y no debe aparecer en soportes
  const novEntries   = [...byNovelty.values()].filter((e) => e.novelty_type !== "DIAS_NO_CLASE");
  const hasNovelties = novEntries.length > 0;

  if (!hasNovelties) {
    return `<div class="nm-pay-empty" style="padding:20px">
      Sin novedades con soportes requeridos en este grupo.<br>
      <small style="color:#94A3B8">Los soportes se crean automáticamente cuando una novedad requiere documentación.</small>
    </div>`;
  }

  // ── 3. Estadísticas sobre soportes reales ────────────────────────────────
  // Contar solo las filas que DEBERÍAN tener archivo (tipos esperados con doc real)
  let totalExpected = 0;
  let totalApproved = 0;
  let totalMissing  = 0;

  for (const { novelty_type, docs } of novEntries) {
    const expectedTypes = SUPPORT_REQUIREMENTS[novelty_type];
    if (!expectedTypes || expectedTypes.length === 0) continue;
    totalExpected += expectedTypes.length;
    for (const docType of expectedTypes) {
      const rec = docs.find((d) => d.support_type === docType
        // fallback: accept legacy type codes that map to same document
        || (docType === "INCAPACIDAD_MEDICA_DOC" && d.support_type === "INCAPACIDAD_MEDICA")
        || (docType === "COMPROBANTE_CITACION"   && d.support_type === "COMPROBANTE_ASISTENCIA")
      );
      if (rec && (rec.status || rec.support_status) === "aprobado") totalApproved++;
      else if (!rec || !rec.file_url || rec.file_url === "") totalMissing++;
    }
  }

  const pct        = totalExpected > 0 ? Math.round((totalApproved / totalExpected) * 100) : 100;
  const hasMissing = totalMissing > 0;

  // ── 4. Función auxiliar: render de una fila de documento ─────────────────
  function docRow(docType, record, novelty_id) {
    const supId   = record ? (record.support_id || record.id) : null;
    const status  = record ? (record.status || record.support_status || "pendiente") : "pendiente";
    const hasFile = Boolean(record?.file_url && record.file_url !== "");
    const label   = SUPPORT_TYPE_LABELS[docType] || docType;

    console.log("[support upload]", {
      municipality:  activeGroupDetail?.group?.municipality_name || activeGroupDetail?.group?.municipality_id,
      noveltyId:     novelty_id,
      supportId:     supId,
      supportType:   docType,
      payrollStatus: activeGroupDetail?.group?.status,
      hasFile,
      hasRecord:     Boolean(record),
      visibleUpload: !hasFile,
    });

    // El botón de carga se muestra siempre que no haya archivo:
    //   - Si supId existe: actualiza el registro existente.
    //   - Si supId es null: crea un nuevo registro al subir (el handler usa novelty_id).
    // Nunca mostrar solo "Pendiente" cuando hay un novelty_id válido — eso bloquea el proceso.
    const uploadBtn = `<label class="nm-pay-btn nm-pay-btn--sm nm-pay-btn--warning" style="cursor:pointer;display:inline-flex;align-items:center;gap:3px" title="${supId ? "Reemplazar archivo" : "Adjuntar soporte"}">
         &#8593; Cargar
         <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style="display:none"
           data-upload-support="${supId || ""}" data-novelty-id="${novelty_id}" data-doc-type="${escapeHtml(docType)}">
       </label>`;

    return `
<div class="nm-sup-inline-doc">
  <span class="nm-sup-inline-doc-label">${escapeHtml(label)}</span>
  <span>${supportStatusBadge(status)}</span>
  ${hasFile
    ? `<a class="nm-pay-btn nm-pay-btn--sm" href="${escapeHtml(record.file_url)}" target="_blank" rel="noopener noreferrer" title="Ver archivo">&#128206; Ver</a>
       <a class="nm-pay-btn nm-pay-btn--sm" href="${escapeHtml(record.file_url)}" download="${escapeHtml(record.file_name || "soporte")}" target="_blank">&#8615;</a>
       ${uploadBtn}`
    : uploadBtn}
</div>`;
  }

  // ── 5. Tarjetas de novedades internas ────────────────────────────────────
  const noveltyCardsHtml = novEntries.map(({ novelty_id, novelty_type, employee_name, document_number, novelty_date, docs }) => {
    const nm           = noveltyByCode(novelty_type);
    const novDate      = String(novelty_date || "").slice(0, 10);
    const expectedTypes = SUPPORT_REQUIREMENTS[novelty_type];

    let docsHtml;
    if (!expectedTypes || expectedTypes.length === 0) {
      // Novedad sin requisito de soporte
      docsHtml = `<div class="nm-sup-inline-doc">
        <span class="nm-sup-inline-doc-label" style="color:#64748B;font-style:italic">Esta novedad no requiere soporte documental.</span>
        <span class="nm-sup-badge" style="background:#DCFCE7;color:#166534">&#10003; Sin requisito</span>
      </div>`;
    } else {
      docsHtml = expectedTypes.map((docType) => {
        // Buscar registro real; también aceptar códigos legacy equivalentes
        const record = docs.find((d) =>
          d.support_type === docType
          || (docType === "INCAPACIDAD_MEDICA_DOC" && d.support_type === "INCAPACIDAD_MEDICA")
          || (docType === "COMPROBANTE_CITACION"   && d.support_type === "COMPROBANTE_ASISTENCIA")
        );
        return docRow(docType, record, novelty_id);
      }).join("");
    }

    return `
<div class="nm-sup-inline-group">
  <div class="nm-sup-inline-nov-hd">
    <span class="nm-sup-inline-nov-type">${escapeHtml(nm?.name || novelty_type || "—")}</span>
    <span class="nm-sup-inline-nov-emp">${escapeHtml(employee_name || "—")}</span>
    ${novDate ? `<span class="nm-sup-inline-nov-date">${novDate}</span>` : ""}
    <span class="nm-sup-inline-nov-doc">${escapeHtml(document_number || "")}</span>
  </div>
  <div class="nm-sup-inline-docs">${docsHtml}</div>
</div>`;
  }).join("");


  return `
<div class="nm-sup-inline">
  <div class="nm-sup-inline-bar">
    <div class="nm-sup-inline-stat nm-sup-inline-stat--ok"><b>${totalApproved}</b><span>aprobados</span></div>
    <div class="nm-sup-inline-stat ${hasMissing ? "nm-sup-inline-stat--warn" : "nm-sup-inline-stat--ok"}"><b>${totalMissing}</b><span>sin archivo</span></div>
    <div class="nm-sup-inline-stat"><b>${totalExpected}</b><span>total docs</span></div>
    <div class="nm-sup-inline-progress" title="${pct}% aprobados">
      <div class="nm-sup-inline-progress-bar" style="width:${pct}%"></div>
      <span>${pct}%</span>
    </div>
    ${hasMissing
      ? `<div class="nm-sup-inline-alert">&#9888; ${totalMissing} documento${totalMissing !== 1 ? "s" : ""} sin cargar</div>`
      : `<div class="nm-sup-inline-ok">&#10003; Documentación completa</div>`}
  </div>
  <div class="nm-sup-inline-list">
    ${noveltyCardsHtml}
  </div>
</div>`;
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
  <td style="font-size:11px;white-space:nowrap">${fmtDateDMY(s.novelty_date)}</td>
  <td style="font-size:11px">${escapeHtml(SUPPORT_TYPE_LABELS[s.support_type] || s.support_type || "—")}</td>
  <td>
    ${hasFile
      ? `<button class="nm-pay-btn nm-pay-btn--sm" data-view-support="${viewKey}" title="${escapeHtml(s.file_name || "Ver archivo")}">&#128206; Ver</button>
         <a class="nm-pay-btn nm-pay-btn--sm" href="${escapeHtml(s.file_url)}" download="${escapeHtml(s.file_name || "soporte")}" target="_blank" style="text-decoration:none">&#8615;</a>`
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
// MODAL: DOCUMENTOS DE TRABAJADOR EXTERNO
// ─────────────────────────────────────────────────────────────────────────────
async function openExternalWorkerDocsModal(workerId, workerName) {
  const modal = document.getElementById("nmPayModal");

  // Load current turns data to get doc URLs
  const currentTurns = activeGroupTurns || [];
  const workerTurn = currentTurns.find((t) => t.external_worker_id === workerId);

  const docs = {
    cedula_url:         workerTurn?.cedula_url         || "",
    cert_bancaria_url:  workerTurn?.cert_bancaria_url  || "",
    cuenta_cobro_url:   workerTurn?.cuenta_cobro_url   || "",
  };

  const docLabels = {
    cedula_url:        "Cédula de ciudadanía",
    cert_bancaria_url: "Certificación bancaria",
    cuenta_cobro_url:  "Cuenta de cobro (firmada)",
  };

  function docRow(key) {
    const url = docs[key];
    const label = docLabels[key];
    return `
<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #F1F5F9">
  <div style="flex:1">
    <div style="font-size:13px;font-weight:600;color:#0F172A">${label}</div>
    ${url ? `<a href="${escapeHtml(url)}" target="_blank" style="font-size:11px;color:#0F766E;text-decoration:underline">Ver archivo</a>` : `<span style="font-size:11px;color:#94A3B8">Sin archivo</span>`}
  </div>
  <div>
    <label class="nm-pay-btn nm-pay-btn--sm" style="cursor:pointer;position:relative;display:inline-block">
      ${url ? "Reemplazar" : "Cargar"}
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" style="position:absolute;inset:0;opacity:0;cursor:pointer" data-doc-key="${key}">
    </label>
    ${url ? `<button class="nm-pay-btn nm-pay-btn--sm" style="color:#B91C1C;border-color:#FECACA;margin-left:4px" data-clear-doc="${key}">Quitar</button>` : ""}
  </div>
</div>`;
  }

  modal.innerHTML = `
<div class="nm-pay-dialog" style="max-width:540px">
  <div class="nm-pay-dialog-h">
    <b>Documentos — ${escapeHtml(workerName)}</b>
    <button class="nm-pay-btn nm-pay-btn--sm" data-close-modal>Cerrar</button>
  </div>
  <div class="nm-pay-dialog-b" style="gap:0">
    <div style="font-size:12px;color:#475569;margin-bottom:10px">
      Los tres documentos son obligatorios para habilitar la descarga de la cuenta de cobro.
    </div>
    <div id="extDocList">
      ${docRow("cedula_url")}
      ${docRow("cert_bancaria_url")}
      ${docRow("cuenta_cobro_url")}
    </div>
    <p id="extDocStatus" style="font-size:12px;color:#64748B;margin-top:8px;min-height:16px"></p>
  </div>
</div>`;
  modal.hidden = false;
  wireModalClose();

  // Handle file uploads
  modal.querySelectorAll("[data-doc-key]").forEach((input) => {
    input.addEventListener("change", async (e) => {
      const key  = input.dataset.docKey;
      const file = e.target.files?.[0];
      if (!file) return;
      const status = document.getElementById("extDocStatus");
      if (status) status.textContent = "Subiendo archivo…";
      try {
        const token = state.token || localStorage.getItem("empiria_token") || "";
        const form  = new FormData();
        form.append("file", file);
        const res  = await fetch("/payroll/supports/upload", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.message || "Error al subir archivo");

        await apiFetch(`/payroll/external-workers/${workerId}/docs`, {
          method: "PATCH",
          body: JSON.stringify({ [key]: json.data.url }),
        });
        docs[key] = json.data.url;
        if (status) status.textContent = "Documento guardado correctamente.";
        document.getElementById("extDocList").innerHTML =
          docRow("cedula_url") + docRow("cert_bancaria_url") + docRow("cuenta_cobro_url");
        // Re-wire clear buttons
        modal.querySelectorAll("[data-clear-doc]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const k = btn.dataset.clearDoc;
            await apiFetch(`/payroll/external-workers/${workerId}/docs`, {
              method: "PATCH",
              body: JSON.stringify({ [k]: null }),
            });
            docs[k] = "";
            document.getElementById("extDocList").innerHTML =
              docRow("cedula_url") + docRow("cert_bancaria_url") + docRow("cuenta_cobro_url");
          });
        });
        // Re-wire file inputs
        modal.querySelectorAll("[data-doc-key]").forEach((inp) => inp.addEventListener("change", () => {}));
        // Reload turns to reflect updated docs
        await loadGroupTurns();
        render();
      } catch (err) {
        if (status) status.textContent = "";
        showError(err.message || "Error al subir documento");
      }
    });
  });

  // Wire clear buttons
  modal.querySelectorAll("[data-clear-doc]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const k = btn.dataset.clearDoc;
      try {
        await apiFetch(`/payroll/external-workers/${workerId}/docs`, {
          method: "PATCH",
          body: JSON.stringify({ [k]: null }),
        });
        docs[k] = "";
        document.getElementById("extDocList").innerHTML =
          docRow("cedula_url") + docRow("cert_bancaria_url") + docRow("cuenta_cobro_url");
        await loadGroupTurns();
        render();
      } catch (err) { showError(err.message); }
    });
  });
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
  turnosFilter       = { search: "", hasCuentaCobro: "" };
  municipalitySearch = "";
  activePrimaryTab   = "nomina";
  supportsData       = [];
  supportsFilters    = { municipalityId: "", status: "", noveltyType: "", employee: "" };
  viewerSupportId    = null;
  resetItemsFilter();
  await loadPeriods();
  await loadGroups();
  await loadGroupDetail();
  return shell();
}

export function wirePayrollEvents() {
  render();
}
