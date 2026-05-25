import { state } from "../state.js";
import { apiFetch } from "../api.js";
import { escapeAttr, escapeHtml } from "../utils.js";
import { showError, showSuccess } from "../toast.js";

const ui = {
  contractId: null,
  summary: null,
  meta: null,
  companies: [],
  contracts: [],
  masterPositions: [],
  masterAreas: [],
  masterDocumentTypes: [],
  masterExperienceTypes: [],
  masterModalities: [],
  contractMunicipalities: [],
  contractModalities: [],
  positionRules: [],
  documentMatrix: null,
  documentRules: [],
  experienceRules: [],
  coverageRules: [],
  selectorCompanyId: "",
  selectorContractId: "",
  documentMatrixFilter: "ACTIVE",
  documentMatrixPending: {},
  editingMasterDocumentId: null,
  selectedPositionRuleId: null,
  editingPositionRuleId: null,
  editingDocumentRuleId: null,
  editingExperienceRuleId: null,
  editingCoverageRuleId: null,
};

const POSITION_CATEGORIES = [
  "Operativo",
  "Supervision",
  "Administrativo",
  "Territorial",
  "Directivo",
  "Apoyo",
  "Servicios Generales",
];

function listFromResponse(payload, fallbackKey = null) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (fallbackKey && Array.isArray(payload?.[fallbackKey])) return payload[fallbackKey];
  return [];
}

function toId(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isChecked(value) {
  return value ? "checked" : "";
}

function selectedAttr(currentValue, optionValue) {
  return String(currentValue ?? "") === String(optionValue ?? "") ? "selected" : "";
}

function buildOptionList(items, currentValue, getValue, getLabel, placeholder) {
  const options = (items || []).map((item) => (
    `<option value="${escapeAttr(getValue(item))}" ${selectedAttr(currentValue, getValue(item))}>${escapeHtml(getLabel(item))}</option>`
  )).join("");
  return `<option value="">${escapeHtml(placeholder)}</option>${options}`;
}

function contractLabel(contract) {
  const code = contract.code ? `${contract.code} - ` : "";
  return `${code}${contract.name || `Contrato ${contract.id}`}`;
}

function boolLabel(value, positive = "Si", negative = "No") {
  return value ? positive : negative;
}

function badge(text, kind = "neutral") {
  return `<span class="ctc-badge ctc-badge-${escapeAttr(kind)}">${escapeHtml(text)}</span>`;
}

function cardStat(label, value, helper = "") {
  return `
    <article class="ctc-stat">
      <span class="ctc-stat-label">${escapeHtml(label)}</span>
      <strong class="ctc-stat-value">${escapeHtml(String(value ?? 0))}</strong>
      <small class="ctc-stat-helper">${escapeHtml(helper)}</small>
    </article>
  `;
}

function getSelectedPositionRule() {
  return ui.positionRules.find((item) => item.id === ui.selectedPositionRuleId) || null;
}

function getEditingPositionRule() {
  return ui.positionRules.find((item) => item.id === ui.editingPositionRuleId) || null;
}

function getEditingDocumentRule() {
  return ui.documentRules.find((item) => item.id === ui.editingDocumentRuleId) || null;
}

function getEditingExperienceRule() {
  return ui.experienceRules.find((item) => item.id === ui.editingExperienceRuleId) || null;
}

function getEditingCoverageRule() {
  return ui.coverageRules.find((item) => item.id === ui.editingCoverageRuleId) || null;
}

function positionRuleStaffingMode(rule) {
  return String(rule?.bidPositionName || "").toUpperCase() === "EXTRA" ? "EXTRA" : "LICITACION";
}

function getPositionFormDefaults() {
  const editing = getEditingPositionRule();
  return {
    id: editing?.id || "",
    masterPositionId: editing?.masterPositionId || "",
    staffingMode: positionRuleStaffingMode(editing),
    code: editing?.code || "",
    name: editing?.name || "",
    bidPositionName: editing?.bidPositionName || "",
    operationalPositionName: editing?.operationalPositionName || "",
    documentRuleSource: editing?.documentRuleSource || "",
    areaCode: editing?.areaCode || "",
    category: editing?.category || "",
    countsForCoverage: Boolean(editing?.countsForCoverage),
    active: editing ? Boolean(editing.active) : true,
  };
}

function isContractCoverageEnabled() {
  return ui.summary?.coverageSettings?.enabled === true || ui.summary?.coverageEnabled === true;
}

function getMasterPosition(masterPositionId) {
  return ui.masterPositions.find((item) => String(item.id) === String(masterPositionId)) || null;
}

function computeDocumentRuleSource(staffingMode, bidPositionName, operationalPositionName) {
  const normalizedMode = String(staffingMode || "LICITACION").toUpperCase();
  const bid = String(bidPositionName || "").trim();
  const operational = String(operationalPositionName || "").trim();
  return normalizedMode === "EXTRA" ? operational : bid;
}

function getDocumentMatrixDocuments() {
  return Array.isArray(ui.documentMatrix?.documents) ? ui.documentMatrix.documents : [];
}

function getDocumentMatrixPositions() {
  return Array.isArray(ui.documentMatrix?.positions) ? ui.documentMatrix.positions : [];
}

function getEditingMasterDocument() {
  return getDocumentMatrixDocuments().find((item) => item.id === ui.editingMasterDocumentId) || null;
}

function getDocumentMatrixPendingEntries() {
  return Object.values(ui.documentMatrixPending || {});
}

function getDocumentMatrixCellKey(documentId, positionId) {
  return `${documentId}:${positionId}`;
}

function getDocumentMatrixCell(documentId, positionId) {
  const document = getDocumentMatrixDocuments().find((item) => item.id === documentId);
  if (!document) return null;
  return (document.cells || []).find((cell) => cell.contractPositionRuleId === positionId) || null;
}

function isDocumentMatrixCellChecked(documentId, positionId) {
  const pending = ui.documentMatrixPending[getDocumentMatrixCellKey(documentId, positionId)];
  if (pending) return pending.checked === true;
  return Boolean(getDocumentMatrixCell(documentId, positionId)?.checked);
}

function getFilteredDocumentMatrixRows() {
  const filter = String(ui.documentMatrixFilter || "ALL").toUpperCase();
  return getDocumentMatrixDocuments().filter((document) => {
    if (filter === "GLOBAL") return document.isGlobalBase === true;
    if (filter === "CONTRACTUAL") return document.isGlobalBase !== true;
    if (filter === "ACTIVE") return document.active !== false;
    if (filter === "INACTIVE") return document.active === false;
    return true;
  });
}

function getMasterDocumentFormDefaults() {
  const editing = getEditingMasterDocument();
  return {
    id: editing?.id || "",
    code: editing?.code || "",
    name: editing?.name || "",
    description: editing?.description || "",
    phase: editing?.phase || "",
    isGlobalBase: editing ? Boolean(editing.isGlobalBase) : false,
    defaultExpires: editing ? Boolean(editing.defaultExpires) : false,
    defaultAlertDaysBeforeExpiration: editing?.defaultAlertDaysBeforeExpiration ?? 30,
    visibleToAuditor: editing ? Boolean(editing.visibleToAuditor) : true,
    active: editing ? Boolean(editing.active) : true,
  };
}

function countDocumentHistoricalUsage(document) {
  return Number(document?.contractRuleCount || 0)
    + Number(document?.employeeDocumentCount || 0)
    + Number(document?.legacyEmployeeDocumentCount || 0)
    + Number(document?.legacyContractRuleCount || 0);
}

function hasDuplicateMasterDocumentCode(code, excludeId = null) {
  const normalized = String(code || "").trim().toLowerCase();
  if (!normalized) return false;
  return getDocumentMatrixDocuments().some((item) => (
    item.id !== excludeId
    && String(item.code || "").trim().toLowerCase() === normalized
  ));
}

function hasDuplicateMasterDocumentName(name, excludeId = null) {
  const normalized = String(name || "").trim().toUpperCase();
  if (!normalized) return false;
  return getDocumentMatrixDocuments().some((item) => (
    item.id !== excludeId
    && String(item.name || "").trim().toUpperCase() === normalized
  ));
}

function getDocumentFormDefaults() {
  const editing = getEditingDocumentRule();
  return {
    id: editing?.id || "",
    contractPositionRuleId: editing?.contractPositionRuleId || ui.selectedPositionRuleId || "",
    masterDocumentTypeId: editing?.masterDocumentTypeId || "",
    required: editing ? Boolean(editing.required) : true,
    expires: Boolean(editing?.expires),
    alertDaysBeforeExpiration: editing?.alertDaysBeforeExpiration ?? 30,
    requiresApproval: editing ? Boolean(editing.requiresApproval) : true,
    validationMode: editing?.validationMode || "DOCUMENTAL",
    active: editing ? Boolean(editing.active) : true,
    notes: editing?.notes || "",
  };
}

function getExperienceFormDefaults() {
  const editing = getEditingExperienceRule();
  return {
    id: editing?.id || "",
    contractPositionRuleId: editing?.contractPositionRuleId || ui.selectedPositionRuleId || "",
    masterExperienceTypeId: editing?.masterExperienceTypeId || "",
    appliesToStaffingType: editing?.appliesToStaffingType || "ANY",
    specificityType: editing?.specificityType || "GENERAL",
    minimumMonths: editing?.minimumMonths ?? 0,
    active: editing ? Boolean(editing.active) : true,
    notes: editing?.notes || "",
  };
}

function getCoverageFormDefaults() {
  const editing = getEditingCoverageRule();
  return {
    id: editing?.id || "",
    contractPositionRuleId: editing?.contractPositionRuleId || ui.selectedPositionRuleId || "",
    masterModalityId: editing?.masterModalityId || "",
    coverageMode: editing?.coverageMode || "UPLOAD",
    enabled: editing ? Boolean(editing.enabled) : true,
    active: editing ? Boolean(editing.active) : true,
    minimumCupos: editing?.minimumCupos ?? "",
    maximumCupos: editing?.maximumCupos ?? "",
    requiredTc: editing?.requiredTc ?? "",
    requiredMt: editing?.requiredMt ?? "",
    notes: editing?.notes || "",
  };
}

function renderPositionRows() {
  if (!ui.positionRules.length) {
    return `<tr><td colspan="8" class="ctc-empty-row">No hay cargos configurados para este contrato.</td></tr>`;
  }

  return ui.positionRules.map((rule) => {
    const selected = rule.id === ui.selectedPositionRuleId;
    const staffingMode = positionRuleStaffingMode(rule);
    return `
      <tr class="${selected ? "ctc-row-selected" : ""}">
        <td>${escapeHtml(rule.code || "-")}</td>
        <td>
          <div class="ctc-cell-title">${escapeHtml(rule.name || "-")}</div>
          <div class="ctc-cell-sub">${escapeHtml(rule.documentRuleSource || "-")}</div>
        </td>
        <td>${badge(staffingMode === "EXTRA" ? "EXTRA" : "Licitacion", staffingMode === "EXTRA" ? "warn" : "info")}</td>
        <td>${escapeHtml(rule.bidPositionName || "-")}</td>
        <td>${escapeHtml(rule.operationalPositionName || "-")}</td>
        <td>${escapeHtml(rule.areaName || rule.areaCode || "-")}</td>
        <td>${boolLabel(rule.countsForCoverage)}</td>
        <td class="ctc-actions">
          <button type="button" class="ctc-btn-link" data-action="select-position" data-id="${rule.id}">Seleccionar</button>
          <button type="button" class="ctc-btn-link" data-action="edit-position" data-id="${rule.id}">Editar</button>
          <button type="button" class="ctc-btn-link" data-action="${rule.active ? "deactivate-position" : "activate-position"}" data-id="${rule.id}">
            ${rule.active ? "Desactivar" : "Activar"}
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function renderDocumentRows() {
  const rows = ui.documentRules.filter((rule) => {
    if (!ui.selectedPositionRuleId) return true;
    return rule.contractPositionRuleId === ui.selectedPositionRuleId || !rule.contractPositionRuleId;
  });

  if (!rows.length) {
    return `<tr><td colspan="8" class="ctc-empty-row">No hay documentos configurados para el cargo seleccionado.</td></tr>`;
  }

  return rows.map((rule) => `
    <tr>
      <td>${escapeHtml(rule.documentCode || "-")}</td>
      <td>
        <div class="ctc-cell-title">${escapeHtml(rule.documentName || "-")}</div>
        <div class="ctc-cell-sub">${escapeHtml(rule.contractPositionName || "Regla general del contrato")}</div>
      </td>
      <td>${rule.isGlobalBase ? badge("Base global", "success") : badge(rule.phase || "-", "neutral")}</td>
      <td>${boolLabel(rule.required)}</td>
      <td>${boolLabel(rule.expires)}</td>
      <td>${escapeHtml(String(rule.alertDaysBeforeExpiration ?? "-"))}</td>
      <td>${escapeHtml(rule.validationMode || "-")}</td>
      <td class="ctc-actions">
        <button type="button" class="ctc-btn-link" data-action="edit-document" data-id="${rule.id}">Editar</button>
        <button type="button" class="ctc-btn-link" data-action="${rule.active ? "deactivate-document" : "activate-document"}" data-id="${rule.id}">
          ${rule.active ? "Desactivar" : "Activar"}
        </button>
      </td>
    </tr>
  `).join("");
}

function renderDocumentMatrixHeader() {
  const positions = getDocumentMatrixPositions();
  return positions.map((position) => `
    <th class="ctc-matrix-col">
      <div class="ctc-matrix-col-title">${escapeHtml(position.code || "-")}</div>
      <div class="ctc-matrix-col-sub">${escapeHtml(position.name || "-")}</div>
    </th>
  `).join("");
}

function renderDocumentMatrixRows() {
  const positions = getDocumentMatrixPositions();
  const rows = getFilteredDocumentMatrixRows();

  if (!positions.length) {
    return `<tr><td colspan="2" class="ctc-empty-row">Primero configura al menos un cargo contractual para habilitar la matriz documental.</td></tr>`;
  }

  if (!rows.length) {
    return `<tr><td colspan="${positions.length + 2}" class="ctc-empty-row">No hay documentos para el filtro seleccionado.</td></tr>`;
  }

  return rows.map((document) => {
    const historyCount = countDocumentHistoricalUsage(document);
    const usageBadge = document.isGlobalBase
      ? badge("Base global", "success")
      : badge(document.active ? "Contractual" : "Inactivo", document.active ? "info" : "neutral");

    const cellsHtml = positions.map((position) => {
      const pending = ui.documentMatrixPending[getDocumentMatrixCellKey(document.id, position.id)];
      const checked = isDocumentMatrixCellChecked(document.id, position.id);
      const changed = Boolean(pending);
      const locked = document.isGlobalBase === true || document.active === false;
      return `
        <td class="ctc-matrix-cell ${changed ? "ctc-matrix-cell-dirty" : ""}">
          <label class="ctc-matrix-check ${locked ? "ctc-matrix-check-locked" : ""}">
            <input
              type="checkbox"
              data-action="toggle-document-matrix-cell"
              data-document-id="${document.id}"
              data-position-id="${position.id}"
              ${checked ? "checked" : ""}
              ${locked ? "disabled" : ""}
            >
            <span></span>
          </label>
        </td>
      `;
    }).join("");

    return `
      <tr>
        <td class="ctc-matrix-doc-col">
          <div class="ctc-cell-title">${escapeHtml(document.name || "-")}</div>
          <div class="ctc-cell-sub">${escapeHtml(document.code || "-")} - ${escapeHtml(document.phase || "Sin fase")}</div>
          <div class="ctc-matrix-doc-meta">
            ${usageBadge}
            ${document.defaultExpires ? badge(`Vence${document.defaultAlertDaysBeforeExpiration != null ? ` - ${document.defaultAlertDaysBeforeExpiration}d` : ""}`, "warn") : ""}
            ${historyCount ? badge(`Historial ${historyCount}`, "neutral") : badge("Sin historial", "neutral")}
          </div>
        </td>
        ${cellsHtml}
        <td class="ctc-actions ctc-matrix-action-col">
          <button type="button" class="ctc-btn-link" data-action="edit-master-document" data-id="${document.id}">Editar</button>
          ${!document.isGlobalBase ? `<button type="button" class="ctc-btn-link" data-action="deactivate-master-document" data-id="${document.id}">${document.active ? "Desactivar" : "Activar"}</button>` : ""}
          ${!document.isGlobalBase ? `<button type="button" class="ctc-btn-link" data-action="delete-master-document" data-id="${document.id}" ${document.canDelete ? "" : 'data-disabled="true"'}>Eliminar</button>` : ""}
        </td>
      </tr>
    `;
  }).join("");
}

function renderDocumentMatrixFilters() {
  const filters = [
    { key: "ALL", label: "Todos" },
    { key: "GLOBAL", label: "Globales" },
    { key: "CONTRACTUAL", label: "Contractuales" },
    { key: "ACTIVE", label: "Activos" },
    { key: "INACTIVE", label: "Inactivos" },
  ];

  return filters.map((filter) => `
    <button
      type="button"
      class="ctc-filter-btn ${String(ui.documentMatrixFilter || "ALL").toUpperCase() === filter.key ? "ctc-filter-btn-active" : ""}"
      data-action="set-document-matrix-filter"
      data-filter="${filter.key}"
    >${escapeHtml(filter.label)}</button>
  `).join("");
}

function renderDocumentMasterForm() {
  const documentForm = getMasterDocumentFormDefaults();
  return `
    <div class="ctc-form-head">
      <strong>${documentForm.id ? "Editar documento maestro" : "Agregar documento maestro"}</strong>
      <button type="button" class="ctc-btn-link" data-action="new-master-document">Nuevo</button>
    </div>
    <form id="ctcMasterDocumentForm" class="ctc-form-grid">
      <label class="ctc-field">
        <span>Nombre documento</span>
        <input type="text" name="name" value="${escapeAttr(documentForm.name)}" maxlength="180" placeholder="Ej. Tarjeta profesional" required>
        <small class="ctc-field-help">Se mostrara como fila en la matriz documental del contrato.</small>
      </label>
      <label class="ctc-field">
        <span>Codigo</span>
        <input type="text" name="code" value="${escapeAttr(documentForm.code)}" maxlength="80" placeholder="Ej. tarjeta_profesional" required>
        <small class="ctc-field-help">Debe ser unico para evitar duplicidades entre contratos e historicos.</small>
      </label>
      <label class="ctc-field">
        <span>Fase</span>
        <input type="text" name="phase" value="${escapeAttr(documentForm.phase)}" maxlength="80" placeholder="Ej. preingreso">
        <small class="ctc-field-help">Sirve para clasificar el documento dentro del ciclo documental.</small>
      </label>
      <label class="ctc-field">
        <span>Dias de alerta</span>
        <input type="number" id="ctcMasterDocumentAlertDays" name="defaultAlertDaysBeforeExpiration" min="0" value="${escapeAttr(documentForm.defaultAlertDaysBeforeExpiration)}">
        <small class="ctc-field-help">Solo aplica cuando el documento vence por defecto.</small>
      </label>
      <label class="ctc-field ctc-field-wide">
        <span>Descripcion</span>
        <textarea name="description" rows="3" placeholder="Describe el uso del documento en la operacion contractual">${escapeHtml(documentForm.description)}</textarea>
      </label>
      <label class="ctc-field ctc-check-field">
        <input type="checkbox" name="isGlobalBase" ${isChecked(documentForm.isGlobalBase)} ${documentForm.id && documentForm.isGlobalBase ? "disabled" : ""}>
        <span>Documento global base</span>
      </label>
      <label class="ctc-field ctc-check-field">
        <input type="checkbox" id="ctcMasterDocumentDefaultExpires" name="defaultExpires" ${isChecked(documentForm.defaultExpires)}>
        <span>Vence por defecto</span>
      </label>
      <label class="ctc-field ctc-check-field">
        <input type="checkbox" name="visibleToAuditor" ${isChecked(documentForm.visibleToAuditor)}>
        <span>Visible a auditor / interventoria</span>
      </label>
      <label class="ctc-field ctc-check-field">
        <input type="checkbox" name="active" ${isChecked(documentForm.active)} ${documentForm.id && documentForm.isGlobalBase ? "disabled" : ""}>
        <span>Documento activo</span>
      </label>
      <div class="ctc-field ctc-field-note ctc-field-wide">
        <span>Regla operativa</span>
        <small class="ctc-field-help">Los documentos globales base se aplican automaticamente a todos los cargos y no se pueden eliminar.</small>
      </div>
      <div class="ctc-form-actions">
        <button type="submit" class="btn btn-primary">${documentForm.id ? "Guardar documento" : "Crear documento"}</button>
      </div>
    </form>
  `;
}

function renderExperienceRows() {
  const rows = ui.experienceRules.filter((rule) => {
    if (!ui.selectedPositionRuleId) return true;
    return rule.contractPositionRuleId === ui.selectedPositionRuleId;
  });

  if (!rows.length) {
    return `<tr><td colspan="7" class="ctc-empty-row">No hay reglas de experiencia para el cargo seleccionado.</td></tr>`;
  }

  return rows.map((rule) => `
    <tr>
      <td>${escapeHtml(rule.experienceTypeCode || "-")}</td>
      <td>${escapeHtml(rule.experienceTypeName || "-")}</td>
      <td>${escapeHtml(rule.contractPositionName || "-")}</td>
      <td>${escapeHtml(rule.appliesToStaffingType || "-")}</td>
      <td>${escapeHtml(rule.specificityType || "-")}</td>
      <td>${escapeHtml(String(rule.minimumMonths ?? 0))}</td>
      <td class="ctc-actions">
        <button type="button" class="ctc-btn-link" data-action="edit-experience" data-id="${rule.id}">Editar</button>
        <button type="button" class="ctc-btn-link" data-action="${rule.active ? "deactivate-experience" : "activate-experience"}" data-id="${rule.id}">
          ${rule.active ? "Desactivar" : "Activar"}
        </button>
      </td>
    </tr>
  `).join("");
}

function renderCoverageRows() {
  if (!ui.coverageRules.length) {
    return `<tr><td colspan="8" class="ctc-empty-row">No hay reglas de cobertura para este contrato.</td></tr>`;
  }

  return ui.coverageRules.map((rule) => `
    <tr>
      <td>${escapeHtml(rule.contractPositionName || "Contrato")}</td>
      <td>${escapeHtml(rule.modalityName || "-")}</td>
      <td>${escapeHtml(rule.coverageMode || "-")}</td>
      <td>${boolLabel(rule.enabled)}</td>
      <td>${escapeHtml(String(rule.minimumCupos ?? "-"))}</td>
      <td>${escapeHtml(String(rule.maximumCupos ?? "-"))}</td>
      <td>${escapeHtml(`${rule.requiredTc ?? "-"} / ${rule.requiredMt ?? "-"}`)}</td>
      <td class="ctc-actions">
        <button type="button" class="ctc-btn-link" data-action="edit-coverage" data-id="${rule.id}">Editar</button>
        <button type="button" class="ctc-btn-link" data-action="${rule.active ? "deactivate-coverage" : "activate-coverage"}" data-id="${rule.id}">
          ${rule.active ? "Desactivar" : "Activar"}
        </button>
      </td>
    </tr>
  `).join("");
}

function renderContractualPanel() {
  const summary = ui.summary || {};
  const selectedPosition = getSelectedPositionRule();
  const positionForm = getPositionFormDefaults();
  const documentForm = getDocumentFormDefaults();
  const experienceForm = getExperienceFormDefaults();
  const coverageForm = getCoverageFormDefaults();
  const coverageEnabled = isContractCoverageEnabled();
  const municipalities = ui.contractMunicipalities.filter((item) => item.active !== false);
  const modalities = ui.contractModalities.filter((item) => item.active !== false);

  return `
    <div class="ctc-layout">
      <section class="ctc-block">
        <div class="ctc-block-head">
          <h3 class="ctc-title">A. Selector de contrato</h3>
          <p class="ctc-subtitle">Cada contrato conserva sus reglas independientes.</p>
        </div>
        <div class="ctc-selector-grid">
          <label class="ctc-field">
            <span>Empresa</span>
            <select id="ctcSelectorCompany">
              ${buildOptionList(ui.companies, ui.selectorCompanyId, (item) => item.id, (item) => item.name || `Empresa ${item.id}`, "Selecciona una empresa")}
            </select>
          </label>
          <label class="ctc-field">
            <span>Contrato</span>
            <select id="ctcSelectorContract">
              ${buildOptionList(ui.contracts, ui.selectorContractId, (item) => item.id, contractLabel, "Selecciona un contrato")}
            </select>
          </label>
          <div class="ctc-selector-actions">
            <button type="button" class="btn btn-primary" data-action="open-contract">Abrir contrato</button>
          </div>
        </div>
        <div class="ctc-stats">
          ${cardStat("Empresa", summary.companyName || "-", "Fuente contractual")}
          ${cardStat("Contrato", summary.contractName || "-", "Configuracion activa")}
          ${cardStat("Cargos", summary.positionRulesCount || 0, "Reglas contractuales")}
          ${cardStat("Documentos", summary.documentRulesCount || 0, "Reglas por contrato")}
          ${cardStat("Experiencia", summary.experienceRulesCount || 0, "Validacion requerida")}
          ${cardStat("Cobertura", summary.coverageRulesCount || 0, "Reglas configuradas")}
        </div>
      </section>

      <section class="ctc-block">
        <div class="ctc-block-head">
          <h3 class="ctc-title">B. Cargos del contrato</h3>
          <p class="ctc-subtitle">El sistema deriva automaticamente la fuente documental segun licitacion o personal EXTRA y reduce configuraciones incoherentes.</p>
        </div>
        <div class="ctc-grid-2">
          <div class="ctc-card-surface">
            <div class="ctc-table-wrap">
              <table class="ccp-users-table ctc-table">
                <thead>
                  <tr>
                    <th>Codigo</th>
                    <th>Cargo</th>
                    <th>Tipo</th>
                    <th>Licitacion</th>
                    <th>Operativo</th>
                    <th>Area</th>
                    <th>Cobertura</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>${renderPositionRows()}</tbody>
              </table>
            </div>
          </div>
          <div class="ctc-card-surface">
            <div class="ctc-form-head">
              <strong>${positionForm.id ? "Editar cargo contractual" : "Agregar cargo contractual"}</strong>
              <button type="button" class="ctc-btn-link" data-action="new-position">Nuevo</button>
            </div>
            <form id="ctcPositionForm" class="ctc-form-grid">
              <label class="ctc-field">
                <span>Cargo maestro</span>
                <select name="masterPositionId" id="ctcMasterPositionId">
                  ${buildOptionList(ui.masterPositions, positionForm.masterPositionId, (item) => item.id, (item) => `${item.code} - ${item.bidPositionName || item.operationalPositionName || item.documentRuleSource}`, "Sin cargo maestro")}
                </select>
                <small class="ctc-field-help">Si seleccionas un cargo maestro, el formulario toma sus referencias base y ajusta la logica contractual.</small>
              </label>
              <label class="ctc-field">
                <span>Tipo de personal</span>
                <select name="staffingMode" id="ctcStaffingMode">
                  <option value="LICITACION" ${selectedAttr(positionForm.staffingMode, "LICITACION")}>Licitacion</option>
                  <option value="EXTRA" ${selectedAttr(positionForm.staffingMode, "EXTRA")}>EXTRA</option>
                </select>
                <small class="ctc-field-help">Licitacion usa el cargo del pliego. EXTRA fuerza cargo licitacion = EXTRA y exige cargo operativo.</small>
              </label>
              <label class="ctc-field">
                <span>Codigo</span>
                <input type="text" name="code" id="ctcPositionCode" value="${escapeAttr(positionForm.code)}" maxlength="40" placeholder="Ej. CZO, OMA, EXTRA_TH">
                <small class="ctc-field-help">Debe ser unico dentro del contrato.</small>
              </label>
              <label class="ctc-field">
                <span>Nombre contractual</span>
                <input type="text" name="name" id="ctcPositionName" value="${escapeAttr(positionForm.name)}" maxlength="180" required placeholder="Nombre con el que se configurara la regla contractual">
                <small class="ctc-field-help">Este nombre identifica la regla del contrato y sus validaciones.</small>
              </label>
              <label class="ctc-field">
                <span>Cargo licitacion</span>
                <input type="text" name="bidPositionName" id="ctcBidPositionName" value="${escapeAttr(positionForm.bidPositionName)}" maxlength="180" placeholder="Cargo presentado en el pliego">
                <small class="ctc-field-help" id="ctcBidPositionHelp">Si el tipo es EXTRA, este campo se fija automaticamente en EXTRA.</small>
              </label>
              <label class="ctc-field">
                <span>Cargo operativo</span>
                <input type="text" name="operationalPositionName" id="ctcOperationalPositionName" value="${escapeAttr(positionForm.operationalPositionName)}" maxlength="180" placeholder="Cargo o funcion real en la operacion">
                <small class="ctc-field-help" id="ctcOperationalPositionHelp">Obligatorio para personal EXTRA. Opcional para licitacion.</small>
              </label>
              <label class="ctc-field">
                <span>Fuente documental</span>
                <input type="text" name="documentRuleSource" id="ctcDocumentRuleSource" value="${escapeAttr(positionForm.documentRuleSource)}" maxlength="180" readonly>
                <small class="ctc-field-help" id="ctcDocumentRuleSourceHelp">Se calcula automaticamente: licitacion usa cargo licitacion, EXTRA usa cargo operativo.</small>
              </label>
              <label class="ctc-field">
                <span>Area</span>
                <select name="areaCode" id="ctcAreaCode">
                  ${buildOptionList(ui.masterAreas, positionForm.areaCode, (item) => item.code, (item) => `${item.code} - ${item.name}`, "Sin area")}
                </select>
                <small class="ctc-field-help">Area interna que controla operacion, reportes y visibilidad.</small>
              </label>
              <label class="ctc-field">
                <span>Categoria</span>
                <select name="category" id="ctcCategory">
                  ${buildOptionList(POSITION_CATEGORIES, positionForm.category, (item) => item, (item) => item, "Selecciona una categoria")}
                </select>
                <small class="ctc-field-help">Clasifica el cargo para mantener consistencia operativa.</small>
              </label>
              ${coverageEnabled ? `
                <label class="ctc-field ctc-check-field" id="ctcCoverageFieldWrap">
                  <input type="checkbox" name="countsForCoverage" ${isChecked(positionForm.countsForCoverage)}>
                  <span>Cuenta para cobertura</span>
                </label>
              ` : `
                <div class="ctc-field ctc-field-note">
                  <span>Cobertura no activa</span>
                  <small class="ctc-field-help">Este contrato no tiene cobertura habilitada, por eso no se muestra esta regla en el cargo.</small>
                </div>
              `}
              <label class="ctc-field ctc-check-field">
                <input type="checkbox" name="active" ${isChecked(positionForm.active)}>
                <span>Regla activa</span>
              </label>
              <div class="ctc-form-actions">
                <button type="submit" class="btn btn-primary">${positionForm.id ? "Guardar cambios" : "Agregar cargo"}</button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section class="ctc-block">
        <div class="ctc-block-head">
          <h3 class="ctc-title">C. Documentos por cargo</h3>
          <p class="ctc-subtitle">Matriz documental contractual tipo Excel: filas por documento, columnas por cargo y guardado masivo por contrato.</p>
        </div>
        <div class="ctc-doc-toolbar">
          <div class="ctc-doc-toolbar-left">
            ${renderDocumentMatrixFilters()}
          </div>
          <div class="ctc-doc-toolbar-right">
            <span class="ctc-doc-pending ${getDocumentMatrixPendingEntries().length ? "ctc-doc-pending-active" : ""}">
              ${getDocumentMatrixPendingEntries().length} cambio(s) pendiente(s)
            </span>
            <button type="button" class="btn btn-secondary" data-action="new-master-document">Agregar documento</button>
            <button type="button" class="btn btn-primary" data-action="save-document-matrix" ${getDocumentMatrixPendingEntries().length ? "" : "disabled"}>
              Guardar matriz documental
            </button>
          </div>
        </div>
        <div class="ctc-inline-note">
          <span>Las filas son documentos maestros y las columnas son cargos del contrato. Los documentos globales base se muestran bloqueados porque siempre aplican.</span>
        </div>
        <div class="ctc-grid-2 ctc-grid-2-docs">
          <div class="ctc-card-surface">
            <div class="ctc-table-wrap ctc-matrix-wrap">
              <table class="ccp-users-table ctc-table ctc-matrix-table">
                <thead>
                  <tr>
                    <th class="ctc-matrix-doc-head">Documento</th>
                    ${renderDocumentMatrixHeader()}
                    <th class="ctc-matrix-action-head">Acciones</th>
                  </tr>
                </thead>
                <tbody>${renderDocumentMatrixRows()}</tbody>
              </table>
            </div>
          </div>
          <div class="ctc-card-surface">
            ${renderDocumentMasterForm()}
          </div>
        </div>
      </section>

      <section class="ctc-block">
        <div class="ctc-block-head">
          <h3 class="ctc-title">D. Experiencia por cargo</h3>
          <p class="ctc-subtitle">La experiencia contractual se valida por regla y por tipo, no solo por PDF.</p>
        </div>
        <div class="ctc-grid-2">
          <div class="ctc-card-surface">
            <div class="ctc-table-wrap">
              <table class="ccp-users-table ctc-table">
                <thead>
                  <tr>
                    <th>Codigo</th>
                    <th>Tipo experiencia</th>
                    <th>Cargo</th>
                    <th>Alcance</th>
                    <th>Especificidad</th>
                    <th>Meses</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>${renderExperienceRows()}</tbody>
              </table>
            </div>
          </div>
          <div class="ctc-card-surface">
            <div class="ctc-form-head">
              <strong>${experienceForm.id ? "Editar regla de experiencia" : "Agregar regla de experiencia"}</strong>
              <button type="button" class="ctc-btn-link" data-action="new-experience">Nuevo</button>
            </div>
            <form id="ctcExperienceForm" class="ctc-form-grid">
              <label class="ctc-field">
                <span>Cargo contractual</span>
                <select name="contractPositionRuleId">
                  ${buildOptionList(ui.positionRules, experienceForm.contractPositionRuleId, (item) => item.id, (item) => `${item.code} - ${item.name}`, "Selecciona un cargo")}
                </select>
              </label>
              <label class="ctc-field">
                <span>Tipo de experiencia</span>
                <select name="masterExperienceTypeId">
                  ${buildOptionList(ui.masterExperienceTypes, experienceForm.masterExperienceTypeId, (item) => item.id, (item) => `${item.code} - ${item.name}`, "Selecciona un tipo")}
                </select>
              </label>
              <label class="ctc-field">
                <span>Aplica a</span>
                <select name="appliesToStaffingType">
                  ${(ui.meta?.ruleStaffingTypes || ["ANY"]).map((item) => `<option value="${escapeAttr(item)}" ${selectedAttr(experienceForm.appliesToStaffingType, item)}>${escapeHtml(item)}</option>`).join("")}
                </select>
              </label>
              <label class="ctc-field">
                <span>Especificidad</span>
                <select name="specificityType">
                  ${(ui.meta?.specificityTypes || ["GENERAL"]).map((item) => `<option value="${escapeAttr(item)}" ${selectedAttr(experienceForm.specificityType, item)}>${escapeHtml(item)}</option>`).join("")}
                </select>
              </label>
              <label class="ctc-field">
                <span>Meses minimos</span>
                <input type="number" name="minimumMonths" min="0" value="${escapeAttr(experienceForm.minimumMonths)}">
              </label>
              <label class="ctc-field ctc-check-field">
                <input type="checkbox" name="active" ${isChecked(experienceForm.active)}>
                <span>Regla activa</span>
              </label>
              <label class="ctc-field ctc-field-wide">
                <span>Notas</span>
                <textarea name="notes" rows="3">${escapeHtml(experienceForm.notes)}</textarea>
              </label>
              <div class="ctc-form-actions">
                <button type="submit" class="btn btn-primary">${experienceForm.id ? "Guardar cambios" : "Agregar experiencia"}</button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section class="ctc-block">
        <div class="ctc-block-head">
          <h3 class="ctc-title">E. Cobertura del contrato</h3>
          <p class="ctc-subtitle">La cobertura solo se activa cuando el contrato realmente la requiere.</p>
        </div>
        <div class="ctc-scope-grid">
          <div class="ctc-card-surface">
            <h4 class="ctc-mini-title">Municipios del contrato</h4>
            <div class="ctc-chip-wrap">
              ${municipalities.length ? municipalities.map((item) => badge(item.municipalityName, "neutral")).join("") : `<span class="ctc-muted">Sin municipios asociados.</span>`}
            </div>
          </div>
          <div class="ctc-card-surface">
            <h4 class="ctc-mini-title">Modalidades del contrato</h4>
            <div class="ctc-chip-wrap">
              ${modalities.length ? modalities.map((item) => badge(item.modalityCode || item.modalityName, "success")).join("") : `<span class="ctc-muted">Sin modalidades asociadas.</span>`}
            </div>
          </div>
        </div>
        <div class="ctc-grid-2">
          <div class="ctc-card-surface">
            <div class="ctc-table-wrap">
              <table class="ccp-users-table ctc-table">
                <thead>
                  <tr>
                    <th>Cargo</th>
                    <th>Modalidad</th>
                    <th>Modo</th>
                    <th>Habilitada</th>
                    <th>Min cupos</th>
                    <th>Max cupos</th>
                    <th>TC / MT</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>${renderCoverageRows()}</tbody>
              </table>
            </div>
          </div>
          <div class="ctc-card-surface">
            <div class="ctc-form-head">
              <strong>${coverageForm.id ? "Editar regla de cobertura" : "Agregar regla de cobertura"}</strong>
              <button type="button" class="ctc-btn-link" data-action="new-coverage">Nuevo</button>
            </div>
            <form id="ctcCoverageForm" class="ctc-form-grid">
              <label class="ctc-field">
                <span>Cargo contractual</span>
                <select name="contractPositionRuleId">
                  ${buildOptionList(ui.positionRules, coverageForm.contractPositionRuleId, (item) => item.id, (item) => `${item.code} - ${item.name}`, "Toda la operacion")}
                </select>
              </label>
              <label class="ctc-field">
                <span>Modalidad</span>
                <select name="masterModalityId">
                  ${buildOptionList(ui.masterModalities, coverageForm.masterModalityId, (item) => item.id, (item) => `${item.code} - ${item.name}`, "Sin modalidad")}
                </select>
              </label>
              <label class="ctc-field">
                <span>Modo de cobertura</span>
                <select name="coverageMode">
                  ${(ui.meta?.coverageModes || ["UPLOAD"]).map((item) => `<option value="${escapeAttr(item)}" ${selectedAttr(coverageForm.coverageMode, item)}>${escapeHtml(item)}</option>`).join("")}
                </select>
              </label>
              <label class="ctc-field">
                <span>Minimo de cupos</span>
                <input type="number" name="minimumCupos" min="0" value="${escapeAttr(coverageForm.minimumCupos)}">
              </label>
              <label class="ctc-field">
                <span>Maximo de cupos</span>
                <input type="number" name="maximumCupos" min="0" value="${escapeAttr(coverageForm.maximumCupos)}">
              </label>
              <label class="ctc-field">
                <span>Requeridos TC</span>
                <input type="number" name="requiredTc" min="0" value="${escapeAttr(coverageForm.requiredTc)}">
              </label>
              <label class="ctc-field">
                <span>Requeridos MT</span>
                <input type="number" name="requiredMt" min="0" value="${escapeAttr(coverageForm.requiredMt)}">
              </label>
              <label class="ctc-field ctc-check-field">
                <input type="checkbox" name="enabled" ${isChecked(coverageForm.enabled)}>
                <span>Aplica cobertura</span>
              </label>
              <label class="ctc-field ctc-check-field">
                <input type="checkbox" name="active" ${isChecked(coverageForm.active)}>
                <span>Regla activa</span>
              </label>
              <label class="ctc-field ctc-field-wide">
                <span>Notas</span>
                <textarea name="notes" rows="3">${escapeHtml(coverageForm.notes)}</textarea>
              </label>
              <div class="ctc-form-actions">
                <button type="submit" class="btn btn-primary">${coverageForm.id ? "Guardar cambios" : "Agregar cobertura"}</button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </div>
  `;
}

function wireRoot(host) {
  if (!host) return;

  host.onclick = async (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) return;

    const action = actionTarget.dataset.action;
    const id = toId(actionTarget.dataset.id);

    try {
      if (action === "open-contract") {
        const nextContractId = toId(ui.selectorContractId);
        if (!nextContractId) {
          showError("Selecciona un contrato para continuar.");
          return;
        }
        state.cfgContractConfigId = nextContractId;
        state.cfgContractConfigTab = "contractual";
        const { openModule } = await import("../nav.js");
        await openModule("administracion_configuraciones");
        return;
      }

      if (action === "new-position") {
        ui.editingPositionRuleId = null;
        render(host);
        return;
      }

      if (action === "select-position") {
        ui.selectedPositionRuleId = id;
        ui.editingDocumentRuleId = null;
        ui.editingExperienceRuleId = null;
        ui.editingCoverageRuleId = null;
        render(host);
        return;
      }

      if (action === "edit-position") {
        ui.editingPositionRuleId = id;
        ui.selectedPositionRuleId = id;
        render(host);
        return;
      }

      if (action === "activate-position" || action === "deactivate-position") {
        await apiFetch(`/admin/contractual/position-rules/${id}`, {
          method: action === "activate-position" ? "PATCH" : "DELETE",
          ...(action === "activate-position" ? { body: JSON.stringify({ active: true }) } : {}),
        });
        showSuccess("Regla de cargo actualizada.");
        await refreshCurrentContract(host);
        return;
      }

      if (action === "new-document") {
        ui.editingDocumentRuleId = null;
        render(host);
        return;
      }

      if (action === "set-document-matrix-filter") {
        ui.documentMatrixFilter = actionTarget.dataset.filter || "ALL";
        render(host);
        return;
      }

      if (action === "save-document-matrix") {
        const changes = getDocumentMatrixPendingEntries();
        if (!changes.length) {
          showError("No hay cambios pendientes en la matriz documental.");
          return;
        }
        await apiFetch(`/admin/contractual/contracts/${ui.contractId}/document-matrix`, {
          method: "PUT",
          body: JSON.stringify({ changes }),
        });
        showSuccess("Matriz documental guardada.");
        await refreshCurrentContract(host);
        return;
      }

      if (action === "new-master-document") {
        ui.editingMasterDocumentId = null;
        render(host);
        return;
      }

      if (action === "edit-master-document") {
        ui.editingMasterDocumentId = id;
        render(host);
        return;
      }

      if (action === "deactivate-master-document") {
        const document = getDocumentMatrixDocuments().find((item) => item.id === id);
        if (!document) {
          showError("Documento no encontrado.");
          return;
        }
        const confirmed = window.confirm(
          document.active
            ? "Este documento dejara de aparecer en configuraciones activas nuevas, pero conservara su historial. Deseas continuar?"
            : "El documento volvera a estar disponible para nuevas configuraciones. Deseas continuar?"
        );
        if (!confirmed) return;
        await apiFetch(`/admin/contractual/master/document-types/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ active: !document.active }),
        });
        showSuccess(document.active ? "Documento desactivado." : "Documento reactivado.");
        await refreshCurrentContract(host);
        return;
      }

      if (action === "delete-master-document") {
        if (actionTarget.dataset.disabled === "true") {
          showError("No se puede eliminar porque este documento ya tiene historial. Puede desactivarlo.");
          return;
        }
        const confirmed = window.confirm("Esta accion elimina el documento maestro de forma permanente. Solo continua si estas seguro.");
        if (!confirmed) return;
        await apiFetch(`/admin/contractual/master/document-types/${id}`, {
          method: "DELETE",
        });
        showSuccess("Documento maestro eliminado.");
        await refreshCurrentContract(host);
        return;
      }

      if (action === "edit-document") {
        ui.editingDocumentRuleId = id;
        render(host);
        return;
      }

      if (action === "activate-document" || action === "deactivate-document") {
        await apiFetch(`/admin/contractual/document-rules/${id}`, {
          method: action === "activate-document" ? "PATCH" : "DELETE",
          ...(action === "activate-document" ? { body: JSON.stringify({ active: true }) } : {}),
        });
        showSuccess("Regla documental actualizada.");
        await refreshCurrentContract(host);
        return;
      }

      if (action === "new-experience") {
        ui.editingExperienceRuleId = null;
        render(host);
        return;
      }

      if (action === "edit-experience") {
        ui.editingExperienceRuleId = id;
        render(host);
        return;
      }

      if (action === "activate-experience" || action === "deactivate-experience") {
        await apiFetch(`/admin/contractual/experience-rules/${id}`, {
          method: action === "activate-experience" ? "PATCH" : "DELETE",
          ...(action === "activate-experience" ? { body: JSON.stringify({ active: true }) } : {}),
        });
        showSuccess("Regla de experiencia actualizada.");
        await refreshCurrentContract(host);
        return;
      }

      if (action === "new-coverage") {
        ui.editingCoverageRuleId = null;
        render(host);
        return;
      }

      if (action === "edit-coverage") {
        ui.editingCoverageRuleId = id;
        render(host);
        return;
      }

      if (action === "activate-coverage" || action === "deactivate-coverage") {
        await apiFetch(`/admin/contractual/coverage-rules/${id}`, {
          method: action === "activate-coverage" ? "PATCH" : "DELETE",
          ...(action === "activate-coverage" ? { body: JSON.stringify({ active: true }) } : {}),
        });
        showSuccess("Regla de cobertura actualizada.");
        await refreshCurrentContract(host);
      }
    } catch (error) {
      showError(error.message || "No fue posible completar la accion.");
    }
  };

  host.onchange = async (event) => {
    const target = event.target;
    if (target.id === "ctcSelectorCompany") {
      ui.selectorCompanyId = target.value;
      ui.contracts = await fetchContractsForCompany(ui.selectorCompanyId);
      ui.selectorContractId = String(ui.contracts[0]?.id || "");
      render(host);
      return;
    }

    if (target.id === "ctcSelectorContract") {
      ui.selectorContractId = target.value;
      return;
    }

    if (target.id === "ctcMasterDocumentDefaultExpires") {
      syncMasterDocumentFormUi(host);
      return;
    }

    if (target.dataset.action === "toggle-document-matrix-cell") {
      const documentId = toId(target.dataset.documentId);
      const positionId = toId(target.dataset.positionId);
      if (!documentId || !positionId) return;

      const original = Boolean(getDocumentMatrixCell(documentId, positionId)?.checked);
      const nextChecked = Boolean(target.checked);
      const key = getDocumentMatrixCellKey(documentId, positionId);

      if (original === nextChecked) {
        delete ui.documentMatrixPending[key];
      } else {
        ui.documentMatrixPending[key] = {
          masterDocumentTypeId: documentId,
          contractPositionRuleId: positionId,
          checked: nextChecked,
        };
      }
      render(host);
      return;
    }

    if (target.id === "ctcMasterPositionId") {
      hydratePositionFormFromMaster(host, target.value);
      return;
    }

    if (
      target.id === "ctcStaffingMode"
      || target.id === "ctcBidPositionName"
      || target.id === "ctcOperationalPositionName"
    ) {
      syncPositionFormUi(host);
    }
  };

  host.oninput = (event) => {
    const target = event.target;
    if (
      target?.id === "ctcBidPositionName"
      || target?.id === "ctcOperationalPositionName"
    ) {
      syncPositionFormUi(host);
    }
  };

  host.onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    try {
      if (form.id === "ctcPositionForm") {
        await submitPositionForm(form);
        showSuccess(ui.editingPositionRuleId ? "Cargo contractual actualizado." : "Cargo contractual creado.");
        await refreshCurrentContract(host);
        return;
      }

      if (form.id === "ctcMasterDocumentForm") {
        await submitMasterDocumentForm(form);
        showSuccess(ui.editingMasterDocumentId ? "Documento maestro actualizado." : "Documento maestro creado.");
        await refreshCurrentContract(host);
        return;
      }

      if (form.id === "ctcDocumentForm") {
        await submitDocumentForm(form);
        showSuccess(ui.editingDocumentRuleId ? "Regla documental actualizada." : "Documento agregado al cargo.");
        await refreshCurrentContract(host);
        return;
      }

      if (form.id === "ctcExperienceForm") {
        await submitExperienceForm(form);
        showSuccess(ui.editingExperienceRuleId ? "Regla de experiencia actualizada." : "Regla de experiencia creada.");
        await refreshCurrentContract(host);
        return;
      }

      if (form.id === "ctcCoverageForm") {
        await submitCoverageForm(form);
        showSuccess(ui.editingCoverageRuleId ? "Regla de cobertura actualizada." : "Regla de cobertura creada.");
        await refreshCurrentContract(host);
      }
    } catch (error) {
      showError(error.message || "No fue posible guardar la informacion.");
    }
  };
}

function render(host) {
  host.innerHTML = renderContractualPanel();
  syncPositionFormUi(host);
  syncMasterDocumentFormUi(host);
  wireRoot(host);
}

async function fetchContractsForCompany(companyId) {
  if (!toId(companyId)) return [];
  const payload = await apiFetch(`/contracts?companyId=${encodeURIComponent(companyId)}`);
  return listFromResponse(payload, "contracts");
}

async function fetchCurrentContractData(contractId) {
  const summaryPayload = await apiFetch(`/admin/contractual/contracts/${contractId}/summary`);
  const summary = summaryPayload?.data || {};

  const [
    metaPayload,
    companiesPayload,
    masterPositionsPayload,
    masterAreasPayload,
    masterDocumentsPayload,
    documentMatrixPayload,
    masterExperiencePayload,
    masterModalitiesPayload,
    positionRulesPayload,
    documentRulesPayload,
    experienceRulesPayload,
    coverageRulesPayload,
    municipalitiesPayload,
    modalitiesPayload,
  ] = await Promise.all([
    apiFetch("/admin/contractual/meta"),
    apiFetch("/companies"),
    apiFetch("/admin/contractual/master/positions?active=true"),
    apiFetch("/admin/contractual/master/areas?active=true"),
    apiFetch("/admin/contractual/master/document-types"),
    apiFetch(`/admin/contractual/contracts/${contractId}/document-matrix`),
    apiFetch("/admin/contractual/master/experience-types?active=true"),
    apiFetch("/admin/contractual/master/modalities?active=true"),
    apiFetch(`/admin/contractual/contracts/${contractId}/position-rules`),
    apiFetch(`/admin/contractual/contracts/${contractId}/document-rules`),
    apiFetch(`/admin/contractual/contracts/${contractId}/experience-rules`),
    apiFetch(`/admin/contractual/contracts/${contractId}/coverage-rules`),
    apiFetch(`/admin/contractual/contracts/${contractId}/municipalities`),
    apiFetch(`/admin/contractual/contracts/${contractId}/modalities`),
  ]);

  const selectorCompanyId = String(summary.companyId || ui.selectorCompanyId || "");
  const companies = listFromResponse(companiesPayload, "companies");
  const contracts = await fetchContractsForCompany(selectorCompanyId);

  ui.contractId = contractId;
  ui.summary = summary;
  ui.meta = metaPayload?.data || {};
  ui.companies = companies;
  ui.contracts = contracts;
  ui.masterPositions = listFromResponse(masterPositionsPayload);
  ui.masterAreas = listFromResponse(masterAreasPayload);
  ui.masterDocumentTypes = listFromResponse(masterDocumentsPayload);
  ui.documentMatrix = documentMatrixPayload?.data || { positions: [], documents: [] };
  ui.documentMatrixPending = {};
  ui.masterExperienceTypes = listFromResponse(masterExperiencePayload);
  ui.masterModalities = listFromResponse(masterModalitiesPayload);
  ui.positionRules = listFromResponse(positionRulesPayload);
  ui.documentRules = listFromResponse(documentRulesPayload);
  ui.experienceRules = listFromResponse(experienceRulesPayload);
  ui.coverageRules = listFromResponse(coverageRulesPayload);
  ui.contractMunicipalities = listFromResponse(municipalitiesPayload);
  ui.contractModalities = listFromResponse(modalitiesPayload);
  ui.selectorCompanyId = selectorCompanyId;
  ui.selectorContractId = String(
    ui.contracts.some((item) => String(item.id) === String(ui.selectorContractId))
      ? ui.selectorContractId
      : contractId
  );

  if (!ui.positionRules.some((item) => item.id === ui.selectedPositionRuleId)) {
    ui.selectedPositionRuleId = ui.positionRules[0]?.id || null;
  }
  if (!ui.positionRules.some((item) => item.id === ui.editingPositionRuleId)) ui.editingPositionRuleId = null;
  if (!getDocumentMatrixDocuments().some((item) => item.id === ui.editingMasterDocumentId)) ui.editingMasterDocumentId = null;
  if (!ui.documentRules.some((item) => item.id === ui.editingDocumentRuleId)) ui.editingDocumentRuleId = null;
  if (!ui.experienceRules.some((item) => item.id === ui.editingExperienceRuleId)) ui.editingExperienceRuleId = null;
  if (!ui.coverageRules.some((item) => item.id === ui.editingCoverageRuleId)) ui.editingCoverageRuleId = null;
}

async function refreshCurrentContract(host) {
  await fetchCurrentContractData(ui.contractId);
  render(host);
}

function syncPositionFormUi(host) {
  if (!host) return;

  const staffingField = host.querySelector("#ctcStaffingMode");
  const bidField = host.querySelector("#ctcBidPositionName");
  const operationalField = host.querySelector("#ctcOperationalPositionName");
  const documentRuleSourceField = host.querySelector("#ctcDocumentRuleSource");
  const bidHelp = host.querySelector("#ctcBidPositionHelp");
  const operationalHelp = host.querySelector("#ctcOperationalPositionHelp");
  const documentHelp = host.querySelector("#ctcDocumentRuleSourceHelp");
  const masterPosition = getMasterPosition(host.querySelector("#ctcMasterPositionId")?.value || "");

  const staffingMode = String(staffingField?.value || "LICITACION").toUpperCase();

  if (bidField) {
    if (staffingMode === "EXTRA") {
      bidField.value = "EXTRA";
      bidField.readOnly = true;
      bidField.classList.add("ctc-input-readonly");
    } else {
      bidField.readOnly = false;
      bidField.classList.remove("ctc-input-readonly");
      if (
        (!String(bidField.value || "").trim() || String(bidField.value || "").trim().toUpperCase() === "EXTRA")
        && masterPosition?.bidPositionName
      ) {
        bidField.value = masterPosition.bidPositionName;
      } else if (String(bidField.value || "").trim().toUpperCase() === "EXTRA" && !masterPosition?.bidPositionName) {
        bidField.value = "";
      }
    }
  }

  if (operationalField) {
    operationalField.required = staffingMode === "EXTRA";
    operationalField.placeholder = staffingMode === "EXTRA"
      ? "Obligatorio para personal EXTRA"
      : "Opcional si el cargo licitacion no tiene equivalente operativo fijo";
    if (!String(operationalField.value || "").trim() && masterPosition?.operationalPositionName) {
      operationalField.value = masterPosition.operationalPositionName;
    }
  }

  const documentRuleSource = computeDocumentRuleSource(
    staffingMode,
    bidField?.value || "",
    operationalField?.value || ""
  );

  if (documentRuleSourceField) {
    documentRuleSourceField.value = documentRuleSource;
    documentRuleSourceField.readOnly = true;
    documentRuleSourceField.classList.add("ctc-input-readonly");
    documentRuleSourceField.placeholder = staffingMode === "EXTRA"
      ? "Se toma del cargo operativo"
      : "Se toma del cargo licitacion";
  }

  if (bidHelp) {
    bidHelp.textContent = staffingMode === "EXTRA"
      ? "Bloqueado automaticamente en EXTRA para evitar incoherencias contractuales."
      : "Este cargo define documentos, experiencia y requisitos del pliego.";
  }

  if (operationalHelp) {
    operationalHelp.textContent = staffingMode === "EXTRA"
      ? "Obligatorio: define el cargo real que ejecuta la operacion."
      : "Opcional: solo diligencialo si el cargo real difiere del de licitacion.";
  }

  if (documentHelp) {
    documentHelp.textContent = staffingMode === "EXTRA"
      ? "Fuente documental automatica: usa el cargo operativo."
      : "Fuente documental automatica: usa el cargo de licitacion.";
  }
}

function syncMasterDocumentFormUi(host) {
  if (!host) return;

  const expiresField = host.querySelector("#ctcMasterDocumentDefaultExpires");
  const alertField = host.querySelector("#ctcMasterDocumentAlertDays");
  if (!expiresField || !alertField) return;

  const enabled = expiresField.checked === true;
  alertField.disabled = !enabled;
  alertField.classList.toggle("ctc-input-readonly", !enabled);
  if (!enabled) {
    alertField.value = "";
    alertField.placeholder = "No aplica";
  } else if (!String(alertField.value || "").trim()) {
    alertField.value = "30";
    alertField.placeholder = "Ej. 30";
  }
}

function hydratePositionFormFromMaster(host, masterPositionId) {
  const selected = ui.masterPositions.find((item) => String(item.id) === String(masterPositionId));
  if (!selected || !host) return;

  const staffingMode = String(selected.bidPositionName || "").toUpperCase() === "EXTRA" ? "EXTRA" : "LICITACION";
  const setValue = (selector, value) => {
    const field = host.querySelector(selector);
    if (field) field.value = value ?? "";
  };

  setValue("#ctcPositionCode", selected.code || "");
  setValue("#ctcPositionName", selected.documentRuleSource || selected.bidPositionName || selected.operationalPositionName || "");
  setValue("#ctcBidPositionName", selected.bidPositionName || "");
  setValue("#ctcOperationalPositionName", selected.operationalPositionName || "");
  setValue("#ctcAreaCode", selected.area || "");
  setValue("#ctcCategory", selected.category || "");

  const staffingField = host.querySelector('select[name="staffingMode"]');
  if (staffingField) staffingField.value = staffingMode;
  const coverageField = host.querySelector('input[name="countsForCoverage"]');
  if (coverageField) coverageField.checked = Boolean(selected.countsForCoverage);
  syncPositionFormUi(host);
}

async function submitPositionForm(form) {
  const data = new FormData(form);
  const staffingMode = String(data.get("staffingMode") || "LICITACION").toUpperCase();
  const bidPositionName = staffingMode === "EXTRA"
    ? "EXTRA"
    : String(data.get("bidPositionName") || "").trim() || null;
  const operationalPositionName = String(data.get("operationalPositionName") || "").trim() || null;
  const documentRuleSource = computeDocumentRuleSource(
    staffingMode,
    bidPositionName,
    operationalPositionName
  );
  const payload = {
    masterPositionId: toId(data.get("masterPositionId")),
    staffingMode,
    code: String(data.get("code") || "").trim() || undefined,
    name: String(data.get("name") || "").trim(),
    bidPositionName,
    operationalPositionName,
    documentRuleSource,
    areaCode: String(data.get("areaCode") || "").trim() || null,
    category: String(data.get("category") || "").trim() || null,
    countsForCoverage: isContractCoverageEnabled() ? data.get("countsForCoverage") === "on" : false,
    active: data.get("active") === "on",
    isMinimumTeam: staffingMode !== "EXTRA",
  };

  if (!payload.name) throw new Error("El nombre contractual del cargo es obligatorio.");
  if (staffingMode === "LICITACION" && !payload.bidPositionName) {
    throw new Error("El cargo de licitacion es obligatorio para este tipo de personal.");
  }
  if (!payload.documentRuleSource) throw new Error("La fuente documental es obligatoria.");
  if (staffingMode === "EXTRA" && !payload.operationalPositionName) {
    throw new Error("El cargo operativo es obligatorio cuando el personal es EXTRA.");
  }
  const duplicatedRule = ui.positionRules.find((item) => (
    item.id !== ui.editingPositionRuleId
    && String(item.code || "").trim().toUpperCase() === String(payload.code || "").trim().toUpperCase()
  ));
  if (duplicatedRule) {
    throw new Error("Ya existe otro cargo contractual con ese codigo en este contrato.");
  }

  if (ui.editingPositionRuleId) {
    await apiFetch(`/admin/contractual/position-rules/${ui.editingPositionRuleId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } else {
    await apiFetch(`/admin/contractual/contracts/${ui.contractId}/position-rules`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}

async function submitMasterDocumentForm(form) {
  const data = new FormData(form);
  const payload = {
    name: String(data.get("name") || "").trim(),
    code: String(data.get("code") || "").trim(),
    description: String(data.get("description") || "").trim() || null,
    phase: String(data.get("phase") || "").trim() || null,
    isGlobalBase: data.get("isGlobalBase") === "on",
    defaultExpires: data.get("defaultExpires") === "on",
    defaultAlertDaysBeforeExpiration: data.get("defaultExpires") === "on"
      ? (String(data.get("defaultAlertDaysBeforeExpiration") || "").trim() || 30)
      : null,
    visibleToAuditor: data.get("visibleToAuditor") === "on",
    active: data.get("active") === "on",
  };

  if (!payload.name) throw new Error("El nombre del documento es obligatorio.");
  if (!payload.code) throw new Error("El codigo del documento es obligatorio.");
  if (hasDuplicateMasterDocumentCode(payload.code, ui.editingMasterDocumentId)) {
    throw new Error("Ya existe otro documento maestro con ese codigo.");
  }
  if (hasDuplicateMasterDocumentName(payload.name, ui.editingMasterDocumentId)) {
    throw new Error("Ya existe otro documento maestro con ese nombre.");
  }

  if (ui.editingMasterDocumentId) {
    const editing = getEditingMasterDocument();
    if (editing?.isGlobalBase) {
      payload.isGlobalBase = true;
      payload.active = true;
    }
    await apiFetch(`/admin/contractual/master/document-types/${ui.editingMasterDocumentId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } else {
    await apiFetch("/admin/contractual/master/document-types", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}

async function submitDocumentForm(form) {
  const data = new FormData(form);
  const payload = {
    contractPositionRuleId: toId(data.get("contractPositionRuleId")),
    masterDocumentTypeId: toId(data.get("masterDocumentTypeId")),
    validationMode: String(data.get("validationMode") || "DOCUMENTAL"),
    alertDaysBeforeExpiration: String(data.get("alertDaysBeforeExpiration") || "").trim() || 0,
    required: data.get("required") === "on",
    expires: data.get("expires") === "on",
    requiresApproval: data.get("requiresApproval") === "on",
    active: data.get("active") === "on",
    notes: String(data.get("notes") || "").trim() || null,
  };

  if (!payload.contractPositionRuleId) throw new Error("Selecciona un cargo contractual.");
  if (!payload.masterDocumentTypeId) throw new Error("Selecciona un documento maestro.");

  if (ui.editingDocumentRuleId) {
    await apiFetch(`/admin/contractual/document-rules/${ui.editingDocumentRuleId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } else {
    await apiFetch(`/admin/contractual/contracts/${ui.contractId}/document-rules`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}

async function submitExperienceForm(form) {
  const data = new FormData(form);
  const payload = {
    contractPositionRuleId: toId(data.get("contractPositionRuleId")),
    masterExperienceTypeId: toId(data.get("masterExperienceTypeId")),
    appliesToStaffingType: String(data.get("appliesToStaffingType") || "ANY"),
    specificityType: String(data.get("specificityType") || "GENERAL"),
    minimumMonths: String(data.get("minimumMonths") || "").trim() || 0,
    active: data.get("active") === "on",
    notes: String(data.get("notes") || "").trim() || null,
  };

  if (!payload.contractPositionRuleId) throw new Error("Selecciona un cargo contractual.");
  if (!payload.masterExperienceTypeId) throw new Error("Selecciona un tipo de experiencia.");

  if (ui.editingExperienceRuleId) {
    await apiFetch(`/admin/contractual/experience-rules/${ui.editingExperienceRuleId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } else {
    await apiFetch(`/admin/contractual/contracts/${ui.contractId}/experience-rules`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}

async function submitCoverageForm(form) {
  const data = new FormData(form);
  const payload = {
    contractPositionRuleId: toId(data.get("contractPositionRuleId")),
    masterModalityId: toId(data.get("masterModalityId")),
    coverageMode: String(data.get("coverageMode") || "UPLOAD"),
    enabled: data.get("enabled") === "on",
    active: data.get("active") === "on",
    minimumCupos: String(data.get("minimumCupos") || "").trim() || null,
    maximumCupos: String(data.get("maximumCupos") || "").trim() || null,
    requiredTc: String(data.get("requiredTc") || "").trim() || null,
    requiredMt: String(data.get("requiredMt") || "").trim() || null,
    notes: String(data.get("notes") || "").trim() || null,
  };

  if (ui.editingCoverageRuleId) {
    await apiFetch(`/admin/contractual/coverage-rules/${ui.editingCoverageRuleId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } else {
    await apiFetch(`/admin/contractual/contracts/${ui.contractId}/coverage-rules`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}

export async function loadContractualAdminPanel(contractId) {
  const host = document.getElementById("ccpContractualPanelContent");
  if (!host) return;

  const normalizedContractId = toId(contractId || state.cfgContractConfigId);
  if (!normalizedContractId) {
    host.innerHTML = `<div class="cfg-error">Selecciona un contrato para cargar su configuracion contractual.</div>`;
    return;
  }

  host.innerHTML = `<div class="ccp-loading-row">Cargando configuracion contractual...</div>`;

  try {
    await fetchCurrentContractData(normalizedContractId);
    render(host);
  } catch (error) {
    host.innerHTML = `<div class="cfg-error">No fue posible cargar la configuracion contractual: ${escapeHtml(error.message)}</div>`;
  }
}
