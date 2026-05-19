import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { escapeHtml } from '../utils.js';

let _salaryConfigData = {};

// ── Fórmulas PAE ──────────────────────────────────────────────────────────────

function calcRaw(modality, cupos) {
  if (modality === "CAA")    return 1 + (cupos - 60) / 120;
  if (modality === "CAARES") return 1 + ((cupos * 4) - 60) / 120;
  if (modality === "RI") {
    if (cupos <= 100) return 0;
    if (cupos <= 300) return 1;
    if (cupos <= 500) return 2;
    if (cupos <= 800) return 3;
    return 4;
  }
  return null;
}

function applyRounding(raw) {
  const safeRaw = Math.max(0, raw);
  const floor = Math.floor(safeRaw);
  const dec = parseFloat((safeRaw - floor).toFixed(6));
  if (dec < 0.25)  return { fullTime: floor, halfTime: 0 };
  if (dec <= 0.50) return { fullTime: floor, halfTime: 1 };
  return { fullTime: floor + 1, halfTime: 0 };
}

function calculate(modality, cupos) {
  const raw = calcRaw(modality, cupos);
  if (raw === null) return null;
  if (modality === "RI") return { raw, fullTime: raw, halfTime: 0 };
  return { raw, ...applyRounding(raw) };
}

// ── Constantes nómina Colombia 2025 ──────────────────────────────────────────

const SMLV_2025        = 1_750_905;   // 2026
const AUX_TRANSPORTE   = 249_095;     // 2026
const SALUD_PCT        = 0.04;
const PENSION_PCT      = 0.04;
const HE_DIURNA_FACTOR = 1.25;
const HE_NOCT_FACTOR   = 1.75;
const HRS_MES          = 240;

// ── Constantes calculadora de salario v2 ────────────────────────────────────

const CS2_MODALITIES = {
  CAARES1: { label: "CAARES 1", salary: SMLV_2025,                  jornada: "Tiempo completo · 8h/día", desc: "1 manipuladora en residencia, jornada completa." },
  CAARES2: { label: "CAARES 2", salary: Math.round(SMLV_2025 / 2), jornada: "Medio tiempo · 4h/día",    desc: "1 manipuladora de medio tiempo que apoya a la señora de CAARES 1." },
  CAARES3: { label: "CAARES 3", salary: SMLV_2025,                  jornada: "Tiempo completo · 8h/día", desc: "Más de una manipuladora en residencia, todas jornada completa." },
  CAARES4: { label: "CAARES 4", salary: Math.round(SMLV_2025 / 2), jornada: "Medio tiempo · 4h/día",    desc: "1 manipuladora de medio tiempo que apoya a las señoras de CAARES 3." },
  CAA1:    { label: "CAA 1",    salary: SMLV_2025,                  jornada: "Tiempo completo · 8h/día", desc: "Externo jornada completa." },
  CAA2:    { label: "CAA 2",    salary: Math.round(SMLV_2025 / 2), jornada: "Tiempo parcial · 4h/día",  desc: "Externo jornada parcial." },
  RI:      { label: "RI",       salary: SMLV_2025,                  jornada: "Según rango asignado",     desc: "Ración industrializada." },
};

const NOVELTY_TYPES = [
  { id: "incapacidad_eps", label: "Incapacidad por enfermedad general",   desc: "Días 1–2 los paga el empleador, del día 3 en adelante los cubre la EPS. No afecta el neto del empleado.", paid: true,  coverage: "EPS" },
  { id: "incapacidad_arl", label: "Incapacidad por accidente de trabajo", desc: "Todos los días son cubiertos por la ARL desde el primer día.",                                              paid: true,  coverage: "ARL" },
  { id: "licencia_mat",    label: "Licencia de maternidad / paternidad",  desc: "Cubierta en su totalidad por la EPS. No se descuenta del salario.",                                         paid: true,  coverage: "EPS" },
  { id: "licencia_nr",     label: "Licencia no remunerada",               desc: "Días sin pago acordados con el empleador. Se descuenta el valor proporcional del salario.",                 paid: false, coverage: null  },
  { id: "ausencia",        label: "Ausencia injustificada",               desc: "Días no trabajados sin justificación. Se descuenta el valor del día del salario.",                          paid: false, coverage: null  },
  { id: "suspension",      label: "Suspensión disciplinaria",             desc: "Sanción disciplinaria sin pago durante el período de suspensión.",                                          paid: false, coverage: null  },
];

// ── Helpers generales ─────────────────────────────────────────────────────────

function isAdminOrTH() {
  const r = String(state.currentUser?.role || "").toLowerCase();
  return r === "administrador" || r === "talento_humano";
}

function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
}

function modalityBadge(m) {
  const cls = { CAA: "cc-mod-caa", CAARES: "cc-mod-caares", RI: "cc-mod-ri" }[m] || "";
  return `<span class="cc-mod-badge ${cls}">${escapeHtml(m)}</span>`;
}

function resultSummary(fullTime, halfTime) {
  const parts = [];
  if (fullTime > 0) parts.push(`${fullTime} tiempo${fullTime !== 1 ? "s" : ""} completo${fullTime !== 1 ? "s" : ""}`);
  if (halfTime > 0) parts.push(`${halfTime} medio tiempo`);
  if (!parts.length) return "0 tiempos completos";
  return parts.join(" + ");
}

function fmtCOP(n) {
  return Number(n).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
}

// ── Main loader ───────────────────────────────────────────────────────────────

export async function loadCalculatorModule() {
  const admin = isAdminOrTH();

  let auditRows = [];
  if (admin) {
    try {
      const r = await apiFetch("/calculator/audit?limit=50");
      auditRows = Array.isArray(r.data) ? r.data : [];
    } catch { /* non-fatal */ }
  }

  try {
    const contractId = state.currentUser?.contractId;
    if (contractId) {
      const r = await apiFetch(`/config/contracts/${contractId}/salary-config`);
      _salaryConfigData = r.data || {};
    }
  } catch { /* use hardcoded defaults */ }

  return `
<div class="cc-wrap cc-wrap-full">

  <!-- ── Pestañas ─────────────────────────────────────────────────────────── -->
  <div class="cc-tabs">
    <button class="cc-tab active" data-cc-tab="personal" type="button">Calculadora de Personal Requerido</button>
    <button class="cc-tab" data-cc-tab="salario" type="button">Calculadora de Salario</button>
  </div>

  <!-- ── Panel: Personal Requerido ─────────────────────────────────────────── -->
  <div class="cc-tab-panel active" id="cc-panel-personal">
    <section class="personnel-premium-hero">
      <div>
        <span class="personnel-premium-eyebrow">Herramienta de Cálculo</span>
        <h2>Calculadora de Personal Requerido</h2>
        <p>Calcula el número de tiempos completos y medios tiempos requeridos según modalidad y cupos PAE.</p>
      </div>
    </section>

    <div class="cc-card">
      <div class="cc-card-body">
        <div class="cc-section-label">Modalidad</div>
        <div class="cc-modality-group" id="ccModalityGroup">
          ${["CAA", "CAARES", "RI"].map(m => `
            <label class="cc-modality-option">
              <input type="radio" name="ccModality" value="${m}" ${m === "CAA" ? "checked" : ""}>
              <span class="cc-modality-pill">
                <span class="cc-modality-name">${m}</span>
              </span>
            </label>
          `).join("")}
        </div>

        <div class="cc-input-row">
          <label class="cc-input-label" for="ccCupos">Número de cupos</label>
          <div class="cc-input-wrap">
            <input type="number" id="ccCupos" class="cc-cupos-input"
              placeholder="Ej: 240" min="0" max="99999" step="1" value="">
            <span class="cc-input-unit">cupos</span>
          </div>
        </div>

        <div class="cc-formula-box" id="ccFormulaBox">
          <span class="cc-formula-label">Fórmula:</span>
          <code class="cc-formula-text" id="ccFormulaText">1 + (Cupos − 60) / 120</code>
        </div>

        <div class="cc-preview" id="ccPreview" style="display:none"></div>

        <button class="cc-btn-calc" id="ccBtnCalc" type="button" disabled>
          Calcular y registrar
        </button>
      </div>
    </div>

    <div class="cc-result-panel" id="ccResultPanel" style="display:none"></div>

    ${admin ? `
    <div class="cc-audit-wrap" id="ccAuditWrap">
      <div class="cc-audit-hdr">
        <h3 class="cc-audit-title">Historial de cálculos</h3>
        <button class="cc-btn-refresh" id="ccBtnRefresh" type="button">↻ Actualizar</button>
      </div>
      ${_renderAuditTable(auditRows)}
    </div>` : ""}
  </div>

  <!-- ── Panel: Calculadora de Salario ──────────────────────────────────────── -->
  <div class="cc-tab-panel" id="cc-panel-salario">
    <div class="cs3-layout">

      <!-- ── Card 1: Modalidad de trabajo ─────────────────────────────────── -->
      <div class="cs3-card">
        <div class="cs3-card-hdr">
          <span class="cs3-num">1</span>
          <span class="cs3-card-title">Modalidad de trabajo</span>
        </div>
        <div class="cs3-card-body">
          <div class="cs3-mod-list">
            ${Object.entries(CS2_MODALITIES).map(([key, val]) => {
              const grp    = key.startsWith("CAARES") ? "caares" : key === "RI" ? "ri" : "caa";
              const modCfg = (_salaryConfigData.modalities || {})[key];
              const salary = modCfg?.salary ?? val.salary;
              return `
            <label class="cs3-mod-opt cs3-mod-opt--${grp}" data-mod="${key}">
              <input type="radio" name="cs3Mod" value="${key}" hidden>
              <span class="cs3-mod-radio"></span>
              <span class="cs3-mod-code cs3-mod-code--${grp}">${key}</span>
              <span class="cs3-mod-desc">${val.desc}</span>
              <span class="cs3-mod-salary">${fmtCOP(salary)}</span>
            </label>`;
            }).join("")}
          </div>
        </div>
      </div>

      <!-- ── Card 2: Novedades de nómina ──────────────────────────────────── -->
      <div class="cs3-card">
        <div class="cs3-card-hdr">
          <span class="cs3-num">2</span>
          <span class="cs3-card-title">Novedades de nómina</span>
        </div>
        <div class="cs3-card-body">

          <div class="cs3-q-block">
            <label class="cs3-q-label">
              <input type="checkbox" id="cs3HasNoClass" class="cs3-checkbox">
              <span class="cs3-q-text">¿Tuvo días de no clase?</span>
            </label>
            <div class="cs3-q-sub" id="cs3-noclass-sub" hidden>
              <span class="cs3-q-sublabel">Número de días de no clase</span>
              <div class="cs3-num-row">
                <input type="number" id="cs3NoclassDays" class="cs3-num-input" min="0" max="30" value="0">
                <span class="cs3-num-unit">días</span>
              </div>
              <p class="cs3-hint">Recesos escolares o festivos sin actividad PAE</p>
            </div>
          </div>

          <div class="cs3-q-block">
            <label class="cs3-q-label">
              <input type="checkbox" id="cs3HasNov" class="cs3-checkbox">
              <span class="cs3-q-text">¿Tuvo novedades de nómina?</span>
            </label>
            <div class="cs3-q-sub" id="cs3-nov-sub" hidden>
              <span class="cs3-q-sublabel">Tipo de novedad</span>
              <select id="cs3NovType" class="cs3-select">
                <option value="">— Seleccionar —</option>
                ${NOVELTY_TYPES.map(n => `<option value="${n.id}">${n.label}</option>`).join("")}
              </select>
              <span class="cs3-q-sublabel">Número de días</span>
              <div class="cs3-num-row">
                <input type="number" id="cs3NovDays" class="cs3-num-input" min="1" max="30" value="1">
                <span class="cs3-num-unit">días</span>
              </div>
              <button type="button" id="cs3BtnAddNov" class="cs3-btn-add">+ Añadir novedad</button>
              <div id="cs3-nov-list" class="cs3-nov-list"></div>
            </div>
          </div>

        </div>
      </div>

      <!-- ── Card 3: Resultado ─────────────────────────────────────────────── -->
      <div class="cs3-card cs3-card--result">
        <div class="cs3-card-hdr cs3-card-hdr--result">
          <span class="cs3-num cs3-num--result">3</span>
          <span class="cs3-card-title cs3-card-title--result">Resultado</span>
        </div>
        <div class="cs3-card-body">
          <div id="cs3-result">
            <div class="cs3-empty">
              <div class="cs3-empty-icon">💰</div>
              <p>Selecciona una modalidad de trabajo para ver el cálculo.</p>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>

</div>`;
}

// ── Sub-renderers personal requerido ──────────────────────────────────────────

function _modalityDesc(m) {
  if (m === "CAA")    return "Centro de Atención Alimentaria";
  if (m === "CAARES") return "CAA Rural / Especial";
  if (m === "RI")     return "Ruta de Insumos";
  return "";
}

function _formulaText(modality) {
  if (modality === "CAA")    return "1 + (Cupos − 60) / 120";
  if (modality === "CAARES") return "1 + ((Cupos × 4) − 60) / 120";
  if (modality === "RI")     return "Escalonado: 0–100→0, 101–300→1, 301–500→2, 501–800→3, >800→4";
  return "";
}

function _previewHtml(modality, cupos) {
  const result = calculate(modality, cupos);
  if (!result) return "";
  const { raw, fullTime, halfTime } = result;
  const rawStr = modality === "RI" ? String(raw) : raw.toFixed(4);
  return `
    <div class="cc-preview-inner">
      <div class="cc-preview-raw">Resultado bruto: <strong>${rawStr}</strong></div>
      <div class="cc-preview-final">→ ${resultSummary(fullTime, halfTime)}</div>
    </div>`;
}

function _resultHtml(modality, cupos, raw, fullTime, halfTime) {
  const rawStr = modality === "RI" ? String(raw) : Number(raw).toFixed(4);
  return `
<div class="cc-result-inner">
  <div class="cc-result-top">
    ${modalityBadge(modality)}
    <span class="cc-result-cupos">${cupos.toLocaleString("es-CO")} cupos</span>
  </div>
  <div class="cc-result-grid">
    <div class="cc-result-card cc-result-blue">
      <div class="cc-result-card-value">${fullTime}</div>
      <div class="cc-result-card-label">Tiempo${fullTime !== 1 ? "s" : ""} completo${fullTime !== 1 ? "s" : ""}</div>
    </div>
    ${halfTime > 0 ? `
    <div class="cc-result-card cc-result-amber">
      <div class="cc-result-card-value">${halfTime}</div>
      <div class="cc-result-card-label">Medio tiempo</div>
    </div>` : `
    <div class="cc-result-card cc-result-gray">
      <div class="cc-result-card-value">—</div>
      <div class="cc-result-card-label">Medio tiempo</div>
    </div>`}
    <div class="cc-result-card cc-result-green">
      <div class="cc-result-card-value">${fullTime + (halfTime > 0 ? 0.5 : 0)}</div>
      <div class="cc-result-card-label">Total personas</div>
    </div>
  </div>
  <div class="cc-result-summary">
    <strong>Resultado:</strong> ${escapeHtml(resultSummary(fullTime, halfTime))}
  </div>
  ${modality !== "RI" ? `<div class="cc-result-raw">Valor bruto: ${rawStr} · Regla de redondeo aplicada</div>` : ""}
  <div class="cc-result-saved">✓ Registrado en el historial de auditoría</div>
</div>`;
}

function _renderAuditTable(rows) {
  if (!rows.length) {
    return `<p class="cc-audit-empty">No hay cálculos registrados aún.</p>`;
  }
  return `
<div class="cc-audit-table-wrap">
  <table class="cc-audit-table">
    <thead>
      <tr>
        <th>Fecha</th>
        <th>Usuario</th>
        <th>Rol</th>
        <th>Modalidad</th>
        <th>Cupos</th>
        <th>TC</th>
        <th>MT</th>
        <th>IP</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => `
      <tr>
        <td>${fmtDateTime(r.calculated_at)}</td>
        <td class="cc-audit-user">${escapeHtml(r.username)}</td>
        <td><span class="cc-audit-role">${escapeHtml(r.user_role || "—")}</span></td>
        <td>${modalityBadge(r.modality)}</td>
        <td class="cc-num">${Number(r.cupos).toLocaleString("es-CO")}</td>
        <td class="cc-num cc-num-blue">${r.full_time}</td>
        <td class="cc-num cc-num-amber">${r.half_time > 0 ? r.half_time : "—"}</td>
        <td class="cc-audit-ip">${escapeHtml(r.ip_address || "—")}</td>
      </tr>`).join("")}
    </tbody>
  </table>
</div>`;
}

// ── Calculadora de Salario: lógica reactiva (3 cards) ────────────────────────

function _cs3ResultHtml({ mod, cfg, diasNoClase, novelties, diasSinPago, diasCubiertos,
  diasConSalario, diasConTransporte, salarioBase, salarioProp, auxTrans, adicsCalc, totalDev,
  salud, pension, totalDed, neto, smlvCfg, auxTraCfg }) {
  const paidNovs   = novelties.filter(n => n.paid);
  const unpaidNovs = novelties.filter(n => !n.paid);
  const color = mod.startsWith("CAARES") ? "caares" : mod === "RI" ? "ri" : "caa";
  const hasReducen = unpaidNovs.length > 0;
  const hasAfectan = diasNoClase > 0 || paidNovs.length > 0;
  return `
<div class="cs3-result-inner">
  <div class="cs3-result-top">
    <span class="cs3-legend-badge cs3-legend-badge--${color}">${escapeHtml(mod)}</span>
    <span class="cs3-result-cfg-name">${escapeHtml(cfg.label)}</span>
  </div>

  <div class="cs3-rs">
    <div class="cs3-rs-title">📋 Novedades</div>
    ${!hasReducen && !hasAfectan
      ? `<div class="cs3-rs-row cs3-rs-none-row"><span>Sin novedades en el período</span></div>`
      : ""}
    ${hasReducen ? `
    <div class="cs3-rs-subt cs3-rs-subt--red">Reducen salario, transporte y adicionales</div>
    ${unpaidNovs.map(n => `<div class="cs3-rs-row cs3-rs-neg"><span>${escapeHtml(n.label)}</span><b>− ${n.days}d</b></div>`).join("")}
    ` : ""}
    ${hasAfectan ? `
    <div class="cs3-rs-subt cs3-rs-subt--amber">Afectan transporte y adicionales (salario cubierto)</div>
    ${diasNoClase > 0 ? `<div class="cs3-rs-row cs3-rs-warn"><span>Días de no clase</span><b>${diasNoClase}d</b></div>` : ""}
    ${paidNovs.map(n => `<div class="cs3-rs-row cs3-rs-warn"><span>${escapeHtml(n.label)} (${n.days}d)</span><b class="cs3-covered">${escapeHtml(n.coverage)}</b></div>`).join("")}
    ` : ""}
  </div>

  <div class="cs3-rs">
    <div class="cs3-rs-title">💰 Devengados</div>
    <div class="cs3-rs-row"><span>Salario prop. (${diasConSalario}/30)</span><b>${fmtCOP(salarioProp)}</b></div>
    <div class="cs3-rs-row"><span>Aux. transporte prop. (${diasConTransporte}/30)</span><b>${fmtCOP(auxTrans)}</b></div>
    ${adicsCalc.map(a => `<div class="cs3-rs-row"><span>${escapeHtml(a.label)} prop. (${diasConTransporte}/30)</span><b>${fmtCOP(a.prop)}</b></div>`).join("")}
    <div class="cs3-rs-row cs3-rs-sub"><span>Total devengado</span><b>${fmtCOP(totalDev)}</b></div>
  </div>

  <div class="cs3-rs">
    <div class="cs3-rs-title">🔻 Deducciones</div>
    <div class="cs3-rs-row"><span>Salud 4%</span><b class="cs3-ded">− ${fmtCOP(salud)}</b></div>
    <div class="cs3-rs-row"><span>Pensión 4%</span><b class="cs3-ded">− ${fmtCOP(pension)}</b></div>
    <div class="cs3-rs-row cs3-rs-sub"><span>Total deducciones</span><b class="cs3-ded">− ${fmtCOP(totalDed)}</b></div>
  </div>

  <div class="cs3-neto">
    <span class="cs3-neto-lbl">Valor a recibir</span>
    <span class="cs3-neto-val">${fmtCOP(neto)}</span>
  </div>

  <p class="cs3-note">SMLV 2026: ${fmtCOP(smlvCfg)} · Aux. Transporte: ${fmtCOP(auxTraCfg)} · Solo deducciones empleado</p>
</div>`;
}

function _wireCS3() {
  let _mod  = null;
  let _novs = [];

  function update() {
    const el = document.getElementById("cs3-result");
    if (!el) return;
    if (!_mod) {
      el.innerHTML = `<div class="cs3-empty"><div class="cs3-empty-icon">💰</div><p>Selecciona una modalidad de trabajo para ver el cálculo.</p></div>`;
      return;
    }
    const cfg    = CS2_MODALITIES[_mod];
    const modCfg = (_salaryConfigData.modalities || {})[_mod];
    const noClass     = document.getElementById("cs3HasNoClass")?.checked ?? false;
    const diasNoClase = noClass ? Math.max(0, parseInt(document.getElementById("cs3NoclassDays")?.value, 10) || 0) : 0;
    const diasSinPago       = _novs.filter(n => !n.paid).reduce((s, n) => s + n.days, 0);
    const diasCubiertos     = _novs.filter(n => n.paid).reduce((s, n) => s + n.days, 0);
    // No-class days: salary is maintained but transport and adicionales are not paid
    const diasConSalario    = Math.max(0, 30 - diasSinPago);
    const diasConTransporte = Math.max(0, 30 - diasNoClase - diasSinPago - diasCubiertos);
    const smlvCfg   = _salaryConfigData.smlv           ?? SMLV_2025;
    const auxTraCfg = _salaryConfigData.aux_transporte ?? AUX_TRANSPORTE;
    const salarioBase = modCfg?.salary ?? cfg.salary;
    const salarioProp = Math.round(salarioBase / 30 * diasConSalario);
    const auxTrans    = Math.round(auxTraCfg / 30 * diasConTransporte);
    // Adicionales: prorated by diasConTransporte (paid leave also affects them, same as transport)
    const adicionales = (modCfg?.adicionales || []).filter(a => a.label?.trim() && Number(a.value) > 0);
    const adicsCalc   = adicionales.map(a => ({
      label: a.label,
      base:  Number(a.value),
      prop:  Math.round(Number(a.value) / 30 * diasConTransporte),
    }));
    const totalAdics = adicsCalc.reduce((s, a) => s + a.prop, 0);
    const totalDev   = salarioProp + auxTrans + totalAdics;
    const salud      = Math.ceil(salarioProp * SALUD_PCT / 100) * 100;
    const pension    = salud;
    const totalDed   = salud * 2;
    const neto       = totalDev - totalDed;
    el.innerHTML = _cs3ResultHtml({ mod: _mod, cfg, diasNoClase, novelties: _novs,
      diasSinPago, diasCubiertos, diasConSalario, diasConTransporte,
      salarioBase, salarioProp, auxTrans, adicsCalc, totalDev,
      salud, pension, totalDed, neto, smlvCfg, auxTraCfg });
  }

  function renderNovList() {
    const listEl = document.getElementById("cs3-nov-list");
    if (!listEl) return;
    if (!_novs.length) { listEl.innerHTML = ""; return; }
    listEl.innerHTML = _novs.map((n, i) => `
      <div class="cs3-nov-item">
        <div class="cs3-nov-item-left">
          <span class="cs3-nov-tag ${n.paid ? "cs3-nov-tag--paid" : "cs3-nov-tag--unpaid"}">${n.paid ? escapeHtml(n.coverage) : "Descuento"}</span>
          <span class="cs3-nov-name">${escapeHtml(n.label)}</span>
        </div>
        <div class="cs3-nov-item-right">
          <span class="cs3-nov-days-badge">${n.days}d</span>
          <button type="button" class="cs3-nov-remove" data-idx="${i}" aria-label="Eliminar">×</button>
        </div>
      </div>`).join("");
    listEl.querySelectorAll(".cs3-nov-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        _novs.splice(Number(btn.dataset.idx), 1);
        renderNovList();
        update();
      });
    });
  }

  // Modalidad options
  document.querySelectorAll(".cs3-mod-opt").forEach(opt => {
    opt.addEventListener("click", () => {
      document.querySelectorAll(".cs3-mod-opt").forEach(o => o.classList.remove("cs3-mod-opt--active"));
      opt.classList.add("cs3-mod-opt--active");
      opt.querySelector("input[type=radio]").checked = true;
      _mod = opt.dataset.mod;
      update();
    });
  });

  // No clase
  document.getElementById("cs3HasNoClass")?.addEventListener("change", function () {
    const sub = document.getElementById("cs3-noclass-sub");
    if (this.checked) sub?.removeAttribute("hidden");
    else              sub?.setAttribute("hidden", "");
    update();
  });
  document.getElementById("cs3NoclassDays")?.addEventListener("input", update);

  // Novedades toggle
  document.getElementById("cs3HasNov")?.addEventListener("change", function () {
    const sub = document.getElementById("cs3-nov-sub");
    if (this.checked) sub?.removeAttribute("hidden");
    else { sub?.setAttribute("hidden", ""); _novs = []; renderNovList(); update(); }
  });

  // Añadir novedad
  document.getElementById("cs3BtnAddNov")?.addEventListener("click", () => {
    const typeEl = document.getElementById("cs3NovType");
    const daysEl = document.getElementById("cs3NovDays");
    const id = typeEl?.value;
    if (!id) { typeEl?.focus(); return; }
    const days    = Math.max(1, parseInt(daysEl?.value, 10) || 1);
    const novType = NOVELTY_TYPES.find(n => n.id === id);
    if (!novType) return;
    _novs.push({ ...novType, days });
    if (typeEl) typeEl.value = "";
    if (daysEl) daysEl.value = "1";
    renderNovList();
    update();
  });
}

// ── Event wiring ──────────────────────────────────────────────────────────────

export function wireCalculatorEvents() {
  // Tabs
  document.querySelectorAll(".cc-tab[data-cc-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cc-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".cc-tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`cc-panel-${btn.dataset.ccTab}`)?.classList.add("active");
    });
  });

  // ── Calculadora de Personal Requerido ──────────────────────────────────────
  const cuposInput  = document.getElementById("ccCupos");
  const formulaText = document.getElementById("ccFormulaText");
  const preview     = document.getElementById("ccPreview");
  const btnCalc     = document.getElementById("ccBtnCalc");
  const resultPanel = document.getElementById("ccResultPanel");
  const btnRefresh  = document.getElementById("ccBtnRefresh");
  const auditWrap   = document.getElementById("ccAuditWrap");

  if (cuposInput) {
    function getModality() {
      const checked = document.querySelector('input[name="ccModality"]:checked');
      return checked ? checked.value : "CAA";
    }

    function updatePreview() {
      const modality = getModality();
      const cupos    = parseInt(cuposInput.value, 10);
      if (formulaText) formulaText.textContent = _formulaText(modality);
      if (!isNaN(cupos) && cupos >= 0) {
        preview.innerHTML = _previewHtml(modality, cupos);
        preview.style.display = "";
        btnCalc.disabled = false;
      } else {
        preview.style.display = "none";
        btnCalc.disabled = true;
      }
    }

    document.querySelectorAll('input[name="ccModality"]').forEach(r => r.addEventListener("change", updatePreview));
    cuposInput.addEventListener("input", updatePreview);

    btnCalc.addEventListener("click", async () => {
      const modality = getModality();
      const cupos    = parseInt(cuposInput.value, 10);
      if (isNaN(cupos) || cupos < 0) return;
      btnCalc.disabled = true;
      btnCalc.textContent = "Calculando…";
      try {
        const r = await apiFetch("/calculator/calculate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modality, cupos }),
        });
        if (r.ok && r.data) {
          const { raw, fullTime, halfTime } = r.data;
          resultPanel.innerHTML = _resultHtml(modality, cupos, raw, fullTime, halfTime);
          resultPanel.style.display = "";
          resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
          if (auditWrap && isAdminOrTH()) _refreshAuditTable(auditWrap);
        }
      } catch (e) {
        resultPanel.innerHTML = `<div class="cc-result-error">Error: ${escapeHtml(e.message)}</div>`;
        resultPanel.style.display = "";
      } finally {
        btnCalc.disabled = false;
        btnCalc.textContent = "Calcular y registrar";
      }
    });

    if (btnRefresh && auditWrap) {
      btnRefresh.addEventListener("click", () => _refreshAuditTable(auditWrap));
    }
  }

  // ── Calculadora de Salario (3 cards reactivo) ─────────────────────────────
  _wireCS3();
}

async function _refreshAuditTable(auditWrap) {
  try {
    const r = await apiFetch("/calculator/audit?limit=50");
    const rows = Array.isArray(r.data) ? r.data : [];
    const existing = auditWrap.querySelector(".cc-audit-table-wrap, .cc-audit-empty");
    const freshHtml = _renderAuditTable(rows);
    if (existing) {
      existing.outerHTML = freshHtml;
    } else {
      auditWrap.insertAdjacentHTML("beforeend", freshHtml);
    }
  } catch { /* silent */ }
}
