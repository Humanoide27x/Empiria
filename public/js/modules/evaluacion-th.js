"use strict";

import { apiFetch } from '../api.js';
import { escapeHtml, escapeAttr } from '../utils.js';

// ── Estado del módulo ─────────────────────────────────────────────────────────
let _coordinadores = [];
let _coordActual   = null;   // objeto coordinador activo
let _munActual     = null;   // objeto municipio activo
let _munCache      = new Map();  // coordId  → municipios[]
let _docsCache     = new Map();  // munId    → empleados[]
let _searchTerm    = "";

// ── Gradientes únicos por coordinador (índice) ────────────────────────────────
const AVATAR_GRADS = [
  "linear-gradient(135deg,#1e40af,#3b82f6)",
  "linear-gradient(135deg,#6d28d9,#a78bfa)",
  "linear-gradient(135deg,#0e7490,#22d3ee)",
  "linear-gradient(135deg,#b45309,#fbbf24)",
];

// ── Helpers de color / score ──────────────────────────────────────────────────

function scoreTone(s)  { return s >= 80 ? "success" : s >= 60 ? "warning" : "danger"; }
function scoreLabel(s) { return s >= 80 ? "Óptimo"  : s >= 60 ? "En progreso" : "Atención"; }

function pctColor(p) {
  const v = p ?? 0;
  return v >= 80 ? "#16a34a" : v >= 55 ? "#f59e0b" : "#ef4444";
}
function pctGrad(p) {
  const v = p ?? 0;
  if (v >= 80) return "linear-gradient(90deg,#4ade80,#16a34a)";
  if (v >= 55) return "linear-gradient(90deg,#fcd34d,#f59e0b)";
  return "linear-gradient(90deg,#fca5a5,#ef4444)";
}
function estadoTone(estado) {
  return estado === "Completo" ? "success"
       : estado === "En progreso" ? "warning"
       : estado === "Sin empleados" ? "neutral"
       : "danger";  // Crítico
}

function avatarGrad(coord) {
  const idx = _coordinadores.indexOf(coord);
  return AVATAR_GRADS[(idx >= 0 ? idx : 0) % AVATAR_GRADS.length];
}

function initials(nombre) {
  return (nombre || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

// ── Componentes reutilizables ─────────────────────────────────────────────────

function progBar(pct, small = false) {
  const safe = Math.min(100, Math.max(0, pct ?? 0));
  return `<div class="eth-prog-track${small ? " eth-prog-sm" : ""}"><div class="eth-prog-fill" style="width:${safe}%;background:${pctGrad(safe)}"></div></div>`;
}

function kpiRow(icon, label, value, total, pct) {
  const hasBar = pct !== null && pct !== undefined;
  const numHtml = (total !== null && total !== undefined)
    ? `<span class="eth-kpi-val">${value}</span><span class="eth-kpi-denom"> / ${total}</span>`
    : `<span class="eth-kpi-val">${value}</span>`;
  const pctHtml = hasBar ? `<span class="eth-kpi-pct" style="color:${pctColor(pct)}">${pct}%</span>` : "";
  return `
    <div class="eth-kpi-row">
      <span class="eth-kpi-icon">${icon}</span>
      <div class="eth-kpi-body">
        <div class="eth-kpi-topline">
          <span class="eth-kpi-label">${label}</span>
          <span class="eth-kpi-nums">${numHtml}${pctHtml}</span>
        </div>
        ${hasBar ? progBar(pct) : ""}
      </div>
    </div>`;
}

function munTags(municipios) {
  return (municipios || []).length
    ? municipios.map(mn => `<span class="eth-mun-tag">${escapeHtml(mn)}</span>`).join("")
    : `<span class="eth-mun-tag eth-mun-empty">Sin municipios</span>`;
}

function breadcrumb(levels) {
  // levels: [{label, back?}]  — el último no tiene atributo back
  return `
    <nav class="eth-breadcrumb" aria-label="Navegación">
      ${levels.map((l, i) => {
        const isLast = i === levels.length - 1;
        return isLast
          ? `<span class="eth-bc-current">${escapeHtml(l.label)}</span>`
          : `<button type="button" class="eth-bc-link" data-eth-back="${escapeAttr(l.back)}">${escapeHtml(l.label)}</button>
             <span class="eth-bc-sep">›</span>`;
      }).join("")}
    </nav>`;
}

// ── VISTA 1: Dashboard (coordinadores + podio) ────────────────────────────────

function renderDashboard() {
  const fecha = new Date().toLocaleDateString("es-CO", { day:"2-digit", month:"long", year:"numeric" });
  return `
    <div class="eth-dashboard">
      <div class="eth-top-header">
        <div>
          <h2 class="eth-main-title">Evaluación de Desempeño · Talento Humano</h2>
          <p class="eth-main-sub">Última actualización: ${fecha} · Métricas en tiempo real</p>
        </div>
      </div>
      <div class="eth-cards-grid">
        ${_coordinadores.map((c, i) => renderCard(c, i)).join("")}
      </div>
      ${renderPodium()}
    </div>`;
}

function renderCard(coord, idx) {
  const { id, nombre, municipios, metricas: m } = coord;
  const tone   = scoreTone(m.score_general);
  const avGrad = AVATAR_GRADS[idx % AVATAR_GRADS.length];
  return `
    <div class="eth-coord-card">
      <div class="eth-card-head">
        <div class="eth-avatar" style="background:${avGrad}">${escapeHtml(initials(nombre))}</div>
        <div class="eth-card-meta">
          <div class="eth-coord-name">${escapeHtml(nombre)}</div>
          <div class="eth-mun-tags">${munTags(municipios)}</div>
        </div>
        <div class="eth-score-badge eth-score-${tone}">
          <span class="eth-score-num">${m.score_general}%</span>
          <span class="eth-score-lbl">${scoreLabel(m.score_general)}</span>
        </div>
      </div>
      <div class="eth-kpis">
        ${kpiRow("👥", "Empleados a cargo",   m.empleados_a_cargo,            null,                    null)}
        ${kpiRow("📄", "Documentos",          m.documentos_completados,       m.documentos_requeridos, m.porcentaje_docs)}
        ${kpiRow("🔄", "Datos actualizados",  m.empleados_datos_actualizados, m.empleados_a_cargo,     m.porcentaje_datos)}
        ${kpiRow("⏱️", "Nómina a tiempo",     m.nominas_procesadas,           m.nominas_total,         m.porcentaje_nomina)}
      </div>
      <div class="eth-card-foot">
        <button type="button" class="eth-btn-detalle" data-eth-detalle="${escapeAttr(String(id))}">
          Ver desglose por municipio →
        </button>
      </div>
    </div>`;
}

function renderPodium() {
  if (!_coordinadores.length) return "";
  const sorted = [..._coordinadores].sort((a, b) => b.metricas.score_general - a.metricas.score_general);
  const order  = sorted.length >= 3 ? [sorted[1], sorted[0], sorted[2]]
               : sorted.length === 2 ? [sorted[1], sorted[0]]
               : [sorted[0]];
  const meta = (vi, total) => {
    if (total === 1) return { medal:"🥇", height:"96px", first:true };
    if (total === 2) return vi === 0 ? { medal:"🥈", height:"64px", first:false } : { medal:"🥇", height:"96px", first:true };
    return [
      { medal:"🥈", height:"64px", first:false },
      { medal:"🥇", height:"96px", first:true  },
      { medal:"🥉", height:"44px", first:false },
    ][vi];
  };
  const cols = order.map((c, vi) => {
    const { medal, height, first } = meta(vi, order.length);
    const tone  = scoreTone(c.metricas.score_general);
    const podBg = tone === "success" ? "linear-gradient(180deg,#dcfce7,#f0fdf4)"
                : tone === "warning"  ? "linear-gradient(180deg,#fef3c7,#fffbeb)"
                : "linear-gradient(180deg,#fee2e2,#fef2f2)";
    return `
      <div class="eth-podium-col">
        ${first ? `<div class="eth-podium-best">⭐ Mejor desempeño del mes</div>` : `<div style="height:28px"></div>`}
        <div class="eth-avatar eth-avatar-pod" style="background:${avatarGrad(c)}">${escapeHtml(initials(c.nombre))}</div>
        <div class="eth-podium-medal">${medal}</div>
        <div class="eth-podium-name">${escapeHtml(c.nombre.split(/\s+/).slice(0,2).join(" "))}</div>
        <div class="eth-podium-score eth-score-${tone}">${c.metricas.score_general}%</div>
        <div class="eth-podium-block" style="height:${height};background:${podBg}"></div>
      </div>`;
  }).join("");
  return `
    <div class="eth-ranking-wrap">
      <h3 class="eth-ranking-title">Ranking General</h3>
      <div class="eth-podium">${cols}</div>
    </div>`;
}

// ── VISTA 2: Desglose de municipios de un coordinador ─────────────────────────

function renderCoordView(coord, municipios) {
  const { nombre, municipios: munList, metricas: m } = coord;
  const tone   = scoreTone(m.score_general);
  const avGrad = avatarGrad(coord);

  const totalFaltantes = municipios.reduce((s, r) => s + (r.docs_faltantes || 0), 0);
  const munConProblemas = municipios.filter(r => r.estado === "Crítico").length;

  const rows = municipios.map(r => {
    const rt    = estadoTone(r.estado);
    const color = pctColor(r.porcentaje_docs);
    const faltantesHtml = r.docs_faltantes > 0
      ? `<span class="eth-faltantes-neg">${r.docs_faltantes}</span>`
      : `<span class="eth-faltantes-ok">0</span>`;
    return `
      <tr class="eth-mun-row" data-eth-mun="${escapeAttr(String(r.municipio_id))}"
          title="Clic para ver empleados y documentos faltantes en ${escapeAttr(r.municipio)}">
        <td>
          <span class="eth-table-mun">${escapeHtml(r.municipio)}</span>
          <span class="eth-mun-row-hint">Ver empleados →</span>
        </td>
        <td class="eth-td-center">${r.empleados}</td>
        <td class="eth-td-center">${r.docs_completados}</td>
        <td class="eth-td-center">${r.docs_requeridos}</td>
        <td class="eth-td-center">${faltantesHtml}</td>
        <td>
          <div class="eth-table-pct-cell">
            ${progBar(r.porcentaje_docs, true)}
            <strong style="color:${color};font-size:12px;white-space:nowrap">${r.porcentaje_docs}%</strong>
          </div>
        </td>
        <td><span class="status-chip ${rt}">${escapeHtml(r.estado)}</span></td>
      </tr>`;
  }).join("");

  const emptyRow = !municipios.length
    ? `<tr><td colspan="7" class="eth-td-empty">Sin municipios asignados.</td></tr>`
    : "";

  return `
    <div class="eth-coord-view">
      ${breadcrumb([
        { label: "Evaluación TH", back: "dash" },
        { label: nombre },
      ])}

      <div class="eth-detalle-head">
        <div class="eth-avatar eth-avatar-lg" style="background:${avGrad}">${escapeHtml(initials(nombre))}</div>
        <div class="eth-detalle-head-info">
          <h2 class="eth-main-title" style="margin:0 0 5px">${escapeHtml(nombre)}</h2>
          <div class="eth-mun-tags">${munTags(munList)}</div>
        </div>
        <div class="eth-score-badge eth-score-${tone} eth-score-lg">
          <span class="eth-score-num">${m.score_general}%</span>
          <span class="eth-score-lbl">${scoreLabel(m.score_general)}</span>
        </div>
      </div>

      <!-- Resumen rápido -->
      <div class="eth-coord-summary">
        <div class="eth-summary-stat">
          <strong>${municipios.length}</strong><span>Municipios</span>
        </div>
        <div class="eth-summary-stat">
          <strong>${m.empleados_a_cargo}</strong><span>Empleados activos</span>
        </div>
        <div class="eth-summary-stat" style="${totalFaltantes > 0 ? "color:#dc2626" : ""}">
          <strong>${totalFaltantes}</strong><span>Docs faltantes totales</span>
        </div>
        <div class="eth-summary-stat" style="${munConProblemas > 0 ? "color:#b91c1c" : ""}">
          <strong>${munConProblemas}</strong><span>Municipios críticos</span>
        </div>
      </div>

      <!-- Tabla de municipios clickable -->
      <div class="eth-table-card">
        <h3 class="eth-table-heading">Desglose por municipio
          <span class="eth-table-hint">Haz clic en un municipio para ver los documentos faltantes por empleado</span>
        </h3>
        <div class="eth-table-wrap">
          <table class="eth-mun-table eth-mun-table-nav">
            <thead>
              <tr>
                <th>Municipio</th>
                <th class="eth-th-center">Empleados</th>
                <th class="eth-th-center">Docs completados</th>
                <th class="eth-th-center">Docs requeridos</th>
                <th class="eth-th-center">Docs faltantes</th>
                <th>% Completitud</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>${rows}${emptyRow}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

// ── VISTA 3: Empleados con documentos faltantes en un municipio ───────────────

function renderEmpRows(empleados, search) {
  const filtered = (empleados || []).filter(e =>
    !search || e.empleado.toLowerCase().includes(search)
  );
  if (!filtered.length) {
    return `<div class="eth-empty-row">No se encontraron empleados${search ? ` con "${search}"` : ""}.</div>`;
  }
  return filtered.map(emp => {
    const hasFaltantes = emp.total_faltantes > 0;
    const docTags = hasFaltantes
      ? emp.documentos_faltantes.map(d => `<span class="eth-doc-faltante-tag">${escapeHtml(d)}</span>`).join("")
      : `<span class="eth-doc-ok-tag">✓ Documentos completos</span>`;
    return `
      <div class="eth-emp-row${hasFaltantes ? "" : " eth-emp-ok"}">
        <div class="eth-emp-head">
          <span class="eth-emp-name">${escapeHtml(emp.empleado)}</span>
          ${hasFaltantes
            ? `<span class="eth-emp-count-neg">${emp.total_faltantes} faltante${emp.total_faltantes !== 1 ? "s" : ""}</span>`
            : `<span class="eth-emp-count-ok">Completo</span>`}
        </div>
        <div class="eth-emp-docs">${docTags}</div>
      </div>`;
  }).join("");
}

function renderMunView(coord, mun, empleados) {
  const { nombre } = coord;
  const avGrad   = avatarGrad(coord);
  const tone     = estadoTone(mun.estado);
  const color    = pctColor(mun.porcentaje_docs);
  const totalEmp = (empleados || []).length;
  const sinFaltantes = (empleados || []).filter(e => e.total_faltantes === 0).length;
  const conFaltantes = totalEmp - sinFaltantes;

  return `
    <div class="eth-mun-view">
      ${breadcrumb([
        { label: "Evaluación TH",   back: "dash" },
        { label: nombre,            back: "coord" },
        { label: mun.municipio },
      ])}

      <!-- Header municipio -->
      <div class="eth-detalle-head">
        <div class="eth-mun-icon">📍</div>
        <div class="eth-detalle-head-info">
          <h2 class="eth-main-title" style="margin:0 0 4px">${escapeHtml(mun.municipio)}</h2>
          <p class="eth-main-sub" style="margin:0">
            Coordinador: <strong>${escapeHtml(nombre)}</strong> ·
            ${mun.empleados} empleados activos
          </p>
        </div>
        <div class="eth-mun-metrics">
          <div class="eth-mun-metric-item">
            <strong style="color:${color}">${mun.porcentaje_docs}%</strong>
            <span>Completitud</span>
            ${progBar(mun.porcentaje_docs)}
          </div>
          <div class="eth-mun-metric-item" style="${mun.docs_faltantes > 0 ? "color:#dc2626" : ""}">
            <strong>${mun.docs_faltantes}</strong>
            <span>Docs faltantes</span>
          </div>
          <span class="status-chip ${tone}" style="align-self:center">${escapeHtml(mun.estado)}</span>
        </div>
      </div>

      <!-- Resumen rápido -->
      <div class="eth-coord-summary">
        <div class="eth-summary-stat">
          <strong>${totalEmp}</strong><span>Empleados</span>
        </div>
        <div class="eth-summary-stat">
          <strong style="${sinFaltantes === totalEmp && totalEmp > 0 ? "color:#16a34a" : ""}">${sinFaltantes}</strong>
          <span>Con docs completos</span>
        </div>
        <div class="eth-summary-stat" style="${conFaltantes > 0 ? "color:#dc2626" : ""}">
          <strong>${conFaltantes}</strong><span>Con docs faltantes</span>
        </div>
        <div class="eth-summary-stat" style="${mun.docs_faltantes > 0 ? "color:#dc2626" : ""}">
          <strong>${mun.docs_faltantes}</strong><span>Docs faltantes totales</span>
        </div>
      </div>

      <!-- Buscador + Exportar -->
      <div class="eth-search-row">
        <div class="eth-search-wrap">
          <span class="eth-search-icon">🔍</span>
          <input type="text" class="eth-search-input" placeholder="Buscar empleado…"
            data-eth-search value="${escapeAttr(_searchTerm)}" autocomplete="off">
        </div>
        <button type="button" class="eth-export-btn" data-eth-export
          title="Descargar lista de documentos faltantes en CSV">
          ⬇ Descargar reporte CSV
        </button>
        <button type="button" class="eth-xlsx-btn"
          data-eth-xlsx-mun="${escapeAttr(String(mun.municipio_id))}"
          data-eth-xlsx-mun-name="${escapeAttr(mun.municipio)}"
          title="Descargar checklist Excel completo de este municipio">
          📥 Checklist este municipio
        </button>
        <button type="button" class="eth-xlsx-btn eth-xlsx-btn-all"
          data-eth-xlsx-coord="${escapeAttr(String(coord.id))}"
          data-eth-xlsx-coord-nombre="${escapeAttr(nombre)}"
          title="Descargar checklist Excel de todos los municipios del coordinador">
          📥 Checklist todos los municipios
        </button>
      </div>

      <!-- Lista de empleados -->
      <div class="eth-emp-card">
        <h3 class="eth-table-heading">
          Empleados y documentos faltantes
          <span class="eth-table-hint">Ordenados de mayor a menor cantidad de faltantes</span>
        </h3>
        <div id="ethEmpList" class="eth-emp-list">
          ${renderEmpRows(empleados, _searchTerm)}
        </div>
      </div>
    </div>`;
}

// ── Funciones de navegación ───────────────────────────────────────────────────

async function showCoordDetalle(root, coordId) {
  _coordActual = _coordinadores.find(c => String(c.id) === String(coordId));
  if (!_coordActual) return;

  root.innerHTML = `<div class="eth-loading-wrap"><div class="eth-loading-spinner"></div><p>Cargando municipios…</p></div>`;

  if (!_munCache.has(coordId)) {
    try {
      const res = await apiFetch(`/evaluacion-th/coordinadores/${encodeURIComponent(coordId)}/municipios`);
      _munCache.set(coordId, Array.isArray(res.data) ? res.data : []);
    } catch {
      root.innerHTML = `<div class="eth-error-card">Error al cargar los municipios del coordinador.</div>`;
      return;
    }
  }

  root.innerHTML = renderCoordView(_coordActual, _munCache.get(coordId));
}

async function showMunDetalle(root, munId) {
  const coordMuns = _munCache.get(String(_coordActual?.id)) || [];
  _munActual      = coordMuns.find(m => String(m.municipio_id) === String(munId));
  if (!_munActual) return;

  _searchTerm = "";
  root.innerHTML = `<div class="eth-loading-wrap"><div class="eth-loading-spinner"></div><p>Cargando empleados…</p></div>`;

  if (!_docsCache.has(munId)) {
    try {
      const res = await apiFetch(`/evaluacion-th/municipios/${encodeURIComponent(munId)}/documentos-faltantes`);
      _docsCache.set(munId, Array.isArray(res.data) ? res.data : []);
    } catch {
      root.innerHTML = `<div class="eth-error-card">Error al cargar los documentos faltantes.</div>`;
      return;
    }
  }

  root.innerHTML = renderMunView(_coordActual, _munActual, _docsCache.get(munId));
}

// ── Descarga autenticada de archivo binario (XLSX) ────────────────────────────

async function downloadXlsxFromApi(endpoint, filename) {
  const token = localStorage.getItem("empiria_token") || "";
  const btn   = document.querySelector(`[data-eth-xlsx-mun],[data-eth-xlsx-coord]`);
  try {
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`Error al generar el Excel: ${j.message || res.statusText}`);
      return;
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (err) {
    alert(`Error de red: ${err.message}`);
  }
}

// ── Export CSV ────────────────────────────────────────────────────────────────

function downloadCsv(filename, headers, rows) {
  const lines = [
    headers.map(h => `"${h}"`).join(","),
    ...rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")),
  ];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportDocsCsv() {
  if (!_munActual) return;
  const munId    = String(_munActual.municipio_id);
  const empleados = _docsCache.get(munId) || [];

  const rows = [];
  for (const emp of empleados) {
    if (emp.total_faltantes === 0) {
      rows.push([_munActual.municipio, emp.empleado, "(Sin documentos faltantes)", 0]);
    } else {
      for (const docName of (emp.documentos_faltantes || [])) {
        rows.push([_munActual.municipio, emp.empleado, docName, emp.total_faltantes]);
      }
    }
  }
  const safeNombre = _munActual.municipio.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
  downloadCsv(
    `docs-faltantes-${safeNombre}.csv`,
    ["Municipio", "Empleado", "Tipo de Documento Faltante", "Total Faltantes"],
    rows
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────

export async function loadEvaluacionThModule() {
  _coordinadores = [];
  _coordActual   = null;
  _munActual     = null;
  _munCache      = new Map();
  _docsCache     = new Map();
  _searchTerm    = "";

  try {
    const res  = await apiFetch("/evaluacion-th/coordinadores");
    _coordinadores = Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    return `<div class="eth-module"><div class="eth-error-card">${escapeHtml(err?.message || "Error de conexión")}</div></div>`;
  }

  if (!_coordinadores.length) {
    return `
      <div class="eth-module">
        <div class="eth-empty-card">
          <p class="eth-empty-icon">📊</p>
          <h3>Sin coordinadores TH</h3>
          <p>No se encontraron usuarios con rol <strong>talento_humano</strong>.</p>
        </div>
      </div>`;
  }

  return `<div class="eth-module"><div id="ethModuleRoot">${renderDashboard()}</div></div>`;
}

export function wireEvaluacionThEvents() {
  const root = document.getElementById("ethModuleRoot");
  if (!root) return;

  // ── Click delegation ──────────────────────────────────────────────────────
  root.addEventListener("click", async (e) => {
    // Ver desglose de un coordinador
    const detBtn = e.target.closest("[data-eth-detalle]");
    if (detBtn) { await showCoordDetalle(root, detBtn.dataset.ethDetalle); return; }

    // Navegar al detalle de un municipio (clic en fila de la tabla)
    const munRow = e.target.closest("[data-eth-mun]");
    if (munRow) { await showMunDetalle(root, munRow.dataset.ethMun); return; }

    // Navegación breadcrumb / botón volver
    const backBtn = e.target.closest("[data-eth-back]");
    if (backBtn) {
      const dest = backBtn.dataset.ethBack;
      if (dest === "dash") {
        _coordActual = null; _munActual = null;
        root.innerHTML = renderDashboard();
        return;
      }
      if (dest === "coord" && _coordActual) {
        _munActual = null; _searchTerm = "";
        root.innerHTML = renderCoordView(_coordActual, _munCache.get(String(_coordActual.id)) || []);
        return;
      }
    }

    // Exportar CSV
    const expBtn = e.target.closest("[data-eth-export]");
    if (expBtn) { exportDocsCsv(); return; }

    // Descargar checklist Excel — municipio individual
    const xlsxMunBtn = e.target.closest("[data-eth-xlsx-mun]");
    if (xlsxMunBtn) {
      const munId    = xlsxMunBtn.dataset.ethXlsxMun;
      const munNom   = (xlsxMunBtn.dataset.ethXlsxMunName || `municipio-${munId}`)
        .replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
      xlsxMunBtn.textContent = "⏳ Generando…";
      xlsxMunBtn.disabled    = true;
      await downloadXlsxFromApi(
        `/evaluacion-th/municipios/${encodeURIComponent(munId)}/checklist-excel`,
        `checklist-${munNom}.xlsx`
      );
      xlsxMunBtn.textContent = "📥 Checklist este municipio";
      xlsxMunBtn.disabled    = false;
      return;
    }

    // Descargar checklist Excel — todos los municipios del coordinador
    const xlsxCoordBtn = e.target.closest("[data-eth-xlsx-coord]");
    if (xlsxCoordBtn) {
      const coordId  = xlsxCoordBtn.dataset.ethXlsxCoord;
      const cNombre  = (xlsxCoordBtn.dataset.ethXlsxCoordNombre || `coord-${coordId}`)
        .replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
      xlsxCoordBtn.textContent = "⏳ Generando…";
      xlsxCoordBtn.disabled    = true;
      await downloadXlsxFromApi(
        `/evaluacion-th/coordinadores/${encodeURIComponent(coordId)}/checklist-excel-completo`,
        `checklist-completo-${cNombre}.xlsx`
      );
      xlsxCoordBtn.textContent = "📥 Checklist todos los municipios";
      xlsxCoordBtn.disabled    = false;
      return;
    }
  });

  // ── Buscador de empleados ─────────────────────────────────────────────────
  root.addEventListener("input", (e) => {
    const inp = e.target.closest("[data-eth-search]");
    if (!inp) return;
    _searchTerm = inp.value.trim().toLowerCase();
    const listEl = root.querySelector("#ethEmpList");
    if (listEl && _munActual) {
      listEl.innerHTML = renderEmpRows(_docsCache.get(String(_munActual.municipio_id)), _searchTerm);
    }
  });
}
