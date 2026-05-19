"use strict";

import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { escapeHtml, escapeAttr } from '../utils.js';
import { showError, showSuccess } from '../toast.js';

const HV_STATUS_LABELS = {
  completo:    { label: "Completo",    color: "#16a34a", bg: "#f0fdf4" },
  incompleto:  { label: "Incompleto",  color: "#d97706", bg: "#fffbeb" },
  pendiente:   { label: "Pendiente",   color: "#dc2626", bg: "#fef2f2" },
  en_revision: { label: "En revisión", color: "#2563eb", bg: "#eff6ff" },
};

function hvStatusBadge(status) {
  const s = HV_STATUS_LABELS[status] || { label: status || "Sin estado", color: "#64748b", bg: "#f8fafc" };
  return `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${s.bg};color:${s.color}">${escapeHtml(s.label)}</span>`;
}

function avatarHtml(emp) {
  const initials = ((emp.fullName || emp.name || "?")[0] || "?").toUpperCase();
  if (emp.photoUrl || emp.photo_url) {
    return `<div style="width:36px;height:36px;border-radius:50%;background-image:url(${escapeAttr(emp.photoUrl || emp.photo_url)});background-size:cover;background-position:center;flex-shrink:0"></div>`;
  }
  return `<div style="width:36px;height:36px;border-radius:50%;background:#e0e7ef;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#2563eb;flex-shrink:0">${escapeHtml(initials)}</div>`;
}

export async function loadRepositorioHvModule() {
  let employees = [];
  try {
    const payload = await apiFetch("/personnel");
    employees = Array.isArray(payload.data) ? payload.data
      : Array.isArray(payload.personnel) ? payload.personnel : [];
  } catch (err) {
    console.error("Error cargando empleados:", err.message);
  }

  const active   = employees.filter(e => e.status === "ACTIVO" || !e.status);
  const inactive = employees.filter(e => e.status && e.status !== "ACTIVO");

  const totalComplete   = employees.filter(e => e.hvStatus === "completo").length;
  const totalIncomplete = employees.filter(e => e.hvStatus === "incompleto" || !e.hvStatus).length;
  const totalPending    = employees.filter(e => e.hvStatus === "pendiente").length;
  const totalReview     = employees.filter(e => e.hvStatus === "en_revision").length;

  function renderRow(emp) {
    const name    = escapeHtml(emp.fullName || emp.name || emp.numero_documento || emp.id);
    const doc     = escapeHtml(emp.documentNumber || emp.numero_documento || "—");
    const role    = escapeHtml(emp.position || emp.cargo || emp.role || "—");
    const status  = hvStatusBadge(emp.hvStatus);
    const empId   = escapeAttr(String(emp.id));
    return `
      <tr class="hv-repo-row" data-emp-id="${empId}" style="cursor:pointer">
        <td style="padding:10px 12px">
          <div style="display:flex;align-items:center;gap:10px">
            ${avatarHtml(emp)}
            <div>
              <div style="font-weight:600;font-size:13px;color:#0f172a">${name}</div>
              <div style="font-size:11px;color:#64748b">${doc}</div>
            </div>
          </div>
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#374151">${role}</td>
        <td style="padding:10px 12px">${status}</td>
        <td style="padding:10px 12px;text-align:right">
          <button type="button" class="btn btn-secondary btn-sm btn-open-hv" data-emp-id="${empId}"
            style="font-size:12px;padding:4px 12px">Ver HV</button>
        </td>
      </tr>
    `;
  }

  const allRows = [...active, ...inactive].sort((a, b) =>
    (a.fullName || a.name || "").localeCompare(b.fullName || b.name || "")
  );

  const rowsHtml = allRows.length
    ? allRows.map(renderRow).join("")
    : `<tr><td colspan="4" style="padding:32px;text-align:center;color:#64748b;font-size:14px">No hay empleados registrados.</td></tr>`;

  setTimeout(() => {
    const searchInput = document.getElementById("hvRepoSearch");
    const statusFilter = document.getElementById("hvRepoStatusFilter");
    const tableBody = document.getElementById("hvRepoTableBody");

    function filterRows() {
      const term   = (searchInput?.value || "").toLowerCase();
      const status = statusFilter?.value || "";
      const rows   = tableBody?.querySelectorAll(".hv-repo-row") || [];
      rows.forEach(row => {
        const text   = row.textContent.toLowerCase();
        const rowEmp = allRows.find(e => String(e.id) === row.dataset.empId);
        const matchSearch = !term || text.includes(term);
        const matchStatus = !status || (rowEmp?.hvStatus || "") === status;
        row.style.display = matchSearch && matchStatus ? "" : "none";
      });
    }

    searchInput?.addEventListener("input", filterRows);
    statusFilter?.addEventListener("change", filterRows);

    tableBody?.querySelectorAll(".btn-open-hv").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const empId = btn.dataset.empId;
        const emp = allRows.find(e => String(e.id) === empId);
        if (!emp) return;
        state.activeModule       = "gestion_personal";
        state.expandedModule     = "gestion_personal";
        state.personnelViewMode  = "cv";
        state.personnelSelectedId = empId;
        state.personnelEditingId  = empId;
        const { openModule } = await import('../nav.js');
        await openModule("gestion_personal");
      });
    });

    tableBody?.querySelectorAll(".hv-repo-row").forEach(row => {
      row.addEventListener("click", async () => {
        const btn = row.querySelector(".btn-open-hv");
        btn?.click();
      });
    });
  }, 0);

  return `
    <div class="repositorio-hv-module">
      <div class="personnel-premium-card" style="max-width:1000px;margin:0 auto">
        <div class="personnel-premium-header">
          <div>
            <span class="personnel-premium-eyebrow">Gestión</span>
            <h2>Repositorio de Hojas de Vida</h2>
            <p class="personnel-premium-subtitle">Consulta y gestiona las hojas de vida del personal registrado en el sistema.</p>
          </div>
        </div>

        <!-- Resumen -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;padding:16px 24px 0">
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:#15803d">${totalComplete}</div>
            <div style="font-size:11px;font-weight:600;color:#166534;margin-top:2px">Completos</div>
          </div>
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:#d97706">${totalIncomplete}</div>
            <div style="font-size:11px;font-weight:600;color:#92400e;margin-top:2px">Incompletos</div>
          </div>
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:#dc2626">${totalPending}</div>
            <div style="font-size:11px;font-weight:600;color:#991b1b;margin-top:2px">Pendientes</div>
          </div>
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:#2563eb">${totalReview}</div>
            <div style="font-size:11px;font-weight:600;color:#1e40af;margin-top:2px">En revisión</div>
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:#0f172a">${employees.length}</div>
            <div style="font-size:11px;font-weight:600;color:#64748b;margin-top:2px">Total empleados</div>
          </div>
        </div>

        <!-- Filtros -->
        <div style="display:flex;gap:10px;align-items:center;padding:16px 24px;flex-wrap:wrap">
          <input id="hvRepoSearch" type="search" placeholder="Buscar por nombre, documento..."
            style="flex:1;min-width:200px;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none" />
          <select id="hvRepoStatusFilter"
            style="padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;background:#fff;outline:none">
            <option value="">Todos los estados</option>
            <option value="completo">Completo</option>
            <option value="incompleto">Incompleto</option>
            <option value="pendiente">Pendiente</option>
            <option value="en_revision">En revisión</option>
          </select>
        </div>

        <!-- Tabla -->
        <div style="padding:0 24px 24px;overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="border-bottom:2px solid #e2e8f0;text-align:left">
                <th style="padding:8px 12px;font-weight:600;color:#64748b;font-size:12px">EMPLEADO</th>
                <th style="padding:8px 12px;font-weight:600;color:#64748b;font-size:12px">CARGO</th>
                <th style="padding:8px 12px;font-weight:600;color:#64748b;font-size:12px">ESTADO HV</th>
                <th style="padding:8px 12px;font-weight:600;color:#64748b;font-size:12px;text-align:right">ACCIÓN</th>
              </tr>
            </thead>
            <tbody id="hvRepoTableBody">
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}
