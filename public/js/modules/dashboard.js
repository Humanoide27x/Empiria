import { apiFetch } from "../api.js";
import { escapeHtml } from "../utils.js";
import { showSuccess, showError } from "../toast.js";
import { dashboardCleaner } from "../nav.js";

const ROOT_ID = "dashboardWorkspacePremiumRoot";
const REFRESH_MS = 60_000;
const MONTHS_ES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const ICON_PEOPLE = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="4" r="2.5" fill="currentColor" opacity=".8"/><path d="M1.5 12.5C1.5 10 4 8 7 8s5.5 2 5.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none" opacity=".8"/></svg>`;
const ICON_TC = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_MT = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M7 4v3l2 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_PCT = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="4" cy="4" r="1.8" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="1.8" stroke="currentColor" stroke-width="1.4"/><line x1="3.5" y1="11" x2="10.5" y2="3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICON_MAP = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5C4.8 1.5 3 3.3 3 5.5c0 3.2 4 7.5 4 7.5s4-4.3 4-7.5C11 3.3 9.2 1.5 7 1.5z" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="7" cy="5.5" r="1.4" fill="currentColor"/></svg>`;
const ICON_REFRESH = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11.5 7A4.5 4.5 0 1 1 8.5 2.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8.5 1v2.5H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

let _timer = null;
let _selectedMunicipalityId = "";

export function _clearDashboardTimers() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _selectedMunicipalityId = "";
}

dashboardCleaner.fn = _clearDashboardTimers;

function getStatusMeta(status) {
  const value = String(status || "").toUpperCase();
  if (value === "ESTABLE") return { label: "Estable", color: "#2ECF9A" };
  if (value === "ALERTA") return { label: "Alerta", color: "#F7C948" };
  if (value === "CRITICO") return { label: "Critico", color: "#FF4D4F" };
  return { label: "Sin operacion", color: "#CBD5E1" };
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("es-CO");
}

function formatMonthDay(day, month) {
  return `${String(day || 0).padStart(2, "0")} ${MONTHS_ES[Number(month) || 0] || ""}`.trim();
}

function formatEventDate(date, time) {
  if (!date) return "Sin fecha";
  const parts = String(date).split("-");
  if (parts.length !== 3) return escapeHtml(String(date));
  const [, month, day] = parts;
  const timeLabel = time ? ` · ${String(time).slice(0, 5)}` : "";
  return `${Number(day)} ${MONTHS_ES[Number(month)] || month}${timeLabel}`;
}

function getMunicipalityOptions(summary = {}) {
  const rows = Array.isArray(summary.coverageByMunicipality) ? summary.coverageByMunicipality : [];
  const map = new Map();
  rows.forEach((item) => {
    if (!item || item.municipalityId == null) return;
    const id = String(item.municipalityId);
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: item.municipalityName || "Sin municipio",
      });
    }
  });
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function buildLoadingState() {
  return `
    <article class="dashboard-card">
      <div class="dashboard-empty-state">
        <div>
          <strong>Cargando dashboard</strong>
          <p>Consultando resumen operativo en tiempo real...</p>
        </div>
      </div>
    </article>
  `;
}

function buildErrorState(message) {
  return `
    <article class="dashboard-card">
      <div class="dashboard-empty-state">
        <div>
          <strong>No se pudo cargar el dashboard</strong>
          <p>${escapeHtml(message || "Ocurrio un error inesperado")}</p>
        </div>
      </div>
    </article>
  `;
}

function buildEmptyState(message) {
  return `<div class="dashboard-empty-state"><div><strong>${escapeHtml(message)}</strong></div></div>`;
}

function buildGauge(percent, status) {
  const safePercent = Math.max(0, Math.min(100, Number(percent || 0)));
  const meta = getStatusMeta(status);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const stroke = (safePercent / 100) * circumference;

  return `
    <div class="dashboard-gauge">
      <svg viewBox="0 0 140 140" role="img" aria-label="Cobertura ${safePercent}%">
        <circle cx="70" cy="70" r="${radius}" fill="none" stroke="#E8EEF8" stroke-width="12"></circle>
        <circle
          cx="70"
          cy="70"
          r="${radius}"
          fill="none"
          stroke="${meta.color}"
          stroke-width="12"
          stroke-linecap="round"
          transform="rotate(-90 70 70)"
          stroke-dasharray="${stroke} ${circumference}"
        ></circle>
      </svg>
      <div class="dashboard-gauge-center">
        <strong>${safePercent}%</strong>
        <span>${escapeHtml(meta.label)}</span>
      </div>
    </div>
  `;
}

function buildDonutBackground(items = []) {
  const safeItems = items.filter((item) => Number(item.value || 0) > 0);
  const total = safeItems.reduce((sum, item) => sum + Number(item.value || 0), 0);
  if (!total) return "conic-gradient(#E8EEF8 0deg 360deg)";

  let currentAngle = 0;
  const segments = safeItems.map((item) => {
    const nextAngle = currentAngle + (Number(item.value || 0) / total) * 360;
    const segment = `${item.color || "#0B7CFF"} ${currentAngle}deg ${nextAngle}deg`;
    currentAngle = nextAngle;
    return segment;
  });

  return `conic-gradient(${segments.join(", ")})`;
}

function buildDonut(items = [], totalLabel = "Total") {
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
  return `
    <div class="dashboard-donut" style="background:${buildDonutBackground(items)}">
      <div class="dashboard-donut-center">
        <strong>${formatNumber(total)}</strong>
        <span>${escapeHtml(totalLabel)}</span>
      </div>
    </div>
  `;
}

function buildSideList(items = [], total = 0) {
  if (!items.length) return buildEmptyState("Sin datos disponibles");

  return `
    <div class="dashboard-side-list">
      ${items.map((item) => {
        const value = Number(item.value || 0);
        const percent = total > 0 ? Math.round((value / total) * 100) : 0;
        return `
          <div class="dashboard-side-list-item">
            <div class="dashboard-side-list-label">
              <span class="dashboard-dot" style="background:${item.color || "#0B7CFF"}"></span>
              <span>${escapeHtml(item.label || "Sin dato")}</span>
            </div>
            <div class="dashboard-side-list-value">
              <strong>${formatNumber(value)}</strong>
              <small>${percent}%</small>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function buildBarChart(items = [], emptyMessage = "Sin datos disponibles") {
  const safeItems = items.filter((item) => Number(item.value || 0) > 0);
  if (!safeItems.length) return buildEmptyState(emptyMessage);

  const maxValue = Math.max(...safeItems.map((item) => Number(item.value || 0)), 1);
  const total = safeItems.reduce((sum, item) => sum + Number(item.value || 0), 0);

  return `
    <div class="dashboard-bar-chart">
      ${safeItems.map((item) => {
        const value = Number(item.value || 0);
        const width = Math.max(8, Math.round((value / maxValue) * 100));
        const percent = total > 0 ? Math.round((value / total) * 100) : 0;
        return `
          <div class="dashboard-bar-row">
            <div class="dashboard-bar-row-head">
              <span>${escapeHtml(item.label || "Sin dato")}</span>
              <strong>${formatNumber(value)} · ${percent}%</strong>
            </div>
            <div class="dashboard-bar-track">
              <div class="dashboard-bar-fill" style="width:${width}%;background:${item.color || "#0B7CFF"}"></div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function getCoverageTiles(rows = []) {
  return rows.map((item) => {
    const meta = getStatusMeta(item.coverageStatus);
    return {
      id: item.municipalityId ?? item.municipalityName,
      name: item.municipalityName || "Sin municipio",
      statusLabel: meta.label,
      color: meta.color,
      requiredTotal: Number(item.requiredTotal || item.requiredTc || 0) + Number(item.requiredMt || 0) - Number(item.requiredTc || 0),
      contractedTotal: Number(item.contractedTotal || item.contractedTc || 0) + Number(item.contractedMt || 0) - Number(item.contractedTc || 0),
      requiredTc: Number(item.requiredTc || 0),
      contractedTc: Number(item.contractedTc || 0),
      requiredMt: Number(item.requiredMt || 0),
      contractedMt: Number(item.contractedMt || 0),
      coveragePercent: Number(item.coveragePercent || 0),
    };
  }).map((item) => ({
    ...item,
    requiredTotal: Number(item.requiredTc || 0) + Number(item.requiredMt || 0),
    contractedTotal: Number(item.contractedTc || 0) + Number(item.contractedMt || 0),
  }));
}

function shortMunicipality(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "N/A";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function buildCoverageMap(rows = []) {
  if (!rows.length) return buildEmptyState("Sin datos de cobertura");

  const columns = rows.length <= 4 ? 2 : rows.length <= 8 ? 3 : 4;
  const tileWidth = 150;
  const tileHeight = 84;
  const gap = 16;
  const width = columns * tileWidth + (columns - 1) * gap;
  const rowCount = Math.ceil(rows.length / columns);
  const height = rowCount * tileHeight + (rowCount - 1) * gap;

  return `
    <svg class="dashboard-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cobertura operativa por municipio">
      ${rows.map((item, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const x = col * (tileWidth + gap);
        const y = row * (tileHeight + gap) + (col % 2 === 1 ? 6 : 0);
        const coverageLabel = item.requiredTotal > 0 ? `${item.coveragePercent}%` : "S/O";
        return `
          <g transform="translate(${x} ${y})">
            <path
              d="M16 0 H132 Q150 0 150 16 V48 Q150 67 134 73 L92 84 H16 Q0 84 0 68 V16 Q0 0 16 0 Z"
              fill="${item.color}"
              fill-opacity="0.10"
              stroke="${item.color}"
              stroke-width="2"
            ></path>
            <text x="16" y="24" class="dashboard-map-code">${escapeHtml(shortMunicipality(item.name))}</text>
            <text x="16" y="46" class="dashboard-map-name">${escapeHtml(item.name)}</text>
            <text x="16" y="66" class="dashboard-map-pct">${escapeHtml(coverageLabel)}</text>
          </g>
        `;
      }).join("")}
    </svg>
  `;
}

function buildCoverageList(rows = []) {
  if (!rows.length) return buildEmptyState("Sin municipios operativos");

  return `
    <div class="dashboard-side-list">
      ${rows.map((item) => {
        const percentLabel = item.requiredTotal > 0 ? `${item.coveragePercent}%` : "S/O";
        return `
          <div class="dashboard-side-list-item">
            <div class="dashboard-side-list-label">
              <span class="dashboard-dot" style="background:${item.color}"></span>
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <small>TC ${formatNumber(item.contractedTc)}/${formatNumber(item.requiredTc)} · MT ${formatNumber(item.contractedMt)}/${formatNumber(item.requiredMt)}</small>
              </div>
            </div>
            <div class="dashboard-side-list-value">
              <strong>${escapeHtml(percentLabel)}</strong>
              <small>${escapeHtml(item.statusLabel)}</small>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function buildAgendaList(items = [], type) {
  if (!items.length) {
    return buildEmptyState(type === "birthday" ? "Sin cumpleanos este mes" : "Sin proximos eventos");
  }

  return `
    <div class="dashboard-side-list">
      ${items.map((item) => {
        const title = type === "birthday" ? item.name : item.title;
        const badge = type === "birthday"
          ? formatMonthDay(item.day, item.month)
          : formatEventDate(item.date, item.time);
        const meta = type === "birthday"
          ? [item.position, item.municipality].filter(Boolean).join(" · ")
          : (item.description || "Evento programado");

        return `
          <div class="dashboard-side-list-item">
            <div class="dashboard-date-pill">${escapeHtml(badge || "—")}</div>
            <div class="dashboard-side-list-copy">
              <strong>${escapeHtml(title || "Sin dato")}</strong>
              <small>${escapeHtml(meta || "Sin detalle")}</small>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function buildTopKpi(valueLabel, title, subtitle, accent = "#0B7CFF", icon = "") {
  return `
    <article class="dashboard-kpi-card" style="--kpi-accent:${accent}">
      <div class="dkpi-row">
        <span>${escapeHtml(title)}</span>
        ${icon ? `<div class="dkpi-icon" style="background:${accent}1A;color:${accent}">${icon}</div>` : ""}
      </div>
      <strong>${escapeHtml(valueLabel)}</strong>
      <small>${escapeHtml(subtitle)}</small>
    </article>
  `;
}

function buildWorkspace(summary = {}) {
  const coverageRows = getCoverageTiles(Array.isArray(summary.coverageByMunicipality) ? summary.coverageByMunicipality : []);
  const municipalities = getMunicipalityOptions(summary);
  const genderItems = Array.isArray(summary.employeesByGender) ? summary.employeesByGender : [];
  const modalityItems = Array.isArray(summary.employeesByModality) ? summary.employeesByModality : [];
  const ageItems = Array.isArray(summary.employeesByAgeRange) ? summary.employeesByAgeRange : [];
  const areaItems = Array.isArray(summary.employeesByArea) ? summary.employeesByArea : [];
  const birthdays = Array.isArray(summary.birthdaysThisMonth) ? summary.birthdaysThisMonth : [];
  const events = Array.isArray(summary.upcomingEvents) ? summary.upcomingEvents : [];
  const genderTotal = genderItems.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const modalityTotal = modalityItems.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const statusMeta = getStatusMeta(summary.coverageStatus);

  return `
    <section class="dashboard-kpi-grid">
      ${buildTopKpi(formatNumber(summary.activeEmployees), "Empleados activos", "Personal activo en base real", "#0B7CFF", ICON_PEOPLE)}
      ${buildTopKpi(`${formatNumber(summary.requiredTc)} / ${formatNumber(summary.contractedTc)}`, "TC Req · TC Cont", "Cobertura tiempo completo", "#2ECF9A", ICON_TC)}
      ${buildTopKpi(`${formatNumber(summary.requiredMt)} / ${formatNumber(summary.contractedMt)}`, "MT Req · MT Cont", "Cobertura medio tiempo", "#8B5CF6", ICON_MT)}
      ${buildTopKpi(formatNumber(summary.required20PercentTc), "20% TC Requerido", "Proyeccion minima requerida", "#F59E0B", ICON_PCT)}

      <article class="dashboard-kpi-card" style="--kpi-accent:#64748B">
        <div class="dkpi-row">
          <span>Municipios</span>
          <div class="dkpi-icon" style="background:#64748B1A;color:#64748B">${ICON_MAP}</div>
        </div>
        <select id="dashboardSummaryMunicipality">
          <option value="">Todos los municipios</option>
          ${municipalities.map((item) => `
            <option value="${escapeHtml(item.id)}" ${String(item.id) === String(_selectedMunicipalityId) ? "selected" : ""}>
              ${escapeHtml(item.name)}
            </option>
          `).join("")}
        </select>
        <small>${municipalities.length ? `${municipalities.length} municipio(s) disponibles` : "Sin municipios disponibles"}</small>
      </article>

      <button type="button" class="dashboard-kpi-card dashboard-kpi-card--action" id="dashboardSummaryRefresh">
        <div class="dkpi-row">
          <span>Actualizar datos</span>
          <div class="dkpi-icon" style="background:rgba(255,255,255,0.18);color:#fff">${ICON_REFRESH}</div>
        </div>
        <strong>En tiempo real</strong>
        <small>Refrescar resumen operativo</small>
      </button>
    </section>

    <section class="dashboard-main-grid">
      <div class="dashboard-column-stack dashboard-column-stack--left">
        <article class="dashboard-card dashboard-card--state">
          <div class="dashboard-card-head">
            <div>
              <p>Estado general de la operacion</p>
              <h3 style="color:${statusMeta.color}">${escapeHtml(statusMeta.label)}</h3>
            </div>
            <span class="dashboard-card-pill" style="background:${statusMeta.color}1A;color:${statusMeta.color};border-color:${statusMeta.color}30">${formatNumber(summary.coveragePercent)}%</span>
          </div>

          <div class="dashboard-card-body dashboard-card-body--state">
            ${buildGauge(summary.coveragePercent, summary.coverageStatus)}

            <div class="dashboard-side-list">
              <div class="dashboard-side-list-item">
                <div class="dashboard-side-list-label">
                  <span class="dashboard-dot" style="background:#2ECF9A"></span>
                  <span>Estable</span>
                </div>
                <div class="dashboard-side-list-value"><strong>OK</strong></div>
              </div>
              <div class="dashboard-side-list-item">
                <div class="dashboard-side-list-label">
                  <span class="dashboard-dot" style="background:#F7C948"></span>
                  <span>Alerta</span>
                </div>
                <div class="dashboard-side-list-value"><strong>Atencion</strong></div>
              </div>
              <div class="dashboard-side-list-item">
                <div class="dashboard-side-list-label">
                  <span class="dashboard-dot" style="background:#FF4D4F"></span>
                  <span>Critico</span>
                </div>
                <div class="dashboard-side-list-value"><strong>Riesgo</strong></div>
              </div>
            </div>
          </div>
        </article>

        <article class="dashboard-card dashboard-card--gender">
          <div class="dashboard-card-head">
            <div>
              <p>Distribucion por genero</p>
              <h3>Composicion activa</h3>
            </div>
          </div>

          <div class="dashboard-card-body dashboard-card-body--distribution">
            ${buildDonut(genderItems, "personas")}
            ${buildSideList(genderItems, genderTotal)}
          </div>
        </article>
      </div>

      <article class="dashboard-card dashboard-card--coverage">
        <div class="dashboard-card-head">
          <div>
            <p>Cobertura operativa en tiempo real</p>
            <h3>Municipios en operacion</h3>
          </div>
          <span class="dashboard-card-pill">${coverageRows.length}</span>
        </div>

        <div class="dashboard-card-body dashboard-card-body--map">
          <div class="dashboard-map-wrap">${buildCoverageMap(coverageRows)}</div>
          <div class="dashboard-side-panel">${buildCoverageList(coverageRows)}</div>
        </div>

        <div class="dashboard-legend">
          <span><i style="background:#2ECF9A"></i>Estable</span>
          <span><i style="background:#F7C948"></i>Alerta</span>
          <span><i style="background:#FF4D4F"></i>Critico</span>
          <span><i style="background:#CBD5E1"></i>Sin operacion</span>
        </div>
      </article>

      <div class="dashboard-column-stack dashboard-column-stack--right">
        <article class="dashboard-card dashboard-card--birthdays">
          <div class="dashboard-card-head">
            <div>
              <p>Cumpleanos del mes</p>
              <h3>Celebraciones</h3>
            </div>
          </div>
          <div class="dashboard-card-body">
            ${buildAgendaList(birthdays, "birthday")}
          </div>
        </article>

        <article class="dashboard-card dashboard-card--events">
          <div class="dashboard-card-head">
            <div>
              <p>Proximos eventos</p>
              <h3>Agenda operativa</h3>
            </div>
          </div>
          <div class="dashboard-card-body">
            ${buildAgendaList(events, "event")}
          </div>
        </article>
      </div>
    </section>

    <section class="dashboard-kpi-grid dashboard-kpi-grid--bottom">
      <article class="dashboard-card">
        <div class="dashboard-card-head">
          <div>
            <p>Distribucion por modalidad</p>
            <h3>Modalidades activas</h3>
          </div>
        </div>
        <div class="dashboard-card-body dashboard-card-body--distribution">
          ${buildDonut(modalityItems, "modalidades")}
          ${buildSideList(modalityItems, modalityTotal)}
        </div>
      </article>

      <article class="dashboard-card">
        <div class="dashboard-card-head">
          <div>
            <p>Distribucion por edad</p>
            <h3>Rangos etarios</h3>
          </div>
        </div>
        <div class="dashboard-card-body">
          ${buildBarChart(ageItems, "Sin datos de edad")}
        </div>
      </article>

      <article class="dashboard-card">
        <div class="dashboard-card-head">
          <div>
            <p>Distribucion por area</p>
            <h3>Areas registradas</h3>
          </div>
        </div>
        <div class="dashboard-card-body">
          ${buildBarChart(areaItems, "Sin datos de area")}
        </div>
      </article>
    </section>
  `;
}

function buildLegacyDistribution(source = {}, pairs = [], colors = []) {
  return pairs
    .map(([label, key], index) => ({
      label,
      value: Number(source?.[key] || 0),
      color: colors[index % colors.length] || "#0B7CFF",
    }))
    .filter((item) => item.value > 0);
}

function normalizeLegacySummary(payload = {}) {
  const kpis = payload?.kpis || {};
  const coverageRows = Object.entries(payload?.coverageByMunicipality || {}).map(([municipalityName, item]) => {
    const requiredTc = Number(item?.requiredTc || 0);
    const requiredMt = Number(item?.requiredMt || 0);
    const contractedTc = Number(item?.contractedTc || 0);
    const contractedMt = Number(item?.contractedMt || 0);
    const requiredTotal = requiredTc + requiredMt;
    const contractedTotal = contractedTc + contractedMt;
    const coveragePercent = requiredTotal > 0 ? Math.round((contractedTotal / requiredTotal) * 100) : 0;

    return {
      municipalityId: municipalityName,
      municipalityName,
      requiredTc,
      contractedTc,
      requiredMt,
      contractedMt,
      requiredTotal,
      contractedTotal,
      coveragePercent,
      coverageStatus: getStatusMeta(
        requiredTotal <= 0
          ? "SIN_OPERACION"
          : coveragePercent >= 85
            ? "ESTABLE"
            : coveragePercent >= 60
              ? "ALERTA"
              : "CRITICO"
      ).label.toUpperCase().replace(/\s+/g, "_"),
    };
  });

  const totalRequired = Number(kpis.requiredTc || 0) + Number(kpis.requiredMt || 0);
  const totalContracted = Number(kpis.contractedTc || 0) + Number(kpis.contractedMt || 0);
  const coveragePercent = totalRequired > 0 ? Math.round((totalContracted / totalRequired) * 100) : 0;
  const coverageStatus = totalRequired <= 0
    ? "SIN_OPERACION"
    : coveragePercent >= 85
      ? "ESTABLE"
      : coveragePercent >= 60
        ? "ALERTA"
        : "CRITICO";

  return {
    activeEmployees: Number(kpis.activePersonnel || 0),
    requiredTc: Number(kpis.requiredTc || 0),
    contractedTc: Number(kpis.contractedTc || 0),
    requiredMt: Number(kpis.requiredMt || 0),
    contractedMt: Number(kpis.contractedMt || 0),
    required20PercentTc: Number(kpis.tcPct20 || 0),
    coveragePercent,
    coverageStatus,
    coverageByMunicipality: coverageRows,
    employeesByGender: buildLegacyDistribution(
      kpis,
      [["Mujeres", "femaleCount"], ["Hombres", "maleCount"]],
      ["#8B5CF6", "#0B7CFF"]
    ),
    employeesByModality: buildLegacyDistribution(
      kpis,
      [["Tiempo completo", "contractedTc"], ["Medio tiempo", "contractedMt"]],
      ["#0B7CFF", "#2ECF9A"]
    ),
    employeesByAgeRange: Array.isArray(payload?.ageBrackets)
      ? payload.ageBrackets.map((label, index) => ({
          label,
          value: Number(payload?.ageGenderByBracket?.[label]?.female || 0) + Number(payload?.ageGenderByBracket?.[label]?.male || 0),
          color: ["#071B4D", "#0B7CFF", "#2ECF9A", "#F7C948", "#8B5CF6", "#FF4D4F"][index % 6],
        })).filter((item) => item.value > 0)
      : [],
    employeesByArea: [],
    birthdaysThisMonth: [],
    upcomingEvents: [],
  };
}

async function loadDashboardSummary() {
  const params = new URLSearchParams();
  if (_selectedMunicipalityId) params.set("municipality_id", _selectedMunicipalityId);
  const url = `/dashboard/summary${params.toString() ? `?${params.toString()}` : ""}`;

  try {
    const response = await apiFetch(url);
    return response?.data || {};
  } catch (error) {
    if (error?.status !== 401 && error?.status !== 403 && error?.status !== 404) {
      throw error;
    }

    const legacyParams = new URLSearchParams();
    if (_selectedMunicipalityId) legacyParams.set("municipality", _selectedMunicipalityId);
    const legacyUrl = `/dashboard-summary${legacyParams.toString() ? `?${legacyParams.toString()}` : ""}`;
    const legacyResponse = await apiFetch(legacyUrl);
    return normalizeLegacySummary(legacyResponse);
  }
}

async function renderDashboardWorkspace(showToast = false) {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;

  const summary = await loadDashboardSummary();
  root.innerHTML = buildWorkspace(summary);

  const municipalitySelect = document.getElementById("dashboardSummaryMunicipality");
  const refreshButton = document.getElementById("dashboardSummaryRefresh");

  if (municipalitySelect) {
    municipalitySelect.addEventListener("change", async (event) => {
      _selectedMunicipalityId = event.target.value || "";
      try {
        const workspaceRoot = document.getElementById(ROOT_ID);
        if (workspaceRoot) workspaceRoot.innerHTML = buildLoadingState();
        await renderDashboardWorkspace(false);
      } catch (error) {
        const workspaceRoot = document.getElementById(ROOT_ID);
        if (workspaceRoot) workspaceRoot.innerHTML = buildErrorState(error.message || "No se pudo aplicar el filtro");
        showError(error.message || "No se pudo aplicar el filtro");
      }
    });
  }

  if (refreshButton) {
    refreshButton.addEventListener("click", async () => {
      refreshButton.disabled = true;
      try {
        const workspaceRoot = document.getElementById(ROOT_ID);
        if (workspaceRoot) workspaceRoot.innerHTML = buildLoadingState();
        await renderDashboardWorkspace(false);
        showSuccess("Dashboard actualizado");
      } catch (error) {
        const workspaceRoot = document.getElementById(ROOT_ID);
        if (workspaceRoot) workspaceRoot.innerHTML = buildErrorState(error.message || "No se pudo actualizar el dashboard");
        showError(error.message || "No se pudo actualizar el dashboard");
      } finally {
        refreshButton.disabled = false;
      }
    });
  }

  if (showToast) {
    showSuccess("Dashboard actualizado");
  }
}

export async function loadDashboardModule() {
  _clearDashboardTimers();

  const inlineStyles = `
    <style id="dashboardWorkspacePremiumInline">
      #${ROOT_ID} {
        --dw-bg: #f7faff;
        --dw-card: #ffffff;
        --dw-border: rgba(226, 232, 240, 0.9);
        --dw-shadow: 0 14px 34px rgba(15, 23, 42, 0.05), 0 2px 6px rgba(15, 23, 42, 0.03);
        --dw-text: #0b1b3a;
        --dw-muted: #7f8da3;
        --dw-blue: #0b7cff;
        --dw-soft: #f1f6ff;
        display: grid !important;
        grid-template-rows: auto auto auto !important;
        gap: 18px !important;
        padding: 18px !important;
        background:
          radial-gradient(circle at top left, rgba(11,124,255,.05), transparent 24%),
          linear-gradient(180deg, #f8fbff 0%, #f4f8fd 100%) !important;
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        box-sizing: border-box !important;
        font-family: "Inter", system-ui, sans-serif !important;
      }

      #${ROOT_ID} *,
      #${ROOT_ID} *::before,
      #${ROOT_ID} *::after {
        box-sizing: border-box !important;
      }

      #${ROOT_ID} .dashboard-kpi-grid {
        display: grid !important;
        grid-template-columns: repeat(6, minmax(0, 1fr)) !important;
        gap: 16px !important;
        align-items: stretch !important;
      }

      #${ROOT_ID} .dashboard-main-grid {
        display: grid !important;
        grid-template-columns: minmax(280px, 0.92fr) minmax(0, 1.45fr) minmax(280px, 0.92fr) !important;
        gap: 16px !important;
        align-items: start !important;
      }

      #${ROOT_ID} .dashboard-kpi-grid--bottom {
        display: grid !important;
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        gap: 16px !important;
        align-items: start !important;
      }

      #${ROOT_ID} .dashboard-column-stack {
        display: grid !important;
        grid-template-columns: 1fr !important;
        gap: 16px !important;
        align-content: start !important;
      }

      #${ROOT_ID} .dashboard-kpi-card,
      #${ROOT_ID} .dashboard-card {
        background: var(--dw-card) !important;
        border: 1px solid var(--dw-border) !important;
        border-radius: 22px !important;
        box-shadow: var(--dw-shadow) !important;
        overflow: hidden !important;
      }

      #${ROOT_ID} .dashboard-kpi-card {
        min-height: 126px !important;
        padding: 18px !important;
        display: flex !important;
        flex-direction: column !important;
        justify-content: space-between !important;
        gap: 8px !important;
      }

      #${ROOT_ID} .dashboard-kpi-card span,
      #${ROOT_ID} .dashboard-card-head p {
        margin: 0 !important;
        color: var(--dw-muted) !important;
        font-size: 10px !important;
        font-weight: 700 !important;
        letter-spacing: .08em !important;
        text-transform: uppercase !important;
      }

      #${ROOT_ID} .dashboard-kpi-card strong {
        margin: 0 !important;
        color: var(--dw-text) !important;
        font-size: clamp(24px, 1.5vw, 32px) !important;
        line-height: 1 !important;
        font-weight: 800 !important;
        letter-spacing: -.05em !important;
      }

      #${ROOT_ID} .dashboard-kpi-card small {
        color: var(--dw-muted) !important;
        font-size: 11px !important;
        line-height: 1.3 !important;
      }

      #${ROOT_ID} .dashboard-kpi-card select {
        min-height: 42px !important;
        padding: 10px 12px !important;
        border-radius: 14px !important;
        border: 1px solid var(--dw-border) !important;
        background: #fbfdff !important;
        color: var(--dw-text) !important;
      }

      #${ROOT_ID} .dashboard-kpi-card--action {
        background: linear-gradient(135deg, #0b7cff 0%, #2487ff 100%) !important;
        border-color: transparent !important;
        box-shadow: 0 18px 40px rgba(11,124,255,.2) !important;
      }

      #${ROOT_ID} .dashboard-kpi-card--action span,
      #${ROOT_ID} .dashboard-kpi-card--action strong,
      #${ROOT_ID} .dashboard-kpi-card--action small {
        color: #fff !important;
      }

      #${ROOT_ID} .dashboard-card {
        padding: 18px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 14px !important;
      }

      #${ROOT_ID} .dashboard-card-head {
        display: flex !important;
        align-items: flex-start !important;
        justify-content: space-between !important;
        gap: 12px !important;
      }

      #${ROOT_ID} .dashboard-card-head h3 {
        margin: 4px 0 0 !important;
        color: var(--dw-text) !important;
        font-size: 20px !important;
        line-height: 1.05 !important;
        letter-spacing: -.04em !important;
      }

      #${ROOT_ID} .dashboard-card-pill,
      #${ROOT_ID} .dashboard-date-pill {
        background: var(--dw-soft) !important;
        color: var(--dw-blue) !important;
        border-radius: 999px !important;
      }

      #${ROOT_ID} .dashboard-card-body--state,
      #${ROOT_ID} .dashboard-card-body--distribution {
        display: grid !important;
        grid-template-columns: 140px minmax(0, 1fr) !important;
        gap: 14px !important;
        align-items: center !important;
      }

      #${ROOT_ID} .dashboard-card-body--map {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) 250px !important;
        gap: 16px !important;
        align-items: start !important;
      }

      #${ROOT_ID} .dashboard-gauge,
      #${ROOT_ID} .dashboard-donut {
        width: 132px !important;
        height: 132px !important;
        margin: 0 auto !important;
      }

      #${ROOT_ID} .dashboard-map-frame {
        min-height: 280px !important;
        padding: 16px !important;
        border: 1px solid var(--dw-border) !important;
        border-radius: 18px !important;
        background: linear-gradient(180deg, #fbfdff 0%, #f5f9ff 100%) !important;
      }

      #${ROOT_ID} .dashboard-map {
        width: 100% !important;
        min-height: 248px !important;
      }

      #${ROOT_ID} .dashboard-side-panel {
        padding-left: 14px !important;
        border-left: 1px solid var(--dw-border) !important;
      }

      #${ROOT_ID} .dashboard-side-list {
        display: grid !important;
        gap: 10px !important;
      }

      #${ROOT_ID} .dashboard-side-list-item {
        padding: 12px !important;
        border-radius: 16px !important;
        border: 1px solid var(--dw-border) !important;
        background: #fafcff !important;
      }

      #${ROOT_ID} .dashboard-side-list-label strong,
      #${ROOT_ID} .dashboard-side-list-copy strong,
      #${ROOT_ID} .dashboard-side-list-value strong {
        color: var(--dw-text) !important;
      }

      #${ROOT_ID} .dashboard-side-list-label small,
      #${ROOT_ID} .dashboard-side-list-copy small,
      #${ROOT_ID} .dashboard-side-list-value small,
      #${ROOT_ID} .dashboard-gauge-center span,
      #${ROOT_ID} .dashboard-donut-center span {
        color: var(--dw-muted) !important;
      }

      #${ROOT_ID} .dashboard-legend {
        display: flex !important;
        flex-wrap: wrap !important;
        gap: 10px 12px !important;
        padding-top: 10px !important;
        border-top: 1px solid var(--dw-border) !important;
        color: var(--dw-muted) !important;
        font-size: 11px !important;
      }

      #${ROOT_ID} .dashboard-bar-chart {
        display: grid !important;
        gap: 12px !important;
      }

      #${ROOT_ID} .dashboard-bar-track {
        height: 10px !important;
        border-radius: 999px !important;
        background: #eef3f8 !important;
      }

      /* ── KPI ACCENT TOP LINE ─────────────────────────────── */
      #${ROOT_ID} .dashboard-kpi-card {
        position: relative !important;
        overflow: hidden !important;
      }

      #${ROOT_ID} .dashboard-kpi-card::before {
        content: "" !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        height: 3px !important;
        background: var(--kpi-accent, var(--dw-blue)) !important;
        border-radius: 22px 22px 0 0 !important;
        opacity: 0.85 !important;
      }

      /* ── KPI ICON BADGE ──────────────────────────────────── */
      #${ROOT_ID} .dkpi-row {
        display: flex !important;
        align-items: flex-start !important;
        justify-content: space-between !important;
        gap: 6px !important;
      }

      #${ROOT_ID} .dkpi-icon {
        width: 30px !important;
        height: 30px !important;
        border-radius: 9px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        flex-shrink: 0 !important;
      }

      /* ── KPI VALUE TYPOGRAPHY ────────────────────────────── */
      #${ROOT_ID} .dashboard-kpi-card strong {
        font-size: clamp(22px, 1.5vw, 30px) !important;
        letter-spacing: -0.055em !important;
        line-height: 1 !important;
      }

      /* ── CARD HEAD SEPARATOR ─────────────────────────────── */
      #${ROOT_ID} .dashboard-card-head {
        padding-bottom: 12px !important;
        border-bottom: 1px solid var(--dw-border) !important;
      }

      #${ROOT_ID} .dashboard-card-pill {
        padding: 5px 13px !important;
        font-size: 11px !important;
        font-weight: 800 !important;
        letter-spacing: 0.03em !important;
        border: 1px solid rgba(11,124,255,0.15) !important;
        box-shadow: 0 2px 6px rgba(11,124,255,0.08) !important;
      }

      /* ── CARD HOVER LIFT ─────────────────────────────────── */
      #${ROOT_ID} .dashboard-card {
        transition: transform 0.15s ease, box-shadow 0.2s ease !important;
      }

      #${ROOT_ID} .dashboard-card:hover {
        transform: translateY(-2px) !important;
        box-shadow: 0 22px 48px rgba(11,27,58,.09), 0 4px 12px rgba(11,27,58,.04) !important;
      }

      #${ROOT_ID} .dashboard-kpi-card:not(button) {
        transition: transform 0.15s ease, box-shadow 0.2s ease !important;
      }

      #${ROOT_ID} .dashboard-kpi-card:not(button):hover {
        transform: translateY(-1px) !important;
        box-shadow: 0 14px 34px rgba(11,27,58,.08), 0 2px 8px rgba(11,27,58,.04) !important;
      }

      /* ── BAR CHART POLISH ────────────────────────────────── */
      #${ROOT_ID} .dashboard-bar-fill {
        position: relative !important;
        overflow: hidden !important;
        transition: width 0.55s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }

      #${ROOT_ID} .dashboard-bar-fill::after {
        content: "" !important;
        position: absolute !important;
        inset: 0 !important;
        background: linear-gradient(90deg, rgba(255,255,255,0) 50%, rgba(255,255,255,0.22)) !important;
        border-radius: inherit !important;
      }

      #${ROOT_ID} .dashboard-bar-track {
        height: 9px !important;
        border-radius: 999px !important;
        background: #edf1f8 !important;
      }

      /* ── SIDE LIST ITEM POLISH ───────────────────────────── */
      #${ROOT_ID} .dashboard-side-list-item {
        transition: background 0.12s ease, box-shadow 0.12s ease !important;
      }

      #${ROOT_ID} .dashboard-side-list-item:hover {
        background: #f5f8ff !important;
        box-shadow: 0 2px 8px rgba(11,27,58,.04) !important;
      }

      /* ── DATE PILL POLISH ────────────────────────────────── */
      #${ROOT_ID} .dashboard-date-pill {
        padding: 7px 10px !important;
        font-size: 10px !important;
        font-weight: 800 !important;
        letter-spacing: 0.06em !important;
        background: rgba(11,124,255,0.07) !important;
        color: #0b68d3 !important;
        border: 1px solid rgba(11,124,255,0.12) !important;
        border-radius: 10px !important;
      }

      /* ── COVERAGE MAP TILE FILL ──────────────────────────── */
      #${ROOT_ID} .dashboard-map-wrap {
        background: linear-gradient(180deg, #f9fbff 0%, #f3f7fe 100%) !important;
        border-radius: 16px !important;
        padding: 16px !important;
        border: 1px solid rgba(148,163,184,0.1) !important;
      }

      /* ── ACTION BUTTON REFRESH ───────────────────────────── */
      #${ROOT_ID} .dashboard-kpi-card--action {
        background: linear-gradient(135deg, #0b7cff 0%, #1d8aff 60%, #3a9dff 100%) !important;
        box-shadow: 0 18px 42px rgba(11,124,255,.22), 0 4px 12px rgba(11,124,255,.16) !important;
      }

      #${ROOT_ID} .dashboard-kpi-card--action strong {
        font-size: 14px !important;
        font-weight: 700 !important;
        letter-spacing: 0 !important;
      }

      @media (max-width: 1280px) {
        #${ROOT_ID} .dashboard-kpi-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        }
        #${ROOT_ID} .dashboard-main-grid {
          grid-template-columns: 1fr 1fr !important;
        }
        #${ROOT_ID} .dashboard-main-grid > .dashboard-card--coverage {
          grid-column: 1 / -1 !important;
        }
        #${ROOT_ID} .dashboard-kpi-grid--bottom {
          grid-template-columns: 1fr 1fr !important;
        }
      }

      @media (max-width: 900px) {
        #${ROOT_ID} {
          padding: 12px !important;
          gap: 12px !important;
        }
        #${ROOT_ID} .dashboard-kpi-grid,
        #${ROOT_ID} .dashboard-main-grid,
        #${ROOT_ID} .dashboard-kpi-grid--bottom,
        #${ROOT_ID} .dashboard-column-stack {
          grid-template-columns: 1fr !important;
          grid-template-rows: auto !important;
          gap: 12px !important;
        }
        #${ROOT_ID} .dashboard-card-body--state,
        #${ROOT_ID} .dashboard-card-body--distribution,
        #${ROOT_ID} .dashboard-card-body--map {
          grid-template-columns: 1fr !important;
        }
        #${ROOT_ID} .dashboard-side-panel {
          padding-left: 0 !important;
          border-left: none !important;
        }
      }
    </style>
  `;

  const html = `
    ${inlineStyles}
    <div class="dashboard-workspace-premium dashboard-workspace-premium--final" id="${ROOT_ID}">
      ${buildLoadingState()}
    </div>
  `;

  setTimeout(async () => {
    try {
      await renderDashboardWorkspace(false);
      _timer = setInterval(() => {
        renderDashboardWorkspace(false).catch(() => {});
      }, REFRESH_MS);
    } catch (error) {
      const root = document.getElementById(ROOT_ID);
      if (root) root.innerHTML = buildErrorState(error.message || "No se pudo cargar el dashboard");
    }
  }, 0);

  return html;
}
