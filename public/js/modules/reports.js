import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { prettyLabel, escapeHtml } from '../utils.js';
import { showError } from '../toast.js';
import { renderModuleNav, openModule } from '../nav.js';

async function handleCreateReport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  try {
    await apiFetch("/reports", {
      method: "POST",
      body: JSON.stringify({
        title:      formData.get("title"),
        template:   formData.get("template"),
        companyId:  formData.get("companyId")  ? Number(formData.get("companyId"))  : state.currentUser?.companyId,
        contractId: formData.get("contractId") ? Number(formData.get("contractId")) : state.currentUser?.contractId,
      }),
    });
    state.expandedModule  = "informes_reportes";
    state.activeModule    = "informes_reportes";
    state.activeSubmodule = "reportes_personal";
    renderModuleNav(state.access?.modules || []);
    await openModule("informes_reportes");
  } catch (error) {
    showError(error.message || "Ocurrió un error inesperado.");
  }
}

export async function loadReportsModule() {
  const payload = await apiFetch("/reports");

  setTimeout(() => {
    const form = document.getElementById("reportForm");
    if (form) form.addEventListener("submit", handleCreateReport);
  }, 0);

  const formHtml = `
    <article class="info-card">
      <h3>Crear informe</h3>
      <form id="reportForm" class="report-form">
        <label>Título<input name="title" type="text" required /></label>
        <label>Plantilla
          <select name="template" required>
            ${payload.templates.map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join("")}
          </select>
        </label>
        <label>Empresa
          <input name="companyId" type="number" value="${payload.defaults.companyId ?? ""}" ${payload.defaults.companyId ? "readonly" : ""} />
        </label>
        <label>Contrato
          <input name="contractId" type="number" value="${payload.defaults.contractId ?? ""}" ${payload.defaults.contractId ? "readonly" : ""} />
        </label>
        <div class="admin-actions wide"><button type="submit">Generar informe</button></div>
      </form>
      <div>
        ${payload.templates.map(t =>
          `<div class="personnel-item"><strong>${escapeHtml(t.title)}</strong><p>${escapeHtml(t.description)}</p></div>`
        ).join("")}
      </div>
    </article>`;

  const listHtml = `
    <article class="info-card">
      <h3>Informes guardados</h3>
      <div class="report-list">
        ${payload.reports.length
          ? payload.reports.slice().reverse().map(report => `
              <article class="personnel-item">
                <strong>${escapeHtml(report.title)}</strong>
                <p>Tipo: ${prettyLabel(report.template)}</p>
                <p>Creado por: ${prettyLabel(report.createdByRole)}</p>
                <p>Fecha: ${new Date(report.createdAt).toLocaleString("es-CO")}</p>
                <div class="report-metrics">
                  ${Object.entries(report.content.metrics || {}).map(([key, value]) => `
                    <div class="info-card">
                      <h3>${prettyLabel(key)}</h3>
                      <p>${escapeHtml(String(value))}</p>
                    </div>`).join("")}
                </div>
                <p>${escapeHtml(report.content.summary || "")}</p>
                ${report.content.notes?.length ? `<p>${escapeHtml(report.content.notes.join(" | "))}</p>` : ""}
                ${report.content.people?.length
                  ? `<div>${report.content.people.map(p =>
                      `<span class="pill">${escapeHtml(p.fullName)} - ${prettyLabel(p.status)}</span>`
                    ).join("")}</div>`
                  : ""}
              </article>`).join("")
          : "<p>No hay informes guardados para este usuario.</p>"}
      </div>
    </article>`;

  return `
    <div class="personnel-master-module personnel-premium-module">
      <article class="personnel-premium-card">
        <section class="personnel-premium-hero">
          <div>
            <span class="personnel-premium-eyebrow">Módulo Operativo</span>
            <h2>Informes y Reportes</h2>
            <p>Genera y consulta informes de personal, cobertura y actividad del equipo.</p>
          </div>
        </section>
        <div class="report-grid">${formHtml}${listHtml}</div>
      </article>
    </div>`;
}
