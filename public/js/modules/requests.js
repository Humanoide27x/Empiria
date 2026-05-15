import { apiFetch } from '../api.js';
import { escapeHtml, escapeAttr } from '../utils.js';
import { showSuccess, showError } from '../toast.js';

const REQUEST_TYPE_LABELS = {
  CERTIFICADO_LABORAL:     "Certificado Laboral",
  CARTA_PRESENTACION:      "Carta de Presentación",
  DESPRENDIBLE_PAGO:       "Desprendible de Pago",
  PAZ_Y_SALVO:             "Paz y Salvo",
  PERMISO:                 "Permiso",
  VACACIONES:              "Vacaciones",
  CAMBIO_DATOS_PERSONALES: "Cambio de Datos Personales",
  SOLICITUD_DOCUMENTOS:    "Solicitud de Documentos",
  QUEJA_RECLAMO:           "Queja o Reclamo",
  OTRO:                    "Otro",
};

const STATUS_LABELS = {
  PENDIENTE:  "Pendiente",
  EN_PROCESO: "En proceso",
  RESUELTA:   "Resuelta",
  RECHAZADA:  "Rechazada",
  CANCELADA:  "Cancelada",
};

const STATUS_COLORS = {
  PENDIENTE:  "badge-warning",
  EN_PROCESO: "badge-info",
  RESUELTA:   "badge-success",
  RECHAZADA:  "badge-danger",
  CANCELADA:  "badge-neutral",
};

function getFullName(e) {
  return e.fullName || e.full_name || e.nombre || [e.firstName, e.secondName, e.firstLastName, e.secondLastName].filter(Boolean).join(" ") || "";
}

export async function loadSolicitudFormModule(defaultType, titulo, descripcion) {
  let personnelRows = [];
  try {
    const pp = await apiFetch("/personnel");
    personnelRows = Array.isArray(pp.data) ? pp.data : Array.isArray(pp.personnel) ? pp.personnel : [];
  } catch { personnelRows = []; }

  const activeEmployees = personnelRows.filter(e => {
    const s = String(e.status || e.estado || "").toUpperCase();
    return s === "ACTIVO" || s === "ACTIVE";
  });

  const empOptions = activeEmployees.map(e =>
    `<option value="${escapeAttr(String(e.id))}">${escapeHtml(getFullName(e))} — ${escapeHtml(e.documentNumber || e.document_number || e.numero_documento || "")}</option>`
  ).join("");

  const typeOptions = Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) =>
    `<option value="${k}" ${k === defaultType ? "selected" : ""}>${escapeHtml(v)}</option>`
  ).join("");

  return `
    <div class="payroll-module-wrap">
      <section class="personnel-premium-hero">
        <div>
          <span class="personnel-premium-eyebrow">Solicitudes de Empleados</span>
          <h2>${escapeHtml(titulo)}</h2>
          <p>${escapeHtml(descripcion)}</p>
        </div>
      </section>
      <div class="payroll-form-card">
        <form id="solicitudForm" class="form-grid two-cols">
          <label class="full" for="solicEmpSelect">Empleado
            <select id="solicEmpSelect" required>
              <option value="">— Selecciona un empleado —</option>
              ${empOptions}
            </select>
          </label>
          <label for="solicType">Tipo de solicitud
            <select id="solicType" required>${typeOptions}</select>
          </label>
          <label for="solicPriority">Prioridad
            <select id="solicPriority">
              <option value="NORMAL">Normal</option>
              <option value="ALTA">Alta</option>
              <option value="BAJA">Baja</option>
            </select>
          </label>
          <label class="full" for="solicDesc">Descripción / Motivo
            <textarea id="solicDesc" rows="4" placeholder="Describe el motivo o detalle de la solicitud..." required></textarea>
          </label>
          <div class="full" style="display:flex;gap:1rem;align-items:center">
            <button type="submit" class="btn btn-primary" id="solicSubmitBtn">Enviar solicitud</button>
            <span id="solicMsg" class="message"></span>
          </div>
        </form>
      </div>
    </div>`;
}

export function wireSolicitudFormEvents() {
  const form = document.getElementById("solicitudForm");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("solicSubmitBtn");
    const employeeId  = document.getElementById("solicEmpSelect").value;
    const requestType = document.getElementById("solicType").value;
    const priority    = document.getElementById("solicPriority").value;
    const description = document.getElementById("solicDesc").value.trim();
    if (!employeeId)  { showError("Selecciona un empleado"); return; }
    if (!description) { showError("Escribe el motivo de la solicitud"); return; }
    btn.disabled = true;
    try {
      await apiFetch("/employee-requests", {
        method: "POST",
        body: JSON.stringify({ employeeId, requestType, priority, description }),
      });
      showSuccess("Solicitud enviada correctamente");
      form.reset();
    } catch (err) {
      showError(err.message || "No se pudo enviar la solicitud");
    } finally {
      btn.disabled = false;
    }
  });
}

export async function loadEstadoSolicitudesModule() {
  let requests = [];
  try {
    const payload = await apiFetch("/employee-requests");
    requests = Array.isArray(payload.data) ? payload.data : [];
  } catch { requests = []; }

  const statusOptions = Object.entries(STATUS_LABELS).map(([k, v]) =>
    `<option value="${k}">${escapeHtml(v)}</option>`
  ).join("");

  const rows = requests.map(r => `
    <tr>
      <td>${escapeHtml(r.employeeName || "—")}</td>
      <td>${escapeHtml(r.documentNumber || "—")}</td>
      <td>${escapeHtml(REQUEST_TYPE_LABELS[r.requestType] || r.requestType || "—")}</td>
      <td>${escapeHtml(r.description || "—")}</td>
      <td><span class="novedad-badge ${STATUS_COLORS[r.status] || ''}">${escapeHtml(STATUS_LABELS[r.status] || r.status || "—")}</span></td>
      <td>${r.createdAt ? new Date(r.createdAt).toLocaleDateString("es-CO") : "—"}</td>
      <td>
        <button type="button" class="btn btn-secondary btn-row btn-view-solicitud"
          data-id="${r.id}"
          data-status="${escapeAttr(r.status)}"
          data-response="${escapeAttr(r.responseText || '')}"
          data-emp="${escapeAttr(r.employeeName || '')}"
          data-type="${escapeAttr(r.requestType || '')}"
          data-desc="${escapeAttr(r.description || '')}">Ver</button>
        ${["PENDIENTE","EN_PROCESO"].includes(r.status) ? `
        <select class="btn btn-secondary btn-row solicitud-status-select" data-solicitud-id="${r.id}" style="max-width:130px">
          <option value="">Cambiar estado</option>
          ${statusOptions}
        </select>` : ""}
      </td>
    </tr>`).join("");

  return `
    <div class="payroll-module-wrap">
      <section class="personnel-premium-hero">
        <div>
          <span class="personnel-premium-eyebrow">Solicitudes de Empleados</span>
          <h2>Estado de Solicitudes</h2>
          <p>Consulta y gestiona todas las solicitudes registradas en el sistema.</p>
        </div>
        <div class="topbar-actions" style="gap:.5rem">
          <input type="text" id="solicSearch" class="search" placeholder="Buscar empleado..." style="max-width:200px"/>
          <select id="solicStatusFilter" class="btn btn-secondary">
            <option value="">Todos los estados</option>
            ${statusOptions}
          </select>
          <button type="button" class="btn btn-secondary" id="solicRefreshBtn">Actualizar</button>
        </div>
      </section>
      ${requests.length === 0
        ? `<article class="info-card"><p>No hay solicitudes registradas aún.</p></article>`
        : `<div class="table-wrap">
            <table class="data-table" id="solicitudesTable">
              <thead>
                <tr>
                  <th>Empleado</th><th>Documento</th><th>Tipo</th>
                  <th>Descripción</th><th>Estado</th><th>Fecha</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody id="solicitudesBody">${rows}</tbody>
            </table>
          </div>`}
      <div id="solicitudDetailModal" class="modal-overlay hidden">
        <div class="modal-card" style="max-width:520px">
          <div class="modal-header">
            <h3 id="solicModalTitle">Detalle de solicitud</h3>
            <button type="button" class="modal-close" id="closeSolicModal">&#x2715;</button>
          </div>
          <div class="modal-body" id="solicModalBody"></div>
          <div class="modal-footer">
            <div id="solicResponseArea" class="hidden" style="width:100%">
              <label for="solicResponseText" style="font-weight:600;display:block;margin-bottom:.4rem">Respuesta / Nota</label>
              <textarea id="solicResponseText" rows="3" class="full" style="width:100%;margin-bottom:.5rem" placeholder="Escribe la respuesta o nota..."></textarea>
              <button type="button" class="btn btn-primary" id="solicSaveResponseBtn">Guardar respuesta</button>
            </div>
            <button type="button" class="btn btn-secondary" id="closeSolicModal2">Cerrar</button>
          </div>
        </div>
      </div>
    </div>`;
}

export function wireEstadoSolicitudesEvents() {
  const searchEl     = document.getElementById("solicSearch");
  const statusFilter = document.getElementById("solicStatusFilter");
  const tbody        = document.getElementById("solicitudesBody");
  const modal        = document.getElementById("solicitudDetailModal");
  const modalBody    = document.getElementById("solicModalBody");
  const modalTitle   = document.getElementById("solicModalTitle");
  const responseArea = document.getElementById("solicResponseArea");
  let currentSolicitudId = null;

  function filterRows() {
    if (!tbody) return;
    const q  = (searchEl?.value || "").toLowerCase();
    const st = (statusFilter?.value || "").toUpperCase();
    Array.from(tbody.querySelectorAll("tr")).forEach(tr => {
      const text       = tr.textContent.toLowerCase();
      const rowStatus  = tr.querySelector("[data-status]")?.dataset.status || "";
      const matchText  = !q  || text.includes(q);
      const matchState = !st || rowStatus === st;
      tr.style.display = matchText && matchState ? "" : "none";
    });
  }

  searchEl?.addEventListener("input", filterRows);
  statusFilter?.addEventListener("change", filterRows);

  document.getElementById("solicRefreshBtn")?.addEventListener("click", async () => {
    const html = await loadEstadoSolicitudesModule();
    const ws = document.getElementById("workspace");
    if (ws) { const sec = ws.querySelector(".submodule-content"); if (sec) sec.innerHTML = html; }
    wireEstadoSolicitudesEvents();
  });

  function openModal(btn) {
    currentSolicitudId = btn.dataset.id;
    const status   = btn.dataset.status;
    const emp      = btn.dataset.emp;
    const type     = btn.dataset.type;
    const desc     = btn.dataset.desc;
    const response = btn.dataset.response;
    if (modalTitle) modalTitle.textContent = `Solicitud #${currentSolicitudId}`;
    if (modalBody) {
      modalBody.innerHTML = `
        <div style="display:grid;gap:.5rem">
          <p><strong>Empleado:</strong> ${escapeHtml(emp)}</p>
          <p><strong>Tipo:</strong> ${escapeHtml(REQUEST_TYPE_LABELS[type] || type)}</p>
          <p><strong>Estado:</strong> ${escapeHtml(STATUS_LABELS[status] || status)}</p>
          <p><strong>Descripción:</strong> ${escapeHtml(desc)}</p>
          ${response ? `<p><strong>Respuesta:</strong> ${escapeHtml(response)}</p>` : ""}
        </div>`;
    }
    if (responseArea) {
      const editable = ["PENDIENTE", "EN_PROCESO"].includes(status);
      responseArea.classList.toggle("hidden", !editable);
      const textArea = document.getElementById("solicResponseText");
      if (textArea) textArea.value = response || "";
    }
    modal?.classList.remove("hidden");
  }

  document.querySelectorAll(".btn-view-solicitud").forEach(btn => {
    btn.addEventListener("click", () => openModal(btn));
  });

  document.getElementById("closeSolicModal")?.addEventListener("click",  () => modal?.classList.add("hidden"));
  document.getElementById("closeSolicModal2")?.addEventListener("click", () => modal?.classList.add("hidden"));
  modal?.addEventListener("click", e => { if (e.target === modal) modal.classList.add("hidden"); });

  document.getElementById("solicSaveResponseBtn")?.addEventListener("click", async () => {
    if (!currentSolicitudId) return;
    const responseText = document.getElementById("solicResponseText")?.value?.trim() || "";
    try {
      await apiFetch(`/employee-requests/${currentSolicitudId}`, {
        method: "PATCH",
        body: JSON.stringify({ responseText }),
      });
      showSuccess("Respuesta guardada");
      modal?.classList.add("hidden");
      const html = await loadEstadoSolicitudesModule();
      const ws = document.getElementById("workspace");
      if (ws) { const sec = ws.querySelector(".submodule-content"); if (sec) sec.innerHTML = html; }
      wireEstadoSolicitudesEvents();
    } catch (err) {
      showError(err.message || "No se pudo guardar la respuesta");
    }
  });

  document.querySelectorAll(".solicitud-status-select").forEach(select => {
    select.addEventListener("change", async () => {
      const id     = select.dataset.solicitudId;
      const status = select.value;
      if (!status) return;
      try {
        await apiFetch(`/employee-requests/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
        showSuccess("Estado actualizado");
        const html = await loadEstadoSolicitudesModule();
        const ws = document.getElementById("workspace");
        if (ws) { const sec = ws.querySelector(".submodule-content"); if (sec) sec.innerHTML = html; }
        wireEstadoSolicitudesEvents();
      } catch (err) {
        showError(err.message || "No se pudo actualizar el estado");
        select.value = "";
      }
    });
  });
}
