import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { escapeHtml } from '../utils.js';
import { showSuccess, showError } from '../toast.js';
import { dashboardCleaner } from '../nav.js';

// ── Module state ──────────────────────────────────────────────────────────────
let _charts     = {};
let _timer      = null;
let _munId      = "";
let _contractId = "";
let _cargoType  = "real";
let _cargoMonth = "";
let _widgetConfig = [];   // current contract's widget config

export function _clearDashboardTimers() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  for (const c of Object.values(_charts)) { try { c.destroy(); } catch {} }
  _charts       = {};
  _munId        = "";
  _contractId   = "";
  _cargoType    = "real";
  _cargoMonth   = "";
  _widgetConfig = [];
}
dashboardCleaner.fn = _clearDashboardTimers;

// ── Chart.js lazy loader ──────────────────────────────────────────────────────
function loadChartJs() {
  return new Promise(resolve => {
    if (window.Chart) { resolve(); return; }
    if (!document.getElementById("chartjs-script")) {
      const s = document.createElement("script");
      s.id = "chartjs-script";
      s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
      s.onload = resolve; s.onerror = resolve;
      document.head.appendChild(s);
    } else { resolve(); }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtCOP(n) {
  if (!n) return "$0";
  if (n >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000)     return "$" + (n / 1_000_000).toFixed(1) + "M";
  return "$" + Number(n).toLocaleString("es-CO");
}
function semColor(pct) {
  if (pct === null || pct === undefined) return "#94a3b8";
  return pct >= 95 ? "#16a34a" : pct >= 85 ? "#d97706" : "#dc2626";
}
function semClass(status) {
  if (status === "ok")       return "ck-sem-ok";
  if (status === "warning")  return "ck-sem-warning";
  if (status === "critical") return "ck-sem-critical";
  return "ck-sem-nodata";
}
function severityIcon(s) {
  if (s === "critical") return `<span class="ck-alert-dot ck-alert-dot-critical"></span>`;
  if (s === "warning")  return `<span class="ck-alert-dot ck-alert-dot-warning"></span>`;
  if (s === "info")     return `<span class="ck-alert-dot ck-alert-dot-info"></span>`;
  if (s === "ok")       return `<span class="ck-alert-dot ck-alert-dot-ok"></span>`;
  return "";
}
function activityIcon(type) {
  if (type === "INGRESO")         return "👤";
  if (type === "ACTUALIZACION")   return "✏️";
  if (type.includes("RETIRO"))    return "🚪";
  if (type.includes("INCAPACI"))  return "🏥";
  if (type.includes("VACACION"))  return "🏖️";
  if (type.includes("NOVEDAD"))   return "📋";
  return "📌";
}
function relativeTime(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return "Hace un momento";
  if (m < 60)  return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `Hace ${h} h`;
  const d = Math.floor(h / 24);
  return `Hace ${d} día(s)`;
}
const isOpsOnly = () => {
  const r = String(state.currentUser?.role || "").toLowerCase();
  return r === "operacion";
};

// ── Build API URL with filters ────────────────────────────────────────────────
function kpisUrl() {
  const p = new URLSearchParams();
  if (_munId)      p.set("municipality_id", _munId);
  if (_contractId) p.set("contract_id", _contractId);
  return "/dashboard/kpis" + (p.toString() ? "?" + p.toString() : "");
}

// ── Widget HTML generators ────────────────────────────────────────────────────

function htmlPersonalActivo() {
  return `
  <div class="ck-kpi-card ck-kpi-green ck-card-active" id="ck-card-personal" tabindex="0" role="button" title="Ver detalle">
    <div class="ck-kpi-icon">👥</div>
    <div class="ck-kpi-inner">
      <div class="ck-kpi-label">Personal Activo</div>
      <div class="ck-kpi-value" id="ck-v-active">—</div>
      <div class="ck-kpi-sub"   id="ck-s-active">cargando…</div>
    </div>
  </div>`;
}

function htmlCoberturaMapa() {
  return `
  <div class="ck-panel ck-panel-map" data-widget="cobertura_mapa">
    <div class="ck-panel-hdr">
      <span>🗺️ Mapa de Cobertura por Municipio</span>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="ck-sem-badge ck-sem-ok"       style="font-size:11px">✅ <span id="ck-cov-ok">—</span></span>
        <span class="ck-sem-badge ck-sem-warning"   style="font-size:11px">⚠️ <span id="ck-cov-warn">—</span></span>
        <span class="ck-sem-badge ck-sem-critical"  style="font-size:11px">🔴 <span id="ck-cov-crit">—</span></span>
      </div>
    </div>
    <div class="ck-panel-body ck-panel-scroll">
      <table class="ck-table">
        <thead><tr>
          <th>Municipio</th><th class="ck-th-num">Req.</th><th class="ck-th-num">Contr.</th>
          <th class="ck-th-num">%</th><th style="width:70px">Barra</th><th>Estado</th>
        </tr></thead>
        <tbody id="ck-cov-tbody"><tr><td colspan="6" class="ck-empty">Cargando…</td></tr></tbody>
      </table>
    </div>
  </div>`;
}

function htmlCoberturaTcMt() {
  return `
  <div class="ck-tc-mt-row" data-widget="cobertura_tc_mt">
    <div class="ck-tc-card ck-tc-blue">
      <div class="ck-tc-head">⏱ Tiempo Completo</div>
      <div class="ck-tc-stats">
        <div class="ck-tc-stat"><span class="ck-tc-lbl">TC REQ</span><span class="ck-tc-val" id="ck-v-tc-req">—</span></div>
        <div class="ck-tc-divider"></div>
        <div class="ck-tc-stat"><span class="ck-tc-lbl">TC CONT</span><span class="ck-tc-val" id="ck-v-tc-cont">—</span></div>
      </div>
      <div class="ck-tc-pct-row">
        <span id="ck-v-tc-pct" class="ck-tc-pct">—</span>
        <div class="ck-kpi-prog" style="flex:1"><div class="ck-kpi-prog-bar" id="ck-prog-tc"></div></div>
      </div>
    </div>
    <div class="ck-tc-card ck-tc-teal">
      <div class="ck-tc-head">⏰ Medio Tiempo</div>
      <div class="ck-tc-stats">
        <div class="ck-tc-stat"><span class="ck-tc-lbl">MT REQ</span><span class="ck-tc-val" id="ck-v-mt-req">—</span></div>
        <div class="ck-tc-divider"></div>
        <div class="ck-tc-stat"><span class="ck-tc-lbl">MT CONT</span><span class="ck-tc-val" id="ck-v-mt-cont">—</span></div>
      </div>
      <div class="ck-tc-pct-row">
        <span id="ck-v-mt-pct" class="ck-tc-pct">—</span>
        <div class="ck-kpi-prog" style="flex:1"><div class="ck-kpi-prog-bar" id="ck-prog-mt"></div></div>
      </div>
    </div>
  </div>`;
}

function htmlTc20Requerido() {
  return `
  <div class="ck-tc20-card" data-widget="tc20_requerido">
    <div class="ck-tc20-icon">📐</div>
    <div class="ck-tc20-body">
      <div class="ck-tc20-label">20% TC Requerido</div>
      <div class="ck-tc20-value" id="ck-v-tc20">—</div>
      <div class="ck-tc20-sub"   id="ck-s-tc20">cargando…</div>
    </div>
  </div>`;
}

function htmlGenderSplit() {
  return `
  <div class="ck-gender-row" data-widget="gender_split">
    <div class="ck-gender-card ck-gender-female">
      <div class="ck-gender-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="7" r="4"/>
          <path d="M8 12c-2 1.5-3 4-2.5 6.5C6 21 9 22 12 22s6-1 6.5-3.5C19 16 18 13.5 16 12"/>
          <path d="M9.5 12.5C10.5 14 11 15 12 15s1.5-1 2.5-2.5"/>
        </svg>
      </div>
      <div class="ck-gender-body">
        <div class="ck-gender-count" id="ck-v-female">—</div>
        <div class="ck-gender-lbl">Mujeres</div>
        <div class="ck-gender-breakdown">
          <span class="ck-gb-tag ck-gb-active">Activas <strong id="ck-v-female-active">—</strong></span>
          <span class="ck-gb-sep">·</span>
          <span class="ck-gb-tag ck-gb-inactive">Inactivas <strong id="ck-v-female-inactive">—</strong></span>
        </div>
      </div>
    </div>
    <div class="ck-gender-card ck-gender-male">
      <div class="ck-gender-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="7" r="4"/>
          <path d="M8 13c-2 1-3.5 3-3.5 5.5V22h15v-3.5C19.5 16 18 14 16 13"/>
          <line x1="12" y1="11" x2="12" y2="22"/>
        </svg>
      </div>
      <div class="ck-gender-body">
        <div class="ck-gender-count" id="ck-v-male">—</div>
        <div class="ck-gender-lbl">Hombres</div>
        <div class="ck-gender-breakdown">
          <span class="ck-gb-tag ck-gb-active">Activos <strong id="ck-v-male-active">—</strong></span>
          <span class="ck-gb-sep">·</span>
          <span class="ck-gb-tag ck-gb-inactive">Inactivos <strong id="ck-v-male-inactive">—</strong></span>
        </div>
      </div>
    </div>
  </div>`;
}

function htmlDistribucionEdad() {
  return `
  <div class="ck-panel" data-widget="distribucion_edad">
    <div class="ck-panel-hdr"><span>🎂 Distribución por Edad</span></div>
    <div class="ck-age-chart-wrap">
      <div class="ck-age-donut-container"><canvas id="ck-chart-age"></canvas></div>
      <div id="ck-age-legend" class="ck-age-legend"></div>
    </div>
  </div>`;
}

function htmlPersonalPorCargo() {
  return `
  <div class="ck-panel" data-widget="personal_por_cargo">
    <div class="ck-panel-hdr ck-cargo-hdr">
      <span>📋 Personal por Cargo</span>
      <div class="ck-cargo-controls">
        <input type="month" id="ck-cargo-month" class="ck-month-input" title="Filtrar por mes" />
        <div class="ck-cargo-tabs">
          <button class="ck-cargo-tab active" data-type="real">Cargo Real</button>
          <button class="ck-cargo-tab" data-type="licitacion">Licitación</button>
        </div>
      </div>
    </div>
    <div class="ck-panel-body ck-panel-scroll">
      <table class="ck-table ck-cargo-table">
        <thead><tr>
          <th class="ck-th-cargo">Cargo</th>
          <th class="ck-th-num">Activos</th>
          <th class="ck-th-num">Retirados</th>
        </tr></thead>
        <tbody id="ck-cargo-tbody"><tr><td colspan="3" class="ck-empty">Cargando…</td></tr></tbody>
      </table>
    </div>
  </div>`;
}

function htmlAlertas() {
  return `
  <div class="ck-panel ck-alerts-panel" data-widget="alertas">
    <div class="ck-panel-hdr">
      <span>🚨 Alertas del Sistema</span>
      <span id="ck-alert-count" class="ck-panel-badge ck-badge-green">—</span>
    </div>
    <div class="ck-panel-body ck-panel-scroll" id="ck-alerts-list">
      <div class="ck-empty">Cargando…</div>
    </div>
  </div>`;
}

// ── Widget map: id → html generator ──────────────────────────────────────────
const WIDGET_HTML = {
  personal_activo:    htmlPersonalActivo,
  cobertura_mapa:     htmlCoberturaMapa,
  cobertura_tc_mt:    htmlCoberturaTcMt,
  tc20_requerido:     htmlTc20Requerido,
  gender_split:       htmlGenderSplit,
  distribucion_edad:  htmlDistribucionEdad,
  personal_por_cargo: htmlPersonalPorCargo,
  alertas:            htmlAlertas,
};

// ── Build full dashboard HTML from config ─────────────────────────────────────
function buildDashboardHtml(orderedWidgets) {
  const visible = new Set(orderedWidgets.filter(w => w.visible).map(w => w.id));

  // KPI right-column widgets
  const rightColWidgets = ["personal_activo", "cobertura_tc_mt", "tc20_requerido"];
  const hasMap      = visible.has("cobertura_mapa");
  const hasRightCol = rightColWidgets.some(id => visible.has(id));
  const hasRow3     = visible.has("distribucion_edad") || visible.has("personal_por_cargo");

  const sections = [];

  // Main grid: coverage map + right KPI column
  if (hasMap || hasRightCol) {
    const leftHtml  = hasMap      ? htmlCoberturaMapa() : "";
    const rightHtml = hasRightCol ? `<div class="ck-right-col">${rightColWidgets.filter(id => visible.has(id)).map(id => WIDGET_HTML[id]()).join("")}</div>` : "";
    const gridMod   = !hasMap ? " ck-grid-no-left" : (!hasRightCol ? " ck-grid-no-right" : "");
    sections.push(`<div class="ck-main-grid${gridMod}">${leftHtml}${rightHtml}</div>`);
  }

  // Remaining widgets in config order (exclude those already rendered)
  const alreadyRendered = new Set(["cobertura_mapa", "personal_activo", "cobertura_tc_mt", "tc20_requerido"]);

  // Row-3 pair: edad + cargo (shown side-by-side)
  const row3Ids = ["distribucion_edad", "personal_por_cargo"];

  const remainingOrder = orderedWidgets
    .filter(w => w.visible && !alreadyRendered.has(w.id));

  for (const w of remainingOrder) {
    if (alreadyRendered.has(w.id)) continue;
    if (row3Ids.includes(w.id)) {
      // Collect consecutive row3 items and wrap together
      if (!alreadyRendered.has("__row3__")) {
        alreadyRendered.add("__row3__");
        const row3Html = row3Ids.filter(id => visible.has(id)).map(id => WIDGET_HTML[id]()).join("");
        sections.push(`<div class="ck-row3">${row3Html}</div>`);
        row3Ids.forEach(id => alreadyRendered.add(id));
      }
      continue;
    }
    if (WIDGET_HTML[w.id]) {
      sections.push(WIDGET_HTML[w.id]());
      alreadyRendered.add(w.id);
    }
  }

  return sections.join("\n");
}

// ── Render functions ──────────────────────────────────────────────────────────
function renderKpis(d) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const pct = d.pct_coverage;

  set("ck-v-active",   d.active ?? "—");
  set("ck-s-active",   `${d.total ?? 0} total · ${d.inactive ?? 0} inactivos`);
  set("ck-v-tc-req",   d.required_tc ?? "—");
  set("ck-v-tc-cont",  d.tc_count ?? "—");
  set("ck-v-mt-req",   d.required_mt ?? "—");
  set("ck-v-mt-cont",  d.mt_count ?? "—");
  set("ck-v-tc20",     d.tc_20pct ?? "—");
  set("ck-s-tc20",     `20% de ${d.required_tc ?? 0} TC requeridos`);

  const tcPct = d.required_tc ? Math.round((d.tc_count / d.required_tc) * 100) : null;
  const mtPct = d.required_mt ? Math.round((d.mt_count / d.required_mt) * 100) : null;
  const tcBar = document.getElementById("ck-prog-tc");
  const mtBar = document.getElementById("ck-prog-mt");
  if (tcBar) { tcBar.style.width = Math.min(tcPct ?? 0, 100) + "%"; tcBar.style.background = semColor(tcPct); }
  if (mtBar) { mtBar.style.width = Math.min(mtPct ?? 0, 100) + "%"; mtBar.style.background = semColor(mtPct); }

  const tcPctEl = document.getElementById("ck-v-tc-pct");
  const mtPctEl = document.getElementById("ck-v-mt-pct");
  if (tcPctEl) { tcPctEl.textContent = tcPct !== null ? tcPct + "%" : "—"; tcPctEl.style.color = semColor(tcPct); }
  if (mtPctEl) { mtPctEl.textContent = mtPct !== null ? mtPct + "%" : "—"; mtPctEl.style.color = semColor(mtPct); }

  set("ck-v-docs",    (d.expiring_soon_docs ?? 0) + (d.pending_docs ?? 0));
  set("ck-v-payroll", isOpsOnly() ? "—" : fmtCOP(d.payroll_total));

  set("ck-v-female",          d.female_active   ?? "—");
  set("ck-v-female-active",   d.female_active   ?? "—");
  set("ck-v-female-inactive", d.female_inactive ?? "—");
  set("ck-v-male",            d.male_active     ?? "—");
  set("ck-v-male-active",     d.male_active     ?? "—");
  set("ck-v-male-inactive",   d.male_inactive   ?? "—");

  set("ck-last-update", new Date().toLocaleTimeString("es-CO"));

  const ageWrap = document.getElementById("ck-age-bars");
  if (ageWrap && d.age_brackets) {
    const brackets = d.age_brackets;
    const maxVal = Math.max(1, ...Object.values(brackets));
    ageWrap.innerHTML = Object.entries(brackets).map(([label, count]) => {
      const p = Math.round((count / maxVal) * 100);
      return `<div class="ck-age-row">
        <span class="ck-age-label">${label}</span>
        <div class="ck-age-track"><div class="ck-age-fill" style="width:${p}%"></div></div>
        <span class="ck-age-count">${count}</span>
      </div>`;
    }).join("");
  }

  const novBadge = document.getElementById("ck-novelty-badge");
  if (novBadge) {
    const nov = d.pending_novelties ?? 0;
    novBadge.textContent = nov > 0 ? nov + " pend." : "Al día";
    novBadge.className = "ck-kpi-badge " + (nov > 0 ? "ck-badge-yellow" : "ck-badge-green");
  }
}

function renderMunFilter(list) {
  const sel = document.getElementById("ck-filter-mun");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="">Todos los municipios</option>` +
    list.map(m => `<option value="${m.id}" ${String(m.id) === String(prev) ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("");
}

function renderCoverageMap(rows) {
  const tbody = document.getElementById("ck-cov-tbody");
  if (!tbody) return;
  const ok   = rows.filter(r => r.status === "ok").length;
  const warn = rows.filter(r => r.status === "warning").length;
  const crit = rows.filter(r => r.status === "critical").length;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("ck-cov-ok", ok); set("ck-cov-warn", warn); set("ck-cov-crit", crit);
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="6" class="ck-empty">Sin datos de cobertura</td></tr>`; return; }
  tbody.innerHTML = rows.map(r => {
    const pct = r.coverage_pct;
    const cls = semClass(r.status);
    const bar = pct !== null
      ? `<div class="ck-mini-bar"><div class="ck-mini-bar-fill" style="width:${Math.min(pct,100)}%;background:${semColor(pct)}"></div></div>`
      : `<div class="ck-mini-bar"></div>`;
    return `<tr>
      <td class="ck-td-mun" title="${escapeHtml(r.municipality_name)}">${escapeHtml(r.municipality_name)}</td>
      <td class="ck-td-num">${r.required}</td>
      <td class="ck-td-num">${r.contracted}</td>
      <td class="ck-td-num" style="font-weight:600;color:${semColor(pct)}">${pct !== null ? pct + "%" : "—"}</td>
      <td>${bar}</td>
      <td><span class="${cls} ck-sem-badge">${r.status === "ok" ? "OK" : r.status === "warning" ? "Alerta" : r.status === "critical" ? "Crítico" : "S/D"}</span></td>
    </tr>`;
  }).join("");
}

function renderAlerts(alerts) {
  const list = document.getElementById("ck-alerts-list");
  if (!list) return;
  if (!alerts.length) { list.innerHTML = `<div class="ck-alert-ok">Sin alertas activas</div>`; return; }
  const countEl = document.getElementById("ck-alert-count");
  if (countEl) {
    const critical = alerts.filter(a => a.severity === "critical").length;
    countEl.textContent = critical > 0 ? critical + " críticas" : alerts.length + " alertas";
    countEl.className = "ck-panel-badge " + (critical > 0 ? "ck-badge-red" : "ck-badge-yellow");
  }
  list.innerHTML = alerts.map(a => {
    const action = a.action_url && a.action_url !== "#" && a.severity !== "ok"
      ? `<a href="${escapeHtml(a.action_url)}" class="ck-alert-action">Ver →</a>` : "";
    return `<div class="ck-alert-item ck-alert-${a.severity}">
      <div class="ck-alert-left">${severityIcon(a.severity)}<span class="ck-alert-msg">${escapeHtml(a.message)}</span></div>
      ${action}
    </div>`;
  }).join("");
  list.querySelectorAll("a.ck-alert-action[href^='#']").forEach(a => {
    a.addEventListener("click", e => {
      e.preventDefault();
      const navBtn = document.querySelector(`[data-module="${a.getAttribute("href").slice(1)}"]`);
      if (navBtn) navBtn.click();
    });
  });
}

function renderActivity(items) {
  const feed = document.getElementById("ck-activity-feed");
  if (!feed) return;
  if (!items.length) { feed.innerHTML = `<div class="ck-empty">Sin actividad reciente</div>`; return; }
  feed.innerHTML = items.slice(0, 10).map(item => `
    <div class="ck-activity-item">
      <div class="ck-activity-icon">${activityIcon(item.type)}</div>
      <div class="ck-activity-body">
        <div class="ck-activity-desc">${escapeHtml(item.description)}</div>
        <div class="ck-activity-time">${relativeTime(item.timestamp)}</div>
      </div>
    </div>`).join("");
}

const AGE_COLORS = ["#6366f1","#3b82f6","#06b6d4","#10b981","#f59e0b","#ef4444"];

async function renderAgeChart(brackets) {
  const canvas = document.getElementById("ck-chart-age");
  const legend = document.getElementById("ck-age-legend");
  if (!canvas || !brackets) return;
  await loadChartJs();
  const Chart = window.Chart;
  if (!Chart) return;
  if (_charts.age) { try { _charts.age.destroy(); } catch {} }
  const labels = Object.keys(brackets);
  const values = Object.values(brackets);
  const total  = values.reduce((s, v) => s + v, 0) || 1;
  _charts.age = new Chart(canvas, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: AGE_COLORS, borderWidth: 2, borderColor: "#fff", hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} (${Math.round(ctx.parsed/total*100)}%)` } },
      },
    },
  });
  if (legend) {
    legend.innerHTML = labels.map((lbl, i) => `
      <div class="ck-age-leg-item">
        <span class="ck-age-leg-dot" style="background:${AGE_COLORS[i]}"></span>
        <span class="ck-age-leg-lbl">${lbl} años</span>
        <span class="ck-age-leg-val">${values[i]}</span>
        <span class="ck-age-leg-pct">${Math.round(values[i]/total*100)}%</span>
      </div>`).join("");
  }
}

function renderCargoTable(rows) {
  const tbody = document.getElementById("ck-cargo-tbody");
  if (!tbody) return;
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="3" class="ck-empty">Sin datos para este período</td></tr>`; return; }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="ck-td-cargo" title="${escapeHtml(r.cargo)}">${escapeHtml(r.cargo)}</td>
      <td class="ck-td-num ck-td-active">${r.active}</td>
      <td class="ck-td-num ck-td-retired">${r.retired}</td>
    </tr>`).join("");
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(title, html) {
  const overlay = document.getElementById("ck-modal");
  const titleEl = document.getElementById("ck-modal-title");
  const bodyEl  = document.getElementById("ck-modal-body");
  if (!overlay) return;
  titleEl.textContent = title;
  bodyEl.innerHTML    = html;
  overlay.removeAttribute("hidden");
}
function closeModal() {
  document.getElementById("ck-modal")?.setAttribute("hidden", "");
}
function kpiDetailHtml_personal(d) {
  const ageBrackets = d.age_brackets || {};
  const ageHtml = Object.entries(ageBrackets).map(([label, val]) =>
    `<div class="ck-modal-stat"><div class="ck-modal-stat-val">${val}</div><div class="ck-modal-stat-lbl">${label} años</div></div>`
  ).join("");
  return `<div class="ck-modal-grid">
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.active}</div><div class="ck-modal-stat-lbl">Activos</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.inactive}</div><div class="ck-modal-stat-lbl">Inactivos</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.novelty}</div><div class="ck-modal-stat-lbl">Novedad</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.total}</div><div class="ck-modal-stat-lbl">Total</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.tc_count}</div><div class="ck-modal-stat-lbl">TC</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.mt_count}</div><div class="ck-modal-stat-lbl">MT</div></div>
    <div class="ck-modal-stat" style="border-top:1px solid #f1f5f9;padding-top:8px"><div class="ck-modal-stat-val" style="color:#db2777">${d.female_active ?? 0}</div><div class="ck-modal-stat-lbl">♀ Mujeres activas</div></div>
    <div class="ck-modal-stat" style="border-top:1px solid #f1f5f9;padding-top:8px"><div class="ck-modal-stat-val" style="color:#2563eb">${d.male_active ?? 0}</div><div class="ck-modal-stat-lbl">♂ Hombres activos</div></div>
    <div class="ck-modal-stat" style="border-top:1px solid #f1f5f9;padding-top:8px"><div class="ck-modal-stat-val" style="color:#7c3aed">${d.tc_20pct ?? 0}</div><div class="ck-modal-stat-lbl">20% TC requerido</div></div>
  </div>
  ${ageHtml ? `<p class="ck-modal-note" style="margin-top:12px;font-weight:600">Edades (activos):</p><div class="ck-modal-grid" style="margin-top:6px">${ageHtml}</div>` : ""}`;
}
function kpiDetailHtml_coverage(d) {
  const pct = d.pct_coverage;
  return `<div class="ck-modal-grid">
    <div class="ck-modal-stat"><div class="ck-modal-stat-val" style="color:${semColor(pct)}">${pct !== null ? pct + "%" : "—"}</div><div class="ck-modal-stat-lbl">Cobertura global</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.required}</div><div class="ck-modal-stat-lbl">Requeridos total</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.contracted}</div><div class="ck-modal-stat-lbl">Contratados activos</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.required_tc}</div><div class="ck-modal-stat-lbl">Req. TC</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.tc_count}</div><div class="ck-modal-stat-lbl">Contrat. TC</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.required_mt}</div><div class="ck-modal-stat-lbl">Req. MT</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.mt_count}</div><div class="ck-modal-stat-lbl">Contrat. MT</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.municipalities_covered}</div><div class="ck-modal-stat-lbl">Municipios con cobertura</div></div>
  </div>`;
}
function kpiDetailHtml_docs(d) {
  return `<div class="ck-modal-grid">
    <div class="ck-modal-stat"><div class="ck-modal-stat-val ck-val-warn">${d.expiring_soon_docs}</div><div class="ck-modal-stat-lbl">Certificados próx. a vencer (30 días)</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val ck-val-crit">${d.pending_docs}</div><div class="ck-modal-stat-lbl">Sin certificado de manipulación</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val ck-val-warn">${d.pending_novelties}</div><div class="ck-modal-stat-lbl">Novedades pendientes</div></div>
  </div>
  <p class="ck-modal-note">Aplica solo a empleados con estado ACTIVO.</p>`;
}
function kpiDetailHtml_payroll(d) {
  return `<div class="ck-modal-grid">
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${fmtCOP(d.payroll_total)}</div><div class="ck-modal-stat-lbl">Nómina estimada mensual</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.tc_count}</div><div class="ck-modal-stat-lbl">Empleados TC</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.mt_count}</div><div class="ck-modal-stat-lbl">Empleados MT</div></div>
    <div class="ck-modal-stat"><div class="ck-modal-stat-val">${d.pending_novelties}</div><div class="ck-modal-stat-lbl">Novedades pendientes</div></div>
  </div>
  <p class="ck-modal-note">Estimación: TC × SMLMV + MT × SMLMV/2. No incluye prestaciones.</p>`;
}

// ── Full refresh ──────────────────────────────────────────────────────────────
async function refreshAll() {
  const hasCovMap   = !!document.getElementById("ck-cov-tbody");
  const hasCargo    = !!document.getElementById("ck-cargo-tbody");
  const hasAlerts   = !!document.getElementById("ck-alerts-list");

  const fetches = [apiFetch(kpisUrl())];
  if (hasCovMap) fetches.push(apiFetch("/dashboard/coverage-map")); else fetches.push(Promise.resolve({ data: [] }));
  if (hasCargo && !isOpsOnly()) fetches.push(apiFetch(`/dashboard/staff-by-cargo?type=${_cargoType}`)); else fetches.push(Promise.resolve({ data: [] }));
  if (hasAlerts) fetches.push(apiFetch("/dashboard/alerts")); else fetches.push(Promise.resolve({ data: [] }));

  const [kpisRes, covRes, cargoRes, alertsRes] = await Promise.all(fetches);

  const d = kpisRes?.data || {};
  renderKpis(d);
  if (d.municipalities_list?.length) renderMunFilter(d.municipalities_list);
  renderCoverageMap(covRes?.data || []);
  if (d.age_brackets) await renderAgeChart(d.age_brackets);
  renderCargoTable(cargoRes?.data || []);
  renderAlerts(alertsRes?.data || []);
}

// ── Main loader ───────────────────────────────────────────────────────────────
export async function loadDashboardModule() {
  _clearDashboardTimers();

  // 1. Fetch widget config for this contract
  let widgetConfig = [];
  try {
    const cfgRes = await apiFetch("/module-config/dashboard");
    widgetConfig = cfgRes?.data || [];
    _widgetConfig = widgetConfig;
  } catch {
    // fall back to showing all widgets
    _widgetConfig = [];
  }

  // 2. Build dynamic content
  const contentHtml = buildDashboardHtml(widgetConfig);

  const html = `
<div class="personnel-premium-module">
<article class="personnel-premium-card">
<div class="ck-wrap">

  <section class="personnel-premium-hero ck-hero">
    <div>
      <span class="personnel-premium-eyebrow">Módulo operativo</span>
      <h2>Dashboard</h2>
      <p>Estado operativo en tiempo real — personal, cobertura y alertas PAE.</p>
    </div>
    <div class="ck-filters">
      <select id="ck-filter-mun" class="ck-select" title="Filtrar por municipio">
        <option value="">Todos los municipios</option>
      </select>
      <button id="ck-btn-refresh" class="btn btn-secondary">↺ Actualizar</button>
    </div>
  </section>

  ${contentHtml}

  <div class="ck-footer">
    Última actualización: <span id="ck-last-update">—</span>
    &nbsp;·&nbsp; Auto-refresh 60 s
  </div>

</div>
</article>
</div>

<div class="ck-modal-overlay" id="ck-modal" hidden>
  <div class="ck-modal">
    <div class="ck-modal-hdr">
      <span id="ck-modal-title" class="ck-modal-title">Detalle</span>
      <button id="ck-modal-close" class="ck-modal-close" aria-label="Cerrar">×</button>
    </div>
    <div class="ck-modal-body" id="ck-modal-body"></div>
  </div>
</div>`;

  setTimeout(async () => {
    let kpisData = {};
    try {
      await refreshAll();
      const kpisRes = await apiFetch(kpisUrl());
      kpisData = kpisRes?.data || {};
    } catch (err) {
      console.error("Dashboard init error", err);
    }

    // KPI cards → modal
    const bindCard = (cardId, title, htmlFn) => {
      const card = document.getElementById(cardId);
      if (!card) return;
      const open = () => apiFetch(kpisUrl()).then(r => openModal(title, htmlFn(r?.data || {})));
      card.addEventListener("click",   open);
      card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") open(); });
    };
    bindCard("ck-card-personal", "Personal — Detalle",    kpiDetailHtml_personal);
    bindCard("ck-card-coverage", "Cobertura — Detalle",   kpiDetailHtml_coverage);
    bindCard("ck-card-docs",     "Documentos — Detalle",  kpiDetailHtml_docs);
    if (!isOpsOnly()) bindCard("ck-card-payroll", "Nómina — Detalle", kpiDetailHtml_payroll);

    document.getElementById("ck-modal-close")?.addEventListener("click", closeModal);
    document.getElementById("ck-modal")?.addEventListener("click", e => { if (e.target.id === "ck-modal") closeModal(); });

    const fetchCargo = async () => {
      try {
        const p = new URLSearchParams({ type: _cargoType });
        if (_cargoMonth) p.set("month", _cargoMonth);
        renderCargoTable((await apiFetch(`/dashboard/staff-by-cargo?${p}`))?.data || []);
      } catch { showError("No se pudo cargar cargos"); }
    };
    document.querySelectorAll(".ck-cargo-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".ck-cargo-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        _cargoType = btn.dataset.type;
        fetchCargo();
      });
    });
    document.getElementById("ck-cargo-month")?.addEventListener("change", e => { _cargoMonth = e.target.value; fetchCargo(); });

    document.getElementById("ck-filter-mun")?.addEventListener("change", async e => {
      _munId = e.target.value;
      try { await refreshAll(); } catch { showError("No se pudo aplicar el filtro"); }
    });

    const btn = document.getElementById("ck-btn-refresh");
    if (btn) {
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "↺ Actualizando…";
        try { await refreshAll(); showSuccess("Dashboard actualizado"); }
        catch { showError("No se pudo actualizar"); }
        finally { btn.disabled = false; btn.textContent = "↺ Actualizar"; }
      });
    }

    _timer = setInterval(async () => { try { await refreshAll(); } catch { /* silent */ } }, 60_000);
  }, 80);

  return html;
}
