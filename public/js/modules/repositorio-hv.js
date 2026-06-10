"use strict";

import { apiFetch } from '../api.js';
import { escapeHtml, escapeAttr } from '../utils.js';
import { openDocViewer } from '../doc-viewer.js';

// ─── Module state (reset on each load) ───────────────────────────────────────
let _employees   = [];
let _totalServer = 0;
let _currentPage = 1;
let _hasMore     = false;
let _searchTerm  = "";
let _hvFilter    = "";
let _docsCache   = new Map();
let _searchTimer = null;

const PAGE_SIZE = 50;

// ─── Config maps ──────────────────────────────────────────────────────────────

const DOC_STATUS_CFG = {
  cargado:   { label: "Cargado",   chip: "warning" },
  uploaded:  { label: "Cargado",   chip: "warning" },
  aprobado:  { label: "Aprobado",  chip: "success" },
  rechazado: { label: "Rechazado", chip: "danger"  },
  vencido:   { label: "Vencido",   chip: "warning" },
  pendiente: { label: "Pendiente", chip: "neutral" },
};

// Keys match exact DB values (raw, not lowercased)
const HV_CHIP_CFG = {
  "Completa":           { label: "Completa",    chip: "success" },
  "Incompleta":         { label: "Incompleta",  chip: "neutral" },
  "En revisión":        { label: "En revisión", chip: "warning" },
  "No apto documental": { label: "No apto",     chip: "danger"  },
};

const HV_SPINE_CFG = {
  "Completa":           "rhv-spine-completa",
  "Incompleta":         "rhv-spine-incompleta",
  "En revisión":        "rhv-spine-revision",
  "No apto documental": "rhv-spine-noApto",
};

// ─── Render helpers ───────────────────────────────────────────────────────────

function hvChip(hvStatus) {
  const s = HV_CHIP_CFG[hvStatus] || { label: hvStatus || "—", chip: "neutral" };
  return `<span class="status-chip ${s.chip}">${escapeHtml(s.label)}</span>`;
}

function spineClass(hvStatus) {
  return HV_SPINE_CFG[hvStatus] || "";
}

function docStatusChip(status) {
  const key = (status || "").toLowerCase();
  const s   = DOC_STATUS_CFG[key] || { label: status || "—", chip: "neutral" };
  return `<span class="status-chip ${s.chip}">${escapeHtml(s.label)}</span>`;
}

function renderDocsPanel(docs, empId) {
  if (!docs.length) {
    return `<div style="padding:14px 16px;color:#64748b;font-size:13px">Sin documentos cargados</div>`;
  }

  const rows = docs.map(function(doc) {
    const docStatus = (doc.status || "cargado").toLowerCase();
    const typeName  = doc.document_type_name || doc.documentTypeName || "—";
    const filename  = doc.original_filename  || doc.originalFileName  || doc.stored_filename || doc.file_name || "—";
    const uploadAt  = doc.uploaded_at        || doc.uploadedAt        || "—";
    const expDate   = doc.expiration_date    || doc.expirationDate    || "N/A";
    const docId     = escapeAttr(String(doc.id));
    const eId       = escapeAttr(String(empId));

    const viewBtn = `<button type="button" class="btn btn-secondary btn-row"
      data-rhv-action="view" data-doc-id="${docId}" data-doc-name="${escapeAttr(typeName)}">Ver</button>`;

    const actions = (docStatus === "cargado" || docStatus === "uploaded")
      ? `${viewBtn}
         <button type="button" class="btn btn-success btn-row"
           data-rhv-action="validate" data-doc-id="${docId}" data-emp-id="${eId}">✅ Validar</button>
         <button type="button" class="btn btn-danger btn-row"
           data-rhv-action="reject" data-doc-id="${docId}" data-emp-id="${eId}">❌ Rechazar</button>`
      : viewBtn;

    return `
      <div class="rhv-doc-row document-item" data-doc-id="${docId}">
        <div style="font-size:13px">${escapeHtml(typeName)}</div>
        <div style="font-size:11px;color:#64748b">${escapeHtml(filename)}</div>
        <div>${docStatusChip(docStatus)}</div>
        <div style="font-size:12px">${escapeHtml(uploadAt)}</div>
        <div style="font-size:12px">${escapeHtml(expDate)}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">${actions}</div>
      </div>`;
  }).join("");

  return `
    <div>
      <div class="rhv-docs-header">
        <div>Tipo de documento</div>
        <div>Archivo</div>
        <div>Estado</div>
        <div>Expedición</div>
        <div>Vencimiento</div>
        <div>Aprobación</div>
      </div>
      ${rows}
    </div>`;
}

async function reloadDocsPanel(empId) {
  const panel = document.getElementById(`rhv-docs-${empId}`);
  if (!panel) return;
  panel.innerHTML = `<div style="padding:14px 16px;color:#64748b;font-size:13px">Cargando…</div>`;
  try {
    const res  = await apiFetch(`/documents/employee/${encodeURIComponent(empId)}`);
    const docs = Array.isArray(res.data) ? res.data : [];
    _docsCache.set(String(empId), docs);
    panel.innerHTML = renderDocsPanel(docs, empId);
  } catch {
    panel.innerHTML = `<div style="padding:14px 16px;color:#dc2626;font-size:13px">Error cargando documentos.</div>`;
  }
}

function renderBook(emp) {
  const empId    = String(emp.id);
  const name     = emp.fullName || emp.name || "Sin nombre";
  const initials = (name[0] || "?").toUpperCase();
  const cargo    = emp.position || emp.cargo || emp.role || "—";
  const mun      = emp.municipality || emp.municipalityName || emp.municipio || "";
  const docCount = emp.documentTotal || 0;
  const hvStatus = emp.hvStatus || "Incompleta";

  return `
    <div class="rhv-book-item" data-rhv-emp-id="${escapeAttr(empId)}">
      <div class="rhv-book-spine ${spineClass(hvStatus)}"></div>
      <div class="rhv-book-body">
        <div class="rhv-book-cover" data-rhv-toggle="${escapeAttr(empId)}">
          <div class="rhv-book-info">
            <div class="rhv-book-avatar">${escapeHtml(initials)}</div>
            <div>
              <span class="rhv-book-name">${escapeHtml(name)}</span>
              <span class="rhv-book-sub">${escapeHtml(cargo)}${mun ? ` · ${escapeHtml(mun)}` : ""}</span>
            </div>
          </div>
          <div class="rhv-book-meta">
            ${hvChip(hvStatus)}
            <span style="font-size:12px;color:#94a3b8;white-space:nowrap">${docCount} doc${docCount !== 1 ? "s" : ""}</span>
            <span class="rhv-chevron">▶</span>
          </div>
        </div>
        <div class="rhv-book-pages" id="rhv-docs-${escapeAttr(empId)}" style="display:none"></div>
      </div>
    </div>`;
}

function renderBooksHtml(employees) {
  if (!employees.length) {
    return `<div style="padding:32px;text-align:center;color:#64748b;font-size:14px">No se encontraron empleados.</div>`;
  }
  return employees.map(renderBook).join("");
}

function renderStatCards(stats) {
  return `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;text-align:center">
      <div id="rhv-stat-completa" style="font-size:20px;font-weight:700;color:#15803d">${stats.completa}</div>
      <div style="font-size:11px;font-weight:600;color:#166534;margin-top:2px">HV Completa</div>
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center">
      <div id="rhv-stat-incompleta" style="font-size:20px;font-weight:700;color:#64748b">${stats.incompleta}</div>
      <div style="font-size:11px;font-weight:600;color:#475569;margin-top:2px">Sin documentos</div>
    </div>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px;text-align:center">
      <div id="rhv-stat-revision" style="font-size:20px;font-weight:700;color:#2563eb">${stats.revision}</div>
      <div style="font-size:11px;font-weight:600;color:#1e40af;margin-top:2px">En revisión</div>
    </div>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px;text-align:center">
      <div id="rhv-stat-noApto" style="font-size:20px;font-weight:700;color:#dc2626">${stats.noApto}</div>
      <div style="font-size:11px;font-weight:600;color:#991b1b;margin-top:2px">No apto</div>
    </div>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px;text-align:center">
      <div id="rhv-stat-total" style="font-size:20px;font-weight:700;color:#0f172a">${stats.total}</div>
      <div style="font-size:11px;font-weight:600;color:#92400e;margin-top:2px">Total activos</div>
    </div>`;
}

// ─── Public: load HTML ────────────────────────────────────────────────────────

export async function loadRepositorioHvModule() {
  // Reset state on every fresh load
  _employees   = [];
  _totalServer = 0;
  _currentPage = 1;
  _hasMore     = false;
  _searchTerm  = "";
  _hvFilter    = "";
  _docsCache   = new Map();
  if (_searchTimer) { clearTimeout(_searchTimer); _searchTimer = null; }

  let stats = { total: 0, completa: 0, incompleta: 0, revision: 0, noApto: 0 };

  try {
    // 5 parallel calls: first page of employees + 4 stat counts
    const [listRes, cRes, iRes, rRes, nRes] = await Promise.all([
      apiFetch(`/personnel?status=ACTIVO&pageSize=${PAGE_SIZE}&page=1`),
      apiFetch("/personnel?status=ACTIVO&hvStatus=Completa&pageSize=1"),
      apiFetch("/personnel?status=ACTIVO&hvStatus=Incompleta&pageSize=1"),
      apiFetch("/personnel?status=ACTIVO&hvStatus=En+revision&pageSize=1"),
      apiFetch("/personnel?status=ACTIVO&hvStatus=No+apto+documental&pageSize=1"),
    ]);

    _employees   = Array.isArray(listRes.data) ? listRes.data
                 : Array.isArray(listRes.personnel) ? listRes.personnel : [];
    _totalServer = listRes.total || listRes.pagination?.total || _employees.length;
    _currentPage = 1;
    _hasMore     = (_totalServer > PAGE_SIZE);

    stats = {
      total:      _totalServer,
      completa:   cRes.total || cRes.pagination?.total || 0,
      incompleta: iRes.total || iRes.pagination?.total || 0,
      revision:   rRes.total || rRes.pagination?.total || 0,
      noApto:     nRes.total || nRes.pagination?.total || 0,
    };
  } catch (err) {
    console.error("[repositorio-hv] Error cargando datos:", err?.message || err);
  }

  const booksHtml = renderBooksHtml(_employees);

  return `
    <div class="repositorio-hv-module" id="documents-panel">
      <div class="personnel-premium-card" style="max-width:1100px;margin:0 auto">
        <div class="personnel-premium-header">
          <div>
            <span class="personnel-premium-eyebrow">Gestión Documental</span>
            <h2>Biblioteca de Hojas de Vida</h2>
            <p class="personnel-premium-subtitle">Expande cada empleado para ver y gestionar sus documentos.</p>
          </div>
        </div>

        <!-- Estadísticas -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;padding:16px 24px 0">
          ${renderStatCards(stats)}
        </div>

        <!-- Buscador y filtro -->
        <div style="display:flex;gap:10px;align-items:center;padding:16px 24px 8px;flex-wrap:wrap">
          <input id="rhvSearch" type="text" placeholder="Buscar por nombre, cargo, municipio…" autocomplete="off" />
          <select id="rhvStatusFilter"
            style="padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;background:#fff;outline:none">
            <option value="">Todos los estados HV</option>
            <option value="Completa">HV Completa</option>
            <option value="Incompleta">Sin documentos</option>
            <option value="En revisión">En revisión</option>
            <option value="No apto documental">No apto documental</option>
          </select>
        </div>

        <!-- Conteo de resultados -->
        <div id="rhvResultCount" style="display:none;padding:0 24px 6px;font-size:12px;color:#64748b"></div>

        <!-- Biblioteca de libros -->
        <div id="rhvAccordion" style="padding:0 24px 8px;display:flex;flex-direction:column;gap:6px">
          ${booksHtml}
        </div>

        <!-- Cargar más -->
        <div class="rhv-load-more-wrap" id="rhvLoadMoreWrap" style="${_hasMore ? "" : "display:none"}">
          <button type="button" id="rhvLoadMore" class="btn btn-secondary"
            style="font-size:13px;padding:9px 28px">
            Cargar más empleados (${_totalServer - _employees.length} restantes)
          </button>
        </div>

        <div style="height:24px"></div>
      </div>
    </div>`;
}

// ─── Public: wire events ──────────────────────────────────────────────────────

export function wireRepositorioHvEvents() {
  const accordion    = document.getElementById("rhvAccordion");
  const searchInput  = document.getElementById("rhvSearch");
  const statusFilter = document.getElementById("rhvStatusFilter");
  const loadMoreWrap = document.getElementById("rhvLoadMoreWrap");
  const loadMoreBtn  = document.getElementById("rhvLoadMore");

  if (!accordion) {
    console.warn("[repositorio-hv] wireRepositorioHvEvents: #rhvAccordion not found");
    return;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function updateAccordion(employees, append) {
    const el = document.getElementById("rhvAccordion");
    if (!el) return;
    if (append) {
      el.insertAdjacentHTML("beforeend", renderBooksHtml(employees));
    } else {
      el.innerHTML = renderBooksHtml(employees);
    }
  }

  function updateLoadMoreBtn(hasMore, remaining) {
    if (!loadMoreWrap) return;
    loadMoreWrap.style.display = hasMore ? "" : "none";
    if (loadMoreBtn && hasMore) {
      loadMoreBtn.textContent = `Cargar más empleados (${remaining} restantes)`;
    }
  }

  function showResultCount(total, term, hvSt) {
    const el = document.getElementById("rhvResultCount");
    if (!el) return;
    if (term || hvSt) {
      el.style.display = "";
      el.textContent   = `${total} resultado${total !== 1 ? "s" : ""}${term ? ` para "${term}"` : ""}`;
    } else {
      el.style.display = "none";
    }
  }

  // ── Backend search (debounced 300 ms) ────────────────────────────────────────

  async function doSearch(term, hvSt) {
    const el = document.getElementById("rhvResultCount");
    if (el) { el.style.display = ""; el.textContent = "Buscando…"; }

    const params = new URLSearchParams({ status: "ACTIVO", pageSize: PAGE_SIZE, page: 1 });
    if (term) params.set("search", term);
    if (hvSt) params.set("hvStatus", hvSt);

    try {
      const res = await apiFetch(`/personnel?${params}`);
      _employees   = Array.isArray(res.data) ? res.data
                   : Array.isArray(res.personnel) ? res.personnel : [];
      _totalServer = res.total || res.pagination?.total || _employees.length;
      _currentPage = 1;
      _hasMore     = (_totalServer > PAGE_SIZE);
      _searchTerm  = term;
      _hvFilter    = hvSt;

      updateAccordion(_employees, false);
      updateLoadMoreBtn(_hasMore, _totalServer - _employees.length);
      showResultCount(_totalServer, term, hvSt);
    } catch (err) {
      console.error("[repositorio-hv] search error:", err?.message || err);
      if (el) el.textContent = "Error al buscar.";
    }
  }

  function scheduleSearch() {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(function() {
      const term = (searchInput?.value || "").trim();
      const hvSt = statusFilter?.value || "";
      doSearch(term, hvSt);
    }, 300);
  }

  searchInput?.addEventListener("input",  scheduleSearch);
  statusFilter?.addEventListener("change", function() {
    clearTimeout(_searchTimer);
    const term = (searchInput?.value || "").trim();
    const hvSt = statusFilter.value || "";
    doSearch(term, hvSt);
  });

  // ── Cargar más ────────────────────────────────────────────────────────────────

  loadMoreBtn?.addEventListener("click", async function() {
    loadMoreBtn.disabled    = true;
    loadMoreBtn.textContent = "Cargando…";

    const nextPage = _currentPage + 1;
    const params   = new URLSearchParams({ status: "ACTIVO", pageSize: PAGE_SIZE, page: nextPage });
    if (_searchTerm) params.set("search", _searchTerm);
    if (_hvFilter)   params.set("hvStatus", _hvFilter);

    try {
      const res     = await apiFetch(`/personnel?${params}`);
      const newEmps = Array.isArray(res.data) ? res.data
                    : Array.isArray(res.personnel) ? res.personnel : [];

      _employees   = _employees.concat(newEmps);
      _currentPage = nextPage;
      _hasMore     = _employees.length < _totalServer;

      updateAccordion(newEmps, true);
      updateLoadMoreBtn(_hasMore, _totalServer - _employees.length);
    } catch (err) {
      console.error("[repositorio-hv] load more error:", err?.message || err);
    } finally {
      if (loadMoreBtn) {
        loadMoreBtn.disabled    = false;
        loadMoreBtn.textContent = `Cargar más empleados (${_totalServer - _employees.length} restantes)`;
      }
    }
  });

  // ── Delegated click handler ───────────────────────────────────────────────────

  accordion.addEventListener("click", async function(e) {
    // Action buttons (Ver / Validar / Rechazar)
    const actionBtn = e.target.closest("[data-rhv-action]");
    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.dataset.rhvAction;
      const docId  = actionBtn.dataset.docId;
      const empId  = actionBtn.dataset.empId
        || actionBtn.closest("[data-rhv-emp-id]")?.dataset.rhvEmpId || "";

      if (action === "view") {
        const docName = actionBtn.dataset.docName || "Documento";
        await openDocViewer(docId, docName);
        return;
      }

      if (action === "validate") {
        if (!confirm("¿Validar este documento?")) return;
        try {
          await apiFetch(`/documents/${encodeURIComponent(docId)}/status`, {
            method: "PATCH",
            body:   JSON.stringify({ status: "aprobado" }),
          });
          _docsCache.delete(String(empId));
          await reloadDocsPanel(empId);
        } catch {
          alert("No se pudo validar el documento. Intenta de nuevo.");
        }
        return;
      }

      if (action === "reject") {
        const reason = prompt("Motivo del rechazo (opcional):");
        if (reason === null) return;
        try {
          await apiFetch(`/documents/${encodeURIComponent(docId)}/status`, {
            method: "PATCH",
            body:   JSON.stringify({ status: "rechazado", reviewNotes: reason || null }),
          });
          _docsCache.delete(String(empId));
          await reloadDocsPanel(empId);
        } catch {
          alert("No se pudo rechazar el documento. Intenta de nuevo.");
        }
        return;
      }
      return;
    }

    // Toggle book accordion
    const cover = e.target.closest("[data-rhv-toggle]");
    if (!cover) return;

    const empId  = cover.dataset.rhvToggle;
    const pages  = document.getElementById(`rhv-docs-${empId}`);
    const chev   = cover.querySelector(".rhv-chevron");
    if (!pages) return;

    const isOpen = pages.style.display !== "none";
    if (isOpen) {
      pages.style.display = "none";
      if (chev) chev.textContent = "▶";
    } else {
      pages.style.display = "";
      if (chev) chev.textContent = "▼";
      if (!_docsCache.has(String(empId))) {
        await reloadDocsPanel(empId);
      }
    }
  });
}
