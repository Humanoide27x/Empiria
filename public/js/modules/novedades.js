"use strict";

import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { escapeHtml, escapeAttr } from '../utils.js';
import { showError, showSuccess, showWarning } from '../toast.js';

const NOVEDAD_TYPES = [
  { key: "incapacidad_eps",   label: "Incapacidad EPS",         color: "#f97316" },
  { key: "incapacidad_arl",   label: "Incapacidad ARL",         color: "#ef4444" },
  { key: "licencia_mat",      label: "Licencia de maternidad",  color: "#a855f7" },
  { key: "licencia_nr",       label: "Licencia no remunerada",  color: "#6366f1" },
  { key: "ausencia",          label: "Ausencia injustificada",  color: "#dc2626" },
  { key: "suspension",        label: "Suspensión disciplinaria",color: "#b91c1c" },
  { key: "vacaciones",        label: "Vacaciones",              color: "#16a34a" },
  { key: "permiso",           label: "Permiso",                 color: "#0891b2" },
  { key: "otro",              label: "Otro",                    color: "#64748b" },
];

export async function loadNovedadesModule() {
  let employees = [];
  try {
    const payload = await apiFetch("/personnel");
    employees = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.personnel) ? payload.personnel : [];
  } catch (err) {
    console.error("Error cargando empleados:", err.message);
  }

  const typeOptions = NOVEDAD_TYPES.map(t =>
    `<option value="${escapeAttr(t.key)}">${escapeHtml(t.label)}</option>`
  ).join("");

  const employeeOptions = employees
    .filter(e => e.status === "ACTIVO" || !e.status)
    .sort((a, b) => (a.fullName || a.name || "").localeCompare(b.fullName || b.name || ""))
    .map(e => `<option value="${escapeAttr(e.id)}">${escapeHtml(e.fullName || e.name || e.numero_documento || e.id)}</option>`)
    .join("");

  setTimeout(() => {
    document.getElementById("btnRegistrarNovedad")?.addEventListener("click", () => {
      const modal = document.getElementById("novedadModal");
      if (modal) modal.style.display = "flex";
    });
    document.getElementById("btnCancelNovedad")?.addEventListener("click", () => {
      const modal = document.getElementById("novedadModal");
      if (modal) modal.style.display = "none";
    });
    document.getElementById("formNovedad")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const payload = {
        employeeId:  form.querySelector('[name="employeeId"]')?.value,
        type:        form.querySelector('[name="novedadType"]')?.value,
        startDate:   form.querySelector('[name="startDate"]')?.value,
        endDate:     form.querySelector('[name="endDate"]')?.value,
        days:        form.querySelector('[name="days"]')?.value,
        description: form.querySelector('[name="description"]')?.value,
        registeredBy: state.currentUser?.name || "Usuario",
      };
      if (!payload.employeeId || !payload.type || !payload.startDate) {
        showWarning("Completa los campos obligatorios: empleado, tipo y fecha de inicio.");
        return;
      }
      showSuccess("Novedad registrada correctamente.", "Novedad");
      const modal = document.getElementById("novedadModal");
      if (modal) modal.style.display = "none";
      form.reset();
    });
  }, 0);

  return `
    <div class="novedades-module">
      <div class="personnel-premium-card" style="max-width:1000px;margin:0 auto">
        <div class="personnel-premium-header">
          <div>
            <span class="personnel-premium-eyebrow">Gestión</span>
            <h2>Registro de Novedades</h2>
            <p class="personnel-premium-subtitle">Registra y gestiona las novedades del personal: incapacidades, licencias, ausencias y permisos.</p>
          </div>
          <button type="button" class="btn btn-primary" id="btnRegistrarNovedad">+ Registrar novedad</button>
        </div>

        <div style="padding:16px 24px">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:24px">
            ${NOVEDAD_TYPES.map(t => `
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center">
                <div style="width:10px;height:10px;border-radius:50%;background:${t.color};margin:0 auto 6px"></div>
                <div style="font-size:12px;font-weight:600;color:#374151">${escapeHtml(t.label)}</div>
                <div style="font-size:20px;font-weight:700;color:#0f172a;margin-top:2px">0</div>
              </div>
            `).join("")}
          </div>

          <div class="personnel-note-box" style="background:#f8fafc;border-color:#e2e8f0">
            <strong>Historial de novedades</strong> — Los registros guardados aparecerán aquí.
            Este módulo está en desarrollo activo; próximamente podrás filtrar, exportar y ver estadísticas.
          </div>
        </div>
      </div>

      <!-- Modal Registrar Novedad -->
      <div id="novedadModal" style="display:none;position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.5);align-items:center;justify-content:center">
        <div style="background:#fff;border-radius:16px;width:90%;max-width:540px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,0.2)">
          <h3 style="margin:0 0 20px;font-size:18px;color:#0f172a">Registrar novedad</h3>
          <form id="formNovedad">
            <div class="form-grid form-grid-2" style="gap:12px">
              <label style="grid-column:1/-1">
                <span>Empleado *</span>
                <select name="employeeId" required>
                  <option value="">Selecciona empleado</option>
                  ${employeeOptions}
                </select>
              </label>
              <label>
                <span>Tipo de novedad *</span>
                <select name="novedadType" required>
                  <option value="">Selecciona tipo</option>
                  ${typeOptions}
                </select>
              </label>
              <label>
                <span>Días</span>
                <input name="days" type="number" min="1" max="365" placeholder="Número de días" />
              </label>
              <label>
                <span>Fecha de inicio *</span>
                <input name="startDate" type="date" required />
              </label>
              <label>
                <span>Fecha de fin</span>
                <input name="endDate" type="date" />
              </label>
              <label style="grid-column:1/-1">
                <span>Descripción / Observaciones</span>
                <textarea name="description" rows="3" placeholder="Detalle de la novedad..."></textarea>
              </label>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
              <button type="button" id="btnCancelNovedad" class="btn btn-secondary">Cancelar</button>
              <button type="submit" class="btn btn-primary">Guardar novedad</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}
