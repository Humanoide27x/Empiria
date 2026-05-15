import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { escapeHtml } from '../utils.js';

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

// ── Constantes de nómina Colombia 2025 ───────────────────────────────────────

const SMLV_2025        = 1423500;
const AUX_TRANSPORTE   = 200000;
const SALUD_PCT        = 0.04;
const PENSION_PCT      = 0.04;
const HE_DIURNA_FACTOR = 1.25;
const HE_NOCT_FACTOR   = 1.75;
const HRS_MES          = 240;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

  <!-- ── Panel: Calculadora de Salario ─────────────────────────────────────── -->
  <div class="cc-tab-panel" id="cc-panel-salario">
    <section class="personnel-premium-hero">
      <div>
        <span class="personnel-premium-eyebrow">Herramienta de Cálculo</span>
        <h2>Calculadora de Salario</h2>
        <p>Calcula el salario neto a pagar incluyendo devengados, horas extras y deducciones de ley.</p>
      </div>
    </section>

    <div class="cc-card">
      <div class="cc-card-body">

        <!-- Salario base -->
        <div class="cc-section-label">Información del cargo</div>
        <div class="cs-grid-2">
          <div class="cc-input-row">
            <label class="cc-input-label" for="csSalarioBase">Salario base mensual</label>
            <div class="cc-input-wrap">
              <span class="cc-input-prefix">$</span>
              <input type="number" id="csSalarioBase" class="cc-cupos-input"
                placeholder="${SMLV_2025.toLocaleString("es-CO")}" min="0" step="1000" value="${SMLV_2025}">
            </div>
            <small class="cc-input-hint">SMLV 2025: ${fmtCOP(SMLV_2025)}</small>
          </div>
          <div class="cc-input-row">
            <label class="cc-input-label" for="csDiasTrabajados">Días trabajados</label>
            <div class="cc-input-wrap">
              <input type="number" id="csDiasTrabajados" class="cc-cupos-input"
                placeholder="30" min="1" max="30" step="1" value="30">
              <span class="cc-input-unit">días</span>
            </div>
          </div>
        </div>

        <!-- Horas extras -->
        <div class="cc-section-label" style="margin-top:4px">Horas extras</div>
        <div class="cs-grid-2">
          <div class="cc-input-row">
            <label class="cc-input-label" for="csHEDiurnas">H.E. diurnas <small>(×1.25)</small></label>
            <div class="cc-input-wrap">
              <input type="number" id="csHEDiurnas" class="cc-cupos-input"
                placeholder="0" min="0" max="999" step="0.5" value="0">
              <span class="cc-input-unit">horas</span>
            </div>
          </div>
          <div class="cc-input-row">
            <label class="cc-input-label" for="csHENocturnas">H.E. nocturnas <small>(×1.75)</small></label>
            <div class="cc-input-wrap">
              <input type="number" id="csHENocturnas" class="cc-cupos-input"
                placeholder="0" min="0" max="999" step="0.5" value="0">
              <span class="cc-input-unit">horas</span>
            </div>
          </div>
        </div>

        <!-- Auxilio de transporte -->
        <div class="cs-aux-row" id="csAuxRow">
          <label class="cs-aux-check">
            <input type="checkbox" id="csAuxCheck" checked>
            <span>Auxilio de transporte — ${fmtCOP(AUX_TRANSPORTE)}/mes</span>
          </label>
          <small class="cc-input-hint" id="csAuxHint">Aplica automáticamente si el salario base es ≤ 2 SMLV (${fmtCOP(SMLV_2025 * 2)})</small>
        </div>

        <button class="cc-btn-calc" id="csBtnCalc" type="button">
          Calcular salario
        </button>
      </div>
    </div>

    <!-- Resultado salario -->
    <div class="cc-result-panel cs-result-panel" id="csResultPanel" style="display:none"></div>
  </div>

</div>`;
}

// ── Sub-renderers ─────────────────────────────────────────────────────────────

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

function _salaryResultHtml({ salarioBase, dias, salarioProp, auxTrans, heDiurnaVal, heNoctVal,
  totalDevengado, salud, pension, totalDeducciones, neto }) {
  return `
<div class="cc-result-inner cs-result-inner">
  <div class="cc-result-top">
    <span class="cs-result-title">Liquidación de nómina</span>
    <span class="cs-result-dias">${dias} días trabajados</span>
  </div>

  <div class="cs-result-section">
    <div class="cs-result-section-title">Devengados</div>
    <div class="cs-result-row"><span>Salario proporcional (${dias}/30)</span><strong>${fmtCOP(salarioProp)}</strong></div>
    ${auxTrans > 0 ? `<div class="cs-result-row"><span>Auxilio de transporte</span><strong>${fmtCOP(auxTrans)}</strong></div>` : ""}
    ${heDiurnaVal > 0 ? `<div class="cs-result-row"><span>H.E. diurnas</span><strong>${fmtCOP(heDiurnaVal)}</strong></div>` : ""}
    ${heNoctVal > 0 ? `<div class="cs-result-row"><span>H.E. nocturnas</span><strong>${fmtCOP(heNoctVal)}</strong></div>` : ""}
    <div class="cs-result-row cs-result-subtotal"><span>Total devengado</span><strong>${fmtCOP(totalDevengado)}</strong></div>
  </div>

  <div class="cs-result-section">
    <div class="cs-result-section-title">Deducciones del empleado</div>
    <div class="cs-result-row"><span>Salud (4%)</span><strong class="cs-ded">− ${fmtCOP(salud)}</strong></div>
    <div class="cs-result-row"><span>Pensión (4%)</span><strong class="cs-ded">− ${fmtCOP(pension)}</strong></div>
    <div class="cs-result-row cs-result-subtotal"><span>Total deducciones</span><strong class="cs-ded">− ${fmtCOP(totalDeducciones)}</strong></div>
  </div>

  <div class="cs-result-neto">
    <span>Neto a pagar</span>
    <strong>${fmtCOP(neto)}</strong>
  </div>
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

// ── Event wiring ──────────────────────────────────────────────────────────────

export function wireCalculatorEvents() {
  // ── Tabs ────────────────────────────────────────────────────────────────────
  document.querySelectorAll(".cc-tab[data-cc-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cc-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".cc-tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`cc-panel-${btn.dataset.ccTab}`)?.classList.add("active");
    });
  });

  // ── Calculadora de Personal Requerido ────────────────────────────────────────
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

  // ── Calculadora de Salario ───────────────────────────────────────────────────
  const salarioInput  = document.getElementById("csSalarioBase");
  const diasInput     = document.getElementById("csDiasTrabajados");
  const heDiurInput   = document.getElementById("csHEDiurnas");
  const heNoctInput   = document.getElementById("csHENocturnas");
  const auxCheck      = document.getElementById("csAuxCheck");
  const auxHint       = document.getElementById("csAuxHint");
  const csBtnCalc     = document.getElementById("csBtnCalc");
  const csResultPanel = document.getElementById("csResultPanel");

  if (!salarioInput) return;

  function updateAuxCheckState() {
    const base = parseFloat(salarioInput.value) || 0;
    const eligible = base <= SMLV_2025 * 2;
    if (auxCheck) {
      auxCheck.checked = eligible;
      auxCheck.disabled = !eligible;
    }
    if (auxHint) {
      auxHint.textContent = eligible
        ? `Aplica: salario ≤ 2 SMLV (${fmtCOP(SMLV_2025 * 2)})`
        : `No aplica: salario > 2 SMLV (${fmtCOP(SMLV_2025 * 2)})`;
    }
  }

  salarioInput.addEventListener("input", updateAuxCheckState);
  updateAuxCheckState();

  csBtnCalc.addEventListener("click", () => {
    const salarioBase = parseFloat(salarioInput.value) || 0;
    const dias        = Math.min(30, Math.max(1, parseInt(diasInput.value, 10) || 30));
    const heDiurnas   = parseFloat(heDiurInput.value) || 0;
    const heNocturnas = parseFloat(heNoctInput.value) || 0;
    const auxEnabled  = auxCheck?.checked ?? false;

    const salarioProp  = Math.round((salarioBase / 30) * dias);
    const auxTrans     = auxEnabled ? Math.round((AUX_TRANSPORTE / 30) * dias) : 0;
    const valorHora    = salarioBase / HRS_MES;
    const heDiurnaVal  = Math.round(valorHora * HE_DIURNA_FACTOR * heDiurnas);
    const heNoctVal    = Math.round(valorHora * HE_NOCT_FACTOR   * heNocturnas);
    const totalDevengado = salarioProp + auxTrans + heDiurnaVal + heNoctVal;

    // Deducciones calculan sobre salario proporcional (no sobre aux. transporte)
    const salud    = Math.round(salarioProp * SALUD_PCT);
    const pension  = Math.round(salarioProp * PENSION_PCT);
    const totalDeducciones = salud + pension;
    const neto = totalDevengado - totalDeducciones;

    csResultPanel.innerHTML = _salaryResultHtml({
      salarioBase, dias, salarioProp, auxTrans,
      heDiurnaVal, heNoctVal, totalDevengado,
      salud, pension, totalDeducciones, neto,
    });
    csResultPanel.style.display = "";
    csResultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
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
