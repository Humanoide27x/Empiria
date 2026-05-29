/**
 * loading.js — Sistema global de carga para EMPIRIA
 *
 * API pública:
 *   _apiLoadingStart(msg?)   — llamado por apiFetch antes de cada petición
 *   _apiLoadingEnd()         — llamado por apiFetch al terminar (éxito o error)
 *   showLoading(msg?)        — control manual desde módulos
 *   hideLoading()            — control manual desde módulos
 *   setBtnLoading(btn, bool, label?) — gestiona estado de botones
 *   withBtnLoading(btn, fn, label?) — wrapper async para botones
 *   showProgress(label?)     — barra de progreso superior
 *   updateProgress(0-100)    — actualiza progreso
 *   hideProgress()           — oculta barra
 */

const OVERLAY_DELAY_MS = 300; // ms antes de mostrar el overlay

let _pendingCount  = 0;
let _overlayTimer  = null;
let _progressOn    = false;

// ── Referencias DOM (lazy) ────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── Overlay interno ───────────────────────────────────────────────────────────
function _showOverlay(message) {
  const el = $("ld-overlay");
  if (!el) return;
  const msg = $("ld-overlay-msg");
  if (msg && message) msg.textContent = message;
  el.classList.add("ld-on");
}

function _hideOverlay() {
  const el = $("ld-overlay");
  if (el) el.classList.remove("ld-on");
}

// ── Integración con apiFetch ──────────────────────────────────────────────────
export function _apiLoadingStart(message = "Procesando información...") {
  _pendingCount++;
  if (_pendingCount === 1 && !_overlayTimer) {
    _overlayTimer = setTimeout(() => {
      _overlayTimer = null;
      if (_pendingCount > 0) _showOverlay(message);
    }, OVERLAY_DELAY_MS);
  }
}

export function _apiLoadingEnd() {
  _pendingCount = Math.max(0, _pendingCount - 1);
  if (_pendingCount === 0) {
    if (_overlayTimer) { clearTimeout(_overlayTimer); _overlayTimer = null; }
    _hideOverlay();
  }
}

// ── Control manual desde módulos ──────────────────────────────────────────────
export function showLoading(message = "Procesando información...") {
  _pendingCount++;
  if (_overlayTimer) { clearTimeout(_overlayTimer); _overlayTimer = null; }
  _showOverlay(message);
}

export function hideLoading() {
  _pendingCount = Math.max(0, _pendingCount - 1);
  if (_pendingCount === 0) _hideOverlay();
}

// ── Estado de botones ─────────────────────────────────────────────────────────

/**
 * setBtnLoading(btn, true, "Guardando...")
 * setBtnLoading(btn, false)
 */
export function setBtnLoading(button, loading, label = "Procesando...") {
  if (!button) return;
  if (loading) {
    if (button.disabled) return;
    button.dataset.ldHtml  = button.innerHTML;
    button.dataset.ldWidth = button.offsetWidth;
    button.style.minWidth  = button.offsetWidth + "px";
    button.disabled        = true;
    button.innerHTML       = `<span class="ld-btn-arc" aria-hidden="true"></span><span>${_esc(label)}</span>`;
  } else {
    button.disabled       = false;
    if (button.dataset.ldHtml !== undefined) {
      button.innerHTML    = button.dataset.ldHtml;
      delete button.dataset.ldHtml;
    }
    button.style.minWidth = "";
  }
}

/**
 * Envuelve una función async en estado de loading para un botón.
 * Uso: await withBtnLoading(btn, async () => { await apiFetch(...) })
 */
export async function withBtnLoading(button, asyncFn, label = "Procesando...") {
  setBtnLoading(button, true, label);
  try {
    return await asyncFn();
  } finally {
    setBtnLoading(button, false);
  }
}

// ── Barra de progreso superior ────────────────────────────────────────────────
export function showProgress(label = "") {
  const bar  = $("ld-progress");
  const fill = $("ld-progress-fill");
  const lbl  = $("ld-progress-label");
  if (!bar || !fill) return;
  _progressOn = true;
  if (lbl && label) lbl.textContent = label;
  fill.style.transition = "none";
  fill.style.width = "0%";
  bar.classList.add("ld-on");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.transition = "width 2s cubic-bezier(0.1, 0.6, 0.4, 1)";
    fill.style.width = "68%";
  }));
}

export function updateProgress(pct) {
  const fill = $("ld-progress-fill");
  if (!fill || !_progressOn) return;
  fill.style.transition = "width 0.25s ease";
  fill.style.width = Math.min(99, Math.max(0, pct)) + "%";
}

export function hideProgress() {
  const bar  = $("ld-progress");
  const fill = $("ld-progress-fill");
  if (!bar || !fill || !_progressOn) return;
  _progressOn = false;
  fill.style.transition = "width 0.15s ease";
  fill.style.width = "100%";
  setTimeout(() => {
    bar.classList.remove("ld-on");
    requestAnimationFrame(() => { fill.style.transition = "none"; fill.style.width = "0%"; });
  }, 220);
}

// ── Helper privado ────────────────────────────────────────────────────────────
function _esc(str) {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
