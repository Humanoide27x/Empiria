import { state } from '../state.js';
import { apiFetch } from '../api.js';
import {
  escapeHtml, escapeAttr, getPersonnelFullName, getPersonnelRole, getPersonnelMunicipality,
  ensureOfficialMunicipalitiesLoaded, findOfficialMunicipality,
} from '../utils.js';
import { showWarning, showError } from '../toast.js';
import { openModule } from '../nav.js';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
  });
}

export async function loadCoverageModule() {
  await ensureOfficialMunicipalitiesLoaded().catch(() => {});
  const activeMun = (state.coverageFilters || {}).coverageFilterMunicipality || "";

  // La cobertura viva llega calculada desde backend; no se carga personal masivo.
  const knownUploadId = state.coverageSelectedUploadId || "";

  let historyPayload;
  let earlyRowsPayload = { data: [] };
  let exclusionsPayload = { total: 0, data: [] };

  try {
    const parallelFetches = [
      apiFetch("/coverage/history"),
      knownUploadId
        ? apiFetch(`/coverage/upload/${knownUploadId}`).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      apiFetch("/coverage/exclusions").catch(() => ({ total: 0, data: [] })),
    ];

    [historyPayload, earlyRowsPayload, exclusionsPayload] = await Promise.all(parallelFetches);
  } catch (error) {
    return `
      <article class="info-card">
        <h3>Error en cobertura</h3>
        <p>${escapeHtml(error.message)}</p>
      </article>
    `;
  }

  const history = Array.isArray(historyPayload.data) ? historyPayload.data : [];

  const selectedUploadId =
    state.coverageSelectedUploadId || (history[0]?.id ? String(history[0].id) : "");

  let selectedRows = [];

  if (selectedUploadId) {
    if (knownUploadId === selectedUploadId) {
      // Ya lo pedimos en la primera ronda en paralelo
      selectedRows = Array.isArray(earlyRowsPayload.data) ? earlyRowsPayload.data : [];
    } else {
      try {
        const rowsPayload = await apiFetch(`/coverage/upload/${selectedUploadId}`);
        selectedRows = Array.isArray(rowsPayload.data) ? rowsPayload.data : [];
      } catch {
        selectedRows = [];
      }
    }
  }

  const selectedUpload = history.find((item) => String(item.id) === String(selectedUploadId));

  const formatNumber = (value) => new Intl.NumberFormat("es-CO").format(Number(value || 0));

  const normalize = (value) =>
    String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

  const getCoverageRisk = (tcDifference, mtDifference) => {
    if (tcDifference < 0 || mtDifference < 0) {
      const totalMissing = Math.abs(Math.min(tcDifference, 0)) + Math.abs(Math.min(mtDifference, 0));
      return totalMissing >= 2 ? "ALTO" : "MEDIO";
    }
    if (tcDifference > 2 || mtDifference > 2) return "MEDIO";
    return "BAJO";
  };

  const getMunicipalityId = (row) =>
    String(row.municipality_id || row.municipalityId || "").trim();

  const getMunicipalityName = (row) => {
    const found = findOfficialMunicipality(getMunicipalityId(row), { includeFallback: true })
      || findOfficialMunicipality(row.municipality_name || row.municipality, { includeFallback: true });
    return found?.name || String(row.municipality_name || row.municipality || "").trim();
  };

  const getLiveCoverageCounts = (row) => {
    const contractedTc = Number(row.contracted_tc || row.contractedTc || 0);
    const contractedMt = Number(row.contracted_mt || row.contractedMt || 0);
    const requiredTc = Number(row.required_tc || 0);
    const requiredMt = Number(row.required_mt || 0);

    const tcDifference = contractedTc - requiredTc;
    const mtDifference = contractedMt - requiredMt;

    let coverageStatus = "CUMPLE";
    const totalContracted = contractedTc + contractedMt;
    const totalRequired   = requiredTc   + requiredMt;
    if (totalContracted === totalRequired && (tcDifference !== 0 || mtDifference !== 0)) {
      coverageStatus = "MAL_CONTRATADO";
    } else if (tcDifference < 0 || mtDifference < 0) {
      coverageStatus = "FALTANTE";
    } else if (tcDifference > 0 || mtDifference > 0) {
      coverageStatus = "SOBRANTE";
    }

    return {
      contractedTc, contractedMt, tcDifference, mtDifference,
      coverageStatus,
      coverageRisk: getCoverageRisk(tcDifference, mtDifference),
    };
  };

  const coverageFilters = state.coverageFilters || {};
  const coverageSearch       = coverageFilters.coverageSearch || "";
  const coverageMunicipality = coverageFilters.coverageFilterMunicipality || "";
  const coverageModality     = coverageFilters.coverageFilterModality || "";
  const coverageChange       = coverageFilters.coverageFilterChange || "";
  const coverageStatus       = coverageFilters.coverageFilterStatus || "";

  const rowsWithRequirement = selectedRows.filter((row) => {
    const requiredTc = Number(row.required_tc || 0);
    const requiredMt = Number(row.required_mt || 0);
    return requiredTc > 0 || requiredMt > 0;
  });

  const rowsWithLiveCoverage = rowsWithRequirement.map((row) => ({
    ...row,
    liveCoverage: getLiveCoverageCounts(row),
  }));

  // ── KPI scope: aplica filtros de municipio y modalidad a TODAS las sedes ──────
  // (incluye sedes sin manipuladora para que los totales sean correctos al filtrar)
  const kpiAllRows = selectedRows.filter(row => {
    if (coverageMunicipality && getMunicipalityId(row) !== String(coverageMunicipality)) return false;
    if (coverageModality     && normalize(row.modality)     !== normalize(coverageModality))     return false;
    return true;
  });
  const kpiRowsWithReq  = kpiAllRows.filter(r => Number(r.required_tc || 0) > 0 || Number(r.required_mt || 0) > 0);
  const kpiRowsWithLive = kpiRowsWithReq.map(r => ({ ...r, liveCoverage: getLiveCoverageCounts(r) }));

  const totalCuposAll        = kpiAllRows.reduce((s, r) => s + Number(r.cupos || 0), 0);
  const totalSedes           = kpiAllRows.length;
  const sedesConManipuladora = kpiRowsWithReq.length;
  const sedesSinManipuladora = totalSedes - sedesConManipuladora;
  const totalRequiredTc      = kpiRowsWithReq.reduce((s, r) => s + Number(r.required_tc || 0), 0);
  const totalRequiredMt      = kpiRowsWithReq.reduce((s, r) => s + Number(r.required_mt || 0), 0);
  const totalContractedTc    = kpiRowsWithLive.reduce((s, r) => s + r.liveCoverage.contractedTc, 0);
  const totalContractedMt    = kpiRowsWithLive.reduce((s, r) => s + r.liveCoverage.contractedMt, 0);
  const totalManipuladoras   = totalContractedTc + totalContractedMt;

  const municipalityOptions = Array.from(
    new Map(
      rowsWithRequirement
        .map((row) => {
          const id = getMunicipalityId(row);
          const name = getMunicipalityName(row);
          return id && name ? [id, { id, name }] : null;
        })
        .filter(Boolean)
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name, "es"));

  const modalityOptions = Array.from(
    new Set(rowsWithRequirement.map((r) => r.modality).filter(Boolean))
  ).sort();

  const filteredRows = rowsWithLiveCoverage.filter((row) => {
    const live = row.liveCoverage;
    const fullText = normalize(`
      ${row.unique_code} ${getMunicipalityName(row)} ${row.institution}
      ${row.site} ${row.modality} ${row.update_origin}
      ${live.coverageStatus} ${live.coverageRisk}
    `);
    if (coverageSearch && !fullText.includes(normalize(coverageSearch))) return false;
    if (coverageMunicipality && getMunicipalityId(row) !== String(coverageMunicipality)) return false;
    if (coverageModality && normalize(row.modality) !== normalize(coverageModality)) return false;
    if (coverageChange && normalize(row.change_status) !== normalize(coverageChange)) return false;
    if (coverageStatus && normalize(live.coverageStatus) !== normalize(coverageStatus)) return false;
    return true;
  });


  const formatDate = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("es-CO", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const getModalityClass = (value) => {
    const m = normalize(value);
    if (m.includes("RI")) return "modality-ri";
    if (m.includes("CAARES")) return "modality-caares";
    if (m.includes("CAA")) return "modality-caa";
    return "modality-default";
  };

  const getChangeIcon = (value) => {
    const s = normalize(value);
    if (s === "SUBIO")     return `<span class="cov-arrow cov-arrow-up"   aria-label="Subió">▲</span>`;
    if (s === "BAJO")      return `<span class="cov-arrow cov-arrow-down" aria-label="Bajó">▼</span>`;
    if (s === "SIN_CAMBIO") return `<span class="cov-arrow cov-arrow-same" aria-label="Sin cambio">=</span>`;
    return `<span class="cov-arrow cov-arrow-none">—</span>`;
  };

  const getCoverageStatusClass = (value) => {
    const s = normalize(value);
    if (s === "EXACTO" || s === "CUMPLE") return "coverage-exacto";
    if (s === "FALTANTE")        return "coverage-faltante";
    if (s === "SOBRANTE")        return "coverage-sobrante";
    if (s === "MAL_CONTRATADO")  return "coverage-mal-contratado";
    return "coverage-none";
  };

  const getCoverageRiskClass = (value) => {
    const r = normalize(value);
    if (r === "ALTO")  return "risk-alto";
    if (r === "MEDIO") return "risk-medio";
    return "risk-bajo";
  };

  const getCoverageStatusLabel = (value) => {
    const s = normalize(value);
    if (s === "FALTANTE")       return "FALTANTE";
    if (s === "SOBRANTE")       return "SOBRANTE";
    if (s === "EXACTO" || s === "CUMPLE") return "CUMPLE";
    if (s === "MAL_CONTRATADO") return "MAL CONTRATADO";
    return "SIN ESTADO";
  };

  // ── Upload modal ─────────────────────────────────────────────────────────
  const openUploadCoverageModal = () => {
    document.getElementById("uploadCoverageModal")?.remove();
    const modal = document.createElement("div");
    modal.id = "uploadCoverageModal";
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal-card cov-upload-modal">
        <div class="modal-header">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:22px">📂</span>
            <div>
              <h3 style="margin:0;font-size:16px;font-weight:800;color:#0f172a">Subir archivo de cobertura</h3>
              <p style="margin:2px 0 0;font-size:12px;color:#64748b">Sube el Excel del corte para procesar cobertura</p>
            </div>
          </div>
          <button type="button" class="modal-close" id="closeCovUpload1">&#x2715;</button>
        </div>
        <div class="modal-body" style="display:grid;gap:14px;padding:20px 24px">
          <p style="font-size:12.5px;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;margin:0">
            Columnas requeridas: <strong>Consecutivo Único, Municipio, Institución Educativa, Sede Educativa, Modalidad, Cupos Total.</strong>
          </p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <label style="display:flex;flex-direction:column;gap:5px;font-size:12.5px;font-weight:600;color:#374151">
              Mes de cobertura
              <input id="covModalMonth" type="month" style="height:38px;border:1px solid #dbe3ef;border-radius:10px;padding:0 12px;font-size:13px" />
            </label>
            <label style="display:flex;flex-direction:column;gap:5px;font-size:12.5px;font-weight:600;color:#374151">
              Semana / Corte
              <select id="covModalWeek" style="height:38px;border:1px solid #dbe3ef;border-radius:10px;padding:0 12px;font-size:13px">
                <option value="">Selecciona</option>
                <option value="1">Semana 1</option>
                <option value="2">Semana 2</option>
                <option value="3">Semana 3</option>
                <option value="4">Semana 4</option>
                <option value="5">Semana 5</option>
              </select>
            </label>
          </div>
          <label style="display:flex;flex-direction:column;gap:5px;font-size:12.5px;font-weight:600;color:#374151">
            Archivo Excel (.xlsx / .xls)
            <input id="covModalFile" type="file" accept=".xlsx,.xls"
              style="border:1px solid #dbe3ef;border-radius:10px;padding:8px 12px;font-size:13px;background:#fff" />
          </label>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-primary" id="doCovUpload" style="flex:1;justify-content:center">↑ Subir y procesar</button>
          <button type="button" class="btn btn-secondary" id="closeCovUpload2">Cancelar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    document.getElementById("closeCovUpload1").addEventListener("click", close);
    document.getElementById("closeCovUpload2").addEventListener("click", close);
    modal.addEventListener("click", e => { if (e.target === modal) close(); });

    document.getElementById("doCovUpload").addEventListener("click", async () => {
      const periodMonth = document.getElementById("covModalMonth")?.value || "";
      const weekNumber  = document.getElementById("covModalWeek")?.value || "";
      const fileEl      = document.getElementById("covModalFile");
      if (!fileEl?.files?.length) { showWarning("Selecciona un archivo Excel."); return; }
      const file = fileEl.files[0];
      if (!file.name.toLowerCase().match(/\.xlsx?$/)) { showWarning("Solo se permiten archivos Excel (.xlsx o .xls)."); return; }
      if (!periodMonth) { showWarning("Selecciona el mes de cobertura."); return; }
      if (!weekNumber)  { showWarning("Selecciona la semana o corte."); return; }
      const btn = document.getElementById("doCovUpload");
      try {
        btn.disabled = true; btn.textContent = "Procesando...";
        const fileBase64 = await fileToBase64(file);
        const result = await apiFetch("/coverage/upload", {
          method: "POST",
          body: JSON.stringify({ fileBase64, fileName: file.name, periodMonth, weekNumber }),
        });
        state.coverageSelectedUploadId = result?.data?.upload?.id ? String(result.data.upload.id) : null;
        state.coverageFilters = { coverageSearch: "", coverageFilterMunicipality: "", coverageFilterModality: "", coverageFilterStatus: "", coverageFilterChange: "" };
        close();
        await openModule("cobertura_calculadora");
      } catch (error) {
        showError(error.message || "No fue posible procesar el archivo.");
        btn.disabled = false; btn.textContent = "↑ Subir y procesar";
      }
    });
  };

  setTimeout(() => {
    const clearBtn        = document.getElementById("clearCoverageFilters");
    const exportBtn       = document.getElementById("btnExportCoverageExcel");
    const onlyMissingBtn  = document.getElementById("btnOnlyMissingCoverage");

    let coverageSearchTimer = null;

    const applyCoverageFilters = async () => {
      state.coverageFilters = {
        coverageSearch:             document.getElementById("coverageSearch")?.value || "",
        coverageFilterMunicipality: document.getElementById("coverageFilterMunicipality")?.value || "",
        coverageFilterModality:     document.getElementById("coverageFilterModality")?.value || "",
        coverageFilterStatus:       document.getElementById("coverageFilterStatus")?.value || "",
        coverageFilterChange:       document.getElementById("coverageFilterChange")?.value || "",
      };
      await openModule("cobertura_calculadora");
    };

    const coverageSearchEl = document.getElementById("coverageSearch");
    if (coverageSearchEl) {
      coverageSearchEl.addEventListener("input", () => {
        clearTimeout(coverageSearchTimer);
        coverageSearchTimer = setTimeout(applyCoverageFilters, 400);
      });
    }

    [
      document.getElementById("coverageFilterMunicipality"),
      document.getElementById("coverageFilterModality"),
      document.getElementById("coverageFilterStatus"),
      document.getElementById("coverageFilterChange"),
    ].forEach((el) => {
      if (!el) return;
      el.addEventListener("change", applyCoverageFilters);
    });

    if (onlyMissingBtn) {
      onlyMissingBtn.addEventListener("click", async () => {
        const currentStatus = state.coverageFilters?.coverageFilterStatus || "";
        state.coverageFilters = {
          ...(state.coverageFilters || {}),
          coverageFilterStatus: normalize(currentStatus) === "FALTANTE" ? "" : "FALTANTE",
        };
        await openModule("cobertura_calculadora");
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", async () => {
        state.coverageFilters = { coverageSearch: "", coverageFilterMunicipality: "", coverageFilterModality: "", coverageFilterStatus: "", coverageFilterChange: "" };
        await openModule("cobertura_calculadora");
      });
    }


    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        const table = document.querySelector(".coverage-table");
        if (!table) { showWarning("No hay datos para exportar."); return; }
        const html = `<html><head><meta charset="UTF-8"/></head><body>${table.outerHTML}</body></html>`;
        const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
        const url  = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url; link.download = `verificacion_cobertura_${new Date().toISOString().slice(0,10)}.xls`;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });
    }

    // Historial dropdown
    const histBtn  = document.getElementById("covHistBtn");
    const histMenu = document.getElementById("covHistMenu");
    if (histBtn && histMenu) {
      histBtn.addEventListener("click", e => {
        e.stopPropagation();
        histMenu.classList.toggle("cov-hist-open");
      });
      document.addEventListener("click", () => histMenu.classList.remove("cov-hist-open"));
    }

    // Selección de corte desde el historial
    document.querySelectorAll("[data-coverage-upload-id]").forEach(btn => {
      btn.addEventListener("click", async () => {
        state.coverageSelectedUploadId = btn.dataset.coverageUploadId;
        histMenu?.classList.remove("cov-hist-open");
        await openModule("cobertura_calculadora");
      });
    });

    // Subir cobertura
    document.getElementById("btnSubirCobertura")?.addEventListener("click", openUploadCoverageModal);
  }, 0);

  return `
    <div class="coverage-pro-module">
      <article class="coverage-pro-card">

        <!-- KPIs compactos -->
        <section class="cov-kpi-strip">
          <div class="cov-kpi cov-kpi-main">
            <span>Total de cupos abarcados</span>
            <strong>${formatNumber(totalCuposAll)}</strong>
          </div>
          <div class="cov-kpi cov-kpi-neutral">
            <span>Total de sedes</span>
            <strong>${formatNumber(totalSedes)}</strong>
          </div>
          <div class="cov-kpi cov-kpi-success">
            <span>Total de sedes con manipuladoras de alimentos</span>
            <strong>${formatNumber(sedesConManipuladora)}</strong>
          </div>
          <div class="cov-kpi cov-kpi-warning">
            <span>Total de sedes sin manipuladoras de alimentos</span>
            <strong>${formatNumber(sedesSinManipuladora)}</strong>
          </div>
          <div class="cov-kpi cov-kpi-neutral">
            <span>TC Requerido</span>
            <strong>${formatNumber(totalRequiredTc)}</strong>
          </div>
          <div class="cov-kpi cov-kpi-neutral">
            <span>MT Requerido</span>
            <strong>${formatNumber(totalRequiredMt)}</strong>
          </div>
          <div class="cov-kpi cov-kpi-blue">
            <span>TC Contratado</span>
            <strong>${formatNumber(totalContractedTc)}</strong>
          </div>
          <div class="cov-kpi cov-kpi-blue">
            <span>MT Contratado</span>
            <strong>${formatNumber(totalContractedMt)}</strong>
          </div>
        </section>

        ${(() => {
          const excl = Array.isArray(exclusionsPayload?.data) ? exclusionsPayload.data : [];
          if (!excl.length) return '';
          const names = excl.slice(0, 3).map(e => escapeHtml(e.fullName)).join(', ');
          const extra = excl.length > 3 ? ` y ${excl.length - 3} más` : '';
          return `
          <div style="background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;padding:10px 14px;margin:10px 0;font-size:13px;color:#92400e;display:flex;gap:10px;align-items:flex-start">
            <span style="font-size:18px;flex-shrink:0">⚠️</span>
            <div>
              <strong>${excl.length} empleado${excl.length > 1 ? 's' : ''} no contabilizado${excl.length > 1 ? 's' : ''} en cobertura por falta de sede asignada:</strong>
              ${names}${extra}.
              <br>
              <span style="color:#78350f">Corrija desde <strong>Personal → Editar empleado → Sede educativa</strong>. Sin sede asignada el empleado no puede cruzarse con el Excel de cobertura.</span>
            </div>
          </div>
          `;
        })()}

        <!-- Tabla de cobertura -->
        <section class="coverage-pro-detail coverage-pro-detail-full" style="margin-top:14px">

          <!-- Barra de acciones -->
          <div class="cov-action-bar">
            <div class="cov-action-left">
              <span class="cov-record-badge">${formatNumber(filteredRows.length)} registros</span>
              <small class="cov-file-label">${selectedUpload ? escapeHtml(selectedUpload.original_file_name) : "Sin archivo seleccionado"}</small>
            </div>
            <div class="cov-action-right">
              <button type="button" id="btnOnlyMissingCoverage"
                class="btn btn-secondary btn-row${normalize(coverageStatus) === "FALTANTE" ? " active" : ""}">
                Solo faltantes
              </button>
              <button type="button" id="btnExportCoverageExcel" class="btn btn-secondary btn-row">
                ⬇ Descargar Excel
              </button>

              <!-- Historial dropdown -->
              <div class="cov-hist-wrap" id="covHistDropdown">
                <button type="button" id="covHistBtn" class="btn btn-secondary btn-row cov-hist-trigger">
                  📋 Historial
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="margin-left:4px;flex-shrink:0">
                    <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <div class="cov-hist-menu" id="covHistMenu">
                  ${history.length
                    ? history.map((item) => `
                        <button type="button"
                          class="cov-hist-item${String(item.id) === String(selectedUploadId) ? " active" : ""}"
                          data-coverage-upload-id="${escapeAttr(item.id)}">
                          <span class="cov-hist-month">${escapeHtml(item.period_month || "Sin mes")}</span>
                          <span class="cov-hist-week">Semana ${escapeHtml(String(item.week_number || "—"))}</span>
                          <span class="cov-hist-user">${escapeHtml(item.uploaded_by || item.user_name || item.createdBy || "Sistema")}</span>
                        </button>`).join("")
                    : `<p class="cov-hist-empty">Sin archivos cargados</p>`}
                </div>
              </div>

              <button type="button" id="btnSubirCobertura" class="btn btn-primary btn-row">
                ↑ Subir cobertura
              </button>
            </div>
          </div>

          <!-- Filtros -->
          <div class="coverage-filter-bar">
            <input id="coverageSearch" type="text" placeholder="Buscar municipio, institución, sede o código…" value="${escapeAttr(coverageSearch)}" />
            <select id="coverageFilterMunicipality">
              <option value="">Municipio</option>
              ${municipalityOptions.map((item) => `<option value="${escapeAttr(item.id)}"${String(coverageMunicipality) === String(item.id) ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
            </select>
            <select id="coverageFilterModality">
              <option value="">Modalidad</option>
              ${modalityOptions.map((v) => `<option value="${escapeAttr(v)}"${normalize(coverageModality) === normalize(v) ? " selected" : ""}>${escapeHtml(v)}</option>`).join("")}
            </select>
            <select id="coverageFilterStatus">
              <option value="">Estado cobertura</option>
              <option value="FALTANTE"${normalize(coverageStatus) === "FALTANTE" ? " selected" : ""}>Faltante</option>
              <option value="CUMPLE"${["EXACTO", "CUMPLE"].includes(normalize(coverageStatus)) ? " selected" : ""}>Cumple</option>
              <option value="SOBRANTE"${normalize(coverageStatus) === "SOBRANTE" ? " selected" : ""}>Sobrante</option>
              <option value="MAL_CONTRATADO"${normalize(coverageStatus) === "MAL_CONTRATADO" ? " selected" : ""}>Mal contratado</option>
            </select>
            <select id="coverageFilterChange">
              <option value="">Cambio vs anterior</option>
              <option value="SUBIO"${normalize(coverageChange) === "SUBIO" ? " selected" : ""}>Subió</option>
              <option value="BAJO"${normalize(coverageChange) === "BAJO" ? " selected" : ""}>Bajó</option>
              <option value="SIN_CAMBIO"${normalize(coverageChange) === "SIN_CAMBIO" ? " selected" : ""}>Sin cambio</option>
              <option value="SIN_COMPARACION"${normalize(coverageChange) === "SIN_COMPARACION" ? " selected" : ""}>Sin comparación</option>
            </select>
            <button type="button" id="clearCoverageFilters" class="btn btn-secondary">Limpiar</button>
          </div>

          <!-- Tabla -->
          <div class="coverage-table-wrap">
            <table class="coverage-table">
              <thead>
                <tr>
                  <th>Municipio</th><th>Institución</th><th>Sede</th><th>Mod.</th>
                  <th>Cupos</th><th>TC Req.</th><th>MT Req.</th>
                  <th>TC Cont.</th><th>MT Cont.</th>
                  <th>Dif. TC</th><th>Dif. MT</th>
                  <th>Cobertura</th><th>Δ Cupos</th><th>Cambio</th>
                </tr>
              </thead>
              <tbody>
                ${filteredRows.length
                  ? filteredRows.map((row) => {
                      const modality = String(row.modality || "").toUpperCase().trim();
                      const live = row.liveCoverage;
                      const cuposDelta = (row.cupos_delta === null || row.cupos_delta === undefined) ? null : Number(row.cupos_delta);
                      const rowCoverageClass = getCoverageStatusClass(live.coverageStatus);
                      const rowRiskClass     = getCoverageRiskClass(live.coverageRisk);
                      return `
                        <tr class="${row.update_origin === "HEREDADO" ? "coverage-row-inherited" : "coverage-row-updated"} ${rowCoverageClass} ${rowRiskClass}">
                          <td>${escapeHtml(getMunicipalityName(row))}</td>
                          <td class="td-strong">${escapeHtml(row.institution)}</td>
                          <td>${escapeHtml(row.site)}</td>
                          <td><span class="modality-chip ${getModalityClass(modality)}">${escapeHtml(modality || "N/A")}</span></td>
                          <td class="num">${formatNumber(row.cupos)}</td>
                          <td class="num">${formatNumber(row.required_tc)}</td>
                          <td class="num">${formatNumber(row.required_mt)}</td>
                          <td class="num">${formatNumber(live.contractedTc)}</td>
                          <td class="num">${formatNumber(live.contractedMt)}</td>
                          <td class="num">${formatNumber(live.tcDifference)}</td>
                          <td class="num">${formatNumber(live.mtDifference)}</td>
                          <td><span class="coverage-badge ${rowCoverageClass}">${escapeHtml(getCoverageStatusLabel(live.coverageStatus))}</span></td>
                          <td class="num">${cuposDelta === null ? "—" : formatNumber(cuposDelta)}</td>
                          <td class="change-cell">${getChangeIcon(row.change_status)}</td>
                        </tr>`;
                    }).join("")
                  : `<tr><td colspan="14" class="empty">${
                      activeMun
                        ? "Sin registros para mostrar."
                        : "Escoge un municipio en los filtros para ver la cobertura de personal."
                    }</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      </article>
    </div>
  `;
}

export async function loadNovedadesPersonalModule() {
  let personnelRows = [];
  let novedadesData = [];
  try {
    const pp = await apiFetch("/personnel?page=1&pageSize=200&status=ACTIVO");
    personnelRows = Array.isArray(pp.data) ? pp.data : [];
  } catch { personnelRows = []; }
  try {
    const novPayload = await apiFetch("/novedades");
    novedadesData = Array.isArray(novPayload.data) ? novPayload.data : [];
  } catch { novedadesData = []; }

  return `
    <div class="payroll-module-wrap">
      <section class="personnel-premium-hero">
        <div>
          <span class="personnel-premium-eyebrow">Módulo Operativo</span>
          <h2>Novedades del Personal</h2>
          <p>Estado de novedades por empleado: ausencias, incapacidades, licencias y más.</p>
        </div>
      </section>
      <section class="novedades-section">
        <div class="novedades-toolbar">
          <h3>Personal — estado de novedades</h3>
          <span class="novedades-count-badge">${personnelRows.length} personas</span>
        </div>
        <div class="novedades-list">
          ${personnelRows.map((emp) => {
            const empId = String(emp.id || "");
            const empNovedades = novedadesData.filter((n) => String(n.employeeId) === empId);
            const hasNovedades = empNovedades.length > 0;
            const latestStatus = hasNovedades ? empNovedades[0].status : null;
            const statusColors = { PENDIENTE: "cov-warning", APROBADO: "cov-success", RECHAZADO: "cov-danger" };
            return `
              <div class="novedad-emp-row" data-emp-id="${escapeAttr(empId)}">
                <div class="novedad-emp-info">
                  <span class="novedad-emp-name">${escapeHtml(getPersonnelFullName(emp))}</span>
                  <span class="novedad-emp-meta">${escapeHtml(getPersonnelMunicipality(emp))} · ${escapeHtml(getPersonnelRole(emp))}</span>
                </div>
                <div class="novedad-emp-status">
                  ${!hasNovedades
                    ? `<span class="novedad-badge novedad-badge-none">Sin novedad</span>`
                    : `<span class="novedad-badge ${statusColors[latestStatus] || ''}">${escapeHtml(latestStatus || "—")}</span>
                       <span class="novedad-count-label">${empNovedades.length} novedad${empNovedades.length !== 1 ? "es" : ""}</span>`}
                </div>
                <div class="novedad-emp-actions">
                  <button type="button" class="btn btn-secondary btn-row btn-add-novedad"
                    data-novedad-emp-id="${escapeAttr(empId)}"
                    data-novedad-emp-name="${escapeAttr(getPersonnelFullName(emp))}"
                    data-novedad-mun-id="${escapeAttr(String(emp.municipalityId || emp.municipality_id || ''))}"
                    data-novedad-mun-name="${escapeAttr(getPersonnelMunicipality(emp))}"
                    data-novedad-cargo="${escapeAttr(getPersonnelRole(emp))}">
                    + Novedad
                  </button>
                  ${hasNovedades
                    ? `<button type="button" class="btn btn-secondary btn-row btn-ver-novedades"
                         data-novedad-emp-id="${escapeAttr(empId)}">Ver (${empNovedades.length})</button>`
                    : ""}
                </div>
              </div>
              <div class="novedad-form-wrap hidden" id="novedad-form-${escapeAttr(empId)}">
                <form class="novedad-inline-form" data-form-emp-id="${escapeAttr(empId)}">
                  <div class="novedad-form-grid">
                    <label>
                      <span>Tipo</span>
                      <select name="type" required>
                        <option value="">Selecciona</option>
                        <option value="Ausencia">Ausencia</option>
                        <option value="Incapacidad">Incapacidad</option>
                        <option value="Licencia">Licencia</option>
                        <option value="Permiso">Permiso</option>
                        <option value="Reemplazo">Reemplazo</option>
                        <option value="Otro">Otro</option>
                      </select>
                    </label>
                    <label>
                      <span>Fecha</span>
                      <input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required />
                    </label>
                    <label class="novedad-form-full">
                      <span>Descripción</span>
                      <textarea name="description" rows="2" placeholder="Describe la novedad..."></textarea>
                    </label>
                    <label class="novedad-form-full">
                      <span>Documento soporte (PDF)</span>
                      <input name="documentFile" type="file" accept=".pdf" />
                    </label>
                  </div>
                  <div class="novedad-form-actions">
                    <button type="submit" class="btn btn-primary btn-row">Registrar</button>
                    <button type="button" class="btn btn-secondary btn-row btn-cancel-novedad" data-cancel-emp-id="${escapeAttr(empId)}">Cancelar</button>
                  </div>
                </form>
              </div>
              <div class="novedad-detail-wrap hidden" id="novedad-detail-${escapeAttr(empId)}">
                ${empNovedades.map((nov) => `
                  <div class="novedad-detail-card ${statusColors[nov.status] || 'cov-neutral'}">
                    <div class="novedad-detail-head">
                      <div>
                        <strong>${escapeHtml(nov.type || "Otro")}</strong>
                        <span class="novedad-detail-date">${escapeHtml(nov.date || "")}</span>
                      </div>
                      <span class="novedad-status-chip ${statusColors[nov.status] || ''}">${escapeHtml(nov.status || "PENDIENTE")}</span>
                    </div>
                    ${nov.description ? `<p class="novedad-detail-desc">${escapeHtml(nov.description)}</p>` : ""}
                    <div class="novedad-detail-meta">
                      <span>Registrado por: <strong>${escapeHtml(nov.registeredByName || nov.registeredBy || "—")}</strong></span>
                      ${nov.documentBase64
                        ? `<a href="${escapeAttr(nov.documentBase64)}" target="_blank" class="novedad-doc-link">Ver documento</a>`
                        : `<span class="novedad-no-doc">Sin documento</span>`}
                    </div>
                    ${nov.reviewNote ? `<p class="novedad-review-note">Nota revisión: ${escapeHtml(nov.reviewNote)}</p>` : ""}
                    ${nov.status === "PENDIENTE" ? `
                      <div class="novedad-review-actions">
                        <button type="button" class="btn btn-row novedad-approve-btn" data-nov-id="${escapeAttr(String(nov.id))}">✓ Aprobar</button>
                        <button type="button" class="btn btn-row novedad-reject-btn" data-nov-id="${escapeAttr(String(nov.id))}">✕ Rechazar</button>
                      </div>` : ""}
                  </div>`).join("")}
              </div>`;
          }).join("")}
        </div>
      </section>
    </div>
  `;
}

export function wireNovedadesPersonalEvents() {
  setTimeout(() => {
    document.querySelectorAll(".btn-add-novedad").forEach((btn) => {
      btn.addEventListener("click", () => {
        const empId = btn.dataset.novedadEmpId;
        document.getElementById(`novedad-form-${empId}`)?.classList.toggle("hidden");
        document.getElementById(`novedad-detail-${empId}`)?.classList.add("hidden");
      });
    });

    document.querySelectorAll(".btn-cancel-novedad").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById(`novedad-form-${btn.dataset.cancelEmpId}`)?.classList.add("hidden");
      });
    });

    document.querySelectorAll(".btn-ver-novedades").forEach((btn) => {
      btn.addEventListener("click", () => {
        const empId = btn.dataset.novedadEmpId;
        document.getElementById(`novedad-detail-${empId}`)?.classList.toggle("hidden");
        document.getElementById(`novedad-form-${empId}`)?.classList.add("hidden");
      });
    });

    document.querySelectorAll(".novedad-inline-form").forEach((form) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const empId      = form.dataset.formEmpId;
        const type        = form.querySelector("[name='type']")?.value || "";
        const date        = form.querySelector("[name='date']")?.value || "";
        const description = form.querySelector("[name='description']")?.value || "";
        const fileInput   = form.querySelector("[name='documentFile']");

        if (!type) { showWarning("Selecciona el tipo de novedad."); return; }

        let documentBase64 = null;
        let documentName   = null;
        if (fileInput?.files?.length) {
          documentBase64 = await fileToBase64(fileInput.files[0]);
          documentName   = fileInput.files[0].name;
        }

        const btn = document.querySelector(`[data-novedad-emp-id="${empId}"]`);
        const empName = form.closest(".novedad-emp-row")?.querySelector(".novedad-emp-name")?.textContent?.trim() || "";
        const munId   = btn?.dataset?.novedadMunId || "";
        const munName = btn?.dataset?.novedadMunName || "";
        const cargo   = btn?.dataset?.novedadCargo || "";

        try {
          const submitBtn = form.querySelector("[type='submit']");
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Guardando..."; }
          await apiFetch("/novedades", {
            method: "POST",
            body: JSON.stringify({ employeeId: empId, employeeName: empName, municipalityId: munId, municipalityName: munName, cargo, type, date, description, documentBase64, documentName }),
          });
          await openModule("nomina_novedades");
        } catch (err) {
          showError(err.message || "Error al registrar la novedad.");
        }
      });
    });

    document.querySelectorAll(".novedad-approve-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await apiFetch(`/novedades/${btn.dataset.novId}/status`, {
            method: "PUT",
            body: JSON.stringify({ status: "APROBADO", reviewNote: "" }),
          });
          await openModule("nomina_novedades");
        } catch (err) {
          showError(err.message || "Error al aprobar.");
        }
      });
    });

    document.querySelectorAll(".novedad-reject-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const note = prompt("Motivo del rechazo (opcional):") || "";
        try {
          await apiFetch(`/novedades/${btn.dataset.novId}/status`, {
            method: "PUT",
            body: JSON.stringify({ status: "RECHAZADO", reviewNote: note }),
          });
          await openModule("nomina_novedades");
        } catch (err) {
          showError(err.message || "Error al rechazar.");
        }
      });
    });
  }, 0);
}
