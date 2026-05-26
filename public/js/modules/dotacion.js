import { apiFetch } from '../api.js';
import { escapeHtml, escapeAttr } from '../utils.js';
import { showSuccess, showError, showWarning } from '../toast.js';
import { state } from '../state.js';

// ── Estado local del módulo ───────────────────────────────────────────────────

const dtState = {
  tab: "asignaciones",      // "catalogo" | "stock" | "asignaciones" | "remisiones"
  catalogo: [],
  stock: [],
  asignaciones: [],
  remisiones: [],
  filtroEstado: "",
  filtroEmpleado: "",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORIAS = ["UNIFORME", "CALZADO", "EPP", "ACCESORIO", "OTRO"];
const CONDICIONES = ["NUEVA", "USADA", "DAÑADA"];
const ESTADOS_ASIG = ["ASIGNADA", "DEVUELTA", "VENCIDA"];
const TALLAS_ROPA = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];
const TALLAS_CALZADO = ["34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45"];

function formatDate(val) {
  if (!val) return "—";
  const d = new Date(val);
  if (isNaN(d)) return val;
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function badgeEstado(estado) {
  const map = {
    ASIGNADA: "badge-asignada",
    DEVUELTA: "badge-devuelta",
    VENCIDA:  "badge-vencida",
  };
  return `<span class="badge-dotacion ${map[estado] || ""}">${escapeHtml(estado)}</span>`;
}

function badgeCond(cond) {
  const map = { NUEVA: "badge-nueva", USADA: "badge-usada", DAÑADA: "badge-danada" };
  return `<span class="badge-dotacion ${map[cond] || ""}">${escapeHtml(cond || "—")}</span>`;
}

function tallaOptions(incluirAll = false) {
  const base = incluirAll ? '<option value="">Todas las tallas</option>' : '<option value="">Sin talla</option>';
  return base + [...TALLAS_ROPA, ...TALLAS_CALZADO].map(t => `<option value="${t}">${t}</option>`).join("");
}

// ── Carga de datos ────────────────────────────────────────────────────────────

async function loadData() {
  const safe = (promise) => promise.catch(() => ({ data: [] }));
  const [cat, stk, asig, rem] = await Promise.all([
    safe(apiFetch("/dotacion/catalogo")),
    safe(apiFetch("/dotacion/stock")),
    safe(apiFetch("/dotacion/asignaciones")),
    safe(apiFetch("/dotacion/remisiones")),
  ]);
  dtState.catalogo     = Array.isArray(cat.data)  ? cat.data  : [];
  dtState.stock        = Array.isArray(stk.data)  ? stk.data  : [];
  dtState.asignaciones = Array.isArray(asig.data) ? asig.data : [];
  dtState.remisiones   = Array.isArray(rem.data)  ? rem.data  : [];
}

// ── Render principal ──────────────────────────────────────────────────────────

export async function loadDotacionModule(moduleConfig) {
  await loadData();
  return renderModule();
}

function renderModule() {
  const canEdit = state.access?.allowedActions?.includes("create") ||
                  state.access?.modules?.gestion_dotacion?.allowedActions?.includes("create") ||
                  true; // backend protege; el frontend solo muestra

  const tabs = [
    { key: "asignaciones", label: "Asignaciones" },
    { key: "remisiones",   label: "Remisiones" },
    { key: "catalogo",     label: "Catálogo" },
    { key: "stock",        label: "Stock en Bodega" },
  ];

  const tabsHtml = tabs.map(t => `
    <button type="button"
      class="dot-tab ${dtState.tab === t.key ? "dot-tab--active" : ""}"
      data-tab="${t.key}">${t.label}</button>
  `).join("");

  let content = "";
  if (dtState.tab === "asignaciones") content = renderAsignaciones();
  else if (dtState.tab === "remisiones") content = renderRemisiones();
  else if (dtState.tab === "catalogo") content = renderCatalogo();
  else if (dtState.tab === "stock")    content = renderStock();

  const html = `
    <article class="dot-module">
      <div class="dot-header">
        <h2 class="dot-title">Gestión de Dotación</h2>
        <div class="dot-tabs">${tabsHtml}</div>
      </div>
      <div class="dot-body" id="dotBody">
        ${content}
      </div>
      <div id="dotModal" class="dot-modal-overlay" style="display:none;"></div>
    </article>
  `;

  setTimeout(wireDotacionEvents, 0);
  return html;
}

// ── Tab: Asignaciones ─────────────────────────────────────────────────────────

function renderAsignaciones() {
  const filtered = dtState.asignaciones.filter(a => {
    if (dtState.filtroEstado && a.estado !== dtState.filtroEstado) return false;
    if (dtState.filtroEmpleado) {
      const q = dtState.filtroEmpleado.toLowerCase();
      return (a.empleado_nombre || "").toLowerCase().includes(q) ||
             (a.empleado_documento || "").toLowerCase().includes(q);
    }
    return true;
  });

  const rows = filtered.map(a => `
    <tr>
      <td>${escapeHtml(a.empleado_nombre)}<br><small class="txt-muted">${escapeHtml(a.empleado_documento)}</small></td>
      <td>${escapeHtml(a.item_nombre)}<br><small class="txt-muted">${escapeHtml(a.categoria || "")}</small></td>
      <td>${escapeHtml(a.talla || "—")}</td>
      <td>${a.cantidad}</td>
      <td>${formatDate(a.fecha_entrega)}</td>
      <td>${formatDate(a.fecha_recibido)}</td>
      <td>${formatDate(a.fecha_vencimiento)}</td>
      <td>${badgeCond(a.condicion)}</td>
      <td>${badgeEstado(a.estado)}</td>
      <td class="dot-actions">
        <button class="btn-icon" data-edit-asig="${a.id}" title="Editar">✏️</button>
        ${a.tiene_evidencia ? `<button class="btn-icon" data-ver-evidencia="${a.id}" title="Ver evidencia">📎</button>` : ""}
        <button class="btn-icon btn-danger-icon" data-del-asig="${a.id}" title="Eliminar">🗑</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="10" class="txt-center txt-muted">No hay asignaciones para mostrar.</td></tr>`;

  return `
    <div class="dot-toolbar">
      <input type="text" id="filtroEmpleado" class="dot-search" placeholder="Buscar empleado..."
        value="${escapeAttr(dtState.filtroEmpleado)}">
      <select id="filtroEstado" class="dot-select">
        <option value="">Todos los estados</option>
        ${ESTADOS_ASIG.map(e => `<option value="${e}" ${dtState.filtroEstado === e ? "selected" : ""}>${e}</option>`).join("")}
      </select>
      <button class="btn btn-primary btn-sm" id="btnNuevaAsig">+ Nueva Asignación</button>
    </div>
    <div class="dot-table-wrap">
      <table class="dot-table">
        <thead>
          <tr>
            <th>Empleado</th><th>Artículo</th><th>Talla</th><th>Cant.</th>
            <th>Entrega</th><th>Recibido</th><th>Vencimiento</th>
            <th>Condición</th><th>Estado</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="dot-count">${filtered.length} registro${filtered.length !== 1 ? "s" : ""}</p>
  `;
}

// ── Tab: Remisiones ───────────────────────────────────────────────────────────

const MODALIDADES = ["CAA", "CAA1", "CAA2", "CAARES", "CAARES1", "CAARES2", "CAARES3", "CAARES4", "RI", "N/A"];

function cellEnvRec(r, tipo) {
  const fecha      = tipo === "enviado" ? r.fecha_enviado  : r.fecha_recibido;
  const tieneComp  = tipo === "enviado" ? r.tiene_comp_env : r.tiene_comp_rec;
  if (!fecha) {
    return `<button class="btn btn-secondary btn-xs" data-marcar-rem="${r.id}" data-tipo-marcar="${tipo}">Marcar</button>`;
  }
  return `<span class="dot-fecha-ok">${formatDate(fecha)}</span>
    ${tieneComp
      ? `<button class="btn-icon" data-ver-comp-rem="${r.id}" data-tipo-comp="${tipo}" title="Ver comprobante">📎</button>`
      : ""}
    <button class="btn-icon" data-marcar-rem="${r.id}" data-tipo-marcar="${tipo}" title="Editar fecha/comprobante">✏️</button>`;
}

function renderRemisiones() {
  const rows = dtState.remisiones.map(r => `
    <tr>
      <td><strong>${escapeHtml(r.numero)}</strong></td>
      <td>${formatDate(r.fecha_envio)}</td>
      <td>${escapeHtml(r.sede_nombre || "—")}</td>
      <td>${escapeHtml(r.modalidad || "—")}</td>
      <td>${escapeHtml(r.responsable || "—")}</td>
      <td style="text-align:center">${r.total_items}</td>
      <td>${cellEnvRec(r, "enviado")}</td>
      <td>${cellEnvRec(r, "recibido")}</td>
      <td>${badgeEstadoRem(r.estado)}</td>
      <td class="dot-actions">
        <button class="btn-icon" data-print-rem="${r.id}" title="Imprimir">🖨️</button>
        <button class="btn-icon" data-edit-rem="${r.id}" title="Editar">✏️</button>
        <button class="btn-icon" data-foto-rem="${r.id}" title="Subir foto firmada">📷</button>
        <button class="btn-icon btn-danger-icon" data-del-rem="${r.id}" title="Eliminar">🗑</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="10" class="txt-center txt-muted">No hay remisiones registradas.</td></tr>`;

  return `
    <div class="dot-toolbar">
      <button class="btn btn-primary btn-sm" id="btnNuevaRem">+ Nueva Remisión</button>
    </div>
    <div class="dot-table-wrap">
      <table class="dot-table">
        <thead>
          <tr>
            <th>N° Remisión</th><th>Fecha</th><th>Sede</th><th>Modalidad</th>
            <th>Responsable</th><th>Ítems</th><th>Enviado</th><th>Recibido</th><th>Estado</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function badgeEstadoRem(estado) {
  const map = { BORRADOR: "badge-usada", ENVIADA: "badge-asignada" };
  return `<span class="badge-dotacion ${map[estado] || ""}">${escapeHtml(estado)}</span>`;
}

// ── Tab: Catálogo ─────────────────────────────────────────────────────────────

function renderCatalogo() {
  const rows = dtState.catalogo.map(c => `
    <tr>
      <td>${escapeHtml(c.nombre)}</td>
      <td>${escapeHtml(c.categoria || "—")}</td>
      <td>${c.requiere_talla ? "Sí" : "No"}</td>
      <td>${c.periodicidad_meses ? `${c.periodicidad_meses} meses` : "—"}</td>
      <td>${escapeHtml(c.descripcion || "—")}</td>
      <td class="dot-actions">
        <button class="btn-icon" data-edit-cat="${c.id}" title="Editar">✏️</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="txt-center txt-muted">No hay artículos en el catálogo.</td></tr>`;

  return `
    <div class="dot-toolbar">
      <button class="btn btn-primary btn-sm" id="btnNuevoCat">+ Nuevo Artículo</button>
    </div>
    <div class="dot-table-wrap">
      <table class="dot-table">
        <thead>
          <tr><th>Nombre</th><th>Categoría</th><th>Talla</th><th>Periodicidad</th><th>Descripción</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ── Tab: Stock ────────────────────────────────────────────────────────────────

function renderStock() {
  const rows = dtState.stock.map(s => `
    <tr>
      <td>${escapeHtml(s.item_nombre)}</td>
      <td>${escapeHtml(s.categoria || "—")}</td>
      <td>${escapeHtml(s.talla || "—")}</td>
      <td class="${s.cantidad_disponible <= 5 ? "txt-warning" : ""}">${s.cantidad_disponible}</td>
      <td class="dot-actions">
        <button class="btn-icon" data-ajustar-stock="${s.id}" title="Ajustar stock">⚖️</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="txt-center txt-muted">Sin registros de stock.</td></tr>`;

  return `
    <div class="dot-toolbar">
      <button class="btn btn-primary btn-sm" id="btnNuevoStock">+ Agregar Stock</button>
    </div>
    <div class="dot-table-wrap">
      <table class="dot-table">
        <thead>
          <tr><th>Artículo</th><th>Categoría</th><th>Talla</th><th>Disponible</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ── Modales de formulario ─────────────────────────────────────────────────────

function showModal(html) {
  const overlay = document.getElementById("dotModal");
  if (!overlay) return;
  overlay.innerHTML = html;
  overlay.style.display = "flex";
}

function closeModal() {
  const overlay = document.getElementById("dotModal");
  if (overlay) { overlay.style.display = "none"; overlay.innerHTML = ""; }
}

function modalFormAsig(asig = null) {
  const catOpts = dtState.catalogo.map(c =>
    `<option value="${c.id}" ${asig?.catalogo_id === c.id ? "selected" : ""}
      data-req-talla="${c.requiere_talla}">${escapeHtml(c.nombre)} (${escapeHtml(c.categoria || "")})</option>`
  ).join("");

  const isEdit = Boolean(asig);
  return `
    <div class="dot-modal">
      <div class="dot-modal-head">
        <h3>${isEdit ? "Editar" : "Nueva"} Asignación</h3>
        <button type="button" class="dot-modal-close" id="btnCerrarModal">✕</button>
      </div>
      <form id="formAsig" class="dot-form">
        ${!isEdit ? `
        <div class="dot-form-row">
          <label>Empleado (documento o nombre)</label>
          <input type="text" id="asigEmpSearch" placeholder="Buscar empleado..." autocomplete="off">
          <input type="hidden" id="asigEmpId" value="${asig?.employee_id || ""}" required>
          <div id="asigEmpResults" class="dot-autocomplete"></div>
        </div>
        ` : `<p class="dot-form-emp"><strong>${escapeHtml(asig.empleado_nombre)}</strong> — ${escapeHtml(asig.empleado_documento)}</p>`}
        <div class="dot-form-row">
          <label>Artículo</label>
          <select id="asigCatId" required>
            <option value="">Seleccionar...</option>
            ${catOpts}
          </select>
        </div>
        <div class="dot-form-row" id="rowTalla">
          <label>Talla</label>
          <select id="asigTalla">${tallaOptions()}</select>
        </div>
        <div class="dot-form-row">
          <label>Cantidad</label>
          <input type="number" id="asigCantidad" min="1" value="${asig?.cantidad || 1}" required>
        </div>
        <div class="dot-form-2col">
          <div class="dot-form-row">
            <label>Fecha de entrega</label>
            <input type="date" id="asigFechaEntrega" value="${asig?.fecha_entrega?.slice(0,10) || ""}">
          </div>
          <div class="dot-form-row">
            <label>Fecha de recibido</label>
            <input type="date" id="asigFechaRecibido" value="${asig?.fecha_recibido?.slice(0,10) || ""}">
          </div>
        </div>
        <div class="dot-form-row">
          <label>Fecha de vencimiento</label>
          <input type="date" id="asigFechaVenc" value="${asig?.fecha_vencimiento?.slice(0,10) || ""}">
        </div>
        <div class="dot-form-2col">
          <div class="dot-form-row">
            <label>Condición</label>
            <select id="asigCondicion">
              ${CONDICIONES.map(c => `<option value="${c}" ${(asig?.condicion||"NUEVA")===c?"selected":""}>${c}</option>`).join("")}
            </select>
          </div>
          <div class="dot-form-row">
            <label>Estado</label>
            <select id="asigEstado">
              ${ESTADOS_ASIG.map(e => `<option value="${e}" ${(asig?.estado||"ASIGNADA")===e?"selected":""}>${e}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="dot-form-row">
          <label>Observaciones</label>
          <textarea id="asigObs" rows="2">${escapeHtml(asig?.observaciones || "")}</textarea>
        </div>
        <div class="dot-form-row">
          <label>Evidencia (imagen/PDF)</label>
          <input type="file" id="asigEvidencia" accept="image/*,.pdf">
          ${asig?.tiene_evidencia ? '<p class="txt-muted txt-sm">Ya tiene evidencia adjunta. Sube un nuevo archivo para reemplazarla.</p>' : ""}
        </div>
        <div class="dot-modal-foot">
          <button type="button" class="btn btn-secondary" id="btnCancelarAsig">Cancelar</button>
          <button type="submit" class="btn btn-primary">${isEdit ? "Guardar cambios" : "Registrar"}</button>
        </div>
      </form>
    </div>
  `;
}

function modalFormCat(cat = null) {
  const isEdit = Boolean(cat);
  return `
    <div class="dot-modal">
      <div class="dot-modal-head">
        <h3>${isEdit ? "Editar" : "Nuevo"} Artículo</h3>
        <button type="button" class="dot-modal-close" id="btnCerrarModal">✕</button>
      </div>
      <form id="formCat" class="dot-form">
        <div class="dot-form-row">
          <label>Nombre *</label>
          <input type="text" id="catNombre" value="${escapeAttr(cat?.nombre || "")}" required>
        </div>
        <div class="dot-form-row">
          <label>Categoría</label>
          <select id="catCategoria">
            <option value="">Sin categoría</option>
            ${CATEGORIAS.map(c => `<option value="${c}" ${cat?.categoria===c?"selected":""}>${c}</option>`).join("")}
          </select>
        </div>
        <div class="dot-form-row">
          <label>Descripción</label>
          <textarea id="catDesc" rows="2">${escapeHtml(cat?.descripcion || "")}</textarea>
        </div>
        <div class="dot-form-2col">
          <div class="dot-form-row">
            <label>¿Requiere talla?</label>
            <input type="checkbox" id="catReqTalla" ${cat?.requiere_talla ? "checked" : ""}>
          </div>
          <div class="dot-form-row">
            <label>Periodicidad (meses)</label>
            <input type="number" id="catPeriodo" min="1" value="${cat?.periodicidad_meses || ""}">
          </div>
        </div>
        ${isEdit ? `
        <div class="dot-form-row">
          <label>Estado</label>
          <select id="catActivo">
            <option value="true" ${cat?.activo !== false ? "selected" : ""}>Activo</option>
            <option value="false" ${cat?.activo === false ? "selected" : ""}>Inactivo</option>
          </select>
        </div>` : ""}
        <div class="dot-modal-foot">
          <button type="button" class="btn btn-secondary" id="btnCancelarCat">Cancelar</button>
          <button type="submit" class="btn btn-primary">${isEdit ? "Guardar cambios" : "Crear artículo"}</button>
        </div>
      </form>
    </div>
  `;
}

function modalFormStock(stockItem = null) {
  const catOpts = dtState.catalogo.map(c =>
    `<option value="${c.id}" ${stockItem?.catalogo_id===c.id?"selected":""}>${escapeHtml(c.nombre)}</option>`
  ).join("");

  return `
    <div class="dot-modal">
      <div class="dot-modal-head">
        <h3>${stockItem ? "Ajustar Stock" : "Agregar Stock"}</h3>
        <button type="button" class="dot-modal-close" id="btnCerrarModal">✕</button>
      </div>
      <form id="formStock" class="dot-form">
        ${stockItem ? `<p class="dot-form-emp"><strong>${escapeHtml(stockItem.item_nombre)}</strong> — Talla: ${stockItem.talla || "Sin talla"} — Disponible: ${stockItem.cantidad_disponible}</p>` : `
        <div class="dot-form-row">
          <label>Artículo</label>
          <select id="stockCatId" required><option value="">Seleccionar...</option>${catOpts}</select>
        </div>
        <div class="dot-form-row">
          <label>Talla (opcional)</label>
          <select id="stockTalla">${tallaOptions()}</select>
        </div>
        `}
        <div class="dot-form-row">
          <label>${stockItem ? "Cantidad a sumar (puede ser negativo para restar)" : "Cantidad disponible"}</label>
          <input type="number" id="stockCantidad" value="${stockItem ? 0 : ""}" required>
        </div>
        <div class="dot-modal-foot">
          <button type="button" class="btn btn-secondary" id="btnCancelarStock">Cancelar</button>
          <button type="submit" class="btn btn-primary">${stockItem ? "Ajustar" : "Guardar"}</button>
        </div>
      </form>
    </div>
  `;
}

// ── Autocompletado de empleado ────────────────────────────────────────────────

let empSearchTimer = null;

function wireEmpSearch() {
  const input = document.getElementById("asigEmpSearch");
  const results = document.getElementById("asigEmpResults");
  const hiddenId = document.getElementById("asigEmpId");
  if (!input) return;

  input.addEventListener("input", () => {
    clearTimeout(empSearchTimer);
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ""; return; }
    empSearchTimer = setTimeout(async () => {
      try {
        const data = await apiFetch(`/personnel?search=${encodeURIComponent(q)}&pageSize=8`);
        const list = Array.isArray(data.data) ? data.data : [];
        if (!list.length) { results.innerHTML = `<div class="dot-emp-opt txt-muted">Sin resultados</div>`; return; }
        results.innerHTML = list.map(e =>
          `<div class="dot-emp-opt" data-id="${e.id}" data-name="${escapeAttr(e.full_name)}">
            ${escapeHtml(e.full_name)} <span class="txt-muted">${escapeHtml(e.document_number || "")}</span>
          </div>`
        ).join("");
        results.querySelectorAll(".dot-emp-opt[data-id]").forEach(opt => {
          opt.addEventListener("click", () => {
            hiddenId.value = opt.dataset.id;
            input.value = opt.dataset.name;
            results.innerHTML = "";
          });
        });
      } catch { results.innerHTML = ""; }
    }, 300);
  });
}

// ── Wire eventos ──────────────────────────────────────────────────────────────

function reloadTab() {
  const body = document.getElementById("dotBody");
  if (!body) return;
  if (dtState.tab === "asignaciones")  body.innerHTML = renderAsignaciones();
  else if (dtState.tab === "remisiones") body.innerHTML = renderRemisiones();
  else if (dtState.tab === "catalogo") body.innerHTML = renderCatalogo();
  else if (dtState.tab === "stock")    body.innerHTML = renderStock();
  wireBodyEvents();
}

function wireDotacionEvents() {
  // Tabs
  document.querySelectorAll(".dot-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      dtState.tab = btn.dataset.tab;
      document.querySelectorAll(".dot-tab").forEach(b => b.classList.remove("dot-tab--active"));
      btn.classList.add("dot-tab--active");
      reloadTab();
    });
  });

  wireBodyEvents();
}

function wireBodyEvents() {
  // Filtros asignaciones
  const filtroEmp = document.getElementById("filtroEmpleado");
  if (filtroEmp) {
    filtroEmp.addEventListener("input", () => { dtState.filtroEmpleado = filtroEmp.value; reloadTab(); });
  }
  const filtroEst = document.getElementById("filtroEstado");
  if (filtroEst) {
    filtroEst.addEventListener("change", () => { dtState.filtroEstado = filtroEst.value; reloadTab(); });
  }

  // Nueva asignación
  document.getElementById("btnNuevaAsig")?.addEventListener("click", () => {
    showModal(modalFormAsig());
    wireModal("asig");
  });

  // Editar asignación
  document.querySelectorAll("[data-edit-asig]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.editAsig);
      const asig = dtState.asignaciones.find(a => a.id === id);
      if (!asig) return;
      showModal(modalFormAsig(asig));
      wireModal("asig", id);
    });
  });

  // Eliminar asignación
  document.querySelectorAll("[data-del-asig]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar esta asignación?")) return;
      try {
        await apiFetch(`/dotacion/asignaciones/${btn.dataset.delAsig}`, { method: "DELETE" });
        showSuccess("Asignación eliminada");
        dtState.asignaciones = dtState.asignaciones.filter(a => a.id !== Number(btn.dataset.delAsig));
        reloadTab();
      } catch (err) { showError(err.message || "Error al eliminar"); }
    });
  });

  // Ver evidencia
  document.querySelectorAll("[data-ver-evidencia]").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        const res = await apiFetch(`/dotacion/asignaciones/${btn.dataset.verEvidencia}/evidencia`);
        if (!res.evidencia) { showWarning("Sin evidencia adjunta"); return; }
        const win = window.open("", "_blank");
        if (res.evidencia.startsWith("data:image")) {
          win.document.write(`<img src="${res.evidencia}" style="max-width:100%">`);
        } else {
          win.document.write(`<iframe src="${res.evidencia}" style="width:100%;height:100vh;border:none;"></iframe>`);
        }
      } catch { showError("No se pudo cargar la evidencia"); }
    });
  });

  // Nuevo artículo catálogo
  document.getElementById("btnNuevoCat")?.addEventListener("click", () => {
    showModal(modalFormCat());
    wireModal("cat");
  });

  // Editar artículo
  document.querySelectorAll("[data-edit-cat]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.editCat);
      const cat = dtState.catalogo.find(c => c.id === id);
      if (!cat) return;
      showModal(modalFormCat(cat));
      wireModal("cat", id);
    });
  });

  // Nueva remisión
  document.getElementById("btnNuevaRem")?.addEventListener("click", () => {
    showModal(modalFormRemision());
    wireModalRemision();
  });

  // Editar remisión
  document.querySelectorAll("[data-edit-rem]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.editRem);
      try {
        const res = await apiFetch(`/dotacion/remisiones/${id}`);
        showModal(modalFormRemision(res.data));
        wireModalRemision(res.data);
      } catch { showError("No se pudo cargar la remisión"); }
    });
  });

  // Eliminar remisión
  document.querySelectorAll("[data-del-rem]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar esta remisión y todos sus ítems?")) return;
      try {
        await apiFetch(`/dotacion/remisiones/${btn.dataset.delRem}`, { method: "DELETE" });
        showSuccess("Remisión eliminada");
        dtState.remisiones = dtState.remisiones.filter(r => r.id !== Number(btn.dataset.delRem));
        reloadTab();
      } catch (err) { showError(err.message || "Error al eliminar"); }
    });
  });

  // Subir foto firmada
  document.querySelectorAll("[data-foto-rem]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.fotoRem);
      showModal(modalSubirFoto(id));
      wireModalFoto(id);
    });
  });

  // Marcar enviado / recibido
  document.querySelectorAll("[data-marcar-rem]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id   = Number(btn.dataset.marcarRem);
      const tipo = btn.dataset.tipoMarcar;
      const r    = dtState.remisiones.find(r => r.id === id);
      if (!r) return;
      showModal(modalMarcarEnvio(r, tipo));
      wireModalMarcar(id, tipo);
    });
  });

  // Ver comprobante enviado / recibido
  document.querySelectorAll("[data-ver-comp-rem]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id   = Number(btn.dataset.verCompRem);
      const tipo = btn.dataset.tipoComp;
      try {
        const res = await apiFetch(`/dotacion/remisiones/${id}/${tipo}`);
        if (!res.comprobante) { showWarning("Sin comprobante adjunto"); return; }
        const win = window.open("", "_blank");
        if (!win) { showWarning("Permite ventanas emergentes e intenta de nuevo"); return; }
        if (res.comprobante.startsWith("data:image")) {
          win.document.write(`<img src="${res.comprobante}" style="max-width:100%">`);
        } else {
          win.document.write(`<iframe src="${res.comprobante}" style="width:100%;height:100vh;border:none;"></iframe>`);
        }
      } catch { showError("No se pudo cargar el comprobante"); }
    });
  });

  // Imprimir remisión
  document.querySelectorAll("[data-print-rem]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.printRem);
      try {
        const res = await apiFetch(`/dotacion/remisiones/${id}`);
        imprimirRemision(res.data);
      } catch { showError("No se pudo cargar la remisión para imprimir"); }
    });
  });

  // Agregar stock
  document.getElementById("btnNuevoStock")?.addEventListener("click", () => {
    showModal(modalFormStock());
    wireModal("stock");
  });

  // Ajustar stock
  document.querySelectorAll("[data-ajustar-stock]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.ajustarStock);
      const item = dtState.stock.find(s => s.id === id);
      if (!item) return;
      showModal(modalFormStock(item));
      wireModal("stock", id);
    });
  });
}

function wireModal(type, id = null) {
  document.getElementById("btnCerrarModal")?.addEventListener("click", closeModal);
  document.getElementById("btnCancelarAsig")?.addEventListener("click", closeModal);
  document.getElementById("btnCancelarCat")?.addEventListener("click", closeModal);
  document.getElementById("btnCancelarStock")?.addEventListener("click", closeModal);

  if (type === "asig") {
    wireEmpSearch();

    // Mostrar/ocultar talla según artículo seleccionado
    const catSel = document.getElementById("asigCatId");
    const rowTalla = document.getElementById("rowTalla");
    function toggleTalla() {
      const sel = catSel.options[catSel.selectedIndex];
      const req = sel?.dataset?.reqTalla === "true";
      if (rowTalla) rowTalla.style.display = req ? "" : "none";
    }
    catSel?.addEventListener("change", toggleTalla);
    toggleTalla();

    document.getElementById("formAsig")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const empId = document.getElementById("asigEmpId")?.value;
      const catId = document.getElementById("asigCatId")?.value;
      if (!id && !empId) { showWarning("Selecciona un empleado"); return; }
      if (!catId) { showWarning("Selecciona un artículo"); return; }

      const evidFile = document.getElementById("asigEvidencia")?.files?.[0];
      let evidBase64 = undefined;
      if (evidFile) {
        evidBase64 = await fileToBase64(evidFile);
      }

      const body = {
        ...(id ? {} : { employee_id: Number(empId) }),
        catalogo_id:      Number(catId),
        talla:            document.getElementById("asigTalla")?.value || null,
        cantidad:         Number(document.getElementById("asigCantidad")?.value) || 1,
        fecha_entrega:    document.getElementById("asigFechaEntrega")?.value || null,
        fecha_recibido:   document.getElementById("asigFechaRecibido")?.value || null,
        fecha_vencimiento:document.getElementById("asigFechaVenc")?.value || null,
        condicion:        document.getElementById("asigCondicion")?.value,
        estado:           document.getElementById("asigEstado")?.value,
        observaciones:    document.getElementById("asigObs")?.value || null,
        ...(evidBase64 !== undefined ? { evidencia: evidBase64 } : {}),
      };

      try {
        if (id) {
          const res = await apiFetch(`/dotacion/asignaciones/${id}`, { method: "PUT", body: JSON.stringify(body) });
          const idx = dtState.asignaciones.findIndex(a => a.id === id);
          if (idx >= 0) dtState.asignaciones[idx] = { ...dtState.asignaciones[idx], ...res.data };
          showSuccess("Asignación actualizada");
        } else {
          const res = await apiFetch("/dotacion/asignaciones", { method: "POST", body: JSON.stringify(body) });
          // Refrescar lista
          const fresh = await apiFetch("/dotacion/asignaciones");
          dtState.asignaciones = Array.isArray(fresh.data) ? fresh.data : dtState.asignaciones;
          showSuccess("Asignación registrada");
        }
        closeModal();
        reloadTab();
      } catch (err) { showError(err.message || "Error al guardar"); }
    });
  }

  if (type === "cat") {
    document.getElementById("formCat")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = {
        nombre:            document.getElementById("catNombre")?.value?.trim(),
        categoria:         document.getElementById("catCategoria")?.value || null,
        descripcion:       document.getElementById("catDesc")?.value || null,
        requiere_talla:    document.getElementById("catReqTalla")?.checked ?? false,
        periodicidad_meses:Number(document.getElementById("catPeriodo")?.value) || null,
        ...(id ? { activo: document.getElementById("catActivo")?.value === "true" } : {}),
      };
      if (!body.nombre) { showWarning("El nombre es requerido"); return; }

      try {
        if (id) {
          const res = await apiFetch(`/dotacion/catalogo/${id}`, { method: "PUT", body: JSON.stringify(body) });
          const idx = dtState.catalogo.findIndex(c => c.id === id);
          if (idx >= 0) dtState.catalogo[idx] = { ...dtState.catalogo[idx], ...res.data };
          showSuccess("Artículo actualizado");
        } else {
          await apiFetch("/dotacion/catalogo", { method: "POST", body: JSON.stringify(body) });
          const fresh = await apiFetch("/dotacion/catalogo");
          dtState.catalogo = Array.isArray(fresh.data) ? fresh.data : dtState.catalogo;
          showSuccess("Artículo creado");
        }
        closeModal();
        reloadTab();
      } catch (err) { showError(err.message || "Error al guardar"); }
    });
  }

  if (type === "stock") {
    document.getElementById("formStock")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        if (id) {
          const delta = Number(document.getElementById("stockCantidad")?.value);
          if (!Number.isFinite(delta)) { showWarning("Ingresa una cantidad válida"); return; }
          const res = await apiFetch(`/dotacion/stock/${id}/ajustar`, { method: "PATCH", body: JSON.stringify({ delta }) });
          const idx = dtState.stock.findIndex(s => s.id === id);
          if (idx >= 0) dtState.stock[idx] = { ...dtState.stock[idx], ...res.data };
          showSuccess("Stock ajustado");
        } else {
          const body = {
            catalogo_id:         Number(document.getElementById("stockCatId")?.value),
            talla:               document.getElementById("stockTalla")?.value || null,
            cantidad_disponible: Number(document.getElementById("stockCantidad")?.value),
          };
          if (!body.catalogo_id) { showWarning("Selecciona un artículo"); return; }
          await apiFetch("/dotacion/stock", { method: "POST", body: JSON.stringify(body) });
          const fresh = await apiFetch("/dotacion/stock");
          dtState.stock = Array.isArray(fresh.data) ? fresh.data : dtState.stock;
          showSuccess("Stock guardado");
        }
        closeModal();
        reloadTab();
      } catch (err) { showError(err.message || "Error al guardar stock"); }
    });
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Modal remisión ────────────────────────────────────────────────────────────

function modalFormRemision(rem = null) {
  const isEdit  = Boolean(rem);
  const today   = new Date().toISOString().slice(0, 10);
  const year    = new Date().getFullYear();
  const autoNum = rem?.numero || `REM-${year}-${String(dtState.remisiones.length + 1).padStart(3, "0")}`;

  return `
    <div class="dot-modal dot-modal--rem">
      <div class="dot-modal-head">
        <h3>${isEdit ? "Editar" : "Nueva"} Remisión
          <span class="dot-rem-num-badge">${escapeHtml(autoNum)}</span>
        </h3>
        <button type="button" class="dot-modal-close" id="btnCerrarModal">✕</button>
      </div>
      <form id="formRem" class="dot-rem-form">
        <input type="hidden" id="remNumero" value="${escapeAttr(autoNum)}">

        <!-- Fila 1: fecha + responsable + obs -->
        <div class="dot-rem-top-row">
          <div class="dot-form-row">
            <label>Fecha envío</label>
            <input type="date" id="remFecha" value="${rem?.fecha_envio?.slice(0,10) || today}" required>
          </div>
          <div class="dot-form-row" style="flex:1.2">
            <label>Responsable</label>
            <input type="text" id="remResponsable" value="${escapeAttr(rem?.responsable || "")}" placeholder="Nombre">
          </div>
          <div class="dot-form-row" style="flex:2">
            <label>Observaciones</label>
            <input type="text" id="remObs" value="${escapeAttr(rem?.observaciones || "")}" placeholder="Opcional">
          </div>
        </div>

        <!-- Fila 2: filtros + botón cargar -->
        <div class="dot-rem-filters-row">
          <div class="dot-form-row">
            <label>Municipio</label>
            <select id="remMunicipio"><option value="">Cargando...</option></select>
          </div>
          <div class="dot-form-row">
            <label>Institución</label>
            <select id="remInstitucion" disabled><option value="">—</option></select>
          </div>
          <div class="dot-form-row">
            <label>Sede</label>
            <select id="remSede" disabled><option value="">—</option></select>
          </div>
          <div class="dot-form-row">
            <label>Modalidad</label>
            <select id="remModalidad" disabled><option value="">—</option></select>
          </div>
          <button type="button" class="btn btn-secondary btn-sm dot-rem-cargar-btn" id="btnCargarEmpleadas">Cargar</button>
        </div>

        <!-- Tabla empleadas (scroll interno) -->
        <div class="dot-rem-table-section">
          <div id="remTablaEmpty" class="dot-rem-table-empty">
            Selecciona una institución y haz clic en <strong>Cargar</strong>
          </div>
          <div id="remTablaWrap" style="display:none; height:100%; display:none; flex-direction:column;">
            <div class="dot-rem-table-bar">
              <span id="remTablaConteo"></span>
              <label class="dot-rem-chk-all-lbl">
                <input type="checkbox" id="chkSelTodos" checked> Todas
              </label>
            </div>
            <div class="dot-rem-scroll">
              <table class="dot-table dot-table--sm">
                <thead id="remThead"></thead>
                <tbody id="remTbody"></tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="dot-modal-foot">
          <button type="button" class="btn btn-secondary" id="btnCancelarRem">Cancelar</button>
          <button type="submit" class="btn btn-primary">${isEdit ? "Guardar cambios" : "Crear remisión"}</button>
        </div>
      </form>
    </div>
  `;
}

function wireModalRemision(rem = null) {
  document.getElementById("btnCerrarModal")?.addEventListener("click", closeModal);
  document.getElementById("btnCancelarRem")?.addEventListener("click", closeModal);

  // Cargar municipios al abrir
  (async () => {
    try {
      const res = await apiFetch("/dotacion/remisiones/municipios");
      const muns = Array.isArray(res.data) ? res.data : [];
      const sel = document.getElementById("remMunicipio");
      if (!sel) return;
      sel.innerHTML = `<option value="">— Todos los municipios —</option>` +
        muns.map(m => `<option value="${m.id}" data-name="${escapeAttr(m.name)}" ${rem?.municipio_nombre===m.name?"selected":""}>${escapeHtml(m.name)}</option>`).join("");

      // Si es edición, re-cargar instituciones y modalidades
      if (rem?.municipio_nombre) {
        const found = muns.find(m => m.name === rem.municipio_nombre);
        if (found) triggerMunicipioChange(found.id, rem);
      }
    } catch { /* silent */ }
  })();

  // Cambio de municipio → carga instituciones + modalidades
  document.getElementById("remMunicipio")?.addEventListener("change", async (e) => {
    const id = Number(e.target.value);
    await triggerMunicipioChange(id);
  });

  // (el onchange de institución → sedes se asigna dentro de triggerMunicipioChange)

  // Cargar empleadas
  document.getElementById("btnCargarEmpleadas")?.addEventListener("click", async () => {
    const municipioSel   = document.getElementById("remMunicipio");
    const institucionSel = document.getElementById("remInstitucion");
    const sedeSel        = document.getElementById("remSede");

    const params = new URLSearchParams();
    if (municipioSel?.value)   params.set("municipioId",   municipioSel.value);
    if (institucionSel?.value) params.set("institucionId", institucionSel.value);
    if (sedeSel?.value)        params.set("sedeId",        sedeSel.value);

    try {
      const res = await apiFetch(`/dotacion/remisiones/empleadas?${params}`);
      const empleadas = Array.isArray(res.data) ? res.data : [];
      if (!empleadas.length) { showWarning("No se encontraron empleadas con esos filtros"); return; }
      renderTablaEmpleadas(empleadas);
    } catch (err) { showError(err.message || "Error al cargar empleadas"); }
  });

  // Seleccionar/deseleccionar todas
  document.getElementById("chkSelTodos")?.addEventListener("change", (e) => {
    document.querySelectorAll(".rem-chk-emp").forEach(chk => { chk.checked = e.target.checked; });
  });

  // Submit
  document.getElementById("formRem")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const municipioSel   = document.getElementById("remMunicipio");
    const institucionSel = document.getElementById("remInstitucion");
    const sedeSel        = document.getElementById("remSede");

    const selectedRows = Array.from(document.querySelectorAll("#remTbody .rem-chk-emp:checked"))
      .map(chk => chk.closest("tr")).filter(Boolean);

    if (!selectedRows.length) { showWarning("Selecciona al menos una empleada"); return; }

    // Validar que empleadas seleccionadas tengan datos institucionales completos
    const sinInstitucion = selectedRows.filter(row => !row.dataset.institutionId);
    if (sinInstitucion.length > 0) {
      const nombres = sinInstitucion.map(r => r.dataset.nombre).slice(0, 3).join(", ");
      showWarning(
        `Este empleado no tiene información institucional completa. Complete la pestaña Institucionalidad antes de generar la remisión. (${nombres})`
      );
      return;
    }

    const items = selectedRows.map(row => {
      const tipRow = row.querySelector(".rem-tipo-row")?.value || "AMBOS";
      const noPant = row.dataset.noPant === "1";
      return {
        employee_nombre:    row.dataset.nombre,
        employee_documento: row.dataset.doc,
        item_nombre:        tipRow === "CALZADO" ? "Calzado" : tipRow === "UNIFORME" ? "Uniforme" : "Dotación",
        talla_camisa:       tipRow !== "CALZADO"  ? (row.querySelector(".rem-camisa")?.value  || null) : null,
        talla_pantalon:     (tipRow !== "CALZADO" && !noPant) ? (row.querySelector(".rem-pantalon")?.value || null) : null,
        talla_zapato:       tipRow !== "UNIFORME" ? (row.querySelector(".rem-zapato")?.value  || null) : null,
        cantidad:           1,
        tipo_dotacion:      tipRow,
      };
    });

    const munOpt  = municipioSel?.options[municipioSel.selectedIndex];
    const instOpt = institucionSel?.options[institucionSel.selectedIndex];
    const sedeOpt = sedeSel?.options[sedeSel.selectedIndex];
    const modVal  = document.getElementById("remModalidad")?.value || null;

    const body = {
      numero:             document.getElementById("remNumero")?.value,
      fecha_envio:        document.getElementById("remFecha")?.value,
      responsable:        document.getElementById("remResponsable")?.value.trim() || null,
      observaciones:      document.getElementById("remObs")?.value.trim() || null,
      estado:             "BORRADOR",
      tipo_dotacion:      "AMBOS",
      municipio_nombre:   munOpt?.dataset?.name  || munOpt?.text  || null,
      institucion_nombre: instOpt?.dataset?.name || instOpt?.text || null,
      sede_nombre:        sedeOpt?.dataset?.name || sedeOpt?.text || null,
      modalidad:          modVal,
      items,
    };

    try {
      if (rem?.id) {
        await apiFetch(`/dotacion/remisiones/${rem.id}`, { method: "PUT", body: JSON.stringify(body) });
        showSuccess("Remisión actualizada");
      } else {
        await apiFetch("/dotacion/remisiones", { method: "POST", body: JSON.stringify(body) });
        showSuccess("Remisión creada");
      }
      const fresh = await apiFetch("/dotacion/remisiones");
      dtState.remisiones = Array.isArray(fresh.data) ? fresh.data : dtState.remisiones;
      closeModal();
      reloadTab();
    } catch (err) { showError(err.message || "Error al guardar la remisión"); }
  });
}

async function triggerMunicipioChange(municipioId, remEdit = null) {
  const instSel = document.getElementById("remInstitucion");
  const modSel  = document.getElementById("remModalidad");
  if (!instSel || !modSel) return;

  if (!municipioId) {
    instSel.innerHTML = `<option value="">— Selecciona municipio primero —</option>`; instSel.disabled = true;
    modSel.innerHTML  = `<option value="">— Selecciona municipio primero —</option>`;  modSel.disabled  = true;
    return;
  }

  instSel.innerHTML = `<option value="">Cargando...</option>`; instSel.disabled = true;
  modSel.innerHTML  = `<option value="">Cargando...</option>`;  modSel.disabled  = true;

  let instRes, modRes;
  try {
    instRes = await apiFetch(`/dotacion/remisiones/instituciones?municipioId=${municipioId}`);
  } catch (err) {
    instSel.innerHTML = `<option value="">— Error al cargar —</option>`;
    showError("Error cargando instituciones: " + (err.message || "error desconocido"));
    return;
  }
  try {
    modRes = await apiFetch(`/dotacion/remisiones/modalidades?municipioId=${municipioId}`);
  } catch (err) {
    modRes = { data: [] };
  }

  const insts = Array.isArray(instRes.data) ? instRes.data : [];
  const mods  = Array.isArray(modRes.data)  ? modRes.data  : [];

  instSel.innerHTML = `<option value="">— Todas las instituciones —</option>` +
    insts.map(i => `<option value="${i.id}" data-name="${escapeAttr(i.name)}" ${remEdit?.institucion_nombre===i.name?"selected":""}>${escapeHtml(i.name)}</option>`).join("");
  instSel.disabled = false;

  const MODALIDADES_REM = ["CAA", "CAARES", "RI"];
  modSel.innerHTML = `<option value="">— Todas las modalidades —</option>` +
    MODALIDADES_REM.map(m => `<option value="${m}" ${remEdit?.modalidad===m?"selected":""}>${escapeHtml(m)}</option>`).join("");
  modSel.disabled = false;

  // Asignar onchange aquí, cada vez que se cargan instituciones, para garantizar que funcione
  instSel.onchange = async () => {
    const id = Number(instSel.value);
    const sedeSel = document.getElementById("remSede");
    if (!sedeSel) return;
    if (!id) {
      sedeSel.innerHTML = `<option value="">— Todas las sedes —</option>`;
      sedeSel.disabled = false;
      return;
    }
    sedeSel.innerHTML = `<option value="">Cargando sedes...</option>`;
    sedeSel.disabled = true;
    try {
      const res = await apiFetch(`/dotacion/remisiones/sedes?institucionId=${id}`);
      const sedes = Array.isArray(res.data) ? res.data : [];
      sedeSel.innerHTML = `<option value="">— Todas las sedes —</option>` +
        sedes.map(s => `<option value="${s.id}" data-name="${escapeAttr(s.name)}">${escapeHtml(s.name)}</option>`).join("");
      sedeSel.disabled = false;
      if (!sedes.length) showWarning("No se encontraron sedes para esta institución");
    } catch (err) {
      sedeSel.innerHTML = `<option value="">— Todas las sedes —</option>`;
      sedeSel.disabled = false;
      showError("Error cargando sedes: " + (err.message || "error desconocido"));
    }
  };

  // Si es edición con institución preseleccionada, cargar sus sedes automáticamente
  if (remEdit?.institucion_nombre) {
    const found = insts.find(i => i.name === remEdit.institucion_nombre);
    if (found) instSel.onchange();
  }
}

function renderTablaEmpleadas(empleadas) {
  const thead = document.getElementById("remThead");
  const tbody = document.getElementById("remTbody");
  const wrap  = document.getElementById("remTablaWrap");
  const empty = document.getElementById("remTablaEmpty");
  if (!thead || !tbody || !wrap) return;

  const sinPantalon = (cargo) => (cargo || "").toLowerCase().includes("manipulador");
  const allNoPant   = empleadas.every(e => sinPantalon(e.cargo));
  const showPant    = !allNoPant;

  thead.innerHTML = `<tr>
    <th style="width:28px"></th>
    <th>Empleada</th>
    <th style="width:95px">Envío</th>
    <th style="width:62px">Camisa</th>
    ${showPant ? `<th style="width:62px">Pantalón</th>` : ""}
    <th style="width:62px">Zapato</th>
  </tr>`;

  tbody.innerHTML = empleadas.map(e => {
    const noPant = sinPantalon(e.cargo);

    // Datos institucionales por empleado (para visualización en la fila)
    const munNombre  = e.municipio_nombre   || "Sin municipio";
    const instNombre = e.institucion_nombre || "Sin institución";
    const sedeInfo   = e.sede_nombre        ? ` · ${e.sede_nombre}` : "";
    const modInfo    = e.modality           ? ` · ${e.modality}`    : "";
    const infoInst   = `${munNombre} · ${instNombre}${sedeInfo}${modInfo}`;

    // Alerta visual si faltan datos institucionales clave
    const sinInst = !e.institution_id;
    const instColor = sinInst ? "color:#f59e0b;" : "color:#64748b;";

    const pantCell = showPant
      ? (noPant
        ? `<td style="text-align:center;color:#94a3b8;vertical-align:middle">—</td>`
        : `<td><input type="text" class="rem-inp rem-pantalon" value="${escapeAttr(e.pants_size || "")}" placeholder="Sin registrar"></td>`)
      : "";
    return `
    <tr data-nombre="${escapeAttr(e.full_name)}" data-doc="${escapeAttr(e.document_number || "")}"
        data-no-pant="${noPant ? "1" : ""}"
        data-municipality-id="${e.municipality_id || ""}"
        data-institution-id="${e.institution_id || ""}"
        data-site-id="${e.site_id || ""}">
      <td><input type="checkbox" class="rem-chk-emp" checked></td>
      <td style="font-size:12px;line-height:1.3">
        ${escapeHtml(e.full_name)}<br>
        <span style="color:#94a3b8;font-size:11px">${escapeHtml(e.document_number || "")}</span><br>
        <span style="font-size:10px;${instColor}">${escapeHtml(infoInst)}</span>
      </td>
      <td>
        <select class="rem-tipo-row">
          <option value="AMBOS">U + C</option>
          <option value="UNIFORME">Uniforme</option>
          <option value="CALZADO">Calzado</option>
        </select>
      </td>
      <td><input type="text" class="rem-inp rem-camisa" value="${escapeAttr(e.shirt_size || "")}" placeholder="Sin registrar"></td>
      ${pantCell}
      <td><input type="text" class="rem-inp rem-zapato" value="${escapeAttr(e.shoe_size || "")}" placeholder="Sin registrar"></td>
    </tr>`;
  }).join("");

  // Tipo por fila: habilita/deshabilita tallas según selección
  tbody.querySelectorAll(".rem-tipo-row").forEach(sel => {
    sel.addEventListener("change", () => {
      const row    = sel.closest("tr");
      const camisa = row.querySelector(".rem-camisa");
      const pant   = row.querySelector(".rem-pantalon"); // null si cargo no requiere
      const zap    = row.querySelector(".rem-zapato");
      const v = sel.value;
      if (camisa) { camisa.disabled = v === "CALZADO";  if (v === "CALZADO")  camisa.value = ""; }
      if (pant)   { pant.disabled   = v === "CALZADO";  if (v === "CALZADO")  pant.value   = ""; }
      if (zap)    { zap.disabled    = v === "UNIFORME"; if (v === "UNIFORME") zap.value    = ""; }
    });
  });

  document.getElementById("remTablaConteo").textContent =
    `${empleadas.length} empleada${empleadas.length !== 1 ? "s" : ""}`;

  document.getElementById("chkSelTodos").onchange = (e) => {
    tbody.querySelectorAll(".rem-chk-emp").forEach(chk => { chk.checked = e.target.checked; });
  };

  wrap.style.cssText  = "display:flex; flex-direction:column; height:100%;";
  if (empty) empty.style.display = "none";
}

// ── Modal subir foto ──────────────────────────────────────────────────────────

function modalSubirFoto(id) {
  return `
    <div class="dot-modal">
      <div class="dot-modal-head">
        <h3>Subir foto de remisión firmada</h3>
        <button type="button" class="dot-modal-close" id="btnCerrarModal">✕</button>
      </div>
      <form id="formFoto" class="dot-form">
        <div class="dot-form-row">
          <label>Foto o escaneo del documento firmado</label>
          <input type="file" id="fotoFile" accept="image/*,.pdf" required>
          <p class="txt-muted txt-sm">Formatos admitidos: imágenes (JPG, PNG) y PDF.</p>
        </div>
        <div class="dot-modal-foot">
          <button type="button" class="btn btn-secondary" id="btnCerrarModal2">Cancelar</button>
          <button type="submit" class="btn btn-primary">Subir foto</button>
        </div>
      </form>
    </div>
  `;
}

function wireModalFoto(id) {
  document.getElementById("btnCerrarModal")?.addEventListener("click", closeModal);
  document.getElementById("btnCerrarModal2")?.addEventListener("click", closeModal);

  document.getElementById("formFoto")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = document.getElementById("fotoFile")?.files?.[0];
    if (!file) { showWarning("Selecciona un archivo"); return; }
    try {
      const base64 = await fileToBase64(file);
      await apiFetch(`/dotacion/remisiones/${id}/foto`, {
        method: "PATCH",
        body: JSON.stringify({ foto_remision: base64 }),
      });
      const idx = dtState.remisiones.findIndex(r => r.id === id);
      if (idx >= 0) dtState.remisiones[idx].tiene_foto = true;
      showSuccess("Foto guardada exitosamente");
      closeModal();
      reloadTab();
    } catch (err) { showError(err.message || "Error al subir la foto"); }
  });
}

// ── Modal marcar enviado / recibido ───────────────────────────────────────────

function modalMarcarEnvio(r, tipo) {
  const titulo     = tipo === "enviado" ? "Marcar Envío" : "Marcar Recepción";
  const fechaActual = (tipo === "enviado" ? r.fecha_enviado : r.fecha_recibido)?.slice(0, 10)
                     || new Date().toISOString().slice(0, 10);
  const tieneComp  = tipo === "enviado" ? r.tiene_comp_env : r.tiene_comp_rec;
  return `
    <div class="dot-modal">
      <div class="dot-modal-head">
        <h3>${titulo} — <span style="font-weight:400">${escapeHtml(r.numero)}</span></h3>
        <button type="button" class="dot-modal-close" id="btnCerrarModal">✕</button>
      </div>
      <form id="formMarcar" class="dot-form">
        <div class="dot-form-row">
          <label>Fecha</label>
          <input type="date" id="marcarFecha" value="${fechaActual}" required>
        </div>
        <div class="dot-form-row">
          <label>Comprobante (imagen o PDF, opcional)</label>
          <input type="file" id="marcarFile" accept="image/*,.pdf">
          ${tieneComp ? '<p class="txt-muted txt-sm">Ya tiene comprobante adjunto. Sube uno nuevo para reemplazarlo.</p>' : ""}
        </div>
        <div class="dot-modal-foot">
          <button type="button" class="btn btn-secondary" id="btnCancelarMarcar">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    </div>
  `;
}

function wireModalMarcar(id, tipo) {
  document.getElementById("btnCerrarModal")?.addEventListener("click", closeModal);
  document.getElementById("btnCancelarMarcar")?.addEventListener("click", closeModal);

  document.getElementById("formMarcar")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fecha = document.getElementById("marcarFecha")?.value;
    if (!fecha) { showWarning("Ingresa una fecha"); return; }
    const file = document.getElementById("marcarFile")?.files?.[0];
    let comprobante = undefined;
    if (file) comprobante = await fileToBase64(file);

    try {
      const res = await apiFetch(`/dotacion/remisiones/${id}/${tipo}`, {
        method: "PATCH",
        body: JSON.stringify({ fecha, ...(comprobante !== undefined ? { comprobante } : {}) }),
      });
      const idx = dtState.remisiones.findIndex(r => r.id === id);
      if (idx >= 0 && res.data) {
        dtState.remisiones[idx].fecha_enviado    = res.data.fecha_enviado;
        dtState.remisiones[idx].fecha_recibido   = res.data.fecha_recibido;
        dtState.remisiones[idx].tiene_comp_env   = res.data.tiene_comp_env;
        dtState.remisiones[idx].tiene_comp_rec   = res.data.tiene_comp_rec;
      }
      showSuccess(tipo === "enviado" ? "Envío registrado" : "Recepción registrada");
      closeModal();
      reloadTab();
    } catch (err) { showError(err.message || "Error al guardar"); }
  });
}

// ── Imprimir remisión ─────────────────────────────────────────────────────────

function imprimirRemision(rem) {
  const fecha = formatDate(rem.fecha_envio);
  const tipo          = rem.tipo_dotacion || "AMBOS";
  const showCamisa    = tipo !== "CALZADO";
  const showPantalon  = tipo !== "CALZADO";
  const showZapato    = tipo !== "UNIFORME";

  const rows = (rem.items || []).map((it, i) => `
    <tr>
      <td style="text-align:center;">${i + 1}</td>
      <td>${escapeHtml(it.employee_nombre || "")}</td>
      <td style="text-align:center;">${escapeHtml(it.employee_documento || "")}</td>
      ${showCamisa   ? `<td style="text-align:center;">${escapeHtml(it.talla_camisa   || "—")}</td>` : ""}
      ${showPantalon ? `<td style="text-align:center;">${escapeHtml(it.talla_pantalon || "—")}</td>` : ""}
      ${showZapato   ? `<td style="text-align:center;">${escapeHtml(it.talla_zapato   || "—")}</td>` : ""}
      <td style="text-align:center;width:90px;">&nbsp;</td>
    </tr>
  `).join("");

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Remisión ${escapeHtml(rem.numero)}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 11pt; color: #1a1a1a; padding: 28px 32px; }
        .rem-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; border-bottom: 2px solid #1a1a2e; padding-bottom: 12px; }
        .rem-header h1 { font-size: 18pt; font-weight: 700; color: #1a1a2e; }
        .rem-header p { font-size: 10pt; color: #555; }
        .rem-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 20px; margin-bottom: 18px; padding: 12px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; }
        .rem-meta-item label { font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #64748b; display: block; }
        .rem-meta-item span  { font-size: 11pt; color: #1a1a2e; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th { background: #1a1a2e; color: #fff; font-size: 9pt; font-weight: 600; text-transform: uppercase; padding: 7px 8px; text-align: left; }
        td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; font-size: 10pt; vertical-align: middle; }
        tr:nth-child(even) td { background: #f8fafc; }
        .rem-footer { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; }
        .rem-firma { text-align: center; }
        .rem-firma-line { border-top: 1px solid #1a1a2e; padding-top: 6px; margin-top: 50px; }
        .rem-firma-label { font-size: 9pt; font-weight: 700; text-transform: uppercase; color: #555; }
        .rem-obs { margin-bottom: 18px; padding: 10px; border: 1px solid #e2e8f0; border-radius: 4px; background: #fffbf0; }
        .rem-obs label { font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #64748b; display: block; margin-bottom: 4px; }
        .rem-num-badge { display: inline-block; padding: 4px 14px; background: #1a1a2e; color: #fff; border-radius: 20px; font-size: 13pt; font-weight: 700; }
        @media print {
          body { padding: 12px 16px; }
          @page { margin: 1.5cm; }
        }
      </style>
    </head>
    <body>
      <div class="rem-header">
        <div>
          <h1>Remisión de Dotación</h1>
          <p>Documento de entrega y despacho</p>
        </div>
        <div style="text-align:right;">
          <div class="rem-num-badge">${escapeHtml(rem.numero)}</div>
          <p style="margin-top:6px;font-size:10pt;color:#555;">Fecha: <strong>${fecha}</strong></p>
        </div>
      </div>

      <div class="rem-meta">
        <div class="rem-meta-item">
          <label>Municipio</label>
          <span>${escapeHtml(rem.municipio_nombre || "—")}</span>
        </div>
        <div class="rem-meta-item">
          <label>Institución</label>
          <span>${escapeHtml(rem.institucion_nombre || "—")}</span>
        </div>
        <div class="rem-meta-item">
          <label>Sede</label>
          <span>${escapeHtml(rem.sede_nombre || "—")}</span>
        </div>
        <div class="rem-meta-item">
          <label>Modalidad</label>
          <span>${escapeHtml(rem.modalidad || "—")}</span>
        </div>
        <div class="rem-meta-item">
          <label>Tipo de dotación</label>
          <span>${escapeHtml(rem.tipo_dotacion === "UNIFORME" ? "Solo Uniforme" : rem.tipo_dotacion === "CALZADO" ? "Solo Calzado" : "Uniforme y Calzado")}</span>
        </div>
        <div class="rem-meta-item">
          <label>Responsable</label>
          <span>${escapeHtml(rem.responsable || "—")}</span>
        </div>
        <div class="rem-meta-item">
          <label>Total empleadas</label>
          <span>${(rem.items || []).length}</span>
        </div>
      </div>

      ${rem.observaciones ? `<div class="rem-obs"><label>Observaciones</label>${escapeHtml(rem.observaciones)}</div>` : ""}

      <table>
        <thead>
          <tr>
            <th style="width:35px;">#</th>
            <th>Empleada</th>
            <th style="width:90px;">Documento</th>
            ${showCamisa   ? `<th style="width:70px;">Camisa</th>`   : ""}
            ${showPantalon ? `<th style="width:70px;">Pantalón</th>` : ""}
            ${showZapato   ? `<th style="width:70px;">Zapato</th>`   : ""}
            <th style="width:100px;">Firma</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="rem-footer">
        <div class="rem-firma">
          <div class="rem-firma-line">
            <p class="rem-firma-label">Firma — Responsable de envío</p>
            <p style="font-size:9pt;color:#555;margin-top:4px;">${escapeHtml(rem.responsable || "")}</p>
          </div>
        </div>
        <div class="rem-firma">
          <div class="rem-firma-line">
            <p class="rem-firma-label">Firma — Receptor / Coordinador sede</p>
            <p style="font-size:9pt;color:#555;margin-top:4px;">Nombre: ___________________________</p>
          </div>
        </div>
      </div>

      <script>window.addEventListener('load', () => setTimeout(() => window.print(), 400));<\/script>
    </body>
    </html>
  `;

  const win = window.open("", "_blank", "width=960,height=720");
  if (!win) { showWarning("El navegador bloqueó la ventana emergente. Permite ventanas emergentes e intenta de nuevo."); return; }
  win.document.write(html);
  win.document.close();
}
