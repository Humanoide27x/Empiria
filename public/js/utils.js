import { state } from './state.js';
import { apiFetch } from './api.js';
import { DOC_TYPE_LABELS, MUNICIPALITIES_BY_DEPARTMENT } from './constants.js';
import { showWarning } from './toast.js';

// ── String helpers ────────────────────────────────────────────────────────────

export function prettyLabel(text) {
  return String(text || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Print / Export ────────────────────────────────────────────────────────────

export function printHtml(element, title) {
  if (!element) { showWarning("No se encontró el contenido para imprimir."); return; }
  const win = window.open("", "_blank", "width=960,height=720");
  if (!win) { showWarning("El navegador bloqueó la ventana emergente. Permite ventanas emergentes e intenta de nuevo."); return; }
  win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title || "EMPIRIA"}</title>
  <link rel="stylesheet" href="/styles.css"/>
  <style>
    body { margin: 0; padding: 24px; background: #fff; }
    @media print { @page { margin: 1.5cm; } body { padding: 0; } }
  </style>
</head>
<body>
  ${element.outerHTML}
  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 400);
    });
  <\/script>
</body>
</html>`);
  win.document.close();
}

export function savePdf(element) {
  if (!element) { showWarning("No se encontró el contenido para exportar."); return; }
  const win = window.open("", "_blank", "width=960,height=720");
  if (!win) { showWarning("El navegador bloqueó la ventana emergente. Permite ventanas emergentes e intenta de nuevo."); return; }
  win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title> </title>
  <link rel="stylesheet" href="/styles.css"/>
  <style>
    body { margin: 0; padding: 15mm 18mm 8mm; background: #fff; }
    @page {
      size: A4;
      margin: 0 0 18mm 0;
      @bottom-center {
        content: "Página " counter(page) " de " counter(pages);
        font-size: 9pt;
        color: #64748b;
        font-family: Arial, sans-serif;
      }
    }
  </style>
</head>
<body>
  ${element.outerHTML}
  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); window.close(); }, 400);
    });
  <\/script>
</body>
</html>`);
  win.document.close();
}

export function exportToExcel(headers, dataRows, filename) {
  const th = headers.map(h => `<th style="background:#0f172a;color:#fff;font-weight:bold;padding:6px 10px;white-space:nowrap">${String(h).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</th>`).join("");
  const tr = dataRows.map(row =>
    `<tr>${row.map(c => `<td style="padding:5px 8px;border:1px solid #e2e8f0;white-space:nowrap">${String(c ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</td>`).join("")}</tr>`
  ).join("");
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:x='urn:schemas-microsoft-com:office:excel' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='UTF-8'/></head><body><table border='1'><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></body></html>`;
  const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename + ".xls";
  a.click();
  URL.revokeObjectURL(url);
}

// ── Select helpers ────────────────────────────────────────────────────────────

export function renderOptions(items, currentValue = "", placeholder = "Selecciona") {
  return `
    <option value="">${placeholder}</option>
    ${items.map((item) => {
      const value = item && typeof item === "object" ? item.id ?? item.value ?? item.name ?? "" : item;
      const label = item && typeof item === "object" ? item.name ?? item.label ?? item.value ?? "" : item;
      return `<option value="${escapeAttr(value)}" ${
        String(currentValue) === String(value) || String(currentValue) === String(label) ? "selected" : ""
      }>${label}</option>`;
    }).join("")}
  `;
}

export function fillSelect(select, values) {
  if (!select) return;
  select.innerHTML = values.map((value) => `<option value="${value}">${prettyLabel(value)}</option>`).join("");
}

export function fillOptionSelect(select, items, { valueKey, labelBuilder, includeEmpty }) {
  if (!select) return;
  const emptyOption = includeEmpty ? '<option value="">Sin asignar</option>' : "";
  select.innerHTML = emptyOption + items.map((item) => `<option value="${item[valueKey]}">${labelBuilder(item)}</option>`).join("");
}

// ── SVG icon helper ───────────────────────────────────────────────────────────

export function iconSvg(pathMarkup) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${pathMarkup}</svg>`;
}

export function getModuleMeta(moduleKey) {
  const moduleMap = {
    dashboard: {
      label: "Dashboard",
      // LayoutGrid — 4 paneles = vista general
      icon: iconSvg(`<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`),
    },
    dashboard_hr: {
      label: "Dashboard HR",
      // Activity — pulso / indicadores de personal
      icon: iconSvg(`<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`),
    },
    gestion_personal: {
      label: "Gestión del Personal",
      // Users — grupo de personas
      icon: iconSvg(`<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`),
    },
    cobertura_calculadora: {
      label: "Verificación de Cobertura",
      // MapPin — cobertura geográfica PAE
      icon: iconSvg(`<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>`),
    },
    nomina_novedades: {
      label: "Nómina",
      // Receipt — recibo / comprobante de nómina
      icon: iconSvg(`<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/>`),
    },
    calculadora_personal: {
      label: "Calculadora",
      // Calculator — cálculo de planta
      icon: iconSvg(`<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="8" y2="11" stroke-width="3" stroke-linecap="round"/><line x1="12" y1="11" x2="12" y2="11" stroke-width="3" stroke-linecap="round"/><line x1="16" y1="11" x2="16" y2="11" stroke-width="3" stroke-linecap="round"/><line x1="8" y1="15" x2="8" y2="15" stroke-width="3" stroke-linecap="round"/><line x1="12" y1="15" x2="12" y2="15" stroke-width="3" stroke-linecap="round"/><line x1="16" y1="15" x2="16" y2="15" stroke-width="3" stroke-linecap="round"/><line x1="8" y1="19" x2="16" y2="19"/>`),
    },
    capacitaciones_asistencia: {
      label: "Capacitaciones y Asistencia",
      // BookOpen — formación / aprendizaje
      icon: iconSvg(`<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`),
    },
    informes_reportes: {
      label: "Informes y Reportes",
      // FileBarChart — documento con gráfica
      icon: iconSvg(`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="18" x2="8" y2="13"/><line x1="12" y1="18" x2="12" y2="9"/><line x1="16" y1="18" x2="16" y2="15"/>`),
    },
    solicitudes_empleados: {
      label: "Solicitudes de Empleados",
      // ClipboardList — solicitud / formulario
      icon: iconSvg(`<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><line x1="12" y1="11" x2="16" y2="11"/><line x1="12" y1="16" x2="16" y2="16"/><line x1="8" y1="11" x2="8.01" y2="11" stroke-width="3" stroke-linecap="round"/><line x1="8" y1="16" x2="8.01" y2="16" stroke-width="3" stroke-linecap="round"/>`),
    },
    administracion_configuraciones: {
      label: "Administración y Configuraciones",
      // SlidersHorizontal — controles / ajustes
      icon: iconSvg(`<line x1="4" y1="6" x2="20" y2="6"/><circle cx="14" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="8" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="17" cy="18" r="2"/>`),
    },
  };
  return moduleMap[moduleKey] || { label: prettyLabel(moduleKey), icon: iconSvg(`<circle cx="12" cy="12" r="3"></circle>`) };
}

// ── Message helpers ───────────────────────────────────────────────────────────

export function showLoginMessage(message, isError = true) {
  const el = document.getElementById("loginMessage");
  if (!el) return;
  el.textContent = message || "";
  el.style.color = isError ? "#9d2f2f" : "#0d6b5b";
}

export function showAdminCreateMessage(message, isError = true) {
  const el = document.getElementById("adminCreateMessage");
  if (!el) return;
  el.textContent = message || "";
  el.style.color = isError ? "#9d2f2f" : "#0d6b5b";
}

// ── Data formatting ───────────────────────────────────────────────────────────

export function toMunicipalityArray(text) {
  return String(text || "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function formatCompany(companyId) {
  if (companyId === null || companyId === undefined || companyId === "") return "Sin asignar";
  const found = state.companies.find((item) => item.id === Number(companyId));
  return found ? found.name : `Empresa #${companyId}`;
}

export function formatContract(contractId) {
  if (contractId === null || contractId === undefined || contractId === "") return "Sin asignar";
  const found = state.contracts.find((item) => item.id === Number(contractId));
  return found ? found.name : `Contrato #${contractId}`;
}

export function getCompanyOptionsHtml(currentValue = "") {
  return `
    <option value="">Selecciona empresa</option>
    ${state.companies.map((company) => `
      <option value="${company.id}" ${String(currentValue) === String(company.id) ? "selected" : ""}>
        ${company.name}
      </option>
    `).join("")}
  `;
}

export function getContractOptionsHtml(companyId, currentValue = "") {
  const selectedCompanyId = Number(companyId || 0);
  const contracts = state.contracts.filter(
    (contract) => !selectedCompanyId || Number(contract.companyId) === selectedCompanyId
  );
  return `
    <option value="">Selecciona contrato</option>
    ${contracts.map((contract) => `
      <option value="${contract.id}" ${String(currentValue) === String(contract.id) ? "selected" : ""}>
        ${contract.name}
      </option>
    `).join("")}
  `;
}

export function getDepartmentMunicipalities(departmentName) {
  return MUNICIPALITIES_BY_DEPARTMENT[departmentName] || [];
}

export function normalizeMunicipalityText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function getOfficialMunicipalities({ includeFallback = false } = {}) {
  const official = Array.isArray(state.municipalities) ? state.municipalities.filter(Boolean) : [];
  if (official.length) return official;
  return [];
}

export async function ensureOfficialMunicipalitiesLoaded({ force = false } = {}) {
  if (!force && Array.isArray(state.municipalities) && state.municipalities.length) {
    return state.municipalities;
  }

  const payload = await apiFetch("/municipalities");
  const catalog = Array.isArray(payload?.data) ? payload.data : [];
  state.municipalities = catalog.map((item) => ({
    id: Number(item.id),
    name: String(item.name || "").trim(),
    normalized_name: String(item.normalized_name || "").trim(),
    department: String(item.department || "").trim(),
    active: item.active !== false,
  }));
  return state.municipalities;
}

export function findOfficialMunicipality(value, { includeFallback = false } = {}) {
  const catalog = getOfficialMunicipalities({ includeFallback });
  const raw = String(value ?? "").trim();
  const normalized = normalizeMunicipalityText(raw);
  if (!raw && !normalized) return null;

  return catalog.find((item) =>
    String(item.id) === raw
    || normalizeMunicipalityText(item.name) === normalized
    || normalizeMunicipalityText(item.normalized_name) === normalized
  ) || null;
}

// ── Personnel data helpers ────────────────────────────────────────────────────

export function getPersonnelFullName(item) {
  if (item.fullName) return item.fullName;
  return [
    item.primer_nombre, item.segundo_nombre,
    item.primer_apellido, item.segundo_apellido,
    item.firstName, item.secondName,
    item.firstLastName, item.secondLastName,
  ].filter(Boolean).join(" ").trim() || "Sin nombre";
}

export function getPersonnelRole(item) {
  return item.cargo_real || item.position || item.cargo || "Sin cargo";
}

export function getPersonnelMunicipality(item = {}) {
  const explicitName = item.municipalityName || item.municipality_name || "";
  if (String(explicitName || "").trim()) return String(explicitName).trim();

  const value = item.municipalityId || item.municipality_id || item.municipio_id || item.municipality || item.municipio || "";
  if (!value) return "-";
  const found = findOfficialMunicipality(value);
  return found ? found.name : String(value);
}

// ── Personnel form helpers ────────────────────────────────────────────────────

export function isInstitutionalTabEnabled(cargoReal) {
  return String(cargoReal || "").toUpperCase() === "OPERARIO MANIPULADOR DE ALIMENTOS";
}

export function syncPersonnelDraftField(target) {
  if (!target?.name) return;
  if (target.type === "checkbox") {
    state.personnelDraft[target.name] = target.checked ? "true" : "";
    return;
  }
  if (target.multiple) {
    const values = Array.from(target.selectedOptions).map((option) => option.value);
    state.personnelDraft[target.name] = values.join("|");
    return;
  }
  state.personnelDraft[target.name] = target.value;
}

export function enforceInputRestrictions(form) {
  if (!form) return;
  form.querySelectorAll("[data-only-letters]").forEach((field) => {
    field.addEventListener("input", () => {
      field.value = field.value.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]/g, "");
      syncPersonnelDraftField(field);
    });
  });
  form.querySelectorAll("[data-only-numbers]").forEach((field) => {
    field.addEventListener("input", () => {
      field.value = field.value.replace(/\D/g, "");
      syncPersonnelDraftField(field);
    });
  });
}

export function syncEmployeeHeaderFromDraft() {
  const employeeHeaderName     = document.getElementById("employeeHeaderName");
  const employeeHeaderDocument = document.getElementById("employeeHeaderDocument");

  const fullNameParts = [
    state.personnelDraft.firstName || "",
    state.personnelDraft.secondName || "",
    state.personnelDraft.firstLastName || "",
    state.personnelDraft.secondLastName || "",
  ].filter(Boolean);

  const fullName = fullNameParts.length
    ? fullNameParts.join(" ").toUpperCase()
    : "NOMBRE COMPLETO DE LA PERSONA";

  if (employeeHeaderName) employeeHeaderName.textContent = fullName;

  const docType   = state.personnelDraft.documentType || "";
  const docNumber = state.personnelDraft.documentNumber || "";
  const docLabel  = DOC_TYPE_LABELS[docType] || docType || "Tipo de documento";

  if (employeeHeaderDocument) {
    employeeHeaderDocument.textContent =
      docType || docNumber ? `${docLabel} ${docNumber}`.trim() : "Tipo de documento y número de documento";
  }
}

export function autoSetResidenceCertificateDate() {
  const hasExpiration = state.personnelDraft.residenceCertificateHasExpiration === "true";
  if (hasExpiration) return;

  const expeditionYear  = Number(state.personnelDraft.expeditionYear || 0);
  const expeditionMonth = Number(state.personnelDraft.expeditionMonth || 0);
  const expeditionDay   = Number(state.personnelDraft.expeditionDay || 0);

  if (!expeditionYear || !expeditionMonth || !expeditionDay) return;

  const baseDate = new Date(expeditionYear, expeditionMonth - 1, expeditionDay);
  if (Number.isNaN(baseDate.getTime())) return;

  baseDate.setMonth(baseDate.getMonth() + 6);

  const yyyy = baseDate.getFullYear();
  const mm   = String(baseDate.getMonth() + 1).padStart(2, "0");
  const dd   = String(baseDate.getDate()).padStart(2, "0");

  state.personnelDraft.residenceCertificateExpiration = `${yyyy}-${mm}-${dd}`;
}

// ── MFA helpers ───────────────────────────────────────────────────────────────

export function ensureMfaField() {
  const mfaFieldWrap = document.getElementById("mfaFieldWrap");
  const mfaCode      = document.getElementById("mfaCode");
  if (!mfaFieldWrap || !mfaCode) return;
  mfaFieldWrap.classList.add("hidden");
  mfaCode.value = "";
  mfaCode.removeAttribute("required");
}

export function showMfaField(show = true) {
  const mfaFieldWrap = document.getElementById("mfaFieldWrap");
  const mfaCode      = document.getElementById("mfaCode");
  if (!mfaFieldWrap || !mfaCode) return;
  if (show) {
    mfaFieldWrap.classList.remove("hidden");
    mfaCode.setAttribute("required", "required");
    setTimeout(() => mfaCode.focus(), 0);
  } else {
    mfaFieldWrap.classList.add("hidden");
    mfaCode.removeAttribute("required");
    mfaCode.value = "";
  }
}

export function resetMfaState() {
  state.requiresMfa  = false;
  state.tempUsername = "";
  state.tempPassword = "";
  showMfaField(false);
}
