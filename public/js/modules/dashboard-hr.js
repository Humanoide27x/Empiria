import { apiFetch } from "../api.js";
import { escapeHtml } from "../utils.js";
import { dashboardCleaner } from "../nav.js";

const ROOT_ID    = "dashHrRoot";
const REFRESH_MS = 60_000;
const MONTHS_ES  = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const ICON_PEOPLE  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="4" r="2.5" fill="currentColor" opacity=".8"/><path d="M1.5 12.5C1.5 10 4 8 7 8s5.5 2 5.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none" opacity=".8"/></svg>`;
const ICON_TC      = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_MT      = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M7 4v3l2 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_PCT     = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="4" cy="4" r="1.8" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="1.8" stroke="currentColor" stroke-width="1.4"/><line x1="3.5" y1="11" x2="10.5" y2="3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICON_MAP     = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5C4.8 1.5 3 3.3 3 5.5c0 3.2 4 7.5 4 7.5s4-4.3 4-7.5C11 3.3 9.2 1.5 7 1.5z" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="7" cy="5.5" r="1.4" fill="currentColor"/></svg>`;
const ICON_REFRESH = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11.5 7A4.5 4.5 0 1 1 8.5 2.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8.5 1v2.5H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

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

let _timer      = null;
let _munId      = "";
let _activeType = "operario";   // "operario" | "equipo"
let _lastData   = null;

function _clearDashboardHrTimers() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _munId      = "";
  _lastData   = null;
  _activeType = "operario";
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

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchAll(munId) {
  const qs = munId ? `?municipality_id=${encodeURIComponent(munId)}` : "";
  const [sumRes, kpiRes] = await Promise.all([
    apiFetch(`/dashboard/summary${qs}`),
    apiFetch(`/dashboard/kpis${qs}`),
  ]);
  return { summary: sumRes, kpis: kpiRes };
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
  let ageItems;
  if (k.age_brackets) {
    ageItems = AGE_LABELS.map((l, i) => ({ label: l, value: Number(k.age_brackets[l] || 0), color: AGE_COLORS[i] }));
  } else {
    const aMap = {};
    (s.employeesByAgeRange || []).forEach(a => { aMap[a.label] = Number(a.value || 0); });
    ageItems = AGE_LABELS.map((l, i) => ({ label: l, value: aMap[l] || 0, color: AGE_COLORS[i] }));
  }

  const modalityItems = (s.employeesByModality || []).map((m, i) => ({
    label: m.label,
    value: Number(m.value || 0),
    color: m.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
  }));

  const covPct = s.coveragePercent != null
    ? Number(s.coveragePercent)
    : k.pct_coverage != null ? Number(k.pct_coverage) : 0;
  const covColorMod = covPct >= 85 ? "--green" : covPct >= 60 ? "--yellow" : "--red";

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
    sisbenStats:        s.sisbenStats        || { vigente: 0, sinSisben: 0, vencido: 0 },
    residenceCertStats: s.residenceCertStats || { vigente: 0, sinCertificado: 0, vencido: 0 },
    municipiosList: Array.isArray(k.municipalities_list) ? k.municipalities_list : [],
  };
}

// ── SVG donut helpers ─────────────────────────────────────────────────────────

const DONUT_R    = 38;
const DONUT_CIRC = 2 * Math.PI * DONUT_R;

function buildMultiDonut({ idPrefix, items, title, centerSub }) {
  const active = items.filter(a => a.value > 0);
  const total  = items.reduce((s, a) => s + a.value, 0);

  const trackCircle = `<circle cx="55" cy="55" r="${DONUT_R}" fill="none" stroke="#E2E8F0" stroke-width="16"/>`;
  const arcs = items.map((item, i) => `
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
      <span>${escapeHtml(item.label)} · ${pct}%</span>
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
        <text x="55" y="51" text-anchor="middle" class="hr-donut-pct">${fmtN(total)}</text>
        <text x="55" y="63" text-anchor="middle" class="hr-donut-sub">${escapeHtml(centerSub)}</text>
      </svg>
      <div class="hr-legend">${legend}</div>
    </div>
  </div>`;
}

function animateDonut(idPrefix, items) {
  const total = items.reduce((s, a) => s + a.value, 0);
  if (!total) return;
  let offset = 0;
  items.forEach((item, i) => {
    const el = document.getElementById(`${idPrefix}${i}`);
    if (!el) return;
    const len = (item.value / total) * DONUT_CIRC;
    el.setAttribute("stroke-dasharray", `${len} ${DONUT_CIRC - len}`);
    el.setAttribute("stroke-dashoffset", `${-offset}`);
    offset += len;
  });
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
    <button type="button" class="hr-kpi-card hr-kpi-card--action" id="hrBtnRefresh">
      <div class="dkpi-row">
        <span>Actualizar datos</span>
        <div class="dkpi-icon" style="background:rgba(255,255,255,0.18);color:#fff">${ICON_REFRESH}</div>
      </div>
      <strong>En tiempo real</strong>
      <small>Refrescar resumen operativo</small>
    </button>
  </section>`;
}

function buildGauge(d) {
  const R    = 58;
  const CIRC = Math.PI * R;
  const sm   = statusMeta(d.covStatus);
  const noCov = (d.tcReq + d.mtReq) <= 0;
  return `
  <div class="hr-card hr-gauge-wrap">
    <p class="hr-card-ttl">Cobertura global</p>
    <svg class="hr-gauge-svg" viewBox="0 -6 116 70">
      <path class="hr-gauge-track" d="M 10,58 A ${R},${R} 0 0,1 106,58"/>
      <path id="hrGaugeFill" class="hr-gauge-fill"
        d="M 10,58 A ${R},${R} 0 0,1 106,58"
        stroke="${sm.color}" stroke-dasharray="0 ${CIRC}"/>
      <text id="hrGaugePct" x="58" y="50" text-anchor="middle" class="hr-gauge-pct">${noCov ? "—" : "0%"}</text>
    </svg>
    <span class="hr-gauge-badge" style="color:${sm.color};background:${sm.color}18">${sm.label}</span>
  </div>`;
}

function buildComplianceCard({ id, title, vigente, sin, sinLabel, vencido, total }) {
  const withData = vigente + sin + vencido > 0;
  const pct      = total > 0 ? Math.round((vigente / total) * 100) : 0;
  const barColor = pct >= 85 ? "#2ECF9A" : pct >= 60 ? "#F7C948" : "#FF4D4F";
  return `
  <div class="hr-card">
    <p class="hr-card-ttl">${escapeHtml(title)}</p>
    ${withData ? `
      <div class="hr-compl-big">${fmtN(vigente)}</div>
      <div class="hr-compl-lbl">vigentes de ${fmtN(total)} activos</div>
      <div class="hr-compl-bar-wrap">
        <div class="hr-compl-bar" id="${id}Bar" style="width:0%;background:${barColor}" data-target="${pct}"></div>
      </div>
      <div class="hr-compl-foot">
        <span class="hr-tag">${fmtN(sin)} ${escapeHtml(sinLabel)}</span>
        ${vencido > 0 ? `<span class="hr-tag hr-tag--warn">${fmtN(vencido)} vencidos</span>` : ""}
        <span class="hr-tag hr-tag--info">${pct}% cumplimiento</span>
      </div>
    ` : `<p class="hr-empty">Sin datos registrados</p>`}
  </div>`;
}

function buildGender(d) {
  const R = DONUT_R, CIRC = DONUT_CIRC;
  const mFill = d.gT > 0 ? (d.mN / d.gT) * CIRC : 0;
  return `
  <div class="hr-card">
    <p class="hr-card-ttl">Distribución por género</p>
    <div class="hr-donut-wrap">
      <svg class="hr-donut-svg" viewBox="0 0 110 110">
        <circle cx="55" cy="55" r="${R}" fill="none" stroke="#E2E8F0" stroke-width="16"/>
        <circle id="hrDonutM" cx="55" cy="55" r="${R}"
          fill="none" stroke="#8B5CF6" stroke-width="16" stroke-linecap="butt"
          transform="rotate(-90, 55, 55)"
          stroke-dasharray="0 ${CIRC}"
          style="transition:stroke-dasharray .65s cubic-bezier(.4,0,.2,1);"/>
        <circle id="hrDonutH" cx="55" cy="55" r="${R}"
          fill="none" stroke="#0B7CFF" stroke-width="16" stroke-linecap="butt"
          transform="rotate(-90, 55, 55)"
          stroke-dasharray="0 ${CIRC}" stroke-dashoffset="${-mFill}"
          style="transition:stroke-dasharray .65s cubic-bezier(.4,0,.2,1);"/>
        <text x="55" y="51" text-anchor="middle" class="hr-donut-pct">${d.mPct}%</text>
        <text x="55" y="63" text-anchor="middle" class="hr-donut-sub">Mujeres</text>
      </svg>
      <div class="hr-legend">
        <div class="hr-legend-item"><span class="hr-legend-dot" style="background:#8B5CF6"></span>Mujeres (${fmtN(d.mN)})</div>
        <div class="hr-legend-item"><span class="hr-legend-dot" style="background:#0B7CFF"></span>Hombres (${fmtN(d.hN)})</div>
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

function buildTabCard(d) {
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
    ? d.birthdaysThisMonth.slice(0, 10).map(b => `
        <div class="hr-bday-item">
          <span class="hr-bday-date">${fmtBday(b.day, b.month)}</span>
          <div class="hr-bday-info">
            <div class="hr-bday-name">${escapeHtml(b.name)}</div>
            <div class="hr-bday-pos">${escapeHtml(b.position)}</div>
          </div>
        </div>`).join("")
    : `<p class="hr-empty">Sin cumpleaños este mes</p>`;

  return `
  <div class="hr-card">
    <div class="hr-tabs">
      <button type="button" class="hr-tab-btn active" data-tab="eventos">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/>
          <line x1="5" y1="1" x2="5" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="11" y1="1" x2="11" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="2" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.5"/>
        </svg>
        Agenda
      </button>
      <button type="button" class="hr-tab-btn" data-tab="bdayos">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 2C8 2 6 4 6 5.5a2 2 0 0 0 4 0C10 4 8 2 8 2z" stroke="currentColor" stroke-width="1.4" fill="none"/>
          <rect x="2" y="8" width="12" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
          <line x1="8" y1="7.5" x2="8" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        Cumpleaños
      </button>
    </div>
    <div class="hr-tab-pane active" data-pane="eventos">
      <div class="hr-evt-list">${eventsHtml}</div>
    </div>
    <div class="hr-tab-pane" data-pane="bdayos">
      <div class="hr-bday-list">${bdaysHtml}</div>
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
    <div class="hr-row-3">
      ${buildGauge(d)}
      ${buildComplianceCard({ id: "hrCert",   title: "Certificados de Residencia",
          vigente: cert.vigente,   sin: cert.sinCertificado,   sinLabel: "sin certificado",
          vencido: cert.vencido,   total: d.activos })}
      ${buildComplianceCard({ id: "hrSisben", title: "SISBEN",
          vigente: sisben.vigente, sin: sisben.sinSisben,       sinLabel: "sin SISBEN",
          vencido: sisben.vencido, total: d.activos })}
    </div>
    <div class="hr-row-3">
      ${buildGender(d)}
      ${buildMultiDonut({ idPrefix: "hrAge", items: d.ageItems,      title: "Distribución por edad",     centerSub: "activos" })}
      ${buildMultiDonut({ idPrefix: "hrMod", items: d.modalityItems, title: "Distribución por modalidad",centerSub: "activos" })}
    </div>
    <div class="hr-row-2">
      ${buildAreaBars(d)}
      ${buildTabCard(d)}
    </div>`;

  return `
  ${buildTopbar(d.municipiosList, _munId)}
  ${_activeType === "operario" ? operarioContent : buildEquipoPlaceholder()}`;
}

// ── Transitions ───────────────────────────────────────────────────────────────

function triggerTransitions(d) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    // Gauge arc
    const R = 58, CIRC = Math.PI * R;
    const noCov = (d.tcReq + d.mtReq) <= 0;
    const pct   = Math.min(100, Math.max(0, d.covPct || 0));
    const fill  = noCov ? 0 : (pct / 100) * CIRC;
    const sm    = statusMeta(d.covStatus);
    const gaugeFill = document.getElementById("hrGaugeFill");
    const gaugeTxt  = document.getElementById("hrGaugePct");
    if (gaugeFill) {
      gaugeFill.setAttribute("stroke-dasharray", `${fill} ${CIRC - fill}`);
      gaugeFill.setAttribute("stroke", sm.color);
    }
    if (gaugeTxt) gaugeTxt.textContent = noCov ? "—" : `${pct}%`;

    // Gender donut
    const mFill = d.gT > 0 ? (d.mN / d.gT) * DONUT_CIRC : 0;
    const dM = document.getElementById("hrDonutM");
    const dH = document.getElementById("hrDonutH");
    if (dM) dM.setAttribute("stroke-dasharray", `${mFill} ${DONUT_CIRC - mFill}`);
    if (dH) {
      dH.setAttribute("stroke-dasharray", `${DONUT_CIRC - mFill} ${mFill}`);
      dH.setAttribute("stroke-dashoffset", `${-mFill}`);
    }

    // Multi-segment donuts
    animateDonut("hrAge", d.ageItems);
    animateDonut("hrMod", d.modalityItems);

    // Compliance bars
    document.querySelectorAll(`#${ROOT_ID} .hr-compl-bar[data-target]`).forEach(el => {
      el.style.width = el.dataset.target + "%";
    });
  }));
}

// ── Events ────────────────────────────────────────────────────────────────────

function wireEvents() {
  const root   = document.getElementById(ROOT_ID);
  const munSel = document.getElementById("hrMunSelect");
  const btnRef = document.getElementById("hrBtnRefresh");

  if (munSel) {
    munSel.addEventListener("change", async (ev) => {
      _munId = ev.target.value || "";
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

  // Type tab switching (no re-fetch needed)
  document.querySelectorAll(`#${ROOT_ID} .hr-type-tab`).forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.type === _activeType) return;
      _activeType = btn.dataset.type;
      if (root && _lastData) {
        root.innerHTML = buildWorkspace(_lastData);
        if (_activeType === "operario") triggerTransitions(_lastData);
        wireEvents();
      }
    });
  });

  // Content tab switching (Agenda / Cumpleaños)
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
}

// ── Render ────────────────────────────────────────────────────────────────────

async function renderHrWorkspace() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  try {
    const raw = await fetchAll(_munId);
    _lastData  = normalize(raw);
    root.innerHTML = buildWorkspace(_lastData);
    if (_activeType === "operario") triggerTransitions(_lastData);
    wireEvents();
  } catch (err) {
    if (root) root.innerHTML = `<div class="hr-card"><p class="hr-err">Error cargando datos: ${escapeHtml(String(err.message || err))}</p></div>`;
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

function buildStyles() {
  return `<style id="dashHrInline">
#${ROOT_ID}{
  --c-bg:#F8F9FB;--c-card:#fff;--c-border:#E2E8F0;
  --c-text:#1E293B;--c-muted:#64748B;
  --c-blue:#0B7CFF;--c-green:#2ECF9A;--c-yellow:#F7C948;--c-red:#FF4D4F;--c-purple:#8B5CF6;
  display:flex;flex-direction:column;gap:12px;
  padding:16px;background:var(--c-bg);min-height:100%;
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
  gap:10px;
}
@media(max-width:1100px){#${ROOT_ID} .hr-kpi-grid{grid-template-columns:repeat(3,1fr);}}
@media(max-width:700px){#${ROOT_ID} .hr-kpi-grid{grid-template-columns:repeat(2,1fr);}}
@media(max-width:420px){#${ROOT_ID} .hr-kpi-grid{grid-template-columns:1fr;}}

#${ROOT_ID} .hr-kpi-card{
  background:var(--c-card);
  border:1px solid var(--c-border);
  border-top:3px solid var(--kpi-accent, var(--c-blue));
  border-radius:10px;
  padding:14px 16px;
  display:flex;flex-direction:column;gap:6px;
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
  font-size:22px;font-weight:700;line-height:1.1;
  color:var(--kpi-accent, var(--c-text));
}
#${ROOT_ID} .hr-kpi-card>small{
  font-size:11px;color:var(--c-muted);
}
#${ROOT_ID} .hr-kpi-card .hr-sel{width:100%;margin-top:2px;}

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
#${ROOT_ID} .hr-row-3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
#${ROOT_ID} .hr-row-2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
@media(max-width:900px){
  #${ROOT_ID} .hr-row-3{grid-template-columns:1fr 1fr;}
  #${ROOT_ID} .hr-row-2{grid-template-columns:1fr;}
}
@media(max-width:580px){
  #${ROOT_ID} .hr-row-3,#${ROOT_ID} .hr-row-2{grid-template-columns:1fr;}
}

/* ── Base card ── */
#${ROOT_ID} .hr-card{background:var(--c-card);border:1px solid var(--c-border);border-radius:10px;padding:14px;}
#${ROOT_ID} .hr-card-ttl{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--c-muted);margin:0 0 10px;}
#${ROOT_ID} .hr-empty{color:var(--c-muted);font-size:12px;padding:8px 0;text-align:center;margin:0;}
#${ROOT_ID} .hr-err{color:var(--c-red);font-size:13px;margin:0;}

/* ── Gauge ── */
#${ROOT_ID} .hr-gauge-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;}
#${ROOT_ID} .hr-gauge-svg{width:120px;height:auto;overflow:visible;}
#${ROOT_ID} .hr-gauge-track{fill:none;stroke:#E2E8F0;stroke-width:12;}
#${ROOT_ID} .hr-gauge-fill{fill:none;stroke-width:12;stroke-linecap:round;transition:stroke-dasharray .7s cubic-bezier(.4,0,.2,1),stroke .4s;}
#${ROOT_ID} .hr-gauge-pct{font-size:18px;font-weight:700;fill:var(--c-text);}
#${ROOT_ID} .hr-gauge-badge{margin-top:10px;font-size:11px;font-weight:600;border-radius:99px;padding:2px 10px;display:inline-block;}

/* ── Compliance ── */
#${ROOT_ID} .hr-compl-big{font-size:30px;font-weight:700;color:var(--c-text);line-height:1;}
#${ROOT_ID} .hr-compl-lbl{font-size:11px;color:var(--c-muted);margin-bottom:10px;}
#${ROOT_ID} .hr-compl-bar-wrap{height:6px;background:#F1F5F9;border-radius:99px;overflow:hidden;margin-bottom:10px;}
#${ROOT_ID} .hr-compl-bar{height:100%;border-radius:99px;transition:width .7s cubic-bezier(.4,0,.2,1);width:0%;}
#${ROOT_ID} .hr-compl-foot{display:flex;gap:6px;flex-wrap:wrap;}
#${ROOT_ID} .hr-tag{font-size:11px;font-weight:500;color:#64748B;background:#F1F5F9;border-radius:99px;padding:2px 8px;}
#${ROOT_ID} .hr-tag--warn{color:#FF4D4F;background:#FFF1F0;}
#${ROOT_ID} .hr-tag--info{color:#0B7CFF;background:#EFF6FF;}

/* ── Donut ── */
#${ROOT_ID} .hr-donut-wrap{display:flex;flex-direction:column;align-items:center;gap:10px;}
#${ROOT_ID} .hr-donut-svg{width:104px;height:104px;}
#${ROOT_ID} .hr-donut-pct{font-size:14px;font-weight:700;fill:var(--c-text);}
#${ROOT_ID} .hr-donut-sub{font-size:10px;fill:var(--c-muted);}
#${ROOT_ID} .hr-legend{display:flex;gap:6px 12px;flex-wrap:wrap;justify-content:center;}
#${ROOT_ID} .hr-legend-item{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--c-text);}
#${ROOT_ID} .hr-legend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}

/* ── Area bars ── */
#${ROOT_ID} .hr-bar-list{display:flex;flex-direction:column;gap:7px;}
#${ROOT_ID} .hr-bar-row{display:flex;flex-direction:column;gap:3px;}
#${ROOT_ID} .hr-bar-head{display:flex;justify-content:space-between;font-size:11px;color:var(--c-muted);}
#${ROOT_ID} .hr-bar-head strong{color:var(--c-text);font-weight:600;}
#${ROOT_ID} .hr-bar-track{height:6px;background:#F1F5F9;border-radius:99px;overflow:hidden;}
#${ROOT_ID} .hr-bar-fill{height:100%;border-radius:99px;transition:width .6s cubic-bezier(.4,0,.2,1);}

/* ── Tab card ── */
#${ROOT_ID} .hr-tabs{display:flex;gap:2px;margin-bottom:12px;border-bottom:1px solid var(--c-border);padding-bottom:0;}
#${ROOT_ID} .hr-tab-btn{
  background:none;border:none;cursor:pointer;font-size:12px;font-weight:500;color:var(--c-muted);
  padding:5px 10px 7px;display:flex;align-items:center;gap:5px;
  border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s,border-color .15s;
}
#${ROOT_ID} .hr-tab-btn:hover{color:var(--c-text);}
#${ROOT_ID} .hr-tab-btn.active{color:var(--c-blue);border-bottom-color:var(--c-blue);}
#${ROOT_ID} .hr-tab-pane{display:none;}
#${ROOT_ID} .hr-tab-pane.active{display:block;}

/* ── Events ── */
#${ROOT_ID} .hr-evt-list{display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;}
#${ROOT_ID} .hr-evt-item{display:flex;gap:10px;padding:7px 8px;border-radius:6px;background:#F8F9FB;align-items:flex-start;}
#${ROOT_ID} .hr-evt-date{font-size:11px;font-weight:700;color:var(--c-blue);background:#EFF6FF;border-radius:5px;padding:2px 6px;white-space:nowrap;min-width:50px;text-align:center;flex-shrink:0;margin-top:1px;}
#${ROOT_ID} .hr-evt-info{flex:1;min-width:0;}
#${ROOT_ID} .hr-evt-title{font-size:12px;font-weight:600;color:var(--c-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#${ROOT_ID} .hr-evt-desc{font-size:11px;color:var(--c-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

/* ── Birthdays ── */
#${ROOT_ID} .hr-bday-list{display:flex;flex-direction:column;gap:5px;max-height:220px;overflow-y:auto;}
#${ROOT_ID} .hr-bday-item{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;background:#F8F9FB;font-size:12px;}
#${ROOT_ID} .hr-bday-date{font-weight:700;color:var(--c-purple);min-width:34px;font-size:11px;text-align:center;background:#F5F3FF;border-radius:5px;padding:2px 5px;flex-shrink:0;}
#${ROOT_ID} .hr-bday-info{flex:1;min-width:0;}
#${ROOT_ID} .hr-bday-name{font-weight:600;color:var(--c-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#${ROOT_ID} .hr-bday-pos{color:var(--c-muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

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
      await renderHrWorkspace();
      _timer = setInterval(() => renderHrWorkspace().catch(() => {}), REFRESH_MS);
    } catch (err) {
      const root = document.getElementById(ROOT_ID);
      if (root) root.innerHTML = `<div class="hr-card"><p class="hr-err">Error: ${escapeHtml(String(err.message || err))}</p></div>`;
    }
  }, 0);

  return html;
}
