import { apiFetch } from "../api.js";
import { escapeHtml } from "../utils.js";
import { dashboardCleaner } from "../nav.js";

const ROOT_ID    = "dashHrRoot";
const REFRESH_MS = 60_000;
const MONTHS_ES   = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MONTHS_FULL = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const ICON_PEOPLE  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="4" r="2.5" fill="currentColor" opacity=".8"/><path d="M1.5 12.5C1.5 10 4 8 7 8s5.5 2 5.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none" opacity=".8"/></svg>`;
const ICON_TC      = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_MT      = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M7 4v3l2 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_PCT     = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="4" cy="4" r="1.8" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="1.8" stroke="currentColor" stroke-width="1.4"/><line x1="3.5" y1="11" x2="10.5" y2="3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICON_MAP     = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5C4.8 1.5 3 3.3 3 5.5c0 3.2 4 7.5 4 7.5s4-4.3 4-7.5C11 3.3 9.2 1.5 7 1.5z" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="7" cy="5.5" r="1.4" fill="currentColor"/></svg>`;
const ICON_REFRESH = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11.5 7A4.5 4.5 0 1 1 8.5 2.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8.5 1v2.5H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_BALLOON = `<svg viewBox="0 0 22 30" fill="none" xmlns="http://www.w3.org/2000/svg" width="26" height="34">
  <ellipse cx="11" cy="11" rx="10" ry="11" fill="currentColor" opacity=".88"/>
  <ellipse cx="7.5" cy="6.5" rx="3.5" ry="2.5" fill="white" opacity=".28"/>
  <path d="M9 21.5 C8.2 22.8 9.4 24 11 23 C12.6 24 13.8 22.8 13 21.5" fill="currentColor" opacity=".65"/>
  <path d="M11 23.5 Q9 26.5 11 29.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none" opacity=".55"/>
</svg>`;

const AREA_COLORS = {
  "tecnologia":       "#378ADD",
  "operaciones":      "#534AB7",
  "comercial":        "#D85A30",
  "finanzas":         "#EF9F27",
  "rec. humanos":     "#1D9E75",
  "recursos humanos": "#1D9E75",
};
const FALLBACK_COLORS = ["#0B7CFF", "#2ECF9A", "#F7C948", "#8B5CF6", "#FF4D4F", "#378ADD", "#D85A30"];
const AGE_COLORS      = ["#071B4D", "#0B7CFF", "#2ECF9A", "#F7C948", "#8B5CF6", "#FF4D4F"];

let _timer  = null;
let _munId  = "";
let _activeType       = "operario";
let _lastData         = null;
let _selectedMonth    = new Date().getMonth() + 1;
let _selectedYear     = new Date().getFullYear();
let _availablePeriods = []; // YYYY-MM strings, newest first

function _clearDashboardHrTimers() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _munId    = "";
  _lastData         = null;
  _activeType       = "operario";
  _selectedMonth    = new Date().getMonth() + 1;
  _selectedYear     = new Date().getFullYear();
  _availablePeriods = [];
}

// ── Formatters ────────────────────────────────────────────────────────────────

function statusMeta(st) {
  const v = String(st || "").toUpperCase();
  if (v === "ESTABLE") return { label: "Estable", color: "#2ECF9A" };
  if (v === "ALERTA")  return { label: "Alerta",  color: "#F7C948" };
  if (v === "CRITICO") return { label: "Crítico", color: "#FF4D4F" };
  return { label: "Sin datos", color: "#CBD5E1" };
}

function fmtN(n) { return Number(n || 0).toLocaleString("es-CO"); }
function fmtBday(day, month) {
  return `${String(day || 0).padStart(2, "0")} ${MONTHS_ES[Number(month) || 0] || ""}`.trim();
}
function fmtEventDate(dateStr, timeStr) {
  if (!dateStr) return "—";
  const parts = String(dateStr).split("-");
  if (parts.length < 3) return escapeHtml(dateStr);
  const [, month, day] = parts;
  const t = timeStr ? ` · ${String(timeStr).slice(0, 5)}` : "";
  return `${Number(day)} ${MONTHS_ES[Number(month)] || ""}${t}`;
}

function isLicitacionCargo(label) {
  const up = String(label || "").toUpperCase();
  return (
    up.includes("GESTOR DE ZONA") ||
    up.includes("AUXILIAR GESTOR") ||
    up.includes("SUPERVISOR DE CALIDAD") ||
    up.includes("BODEGA") ||
    up.includes("TRANSPORTAD") ||
    (up.includes("COORDINADOR") && up.includes("SUMINISTRO"))
  );
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchAll(munId) {
  const params = new URLSearchParams({
    type:  _activeType,
    month: _selectedMonth,
    year:  _selectedYear,
  });
  if (munId) params.set("municipality_id", munId);
  const qs = "?" + params.toString();
  const [sumRes, kpiRes] = await Promise.all([
    apiFetch(`/dashboard/summary${qs}`),
    apiFetch(`/dashboard/kpis${qs}`),
  ]);
  return { summary: sumRes, kpis: kpiRes };
}

async function fetchPeriods() {
  try {
    const res = await apiFetch("/dashboard/periods");
    if (Array.isArray(res?.data) && res.data.length) {
      _availablePeriods = res.data; // YYYY-MM, newest first
    } else {
      const now = new Date();
      _availablePeriods = [`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`];
    }
  } catch {
    const now = new Date();
    _availablePeriods = [`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`];
  }
}

function normalize({ summary, kpis }) {
  const s = summary.data || {};
  const k = kpis.data   || {};

  const gMap = {};
  (s.employeesByGender || []).forEach(g => { gMap[String(g.label || "").toLowerCase()] = Number(g.value || 0); });
  const mN = gMap["mujeres"] || 0;
  const hN = gMap["hombres"] || 0;
  const gT = mN + hN;
  const mPct = gT > 0 ? Math.round((mN / gT) * 100) : 0;

  const AGE_LABELS = ["≤25", "26-35", "36-45", "46-55", "56-60", "60+"];
  const aMap = {};
  (s.employeesByAgeRange || []).forEach(a => { aMap[a.label] = Number(a.value || 0); });
  const ageItems = AGE_LABELS.map((l, i) => ({ label: l, value: aMap[l] || 0, color: AGE_COLORS[i] }));

  const MODALITY_COLORS = { "CAA": "#0B7CFF", "RI": "#2ECF9A", "CAARES": "#F7C948", "N/A": "#CBD5E1" };
  const MODALITY_ORDER  = ["CAA", "RI", "CAARES", "N/A"];
  const modMap = { CAA: 0, RI: 0, CAARES: 0, "N/A": 0 };
  (s.employeesByModality || []).forEach(m => {
    const raw = String(m.label || "").trim().toUpperCase();
    const val = Number(m.value || 0);
    if (raw.startsWith("CAARES"))   modMap["CAARES"] += val;
    else if (raw.startsWith("CAA")) modMap["CAA"]    += val;
    else if (raw === "RI")          modMap["RI"]     += val;
    else                            modMap["N/A"]    += val;
  });
  const modalityItems = MODALITY_ORDER.map(key => ({
    label: key,
    value: modMap[key],
    color: MODALITY_COLORS[key],
  }));

  const covPct = s.coveragePercent != null
    ? Number(s.coveragePercent)
    : k.pct_coverage != null ? Number(k.pct_coverage) : 0;
  const covColorMod = covPct >= 85 ? "--green" : covPct >= 60 ? "--yellow" : "--red";

  const cargoItems = (s.employeesByCargo || []).map((c, i) => ({
    label: c.label,
    value: Number(c.value || 0),
    color: c.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
    isLicitacion: isLicitacionCargo(c.label),
  }));
  const licitacionCount = cargoItems.filter(c => c.isLicitacion).reduce((acc, c) => acc + c.value, 0);
  const adminCount = cargoItems.filter(c => !c.isLicitacion).reduce((acc, c) => acc + c.value, 0);

  const EDUC_COLORS_MAP = {
    "BACHILLER": "#64748B", "TECNICO": "#0B7CFF", "TECNÓLOGO": "#2ECF9A",
    "PROFESIONAL": "#F7C948", "ESPECIALIZACIÓN": "#8B5CF6", "MAESTRÍA": "#FF4D4F", "SIN DATO": "#CBD5E1",
  };
  const educItems = (s.employeesByEducation || []).map(e => ({
    label: e.label,
    value: Number(e.value || 0),
    color: EDUC_COLORS_MAP[String(e.label || "").toUpperCase()] || "#CBD5E1",
  }));

  const EXP_ORDER = ["< 3 meses", "3 a 7 meses", "> 1 año", "Sin dato"];
  const EXP_COLORS = { "< 3 meses": "#FF4D4F", "3 a 7 meses": "#F7C948", "> 1 año": "#2ECF9A", "Sin dato": "#CBD5E1" };
  const expMap = {};
  (s.experienceDistribution || []).forEach(e => { expMap[e.label] = Number(e.value || 0); });
  const experienceItems = EXP_ORDER.map(l => ({ label: l, value: expMap[l] || 0, color: EXP_COLORS[l] }));

  const foodHandlingStats = s.foodHandlingStats || { vigente: 0, proximo: 0, vencido: 0, sinDoc: 0, inactivos: 0 };

  return {
    activos:          Number(s.activeEmployees    != null ? s.activeEmployees    : k.active      || 0),
    tcCont:           Number(s.contractedTc       != null ? s.contractedTc       : k.tc_count    || 0),
    mtCont:           Number(s.contractedMt       != null ? s.contractedMt       : k.mt_count    || 0),
    tcReq:            Number(s.requiredTc         != null ? s.requiredTc         : k.required_tc || 0),
    mtReq:            Number(s.requiredMt         != null ? s.requiredMt         : k.required_mt || 0),
    required20PctTc:  Number(s.required20PercentTc != null ? s.required20PercentTc : k.tcPct20  || 0),
    covPct, covColorMod,
    covStatus: String(s.coverageStatus || ""),
    mN, hN, mPct, gT,
    ageItems,
    modalityItems,
    areas:          Array.isArray(s.employeesByArea)      ? s.employeesByArea      : [],
    birthdaysThisMonth: Array.isArray(s.birthdaysThisMonth) ? s.birthdaysThisMonth : [],
    upcomingEvents:     Array.isArray(s.upcomingEvents)     ? s.upcomingEvents     : [],
    sisbenStats:        s.sisbenStats        || { vigente: 0, proximo: 0, vencido: 0, sinSisben: 0,      inactivos: 0 },
    residenceCertStats: s.residenceCertStats || { vigente: 0, proximo: 0, vencido: 0, sinCertificado: 0, inactivos: 0 },
    municipiosList: Array.isArray(k.municipalities_list) ? k.municipalities_list : [],
    coverageByMunicipality: Array.isArray(s.coverageByMunicipality) ? s.coverageByMunicipality : [],
    cargoItems, licitacionCount, adminCount, educItems,
    experienceItems, foodHandlingStats,
  };
}

// ── SVG donut helpers ─────────────────────────────────────────────────────────

const DONUT_R    = 38;
const DONUT_CIRC = 2 * Math.PI * DONUT_R;

function buildMultiDonut({ idPrefix, items, title, centerSub }) {
  const active = items.filter(a => a.value > 0);
  const total  = active.reduce((s, a) => s + a.value, 0);

  const trackCircle = `<circle cx="55" cy="55" r="${DONUT_R}" fill="none" stroke="#E2E8F0" stroke-width="16"/>`;
  const arcs = active.map((item, i) => `
    <circle id="${idPrefix}${i}" cx="55" cy="55" r="${DONUT_R}"
      fill="none" stroke="${item.color}" stroke-width="16" stroke-linecap="butt"
      transform="rotate(-90, 55, 55)"
      stroke-dasharray="0 ${DONUT_CIRC}"
      style="transition:stroke-dasharray .65s cubic-bezier(.4,0,.2,1);"/>`
  ).join("");

  const legend = active.map(item => {
    const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
    return `<div class="hr-legend-item">
      <span class="hr-legend-dot" style="background:${item.color}"></span>
      <span class="hr-legend-label">${escapeHtml(item.label)}</span>
      <span class="hr-legend-val">${fmtN(item.value)} · ${pct}%</span>
    </div>`;
  }).join("");

  if (!total) return `
    <div class="hr-card">
      <p class="hr-card-ttl">${escapeHtml(title)}</p>
      <p class="hr-empty">Sin datos</p>
    </div>`;

  return `
  <div class="hr-card">
    <p class="hr-card-ttl">${escapeHtml(title)}</p>
    <div class="hr-donut-wrap">
      <svg class="hr-donut-svg" viewBox="0 0 110 110">
        ${trackCircle}${arcs}
      </svg>
      <div class="hr-legend">${legend}</div>
    </div>
  </div>`;
}

function animateDonut(idPrefix, items) {
  const active = items.filter(a => a.value > 0);
  const total  = active.reduce((s, a) => s + a.value, 0);
  if (!total) return;
  let offset = 0;
  active.forEach((item, i) => {
    const el = document.getElementById(`${idPrefix}${i}`);
    if (!el) return;
    const len = (item.value / total) * DONUT_CIRC;
    el.setAttribute("stroke-dasharray", `${len} ${DONUT_CIRC - len}`);
    el.setAttribute("stroke-dashoffset", `${-offset}`);
    offset += len;
  });
}

function buildAgeBars(d) {
  const active = d.ageItems.filter(a => a.value > 0);
  const total  = active.reduce((s, a) => s + a.value, 0);
  if (!total) return `<div class="hr-card"><p class="hr-card-ttl">Distribución por edad</p><p class="hr-empty">Sin datos</p></div>`;
  const maxVal = Math.max(...active.map(a => a.value), 1);

  const cols = active.map(item => {
    const pct  = Math.round((item.value / total)  * 100);
    const hPct = Math.round((item.value / maxVal) * 100);
    return `
    <div class="hr-age-col">
      <span class="hr-age-count">${fmtN(item.value)}</span>
      <div class="hr-age-bar-wrap">
        <div class="hr-age-bar" style="background:${item.color}" data-h="${hPct}"></div>
      </div>
      <span class="hr-age-lbl">${escapeHtml(item.label)}</span>
      <span class="hr-age-pct">${pct}%</span>
    </div>`;
  }).join("");

  return `
  <div class="hr-card">
    <p class="hr-card-ttl">Distribución por edad</p>
    <div class="hr-age-chart">${cols}</div>
  </div>`;
}

// ── Widget builders ───────────────────────────────────────────────────────────

function buildTopbar() {
  return `
  <div class="hr-topbar">
    <div class="hr-type-tabs">
      <button type="button" class="hr-type-tab${_activeType === "operario" ? " active" : ""}" data-type="operario">
        Operario Manip. Alimentos
      </button>
      <button type="button" class="hr-type-tab${_activeType === "equipo" ? " active" : ""}" data-type="equipo">
        Equipo Mínimo (Adm.)
      </button>
    </div>
  </div>`;
}

function buildKpiCard(value, title, subtitle, accent, icon) {
  return `
  <article class="hr-kpi-card" style="--kpi-accent:${accent}">
    <div class="dkpi-row">
      <span>${escapeHtml(title)}</span>
      ${icon ? `<div class="dkpi-icon" style="background:${accent}1A;color:${accent}">${icon}</div>` : ""}
    </div>
    <strong>${escapeHtml(String(value))}</strong>
    <small>${escapeHtml(subtitle)}</small>
  </article>`;
}

function buildKpiRow(d) {
  return `
  <section class="hr-kpi-grid">
    ${buildKpiCard(fmtN(d.activos), "Empleados activos", "Personal activo en base real", "#0B7CFF", ICON_PEOPLE)}
    ${buildKpiCard(`${fmtN(d.tcReq)} / ${fmtN(d.tcCont)}`, "TC Req · TC Cont", "Cobertura tiempo completo", "#2ECF9A", ICON_TC)}
    ${buildKpiCard(`${fmtN(d.mtReq)} / ${fmtN(d.mtCont)}`, "MT Req · MT Cont", "Cobertura medio tiempo", "#8B5CF6", ICON_MT)}
    ${buildKpiCard(fmtN(d.required20PctTc), "20% TC Requerido", "Proyección mínima requerida", "#F59E0B", ICON_PCT)}
    <article class="hr-kpi-card" style="--kpi-accent:#64748B">
      <div class="dkpi-row">
        <span>Municipios</span>
        <div class="dkpi-icon" style="background:#64748B1A;color:#64748B">${ICON_MAP}</div>
      </div>
      <select id="hrMunSelect" class="hr-sel">
        <option value="">Todos los municipios</option>
        ${d.municipiosList.map(m => `<option value="${m.id}"${String(_munId) === String(m.id) ? " selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}
      </select>
      <small>${d.municipiosList.length ? `${d.municipiosList.length} municipio(s) disponibles` : "Sin municipios disponibles"}</small>
    </article>
    <article class="hr-kpi-card" style="--kpi-accent:#0B7CFF">
      <div class="dkpi-row">
        <span>Período</span>
        <button type="button" id="hrBtnRefresh" class="hr-period-btn" title="Actualizar datos">${ICON_REFRESH}</button>
      </div>
      <select id="hrMonthSelect" class="hr-sel">
        ${(() => {
          const current = `${_selectedYear}-${String(_selectedMonth).padStart(2, "0")}`;
          const list = _availablePeriods.length ? _availablePeriods : [current];
          return list.map(p => {
            const [y, m] = p.split("-").map(Number);
            return `<option value="${p}"${p === current ? " selected" : ""}>${MONTHS_FULL[m] || p} ${y}</option>`;
          }).join("");
        })()}
      </select>
      <small>Mes de referencia activo</small>
    </article>
  </section>`;
}

const RING_R    = 40;
const RING_CIRC = 2 * Math.PI * RING_R;

function buildGauge(d) {
  const sm    = statusMeta(d.covStatus);
  const noCov = (d.tcReq + d.mtReq) <= 0;
  return `
  <div class="hr-card hr-gauge-wrap">
    <div class="hr-gauge-hdr">
      <p class="hr-card-ttl" style="margin:0">Cobertura Global</p>
      <button type="button" class="hr-gauge-ver" id="hrGaugeVerBtn">
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.6"/>
          <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        Ver
      </button>
    </div>
    <div class="hr-gauge-ring-wrap">
      <svg class="hr-gauge-ring" viewBox="0 0 100 100">
        <defs>
          <filter id="hrGaugeGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <circle cx="50" cy="50" r="${RING_R}" fill="none" stroke="#EEF2F8" stroke-width="12"/>
        <circle cx="50" cy="50" r="${RING_R}" fill="none" stroke="#E2E8F0" stroke-width="7"/>
        <circle id="hrGaugeFillGlow" cx="50" cy="50" r="${RING_R}" fill="none"
          stroke="${sm.color}" stroke-width="14" stroke-linecap="round"
          transform="rotate(-90 50 50)"
          stroke-dasharray="0 ${RING_CIRC}" opacity="0.32"
          filter="url(#hrGaugeGlow)"
          style="transition:stroke-dasharray .85s cubic-bezier(.4,0,.2,1)"/>
        <circle id="hrGaugeFill" cx="50" cy="50" r="${RING_R}" fill="none"
          stroke="${sm.color}" stroke-width="8" stroke-linecap="round"
          transform="rotate(-90 50 50)"
          stroke-dasharray="0 ${RING_CIRC}"
          style="transition:stroke-dasharray .85s cubic-bezier(.4,0,.2,1),stroke .3s"/>
        <text id="hrGaugePct" x="50" y="47" text-anchor="middle"
          class="hr-gauge-pct" fill="${noCov ? "#94A3B8" : sm.color}">${noCov ? "—" : "0%"}</text>
        <text x="50" y="59" text-anchor="middle" class="hr-gauge-sub-lbl" fill="#94A3B8">cobertura</text>
      </svg>
    </div>
    <div class="hr-gauge-status" style="color:${sm.color}">
      <span class="hr-gauge-dot" style="background:${sm.color}"></span>${sm.label}
    </div>
  </div>`;
}

function buildCoverageModal(d) {
  const normMun = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

  // Deduplicate by accent-normalized name, then filter and sort
  const dedupMap = new Map();
  for (const m of (d.coverageByMunicipality || [])) {
    const key = normMun(m.municipalityName);
    if (key === "VILLAVICENCIO") continue;
    if (!((m.requiredTotal > 0) || (m.contractedTotal > 0))) continue;
    if (dedupMap.has(key)) {
      const ex = dedupMap.get(key);
      dedupMap.set(key, {
        ...ex,
        requiredTc:      (ex.requiredTc      || 0) + (m.requiredTc      || 0),
        contractedTc:    (ex.contractedTc    || 0) + (m.contractedTc    || 0),
        requiredMt:      (ex.requiredMt      || 0) + (m.requiredMt      || 0),
        contractedMt:    (ex.contractedMt    || 0) + (m.contractedMt    || 0),
        requiredTotal:   (ex.requiredTotal   || 0) + (m.requiredTotal   || 0),
        contractedTotal: (ex.contractedTotal || 0) + (m.contractedTotal || 0),
      });
    } else {
      dedupMap.set(key, { ...m });
    }
  }
  const items = Array.from(dedupMap.values())
    .map(m => {
      const req = m.requiredTotal || 0;
      const cont = m.contractedTotal || 0;
      const pct = req > 0 ? Math.round((cont / req) * 100) : 0;
      const st = !req ? "SIN_OPERACION" : pct >= 85 ? "ESTABLE" : pct >= 60 ? "ALERTA" : "CRITICO";
      return { ...m, coveragePercent: pct, coverageStatus: st };
    })
    .sort((a, b) => String(a.municipalityName || "").localeCompare(String(b.municipalityName || ""), "es"));

  const rows = items.map(m => {
    const pct   = Number(m.coveragePercent || 0);
    const st    = String(m.coverageStatus || "").toUpperCase();
    const color = st === "ESTABLE" ? "#2ECF9A" : st === "ALERTA" ? "#F7C948" : st === "SIN_OPERACION" ? "#94A3B8" : "#FF4D4F";
    const label = st === "ESTABLE" ? "Estable" : st === "ALERTA" ? "Alerta" : st === "SIN_OPERACION" ? "Sin op." : "Crítico";
    return `
    <tr>
      <td class="hr-cov-tname">${escapeHtml(m.municipalityName || "—")}</td>
      <td class="hr-cov-tnum">${fmtN(m.requiredTc)}</td>
      <td class="hr-cov-tnum" style="color:${Number(m.contractedTc)<Number(m.requiredTc)?"#FF4D4F":"inherit"}">${fmtN(m.contractedTc)}</td>
      <td class="hr-cov-tnum">${fmtN(m.requiredMt)}</td>
      <td class="hr-cov-tnum" style="color:${Number(m.contractedMt)<Number(m.requiredMt)?"#FF4D4F":"inherit"}">${fmtN(m.contractedMt)}</td>
      <td class="hr-cov-tpct" style="color:${color}">${pct}%</td>
      <td><span class="hr-cov-badge" style="color:${color};background:${color}18">${label}</span></td>
    </tr>`;
  }).join("");

  return `
  <div id="hrCovModal" class="hr-cov-modal-overlay" aria-hidden="true" role="dialog" aria-modal="true" aria-label="Mapa de cobertura">
    <div class="hr-cov-modal-panel">
      <div class="hr-cov-modal-hdr">
        <div>
          <h2 class="hr-cov-modal-ttl">Cobertura por Municipio</h2>
          <p class="hr-cov-modal-sub">${items.length} municipio(s) con operación — ordenado A-Z</p>
        </div>
        <button type="button" class="hr-cov-modal-close" id="hrCovModalClose" aria-label="Cerrar">✕</button>
      </div>
      <div class="hr-cov-modal-body">
        ${items.length ? `
        <table class="hr-cov-table">
          <thead>
            <tr>
              <th class="hr-cov-th-name">Municipio</th>
              <th>TC Req.</th>
              <th>TC Cont.</th>
              <th>MT Req.</th>
              <th>MT Cont.</th>
              <th>%</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>` : '<p class="hr-empty" style="padding:20px 0">Sin datos de cobertura disponibles</p>'}
      </div>
    </div>
  </div>`;
}

function buildComplianceCard({ title, vigente, proximo, vencido, total, inactivos = 0, docLabel }) {
  const conDoc = vigente + proximo + vencido;
  if (conDoc === 0 && total === 0) return `
  <div class="hr-card">
    <p class="hr-card-ttl">${escapeHtml(title)}</p>
    <p class="hr-empty">Sin datos registrados</p>
  </div>`;

  const counter = (label, value, color) => `
    <div class="hr-c3-item">
      <span class="hr-c3-num" style="color:${color}">${fmtN(value)}</span>
      <span class="hr-c3-lbl">${label}</span>
    </div>`;

  return `
  <div class="hr-card">
    <p class="hr-card-ttl">${escapeHtml(title)}</p>
    <div class="hr-c3-grid">
      ${counter("Vigentes",       vigente, "#2ECF9A")}
      <div class="hr-c3-sep"></div>
      ${counter("Próx. a vencer", proximo, "#F7C948")}
      <div class="hr-c3-sep"></div>
      ${counter("Vencidos",       vencido, "#FF4D4F")}
    </div>
    <div class="hr-c3-footer">
      <span>${escapeHtml(docLabel)}: <strong>${fmtN(conDoc)}</strong> de <strong>${fmtN(total)}</strong> activos</span>
      ${inactivos > 0 ? `<span class="hr-c3-inactivos">&nbsp;&nbsp;·&nbsp;&nbsp;<strong>${fmtN(inactivos)}</strong> inactivos</span>` : ""}
    </div>
  </div>`;
}

function buildGender(d) {
  const R = DONUT_R, CIRC = DONUT_CIRC;
  const mFill = d.gT > 0 ? (d.mN / d.gT) * CIRC : 0;
  const hPct  = d.gT > 0 ? 100 - d.mPct : 0;

  // Silueta femenina: cabeza + vestido acampanado
  const ICON_WOMAN = `<svg viewBox="0 0 40 60" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="20" cy="9" rx="7.5" ry="8"/>
    <path d="M13 19 Q20 17 27 19 Q25 25 24 29 L28 54 H12 L16 29 Q15 25 13 19Z"/>
  </svg>`;

  // Silueta masculina: cabeza + torso ancho + piernas
  const ICON_MAN = `<svg viewBox="0 0 40 60" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="20" cy="9" rx="7.5" ry="8"/>
    <path d="M11 19 Q20 17 29 19 L28 38 H12 Z"/>
    <rect x="11" y="37" width="8" height="17" rx="3.5"/>
    <rect x="21" y="37" width="8" height="17" rx="3.5"/>
  </svg>`;

  return `
  <div class="hr-card">
    <p class="hr-card-ttl">Distribución por género</p>
    <div class="hr-gender-wrap">

      <div class="hr-gender-side hr-gender-side--f">
        <div class="hr-gender-figure hr-gender-figure--f">${ICON_WOMAN}</div>
        <span class="hr-gender-num">${fmtN(d.mN)}</span>
        <span class="hr-gender-pct hr-gender-pct--f">${d.mPct}%</span>
      </div>

      <svg class="hr-gender-donut" viewBox="0 0 110 110">
        <circle cx="55" cy="55" r="${R}" fill="none" stroke="#E2E8F0" stroke-width="14"/>
        <circle id="hrDonutM" cx="55" cy="55" r="${R}"
          fill="none" stroke="#C084FC" stroke-width="14" stroke-linecap="butt"
          transform="rotate(-90,55,55)"
          stroke-dasharray="0 ${CIRC}"
          style="transition:stroke-dasharray .65s cubic-bezier(.4,0,.2,1);"/>
        <circle id="hrDonutH" cx="55" cy="55" r="${R}"
          fill="none" stroke="#3B82F6" stroke-width="14" stroke-linecap="butt"
          transform="rotate(-90,55,55)"
          stroke-dasharray="0 ${CIRC}" stroke-dashoffset="${-mFill}"
          style="transition:stroke-dasharray .65s cubic-bezier(.4,0,.2,1);"/>
      </svg>

      <div class="hr-gender-side hr-gender-side--m">
        <div class="hr-gender-figure hr-gender-figure--m">${ICON_MAN}</div>
        <span class="hr-gender-num">${fmtN(d.hN)}</span>
        <span class="hr-gender-pct hr-gender-pct--m">${hPct}%</span>
      </div>

    </div>
  </div>`;
}

function buildAreaBars(d) {
  const active = d.areas.filter(a => Number(a.value) > 0);
  if (!active.length) return `<div class="hr-card"><p class="hr-card-ttl">Distribución por área</p><p class="hr-empty">Sin datos de áreas</p></div>`;
  const maxVal = Math.max(...active.map(a => a.value), 1);
  const total  = active.reduce((s, a) => s + a.value, 0);
  const rows   = active.slice(0, 8).map((a, i) => {
    const key   = String(a.label || "").toLowerCase().trim();
    const color = AREA_COLORS[key] || a.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
    const w     = Math.max(4, Math.round((a.value / maxVal) * 100));
    const pct   = total > 0 ? Math.round((a.value / total) * 100) : 0;
    return `<div class="hr-bar-row">
      <div class="hr-bar-head">
        <span style="text-transform:capitalize">${escapeHtml(a.label)}</span>
        <strong>${fmtN(a.value)} · ${pct}%</strong>
      </div>
      <div class="hr-bar-track">
        <div class="hr-bar-fill" style="width:${w}%;background:${color}"></div>
      </div>
    </div>`;
  }).join("");
  return `<div class="hr-card"><p class="hr-card-ttl">Distribución por área</p><div class="hr-bar-list">${rows}</div></div>`;
}

function buildExperiencia(d) {
  const items = (d.experienceItems || []).filter(i => i.label !== "Sin dato");
  const total  = items.reduce((s, i) => s + i.value, 0);
  if (!total) return `<div class="hr-card"><p class="hr-card-ttl">Experiencia</p><p class="hr-empty">Sin datos</p></div>`;
  const counter = (label, value, color) => `
    <div class="hr-c3-item">
      <span class="hr-c3-num" style="color:${color}">${fmtN(value)}</span>
      <span class="hr-c3-lbl">${label}</span>
    </div>`;
  const [lt3, m37, gt1] = items;
  return `
  <div class="hr-card">
    <p class="hr-card-ttl">Experiencia</p>
    <div class="hr-c3-grid">
      ${counter("&lt; 3 meses",   lt3?.value || 0, "#FF4D4F")}
      <div class="hr-c3-sep"></div>
      ${counter("3 &ndash; 7 meses", m37?.value || 0, "#F7C948")}
      <div class="hr-c3-sep"></div>
      ${counter("&gt; 1 año",     gt1?.value || 0, "#2ECF9A")}
    </div>
    <div class="hr-c3-footer"><span>Total activos: <strong>${fmtN(total)}</strong></span></div>
  </div>`;
}

function buildCursosManipulacion(d) {
  const f = d.foodHandlingStats || {};
  const vigente = Number(f.vigente || 0);
  const proximo = Number(f.proximo || 0);
  const vencido = Number(f.vencido || 0);
  const sinDoc  = Number(f.sinDoc  || 0);
  const total   = vigente + proximo + vencido + sinDoc;
  if (!total) return `<div class="hr-card"><p class="hr-card-ttl">Cursos y Exámenes</p><p class="hr-empty">Sin datos registrados</p></div>`;
  const counter = (label, value, color) => `
    <div class="hr-c3-item">
      <span class="hr-c3-num" style="color:${color}">${fmtN(value)}</span>
      <span class="hr-c3-lbl">${label}</span>
    </div>`;
  return `
  <div class="hr-card">
    <p class="hr-card-ttl">Cursos y Exámenes Manip.</p>
    <div class="hr-c3-grid">
      ${counter("Vigentes",       vigente, "#2ECF9A")}
      <div class="hr-c3-sep"></div>
      ${counter("Próx. vencer",   proximo, "#F7C948")}
      <div class="hr-c3-sep"></div>
      ${counter("Vencidos",       vencido, "#FF4D4F")}
    </div>
    <div class="hr-c3-footer">
      <span>Con doc: <strong>${fmtN(vigente + proximo + vencido)}</strong> de <strong>${fmtN(total)}</strong> activos</span>
      ${f.inactivos > 0 ? `<span class="hr-c3-inactivos">&nbsp;·&nbsp;<strong>${fmtN(f.inactivos)}</strong> inactivos</span>` : ""}
    </div>
  </div>`;
}

const BDAY_BALLOON_COLORS = ["#A855F7","#3B82F6","#EC4899","#F59E0B","#10B981","#EF4444","#8B5CF6","#14B8A6","#F97316","#06B6D4"];

function buildTabCard(d, opts = {}) {
  const eventsHtml = d.upcomingEvents.length
    ? d.upcomingEvents.map(ev => `
        <div class="hr-evt-item">
          <span class="hr-evt-date">${fmtEventDate(ev.date, ev.time)}</span>
          <div class="hr-evt-info">
            <div class="hr-evt-title">${escapeHtml(ev.title)}</div>
            ${ev.description ? `<div class="hr-evt-desc">${escapeHtml(ev.description)}</div>` : ""}
          </div>
        </div>`).join("")
    : `<p class="hr-empty">Sin eventos próximos</p>`;

  const bdaysHtml = d.birthdaysThisMonth.length
    ? `<div class="hr-bday-carousel">
        <button type="button" class="hr-bday-nav hr-bday-prev" aria-label="Anterior">&#8249;</button>
        <div class="hr-bday-track-wrap">
          <div class="hr-bday-track">
            ${d.birthdaysThisMonth.map((b, i) => {
              const color = BDAY_BALLOON_COLORS[i % BDAY_BALLOON_COLORS.length];
              const sub   = opts.showMunicipality ? (b.municipality || "—")
                          : opts.showCargo        ? (b.position     || "—")
                          : "";
              return `<div class="hr-bday-bubble" style="--balloon:${color}">
                <div class="hr-bday-balloon" style="color:${color}">${ICON_BALLOON}</div>
                <span class="hr-bday-bubble-date">${fmtBday(b.day, b.month)}</span>
                <span class="hr-bday-bubble-name">${escapeHtml(b.name)}</span>
                ${sub ? `<span class="hr-bday-bubble-sub">${escapeHtml(sub)}</span>` : ""}
              </div>`;
            }).join("")}
          </div>
        </div>
        <button type="button" class="hr-bday-nav hr-bday-next" aria-label="Siguiente">&#8250;</button>
      </div>`
    : `<p class="hr-empty">Sin cumpleaños este mes</p>`;

  return `
  <div class="hr-card hr-tabcard">
    <div class="hr-tabs">
      <button type="button" class="hr-tab-btn active" data-tab="bdayos">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 2C8 2 6 4 6 5.5a2 2 0 0 0 4 0C10 4 8 2 8 2z" stroke="currentColor" stroke-width="1.4" fill="none"/>
          <rect x="2" y="8" width="12" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
          <line x1="8" y1="7.5" x2="8" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        Cumpleaños
      </button>
      <button type="button" class="hr-tab-btn" data-tab="eventos">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/>
          <line x1="5" y1="1" x2="5" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="11" y1="1" x2="11" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="2" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.5"/>
        </svg>
        Agenda
      </button>
    </div>
    <div class="hr-tab-pane active" data-pane="bdayos">
      ${bdaysHtml}
    </div>
    <div class="hr-tab-pane" data-pane="eventos">
      <div class="hr-evt-list">${eventsHtml}</div>
    </div>
  </div>`;
}

function buildEquipoPlaceholder() {
  return `
  <div class="hr-card hr-placeholder">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2"/>
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
    </svg>
    <p class="hr-placeholder-ttl">Dashboard Equipo Mínimo (Administrativo)</p>
    <p class="hr-placeholder-sub">Este panel está en desarrollo. Incluirá métricas específicas para el equipo administrativo y de soporte.</p>
  </div>`;
}

function buildEquipoKpiRow(d) {
  return `
  <section class="hr-kpi-grid" style="grid-template-columns:repeat(4,1fr)">
    ${buildKpiCard(fmtN(d.activos), "Equipo activo", "Total activos (sin operarios)", "#0B7CFF", ICON_PEOPLE)}
    ${buildKpiCard(fmtN(d.licitacionCount), "Cargo Licitación", "Coordinadores, gestores, bodega", "#8B5CF6", ICON_PEOPLE)}
    ${buildKpiCard(fmtN(d.adminCount), "Cargo Operativo/Adm.", "Auxiliares, coordinadores internos", "#2ECF9A", ICON_PEOPLE)}
    <article class="hr-kpi-card" style="--kpi-accent:#0B7CFF">
      <div class="dkpi-row">
        <span>Período</span>
        <button type="button" id="hrBtnRefresh" class="hr-period-btn" title="Actualizar datos">${ICON_REFRESH}</button>
      </div>
      <select id="hrMonthSelect" class="hr-sel">
        ${(() => {
          const current = `${_selectedYear}-${String(_selectedMonth).padStart(2, "0")}`;
          const list = _availablePeriods.length ? _availablePeriods : [current];
          return list.map(p => {
            const [y, m] = p.split("-").map(Number);
            return `<option value="${p}"${p === current ? " selected" : ""}>${MONTHS_FULL[m] || p} ${y}</option>`;
          }).join("");
        })()}
      </select>
      <small>Mes de referencia activo</small>
    </article>
  </section>`;
}

function buildEquipoCargos(d) {
  if (!d.cargoItems || !d.cargoItems.length) {
    return `<div class="hr-card"><p class="hr-card-ttl">Distribución por cargo</p><p class="hr-empty">Sin datos de cargos</p></div>`;
  }
  const licitItems = d.cargoItems.filter(c => c.isLicitacion);
  const adminItems = d.cargoItems.filter(c => !c.isLicitacion);
  const total  = d.cargoItems.reduce((s, c) => s + c.value, 0);
  const maxVal = Math.max(...d.cargoItems.map(c => c.value), 1);

  const renderSection = (items, label, color) => {
    if (!items.length) return "";
    const count = items.reduce((s, c) => s + c.value, 0);
    const rows = items.map(c => {
      const w   = Math.max(4, Math.round((c.value / maxVal) * 100));
      const pct = total > 0 ? Math.round((c.value / total) * 100) : 0;
      return `<div class="hr-bar-row">
        <div class="hr-bar-head">
          <span>${escapeHtml(c.label)}</span>
          <strong>${fmtN(c.value)} · ${pct}%</strong>
        </div>
        <div class="hr-bar-track">
          <div class="hr-bar-fill" style="background:${c.color}" data-w="${w}"></div>
        </div>
      </div>`;
    }).join("");
    return `
      <div class="hr-cargo-section">
        <div class="hr-cargo-section-hdr" style="color:${color}">
          <span class="hr-cargo-section-dot" style="background:${color}"></span>
          ${escapeHtml(label)}<span class="hr-cargo-section-cnt">&nbsp;·&nbsp;${fmtN(count)} personas</span>
        </div>
        <div class="hr-bar-list">${rows}</div>
      </div>`;
  };

  return `
  <div class="hr-card">
    <p class="hr-card-ttl">Distribución por cargo</p>
    <div class="hr-cargo-sections">
      ${renderSection(licitItems, "Licitación", "#8B5CF6")}
      ${renderSection(adminItems, "Operativo / Administrativo", "#2ECF9A")}
    </div>
  </div>`;
}

function buildEscolaridad(d) {
  const active = (d.educItems || []).filter(e => e.value > 0);
  const total  = active.reduce((s, e) => s + e.value, 0);

  if (!total) return `
    <div class="hr-card">
      <p class="hr-card-ttl">Escolaridad</p>
      <p class="hr-empty">Sin datos de escolaridad</p>
    </div>`;

  const maxVal = Math.max(...active.map(e => e.value), 1);
  const rows = active.map(e => {
    const pct = Math.round((e.value / total) * 100);
    const w   = Math.max(4, Math.round((e.value / maxVal) * 100));
    return `<div class="hr-bar-row">
      <div class="hr-bar-head">
        <span style="text-transform:capitalize">${escapeHtml(String(e.label || "").toLowerCase())}</span>
        <strong>${fmtN(e.value)} · ${pct}%</strong>
      </div>
      <div class="hr-bar-track">
        <div class="hr-bar-fill" style="background:${e.color}" data-w="${w}"></div>
      </div>
    </div>`;
  }).join("");

  return `<div class="hr-card"><p class="hr-card-ttl">Escolaridad</p><div class="hr-bar-list">${rows}</div></div>`;
}

function buildEquipoWorkspace(d) {
  return `
    ${buildEquipoKpiRow(d)}
    ${buildEquipoCargos(d)}
    <div class="hr-row-3">
      ${buildGender(d)}
      ${buildAgeBars(d)}
      ${buildEscolaridad(d)}
    </div>
    ${buildTabCard(d, { showCargo: true })}`;
}

function buildLoadingHtml() {
  const sk = (h = "20px") => `<div class="hr-skel" style="height:${h}"></div>`;
  return `
  <div class="hr-kpi-grid">
    ${Array(6).fill(`<div class="hr-kpi-card" style="--kpi-accent:#CBD5E1">${sk("11px")}${sk("26px")}${sk("11px")}</div>`).join("")}
  </div>
  <div class="hr-row-3">
    ${Array(3).fill(`<div class="hr-card">${sk("170px")}</div>`).join("")}
  </div>
  <div class="hr-row-3">
    ${Array(3).fill(`<div class="hr-card">${sk("170px")}</div>`).join("")}
  </div>
  <div class="hr-row-2">
    ${Array(2).fill(`<div class="hr-card">${sk("180px")}</div>`).join("")}
  </div>`;
}

function buildWorkspace(d) {
  const cert   = d.residenceCertStats;
  const sisben = d.sisbenStats;

  const operarioContent = `
    ${buildKpiRow(d)}
    <div class="hr-row-2" style="grid-template-columns:1fr 3fr">
      ${buildGauge(d)}
      ${buildTabCard(d, { showMunicipality: true })}
    </div>
    <div class="hr-row-3">
      ${buildGender(d)}
      ${buildAgeBars(d)}
      ${buildMultiDonut({ idPrefix: "hrMod", items: d.modalityItems, title: "Distribución por modalidad",centerSub: "activos" })}
    </div>
    <div class="hr-row-4">
      ${buildExperiencia(d)}
      ${buildCursosManipulacion(d)}
      ${buildComplianceCard({ title: "SISBEN",
          vigente: sisben.vigente, proximo: sisben.proximo, vencido: sisben.vencido,
          total: d.activos, inactivos: sisben.inactivos, docLabel: "SISBEN" })}
      ${buildComplianceCard({ title: "Certificados de Residencia",
          vigente: cert.vigente,   proximo: cert.proximo,   vencido: cert.vencido,
          total: d.activos, inactivos: cert.inactivos, docLabel: "Certificados" })}
    </div>`;

  return `
  ${buildTopbar(d.municipiosList, _munId)}
  ${_activeType === "operario" ? operarioContent : buildEquipoWorkspace(d)}
  ${buildCoverageModal(d)}`;
}

// ── Transitions ───────────────────────────────────────────────────────────────

function triggerTransitions(d) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    // Gender donut (both tabs)
    const mFill = d.gT > 0 ? (d.mN / d.gT) * DONUT_CIRC : 0;
    const dM = document.getElementById("hrDonutM");
    const dH = document.getElementById("hrDonutH");
    if (dM) dM.setAttribute("stroke-dasharray", `${mFill} ${DONUT_CIRC - mFill}`);
    if (dH) {
      dH.setAttribute("stroke-dasharray", `${DONUT_CIRC - mFill} ${mFill}`);
      dH.setAttribute("stroke-dashoffset", `${-mFill}`);
    }

    // Age bars (both tabs)
    document.querySelectorAll(`#${ROOT_ID} .hr-age-bar[data-h]`).forEach(el => {
      el.style.height = el.dataset.h + "%";
    });

    // Animated horizontal bars via data-w (equipo cargo/escolaridad)
    document.querySelectorAll(`#${ROOT_ID} .hr-bar-fill[data-w]`).forEach(el => {
      el.style.width = el.dataset.w + "%";
    });

    if (_activeType === "operario") {
      // Gauge ring
      const noCov = (d.tcReq + d.mtReq) <= 0;
      const pct   = Math.min(100, Math.max(0, d.covPct || 0));
      const fill  = noCov ? 0 : (pct / 100) * RING_CIRC;
      const sm    = statusMeta(d.covStatus);
      const gaugeFill     = document.getElementById("hrGaugeFill");
      const gaugeFillGlow = document.getElementById("hrGaugeFillGlow");
      const gaugeTxt      = document.getElementById("hrGaugePct");
      if (gaugeFill) {
        gaugeFill.setAttribute("stroke-dasharray", `${fill} ${RING_CIRC - fill}`);
        gaugeFill.setAttribute("stroke", sm.color);
      }
      if (gaugeFillGlow) {
        gaugeFillGlow.setAttribute("stroke-dasharray", `${fill} ${RING_CIRC - fill}`);
        gaugeFillGlow.setAttribute("stroke", sm.color);
      }
      if (gaugeTxt) {
        gaugeTxt.textContent = noCov ? "—" : `${pct}%`;
        gaugeTxt.setAttribute("fill", noCov ? "#94A3B8" : sm.color);
      }

      // Modality donut
      animateDonut("hrMod", d.modalityItems);
    }
  }));
}

// ── Events ────────────────────────────────────────────────────────────────────

function wireEvents() {
  const root     = document.getElementById(ROOT_ID);
  const munSel   = document.getElementById("hrMunSelect");
  const monthSel = document.getElementById("hrMonthSelect");
  const btnRef   = document.getElementById("hrBtnRefresh");

  if (munSel) {
    munSel.addEventListener("change", async (ev) => {
      _munId = ev.target.value || "";
      if (root) root.innerHTML = buildLoadingHtml();
      await renderHrWorkspace();
    });
  }

  if (monthSel) {
    monthSel.addEventListener("change", async (ev) => {
      const [y, m] = (ev.target.value || "").split("-").map(Number);
      if (y && m) { _selectedYear = y; _selectedMonth = m; }
      if (root) root.innerHTML = buildLoadingHtml();
      await renderHrWorkspace();
    });
  }

  if (btnRef) {
    btnRef.addEventListener("click", async () => {
      btnRef.disabled = true;
      if (root) root.innerHTML = buildLoadingHtml();
      await renderHrWorkspace();
    });
  }

  // Type tab switching — re-fetch porque cada tipo filtra cargos distintos
  document.querySelectorAll(`#${ROOT_ID} .hr-type-tab`).forEach(btn => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.type === _activeType) return;
      _activeType = btn.dataset.type;
      if (root) root.innerHTML = buildLoadingHtml();
      await renderHrWorkspace();
    });
  });

  // Coverage modal
  const covModal  = document.getElementById("hrCovModal");
  const verBtn    = document.getElementById("hrGaugeVerBtn");
  const closeBtn  = document.getElementById("hrCovModalClose");
  function openCovModal()  { covModal?.removeAttribute("aria-hidden"); covModal?.classList.add("open"); }
  function closeCovModal() { covModal?.setAttribute("aria-hidden","true"); covModal?.classList.remove("open"); }
  verBtn?.addEventListener("click", openCovModal);
  closeBtn?.addEventListener("click", closeCovModal);
  covModal?.addEventListener("click", e => { if (e.target === covModal) closeCovModal(); });
  root?.addEventListener("keydown", e => { if (e.key === "Escape") closeCovModal(); });

  // Content tab switching (Cumpleaños / Agenda)
  document.querySelectorAll(`#${ROOT_ID} .hr-tab-btn`).forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      document.querySelectorAll(`#${ROOT_ID} .hr-tab-btn`).forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(`#${ROOT_ID} .hr-tab-pane`).forEach(p => {
        p.classList.toggle("active", p.dataset.pane === target);
      });
    });
  });

  // Birthday carousel — size bubbles so exactly 10 are visible at once
  const trackWrap = root?.querySelector(".hr-bday-track-wrap");
  if (trackWrap) {
    const PER_PAGE = 10;
    const GAP      = 8;
    const bubbleW  = Math.floor((trackWrap.clientWidth - (PER_PAGE - 1) * GAP) / PER_PAGE);
    trackWrap.querySelectorAll(".hr-bday-bubble").forEach(b => {
      b.style.flex  = `0 0 ${bubbleW}px`;
      b.style.width = `${bubbleW}px`;
    });
  }

  function carouselStep(dir) {
    if (!trackWrap) return;
    const max = trackWrap.scrollWidth - trackWrap.clientWidth;
    if (max <= 0) return;
    let next = trackWrap.scrollLeft + dir * trackWrap.clientWidth;
    if (next > max + 5) next = 0;
    if (next < -5)      next = max;
    trackWrap.scrollLeft = next;
  }
  root?.querySelector(".hr-bday-prev")?.addEventListener("click", () => carouselStep(-1));
  root?.querySelector(".hr-bday-next")?.addEventListener("click", () => carouselStep(1));
}

// ── Render ────────────────────────────────────────────────────────────────────

async function renderHrWorkspace() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  try {
    const raw = await fetchAll(_munId);
    _lastData  = normalize(raw);
    root.innerHTML = buildWorkspace(_lastData);
    triggerTransitions(_lastData);
    wireEvents();
  } catch (err) {
    if (root) root.innerHTML = `<div class="hr-card"><p class="hr-err">Error cargando datos: ${escapeHtml(String(err.message || err))}</p></div>`;
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

function buildStyles() {
  return `<style id="dashHrInline">
/* workspace becomes the scroll container while dashboard HR is active */
#workspace{overflow-y:auto!important;flex:1!important;min-height:0!important;}

#${ROOT_ID}{
  --c-bg:#F8F9FB;--c-card:#fff;--c-border:#E2E8F0;
  --c-text:#1E293B;--c-muted:#64748B;
  --c-blue:#0B7CFF;--c-green:#2ECF9A;--c-yellow:#F7C948;--c-red:#FF4D4F;--c-purple:#8B5CF6;
  display:flex;flex-direction:column;gap:8px;
  padding:10px 12px;background:var(--c-bg);
  font-family:inherit;box-sizing:border-box;
}
#${ROOT_ID} *,#${ROOT_ID} *::before,#${ROOT_ID} *::after{box-sizing:border-box;}

/* ── Topbar ── */
#${ROOT_ID} .hr-topbar{
  display:flex;align-items:center;justify-content:space-between;
  gap:10px;flex-wrap:wrap;
}
#${ROOT_ID} .hr-type-tabs{
  display:flex;background:#F1F5F9;border-radius:8px;padding:3px;gap:2px;flex-shrink:0;
}
#${ROOT_ID} .hr-type-tab{
  border:none;border-radius:6px;padding:6px 14px;font-size:11.5px;font-weight:600;
  cursor:pointer;color:var(--c-muted);background:transparent;
  transition:all .15s;white-space:nowrap;line-height:1.3;
}
#${ROOT_ID} .hr-type-tab:hover{color:var(--c-text);}
#${ROOT_ID} .hr-type-tab.active{background:#fff;color:var(--c-text);box-shadow:0 1px 4px rgba(0,0,0,.1);}
#${ROOT_ID} .hr-topbar-ctrl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto;}
#${ROOT_ID} .hr-sel{
  border:1px solid var(--c-border);border-radius:6px;background:#fff;
  color:var(--c-text);font-size:12px;padding:5px 10px;outline:none;cursor:pointer;
}
#${ROOT_ID} .hr-btn-refresh{
  border:1px solid var(--c-border);border-radius:6px;background:#fff;
  color:var(--c-muted);font-size:12px;padding:5px 10px;cursor:pointer;
  display:flex;align-items:center;gap:5px;transition:background .15s;white-space:nowrap;
}
#${ROOT_ID} .hr-btn-refresh:hover{background:#F1F5F9;}
#${ROOT_ID} .hr-btn-refresh:disabled{opacity:.5;cursor:not-allowed;}

/* ── KPI row (skeleton fallback) ── */
#${ROOT_ID} .hr-kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
@media(max-width:900px){#${ROOT_ID} .hr-kpi-row{grid-template-columns:repeat(2,1fr);}}
@media(max-width:500px){#${ROOT_ID} .hr-kpi-row{grid-template-columns:1fr;}}
#${ROOT_ID} .hr-kpi{
  background:var(--c-card);border:1px solid var(--c-border);border-radius:10px;
  padding:14px 16px;display:flex;flex-direction:column;gap:4px;
}

/* ── KPI grid (real cards) ── */
#${ROOT_ID} .hr-kpi-grid{
  display:grid;
  grid-template-columns:repeat(6,1fr);
  gap:8px;
}
@media(max-width:1100px){#${ROOT_ID} .hr-kpi-grid{grid-template-columns:repeat(3,1fr);}}
@media(max-width:700px){#${ROOT_ID} .hr-kpi-grid{grid-template-columns:repeat(2,1fr);}}
@media(max-width:420px){#${ROOT_ID} .hr-kpi-grid{grid-template-columns:1fr;}}

#${ROOT_ID} .hr-kpi-card{
  background:var(--c-card);
  border:1px solid var(--c-border);
  border-top:3px solid var(--kpi-accent, var(--c-blue));
  border-radius:10px;
  padding:10px 12px;
  display:flex;flex-direction:column;gap:4px;
}
#${ROOT_ID} .dkpi-row{
  display:flex;align-items:center;justify-content:space-between;gap:6px;
}
#${ROOT_ID} .dkpi-row>span{
  font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;
  color:var(--c-muted);line-height:1.3;
}
#${ROOT_ID} .dkpi-icon{
  width:28px;height:28px;border-radius:7px;
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
}
#${ROOT_ID} .hr-kpi-card>strong{
  font-size:18px;font-weight:700;line-height:1.1;
  color:var(--kpi-accent, var(--c-text));
}
#${ROOT_ID} .hr-kpi-card>small{
  font-size:10.5px;color:var(--c-muted);
}
#${ROOT_ID} .hr-kpi-card .hr-sel{width:100%;margin-top:2px;}
#${ROOT_ID} .hr-period-btn{
  border:none;background:#0B7CFF1A;color:#0B7CFF;border-radius:6px;
  width:26px;height:26px;display:flex;align-items:center;justify-content:center;
  cursor:pointer;flex-shrink:0;transition:background .15s;padding:0;
}
#${ROOT_ID} .hr-period-btn:hover{background:#0B7CFF30;}
#${ROOT_ID} .hr-period-btn:disabled{opacity:.5;cursor:not-allowed;}

#${ROOT_ID} .hr-kpi-card--action{
  background:linear-gradient(135deg,var(--c-blue) 0%,#0060D4 100%);
  border:none;border-top:none;border-radius:10px;
  color:#fff;cursor:pointer;text-align:left;
}
#${ROOT_ID} .hr-kpi-card--action .dkpi-row>span,
#${ROOT_ID} .hr-kpi-card--action>strong,
#${ROOT_ID} .hr-kpi-card--action>small{color:#fff;}
#${ROOT_ID} .hr-kpi-card--action .dkpi-icon{background:rgba(255,255,255,.18)!important;color:#fff!important;}
#${ROOT_ID} .hr-kpi-card--action:hover{opacity:.88;}
#${ROOT_ID} .hr-kpi-card--action:disabled{opacity:.55;cursor:not-allowed;}

/* ── Grid layouts ── */
#${ROOT_ID} .hr-row-4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
#${ROOT_ID} .hr-row-3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}
#${ROOT_ID} .hr-row-2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
@media(max-width:1100px){#${ROOT_ID} .hr-row-4{grid-template-columns:repeat(2,1fr);}}
@media(max-width:900px){
  #${ROOT_ID} .hr-row-3{grid-template-columns:1fr 1fr;}
  #${ROOT_ID} .hr-row-2{grid-template-columns:1fr;}
}
@media(max-width:580px){
  #${ROOT_ID} .hr-row-4,#${ROOT_ID} .hr-row-3,#${ROOT_ID} .hr-row-2{grid-template-columns:1fr;}
}

/* ── Base card ── */
#${ROOT_ID} .hr-card{background:var(--c-card);border:1px solid var(--c-border);border-radius:10px;padding:10px 12px;}
#${ROOT_ID} .hr-card-ttl{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--c-muted);margin:0 0 7px;}
#${ROOT_ID} .hr-empty{color:var(--c-muted);font-size:12px;padding:8px 0;text-align:center;margin:0;}
#${ROOT_ID} .hr-err{color:var(--c-red);font-size:13px;margin:0;}

/* ── Gauge (premium ring) ── */
#${ROOT_ID} .hr-gauge-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;}
#${ROOT_ID} .hr-gauge-hdr{display:flex;align-items:center;justify-content:space-between;width:100%;margin-bottom:4px;}
#${ROOT_ID} .hr-gauge-ver{
  display:inline-flex;align-items:center;gap:4px;
  font-size:10px;font-weight:600;color:var(--c-blue);
  background:#EFF6FF;border:1px solid #BFDBFE;border-radius:99px;
  padding:3px 10px;cursor:pointer;transition:background .15s,box-shadow .15s;white-space:nowrap;
}
#${ROOT_ID} .hr-gauge-ver:hover{background:#DBEAFE;box-shadow:0 1px 4px #3B82F620;}
#${ROOT_ID} .hr-gauge-ring-wrap{flex:1;display:flex;align-items:center;justify-content:center;width:100%;min-height:0;}
#${ROOT_ID} .hr-gauge-ring{width:min(130px,100%);height:auto;overflow:visible;}
#${ROOT_ID} .hr-gauge-pct{font-size:20px;font-weight:800;font-family:system-ui,sans-serif;}
#${ROOT_ID} .hr-gauge-sub-lbl{font-size:7.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;}
#${ROOT_ID} .hr-gauge-status{
  display:flex;align-items:center;gap:5px;margin-top:2px;
  font-size:11px;font-weight:700;letter-spacing:.03em;
}
#${ROOT_ID} .hr-gauge-dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex-shrink:0;}
#${ROOT_ID} .hr-gauge-detail{
  display:flex;align-items:center;gap:6px;margin-top:4px;
  font-size:10px;color:var(--c-muted);
}
#${ROOT_ID} .hr-gauge-detail strong{color:var(--c-text);}
#${ROOT_ID} .hr-gauge-sep{color:var(--c-border);}

/* ── Coverage Modal ── */
#${ROOT_ID} .hr-cov-modal-overlay{
  position:fixed;inset:0;z-index:9999;
  background:rgba(7,27,77,.45);backdrop-filter:blur(3px);
  display:flex;align-items:center;justify-content:center;
  opacity:0;pointer-events:none;transition:opacity .2s;
}
#${ROOT_ID} .hr-cov-modal-overlay.open{opacity:1;pointer-events:all;}
#${ROOT_ID} .hr-cov-modal-panel{
  background:#fff;border-radius:16px;
  box-shadow:0 24px 64px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.08);
  width:min(700px,94vw);max-height:80vh;
  display:flex;flex-direction:column;overflow:hidden;
}
#${ROOT_ID} .hr-cov-modal-hdr{
  display:flex;align-items:flex-start;justify-content:space-between;
  padding:20px 24px 14px;border-bottom:1px solid var(--c-border);flex-shrink:0;
}
#${ROOT_ID} .hr-cov-modal-ttl{font-size:16px;font-weight:700;color:var(--c-text);margin:0;}
#${ROOT_ID} .hr-cov-modal-sub{font-size:12px;color:var(--c-muted);margin:3px 0 0;}
#${ROOT_ID} .hr-cov-modal-close{
  width:30px;height:30px;border-radius:50%;border:1px solid var(--c-border);
  background:#F8F9FB;cursor:pointer;font-size:15px;color:var(--c-muted);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
  transition:background .15s,color .15s;
}
#${ROOT_ID} .hr-cov-modal-close:hover{background:var(--c-red);color:#fff;border-color:var(--c-red);}
#${ROOT_ID} .hr-cov-modal-body{overflow-y:auto;padding:0 24px 20px;}
#${ROOT_ID} .hr-cov-table{width:100%;border-collapse:collapse;font-size:12px;}
#${ROOT_ID} .hr-cov-table thead th{
  padding:10px 10px;text-align:center;font-weight:600;font-size:11px;
  color:var(--c-muted);border-bottom:2px solid var(--c-border);
  white-space:nowrap;position:sticky;top:0;background:#fff;z-index:1;
}
#${ROOT_ID} .hr-cov-th-name{text-align:left!important;}
#${ROOT_ID} .hr-cov-table tbody tr{border-bottom:1px solid #F1F5F9;transition:background .12s;}
#${ROOT_ID} .hr-cov-table tbody tr:last-child{border-bottom:none;}
#${ROOT_ID} .hr-cov-table tbody tr:hover{background:#F8F9FB;}
#${ROOT_ID} .hr-cov-table tbody td{padding:9px 10px;vertical-align:middle;text-align:center;}
#${ROOT_ID} .hr-cov-tname{text-align:left!important;font-weight:600;color:var(--c-text);font-size:12px;}
#${ROOT_ID} .hr-cov-tnum{font-variant-numeric:tabular-nums;font-size:12px;}
#${ROOT_ID} .hr-cov-tpct{font-weight:700;font-size:12px;white-space:nowrap;}
#${ROOT_ID} .hr-cov-badge{font-size:10px;font-weight:600;border-radius:99px;padding:2px 7px;text-align:center;white-space:nowrap;display:inline-block;}

/* ── Compliance counters ── */
#${ROOT_ID} .hr-c3-grid{
  display:flex;align-items:stretch;gap:0;
  background:#F8F9FB;border-radius:10px;overflow:hidden;
  margin-bottom:12px;
}
#${ROOT_ID} .hr-c3-item{
  flex:1;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:3px;padding:8px 4px;
}
#${ROOT_ID} .hr-c3-num{
  font-size:22px;font-weight:800;line-height:1;letter-spacing:-1px;
}
#${ROOT_ID} .hr-c3-lbl{
  font-size:10px;font-weight:600;color:var(--c-muted);
  text-transform:uppercase;letter-spacing:.04em;text-align:center;
}
#${ROOT_ID} .hr-c3-sep{width:1px;background:var(--c-border);align-self:stretch;}
#${ROOT_ID} .hr-c3-footer{
  font-size:11px;color:var(--c-muted);border-top:1px solid var(--c-border);
  padding-top:10px;display:flex;align-items:center;flex-wrap:wrap;gap:2px;
}
#${ROOT_ID} .hr-c3-footer strong{color:var(--c-text);}
#${ROOT_ID} .hr-c3-inactivos{color:#94A3B8;}
#${ROOT_ID} .hr-c3-inactivos strong{color:#64748B;}
#${ROOT_ID} .hr-tag{font-size:11px;font-weight:500;color:#64748B;background:#F1F5F9;border-radius:99px;padding:2px 8px;}
#${ROOT_ID} .hr-tag--warn{color:#FF4D4F;background:#FFF1F0;}
#${ROOT_ID} .hr-tag--info{color:#0B7CFF;background:#EFF6FF;}

/* ── Donut ── */
#${ROOT_ID} .hr-donut-wrap{display:flex;flex-direction:row;align-items:center;justify-content:center;gap:20px;padding-left:44px;}
#${ROOT_ID} .hr-donut-svg{width:150px;height:150px;flex-shrink:0;}
#${ROOT_ID} .hr-donut-pct{font-size:16px;font-weight:700;fill:var(--c-text);}
#${ROOT_ID} .hr-donut-sub{font-size:13px;fill:var(--c-muted);}

/* ── Gender card ── */
#${ROOT_ID} .hr-gender-wrap{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
}
#${ROOT_ID} .hr-gender-donut{
  width:150px;height:150px;flex-shrink:0;
}
#${ROOT_ID} .hr-gender-side{
  display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;
}
#${ROOT_ID} .hr-gender-figure{
  width:48px;height:66px;
}
#${ROOT_ID} .hr-gender-figure--f{color:#C084FC;}
#${ROOT_ID} .hr-gender-figure--m{color:#60A5FA;}
#${ROOT_ID} .hr-gender-figure svg{width:100%;height:100%;drop-shadow(0 2px 6px currentColor);}
#${ROOT_ID} .hr-gender-num{
  font-size:22px;font-weight:800;line-height:1;letter-spacing:-.5px;
}
#${ROOT_ID} .hr-gender-side--f .hr-gender-num{color:#A855F7;}
#${ROOT_ID} .hr-gender-side--m .hr-gender-num{color:#3B82F6;}
#${ROOT_ID} .hr-gender-pct{
  font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;
}
#${ROOT_ID} .hr-gender-pct--f{background:#EDE9FE;color:#7C3AED;}
#${ROOT_ID} .hr-gender-pct--m{background:#DBEAFE;color:#1D4ED8;}
#${ROOT_ID} .hr-legend{display:flex;flex-direction:column;gap:8px;flex:1;justify-content:center;}
#${ROOT_ID} .hr-legend-item{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--c-text);}
#${ROOT_ID} .hr-legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
#${ROOT_ID} .hr-legend-label{font-size:12px;}
#${ROOT_ID} .hr-legend-val{font-size:12px;font-weight:600;color:var(--c-text);white-space:nowrap;}

/* ── Age bar chart ── */
#${ROOT_ID} .hr-age-chart{
  display:flex;align-items:flex-end;justify-content:space-between;
  gap:6px;height:120px;padding-bottom:0;
}
#${ROOT_ID} .hr-age-col{
  display:flex;flex-direction:column;align-items:center;
  flex:1;height:100%;justify-content:flex-end;gap:3px;
}
#${ROOT_ID} .hr-age-count{
  font-size:10px;font-weight:700;color:var(--c-text);line-height:1;
  min-height:14px;
}
#${ROOT_ID} .hr-age-bar-wrap{
  flex:1;width:100%;display:flex;align-items:flex-end;
}
#${ROOT_ID} .hr-age-bar{
  width:100%;height:0%;border-radius:5px 5px 2px 2px;
  transition:height .6s cubic-bezier(.4,0,.2,1);
  min-height:3px;
}
#${ROOT_ID} .hr-age-lbl{
  font-size:10px;color:var(--c-muted);font-weight:500;
  white-space:nowrap;text-align:center;
}
#${ROOT_ID} .hr-age-pct{
  font-size:10px;color:var(--c-muted);font-weight:600;min-height:13px;
}

/* ── Area bars ── */
#${ROOT_ID} .hr-bar-list{display:flex;flex-direction:column;gap:5px;}
#${ROOT_ID} .hr-bar-row{display:flex;flex-direction:column;gap:2px;}
#${ROOT_ID} .hr-bar-head{display:flex;justify-content:space-between;font-size:11px;color:var(--c-muted);}
#${ROOT_ID} .hr-bar-head strong{color:var(--c-text);font-weight:600;}
#${ROOT_ID} .hr-bar-track{height:6px;background:#F1F5F9;border-radius:99px;overflow:hidden;}
#${ROOT_ID} .hr-bar-fill{height:100%;border-radius:99px;transition:width .6s cubic-bezier(.4,0,.2,1);}

/* ── Tab card ── */
#${ROOT_ID} .hr-tabcard{
  display:flex;flex-direction:column;
  height:220px;overflow:hidden;
}
#${ROOT_ID} .hr-tabs{display:flex;gap:2px;margin-bottom:12px;border-bottom:1px solid var(--c-border);padding-bottom:0;flex-shrink:0;}
#${ROOT_ID} .hr-tab-btn{
  background:none;border:none;cursor:pointer;font-size:12px;font-weight:500;color:var(--c-muted);
  padding:5px 10px 7px;display:flex;align-items:center;gap:5px;
  border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s,border-color .15s;
}
#${ROOT_ID} .hr-tab-btn:hover{color:var(--c-text);}
#${ROOT_ID} .hr-tab-btn.active{color:var(--c-blue);border-bottom-color:var(--c-blue);}
#${ROOT_ID} .hr-tab-pane{display:none;}
#${ROOT_ID} .hr-tab-pane.active{display:flex;flex-direction:column;flex:1;min-height:0;}

/* ── Events ── */
#${ROOT_ID} .hr-evt-list{display:flex;flex-direction:column;gap:6px;flex:1;min-height:0;overflow-y:auto;}
#${ROOT_ID} .hr-evt-item{display:flex;gap:10px;padding:7px 8px;border-radius:6px;background:#F8F9FB;align-items:flex-start;}
#${ROOT_ID} .hr-evt-date{font-size:11px;font-weight:700;color:var(--c-blue);background:#EFF6FF;border-radius:5px;padding:2px 6px;white-space:nowrap;min-width:50px;text-align:center;flex-shrink:0;margin-top:1px;}
#${ROOT_ID} .hr-evt-info{flex:1;min-width:0;}
#${ROOT_ID} .hr-evt-title{font-size:12px;font-weight:600;color:var(--c-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#${ROOT_ID} .hr-evt-desc{font-size:11px;color:var(--c-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

/* ── Birthdays carousel ── */
#${ROOT_ID} .hr-bday-carousel{
  display:flex;flex:1;min-height:0;align-items:center;gap:4px;overflow:hidden;
}
#${ROOT_ID} .hr-bday-nav{
  flex-shrink:0;width:22px;height:22px;border-radius:50%;
  border:1px solid var(--c-border);background:#fff;cursor:pointer;
  font-size:18px;line-height:1;color:var(--c-muted);
  display:flex;align-items:center;justify-content:center;padding:0;
  transition:background .15s,color .15s,border-color .15s;
}
#${ROOT_ID} .hr-bday-nav:hover{background:var(--c-blue);color:#fff;border-color:var(--c-blue);}
#${ROOT_ID} .hr-bday-track-wrap{
  flex:1;overflow:hidden;scroll-behavior:smooth;
}
#${ROOT_ID} .hr-bday-track{
  display:flex;flex-wrap:nowrap;gap:8px;padding:2px 0 4px;
}
#${ROOT_ID} .hr-bday-bubble{
  flex:0 0 60px;width:60px;
  background:#F5F3FF;border:1px solid #EDE9FE;
  border-radius:12px;padding:8px 6px 7px;
  display:flex;flex-direction:column;align-items:center;
  gap:3px;text-align:center;box-sizing:border-box;
}
#${ROOT_ID} .hr-bday-balloon{line-height:0;flex-shrink:0;}
#${ROOT_ID} .hr-bday-bubble-date{
  font-size:10px;font-weight:800;color:var(--balloon,#A855F7);
  background:#EDE9FE;border-radius:99px;padding:1px 6px;line-height:1.5;white-space:nowrap;
}
#${ROOT_ID} .hr-bday-bubble-name{
  font-size:9.5px;font-weight:600;color:var(--c-text);
  line-height:1.3;width:100%;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
#${ROOT_ID} .hr-bday-bubble-sub{
  font-size:8.5px;color:var(--c-muted);font-weight:500;width:100%;
  line-height:1.3;text-align:center;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}

/* ── Coming soon placeholder ── */
#${ROOT_ID} .hr-placeholder{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:12px;min-height:320px;text-align:center;
}
#${ROOT_ID} .hr-placeholder-ttl{font-size:15px;font-weight:600;color:var(--c-text);margin:0;}
#${ROOT_ID} .hr-placeholder-sub{font-size:13px;color:var(--c-muted);max-width:380px;margin:0;line-height:1.5;}

/* ── Skeleton ── */
#${ROOT_ID} .hr-skel{
  background:linear-gradient(90deg,#E2E8F0 25%,#F1F5F9 50%,#E2E8F0 75%);
  background-size:200% 100%;animation:hrSkel 1.4s infinite;
  border-radius:6px;margin-bottom:6px;
}
@keyframes hrSkel{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* ── Equipo cargo sections ── */
#${ROOT_ID} .hr-cargo-sections{display:flex;flex-direction:column;gap:16px;}
#${ROOT_ID} .hr-cargo-section{display:flex;flex-direction:column;gap:7px;}
#${ROOT_ID} .hr-cargo-section-hdr{
  display:flex;align-items:center;gap:7px;
  font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
  padding-bottom:6px;border-bottom:1px solid var(--c-border);
}
#${ROOT_ID} .hr-cargo-section-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
#${ROOT_ID} .hr-cargo-section-cnt{font-weight:500;color:var(--c-muted);text-transform:none;letter-spacing:0;}

/* animated bar fills — start at 0, JS sets final width */
#${ROOT_ID} .hr-bar-fill[data-w]{width:0;}
</style>`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function loadDashboardHrModule() {
  dashboardCleaner.fn();
  _clearDashboardHrTimers();
  dashboardCleaner.fn = _clearDashboardHrTimers;

  const html = `${buildStyles()}<div id="${ROOT_ID}">${buildLoadingHtml()}</div>`;

  setTimeout(async () => {
    try {
      // Fetch available periods and pick smart default (most recent = index 0)
      await fetchPeriods();
      const currentPeriod = `${_selectedYear}-${String(_selectedMonth).padStart(2, "0")}`;
      if (_availablePeriods.length && !_availablePeriods.includes(currentPeriod)) {
        const [y, m] = _availablePeriods[0].split("-").map(Number);
        if (y && m) { _selectedYear = y; _selectedMonth = m; }
      }
      await renderHrWorkspace();
      _timer = setInterval(() => renderHrWorkspace().catch(() => {}), REFRESH_MS);
    } catch (err) {
      const root = document.getElementById(ROOT_ID);
      if (root) root.innerHTML = `<div class="hr-card"><p class="hr-err">Error: ${escapeHtml(String(err.message || err))}</p></div>`;
    }
  }, 0);

  return html;
}
