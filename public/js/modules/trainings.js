import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { prettyLabel, escapeHtml } from '../utils.js';
import { showError } from '../toast.js';
import { renderModuleNav, openModule } from '../nav.js';

async function handleCreateTraining(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  try {
    await apiFetch("/trainings", {
      method: "POST",
      body: JSON.stringify({
        title:      formData.get("title"),
        date:       formData.get("date"),
        municipality: formData.get("municipality"),
        site:       formData.get("site"),
        institution: formData.get("institution"),
        modality:   formData.get("modality"),
        companyId:  formData.get("companyId") ? Number(formData.get("companyId")) : state.currentUser?.companyId,
        contractId: formData.get("contractId") ? Number(formData.get("contractId")) : state.currentUser?.contractId,
        status:     formData.get("status"),
      }),
    });
    state.expandedModule  = "capacitaciones_asistencia";
    state.activeModule    = "capacitaciones_asistencia";
    state.activeSubmodule = "programar_capacitacion";
    renderModuleNav(state.access?.modules || []);
    await openModule("capacitaciones_asistencia");
  } catch (error) {
    showError(error.message || "Ocurrió un error inesperado.");
  }
}

export async function loadTrainingsModule() {
  const payload = await apiFetch("/trainings");

  setTimeout(() => {
    const form = document.getElementById("trainingForm");
    if (form) form.addEventListener("submit", handleCreateTraining);
  }, 0);

  const formHtml = payload.canCreate
    ? `
      <article class="info-card">
        <h3>Crear capacitación</h3>
        <form id="trainingForm" class="training-form">
          <label>Título<input name="title" type="text" required /></label>
          <label>Fecha<input name="date" type="date" required /></label>
          <label>Municipio<input name="municipality" type="text" required /></label>
          <label>Sede<input name="site" type="text" /></label>
          <label>Institución<input name="institution" type="text" /></label>
          <label>Modalidad<input name="modality" type="text" /></label>
          <label>Empresa
            <input name="companyId" type="number" value="${state.currentUser?.companyId ?? ""}" ${state.currentUser?.companyId ? "readonly" : ""} />
          </label>
          <label>Contrato
            <input name="contractId" type="number" value="${state.currentUser?.contractId ?? ""}" ${state.currentUser?.contractId ? "readonly" : ""} />
          </label>
          <label class="wide">Estado
            <select name="status">
              <option value="programada">Programada</option>
              <option value="en_curso">En curso</option>
              <option value="cerrada">Cerrada</option>
            </select>
          </label>
          <div class="admin-actions wide">
            <button type="submit">Guardar capacitación</button>
          </div>
        </form>
      </article>`
    : `<article class="info-card">
        <h3>Capacitaciones</h3>
        <p>Este usuario puede consultar la información, pero no crear nuevas capacitaciones.</p>
      </article>`;

  const listHtml = `
    <article class="info-card">
      <h3>Capacitaciones visibles</h3>
      <div class="training-list">
        ${payload.trainings.length
          ? payload.trainings.map(t => `
              <div class="personnel-item">
                <strong>${escapeHtml(t.title)}</strong>
                <p>Fecha: ${escapeHtml(t.date)}</p>
                <p>${escapeHtml(t.municipality)} | ${escapeHtml(t.site || "Sin sede")} | ${escapeHtml(t.institution || "Sin institución")}</p>
                <p>${escapeHtml(t.modality || "Sin modalidad")} | ${escapeHtml(t.status)}</p>
              </div>`).join("")
          : "<p>No hay capacitaciones visibles para este usuario.</p>"}
      </div>
    </article>`;

  return `
    <div class="personnel-master-module personnel-premium-module">
      <article class="personnel-premium-card">
        <section class="personnel-premium-hero">
          <div>
            <span class="personnel-premium-eyebrow">Módulo Operativo</span>
            <h2>Capacitaciones</h2>
            <p>Gestiona las capacitaciones del equipo: programadas, en curso y cerradas.</p>
          </div>
        </section>
        <div class="training-grid">${formHtml}${listHtml}</div>
      </article>
    </div>`;
}

export async function loadTrainingAttendanceModule() {
  const payload = await apiFetch("/training-attendance");

  setTimeout(() => {
    document.querySelectorAll(".attendance-form").forEach(form => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        try {
          await apiFetch("/training-attendance", {
            method: "POST",
            body: JSON.stringify({
              trainingId:  Number(formData.get("trainingId")),
              personnelId: Number(formData.get("personnelId")),
              status:      formData.get("status"),
            }),
          });
          state.expandedModule  = "capacitaciones_asistencia";
          state.activeModule    = "capacitaciones_asistencia";
          state.activeSubmodule = "registrar_asistencia";
          renderModuleNav(state.access?.modules || []);
          await openModule("capacitaciones_asistencia");
        } catch (error) {
          showError(error.message || "Error al guardar asistencia.");
        }
      });
    });
  }, 0);

  return `
    <div class="personnel-master-module personnel-premium-module">
      <article class="personnel-premium-card">
        <section class="personnel-premium-hero">
          <div>
            <span class="personnel-premium-eyebrow">Módulo Operativo</span>
            <h2>Asistencia a Capacitaciones</h2>
            <p>Registra y consulta la asistencia del personal a las capacitaciones programadas.</p>
          </div>
        </section>
        <div class="attendance-list" style="padding:1rem">
          ${payload.trainings.length
            ? payload.trainings.map(t => `
                <article class="info-card">
                  <h3>${escapeHtml(t.title)}</h3>
                  <p>${escapeHtml(t.date)} | ${escapeHtml(t.municipality)} | ${escapeHtml(t.site || "Sin sede")}</p>
                  <div class="attendance-list">
                    ${t.attendance.length
                      ? t.attendance.map(item => `
                          <div class="personnel-item">
                            <strong>${escapeHtml(item.personnel ? item.personnel.fullName : "Personal no encontrado")}</strong>
                            <p>Estado actual: ${prettyLabel(item.status)}</p>
                            <p>Marcado por: ${prettyLabel(item.markedByRole)}</p>
                          </div>`).join("")
                      : "<p>No hay asistencias registradas todavía.</p>"}
                  </div>
                  <form class="attendance-form">
                    <input type="hidden" name="trainingId" value="${t.id}" />
                    <label>Persona
                      <select name="personnelId" required>
                        ${payload.personnel.map(p =>
                          `<option value="${p.id}">${escapeHtml(p.fullName)} - ${escapeHtml(p.municipality)}</option>`
                        ).join("")}
                      </select>
                    </label>
                    <label>Estado
                      <select name="status" required>
                        <option value="asistio">Asistió</option>
                        <option value="no_asistio">No asistió</option>
                        <option value="pendiente">Pendiente</option>
                      </select>
                    </label>
                    <div class="admin-actions wide">
                      <button type="submit">Guardar asistencia</button>
                    </div>
                  </form>
                </article>`).join("")
            : '<article class="info-card"><p>No hay capacitaciones visibles para marcar asistencia.</p></article>'}
        </div>
      </article>
    </div>`;
}

export async function loadResumeModule() {
  const currentUrl = new URL(window.location.href);
  const site        = currentUrl.searchParams.get("resumeSite")        || "";
  const institution = currentUrl.searchParams.get("resumeInstitution") || "";
  const modality    = currentUrl.searchParams.get("resumeModality")    || "";
  const query       = new URLSearchParams();
  if (site)        query.set("site", site);
  if (institution) query.set("institution", institution);
  if (modality)    query.set("modality", modality);

  let payload;
  try {
    payload = await apiFetch(query.toString() ? `/resume-view?${query}` : "/resume-view");
  } catch (error) {
    return `<article class="info-card"><h3>Error en Hoja de Vida</h3><p>${escapeHtml(error.message)}</p></article>`;
  }

  setTimeout(() => {
    const form = document.getElementById("resumeFilterForm");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd   = new FormData(form);
      const next = new URLSearchParams();
      if (fd.get("site"))        next.set("resumeSite", fd.get("site"));
      if (fd.get("institution")) next.set("resumeInstitution", fd.get("institution"));
      if (fd.get("modality"))    next.set("resumeModality", fd.get("modality"));
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("resumeSite");
      cleanUrl.searchParams.delete("resumeInstitution");
      cleanUrl.searchParams.delete("resumeModality");
      next.forEach((v, k) => cleanUrl.searchParams.set(k, v));
      window.history.replaceState({}, "", cleanUrl);
      state.expandedModule  = "hoja_vida_documentos";
      state.activeModule    = "hoja_vida_documentos";
      state.activeSubmodule = "ver_hoja_vida";
      renderModuleNav(state.access?.modules || []);
      await openModule("hoja_vida_documentos");
    });
  }, 0);

  return `
    <article class="info-card">
      <h3>Filtros de hoja de vida</h3>
      <form id="resumeFilterForm" class="resume-filter-form">
        <label>Sede
          <select name="site">
            <option value="">Todas</option>
            ${(payload.availableFilters?.sites || []).map(v =>
              `<option value="${escapeHtml(v)}" ${v === payload.filters?.site ? "selected" : ""}>${escapeHtml(v)}</option>`
            ).join("")}
          </select>
        </label>
        <label>Institución
          <select name="institution">
            <option value="">Todas</option>
            ${(payload.availableFilters?.institutions || []).map(v =>
              `<option value="${escapeHtml(v)}" ${v === payload.filters?.institution ? "selected" : ""}>${escapeHtml(v)}</option>`
            ).join("")}
          </select>
        </label>
        <label>Modalidad
          <select name="modality">
            <option value="">Todas</option>
            ${(payload.availableFilters?.modalities || []).map(v =>
              `<option value="${escapeHtml(v)}" ${v === payload.filters?.modality ? "selected" : ""}>${escapeHtml(v)}</option>`
            ).join("")}
          </select>
        </label>
        <div class="admin-actions wide"><button type="submit">Aplicar filtros</button></div>
      </form>
    </article>
    <div class="resume-list">
      ${payload.records?.length
        ? payload.records.map(record => `
            <article class="info-card">
              <h3>${escapeHtml(record.fullName)}</h3>
              <p>${escapeHtml(record.position)}</p>
              <p>${escapeHtml(record.site)} | ${escapeHtml(record.institution)} | ${escapeHtml(record.modality)}</p>
              <p>${escapeHtml(record.municipality)}</p>
              <div class="resume-docs">
                ${Object.entries(record.documents || {}).map(([key, val]) => `
                  <div class="personnel-item">
                    <strong>${prettyLabel(key)}</strong>
                    <p>${escapeHtml(val)}</p>
                  </div>`).join("")}
              </div>
            </article>`).join("")
        : '<article class="info-card"><p>No hay hojas de vida visibles con los filtros actuales.</p></article>'}
    </div>`;
}
