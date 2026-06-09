import { apiFetch } from "../api.js";
import { escapeHtml, escapeAttr } from "../utils.js";
import { showError, showSuccess, showWarning } from "../toast.js";

const BULK_UI_STATE = {
  busy: false,
  lastReport: null,
  selectedFiles: [],
  batchId: null,
  previewRows: [],
  catalog: [],
};

const STATUS_CONFIG = {
  READY:             { label: "Listo",             color: "#16a34a", bg: "#dcfce7" },
  DUPLICATE:         { label: "Duplicado",         color: "#d97706", bg: "#fef3c7" },
  NOT_FOUND:         { label: "No encontrado",     color: "#dc2626", bg: "#fee2e2" },
  TYPE_UNRECOGNIZED: { label: "Tipo desconocido",  color: "#9333ea", bg: "#f3e8ff" },
  INVALID_FILENAME:  { label: "Nombre inválido",   color: "#dc2626", bg: "#fee2e2" },
  REQUIRES_REVIEW:   { label: "Revisar",           color: "#d97706", bg: "#fef3c7" },
  ERROR:             { label: "Error",             color: "#dc2626", bg: "#fee2e2" },
  OMITTED:           { label: "Omitido",           color: "#64748b", bg: "#f1f5f9" },
};

function statusBadge(status) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.ERROR;
  return `<span style="display:inline-flex;align-items:center;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.04em;color:${cfg.color};background:${cfg.bg}">${escapeHtml(cfg.label)}</span>`;
}

function catalogOptions(catalog = [], selected = "") {
  return catalog.map((code) => {
    const label = code.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    return `<option value="${escapeAttr(code)}"${code === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function renderMiniSummary(rows = []) {
  if (!rows.length) return `<div class="dc-empty">Sin archivos en el lote.</div>`;
  const counts = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  return `
    <div class="dc-summary-list">
      ${Object.entries(counts).map(([status, n]) => {
        const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.ERROR;
        return `<div class="dc-summary-row">
          <span>${escapeHtml(cfg.label)}</span>
          <strong style="color:${cfg.color}">${n}</strong>
        </div>`;
      }).join("")}
    </div>
  `;
}

function renderPreviewSection(rows = [], catalog = []) {
  if (!rows.length) return `<div class="dc-empty">El servidor no devolvió filas.</div>`;

  const hasActionable = rows.some((r) => r.status === "READY" || r.status === "DUPLICATE");
  const AUTO_OMIT = new Set(["NOT_FOUND", "INVALID_FILENAME", "TYPE_UNRECOGNIZED", "ERROR"]);

  const trs = rows.map((row, i) => {
    const dimmed = AUTO_OMIT.has(row.status);

    const employeeCell = (row.status === "READY" || row.status === "DUPLICATE")
      ? `<span style="font-weight:500">${escapeHtml(row.employee_name || "—")}</span>${row.detected_document_number ? `<br><small style="color:#94a3b8">${escapeHtml(row.detected_document_number)}</small>` : ""}`
      : `<span style="color:#94a3b8;font-size:11px;font-style:italic">${escapeHtml(row.reason || "Sin coincidencia")}</span>`;

    const docTypeCell = (row.status === "TYPE_UNRECOGNIZED" && catalog.length)
      ? `<select class="dc-row-doctype" data-row="${i}" style="font-size:12px;border:1px solid #dbe4ee;border-radius:8px;padding:3px 8px;max-width:160px">
           <option value="">— elegir —</option>
           ${catalogOptions(catalog)}
         </select>`
      : `<span>${escapeHtml(row.document_type || "—")}</span>`;

    return `<tr data-row="${i}" style="border-bottom:1px solid #f1f5f9;${dimmed ? "opacity:.5" : ""}">
      <td style="padding:7px 8px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px" title="${escapeAttr(row.original_filename || "")}">${escapeHtml(row.original_filename || "")}</td>
      <td style="padding:7px 8px;font-size:12px">${employeeCell}</td>
      <td style="padding:7px 8px;font-size:12px">${docTypeCell}</td>
      <td style="padding:7px 8px">${statusBadge(row.status)}</td>
      <td style="padding:7px 8px;text-align:center">
        <input type="checkbox" class="dc-row-omit" data-row="${i}"
          ${dimmed ? "checked disabled" : ""}
          title="${dimmed ? "Omitido automáticamente" : "Marcar para omitir"}" />
      </td>
    </tr>`;
  }).join("");

  const confirmBar = hasActionable ? `
    <div id="dcConfirmBar" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;flex-shrink:0">
        Duplicados:
        <select id="dcDuplicateStrategy" style="border:1px solid #dbe4ee;border-radius:8px;padding:6px 10px;font-size:13px">
          <option value="SKIP">Omitir duplicados</option>
          <option value="REPLACE">Reemplazar el anterior</option>
          <option value="KEEP_BOTH">Conservar ambas versiones</option>
        </select>
      </label>
      <button type="button" id="dcConfirmBtn" class="btn btn-primary" style="margin-left:auto">
        Confirmar carga
      </button>
    </div>` : `
    <p style="margin:10px 0 0;font-size:13px;color:#94a3b8;text-align:center">
      Ningún archivo puede confirmarse. Revisa los errores arriba.
    </p>`;

  return `
    <div style="overflow-x:auto;max-height:360px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:12px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead style="position:sticky;top:0;background:#f8fafc;z-index:1">
          <tr style="border-bottom:2px solid #e2e8f0;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.07em">
            <th style="text-align:left;padding:8px">Archivo</th>
            <th style="text-align:left;padding:8px">Empleado</th>
            <th style="text-align:left;padding:8px">Tipo documental</th>
            <th style="text-align:left;padding:8px">Estado</th>
            <th style="padding:8px">Omitir</th>
          </tr>
        </thead>
        <tbody>${trs}</tbody>
      </table>
    </div>
    ${confirmBar}
  `;
}

function renderFinalSummary(data, batchId) {
  const s       = data.summary || {};
  const saved   = s.saved_count    ?? data.savedCount    ?? 0;
  const omitted = s.omitted_count  ?? data.omittedCount  ?? 0;
  const dupes   = s.duplicate_count ?? data.duplicateCount ?? 0;
  const errors  = s.error_count    ?? data.errorCount    ?? 0;

  const problemRows = (data.rows || []).filter(
    (r) => (r.action === "OMIT" || r.status === "ERROR") && r.original_filename
  );

  return `
    <div class="dc-summary-list" style="margin-bottom:12px">
      <div class="dc-summary-row"><span>Guardados</span><strong style="color:#16a34a">${saved}</strong></div>
      <div class="dc-summary-row"><span>Omitidos</span><strong style="color:#64748b">${omitted}</strong></div>
      <div class="dc-summary-row"><span>Duplicados procesados</span><strong style="color:#d97706">${dupes}</strong></div>
      <div class="dc-summary-row"><span>Errores</span><strong style="color:#dc2626">${errors}</strong></div>
    </div>
    ${problemRows.length ? `
      <details style="font-size:12px;margin-bottom:12px;color:#64748b">
        <summary style="cursor:pointer;font-weight:600;margin-bottom:4px">${problemRows.length} archivo(s) con problemas</summary>
        <ul style="margin:4px 0 0 14px;padding:0">
          ${problemRows.map((r) => `<li style="margin:3px 0">${escapeHtml(r.original_filename || "")} — ${escapeHtml(r.reason || r.action || "")}</li>`).join("")}
        </ul>
      </details>
    ` : ""}
    <a href="/documents/bulk/batches/${encodeURIComponent(String(batchId))}/export"
       target="_blank" download
       class="btn btn-secondary" style="font-size:13px;display:inline-flex;align-items:center;gap:6px">
      Descargar reporte XLSX
    </a>
  `;
}

function buildDocumentCenterHtml() {
  return `
    <style>
      .dc-shell { display:flex; flex-direction:column; gap:16px; }
      .dc-panel { display:flex; flex-direction:column; gap:16px; }
      .dc-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
      .dc-head h2 { margin:4px 0 6px; }
      .dc-head p { margin:0; color:#64748b; }
      .dc-head-actions { display:flex; gap:8px; flex-wrap:wrap; }
      .dc-card { background:#fff; border:1px solid #e2e8f0; border-radius:18px; padding:16px; display:flex; flex-direction:column; gap:12px; }
      .dc-grid { display:grid; grid-template-columns: minmax(0,1fr) 280px; gap:14px; align-items:start; }
      .dc-field { display:flex; flex-direction:column; gap:6px; }
      .dc-field > span { font-size:11px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#475569; }
      .dc-field input, .dc-field select { border:1px solid #dbe4ee; border-radius:12px; padding:10px 12px; font-size:14px; }
      .dc-empty { padding:20px; border:1px dashed #dbe4ee; border-radius:14px; color:#64748b; background:#fff; text-align:center; }
      .dc-summary-list { display:flex; flex-direction:column; gap:6px; }
      .dc-summary-row { display:flex; align-items:center; justify-content:space-between; gap:12px; color:#475569; font-size:13px; padding:6px 10px; border-radius:8px; background:#f8fafc; }
      .dc-summary-row strong { font-size:15px; }
      @media (max-width: 960px) { .dc-grid { grid-template-columns:1fr; } }
    </style>

    <div class="dc-shell">
      <section class="dc-panel">
        <div class="dc-head">
          <div>
            <span class="personnel-premium-eyebrow">Centro de Documentos</span>
            <h2>Carga masiva</h2>
            <p>Sube PDFs, imágenes o ZIPs con documentos de empleados.</p>
          </div>
          <div class="dc-head-actions">
            <button type="button" class="btn btn-secondary" id="dcResetBulk">Limpiar</button>
            <button type="button" class="btn btn-primary" id="dcUploadBulk">Subir documentos</button>
          </div>
        </div>

        <div class="dc-grid">
          <div class="dc-card">
            <label class="dc-field">
              <span>Modo de carga</span>
              <select id="dcUploadMode">
                <option value="CATEGORY">Por categoría (todos del mismo tipo)</option>
                <option value="SMART">Inteligente (tipo detectado del nombre)</option>
              </select>
            </label>

            <div id="dcDocTypeWrapper" class="dc-field">
              <span>Tipo documental</span>
              <select id="dcDocumentTypeKey">
                <option value="CEDULA_DE_CIUDADANIA">Cédula de ciudadanía</option>
                <option value="HOJA_DE_VIDA">Hoja de vida</option>
                <option value="CONTRATO_LABORAL">Contrato laboral</option>
                <option value="AFILIACION_EPS">Afiliación EPS</option>
                <option value="AFILIACION_PENSION">Afiliación pensión</option>
                <option value="AFILIACION_ARL">Afiliación ARL</option>
                <option value="SISBEN">SISBEN</option>
                <option value="CERTIFICACION_BANCARIA">Certificación bancaria</option>
                <option value="CERTIFICADO_RESIDENCIA">Certificado de residencia</option>
                <option value="CURSO_MANIPULACION_ALIMENTOS">Curso manipulación alimentos</option>
                <option value="EXAMEN_MANIPULACION_ALIMENTOS">Examen manipulación alimentos</option>
                <option value="DOTACION">Dotación</option>
                <option value="OTROS">Otros</option>
              </select>
            </div>

            <label class="dc-field">
              <span>Archivos</span>
              <input
                id="bulkDocumentFileInput"
                name="files"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.zip"
                multiple
              />
            </label>
            <small id="dcFileCount" style="color:#64748b">0 archivos seleccionados</small>
            <small style="color:#94a3b8;font-size:11px">
              Nombre esperado: TIPO_NOMBRE_APELLIDO.pdf &nbsp;·&nbsp; Máx 10 MB/archivo, 50 MB/ZIP
            </small>
          </div>

          <aside class="dc-card">
            <h3 style="margin:0">Resultado</h3>
            <div id="dcBulkResult" class="dc-empty">No hay resultados todavía.</div>
          </aside>
        </div>

        <div id="dcPreviewSection" style="display:none">
          <div class="dc-card">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <h3 style="margin:0">Vista previa del lote</h3>
              <span id="dcPreviewBatchLabel" style="font-size:12px;color:#94a3b8"></span>
            </div>
            <div id="dcPreviewContent"></div>
          </div>
        </div>
      </section>
    </div>
  `;
}

export function wireBulkEvents() {
  const fileInput    = document.getElementById("bulkDocumentFileInput");
  const fileCount    = document.getElementById("dcFileCount");
  const result       = document.getElementById("dcBulkResult");
  const modeSelect   = document.getElementById("dcUploadMode");
  const docTypeWrap  = document.getElementById("dcDocTypeWrapper");
  const uploadBtn    = document.getElementById("dcUploadBulk");
  const resetBtn     = document.getElementById("dcResetBulk");
  const previewSec   = document.getElementById("dcPreviewSection");
  const previewContent = document.getElementById("dcPreviewContent");

  if (!fileInput) return;

  // Show/hide document type selector based on upload mode
  const syncMode = () => {
    if (docTypeWrap) docTypeWrap.style.display = modeSelect?.value === "SMART" ? "none" : "flex";
  };
  modeSelect?.addEventListener("change", syncMode);
  syncMode();

  // File selection
  fileInput.addEventListener("change", (e) => {
    const accepted = Array.from(e.target.files || []).filter((f) =>
      /\.(pdf|jpg|jpeg|png|zip)$/i.test(f.name || "")
    );
    BULK_UI_STATE.selectedFiles = accepted;
    if (fileCount) fileCount.textContent = `${accepted.length} archivo(s) seleccionado(s)`;
    if (result && !BULK_UI_STATE.batchId) {
      result.innerHTML = accepted.length
        ? `<div class="dc-empty">${accepted.length} archivo(s) listo(s). Haz clic en "Subir documentos".</div>`
        : `<div class="dc-empty">No hay resultados todavía.</div>`;
    }
    e.target.value = "";
  });

  // Preview: upload button
  uploadBtn?.addEventListener("click", doPreview);

  // Confirm: event delegation on the static preview container
  previewSec?.addEventListener("click", (e) => {
    const btn = e.target.closest("#dcConfirmBtn");
    if (btn && !btn.disabled && !BULK_UI_STATE.busy) doConfirm();
  });

  // Reset
  resetBtn?.addEventListener("click", () => {
    BULK_UI_STATE.selectedFiles = [];
    BULK_UI_STATE.batchId       = null;
    BULK_UI_STATE.previewRows   = [];
    BULK_UI_STATE.catalog       = [];
    fileInput.value = "";
    if (fileCount) fileCount.textContent = "0 archivos seleccionados";
    if (result) result.innerHTML = `<div class="dc-empty">No hay resultados todavía.</div>`;
    if (previewSec) previewSec.style.display = "none";
    if (previewContent) previewContent.innerHTML = "";
  });

  async function doPreview() {
    if (BULK_UI_STATE.busy) return;
    const files = BULK_UI_STATE.selectedFiles;
    if (!files.length) {
      showWarning("Selecciona al menos un archivo para continuar.");
      return;
    }

    const uploadMode   = modeSelect?.value || "CATEGORY";
    const documentType = document.getElementById("dcDocumentTypeKey")?.value || "";

    const formData = new FormData();
    formData.append("upload_mode", uploadMode);
    if (uploadMode === "CATEGORY" && documentType) {
      formData.append("document_type", documentType);
    }
    files.forEach((f) => formData.append("files", f));

    try {
      BULK_UI_STATE.busy = true;
      if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = "Analizando..."; }
      if (result) result.innerHTML = `<div class="dc-empty" style="padding:28px 20px">Analizando archivos...</div>`;
      if (previewSec) previewSec.style.display = "none";

      const res     = await apiFetch("/documents/bulk/preview", { method: "POST", body: formData });
      const data    = res?.data || {};
      const rows    = Array.isArray(data.rows)    ? data.rows    : [];
      const catalog = Array.isArray(data.catalog) ? data.catalog : [];

      BULK_UI_STATE.batchId     = data.batch?.id ?? null;
      BULK_UI_STATE.previewRows = rows;
      BULK_UI_STATE.catalog     = catalog;

      if (!rows.length) {
        if (result) result.innerHTML = `<div class="dc-empty">El servidor no devolvió archivos en el preview.</div>`;
        showWarning("El servidor no devolvió archivos en el preview.");
        return;
      }

      // Right panel: mini summary by status
      if (result) result.innerHTML = renderMiniSummary(rows);

      // Below: full preview table
      const batchLabel = document.getElementById("dcPreviewBatchLabel");
      if (batchLabel && BULK_UI_STATE.batchId) {
        batchLabel.textContent = `Lote #${BULK_UI_STATE.batchId}`;
      }
      if (previewContent) previewContent.innerHTML = renderPreviewSection(rows, catalog);
      if (previewSec) previewSec.style.display = "";
      previewSec?.scrollIntoView({ behavior: "smooth", block: "start" });

      const readyCount = rows.filter((r) => r.status === "READY").length;
      if (readyCount) {
        showSuccess(`Preview listo: ${readyCount} archivo(s) para confirmar.`);
      } else {
        showWarning("Preview completado. Ningún archivo está en estado READY.");
      }
    } catch (err) {
      showError(err?.message || "No fue posible analizar los archivos.");
      if (result) {
        result.innerHTML = `<div class="dc-empty" style="color:#dc2626">${escapeHtml(err?.message || "Error al analizar")}</div>`;
      }
    } finally {
      BULK_UI_STATE.busy = false;
      if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = "Subir documentos"; }
    }
  }

  async function doConfirm() {
    const batchId = BULK_UI_STATE.batchId;
    if (!batchId) { showWarning("No hay un lote activo para confirmar."); return; }
    if (BULK_UI_STATE.busy) return;

    const strategy  = document.getElementById("dcDuplicateStrategy")?.value || "SKIP";
    const confirmBtn = document.getElementById("dcConfirmBtn");

    try {
      BULK_UI_STATE.busy = true;
      if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = "Confirmando..."; }

      const res  = await apiFetch("/documents/bulk/confirm", {
        method: "POST",
        body: JSON.stringify({ batch_id: batchId, duplicate_strategy: strategy }),
      });
      const data = res?.data || {};
      BULK_UI_STATE.lastReport = data;

      // Replace the table with the final summary
      if (previewContent) {
        previewContent.innerHTML = `
          <p style="margin:0 0 10px;font-weight:600;color:#16a34a">Carga completada</p>
          ${renderFinalSummary(data, batchId)}
        `;
      }

      // Right panel: update with final counts
      if (result) result.innerHTML = renderMiniSummary(data.rows || BULK_UI_STATE.previewRows);

      showSuccess("Carga confirmada correctamente.");
      BULK_UI_STATE.selectedFiles = [];
      BULK_UI_STATE.batchId       = null;
      if (fileCount) fileCount.textContent = "0 archivos seleccionados";
    } catch (err) {
      showError(err?.message || "No fue posible confirmar la carga.");
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = "Confirmar carga"; }
    } finally {
      BULK_UI_STATE.busy = false;
    }
  }
}

export async function loadCentroDocumentosModule() {
  console.log("[documents] NEW FLOW ACTIVE");
  return buildDocumentCenterHtml();
}
