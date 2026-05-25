import { state }                 from '../state.js';
import { apiFetch }               from '../api.js';
import { escapeHtml, escapeAttr } from '../utils.js';
import { showError, showSuccess } from '../toast.js';

const _iv = (mod) => `${mod}?v=${window.APP_VERSION || "0"}`;

async function loadContractualPanel(contractId) {
  const { loadContractualAdminPanel } = await import(_iv("./contractual-config.js"));
  return loadContractualAdminPanel(contractId);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SYSTEM_MODULES = [
  { key: "gestion_personal",      label: "Gestión del Personal"  },
  { key: "nomina_novedades",      label: "Nómina y Novedades"    },
  { key: "cobertura_calculadora", label: "Cobertura PAE"         },
  { key: "calculadora_personal",  label: "Calculadora"           },
];

const SYSTEM_FEATURES = [
  { key: "equipo_minimo", label: "Tab Equipo Mínimo (Dashboard)" },
];


const DOC_CATALOG = [
  "HOJA DE VIDA",
  "FOTOCOPIA DEL DOCUMENTO DE IDENTIDAD",
  "DIPLOMA Y/O ACTA DE GRADO RESPECTIVO",
  "COPIA SIMPLE DE LA TARJETA PROFESIONAL Y CONSTANCIA DE VIGENCIA DE LA MATRICULA PROFESIONAL EXPEDIDA POR LA AUTORIDAD COMPETENTE",
  "CERTIFICACIONES DE EXPERIENCIA",
  "CONTRALORIA",
  "PROCURADURIA",
  "JUDICIALES",
  "MEDIDAS CORRECTIVAS",
  "REDAM",
  "AUTORIZACION DE CONSULTA REGISTRO DE INHABILIDADES POR DELITOS SEXUALES",
  "CONSULTA DE INHABILIDADES DE DELITOS SEXUALES",
  "CERTIFICACION DE ANTECEDENTES DISCIPLINARIOS EXPEDIDO POR LA ENTIDAD QUE LLEVA EL REGISTRO DE LA RESPECTIVA PROFESION",
  "CERTIFICADO DE CAPACITACION EN MANIPULACION DE ALIMENTOS Y EXAMEN MEDICO APTO PARA MANIPULACION DE ALIMENTOS",
  "CARTA DE INTENCION FIRMADA",
  "AUTORIZACION PARA EL TRATAMIENTO DE DATOS PERSONALES",
];

const PERM_ACTIONS = [
  { key: "view",   label: "Ver"      },
  { key: "create", label: "Crear"    },
  { key: "update", label: "Editar"   },
  { key: "delete", label: "Eliminar" },
];

// ── Modalities catalog (mirrors calculator.js) ───────────────────────────────
const SALARY_MODALITIES = [
  { key: "CAARES1", grp: "caares", label: "CAARES 1", jornada: "Tiempo completo",  defaultSalary: 1_750_905, desc: "1 manipuladora en residencia, jornada completa." },
  { key: "CAARES2", grp: "caares", label: "CAARES 2", jornada: "Medio tiempo",     defaultSalary:   875_453, desc: "1 manipuladora de medio tiempo — apoya a CAARES 1." },
  { key: "CAARES3", grp: "caares", label: "CAARES 3", jornada: "Tiempo completo",  defaultSalary: 1_750_905, desc: "Más de una manipuladora en residencia, jornada completa." },
  { key: "CAARES4", grp: "caares", label: "CAARES 4", jornada: "Medio tiempo",     defaultSalary:   875_453, desc: "1 manipuladora de medio tiempo — apoya a CAARES 3." },
  { key: "CAA1",    grp: "caa",    label: "CAA 1",    jornada: "Tiempo completo",  defaultSalary: 1_750_905, desc: "Externo jornada completa." },
  { key: "CAA2",    grp: "caa",    label: "CAA 2",    jornada: "Tiempo parcial",   defaultSalary:   875_453, desc: "Externo jornada parcial." },
  { key: "RI",      grp: "ri",     label: "RI",       jornada: "Según rango",      defaultSalary: 1_750_905, desc: "Ración industrializada." },
];

// ── Widget & field state (module personalizer) ────────────────────────────────
let _ccpWidgets     = [];   // current widget config array
let _ccpFields      = {};   // { slug: campos[] }
let _ccpActiveFieldSlug = "personal";
let _ccpDragSrc     = null; // drag source index
let _ccpModConfig   = {};   // { [modKey]: { salary, adicionales: [{label,value}] } }

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(active) {
  return active
    ? `<span class="cfg-badge cfg-badge-active">Activo</span>`
    : `<span class="cfg-badge cfg-badge-inactive">Inactivo</span>`;
}

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
}

function periodoCell(ct) {
  const sd = fmtDate(ct.start_date);
  const ed = fmtDate(ct.end_date);
  if (!sd && !ed) return `<span class="cfg-muted">—</span>`;
  return `<span class="cfg-ct-period-start">${sd || "?"}</span><span class="cfg-ct-period-sep"> → </span><span class="cfg-ct-period-end">${ed || "?"}</span>`;
}

function toInputDate(d) {
  if (!d) return "";
  return d.split("T")[0];
}

// ══════════════════════════════════════════════════════════════════════════════
// CLIENTS TABLE VIEW
// ══════════════════════════════════════════════════════════════════════════════

function _buildClientRows(c, colorIdx) {
  const ownContracts = Array.isArray(c.contracts_detail)    ? c.contracts_detail    : [];
  const subs         = Array.isArray(c.subcompanies_detail) ? c.subcompanies_detail : [];

  const groups = [];

  subs.forEach(s => {
    const contracts = Array.isArray(s.contracts) ? s.contracts : [];
    groups.push({
      type:     "sub",
      subId:    s.id,
      name:     s.name,
      nit:      s.nit || null,
      contracts,
      rowCount: Math.max(1, contracts.length),
    });
  });

  if (ownContracts.length > 0) {
    groups.push({
      type:     "direct",
      subId:    null,
      name:     "CONTRATOS DIRECTOS",
      nit:      null,
      contracts: ownContracts,
      rowCount:  ownContracts.length,
    });
  }

  if (groups.length === 0) {
    groups.push({ type: "empty", subId: null, name: "—", nit: null, contracts: [], rowCount: 1 });
  }

  const totalRows  = groups.reduce((s, g) => s + g.rowCount, 0);
  const colorClass = colorIdx % 2 === 0 ? "cfg-row-even" : "cfg-row-odd";

  const rows = [];
  let firstGroup = true;

  groups.forEach(group => {
    const ctList = group.contracts.length > 0 ? group.contracts : [null];
    let firstCt  = true;

    ctList.forEach(ct => {
      const cells = [];

      if (firstGroup && firstCt) {
        cells.push(`
          <td class="cfg-tree-cell cfg-cell-company ${colorClass}" rowspan="${totalRows}">
            <div class="cfg-company-block">
              <span class="cfg-company-name">${escapeHtml(c.name)}</span>
              <span class="cfg-company-since">desde ${fmtDate(c.created_at) || "—"}</span>
            </div>
          </td>
          <td class="cfg-tree-cell cfg-cell-nit ${colorClass}" rowspan="${totalRows}">
            <span class="cfg-nit-val">${escapeHtml(c.nit || "—")}</span>
          </td>
          <td class="cfg-tree-cell cfg-cell-estado ${colorClass}" rowspan="${totalRows}">
            ${statusBadge(c.active)}
          </td>`);
      }

      if (firstCt) {
        const subLabel = group.type === "direct"
          ? `<span class="cfg-sub-tag cfg-sub-direct">CONTRATOS DIRECTOS</span>`
          : `<span class="cfg-sub-tag cfg-sub-company">${escapeHtml(group.name)}</span>`;
        const subNit = group.type === "direct" || !group.nit
          ? `<span class="cfg-nit-na">N/A</span>`
          : `<span class="cfg-nit-val">${escapeHtml(group.nit)}</span>`;

        cells.push(`
          <td class="cfg-tree-cell cfg-cell-sub ${colorClass}" rowspan="${group.rowCount}">
            ${subLabel}
          </td>
          <td class="cfg-tree-cell cfg-cell-nit-sub ${colorClass}" rowspan="${group.rowCount}">
            ${subNit}
          </td>`);
      }

      if (ct) {
        cells.push(`
          <td class="cfg-tree-cell cfg-cell-ct-name">
            <button type="button" class="cfg-ct-name-btn" data-ct-config-id="${escapeAttr(String(ct.id))}">
              ${escapeHtml(ct.name)}
            </button>
          </td>
          <td class="cfg-tree-cell cfg-cell-ct-estado">
            ${statusBadge(ct.active)}
          </td>
          <td class="cfg-tree-cell cfg-cell-ct-periodo">
            ${periodoCell(ct)}
          </td>
          <td class="cfg-tree-cell cfg-cell-ct-emp">
            <span class="cfg-emp-badge">${ct.employees}</span>
          </td>`);
      } else {
        cells.push(`
          <td class="cfg-tree-cell cfg-cell-empty" colspan="4">
            <span class="cfg-muted">Sin contratos registrados</span>
          </td>`);
      }

      if (firstGroup && firstCt) {
        const subOptions = subs.map(s =>
          `<option value="${escapeAttr(String(s.id))}">${escapeAttr(s.name)}</option>`
        ).join("");
        const directOption = `<option value="${escapeAttr(String(c.id))}">Directo — ${escapeAttr(c.name)}</option>`;

        cells.push(`
          <td class="cfg-tree-cell cfg-cell-actions ${colorClass}" rowspan="${totalRows}">
            <div class="cfg-actions-stack">
              <button type="button" class="cfg-action-btn cfg-action-edit"
                data-edit-id="${escapeAttr(String(c.id))}"
                data-edit-name="${escapeAttr(c.name)}"
                data-edit-nit="${escapeAttr(c.nit || "")}"
                data-edit-active="${c.active}">
                ✏ Editar empresa
              </button>
              <button type="button" class="cfg-action-btn cfg-action-add-contract"
                data-client-id="${escapeAttr(String(c.id))}"
                data-client-name="${escapeAttr(c.name)}"
                data-sub-options="${escapeAttr(directOption + subOptions)}">
                + Añadir contrato
              </button>
              <button type="button" class="cfg-action-btn ${c.active ? "cfg-action-deactivate" : "cfg-action-activate"}"
                data-toggle-id="${escapeAttr(String(c.id))}"
                data-toggle-active="${c.active}">
                ${c.active ? "⊘ Desactivar" : "✓ Activar"}
              </button>
            </div>
          </td>`);
      }

      rows.push(`<tr class="cfg-tree-row">${cells.join("")}</tr>`);
      firstCt    = false;
    });
    firstGroup = false;
  });

  return rows.join("");
}

export async function loadClientesModule() {
  let clients = [];
  try {
    const r = await apiFetch("/config/clients");
    clients = Array.isArray(r.data) ? r.data : [];
  } catch (e) {
    return `<div class="cfg-error">No fue posible cargar los clientes: ${escapeHtml(e.message)}</div>`;
  }

  const search  = (state.cfgClientSearch || "").toLowerCase();
  const visible = search
    ? clients.filter(c =>
        c.name.toLowerCase().includes(search) ||
        (c.nit || "").toLowerCase().includes(search))
    : clients;

  return `
<div class="cfg-wrap">
  <div class="cfg-header">
    <div class="cfg-header-left">
      <h2 class="cfg-title">Clientes</h2>
      <span class="cfg-subtitle">Empresas y estructura contractual registradas en EMPIRIA</span>
    </div>
    <button type="button" class="btn btn-primary cfg-btn-new" id="cfgBtnNewClient">
      + Nuevo cliente
    </button>
  </div>

  <div class="cfg-toolbar">
    <div class="cfg-search-wrap">
      <svg class="cfg-search-icon" viewBox="0 0 20 20" fill="none">
        <circle cx="8.5" cy="8.5" r="5.5" stroke="#94a3b8" stroke-width="1.5"/>
        <path d="M14 14l3 3" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <input id="cfgClientSearch" class="cfg-search-input" type="text"
        placeholder="Buscar empresa o NIT…"
        value="${escapeAttr(state.cfgClientSearch || "")}">
    </div>
    <span class="cfg-count-badge">${visible.length} cliente${visible.length !== 1 ? "s" : ""}</span>
  </div>

  <div class="cfg-tree-wrap">
    <table class="cfg-tree-table">
      <thead>
        <tr class="cfg-tree-head">
          <th>EMPRESA</th>
          <th>NIT</th>
          <th>ESTADO</th>
          <th>SUB EMPRESAS</th>
          <th>NIT</th>
          <th>NOMBRE DEL CONTRATO</th>
          <th>ESTADO</th>
          <th>PERIODO DE EJECUCIÓN</th>
          <th>N° EMPLEADOS</th>
          <th>ACCIONES</th>
        </tr>
      </thead>
      <tbody>
        ${visible.length
          ? visible.map((c, i) => _buildClientRows(c, i)).join("")
          : `<tr><td colspan="10" class="cfg-empty">No hay clientes registrados.</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;
}

// ── Modal: Nuevo / Editar cliente ─────────────────────────────────────────────

function openClientModal({ id = null, name = "", nit = "", active = true } = {}) {
  document.getElementById("cfgClientModal")?.remove();
  const isEdit = Boolean(id);
  const modal  = document.createElement("div");
  modal.id     = "cfgClientModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card cfg-modal-card">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">🏢</span>
          <div>
            <h3 style="margin:0;font-size:15px;font-weight:800;color:#0f172a">
              ${isEdit ? "Editar cliente" : "Nuevo cliente"}
            </h3>
            <p style="margin:2px 0 0;font-size:12px;color:#64748b">
              ${isEdit ? "Modifica los datos de la empresa" : "Registra una nueva empresa en EMPIRIA"}
            </p>
          </div>
        </div>
        <button type="button" class="modal-close" id="cfgModalClose">&#x2715;</button>
      </div>
      <div class="modal-body" style="display:grid;gap:14px;padding:20px 24px">
        <label class="cfg-field">
          <span>Nombre de la empresa <em>*</em></span>
          <input id="cfgModalName" type="text" placeholder="Ej: CONSORCIO PAE META 2026"
            value="${escapeAttr(name)}" maxlength="200">
        </label>
        <label class="cfg-field">
          <span>NIT</span>
          <input id="cfgModalNit" type="text" placeholder="Ej: 901352779-7"
            value="${escapeAttr(nit)}" maxlength="30">
        </label>
        ${isEdit ? `
        <label class="cfg-field cfg-field-row">
          <span>Estado</span>
          <select id="cfgModalActive">
            <option value="true"  ${active  ? "selected" : ""}>Activo</option>
            <option value="false" ${!active ? "selected" : ""}>Inactivo</option>
          </select>
        </label>` : ""}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="cfgModalSave" style="flex:1;justify-content:center">
          ${isEdit ? "Guardar cambios" : "Crear cliente"}
        </button>
        <button type="button" class="btn btn-secondary" id="cfgModalCancel">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById("cfgModalClose").addEventListener("click", close);
  document.getElementById("cfgModalCancel").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  document.getElementById("cfgModalSave").addEventListener("click", async () => {
    const nameVal   = document.getElementById("cfgModalName")?.value?.trim() || "";
    const nitVal    = document.getElementById("cfgModalNit")?.value?.trim()  || "";
    const activeVal = isEdit ? document.getElementById("cfgModalActive")?.value === "true" : true;
    if (!nameVal) { document.getElementById("cfgModalName").focus(); return; }
    const btn = document.getElementById("cfgModalSave");
    btn.disabled = true; btn.textContent = isEdit ? "Guardando…" : "Creando…";
    try {
      if (isEdit) {
        await apiFetch(`/config/clients/${id}`, { method: "PUT", body: JSON.stringify({ name: nameVal, nit: nitVal || null, active: activeVal }) });
      } else {
        await apiFetch("/config/clients", { method: "POST", body: JSON.stringify({ name: nameVal, nit: nitVal || null }) });
      }
      showSuccess(isEdit ? "Cliente actualizado." : "Cliente creado.");
      close();
      const { openModule } = await import('../nav.js');
      await openModule("administracion_configuraciones");
    } catch (e) {
      showError(e.message || "No fue posible guardar.");
      btn.disabled = false; btn.textContent = isEdit ? "Guardar cambios" : "Crear cliente";
    }
  });
}

// ── Modal: Añadir contrato ────────────────────────────────────────────────────

function openContractModal({ clientId = null, clientName = "", subOptions = "" } = {}) {
  document.getElementById("cfgContractModal")?.remove();
  const modal = document.createElement("div");
  modal.id    = "cfgContractModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card cfg-modal-card">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">📄</span>
          <div>
            <h3 style="margin:0;font-size:15px;font-weight:800;color:#0f172a">Nuevo contrato</h3>
            <p style="margin:2px 0 0;font-size:12px;color:#64748b">Agregar contrato a ${escapeHtml(clientName)}</p>
          </div>
        </div>
        <button type="button" class="modal-close" id="cfgCtClose">&#x2715;</button>
      </div>
      <div class="modal-body" style="display:grid;gap:14px;padding:20px 24px">
        <label class="cfg-field">
          <span>Asignar a <em>*</em></span>
          <select id="cfgCtCompany">${subOptions}</select>
        </label>
        <label class="cfg-field">
          <span>Nombre del contrato <em>*</em></span>
          <input id="cfgCtName" type="text" placeholder="Ej: CONTRATO DE PRESTACIÓN DE SERVICIOS" maxlength="300">
        </label>
        <label class="cfg-field">
          <span>N° / Código</span>
          <input id="cfgCtCode" type="text" placeholder="Ej: OCA-630-2026" maxlength="100">
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label class="cfg-field">
            <span>Fecha inicio</span>
            <input id="cfgCtStart" type="date">
          </label>
          <label class="cfg-field">
            <span>Fecha fin</span>
            <input id="cfgCtEnd" type="date">
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="cfgCtSave" style="flex:1;justify-content:center">Crear contrato</button>
        <button type="button" class="btn btn-secondary" id="cfgCtCancel">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById("cfgCtClose").addEventListener("click", close);
  document.getElementById("cfgCtCancel").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  document.getElementById("cfgCtSave").addEventListener("click", async () => {
    const nameVal  = document.getElementById("cfgCtName")?.value?.trim() || "";
    if (!nameVal) { document.getElementById("cfgCtName").focus(); return; }
    const btn = document.getElementById("cfgCtSave");
    btn.disabled = true; btn.textContent = "Creando…";
    try {
      await apiFetch("/config/contracts", {
        method: "POST",
        body: JSON.stringify({
          company_id: Number(document.getElementById("cfgCtCompany")?.value || clientId),
          name:       nameVal,
          code:       document.getElementById("cfgCtCode")?.value?.trim() || null,
          start_date: document.getElementById("cfgCtStart")?.value || null,
          end_date:   document.getElementById("cfgCtEnd")?.value   || null,
        }),
      });
      showSuccess("Contrato creado.");
      close();
      const { openModule } = await import('../nav.js');
      await openModule("administracion_configuraciones");
    } catch (e) {
      showError(e.message || "No fue posible crear el contrato.");
      btn.disabled = false; btn.textContent = "Crear contrato";
    }
  });
}

export function wireConfigEvents() {
  setTimeout(() => {
    document.getElementById("cfgClientSearch")?.addEventListener("input", async e => {
      state.cfgClientSearch = e.target.value;
      const mod  = await import('./config.js');
      const html = await mod.loadClientesModule();
      const wrap = document.querySelector(".submodule-content");
      if (wrap) { wrap.innerHTML = html; mod.wireConfigEvents(); }
    });

    document.getElementById("cfgBtnNewClient")?.addEventListener("click", () => openClientModal());

    document.querySelectorAll(".cfg-action-edit").forEach(btn => {
      btn.addEventListener("click", () => openClientModal({
        id:     Number(btn.dataset.editId),
        name:   btn.dataset.editName,
        nit:    btn.dataset.editNit,
        active: btn.dataset.editActive === "true",
      }));
    });

    document.querySelectorAll(".cfg-action-add-contract").forEach(btn => {
      btn.addEventListener("click", () => openContractModal({
        clientId:   Number(btn.dataset.clientId),
        clientName: btn.dataset.clientName,
        subOptions: btn.dataset.subOptions,
      }));
    });

    document.querySelectorAll(".cfg-ct-name-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        state.cfgContractConfigId = Number(btn.dataset.ctConfigId);
        state.cfgContractConfigTab = "contractual";
        const { openModule } = await import('../nav.js');
        await openModule("administracion_configuraciones");
      });
    });

    document.querySelectorAll(".cfg-action-deactivate, .cfg-action-activate").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id     = Number(btn.dataset.toggleId);
        const active = btn.dataset.toggleActive === "true";
        btn.disabled = true;
        try {
          await apiFetch(`/config/clients/${id}`, { method: "PATCH", body: JSON.stringify({ active: !active }) });
          showSuccess(active ? "Cliente desactivado." : "Cliente activado.");
          const { openModule } = await import('../nav.js');
          await openModule("administracion_configuraciones");
        } catch (e) {
          showError(e.message || "No fue posible cambiar el estado.");
          btn.disabled = false;
        }
      });
    });
  }, 0);
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTRACT CONFIG PANEL
// ══════════════════════════════════════════════════════════════════════════════

let _ccpData      = null;
let _ccpSaved     = [];   // última versión guardada en DB (fuente de verdad de la tabla)
let _ccpPosFilter = null; // null | "licitacion" | "real"
let _ccpRolePerms = {};
let _ccpRoles     = [];

function _renderPositions(positions) {
  if (!positions.length) {
    return `<div class="ccp-pos-empty">No hay cargos definidos. Haz clic en "+ Agregar cargo" para comenzar.</div>`;
  }
  return positions.map(pos => `
    <div class="ccp-pos-card" data-pos-lid="${escapeAttr(String(pos._lid))}" data-pos-type="${escapeAttr(pos.type)}">
      <div class="ccp-pos-head">
        <input class="ccp-pos-name" type="text" value="${escapeAttr(pos.name)}" placeholder="Nombre del cargo">
        <input class="ccp-pos-qty" type="number" min="1" value="${escapeAttr(String(pos.quantity ?? ""))}" placeholder="Cant." title="Cantidad requerida">
        <select class="ccp-pos-type">
          <option value="licitacion" ${pos.type === "licitacion" ? "selected" : ""}>Licitación</option>
          <option value="real"       ${pos.type === "real"       ? "selected" : ""}>Real</option>
        </select>
        <button type="button" class="ccp-pos-del" data-pos-lid="${escapeAttr(String(pos._lid))}" title="Eliminar cargo">✕</button>
      </div>
      <div class="ccp-pos-desc-wrap">
        <label class="ccp-pos-desc-label">Descripción del cargo</label>
        <textarea class="ccp-pos-desc" rows="3" placeholder="Describe las funciones y responsabilidades de este cargo…">${escapeHtml(pos.description || "")}</textarea>
      </div>
      <div class="ccp-pos-docs">
        <div class="ccp-docs-label">Documentos requeridos:</div>
        ${pos.documents.map(doc => `
          <div class="ccp-doc-row" data-doc-lid="${escapeAttr(String(doc._lid))}">
            <input class="ccp-doc-name" type="text" value="${escapeAttr(doc.name)}" placeholder="Nombre del documento">
            <label class="ccp-doc-req-label">
              <input type="checkbox" class="ccp-doc-req" ${doc.required ? "checked" : ""}> Obligatorio
            </label>
            <button type="button" class="ccp-doc-del" data-doc-lid="${escapeAttr(String(doc._lid))}"
              data-pos-lid="${escapeAttr(String(pos._lid))}">✕</button>
          </div>`).join("")}
        <button type="button" class="ccp-add-doc-btn" data-pos-lid="${escapeAttr(String(pos._lid))}">+ Añadir documento</button>
      </div>
    </div>`).join("");
}

export async function loadContractConfigPanel(contractId) {
  let data;
  try {
    const r = await apiFetch(`/config/contracts/${contractId}/config`);
    data = r.data;
  } catch (e) {
    return `<div class="cfg-error">No fue posible cargar la configuración: ${escapeHtml(e.message)}</div>`;
  }

  const settings      = data.settings  || {};
  const rawPos        = Array.isArray(settings.positions) ? settings.positions : [];
  const modules       = settings.modules || {};
  const posMode       = settings.position_mode || "licitacion";
  const salaryConfig  = settings.salary_config  || {};
  const cfgSMLV       = salaryConfig.smlv           ?? 1_750_905;
  const cfgAuxTrans   = salaryConfig.aux_transporte ?? 249_095;
  const cfgModalities = salaryConfig.modalities || {};
  _ccpModConfig = {};
  SALARY_MODALITIES.forEach(m => {
    const raw = cfgModalities[m.key];
    if (raw && typeof raw === "object") {
      _ccpModConfig[m.key] = { salary: raw.salary ?? m.defaultSalary, adicionales: Array.isArray(raw.adicionales) ? [...raw.adicionales] : [] };
    } else {
      _ccpModConfig[m.key] = { salary: typeof raw === "number" ? raw : m.defaultSalary, adicionales: [] };
    }
  });

  let _lid = 1;
  _ccpData = rawPos.map(p => ({
    _lid:        _lid++,
    name:        p.name        || "",
    type:        p.type        || "licitacion",
    description: p.description || "",
    quantity:    p.quantity    ?? "",
    documents:   (p.documents || []).map(d => ({ _lid: _lid++, name: d.name || "", required: d.required !== false })),
  }));
  let _nextLid = _lid;
  window.__ccpNextLid = () => _nextLid++;
  _ccpSaved     = _ccpData.map(p => ({ ...p, documents: p.documents.map(d => ({ ...d })) }));
  _ccpPosFilter = null;

  // Roles dinámicos: administrador siempre primero, luego los cargos del contrato
  _ccpRoles = [
    { key: "administrador", label: "Administrador" },
    ..._ccpData
      .filter(p => p.name.trim())
      .map(p => ({ key: p.name.trim(), label: p.name.trim() })),
  ];

  _ccpRolePerms = (settings.role_permissions && typeof settings.role_permissions === "object" && !Array.isArray(settings.role_permissions))
    ? settings.role_permissions
    : {};
  const rolePerms = _ccpRolePerms;
  const activeTab = state.cfgContractConfigTab || "contractual";

  return `
<div class="ccp-wrap">

  <!-- ── Topbar ──────────────────────────────────────────────────────────────── -->
  <div class="ccp-topbar">
    <button type="button" class="ccp-back-btn" id="ccpBack">← Volver a Clientes</button>
    <div class="ccp-topbar-info">
      <span class="ccp-topbar-label">CONTRATO</span>
      <span class="ccp-topbar-title">${escapeHtml(data.name)}</span>
      <span class="ccp-topbar-company">${escapeHtml(data.company?.name || "")}</span>
    </div>
  </div>

  <!-- ── Pestañas ────────────────────────────────────────────────────────────── -->
  <div class="pnl-tabs ccp-tabs">
    <button type="button" class="pnl-tab ${activeTab === "info" ? "pnl-tab-active" : ""}" data-ccp-tab="info">
      <span class="pnl-tab-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </span>
      <span class="pnl-tab-lbl">Información</span>
    </button>
    <button type="button" class="pnl-tab ${activeTab === "contractual" ? "pnl-tab-active" : ""}" data-ccp-tab="contractual">
      <span class="pnl-tab-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 7.5V6a2 2 0 0 0-2-2h-3V2.5"/><path d="M8 2.5V4H5a2 2 0 0 0-2 2v3.5"/>
          <path d="M3 16.5V18a2 2 0 0 0 2 2h3v1.5"/><path d="M16 21.5V20h3a2 2 0 0 0 2-2v-1.5"/>
          <rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 12h4"/><path d="M12 10v4"/>
        </svg>
      </span>
      <span class="pnl-tab-lbl">ConfiguraciÃ³n Contractual</span>
    </button>
    <button type="button" class="pnl-tab ${activeTab === "cargos" ? "pnl-tab-active" : ""}" data-ccp-tab="cargos">
      <span class="pnl-tab-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </span>
      <span class="pnl-tab-lbl">Cargos</span>
    </button>
    <button type="button" class="pnl-tab ${activeTab === "modulos" ? "pnl-tab-active" : ""}" data-ccp-tab="modulos">
      <span class="pnl-tab-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
      </span>
      <span class="pnl-tab-lbl">Módulos</span>
    </button>
    <button type="button" class="pnl-tab ${activeTab === "usuarios" ? "pnl-tab-active" : ""}" data-ccp-tab="usuarios">
      <span class="pnl-tab-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      </span>
      <span class="pnl-tab-lbl">Usuarios</span>
    </button>
    <button type="button" class="pnl-tab ${activeTab === "calculadora" ? "pnl-tab-active" : ""}" data-ccp-tab="calculadora">
      <span class="pnl-tab-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </span>
      <span class="pnl-tab-lbl">Calculadora</span>
    </button>
  </div>

  <!-- ── Contenido de pestañas ───────────────────────────────────────────────── -->
  <div class="ccp-body">

    <!-- TAB 1: Información -->
    <div class="ccp-panel ${activeTab === "info" ? "ccp-panel-active" : ""}" data-ccp-panel="info">
      <div class="ccp-panel-inner">
        <div class="ccp-card">
          <div class="ccp-panel-title">Información del Contrato</div>
          <div class="ccp-form-grid">
            <label class="ccp-field ccp-field-wide">
              <span>Nombre del contrato <em>*</em></span>
              <input id="ccpName" type="text" value="${escapeAttr(data.name)}" maxlength="300">
            </label>
            <label class="ccp-field ccp-field-wide">
              <span>Empresa asignada</span>
              <div class="ccp-company-display">${escapeHtml(data.company?.name || "—")}</div>
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;grid-column:1/-1">
              <label class="ccp-field">
                <span>Fecha de inicio <em>*</em></span>
                <input id="ccpStart" type="date" value="${escapeAttr(toInputDate(data.start_date))}">
              </label>
              <label class="ccp-field">
                <span>Fecha de finalización</span>
                <input id="ccpEnd" type="date" value="${escapeAttr(toInputDate(data.end_date))}">
              </label>
            </div>
            <div class="ccp-field ccp-field-inline">
              <span>Estado</span>
              <span id="ccpStatusBadge" class="cfg-badge ${!data.end_date ? "cfg-badge-active" : "cfg-badge-inactive"}">
                ${!data.end_date ? "Activo" : "Terminado"}
              </span>
            </div>
          </div>
          <div class="ccp-save-row">
            <button type="button" class="btn btn-primary" id="ccpSaveInfo">Guardar información</button>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: Cargos -->
    <div class="ccp-panel ${activeTab === "contractual" ? "ccp-panel-active" : ""}" data-ccp-panel="contractual">
      <div class="ccp-panel-inner">
        <div class="ccp-card">
          <div class="ccp-panel-title">ConfiguraciÃ³n Contractual</div>
          <div id="ccpContractualPanelContent" class="ctc-root">
            <div class="ccp-loading-row">Cargando configuraciÃ³n contractualâ€¦</div>
          </div>
        </div>
      </div>
    </div>

    <div class="ccp-panel ${activeTab === "cargos" ? "ccp-panel-active" : ""}" data-ccp-panel="cargos">
      <div class="ccp-panel-inner">
        <div class="ccp-card">

          <!-- Encabezado: filtros + botón -->
          <div class="ccp-section-header">
            <div class="ccp-pos-filters">
              <button type="button" class="ccp-pos-filter-btn" id="ccpFilterLicitacion" data-filter="licitacion">Licitación</button>
              <button type="button" class="ccp-pos-filter-btn" id="ccpFilterReal" data-filter="real">Cargos Operacionales</button>
            </div>
            <button type="button" class="btn btn-primary" id="ccpAddPos">+ Agregar cargo</button>
          </div>

          <!-- Tabla con scroll -->
          <div class="ccp-ptable-scroll">
            <div id="ccpPositionsTableView">
              ${_buildPositionsTableHtml(_ccpSaved)}
            </div>
          </div>

        </div>
      </div>
    </div>

    <!-- TAB 3: Módulos -->
    <div class="ccp-panel ${activeTab === "modulos" ? "ccp-panel-active" : ""}" data-ccp-panel="modulos">
      <div class="ccp-panel-inner">

        <!-- Card: Habilitar / deshabilitar módulos -->
        <div class="ccp-card">
          <div class="ccp-panel-title">Módulos Habilitados</div>
          <p class="ccp-modules-hint">Selecciona qué módulos estarán disponibles para los usuarios de este contrato.</p>
          <div class="ccp-modules-grid">
            ${SYSTEM_MODULES.map(mod => {
              const enabled = modules[mod.key] !== false;
              return `
                <label class="ccp-module-row">
                  <span class="ccp-module-label">${escapeHtml(mod.label)}</span>
                  <div class="ccp-toggle ${enabled ? "ccp-toggle-on" : ""}">
                    <input type="checkbox" class="ccp-module-toggle" data-module-key="${escapeAttr(mod.key)}" ${enabled ? "checked" : ""}>
                    <span class="ccp-toggle-track"><span class="ccp-toggle-thumb"></span></span>
                  </div>
                </label>`;
            }).join("")}
          </div>
          <div class="ccp-modules-divider"></div>
          <div class="ccp-panel-subtitle">Funcionalidades</div>
          <p class="ccp-modules-hint">Activa o desactiva características específicas dentro de los módulos.</p>
          <div class="ccp-modules-grid">
            ${SYSTEM_FEATURES.map(feat => {
              const enabled = modules[feat.key] === true;
              return `
                <label class="ccp-module-row">
                  <span class="ccp-module-label">${escapeHtml(feat.label)}</span>
                  <div class="ccp-toggle ${enabled ? "ccp-toggle-on" : ""}">
                    <input type="checkbox" class="ccp-module-toggle" data-module-key="${escapeAttr(feat.key)}" ${enabled ? "checked" : ""}>
                    <span class="ccp-toggle-track"><span class="ccp-toggle-thumb"></span></span>
                  </div>
                </label>`;
            }).join("")}
          </div>
          <div class="ccp-save-row">
            <button type="button" class="btn btn-primary" id="ccpSaveModules">Guardar módulos</button>
          </div>
        </div>

        <!-- Card: Personalizar Dashboard -->
        <div class="ccp-card">
          <div class="ccp-panel-title">Personalizar Dashboard</div>
          <p class="ccp-modules-hint">Elige qué widgets se muestran y en qué orden. Arrastra para reordenar.</p>
          <div id="ccpWidgetList" class="ccpw-list">
            <div class="ccp-loading-row">Cargando widgets…</div>
          </div>
          <div class="ccp-save-row">
            <button type="button" class="btn btn-primary" id="ccpSaveWidgets">Guardar configuración del Dashboard</button>
          </div>
        </div>

        <!-- Card: Personalizar campos por módulo -->
        <div class="ccp-card">
          <div class="ccp-panel-title">Personalizar Campos por Módulo</div>
          <p class="ccp-modules-hint">Define qué campos se muestran en cada módulo, con su etiqueta y si son requeridos.</p>
          <div class="ccpf-module-tabs" id="ccpFieldModuleTabs">
            ${[
              { slug: "personal",     label: "Personal"      },
              { slug: "nomina",       label: "Nómina"        },
              { slug: "cobertura_pae",label: "Cobertura PAE" },
            ].map((m, i) => `
              <button type="button" class="ccp-role-tab${i === 0 ? " ccp-role-tab-active" : ""}"
                data-field-slug="${escapeAttr(m.slug)}">${escapeHtml(m.label)}</button>
            `).join("")}
          </div>
          <div id="ccpFieldList" class="ccpf-list">
            <div class="ccp-loading-row">Cargando campos…</div>
          </div>
          <div class="ccp-save-row">
            <button type="button" class="btn btn-primary" id="ccpSaveFields">Guardar campos</button>
          </div>
        </div>

      </div>
    </div>

    <!-- TAB 4: Usuarios -->
    <div class="ccp-panel ${activeTab === "usuarios" ? "ccp-panel-active" : ""}" data-ccp-panel="usuarios">
      <div class="ccp-panel-inner">

        <!-- Card: Usuarios del contrato -->
        <div class="ccp-card">
          <div class="ccp-section-header">
            <div class="ccp-panel-title" style="margin:0;border:none;padding:0">Usuarios del Contrato</div>
            <button type="button" class="btn btn-primary btn-sm" id="ccpBtnNewUser">+ Nuevo usuario</button>
          </div>
          <div id="ccpUsersTableWrap" class="ccp-users-wrap" style="margin-top:16px">
            <div class="ccp-loading-row">Cargando usuarios…</div>
          </div>
        </div>

        <!-- Card: Permisos por cargo -->
        <div class="ccp-card">
          <div class="ccp-panel-title">Permisos por Cargo</div>
          <p class="ccp-modules-hint">Define qué acciones puede realizar cada cargo en cada módulo habilitado.</p>
          <div class="ccp-perms-roles-bar" id="ccpRoleTabs">
            ${_ccpRoles.map((r, i) => `
              <button type="button" class="ccp-role-tab${i === 0 ? " ccp-role-tab-active" : ""}"
                data-ccp-role="${escapeAttr(r.key)}">${escapeHtml(r.label)}</button>
            `).join("")}
          </div>
          <div id="ccpRolePermsBody" class="ccp-perms-body">
            ${_ccpRoles.length ? _renderRolePermissions(_ccpRoles[0].key, rolePerms) : `<p class="ccp-modules-hint">Agrega cargos en la pestaña "Cargos" para configurar permisos.</p>`}
          </div>
          <div class="ccp-save-row">
            <button type="button" class="btn btn-primary" id="ccpSavePerms">Guardar permisos</button>
          </div>
        </div>

      </div>
    </div>

    <!-- TAB 5: Calculadora -->
    <div class="ccp-panel ${activeTab === "calculadora" ? "ccp-panel-active" : ""}" data-ccp-panel="calculadora">
      <div class="ccp-panel-inner">
        <div class="ccp-card">
          <div class="ccp-panel-title">⚙ Configuración de Calculadora</div>
          <p class="ccp-modules-hint">Define los valores base y el salario con adicionales por modalidad para este contrato.</p>

          <div class="ccp-sc-section-title">Valores legales base</div>
          <div class="ccp-salary-cfg-grid">
            <label class="ccp-field">
              <span>SMLV — Salario mínimo legal vigente <em>*</em></span>
              <div class="ccp-salary-input-wrap">
                <span class="ccp-salary-prefix">$</span>
                <input id="ccpSMLV" type="number" min="0" step="1000" value="${cfgSMLV}" placeholder="1750905">
              </div>
              <span class="ccp-salary-ref">Legal 2026: $1.750.905</span>
            </label>
            <label class="ccp-field">
              <span>Auxilio de transporte <em>*</em></span>
              <div class="ccp-salary-input-wrap">
                <span class="ccp-salary-prefix">$</span>
                <input id="ccpAuxTrans" type="number" min="0" step="1000" value="${cfgAuxTrans}" placeholder="249095">
              </div>
              <span class="ccp-salary-ref">Legal 2026: $249.095</span>
            </label>
          </div>

          <div class="ccp-sc-section-title" style="margin-top:22px">Salario y adicionales por modalidad</div>
          <div class="ccp-sc-mod-list" id="ccpModList">
            ${SALARY_MODALITIES.map(m => {
              const cfg = _ccpModConfig[m.key];
              return `
            <div class="ccp-sc-mod-card">
              <div class="ccp-sc-mod-row">
                <span class="ccp-sc-mod-badge ccp-sc-mod-badge--${m.grp}">${escapeHtml(m.key)}</span>
                <div class="ccp-sc-mod-info">
                  <span class="ccp-sc-mod-desc">${escapeHtml(m.desc)}</span>
                  <span class="ccp-sc-mod-jornada">${escapeHtml(m.jornada)}</span>
                </div>
                <div class="ccp-salary-input-wrap ccp-sc-mod-salary-wrap">
                  <span class="ccp-salary-prefix">$</span>
                  <input type="number" class="ccp-sc-mod-salary-input" data-mod="${escapeAttr(m.key)}"
                    min="0" step="1000" value="${cfg.salary}">
                </div>
              </div>
              <div class="ccp-sc-mod-adics" data-mod="${escapeAttr(m.key)}">
                ${cfg.adicionales.map((a, i) => `
                <div class="ccp-sc-adic-row">
                  <input type="text" class="ccp-sc-adic-label" data-mod="${escapeAttr(m.key)}" data-idx="${i}"
                    placeholder="Nombre del adicional" value="${escapeAttr(a.label)}">
                  <div class="ccp-salary-input-wrap ccp-sc-adic-val-wrap">
                    <span class="ccp-salary-prefix">$</span>
                    <input type="number" class="ccp-sc-adic-value" data-mod="${escapeAttr(m.key)}" data-idx="${i}"
                      min="0" step="1000" value="${a.value || 0}">
                  </div>
                  <button type="button" class="ccp-sc-adic-del" data-mod="${escapeAttr(m.key)}" data-idx="${i}" title="Eliminar">✕</button>
                </div>`).join("")}
                <button type="button" class="ccp-sc-add-adic-btn" data-mod="${escapeAttr(m.key)}">+ Adicional</button>
              </div>
            </div>`;
            }).join("")}
          </div>

          <div class="ccp-save-row" style="margin-top:20px">
            <button type="button" class="btn btn-primary" id="ccpSaveSalary">Guardar configuración</button>
          </div>
        </div>
      </div>
    </div>

  </div>
</div>`;
}

export function wireContractConfigEvents() {
  setTimeout(() => {

    // ── Cambio de pestaña ────────────────────────────────────────────────────
    document.querySelectorAll(".pnl-tab[data-ccp-tab]").forEach(tab => {
      tab.addEventListener("click", () => {
        const key = tab.dataset.ccpTab;
        state.cfgContractConfigTab = key;
        document.querySelectorAll(".pnl-tab[data-ccp-tab]").forEach(t => t.classList.remove("pnl-tab-active"));
        document.querySelectorAll(".ccp-panel").forEach(p => p.classList.remove("ccp-panel-active"));
        tab.classList.add("pnl-tab-active");
        document.querySelector(`.ccp-panel[data-ccp-panel="${key}"]`)?.classList.add("ccp-panel-active");
        if (key === "contractual") loadContractualPanel(state.cfgContractConfigId);
        if (key === "usuarios")    _loadUsersTab(state.cfgContractConfigId);
        if (key === "modulos")     { _loadWidgets(); _loadFields(_ccpActiveFieldSlug); }
        if (key === "calculadora") SALARY_MODALITIES.forEach(m => _renderModAdics(m.key));
      });
    });

    // ── Back ────────────────────────────────────────────────────────────────
    document.getElementById("ccpBack")?.addEventListener("click", async () => {
      state.cfgContractConfigId = null;
      state.cfgContractConfigTab = "contractual";
      const { openModule } = await import('../nav.js');
      await openModule("administracion_configuraciones");
    });

    if ((state.cfgContractConfigTab || "contractual") === "contractual") {
      loadContractualPanel(state.cfgContractConfigId);
    }

    // ── Sección 1: Guardar info ──────────────────────────────────────────────
    document.getElementById("ccpSaveInfo")?.addEventListener("click", async () => {
      const name  = document.getElementById("ccpName")?.value?.trim()  || "";
      const start = document.getElementById("ccpStart")?.value || "";
      const end   = document.getElementById("ccpEnd")?.value   || "";
      const active = !end;
      if (!name)  { showError("El nombre del contrato es obligatorio.");    return; }
      if (!start) { showError("La fecha de inicio es obligatoria."); return; }
      const btn = document.getElementById("ccpSaveInfo");
      btn.disabled = true; btn.textContent = "Guardando…";
      try {
        await apiFetch(`/config/contracts/${state.cfgContractConfigId}`, {
          method: "PUT",
          body: JSON.stringify({ name, start_date: start, end_date: end || null, active }),
        });
        showSuccess("Información del contrato actualizada.");
      } catch (e) {
        showError(e.message || "No fue posible guardar.");
      } finally {
        btn.disabled = false; btn.textContent = "Guardar información";
      }
    });

    // ── Sección 1: Actualizar badge estado en vivo ───────────────────────────
    document.getElementById("ccpEnd")?.addEventListener("change", e => {
      const badge = document.getElementById("ccpStatusBadge");
      if (!badge) return;
      const hasEnd = Boolean(e.target.value);
      badge.textContent = hasEnd ? "Terminado" : "Activo";
      badge.className   = `cfg-badge ${hasEnd ? "cfg-badge-inactive" : "cfg-badge-active"}`;
    });

    // ── Sección 2: Filtros de cargos por tipo ───────────────────────────────
    document.querySelectorAll(".ccp-pos-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const f = btn.dataset.filter;
        _ccpPosFilter = _ccpPosFilter === f ? null : f;
        _refreshPositionsTable();
      });
    });

    // ── Sección 3: Agregar cargo (modal) ────────────────────────────────────
    document.getElementById("ccpAddPos")?.addEventListener("click", () => _openAddPosModal());

    // ── Sección 3: Guardar módulos ───────────────────────────────────────────
    document.getElementById("ccpSaveModules")?.addEventListener("click", async () => {
      _syncPositionsFromDOM();
      const posMode = document.querySelector('input[name="ccpPosMode"]:checked')?.value || "licitacion";
      const btn = document.getElementById("ccpSaveModules");
      btn.disabled = true; btn.textContent = "Guardando…";
      try {
        await apiFetch(`/config/contracts/${state.cfgContractConfigId}/settings`, {
          method: "PUT",
          body: JSON.stringify({
            position_mode: posMode,
            modules:       _readModulesFromDOM(),
            positions:     _ccpData.map(p => ({
              name:      p.name,
              type:      p.type,
              description: p.description || "",
        quantity:    p.quantity    !== "" ? Number(p.quantity) : null,
        documents: p.documents.map(d => ({ name: d.name, required: d.required })),
            })),
          }),
        });
        showSuccess("Módulos habilitados guardados.");
      } catch (e) {
        showError(e.message || "No fue posible guardar los módulos.");
      } finally {
        btn.disabled = false; btn.textContent = "Guardar módulos";
      }
    });

    // ── Toggle visual en módulos ─────────────────────────────────────────────
    document.querySelectorAll(".ccp-module-toggle").forEach(chk => {
      chk.addEventListener("change", () => {
        chk.closest(".ccp-toggle")?.classList.toggle("ccp-toggle-on", chk.checked);
      });
    });

    // ── Delegación: mostrar/ocultar descripción al cambiar tipo ─────────────
    document.getElementById("ccpPositionsList")?.addEventListener("change", e => {
      if (!e.target.classList.contains("ccp-pos-type")) return;
      const card = e.target.closest(".ccp-pos-card");
      if (card) card.dataset.posType = e.target.value;
    });

    // ── Delegación: eliminar cargo, añadir/eliminar documento ───────────────
    document.getElementById("ccpPositionsList")?.addEventListener("click", e => {
      // Eliminar cargo
      if (e.target.closest(".ccp-pos-del")) {
        const lid = Number(e.target.closest(".ccp-pos-del").dataset.posLid);
        _ccpData = _ccpData.filter(p => p._lid !== lid);
        _refreshPositionsList();
        return;
      }
      // Añadir documento
      if (e.target.closest(".ccp-add-doc-btn")) {
        const posLid = Number(e.target.closest(".ccp-add-doc-btn").dataset.posLid);
        const pos    = _ccpData.find(p => p._lid === posLid);
        if (pos) {
          const lid = window.__ccpNextLid();
          pos.documents.push({ _lid: lid, name: "", required: true });
          _refreshPositionsList();
        }
        return;
      }
      // Eliminar documento
      if (e.target.closest(".ccp-doc-del")) {
        const docLid = Number(e.target.closest(".ccp-doc-del").dataset.docLid);
        const posLid = Number(e.target.closest(".ccp-doc-del").dataset.posLid);
        const pos    = _ccpData.find(p => p._lid === posLid);
        if (pos) {
          pos.documents = pos.documents.filter(d => d._lid !== docLid);
          _refreshPositionsList();
        }
        return;
      }
    });

    // ── Tabla de cargos: botones de acción ──────────────────────────────────
    document.getElementById("ccpPositionsTableView")?.addEventListener("click", e => {
      const btn = e.target.closest("[data-pi]");
      if (!btn) return;
      const idx = Number(btn.dataset.pi);
      if (btn.classList.contains("ccp-ptbl-edit")) _openPosEditModal(idx);
      if (btn.classList.contains("ccp-ptbl-docs")) _openPosDocsModal(idx);
      if (btn.classList.contains("ccp-ptbl-qty"))  _openPosQtyModal(idx);
    });

    // ── Tab 4: Nuevo usuario ─────────────────────────────────────────────────
    document.getElementById("ccpBtnNewUser")?.addEventListener("click", () => {
      openUserModal({ contractId: state.cfgContractConfigId });
    });

    // ── Tab 3: Widgets – guardar ─────────────────────────────────────────────
    document.getElementById("ccpSaveWidgets")?.addEventListener("click", async () => {
      const btn = document.getElementById("ccpSaveWidgets");
      btn.disabled = true; btn.textContent = "Guardando…";
      try {
        await apiFetch(`/config/contracts/${state.cfgContractConfigId}/dashboard-config`, {
          method: "PUT",
          body: JSON.stringify({ widgets: _ccpWidgets }),
        });
        showSuccess("Configuración del dashboard guardada.");
      } catch (e) {
        showError(e.message || "No fue posible guardar el dashboard.");
      } finally {
        btn.disabled = false; btn.textContent = "Guardar configuración del Dashboard";
      }
    });

    // ── Tab 3: Campos – cambio de módulo ─────────────────────────────────────
    document.getElementById("ccpFieldModuleTabs")?.addEventListener("click", e => {
      const tab = e.target.closest("[data-field-slug]");
      if (!tab) return;
      const slug = tab.dataset.fieldSlug;
      document.querySelectorAll("#ccpFieldModuleTabs [data-field-slug]").forEach(t =>
        t.classList.toggle("ccp-role-tab-active", t === tab));
      _loadFields(slug);
    });

    // ── Tab 3: Campos – guardar ──────────────────────────────────────────────
    document.getElementById("ccpSaveFields")?.addEventListener("click", async () => {
      _syncFieldLabelsFromDOM();
      const slug   = _ccpActiveFieldSlug;
      const campos = _ccpFields[slug] || [];
      const btn    = document.getElementById("ccpSaveFields");
      btn.disabled = true; btn.textContent = "Guardando…";
      try {
        await apiFetch(`/config/contracts/${state.cfgContractConfigId}/module-fields/${slug}`, {
          method: "PUT",
          body: JSON.stringify({ campos }),
        });
        showSuccess("Campos guardados correctamente.");
      } catch (e) {
        showError(e.message || "No fue posible guardar los campos.");
      } finally {
        btn.disabled = false; btn.textContent = "Guardar campos";
      }
    });

    // ── Tab 4: Role tabs (permisos) ──────────────────────────────────────────
    document.getElementById("ccpRoleTabs")?.addEventListener("click", e => {
      const roleTab = e.target.closest(".ccp-role-tab");
      if (!roleTab) return;
      const role = roleTab.dataset.ccpRole;
      _syncRolePermsFromDOM();
      document.querySelectorAll(".ccp-role-tab").forEach(t => t.classList.remove("ccp-role-tab-active"));
      roleTab.classList.add("ccp-role-tab-active");
      const body = document.getElementById("ccpRolePermsBody");
      if (body) body.innerHTML = _renderRolePermissions(role, _ccpRolePerms);
    });

    // ── Tab 5: Re-render adicionales de una modalidad ────────────────────────
    function _renderModAdics(modKey) {
      const container = document.querySelector(`.ccp-sc-mod-adics[data-mod="${modKey}"]`);
      if (!container) return;
      const adics = _ccpModConfig[modKey]?.adicionales || [];
      container.innerHTML = adics.map((a, i) => `
        <div class="ccp-sc-adic-row">
          <input type="text" class="ccp-sc-adic-label" data-mod="${modKey}" data-idx="${i}"
            placeholder="Nombre del adicional" value="${escapeAttr(a.label)}">
          <div class="ccp-salary-input-wrap ccp-sc-adic-val-wrap">
            <span class="ccp-salary-prefix">$</span>
            <input type="number" class="ccp-sc-adic-value" data-mod="${modKey}" data-idx="${i}"
              min="0" step="1000" value="${a.value || 0}">
          </div>
          <button type="button" class="ccp-sc-adic-del" data-mod="${modKey}" data-idx="${i}" title="Eliminar">✕</button>
        </div>`).join("")
        + `<button type="button" class="ccp-sc-add-adic-btn" data-mod="${modKey}">+ Adicional</button>`;
    }

    // Delegación de eventos en la lista de modalidades
    document.getElementById("ccpModList")?.addEventListener("click", e => {
      const del = e.target.closest(".ccp-sc-adic-del");
      if (del) {
        const { mod, idx } = del.dataset;
        _ccpModConfig[mod].adicionales.splice(Number(idx), 1);
        _renderModAdics(mod);
        return;
      }
      const add = e.target.closest(".ccp-sc-add-adic-btn");
      if (add) {
        const mod = add.dataset.mod;
        _ccpModConfig[mod].adicionales.push({ label: "", value: 0 });
        _renderModAdics(mod);
        const container = document.querySelector(`.ccp-sc-mod-adics[data-mod="${mod}"]`);
        container?.querySelector(".ccp-sc-adic-label:last-of-type")?.focus();
      }
    });
    document.getElementById("ccpModList")?.addEventListener("input", e => {
      const lbl = e.target.closest(".ccp-sc-adic-label");
      if (lbl) { _ccpModConfig[lbl.dataset.mod].adicionales[Number(lbl.dataset.idx)].label = lbl.value; return; }
      const val = e.target.closest(".ccp-sc-adic-value");
      if (val) { _ccpModConfig[val.dataset.mod].adicionales[Number(val.dataset.idx)].value = Math.round(parseFloat(val.value) || 0); }
    });

    // ── Tab 5: Guardar configuración calculadora ─────────────────────────────
    document.getElementById("ccpSaveSalary")?.addEventListener("click", async () => {
      const smlv     = Math.round(parseFloat(document.getElementById("ccpSMLV")?.value)    || 0);
      const auxTrans = Math.round(parseFloat(document.getElementById("ccpAuxTrans")?.value) || 0);
      if (smlv <= 0)     { showError("Ingresa un valor de SMLV válido.");                   return; }
      if (auxTrans <= 0) { showError("Ingresa un valor de Auxilio de Transporte válido.");  return; }
      const modalities = {};
      SALARY_MODALITIES.forEach(m => {
        const salaryInp = document.querySelector(`.ccp-sc-mod-salary-input[data-mod="${m.key}"]`);
        modalities[m.key] = {
          salary:      Math.round(parseFloat(salaryInp?.value) || m.defaultSalary),
          adicionales: (_ccpModConfig[m.key]?.adicionales || []).filter(a => a.label.trim()),
        };
      });
      const btn = document.getElementById("ccpSaveSalary");
      btn.disabled = true; btn.textContent = "Guardando…";
      try {
        await apiFetch(`/config/contracts/${state.cfgContractConfigId}/salary-config`, {
          method: "PUT",
          body: JSON.stringify({ salary_config: { smlv, aux_transporte: auxTrans, modalities } }),
        });
        showSuccess("Configuración de calculadora guardada.");
      } catch (e) {
        showError(e.message || "No fue posible guardar.");
      } finally {
        btn.disabled = false; btn.textContent = "Guardar configuración";
      }
    });

    // ── Tab 4: Guardar permisos ──────────────────────────────────────────────
    document.getElementById("ccpSavePerms")?.addEventListener("click", async () => {
      _syncRolePermsFromDOM();
      _syncPositionsFromDOM();
      const posMode = document.querySelector('input[name="ccpPosMode"]:checked')?.value || "licitacion";
      const btn = document.getElementById("ccpSavePerms");
      btn.disabled = true; btn.textContent = "Guardando…";
      try {
        await apiFetch(`/config/contracts/${state.cfgContractConfigId}/settings`, {
          method: "PUT",
          body: JSON.stringify({
            position_mode:    posMode,
            modules:          _readModulesFromDOM(),
            positions:        _ccpData.map(p => ({ name: p.name, type: p.type, documents: p.documents.map(d => ({ name: d.name, required: d.required })) })),
            role_permissions: _ccpRolePerms,
          }),
        });
        showSuccess("Permisos guardados correctamente.");
      } catch (e) {
        showError(e.message || "No fue posible guardar los permisos.");
      } finally {
        btn.disabled = false; btn.textContent = "Guardar permisos";
      }
    });

  }, 0);
}

// ── Widget personalizer ───────────────────────────────────────────────────────

async function _loadWidgets() {
  const wrap = document.getElementById("ccpWidgetList");
  if (!wrap) return;
  try {
    const r = await apiFetch(`/config/contracts/${state.cfgContractConfigId}/dashboard-config`);
    _ccpWidgets = r.data || [];
    _renderWidgetList();
  } catch (e) {
    if (wrap) wrap.innerHTML = `<p class="ccp-modules-hint" style="color:red">${escapeHtml(e.message)}</p>`;
  }
}

function _renderWidgetList() {
  const wrap = document.getElementById("ccpWidgetList");
  if (!wrap) return;
  wrap.innerHTML = _ccpWidgets.map((w, i) => `
    <div class="ccpw-row ${w.visible ? "ccpw-row-on" : ""}"
         draggable="true" data-wi="${i}">
      <span class="ccpw-drag" title="Arrastrar para reordenar">⠿</span>
      <span class="ccpw-icon">${escapeHtml(w.icon || "")}</span>
      <span class="ccpw-label">${escapeHtml(w.label || w.id)}</span>
      <label class="ccp-toggle ${w.visible ? "ccp-toggle-on" : ""}" style="margin-left:auto">
        <input type="checkbox" class="ccpw-toggle" data-wi="${i}" ${w.visible ? "checked" : ""}>
        <span class="ccp-toggle-track"><span class="ccp-toggle-thumb"></span></span>
      </label>
    </div>`).join("");

  // Toggle visibility
  wrap.querySelectorAll(".ccpw-toggle").forEach(chk => {
    chk.addEventListener("change", () => {
      const idx = Number(chk.dataset.wi);
      _ccpWidgets[idx].visible = chk.checked;
      chk.closest(".ccpw-row")?.classList.toggle("ccpw-row-on", chk.checked);
      chk.closest(".ccp-toggle")?.classList.toggle("ccp-toggle-on", chk.checked);
    });
  });

  // Drag & drop to reorder
  wrap.querySelectorAll(".ccpw-row").forEach(row => {
    row.addEventListener("dragstart", e => {
      _ccpDragSrc = Number(row.dataset.wi);
      row.classList.add("ccpw-dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("ccpw-dragging");
      wrap.querySelectorAll(".ccpw-row").forEach(r => r.classList.remove("ccpw-over"));
    });
    row.addEventListener("dragover", e => {
      e.preventDefault();
      wrap.querySelectorAll(".ccpw-row").forEach(r => r.classList.remove("ccpw-over"));
      row.classList.add("ccpw-over");
    });
    row.addEventListener("drop", e => {
      e.preventDefault();
      const dest = Number(row.dataset.wi);
      if (_ccpDragSrc === null || _ccpDragSrc === dest) return;
      const moved = _ccpWidgets.splice(_ccpDragSrc, 1)[0];
      _ccpWidgets.splice(dest, 0, moved);
      _ccpWidgets.forEach((w, i) => { w.posicion = i + 1; });
      _renderWidgetList();
    });
  });
}

// ── Field personalizer ────────────────────────────────────────────────────────

async function _loadFields(slug) {
  _ccpActiveFieldSlug = slug;
  const wrap = document.getElementById("ccpFieldList");
  if (!wrap) return;
  wrap.innerHTML = `<div class="ccp-loading-row">Cargando campos…</div>`;
  try {
    const r = await apiFetch(`/config/contracts/${state.cfgContractConfigId}/module-fields/${slug}`);
    _ccpFields[slug] = r.data || [];
    _renderFieldList(slug);
  } catch (e) {
    wrap.innerHTML = `<p class="ccp-modules-hint" style="color:red">${escapeHtml(e.message)}</p>`;
  }
}

function _renderFieldList(slug) {
  const wrap = document.getElementById("ccpFieldList");
  if (!wrap) return;
  const fields = _ccpFields[slug] || [];
  if (!fields.length) { wrap.innerHTML = `<p class="ccp-modules-hint">No hay campos configurables para este módulo.</p>`; return; }
  wrap.innerHTML = `
    <div class="ccpf-header">
      <span class="ccpf-col-name">Campo</span>
      <span class="ccpf-col-label">Etiqueta</span>
      <span class="ccpf-col-vis">Visible</span>
      <span class="ccpf-col-req">Requerido</span>
    </div>
    ${fields.map((f, i) => `
      <div class="ccpf-row ${f.base ? "ccpf-row-base" : ""}">
        <span class="ccpf-campo">${escapeHtml(f.campo)}</span>
        <input class="ccpf-etiqueta" type="text" value="${escapeAttr(f.etiqueta)}"
               data-fi="${i}" ${f.base ? "" : ""} placeholder="Etiqueta personalizada">
        <label class="ccp-toggle ${f.visible ? "ccp-toggle-on" : ""} ${f.base ? "ccp-toggle-disabled" : ""}">
          <input type="checkbox" class="ccpf-vis" data-fi="${i}" ${f.visible ? "checked" : ""} ${f.base ? "disabled" : ""}>
          <span class="ccp-toggle-track"><span class="ccp-toggle-thumb"></span></span>
        </label>
        <label class="ccp-toggle ${f.requerido ? "ccp-toggle-on" : ""} ${f.base ? "ccp-toggle-disabled" : ""}">
          <input type="checkbox" class="ccpf-req" data-fi="${i}" ${f.requerido ? "checked" : ""} ${f.base ? "disabled" : ""}>
          <span class="ccp-toggle-track"><span class="ccp-toggle-thumb"></span></span>
        </label>
      </div>`).join("")}`;

  wrap.querySelectorAll(".ccpf-vis").forEach(chk => {
    chk.addEventListener("change", () => {
      const idx = Number(chk.dataset.fi);
      _ccpFields[slug][idx].visible = chk.checked;
      chk.closest(".ccp-toggle")?.classList.toggle("ccp-toggle-on", chk.checked);
    });
  });
  wrap.querySelectorAll(".ccpf-req").forEach(chk => {
    chk.addEventListener("change", () => {
      const idx = Number(chk.dataset.fi);
      _ccpFields[slug][idx].requerido = chk.checked;
      chk.closest(".ccp-toggle")?.classList.toggle("ccp-toggle-on", chk.checked);
    });
  });
}

function _syncFieldLabelsFromDOM() {
  const slug = _ccpActiveFieldSlug;
  document.querySelectorAll(".ccpf-etiqueta").forEach(inp => {
    const idx = Number(inp.dataset.fi);
    if (_ccpFields[slug]?.[idx]) _ccpFields[slug][idx].etiqueta = inp.value.trim() || _ccpFields[slug][idx].etiqueta;
  });
}

// ── Helpers for contract config panel ────────────────────────────────────────

function _syncPositionsFromDOM() {
  document.querySelectorAll(".ccp-pos-card").forEach(card => {
    const lid = Number(card.dataset.posLid);
    const pos = _ccpData.find(p => p._lid === lid);
    if (!pos) return;
    pos.name        = card.querySelector(".ccp-pos-name")?.value?.trim() || pos.name;
    pos.type        = card.querySelector(".ccp-pos-type")?.value || pos.type;
    pos.description = card.querySelector(".ccp-pos-desc")?.value?.trim() || "";
    const qtyVal    = card.querySelector(".ccp-pos-qty")?.value;
    pos.quantity    = qtyVal !== "" && qtyVal != null ? Number(qtyVal) : "";
    card.querySelectorAll(".ccp-doc-row").forEach(row => {
      const dLid = Number(row.dataset.docLid);
      const doc  = pos.documents.find(d => d._lid === dLid);
      if (!doc) return;
      doc.name     = row.querySelector(".ccp-doc-name")?.value?.trim() || doc.name;
      doc.required = row.querySelector(".ccp-doc-req")?.checked !== false;
    });
  });
}

async function _savePosSettings() {
  await apiFetch(`/config/contracts/${state.cfgContractConfigId}/settings`, {
    method: "PUT",
    body: JSON.stringify({
      position_mode: "ambos",
      modules:   _readModulesFromDOM(),
      positions: _ccpSaved.map(p => ({
        name:        p.name,
        type:        p.type,
        description: p.description || "",
        quantity:    p.quantity !== "" && p.quantity != null ? Number(p.quantity) : null,
        documents:   (p.documents || []).map(d => ({ name: d.name, required: d.required })),
      })),
    }),
  });
}

function _readModulesFromDOM() {
  const modules = {};
  document.querySelectorAll(".ccp-module-toggle").forEach(chk => {
    modules[chk.dataset.moduleKey] = chk.checked;
  });
  return modules;
}

function _refreshPositionsList() {
  _syncPositionsFromDOM();
  const wrap = document.getElementById("ccpPositionsList");
  if (!wrap) return;
  wrap.innerHTML = _renderPositions(_ccpData);
}

function _buildPositionsTableHtml(positions, filter) {
  // Keep real index from _ccpSaved so action buttons always reference the right entry
  const entries = positions
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.name.trim() && (!filter || p.type === filter));

  if (!entries.length) {
    const msg = filter === "licitacion"
      ? "No hay cargos de Licitación guardados."
      : filter === "real"
        ? "No hay Cargos Operacionales guardados."
        : `Aún no hay cargos guardados. Usa "+ Agregar cargo" para comenzar.`;
    return `<p class="ccp-pos-empty">${msg}</p>`;
  }

  return `
    <table class="ccp-ptable">
      <thead>
        <tr>
          <th>Cargo</th>
          <th>Descripción</th>
          <th>Tipo</th>
          <th class="ccp-ptable-qty">Cantidad</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        ${entries.map(({ p, i }) => `
          <tr>
            <td class="ccp-ptable-name">${escapeHtml(p.name)}</td>
            <td class="ccp-ptable-desc">${escapeHtml(p.description || "—")}</td>
            <td><span class="ccp-ptable-type ccp-ptable-type-${escapeAttr(p.type)}">
              ${p.type === "licitacion" ? "Licitación" : "Real"}
            </span></td>
            <td class="ccp-ptable-qty">${p.quantity != null && p.quantity !== "" ? escapeHtml(String(p.quantity)) : "—"}</td>
            <td class="ccp-ptable-actions">
              <button type="button" class="ccp-ptbl-btn ccp-ptbl-edit" data-pi="${i}" aria-label="Editar cargo">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13.5 3.5l3 3L7 16H4v-3L13.5 3.5z"/>
                </svg>
                <span class="ccp-ptbl-tip">Editar cargo</span>
              </button>
              <button type="button" class="ccp-ptbl-btn ccp-ptbl-docs" data-pi="${i}" aria-label="Documentos requeridos">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 2H5a1 1 0 00-1 1v14a1 1 0 001 1h10a1 1 0 001-1V7l-5-5z"/>
                  <path d="M11 2v5h5M7 10h6M7 13h4"/>
                </svg>
                <span class="ccp-ptbl-tip">Documentos requeridos</span>
              </button>
              <button type="button" class="ccp-ptbl-btn ccp-ptbl-qty" data-pi="${i}" aria-label="Cantidad de personas">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM3 17a7 7 0 0114 0"/>
                  <path d="M16 11a3 3 0 000-6M19 17a5 5 0 00-3-4.6"/>
                </svg>
                <span class="ccp-ptbl-tip">Cantidad de personas</span>
              </button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function _refreshPositionsTable() {
  const wrap = document.getElementById("ccpPositionsTableView");
  if (!wrap) return;
  wrap.innerHTML = _buildPositionsTableHtml(_ccpSaved, _ccpPosFilter);

  // Sync active state on filter buttons
  document.querySelectorAll(".ccp-pos-filter-btn").forEach(btn => {
    btn.classList.toggle("ccp-pos-filter-active", btn.dataset.filter === _ccpPosFilter);
  });
}

// ── Helpers for users tab ────────────────────────────────────────────────────

function _renderRolePermissions(roleKey, rolePerms) {
  const rolePerm = (rolePerms && rolePerms[roleKey]) ? rolePerms[roleKey] : {};
  return `
    <table class="ccp-perms-table">
      <thead>
        <tr>
          <th class="ccp-perms-mod-col">Módulo</th>
          ${PERM_ACTIONS.map(a => `<th class="ccp-perms-action-col">${escapeHtml(a.label)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${SYSTEM_MODULES.map(mod => {
          const modPerms = Array.isArray(rolePerm[mod.key]) ? rolePerm[mod.key] : [];
          return `
            <tr>
              <td class="ccp-perms-mod-name">${escapeHtml(mod.label)}</td>
              ${PERM_ACTIONS.map(a => `
                <td class="ccp-perms-chk-cell">
                  <input type="checkbox" class="ccp-perm-chk"
                    data-role="${escapeAttr(roleKey)}"
                    data-mod="${escapeAttr(mod.key)}"
                    data-action="${escapeAttr(a.key)}"
                    ${modPerms.includes(a.key) ? "checked" : ""}>
                </td>`).join("")}
            </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

function _syncRolePermsFromDOM() {
  document.querySelectorAll(".ccp-perm-chk").forEach(chk => {
    const { role, mod, action } = chk.dataset;
    if (!role || !mod || !action) return;
    if (!_ccpRolePerms[role]) _ccpRolePerms[role] = {};
    if (!Array.isArray(_ccpRolePerms[role][mod])) _ccpRolePerms[role][mod] = [];
    const arr = _ccpRolePerms[role][mod];
    if (chk.checked && !arr.includes(action)) arr.push(action);
    if (!chk.checked) _ccpRolePerms[role][mod] = arr.filter(a => a !== action);
  });
}

function _renderUsersTable(users) {
  const roleLabels = Object.fromEntries(_ccpRoles.map(r => [r.key, r.label]));
  if (!users.length) {
    return `<div class="ccp-pos-empty">No hay usuarios registrados para este contrato. Haz clic en "+ Nuevo usuario" para comenzar.</div>`;
  }
  return `
    <table class="ccp-users-table">
      <thead>
        <tr>
          <th>Nombre completo</th>
          <th>Usuario</th>
          <th>Cargo / Rol</th>
          <th>Municipios</th>
          <th>Estado</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${users.map(u => {
          const munIds = Array.isArray(u.municipality_ids) ? u.municipality_ids : [];
          const munBadge = munIds.length
            ? `<span class="ccp-mun-badge">${munIds.length} municipio${munIds.length !== 1 ? "s" : ""}</span>`
            : `<span class="ccp-mun-badge ccp-mun-badge-empty">Sin asignar</span>`;
          return `
          <tr>
            <td>${escapeHtml(u.full_name)}</td>
            <td><code class="ccp-user-code">${escapeHtml(u.username)}</code></td>
            <td>${escapeHtml(roleLabels[u.role_code] || u.role_code || "—")}</td>
            <td>${munBadge}</td>
            <td>${statusBadge(u.active)}</td>
            <td class="ccp-users-actions">
              <button type="button" class="ccp-user-edit-btn"
                data-uid="${escapeAttr(String(u.id))}"
                data-name="${escapeAttr(u.full_name)}"
                data-username="${escapeAttr(u.username)}"
                data-role="${escapeAttr(u.role_code || "")}">✏ Editar</button>
              <button type="button" class="ccp-user-mun-btn"
                data-uid="${escapeAttr(String(u.id))}"
                data-name="${escapeAttr(u.full_name)}">🗺 Municipios</button>
              ${u.active ? `<button type="button" class="ccp-user-deact-btn" data-uid="${escapeAttr(String(u.id))}">⊘ Desactivar</button>` : ""}
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

async function _loadUsersTab(contractId) {
  const wrap = document.getElementById("ccpUsersTableWrap");
  if (!wrap) return;
  try {
    const r = await apiFetch(`/config/contracts/${contractId}/users`);
    const users = Array.isArray(r.data) ? r.data : [];
    wrap.innerHTML = _renderUsersTable(users);
    _wireUsersTableEvents(contractId);
  } catch (e) {
    wrap.innerHTML = `<div class="cfg-error">${escapeHtml(e.message)}</div>`;
  }
}

function _wireUsersTableEvents(contractId) {
  const wrap = document.getElementById("ccpUsersTableWrap");
  if (!wrap) return;
  wrap.querySelectorAll(".ccp-user-edit-btn").forEach(btn => {
    btn.addEventListener("click", () => openUserModal({
      contractId,
      id:       Number(btn.dataset.uid),
      name:     btn.dataset.name,
      username: btn.dataset.username,
      role:     btn.dataset.role,
    }));
  });
  wrap.querySelectorAll(".ccp-user-mun-btn").forEach(btn => {
    btn.addEventListener("click", () => openUserMunicipalitiesModal({
      contractId,
      userId:   Number(btn.dataset.uid),
      userName: btn.dataset.name,
    }));
  });
  wrap.querySelectorAll(".ccp-user-deact-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await apiFetch(`/config/users/${btn.dataset.uid}`, { method: "DELETE" });
        showSuccess("Usuario desactivado.");
        await _loadUsersTab(contractId);
      } catch (e) {
        showError(e.message || "No fue posible desactivar el usuario.");
        btn.disabled = false;
      }
    });
  });
}

function openUserModal({ contractId, id = null, name = "", username = "", role = "" } = {}) {
  document.getElementById("ccpUserModal")?.remove();
  const isEdit = Boolean(id);
  const modal  = document.createElement("div");
  modal.id     = "ccpUserModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card cfg-modal-card">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">👤</span>
          <div>
            <h3 style="margin:0;font-size:15px;font-weight:800;color:#0f172a">
              ${isEdit ? "Editar usuario" : "Nuevo usuario"}
            </h3>
            <p style="margin:2px 0 0;font-size:12px;color:#64748b">
              ${isEdit ? "Modifica los datos del usuario" : "Crear acceso para este contrato"}
            </p>
          </div>
        </div>
        <button type="button" class="modal-close" id="ccpUserClose">&#x2715;</button>
      </div>
      <div class="modal-body" style="display:grid;gap:14px;padding:20px 24px">
        <label class="cfg-field">
          <span>Nombre completo <em>*</em></span>
          <input id="ccpUModalName" type="text" value="${escapeAttr(name)}" maxlength="200" placeholder="Ej: Juan García">
        </label>
        <label class="cfg-field">
          <span>Nombre de usuario <em>*</em></span>
          <input id="ccpUModalUsername" type="text" value="${escapeAttr(username)}" maxlength="100" placeholder="Ej: jgarcia">
        </label>
        <label class="cfg-field">
          <span>Contraseña ${isEdit ? "<small>— dejar vacío para no cambiar</small>" : "<em>*</em>"}</span>
          <input id="ccpUModalPassword" type="password" maxlength="100"
            placeholder="${isEdit ? "Nueva contraseña (opcional)" : "Contraseña de acceso"}">
        </label>
        <label class="cfg-field">
          <span>Rol del sistema <em>*</em></span>
          <select id="ccpUModalRole">
            <option value="">— Selecciona un rol —</option>
            <option value="administrador"      ${role === "administrador"      ? "selected" : ""}>Administrador</option>
            <option value="talento_humano"     ${role === "talento_humano"     ? "selected" : ""}>Talento Humano</option>
            <option value="operacion"          ${role === "operacion"          ? "selected" : ""}>Operación</option>
            <option value="calidad"            ${role === "calidad"            ? "selected" : ""}>Calidad</option>
            <option value="auditor"            ${role === "auditor"            ? "selected" : ""}>Auditor / Interventoría</option>
            <option value="empleado"           ${role === "empleado"           ? "selected" : ""}>Empleado</option>
            <option value="gestores_auxiliares"${role === "gestores_auxiliares"? "selected" : ""}>Gestores / Auxiliares</option>
            <option value="interventoria"      ${role === "interventoria"      ? "selected" : ""}>Interventoría</option>
          </select>
        </label>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="ccpUModalSave" style="flex:1;justify-content:center">
          ${isEdit ? "Guardar cambios" : "Crear usuario"}
        </button>
        <button type="button" class="btn btn-secondary" id="ccpUModalCancel">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById("ccpUserClose").addEventListener("click", close);
  document.getElementById("ccpUModalCancel").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  document.getElementById("ccpUModalSave").addEventListener("click", async () => {
    const nameVal     = document.getElementById("ccpUModalName")?.value?.trim()     || "";
    const usernameVal = document.getElementById("ccpUModalUsername")?.value?.trim() || "";
    const passwordVal = document.getElementById("ccpUModalPassword")?.value         || "";
    const roleVal     = document.getElementById("ccpUModalRole")?.value             || "";
    if (!nameVal || !usernameVal || !roleVal || (!isEdit && !passwordVal)) {
      showError("Completa todos los campos obligatorios.");
      return;
    }
    const btn = document.getElementById("ccpUModalSave");
    btn.disabled = true; btn.textContent = isEdit ? "Guardando…" : "Creando…";
    try {
      if (isEdit) {
        const payload = { name: nameVal, username: usernameVal, role: roleVal };
        if (passwordVal) payload.password = passwordVal;
        await apiFetch(`/config/users/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await apiFetch(`/config/contracts/${contractId}/users`, {
          method: "POST",
          body: JSON.stringify({ name: nameVal, username: usernameVal, password: passwordVal, role: roleVal }),
        });
      }
      showSuccess(isEdit ? "Usuario actualizado." : "Usuario creado.");
      close();
      await _loadUsersTab(contractId);
    } catch (e) {
      showError(e.message || "No fue posible guardar.");
      btn.disabled = false; btn.textContent = isEdit ? "Guardar cambios" : "Crear usuario";
    }
  });
}

// ── User municipalities modal ─────────────────────────────────────────────────

async function openUserMunicipalitiesModal({ contractId, userId, userName }) {
  document.getElementById("ccpMunModal")?.remove();

  const modal = document.createElement("div");
  modal.id    = "ccpMunModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card cfg-modal-card ccp-mun-modal-card">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">🗺</span>
          <div>
            <h3 style="margin:0;font-size:15px;font-weight:800;color:#0f172a">Municipios asignados</h3>
            <p style="margin:2px 0 0;font-size:12px;color:#64748b">${escapeHtml(userName)}</p>
          </div>
        </div>
        <button type="button" class="modal-close" id="ccpMunClose">&#x2715;</button>
      </div>
      <div class="modal-body" style="padding:16px 24px 0">
        <div class="ccp-mun-toolbar">
          <input id="ccpMunSearch" type="text" class="cfg-search-input" placeholder="Buscar municipio…" style="max-width:260px">
          <div class="ccp-mun-sel-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="ccpMunSelAll">Seleccionar todos</button>
            <button type="button" class="btn btn-secondary btn-sm" id="ccpMunSelNone">Limpiar</button>
          </div>
        </div>
        <div id="ccpMunCount" class="ccp-mun-count">Cargando…</div>
        <div id="ccpMunList" class="ccp-mun-list">
          <div class="ccp-loading-row">Cargando municipios…</div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="ccpMunSave" style="flex:1;justify-content:center">Guardar asignación</button>
        <button type="button" class="btn btn-secondary" id="ccpMunCancel">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById("ccpMunClose").addEventListener("click", close);
  document.getElementById("ccpMunCancel").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  let allMunicipalities = [];
  let assignedIds       = new Set();
  let takenByOther      = {};   // { [municipalityId]: full_name }

  const updateCount = () => {
    const count = document.getElementById("ccpMunCount");
    if (count) count.textContent = `${assignedIds.size} municipio${assignedIds.size !== 1 ? "s" : ""} seleccionado${assignedIds.size !== 1 ? "s" : ""}`;
  };

  const renderList = (filter = "") => {
    const listEl = document.getElementById("ccpMunList");
    if (!listEl) return;
    const lc = filter.toLowerCase();
    const visible = lc
      ? allMunicipalities.filter(m => m.name.toLowerCase().includes(lc))
      : allMunicipalities;
    if (!visible.length) {
      listEl.innerHTML = `<p class="ccp-mun-empty">No se encontraron municipios.</p>`;
      return;
    }
    listEl.innerHTML = visible.map(m => {
      const owner   = takenByOther[m.id];
      const checked = assignedIds.has(m.id);
      if (owner) {
        return `
          <label class="ccp-mun-row ccp-mun-row-taken" title="Asignado a ${escapeHtml(owner)}">
            <input type="checkbox" class="ccp-mun-chk" value="${m.id}" disabled checked>
            <span class="ccp-mun-name">${escapeHtml(m.name)}</span>
            <span class="ccp-mun-owner">Asignado a ${escapeHtml(owner)}</span>
          </label>`;
      }
      return `
        <label class="ccp-mun-row ${checked ? "ccp-mun-row-checked" : ""}">
          <input type="checkbox" class="ccp-mun-chk" value="${m.id}" ${checked ? "checked" : ""}>
          <span class="ccp-mun-name">${escapeHtml(m.name)}</span>
        </label>`;
    }).join("");

    listEl.querySelectorAll(".ccp-mun-chk:not([disabled])").forEach(chk => {
      chk.addEventListener("change", () => {
        const id = Number(chk.value);
        if (chk.checked) { assignedIds.add(id); chk.closest(".ccp-mun-row")?.classList.add("ccp-mun-row-checked"); }
        else             { assignedIds.delete(id); chk.closest(".ccp-mun-row")?.classList.remove("ccp-mun-row-checked"); }
        updateCount();
      });
    });
  };

  try {
    const [munRes, assignedRes, assignmentsRes] = await Promise.all([
      apiFetch("/config/municipalities"),
      apiFetch(`/config/users/${userId}/municipalities`),
      apiFetch(`/config/contracts/${contractId}/municipality-assignments`),
    ]);
    allMunicipalities = Array.isArray(munRes.data) ? munRes.data : [];
    const rawIds      = Array.isArray(assignedRes.data) ? assignedRes.data : [];
    assignedIds       = new Set(rawIds.map(Number));

    // Build takenByOther: municipios asignados a OTROS usuarios del mismo contrato
    const allAssignments = (assignmentsRes.data && typeof assignmentsRes.data === "object")
      ? assignmentsRes.data : {};
    takenByOther = {};
    for (const [munId, info] of Object.entries(allAssignments)) {
      if (Number(info.user_id) !== userId) {
        takenByOther[Number(munId)] = info.full_name;
      }
    }

    renderList();
    updateCount();
  } catch (e) {
    document.getElementById("ccpMunList").innerHTML =
      `<p style="color:red;padding:12px">${escapeHtml(e.message)}</p>`;
  }

  document.getElementById("ccpMunSearch").addEventListener("input", e => {
    renderList(e.target.value);
  });

  document.getElementById("ccpMunSelAll").addEventListener("click", () => {
    const filter = document.getElementById("ccpMunSearch")?.value?.toLowerCase() || "";
    const visible = filter
      ? allMunicipalities.filter(m => m.name.toLowerCase().includes(filter))
      : allMunicipalities;
    visible.filter(m => !takenByOther[m.id]).forEach(m => assignedIds.add(m.id));
    renderList(filter);
    updateCount();
  });

  document.getElementById("ccpMunSelNone").addEventListener("click", () => {
    const filter = document.getElementById("ccpMunSearch")?.value?.toLowerCase() || "";
    const visible = filter
      ? allMunicipalities.filter(m => m.name.toLowerCase().includes(filter))
      : allMunicipalities;
    visible.filter(m => !takenByOther[m.id]).forEach(m => assignedIds.delete(m.id));
    renderList(filter);
    updateCount();
  });

  document.getElementById("ccpMunSave").addEventListener("click", async () => {
    const btn = document.getElementById("ccpMunSave");
    btn.disabled = true; btn.textContent = "Guardando…";
    try {
      await apiFetch(`/config/users/${userId}/municipalities`, {
        method: "PUT",
        body:   JSON.stringify({ municipality_ids: [...assignedIds] }),
      });
      showSuccess("Municipios asignados correctamente.");
      close();
      await _loadUsersTab(contractId);
    } catch (e) {
      showError(e.message || "No fue posible guardar la asignación.");
      btn.disabled = false; btn.textContent = "Guardar asignación";
    }
  });
}

// ── Table action modals ───────────────────────────────────────────────────────

function _openAddPosModal() {
  document.getElementById("ccpAddPosModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "ccpAddPosModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card cfg-modal-card ccp-add-pos-modal">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">➕</span>
          <div>
            <h3 style="margin:0;font-size:15px;font-weight:800;color:#0f172a">Agregar cargo</h3>
            <p style="margin:4px 0 0;font-size:12px;color:#64748b">Nuevo cargo para este contrato</p>
          </div>
        </div>
        <button type="button" class="modal-close" id="ccpAPClose">&#x2715;</button>
      </div>
      <div class="modal-body" style="display:grid;gap:16px;padding:24px 28px">
        <label class="cfg-field">
          <span>Nombre del cargo <em>*</em></span>
          <input id="ccpAPName" type="text" placeholder="Ej: Coordinador Pedagógico" maxlength="200">
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <label class="cfg-field">
            <span>Tipo de cargo <em>*</em></span>
            <select id="ccpAPType">
              <option value="licitacion">Cargo de Licitación</option>
              <option value="real">Cargo Real</option>
            </select>
          </label>
          <label class="cfg-field">
            <span>Cantidad requerida</span>
            <input id="ccpAPQty" type="number" min="1" placeholder="Ej: 12">
          </label>
        </div>
        <div id="ccpAPDescWrap">
          <label class="cfg-field">
            <span>Descripción del cargo</span>
            <textarea id="ccpAPDesc" rows="8" placeholder="Funciones y responsabilidades del cargo…"
              style="width:100%;border:1px solid #dbe3ef;border-radius:8px;padding:10px 12px;font:inherit;font-size:13px;resize:vertical;line-height:1.6"></textarea>
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="ccpAPSave" style="flex:1;justify-content:center">Guardar cargo</button>
        <button type="button" class="btn btn-secondary" id="ccpAPCancel">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // Mostrar/ocultar descripción según tipo seleccionado
  document.getElementById("ccpAPType").addEventListener("change", e => {
    document.getElementById("ccpAPDescWrap").style.display =
      e.target.value === "licitacion" ? "" : "none";
  });

  // Pegar como texto plano: sin saltos de línea, sin tabulaciones, sin espacios múltiples
  modal.querySelectorAll("input[type=text], textarea").forEach(el => {
    el.addEventListener("paste", e => {
      e.preventDefault();
      const raw  = (e.clipboardData || window.clipboardData).getData("text/plain");
      const clean = raw
        .replace(/[\r\n\t ]+/g, " ")  // saltos de línea y tabs → espacio
        .replace(/\s{2,}/g, " ")            // espacios múltiples → uno solo
        .trim();
      const start = el.selectionStart ?? el.value.length;
      const end   = el.selectionEnd   ?? el.value.length;
      el.value = el.value.slice(0, start) + clean + el.value.slice(end);
      const pos = start + clean.length;
      el.setSelectionRange(pos, pos);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  const close = () => modal.remove();
  document.getElementById("ccpAPClose").addEventListener("click", close);
  document.getElementById("ccpAPCancel").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  document.getElementById("ccpAPSave").addEventListener("click", async () => {
    const name = document.getElementById("ccpAPName")?.value?.trim() || "";
    if (!name) { document.getElementById("ccpAPName").focus(); return; }
    const type = document.getElementById("ccpAPType")?.value || "licitacion";
    const qty  = document.getElementById("ccpAPQty")?.value;
    const desc = type === "licitacion" ? (document.getElementById("ccpAPDesc")?.value?.trim() || "") : "";
    const btn  = document.getElementById("ccpAPSave");
    btn.disabled = true; btn.textContent = "Guardando…";

    _ccpSaved.push({
      name, type,
      description: desc,
      quantity:    qty !== "" && qty != null ? Number(qty) : null,
      documents:   [],
    });

    try {
      await _savePosSettings();
      showSuccess("Cargo agregado correctamente.");
      _refreshPositionsTable();
      close();
    } catch (e) {
      _ccpSaved.pop();
      showError(e.message || "No fue posible guardar el cargo.");
      btn.disabled = false; btn.textContent = "Guardar cargo";
    }
  });
}

function _openPosEditModal(idx) {
  const pos = _ccpSaved[idx];
  if (!pos) return;
  document.getElementById("ccpPosEditModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "ccpPosEditModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card cfg-modal-card ccp-add-pos-modal">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">✏</span>
          <div>
            <h3 style="margin:0;font-size:15px;font-weight:800;color:#0f172a">Editar cargo</h3>
            <p style="margin:2px 0 0;font-size:12px;color:#64748b">${escapeHtml(pos.name)}</p>
          </div>
        </div>
        <button type="button" class="modal-close" id="ccpPosEditClose">&#x2715;</button>
      </div>
      <div class="modal-body" style="display:grid;gap:14px;padding:20px 24px">
        <label class="cfg-field">
          <span>Nombre del cargo <em>*</em></span>
          <input id="ccpPEName" type="text" value="${escapeAttr(pos.name)}" maxlength="200">
        </label>
        <label class="cfg-field">
          <span>Cantidad requerida</span>
          <input id="ccpPEQty" type="number" min="1" value="${escapeAttr(String(pos.quantity ?? ""))}" placeholder="Ej: 12">
        </label>
        ${pos.type === "licitacion" ? `
        <label class="cfg-field">
          <span>Descripción del cargo</span>
          <textarea id="ccpPEDesc" rows="8" style="width:100%;border:1px solid #dbe3ef;border-radius:8px;padding:10px 12px;font:inherit;font-size:13px;resize:vertical;line-height:1.6">${escapeHtml(pos.description || "")}</textarea>
        </label>` : ""}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="ccpPEModalSave" style="flex:1;justify-content:center">Guardar cambios</button>
        <button type="button" class="btn btn-secondary" id="ccpPEModalCancel">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById("ccpPosEditClose").addEventListener("click", close);
  document.getElementById("ccpPEModalCancel").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  modal.querySelectorAll("input[type=text], textarea").forEach(el => {
    el.addEventListener("paste", e => {
      e.preventDefault();
      const raw   = (e.clipboardData || window.clipboardData).getData("text/plain");
      const clean = raw.replace(/[\r\n\t ]+/g, " ").replace(/\s{2,}/g, " ").trim();
      const start = el.selectionStart ?? el.value.length;
      const end   = el.selectionEnd   ?? el.value.length;
      el.value = el.value.slice(0, start) + clean + el.value.slice(end);
      const pos = start + clean.length;
      el.setSelectionRange(pos, pos);
    });
  });

  document.getElementById("ccpPEModalSave").addEventListener("click", async () => {
    const name = document.getElementById("ccpPEName")?.value?.trim() || "";
    if (!name) { document.getElementById("ccpPEName").focus(); return; }
    const btn = document.getElementById("ccpPEModalSave");
    btn.disabled = true; btn.textContent = "Guardando…";
    const qty = document.getElementById("ccpPEQty")?.value;
    _ccpSaved[idx].name        = name;
    _ccpSaved[idx].quantity    = qty !== "" && qty != null ? Number(qty) : null;
    _ccpSaved[idx].description = document.getElementById("ccpPEDesc")?.value?.trim() || "";
    try {
      await _savePosSettings();
      showSuccess("Cargo actualizado.");
      _refreshPositionsTable();
      close();
    } catch (e) {
      showError(e.message || "No fue posible guardar.");
      btn.disabled = false; btn.textContent = "Guardar cambios";
    }
  });
}

function _openPosDocsModal(idx) {
  const pos = _ccpSaved[idx];
  if (!pos) return;
  document.getElementById("ccpPosDocsModal")?.remove();

  let localDocs = (Array.isArray(pos.documents) ? pos.documents : []).map(d => ({ ...d }));

  const isAdded  = name => localDocs.some(d => d.name === name);

  const renderCatalog = () => DOC_CATALOG.map((name, ci) => {
    const added = isAdded(name);
    return `<div class="ccp-cat-row ${added ? "ccp-cat-row-added" : ""}" data-ci="${ci}">
      <span class="ccp-cat-name">${escapeHtml(name)}</span>
      <button type="button" class="ccp-cat-btn ${added ? "ccp-cat-btn-added" : ""}"
        data-ci="${ci}" ${added ? "disabled" : ""}>
        ${added ? "✓ Añadido" : "+ Añadir"}
      </button>
    </div>`;
  }).join("");

  const renderDocRows = () => localDocs.length
    ? localDocs.map((d, di) => `
        <div class="ccp-pdoc-row" data-di="${di}">
          <span class="ccp-pdoc-name">${escapeHtml(d.name)}</span>
          <label class="ccp-pdoc-req-toggle">
            <input type="checkbox" class="ccp-pdoc-req-chk" data-di="${di}" ${d.required ? "checked" : ""}>
            <span class="ccp-pdoc-req ${d.required ? "ccp-pdoc-req-yes" : "ccp-pdoc-req-no"}">
              ${d.required ? "Obligatorio" : "Opcional"}
            </span>
          </label>
          <button type="button" class="ccp-pdoc-del" data-di="${di}">✕</button>
        </div>`).join("")
    : `<p class="ccp-pos-empty" style="margin:0">Ningún documento añadido aún.</p>`;

  const modal = document.createElement("div");
  modal.id = "ccpPosDocsModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card cfg-modal-card ccp-add-pos-modal">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">📋</span>
          <div>
            <h3 style="margin:0;font-size:15px;font-weight:800;color:#0f172a">Documentos requeridos</h3>
            <p style="margin:2px 0 0;font-size:12px;color:#64748b">${escapeHtml(pos.name)}</p>
          </div>
        </div>
        <button type="button" class="modal-close" id="ccpPosDocsClose">&#x2715;</button>
      </div>
      <div class="modal-body ccp-docs-body">

        <!-- Catálogo predeterminado -->
        <div class="ccp-docs-section">
          <div class="ccp-docs-section-title">Documentos predeterminados — haz clic en Añadir para incluirlos</div>
          <div id="ccpPDCatalog" class="ccp-catalog-list">${renderCatalog()}</div>
        </div>

        <!-- Documentos del cargo -->
        <div class="ccp-docs-section">
          <div class="ccp-docs-section-title">Documentos de este cargo</div>
          <div id="ccpPDList">${renderDocRows()}</div>
          <div class="ccp-pdoc-custom-row">
            <input id="ccpPDNewName" type="text" placeholder="Añadir documento personalizado…">
            <label style="display:flex;align-items:center;gap:5px;font-size:12.5px;white-space:nowrap">
              <input type="checkbox" id="ccpPDNewReq" checked> Obligatorio
            </label>
            <button type="button" class="btn btn-secondary" id="ccpPDAddBtn">+ Añadir</button>
          </div>
        </div>

      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="ccpPDSave" style="flex:1;justify-content:center">Guardar documentos</button>
        <button type="button" class="btn btn-secondary" id="ccpPDCancel">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const refreshCatalog = () => {
    document.getElementById("ccpPDCatalog").innerHTML = renderCatalog();
    document.querySelectorAll(".ccp-cat-btn:not([disabled])").forEach(btn => {
      btn.addEventListener("click", () => {
        localDocs.push({ name: DOC_CATALOG[Number(btn.dataset.ci)], required: true });
        refreshCatalog();
        refreshDocs();
      });
    });
  };

  const refreshDocs = () => {
    document.getElementById("ccpPDList").innerHTML = renderDocRows();
    document.querySelectorAll(".ccp-pdoc-del").forEach(btn => {
      btn.addEventListener("click", () => {
        localDocs.splice(Number(btn.dataset.di), 1);
        refreshCatalog();
        refreshDocs();
      });
    });
    document.querySelectorAll(".ccp-pdoc-req-chk").forEach(chk => {
      chk.addEventListener("change", () => {
        const di = Number(chk.dataset.di);
        localDocs[di].required = chk.checked;
        const badge = chk.closest(".ccp-pdoc-req-toggle")?.querySelector(".ccp-pdoc-req");
        if (badge) {
          badge.textContent  = chk.checked ? "Obligatorio" : "Opcional";
          badge.className    = `ccp-pdoc-req ${chk.checked ? "ccp-pdoc-req-yes" : "ccp-pdoc-req-no"}`;
        }
      });
    });
  };

  refreshCatalog();

  const pdNewName = document.getElementById("ccpPDNewName");
  pdNewName?.addEventListener("paste", e => {
    e.preventDefault();
    const raw   = (e.clipboardData || window.clipboardData).getData("text/plain");
    const clean = raw.replace(/[\r\n\t ]+/g, " ").replace(/\s{2,}/g, " ").trim();
    const start = pdNewName.selectionStart ?? pdNewName.value.length;
    const end   = pdNewName.selectionEnd   ?? pdNewName.value.length;
    pdNewName.value = pdNewName.value.slice(0, start) + clean + pdNewName.value.slice(end);
    const pos = start + clean.length;
    pdNewName.setSelectionRange(pos, pos);
  });

  document.getElementById("ccpPDAddBtn").addEventListener("click", () => {
    const name = pdNewName?.value?.trim();
    if (!name) return;
    localDocs.push({ name, required: document.getElementById("ccpPDNewReq")?.checked !== false });
    pdNewName.value = "";
    refreshCatalog();
    refreshDocs();
  });

  const close = () => modal.remove();
  document.getElementById("ccpPosDocsClose").addEventListener("click", close);
  document.getElementById("ccpPDCancel").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  document.getElementById("ccpPDSave").addEventListener("click", async () => {
    const btn = document.getElementById("ccpPDSave");
    btn.disabled = true; btn.textContent = "Guardando…";
    _ccpSaved[idx].documents = localDocs;
    try {
      await _savePosSettings();
      showSuccess("Documentos actualizados.");
      _refreshPositionsTable();
      close();
    } catch (e) {
      showError(e.message || "No fue posible guardar.");
      btn.disabled = false; btn.textContent = "Guardar documentos";
    }
  });
}

function _openPosQtyModal(idx) {
  const pos = _ccpSaved[idx];
  if (!pos) return;
  document.getElementById("ccpPosQtyModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "ccpPosQtyModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card cfg-modal-card ccp-add-pos-modal">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">👥</span>
          <div>
            <h3 style="margin:0;font-size:15px;font-weight:800;color:#0f172a">Cantidad de personas</h3>
            <p style="margin:2px 0 0;font-size:12px;color:#64748b">${escapeHtml(pos.name)}</p>
          </div>
        </div>
        <button type="button" class="modal-close" id="ccpPosQtyClose">&#x2715;</button>
      </div>
      <div class="modal-body ccp-qty-body">
        <label class="cfg-field">
          <span>Cantidad requerida para este cargo</span>
          <input id="ccpPQtyVal" type="number" min="1"
            value="${escapeAttr(String(pos.quantity ?? ""))}"
            placeholder="Ej: 12"
            style="font-size:22px;font-weight:800;text-align:center;height:54px">
        </label>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="ccpPQtySave" style="flex:1;justify-content:center">Guardar cantidad</button>
        <button type="button" class="btn btn-secondary" id="ccpPQtyCancel">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById("ccpPosQtyClose").addEventListener("click", close);
  document.getElementById("ccpPQtyCancel").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  document.getElementById("ccpPQtySave").addEventListener("click", async () => {
    const val = document.getElementById("ccpPQtyVal")?.value;
    const btn = document.getElementById("ccpPQtySave");
    btn.disabled = true; btn.textContent = "Guardando…";
    _ccpSaved[idx].quantity = val !== "" && val != null ? Number(val) : null;
    try {
      await _savePosSettings();
      showSuccess("Cantidad actualizada.");
      _refreshPositionsTable();
      close();
    } catch (e) {
      showError(e.message || "No fue posible guardar.");
      btn.disabled = false; btn.textContent = "Guardar cantidad";
    }
  });
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function loadConfigModule(submoduleKey) {
  if (submoduleKey === "clientes") return loadClientesModule();
  return `<div class="cfg-placeholder"><p>Submódulo <strong>${escapeHtml(submoduleKey)}</strong> en construcción.</p></div>`;
}
