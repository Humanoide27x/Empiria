import { state } from '../state.js';
import { apiFetch } from '../api.js';
import {
  escapeHtml, escapeAttr, printHtml, savePdf, exportToExcel, renderOptions,
  getPersonnelFullName, getPersonnelRole, getPersonnelMunicipality,
  isInstitutionalTabEnabled, syncPersonnelDraftField, enforceInputRestrictions,
  syncEmployeeHeaderFromDraft, getDepartmentMunicipalities,
  getCompanyOptionsHtml, getContractOptionsHtml, formatCompany, formatContract,
  ensureOfficialMunicipalitiesLoaded, getOfficialMunicipalities,
  findOfficialMunicipality, normalizeMunicipalityText, getMunicipalityName,
} from '../utils.js';
import {
  COLOMBIA_DEPARTMENTS, LICITACION_CARGOS,
  CARGOS_REALES, ESTADOS_PERSONAL, BANKS,
} from '../constants.js';
import { showError, showSuccess, showWarning } from '../toast.js';
import { openModule } from '../nav.js';
import { openDocViewer } from '../doc-viewer.js';

const DOC_TYPE_EQUIVALENTS = [
  ["cedula", "cc", "cedula de ciudadania", "fotocopia del documento de identidad"],
  ["hoja de vida", "hv"],
  ["contrato", "contrato laboral"],
  ["afiliacion eps", "eps", "certificado eps"],
  ["afiliacion afp", "pension", "afp", "afiliacion pension"],
  ["afiliacion caja de compensacion cofrem", "caja", "caja de compensacion"],
  ["afiliacion arl", "arl"],
  ["curso manipulacion de alimentos", "manipulacion", "manipulacion alimentos"],
  ["examenes manipulacion de alimentos", "examen medico", "examenes"],
  ["residencia expedida por alcaldia", "certificado residencia", "certificado de residencia"],
  ["formato de dotacion", "dotacion", "soporte dotacion"],
  ["rut"],
  ["certificacion bancaria", "banco"],
];

function sameDocumentType(uploadedType, requiredType) {
  const normalize = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const aliasMap = sameDocumentType._aliasMap || (() => {
    const map = new Map();
    DOC_TYPE_EQUIVALENTS.forEach((group) => {
      const canonical = normalize(group[0]);
      group.forEach((label) => map.set(normalize(label), canonical));
    });
    sameDocumentType._aliasMap = map;
    return map;
  })();

  const left = aliasMap.get(normalize(uploadedType)) || normalize(uploadedType);
  const right = aliasMap.get(normalize(requiredType)) || normalize(requiredType);
  return Boolean(left) && left === right;
}

// ── Local helpers ─────────────────────────────────────────────────────────────

function normalizeMunName(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function getPersonnelWorkStatus(item) {
  return item.estado || item.status || item.estado_laboral || "Sin estado";
}

function getPersonnelDocument(item) {
  return item.numero_documento || item.documentNumber || "-";
}

function getPersonnelDocumentChecklist(item) {
  const docs = item.documents || item.documentos || {};
  const hasDoc = (keys) =>
    keys.some((key) => {
      const value = docs[key];
      if (Array.isArray(value)) return value.length > 0;
      return Boolean(value);
    });
  return {
    cedula:   hasDoc(["cedula", "cc", "documento_identidad"]),
    hojaVida: hasDoc(["hoja_vida", "hv", "curriculum"]),
    eps:      hasDoc(["eps", "certificado_eps", "afiliacion_eps"]),
    pension:  hasDoc(["pension", "afp", "certificado_pension"]),
    examenes: hasDoc(["examen_medico", "examenes", "manipulacion_alimentos"]),
  };
}

function formatUiDate(value) {
  if (!value) return "—";
  const raw = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? raw
    : date.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function getPersonnelInitials(item) {
  const parts = getPersonnelFullName(item)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  if (!parts.length) return "?";
  const first = parts[0]?.[0] || "";
  const second = parts[2]?.[0] || parts[1]?.[0] || "";
  return `${first}${second}`.toUpperCase();
}

function getPersonnelAvatarStyle(item) {
  const seed = getPersonnelFullName(item);
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `--personnel-avatar-bg: linear-gradient(135deg, hsla(${hue}, 82%, 96%, 1), hsla(${(hue + 28) % 360}, 68%, 88%, 1)); --personnel-avatar-fg: hsl(${hue}, 48%, 28%);`;
}

function getPersonnelAvatarStyleFromName(fullName) {
  const seed = String(fullName || "");
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `--personnel-avatar-bg: linear-gradient(135deg, hsla(${hue}, 82%, 96%, 1), hsla(${(hue + 28) % 360}, 68%, 88%, 1)); --personnel-avatar-fg: hsl(${hue}, 48%, 28%);`;
}

function getPersonnelInitialsFromName(fullName) {
  const parts = String(fullName || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  if (!parts.length) return "?";
  const first = parts[0]?.[0] || "";
  const second = parts[2]?.[0] || parts[1]?.[0] || "";
  return `${first}${second}`.toUpperCase();
}

function getPersonnelCategory(item) {
  const isOffer =
    item.presentedInOffer === true || item.presentedInOffer === "true" ||
    item.presented_in_offer === true || item.presented_in_offer === "true";
  return isOffer ? "Oferta" : "Extra";
}

function getPersonnelCompanyLabel(item) {
  const companyId = item.companyId || item.company_id || "";
  if (!companyId) return item.companyName || item.empresa || "Sin empresa";
  return formatCompany(companyId);
}

function getPersonnelContractLabel(item) {
  const contractId = item.contractId || item.contract_id || "";
  if (!contractId) return item.contractName || item.contrato || "Sin contrato";
  return formatContract(contractId);
}

function getPersonnelModality(item) {
  return item.educationalModality || item.modalidad || item.modality || "Sin modalidad";
}

function getPersonnelInstitution(item) {
  return item.institution || item.institucion_educativa || item.institutionName || "Sin institución";
}

function getPersonnelSite(item) {
  return item.site || item.sede_educativa || item.siteName || "Sin sede";
}

function getPersonnelCoverageStart(item) {
  return item.coverageStartDate || item.coverage_start_date || item.fecha_inicio_cobertura || item.startDate || item.start_date || "";
}

function formatCurrencyValue(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

async function getEmployeeDossierPayload(id, { force = false } = {}) {
  const key = String(id || "");
  if (!key) return null;
  if (!state.personnelDossierCache) state.personnelDossierCache = new Map();

  if (!force && state.personnelDossierCache.has(key)) {
    return state.personnelDossierCache.get(key);
  }

  const payload = await apiFetch(`/personnel/${encodeURIComponent(key)}/dossier`);
  const dossier = payload?.data || null;
  if (dossier) state.personnelDossierCache.set(key, dossier);
  return dossier;
}

async function getEmployeeDocumentsCollection(employeeId, { force = false } = {}) {
  const key = String(employeeId || "").trim();
  if (!key) return [];
  if (!state.personnelEmployeeDocumentsCache) state.personnelEmployeeDocumentsCache = new Map();

  if (!force && state.personnelEmployeeDocumentsCache.has(key)) {
    return state.personnelEmployeeDocumentsCache.get(key) || [];
  }

  const res = await apiFetch(`/documents/employee/${encodeURIComponent(key)}`);
  const documents = Array.isArray(res.data) ? res.data : [];
  state.personnelEmployeeDocumentsCache.set(key, documents);
  return documents;
}

const EMPLOYEE_DOCUMENT_UI_STATE = {
  employeeId: null,
  replaceDocumentId: null,
  replaceDocumentTypeKey: "",
  busy: false,
};

let employeeDocumentHandlersBound = false;

function getDossierTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("completa") || normalized.includes("configurada") || normalized.includes("cuenta")) return "success";
  if (normalized.includes("revision") || normalized.includes("pendiente")) return "warning";
  if (
    normalized.includes("incompleta") ||
    normalized.includes("sin") ||
    normalized.includes("falta") ||
    normalized.includes("fuera") ||
    normalized.includes("no encontrado")
  ) return "danger";
  if (normalized.includes("no aplica")) return "neutral";
  return "neutral";
}

function buildDossierBadge(config = {}) {
  const {
    text = "",
    tone = "neutral",
    action = "",
    title = "",
  } = config || {};
  const tag = action ? "button" : "span";
  const attrs = [
    `class="employee-dossier-badge tone-${escapeAttr(tone)}${action ? " is-clickable" : ""}"`,
    action ? `data-dossier-chip="${escapeAttr(action)}"` : "",
    title ? `title="${escapeAttr(title)}"` : "",
    action ? `aria-label="${escapeAttr(title || text)}"` : "",
    action ? `type="button"` : "",
  ].filter(Boolean).join(" ");

  return `
    <${tag} ${attrs}>
      <strong class="employee-dossier-badge-value">${escapeHtml(text)}</strong>
    </${tag}>
  `;
}

function buildDossierSecondaryLine(parts, fallback = "Sin dato", extraClass = "") {
  const items = parts
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  const content = items.length
    ? items
      .map((item) => `<span>${escapeHtml(item)}</span>`)
      .join('<span class="employee-dossier-secondary-sep" aria-hidden="true">&middot;</span>')
    : `<span>${escapeHtml(fallback)}</span>`;
  const className = extraClass
    ? `employee-dossier-secondary-row ${extraClass}`
    : "employee-dossier-secondary-row";

  return `<p class="${className}">${content}</p>`;
}

function buildDossierOperationalSummaryModel(dossier = {}) {
  const safeDossier = dossier || {};
  return {
    indicators: safeDossier.indicators || {},
    documents: {
      summary: safeDossier.documents?.summary || {},
      items: Array.isArray(safeDossier.documents?.items) ? safeDossier.documents.items : [],
    },
    payroll: safeDossier.payroll || {},
    coverage: safeDossier.coverage || {},
    novelties: safeDossier.novelties || {},
    history: {
      timeline: Array.isArray(safeDossier.timeline) ? safeDossier.timeline : [],
      alerts: Array.isArray(safeDossier.alerts) ? safeDossier.alerts : [],
    },
    sst: safeDossier.sst || {},
  };
}

function formatDossierDocumentsBadge(summary = {}, status = "") {
  const total = Number(summary.totalRequired || 0);
  const approved = Number(summary.approved || 0);
  if (!total) {
    return {
      text: "Sin checklist documental",
      tone: "neutral",
      title: "Abrir documentos del expediente",
      action: "documents",
    };
  }

  const tone = approved >= total
    ? "success"
    : (getDossierTone(status) === "danger" ? "danger" : "warning");

  return {
    text: `${approved}/${total} documentos`,
    tone,
    title: "Abrir documentos del expediente",
    action: "documents",
  };
}

function formatDossierCoverageBadge(summary = {}, assignment = {}) {
  const status = String(summary?.status || "").trim();
  const hasAssignment = Boolean(
    assignment?.assignmentId ||
    assignment?.institutionName ||
    assignment?.siteName ||
    assignment?.municipalityName
  );
  const countsForCoverage = summary?.applies === true || assignment?.coverageEnabled === true;

  if (status === "No aplica para cobertura") {
    return {
      text: "No aplica cobertura",
      tone: "neutral",
      title: "Abrir información de cobertura",
      action: "coverage",
    };
  }

  if (!hasAssignment) {
    return {
      text: "Sin asignacion operativa",
      tone: "warning",
      title: "Abrir información de cobertura",
      action: "coverage",
    };
  }

  if (countsForCoverage || status === "Cuenta para cobertura") {
    return {
      text: "Cobertura activa",
      tone: "success",
      title: "Abrir información de cobertura",
      action: "coverage",
    };
  }

  return {
    text: "No esta siendo contabilizado",
    tone: "danger",
    title: "Abrir información de cobertura",
    action: "coverage",
  };
}

function formatDossierPayrollBadge(indicators = {}) {
  const latestPayrollLabel = String(indicators.latestPayrollLabel || "").trim();
  const latestPayrollNet = Number(indicators.latestPayrollNet || 0);

  if (latestPayrollNet > 0) {
    return {
      text: formatCurrencyValue(latestPayrollNet),
      tone: "success",
      title: latestPayrollLabel ? `Ultima nomina ${latestPayrollLabel}` : "Abrir detalle de nomina",
      action: "payroll",
    };
  }

  if (!latestPayrollLabel) {
    return {
      text: "Sin nomina registrada",
      tone: "neutral",
      title: "Abrir detalle de nomina",
      action: "payroll",
    };
  }

  return {
    text: `Ultima nomina ${latestPayrollLabel}`,
    tone: "success",
    title: `Ultima nomina ${latestPayrollLabel}`,
    action: "payroll",
  };
}

function formatDossierNoveltiesBadge(count = 0) {
  const total = Number(count || 0);
  if (!total) {
    return {
      text: "Sin novedades",
      tone: "neutral",
      title: "Abrir historial de novedades",
      action: "novelties",
    };
  }

  return {
    text: `${total} ${total === 1 ? "novedad activa" : "novedades activas"}`,
    tone: "warning",
    title: "Abrir historial de novedades",
    action: "novelties",
  };
}

function formatSingleDossierAlert(alert = {}) {
  const kind = String(alert.kind || "").trim();
  const count = Number(alert.count || 0);

  if (kind === "documents_expired") {
    return count === 1 ? "1 documento vencido" : `${count} documentos vencidos`;
  }
  if (kind === "documents_expiring") {
    return count === 1 ? "Documento por vencer" : `${count} documentos por vencer`;
  }
  if (kind === "documents_missing") {
    return count === 1 ? "Falta 1 documento obligatorio" : `Faltan ${count} documentos obligatorios`;
  }
  if (kind === "coverage_missing") {
    return "Cobertura incompleta";
  }
  if (kind === "novelty_supports") {
    return count === 1 ? "1 novedad sin soporte validado" : `${count} novedades sin soporte validado`;
  }
  if (kind === "novelty_review") {
    return count === 1 ? "1 novedad pendiente de revision" : `${count} novedades pendientes de revision`;
  }

  return String(alert.label || "Alerta pendiente").trim();
}

function resolveDossierAlertAction(alert = {}) {
  const kind = String(alert.kind || "").trim();
  if (kind.startsWith("documents_")) return "documents";
  if (kind.startsWith("coverage_")) return "coverage";
  return "alerts";
}

function formatDossierAlertsBadge(alerts = []) {
  const list = Array.isArray(alerts) ? alerts : [];
  if (!list.length) {
    return {
      text: "Sin alertas pendientes",
      tone: "success",
      title: "Abrir detalle de alertas",
      action: "alerts",
    };
  }

  if (list.length === 1) {
    const text = formatSingleDossierAlert(list[0]);
    return {
      text: `⚠ ${text}`,
      tone: "danger",
      title: "Abrir detalle de alertas",
      action: resolveDossierAlertAction(list[0]),
    };
  }

  return {
    text: `⚠ ${list.length} alertas pendientes`,
    tone: "danger",
    title: "Abrir detalle de alertas",
    action: "alerts",
  };
}

function formatPersonnelStatusBadge(status) {
  const raw = String(status || "").trim();
  const normalized = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (!normalized) return { label: "SIN ESTADO", tone: "neutral" };
  if (normalized === "ACTIVO") return { label: "ACTIVA", tone: "success" };
  if (normalized === "ACTIVA") return { label: "ACTIVA", tone: "success" };
  if (normalized.includes("SUSP")) return { label: "SUSPENDIDA", tone: "warning" };
  if (normalized.includes("RETIR")) return { label: "RETIRADA", tone: "danger" };
  if (normalized.includes("INACT")) return { label: "INACTIVA", tone: "neutral" };
  if (normalized.includes("PREING")) return { label: "PREINGRESO", tone: "info" };
  return { label: raw.toUpperCase(), tone: "neutral" };
}

function getFirstFilledValue(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function readDraftAliases(draftValue, aliases = []) {
  for (const alias of aliases) {
    const resolved = String(draftValue(alias) || "").trim();
    if (resolved) return resolved;
  }
  return "";
}

function readObjectAliases(source, aliases = []) {
  const object = source || {};
  for (const alias of aliases) {
    const resolved = String(object?.[alias] || "").trim();
    if (resolved) return resolved;
  }
  return "";
}

function resolvePersonnelHeaderFullName({ draftValue, employee = {}, fallback = "" }) {
  const nameParts = [
    getFirstFilledValue(
      readDraftAliases(draftValue, ["firstName", "first_name", "primer_nombre", "primerNombre"]),
      readObjectAliases(employee, ["firstName", "first_name", "primer_nombre", "primerNombre"])
    ),
    getFirstFilledValue(
      readDraftAliases(draftValue, ["secondName", "second_name", "segundo_nombre", "segundoNombre"]),
      readObjectAliases(employee, ["secondName", "second_name", "segundo_nombre", "segundoNombre"])
    ),
    getFirstFilledValue(
      readDraftAliases(draftValue, ["firstLastName", "first_last_name", "primer_apellido", "primerApellido", "lastName", "last_name"]),
      readObjectAliases(employee, ["firstLastName", "first_last_name", "primer_apellido", "primerApellido", "lastName", "last_name"])
    ),
    getFirstFilledValue(
      readDraftAliases(draftValue, ["secondLastName", "second_last_name", "segundo_apellido", "segundoApellido"]),
      readObjectAliases(employee, ["secondLastName", "second_last_name", "segundo_apellido", "segundoApellido"])
    ),
  ].filter(Boolean);

  if (nameParts.length) return nameParts.join(" ").toUpperCase();

  const fallbackName = getFirstFilledValue(
    fallback,
    readDraftAliases(draftValue, ["fullName", "full_name", "nombre_completo", "nombreCompleto", "nombre", "name"]),
    readObjectAliases(employee, ["fullName", "full_name", "nombre_completo", "nombreCompleto", "nombre", "name"])
  );

  if (fallbackName) return fallbackName.toUpperCase();

  return "NOMBRE COMPLETO";
}

function resolvePersonnelHeaderDocument({ draftValue, employee = {}, fallbackType = "", fallbackNumber = "" }) {
  const type = getFirstFilledValue(
    fallbackType,
    readDraftAliases(draftValue, ["documentType", "document_type", "tipo_documento"]),
    readObjectAliases(employee, ["documentType", "document_type", "tipo_documento"])
  ).toUpperCase();

  const number = getFirstFilledValue(
    fallbackNumber,
    readDraftAliases(draftValue, ["documentNumber", "document_number", "numero_documento", "numeroDocumento"]),
    readObjectAliases(employee, ["documentNumber", "document_number", "numero_documento", "numeroDocumento"])
  );

  return { type, number, label: [type, number].filter(Boolean).join(" ").trim() };
}

function buildEmployeeDossierIdentity({ fullName, documentLabel, photoUrl, statusLabel = "", statusTone = "neutral" }) {
  const avatarHtml = `
    <div class="employee-dossier-avatar">
      ${photoUrl
        ? `<img src="${escapeAttr(photoUrl)}" alt="Foto del empleado" />`
        : `<span class="employee-dossier-avatar-fallback" style="${getPersonnelAvatarStyleFromName(fullName)}">${escapeHtml(getPersonnelInitialsFromName(fullName))}</span>`}
    </div>
  `;

  return `
    <div class="employee-dossier-identity">
      ${avatarHtml}
      <div class="employee-header-copy employee-dossier-identity-copy">
        <h2 class="emp-name-title">
          <span class="employee-dossier-name-main" id="employeeHeaderName">${escapeHtml(fullName || "NOMBRE COMPLETO")}</span>
          <span class="employee-dossier-inline-sep" aria-hidden="true">&middot;</span>
          <span class="emp-doc-subtitle employee-dossier-inline-document" id="employeeHeaderDocument">${escapeHtml(documentLabel || "TIPO DOCUMENTO NUMERO")}</span>
          ${statusLabel ? `<span class="employee-dossier-inline-sep" aria-hidden="true">&middot;</span>` : ""}
          ${statusLabel ? `<span class="employee-dossier-status-badge tone-${escapeAttr(statusTone)}">${escapeHtml(statusLabel)}</span>` : ""}
        </h2>
      </div>
    </div>
  `;
}

function getExpedienteSectionDescription(title) {
  return "";
}

function buildFormSectionLead(title, description = "", badge = "") {
  return `
    <div class="personnel-editor-lead">
      <h3>${escapeHtml(title)}</h3>
    </div>
  `;
}

function buildFormInsetCard(title, description, content, extraClass = "") {
  const className = `personnel-form-inset-card ${extraClass}`.trim();
  return `
    <section class="${className}">
      <header class="personnel-form-inset-head">
        <h4>${escapeHtml(title)}</h4>
      </header>
      <div class="personnel-form-inset-body">
        ${content}
      </div>
    </section>
  `;
}

function getPersonnelDraftDisplayName(draftValue) {
  const parts = [
    draftValue("firstName"),
    draftValue("secondName"),
    draftValue("firstLastName"),
    draftValue("secondLastName"),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (parts.length) return parts.join(" ").toUpperCase();

  return String(
    draftValue("fullName") ||
    draftValue("full_name") ||
    draftValue("name") ||
    draftValue("nombre") ||
    ""
  ).trim().toUpperCase();
}

function getPersonnelDraftFingerprint(value) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      return Object.keys(input).sort().reduce((acc, key) => {
        const normalizedValue = normalize(input[key]);
        if (normalizedValue === undefined) return acc;
        acc[key] = normalizedValue;
        return acc;
      }, {});
    }
    if (input === undefined || input === null) return "";
    return input;
  };

  return JSON.stringify(normalize(value || {}));
}

function computePersonnelSaveState(isEditMode) {
  if (state.personnelSaveState === "saved") {
    const currentFingerprint = getPersonnelDraftFingerprint(state.personnelDraft);
    if (currentFingerprint === state.personnelDraftBaselineFingerprint) {
      return { tone: "saved", label: "Guardado correctamente" };
    }
  }

  const currentFingerprint = getPersonnelDraftFingerprint(state.personnelDraft);
  const baselineFingerprint = state.personnelDraftBaselineFingerprint || getPersonnelDraftFingerprint({});
  const hasChanges = currentFingerprint !== baselineFingerprint;

  if (hasChanges) return { tone: "pending", label: "Cambios pendientes" };
  if (isEditMode) return { tone: "clean", label: "Sin cambios" };
  return { tone: "clean", label: "Sin cambios" };
}

function syncPersonnelSaveStateDom() {
  const chip = document.getElementById("personnelSaveState");
  if (!chip) return;
  const isEditMode = state.personnelViewMode === "edit";
  const saveState = computePersonnelSaveState(isEditMode);
  chip.className = `personnel-save-state state-${saveState.tone}`;
  chip.textContent = saveState.label;
}

function clonePersonnelDraftSnapshot(value = state.personnelDraft || {}) {
  return JSON.parse(JSON.stringify(value || {}));
}

function getPersonnelFieldAutocomplete(fieldName) {
  const map = {
    firstName: "given-name",
    secondName: "additional-name",
    firstLastName: "family-name",
    secondLastName: "additional-name",
    documentNumber: "off",
    birthDay: "bday-day",
    birthMonth: "bday-month",
    birthYear: "bday-year",
    phone: "tel",
    email: "email",
    address: "street-address",
    neighborhood: "address-line2",
    residenceMunicipality: "address-level2",
    birthMunicipality: "address-level2",
    expeditionMunicipality: "address-level2",
    municipalityId: "address-level2",
    institution: "organization",
    site: "organization-title",
    bankName: "organization",
  };
  return map[fieldName] || "off";
}

function configurePersonnelFormForKeyboard(form, { focusFirst = false } = {}) {
  if (!form) return;

  const fieldSelector = 'input:not([type="hidden"]):not([type="file"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
  const priorityOrder = [
    "documentNumber",
    "documentType",
    "birthDay",
    "birthMonth",
    "birthYear",
    "expeditionDay",
    "expeditionMonth",
    "expeditionYear",
    "biologicalSex",
    "bloodType",
    "civilStatus",
    "birthCountry",
    "phone",
    "email",
    "address",
    "neighborhood",
    "residenceMunicipality",
    "residenceZone",
  ];

  const isVisibleField = (element) =>
    element &&
    !element.disabled &&
    !element.closest(".hidden") &&
    element.getClientRects().length > 0;

  const fields = Array.from(form.querySelectorAll(fieldSelector)).filter(isVisibleField);

  fields.forEach((field, index) => {
    const baseName = String(field.name || field.id || `field-${index + 1}`)
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .toLowerCase();
    if (!field.id) field.id = `personnel-${baseName}-${index + 1}`;
    field.setAttribute("autocomplete", getPersonnelFieldAutocomplete(field.name));
    const label = field.closest("label");
    if (label) label.setAttribute("for", field.id);
  });

  const orderedFields = fields
    .map((field, index) => ({ field, index }))
    .sort((left, right) => {
      const leftPriority = priorityOrder.indexOf(left.field.name);
      const rightPriority = priorityOrder.indexOf(right.field.name);
      const safeLeft = leftPriority === -1 ? 999 + left.index : leftPriority;
      const safeRight = rightPriority === -1 ? 999 + right.index : rightPriority;
      return safeLeft - safeRight;
    })
    .map((item) => item.field);

  orderedFields.forEach((field, index) => {
    field.tabIndex = index + 1;
  });

  const primaryActions = Array.from(form.querySelectorAll("[data-personnel-primary-action]")).filter(isVisibleField);
  primaryActions.forEach((button, index) => {
    button.tabIndex = orderedFields.length + index + 1;
  });

  document.getElementById("backToPersonnelTable")?.setAttribute("tabindex", "-1");
  document.querySelectorAll("[data-step-tab]").forEach((button) => button.setAttribute("tabindex", "-1"));
  form.querySelectorAll('button:not([data-personnel-primary-action])').forEach((button) => button.setAttribute("tabindex", "-1"));

  if (!form.dataset.personnelFocusTrapBound) {
    form.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const tabbableFields = Array.from(form.querySelectorAll(fieldSelector)).filter(isVisibleField);
      const tabbableActions = Array.from(form.querySelectorAll("[data-personnel-primary-action]")).filter(isVisibleField);
      const tabbables = [...tabbableFields, ...tabbableActions];
      if (!tabbables.length) return;

      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    form.dataset.personnelFocusTrapBound = "true";
  }

  if (focusFirst) {
    const firstField = form.querySelector('[name="documentNumber"]') || orderedFields[0] || primaryActions[0] || null;
    if (firstField) {
      setTimeout(() => {
        firstField.focus({ preventScroll: true });
        if (typeof firstField.select === "function" && firstField.tagName === "INPUT") firstField.select();
      }, 0);
    }
  }
}

async function restorePersonnelDraftFromBaseline() {
  state.personnelDraft = clonePersonnelDraftSnapshot(state.personnelDraftBaselineData || {});
  state.personnelDraftBaselineFingerprint = getPersonnelDraftFingerprint(state.personnelDraft);
  state.personnelSaveState = "clean";
  syncDraftOfficialMunicipality(state.personnelDraft);

  try {
    await loadEducationalScopeOptions(state.personnelDraft, { force: true });
    syncInstitutionalSelectionsWithCatalog(state.personnelDraft, _cachedPayload?.educationalCatalog || {});
    await loadGestorScopeOptions(state.personnelDraft, { force: true });
  } catch (error) {
    console.warn("[personnel] No fue posible restaurar catalogos tras cancelar:", error.message);
  }
}

function buildTabHistorial(dossier) {
  const alerts = Array.isArray(dossier?.alerts) ? dossier.alerts : [];
  const timeline = Array.isArray(dossier?.timeline) ? dossier.timeline : [];

  return `
    <section class="personnel-section personnel-history-tab">
      ${alerts.length ? `
        <div class="employee-history-alerts">
          ${alerts.map((alert) => `<span class="employee-dossier-alert-chip">${escapeHtml(alert.label || "")}</span>`).join("")}
        </div>
      ` : ""}
      <div class="employee-history-card">
        <div class="employee-history-head">
          <strong>Movimientos</strong>
          <span>${escapeHtml(String(timeline.length || 0))} eventos</span>
        </div>
        ${timeline.length ? `
          <div class="employee-dossier-timeline-list">
            ${timeline.map((item) => `
              <article class="employee-dossier-timeline-item">
                <div class="employee-dossier-timeline-date">${escapeHtml(formatUiDate(item.date))}</div>
                <div class="employee-dossier-timeline-copy">
                  <strong>${escapeHtml(item.title || "Evento")}</strong>
                  <p>${escapeHtml(item.description || "Movimiento registrado en el expediente.")}</p>
                </div>
              </article>
            `).join("")}
          </div>
        ` : `<p class="obs-empty">No hay actividad registrada en el expediente.</p>`}
      </div>
    </section>
  `;
}

function buildExpedienteSectionBlock(title, content) {
  return `
    <section class="expediente-section-block">
      <header class="expediente-section-head">
        <h3>${escapeHtml(title)}</h3>
      </header>
      <div class="expediente-section-body">
        ${content}
      </div>
    </section>
  `;
}

function buildTabDatosGeneralesGroup(draftValue, draft, expeditionDepartment, birthDepartment, isEditMode = false) {
  return `
    <section class="personnel-section expediente-group-grid">
      ${buildExpedienteSectionBlock("Complementarios de Identificación", buildTabIdentificacionComplementary(draftValue, expeditionDepartment, birthDepartment, isEditMode))}
      ${buildExpedienteSectionBlock("Estudios", buildTabEstudios(draftValue))}
      ${buildExpedienteSectionBlock("Experiencia", buildTabExperiencia(draft))}
      ${buildExpedienteSectionBlock("Seguimiento", buildTabSeguimiento(draftValue))}
    </section>
  `;
}

function buildTabVinculacionLaboralGroup(options) {
  const {
    draftValue,
    selected,
    vinculationCompanyId,
    gestorNames,
    auxiliarGestorNames,
    gestorStatusMessage,
    institutionalEnabled,
    managerRole,
    institutionalMunicipality,
    municipalityNameResolved,
    institutionalMunicipalities,
    institutionNames,
    selectedInstitution,
    sedeNames,
    selectedSede,
    modalidadCatalog,
    selectedModality,
    normalizeCatalogText,
    educationalCatalogMessage,
    currentCargoReal,
  } = options;

  return `
    <section class="personnel-section expediente-group-grid">
      ${buildExpedienteSectionBlock("Licitacion", buildTabLicitacion(draftValue, selected))}
      ${buildExpedienteSectionBlock("Vinculacion", buildTabVinculacion(draftValue, vinculationCompanyId, gestorNames, auxiliarGestorNames, gestorStatusMessage))}
      ${buildExpedienteSectionBlock("Contratacion", buildTabContratacion(draftValue, currentCargoReal))}
      ${buildExpedienteSectionBlock(
        "Asignacion Operativa",
        buildTabInstitucional(
          draftValue, institutionalEnabled, managerRole,
          institutionalMunicipality, municipalityNameResolved,
          institutionalMunicipalities,
          institutionNames, selectedInstitution,
          sedeNames, selectedSede,
          modalidadCatalog, selectedModality,
          normalizeCatalogText,
          educationalCatalogMessage || ""
        )
      )}
    </section>
  `;
}

function buildTabHistorialObservacionesGroup(draftValue, dossier) {
  return `
    <section class="personnel-section expediente-group-grid">
      ${buildExpedienteSectionBlock("Notas", buildTabObservaciones(draftValue))}
      ${buildExpedienteSectionBlock("Historial", buildTabHistorial(dossier))}
    </section>
  `;
}

function normalizePersonnelTabKey(tab) {
  switch (String(tab || "").trim()) {
    case "datos_personales":
    case "estudios":
    case "experiencia":
    case "seguimiento":
      return "datos_generales";
    case "licitacion":
    case "vinculacion":
    case "contratacion":
    case "institucional":
      return "vinculacion_laboral";
    case "observaciones":
    case "historial":
      return "historial_observaciones";
    case "identificacion":
    case "datos_generales":
    case "vinculacion_laboral":
    case "historial_observaciones":
      return String(tab).trim();
    default:
      return "identificacion";
  }
}

function buildPersonnelMacroSection({
  activeTab,
  draftValue,
  draft,
  expeditionDepartment,
  birthDepartment,
  isEditMode,
  residenceMunicipality,
  selected,
  vinculationCompanyId,
  gestorNames,
  auxiliarGestorNames,
  gestorStatusMessage,
  institutionalEnabled,
  managerRole,
  institutionalMunicipality,
  municipalityNameResolved,
  institutionalMunicipalities,
  institutionNames,
  selectedInstitution,
  sedeNames,
  selectedSede,
  modalidadCatalog,
  selectedModality,
  educationalCatalogMeta,
  currentCargoReal,
  dossier,
}) {
  if (activeTab === "identificacion") {
    return buildTabIdentificacion(draftValue, expeditionDepartment, birthDepartment, isEditMode);
  }

  if (activeTab === "datos_generales") {
    return buildTabDatosGeneralesGroup(draftValue, draft, expeditionDepartment, birthDepartment, isEditMode);
  }

  if (activeTab === "vinculacion_laboral") {
    return buildTabVinculacionLaboralGroup({
      draftValue,
      selected,
      vinculationCompanyId,
      gestorNames,
      auxiliarGestorNames,
      gestorStatusMessage,
      institutionalEnabled,
      managerRole,
      institutionalMunicipality,
      municipalityNameResolved,
      institutionalMunicipalities,
      institutionNames,
      selectedInstitution,
      sedeNames,
      selectedSede,
      modalidadCatalog,
      selectedModality,
      normalizeCatalogText,
      educationalCatalogMessage: educationalCatalogMeta?.message || "",
      currentCargoReal,
    });
  }

  return buildTabHistorialObservacionesGroup(draftValue, dossier || null);
}

function _buildEmployeeDossierHeaderLegacy({
  draftValue,
  fullName,
  docType,
  docNumber,
  isEditMode,
  dossier,
}) {
  if (!isEditMode || !dossier) {
    return `
      <div class="employee-header-card">
        <div class="employee-header-copy">
          <h2 class="emp-name-title" id="employeeHeaderName">
            ${fullName || "NOMBRE COMPLETO"}
          </h2>
          <p class="emp-doc-subtitle" id="employeeHeaderDocument">
            ${[docType, docNumber].filter(Boolean).join(" · ") || "Tipo de documento · Número"}
          </p>
        </div>
        <button type="button" id="backToPersonnelTable" class="btn btn-secondary emp-back-btn">
          ← Volver
        </button>
      </div>
    `;
  }

  const assignment = dossier.currentAssignment || {};
  const employee = dossier.employee || {};
  const indicators = dossier.indicators || {};
  const documentSummary = dossier.documents?.summary || {};
  const alerts = Array.isArray(dossier.alerts) ? dossier.alerts.slice(0, 4) : [];
  const timeline = Array.isArray(dossier.timeline) ? dossier.timeline.slice(0, 6) : [];

  const position = draftValue("cargo_real") || assignment.position || employee.cargo_real || employee.position || "Sin cargo";
  const municipality = assignment.municipalityName || employee.municipalityName || employee.municipality_name || draftValue("municipalityName") || "Sin municipio";
  const institution = draftValue("institution") || assignment.institutionName || employee.institution || "Sin institución";
  const laborStatus =
    employee.employmentStatus || employee.employment_status ||
    ((draftValue("hasTermination") === "true" && draftValue("terminationDate")) ? "RETIRADO" : draftValue("status")) ||
    "Sin estado";
  const contractId = assignment.contractId || employee.contractId || draftValue("contractId") || "";
  const contractLabel = assignment.contractName || (contractId ? formatContract(contractId) : "Sin contrato");
  const docsHint = documentSummary.totalRequired
    ? `${documentSummary.approved || 0}/${documentSummary.totalRequired} validados`
    : "Sin matriz documental";
  const latestPayrollValue = indicators.latestPayrollLabel
    ? `${indicators.latestPayrollLabel}${indicators.latestPayrollNet ? ` · ${formatCurrencyValue(indicators.latestPayrollNet)}` : ""}`
    : "Sin nómina registrada";

  return `
    <div class="employee-header-card employee-dossier-header">
      <div class="employee-dossier-header-main">
        <div class="employee-header-copy">
          <h2 class="emp-name-title" id="employeeHeaderName">${fullName || "NOMBRE COMPLETO"}</h2>
          <p class="emp-doc-subtitle" id="employeeHeaderDocument">
            ${[docType, docNumber].filter(Boolean).join(" · ") || "Tipo de documento · Número"}
          </p>
        </div>
        <div class="employee-dossier-meta">
          ${buildDossierMetaItem("Cargo actual", position)}
          ${buildDossierMetaItem("Municipio", municipality)}
          ${buildDossierMetaItem("Institución", institution)}
          ${buildDossierMetaItem("Estado laboral", laborStatus)}
          ${buildDossierMetaItem("Contrato actual", contractLabel)}
        </div>
      </div>
      <button type="button" id="backToPersonnelTable" class="btn btn-secondary emp-back-btn">
        ← Volver
      </button>
    </div>

    <div class="employee-dossier-indicators-grid">
      ${buildDossierIndicator("Documentos completos", indicators.documentsStatus || "Sin dato", docsHint, getDossierTone(indicators.documentsStatus))}
      ${buildDossierIndicator("Novedades activas", String(indicators.activeNovelties ?? 0), `${dossier.payroll?.pendingReviewCount || 0} pendientes de revisión`, indicators.activeNovelties ? "warning" : "neutral")}
      ${buildDossierIndicator("Estado cobertura", indicators.coverageStatus || "Sin dato", assignment.coverageEnabled ? "Aplica a cobertura" : "Sin cobertura activa", getDossierTone(indicators.coverageStatus))}
      ${buildDossierIndicator("Última nómina", latestPayrollValue, "", indicators.latestPayrollLabel ? "success" : "neutral")}
      ${buildDossierIndicator("Alertas", String(indicators.alerts ?? 0), alerts[0]?.label || "Sin alertas activas", indicators.alerts ? "danger" : "success")}
    </div>

    ${alerts.length ? `
      <div class="employee-dossier-alerts">
        ${alerts.map((alert) => `<span class="employee-dossier-alert-chip">${escapeHtml(alert.label || "")}</span>`).join("")}
      </div>
    ` : ""}

    ${timeline.length ? `
      <div class="employee-dossier-timeline">
        <div class="employee-dossier-timeline-head">
          <strong>Actividad del expediente</strong>
          <span>${escapeHtml(String(dossier.timeline.length || 0))} eventos</span>
        </div>
        <div class="employee-dossier-timeline-list">
          ${timeline.map((item) => `
            <article class="employee-dossier-timeline-item">
              <div class="employee-dossier-timeline-date">${escapeHtml(formatUiDate(item.date))}</div>
              <div class="employee-dossier-timeline-copy">
                <strong>${escapeHtml(item.title || "Evento")}</strong>
                <p>${escapeHtml(item.description || "Movimiento registrado en el expediente.")}</p>
              </div>
            </article>
          `).join("")}
        </div>
      </div>
    ` : ""}
  `;
}

function buildEmployeeDossierHeader({
  draftValue,
  fullName,
  docType,
  docNumber,
  isEditMode,
  dossier,
}) {
  const dossierEmployee = dossier?.employee || {};
  const operationalSummary = buildDossierOperationalSummaryModel(dossier);
  const resolvedFullName = resolvePersonnelHeaderFullName({ draftValue, employee: dossierEmployee, fallback: fullName });
  const resolvedDocument = resolvePersonnelHeaderDocument({
    draftValue,
    employee: dossierEmployee,
    fallbackType: docType,
    fallbackNumber: docNumber,
  });
  const documentLabel = resolvedDocument.label || "TIPO DOCUMENTO NUMERO";
  const fallbackStatus = (draftValue("hasTermination") === "true" && draftValue("terminationDate"))
    ? "RETIRADO"
    : (draftValue("status") || "");
  const compactStatus = formatPersonnelStatusBadge(fallbackStatus);

  if (!isEditMode || !dossier) {
    return `
      <div class="employee-header-card employee-dossier-header employee-dossier-header-premium">
        <div class="employee-dossier-header-main">
          <div class="employee-dossier-title-row">
            ${buildEmployeeDossierIdentity({
              fullName: resolvedFullName,
              documentLabel,
              photoUrl: draftValue("photoUrl") || "",
              statusLabel: compactStatus.label,
              statusTone: compactStatus.tone,
            })}
            <button type="button" id="backToPersonnelTable" class="btn btn-secondary emp-back-btn">
              Volver
            </button>
          </div>
        </div>
      </div>
    `;
  }

  const assignment = dossier.currentAssignment || {};
  const employee = dossierEmployee;
  const indicators = operationalSummary.indicators || {};
  const coverageSummary = operationalSummary.coverage?.summary || {};
  const payrollSummary = operationalSummary.payroll || {};
  const dossierAlerts = operationalSummary.history?.alerts || [];
  const position = draftValue("cargo_real") || assignment.position || employee.cargo_real || employee.position || "Sin cargo";
  const municipality = assignment.municipalityName || employee.municipalityName || employee.municipality_name || draftValue("municipalityName") || "Sin municipio";
  const institution = draftValue("institution") || assignment.institutionName || employee.institution || "Sin institucion";
  const laborStatus =
    employee.employmentStatus || employee.employment_status ||
    ((draftValue("hasTermination") === "true" && draftValue("terminationDate")) ? "RETIRADO" : draftValue("status")) ||
    "Sin estado";
  const contractId = assignment.contractId || employee.contractId || draftValue("contractId") || "";
  const contractLabel = assignment.contractName || employee.contractName || (contractId ? formatContract(contractId) : "Sin contrato");
  const documentSummary = operationalSummary.documents.summary || {};
  const photoUrl = employee.photoUrl || employee.photo_url || draftValue("photoUrl") || "";
  const statusBadge = formatPersonnelStatusBadge(laborStatus);
  const contractLine = /^contrato\b/i.test(contractLabel || "") ? contractLabel : `Contrato ${contractLabel}`;
  const documentsBadge = formatDossierDocumentsBadge(documentSummary, indicators.documentsStatus || "");
  const coverageBadge = formatDossierCoverageBadge(coverageSummary, assignment);
  const payrollBadge = formatDossierPayrollBadge(indicators, payrollSummary);
  const noveltiesBadge = formatDossierNoveltiesBadge(indicators.activeNovelties ?? payrollSummary.activeNoveltiesCount ?? 0);
  const alertsBadge = formatDossierAlertsBadge(dossierAlerts);

  return `
    <div class="employee-header-card employee-dossier-header employee-dossier-header-premium">
      <div class="employee-dossier-header-main">
        <div class="employee-dossier-title-row">
          ${buildEmployeeDossierIdentity({
            fullName: resolvedFullName,
            documentLabel,
            photoUrl,
            statusLabel: statusBadge.label,
            statusTone: statusBadge.tone,
          })}
          <button type="button" id="backToPersonnelTable" class="btn btn-secondary emp-back-btn">
            Volver
          </button>
        </div>
        <div class="employee-dossier-secondary-block">
          ${buildDossierSecondaryLine([position], "Sin cargo", "employee-dossier-secondary-primary")}
          ${buildDossierSecondaryLine([municipality, institution, contractLine], "Sin informacion operativa", "employee-dossier-secondary-contract")}
        </div>
        <div class="employee-dossier-badges-row">
          ${buildDossierBadge(documentsBadge)}
          ${buildDossierBadge(coverageBadge)}
          ${buildDossierBadge(payrollBadge)}
          ${buildDossierBadge(noveltiesBadge)}
          ${buildDossierBadge(alertsBadge)}
        </div>
      </div>
    </div>
  `;
}

function getPersonnelBirthDate(item) {
  const direct =
    item.birthDate ||
    item.birth_date ||
    item.fecha_nacimiento ||
    item.fechaNacimiento ||
    "";
  if (direct) return direct;

  const day = String(item.birthDay || item.fecha_nacimiento_dia || "").padStart(2, "0");
  const month = String(item.birthMonth || item.fecha_nacimiento_mes || "").padStart(2, "0");
  const year = String(item.birthYear || item.fecha_nacimiento_anio || "");
  if (!day || !month || !year) return "";
  return `${year}-${month}-${day}`;
}

function getPersonnelExpeditionDate(item) {
  const direct =
    item.expeditionDate ||
    item.expedition_date ||
    item.fecha_expedicion ||
    item.fechaExpedicion ||
    "";
  if (direct) return direct;

  const day = String(item.expeditionDay || item.fecha_expedicion_dia || "").padStart(2, "0");
  const month = String(item.expeditionMonth || item.fecha_expedicion_mes || "").padStart(2, "0");
  const year = String(item.expeditionYear || item.fecha_expedicion_anio || "");
  if (!day || !month || !year) return "";
  return `${year}-${month}-${day}`;
}

function getPersonnelAge(item) {
  const birthDate = getPersonnelBirthDate(item);
  if (!birthDate) return "—";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? `${birthDate}T00:00:00` : birthDate);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  let years = now.getFullYear() - date.getFullYear();
  const monthDiff = now.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) years -= 1;
  return years >= 0 ? `${years} años` : "—";
}

function getPersonnelEps(item) {
  return item.eps || item.EPS || "—";
}

function getPersonnelArl(item) {
  return item.arl || item.ARL || "—";
}

function getPersonnelSalary(item) {
  const value = item.salary || item.salario || item.salario_basico || item.basicSalary || item.basic_salary;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(numeric);
}

const CONTRACT_TYPE_LABELS = {
  obra_labor:           "Obra o labor",
  termino_fijo:         "Término fijo",
  prestacion_servicios: "Prestación de servicios",
};
function getPersonnelContractType(item) {
  const raw = item.contractType || item.tipo_contrato || "";
  return CONTRACT_TYPE_LABELS[raw] || raw || "Sin definir";
}

function getPersonnelWorkTime(item) {
  return item.workTimeType || item.work_time_type || item.tipo_tiempo || "Sin jornada";
}

function normalizeChipStatus(value) {
  const norm = _norm(value);
  if (["ACTIVO", "VINCULADO", "COMPLETO", "VALIDADO"].includes(norm)) return "success";
  if (["PENDIENTE", "POR VENCER", "EN REVISION", "EN REVISIÓN"].includes(norm)) return "warning";
  if (["RETIRADO", "VENCIDO", "RECHAZADO", "NO APTO DOCUMENTAL", "INCOMPLETA", "INCOMPLETO"].includes(norm)) return "danger";
  return "neutral";
}

function getPersonnelDocumentMetrics(employee, allDocuments = []) {
  if (!allDocuments.length && employee && employee.documentTotal !== undefined) {
    const total = Number(employee.documentTotal || 0);
    const validated = Number(employee.documentValidated || 0);
    const pending = Number(employee.documentPending || 0);
    const rejected = Number(employee.documentRejected || 0);
    const expired = Number(employee.documentExpired || 0);
    const missing = Math.max(0, total - validated - pending - rejected - expired);
    const uploaded = Math.max(0, total - missing);
    const percent = total ? Math.round((uploaded / total) * 100) : 0;
    return {
      total,
      uploaded,
      validated,
      pending,
      rejected,
      expired,
      expiring: 0,
      missing,
      percent,
    };
  }

  const hv = getPersonnelHvStatusFull(employee, allDocuments);
  const employeeDocs = allDocuments.filter((doc) => String(doc.employeeId) === String(employee.id));
  const requiredDocs = getRequiredDocumentsForEmployee(employee).filter((doc) => doc.required);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let uploaded = 0;
  let validated = 0;
  let pending = 0;
  let missing = 0;
  let expired = 0;
  let expiring = 0;
  let rejected = 0;

  requiredDocs.forEach((req) => {
    const latest = employeeDocs
      .filter((doc) => sameDocumentType(doc.documentType, req.name))
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];

    if (!latest?.fileUrl) {
      missing += 1;
      return;
    }

    uploaded += 1;
    const status = _norm(latest.validationStatus || latest.status);
    let isExpiredDoc = false;
    let isExpiringDoc = false;
    if (status === "RECHAZADO") rejected += 1;
    if (status !== "VALIDADO") pending += 1;

    if (req.expirationDateRequired && latest.expirationDate) {
      const diff = Math.ceil((new Date(`${latest.expirationDate}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
      if (diff < 0) {
        expired += 1;
        isExpiredDoc = true;
      } else if (diff <= 30) {
        expiring += 1;
        isExpiringDoc = true;
      }
    }

    const hasDates =
      (!req.issueDateRequired || Boolean(latest.issueDate)) &&
      (!req.expirationDateRequired || Boolean(latest.expirationDate));

    if (status === "VALIDADO" && hasDates && !isExpiredDoc && !isExpiringDoc) validated += 1;
  });

  const total = requiredDocs.length;
  const percent = total ? Math.round((uploaded / total) * 100) : 100;

  return {
    ...hv,
    total,
    uploaded,
    validated,
    pending,
    missing,
    expired,
    expiring,
    rejected,
    percent,
  };
}

function buildPersonnelStatusChip(label) {
  if (!label) return "";
  return `<span class="status-chip ${normalizeChipStatus(label)}">${escapeHtml(label)}</span>`;
}

const PERSONNEL_WORKSPACE_TABS = [
  { key: "identificacion", label: "Identificación" },
  { key: "datos_generales", label: "Datos Personales" },
  { key: "vinculacion_laboral", label: "Vinculación" },
  { key: "historial_observaciones", label: "Historial" },
];

function getPersonnelWorkspaceTab() {
  const validTabs = new Set(PERSONNEL_WORKSPACE_TABS.map((tab) => tab.key));
  const current = String(state.personnelWorkspaceTab || "").trim();
  if (validTabs.has(current)) return current;
  state.personnelWorkspaceTab = "identificacion";
  return "identificacion";
}

function buildPersonnelDetailEmptyState(options = {}) {
  const canSelectFirst = Boolean(options.canSelectFirst);
  return `
    <div class="personnel-expediente-empty">
      <div class="personnel-expediente-empty-icon">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55">
          <path d="M8 4.75h8.5A2.75 2.75 0 0 1 19.25 7.5v9A2.75 2.75 0 0 1 16.5 19.25h-9A2.75 2.75 0 0 1 4.75 16.5V8"></path>
          <path d="M8.5 4.75V9.5A1.5 1.5 0 0 0 10 11h4.75"></path>
          <path d="M9 15h6"></path>
          <path d="M9 12.25h2.5"></path>
        </svg>
      </div>
      <h3>Selecciona un colaborador</h3>
      <p>El expediente aparecerá aquí con hoja de vida, documentos, cobertura, nómina y seguimiento.</p>
      ${canSelectFirst ? `<button type="button" class="btn btn-secondary personnel-expediente-empty-btn" data-open-first-personnel>Ver primer colaborador</button>` : ""}
    </div>
  `;
}

function buildPersonnelDetailLoadingState(employee) {
  return `
    <div class="personnel-expediente-empty personnel-expediente-empty-loading">
      <div class="personnel-expediente-empty-icon personnel-expediente-empty-spinner">
        <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <path d="M21 12a9 9 0 1 1-3.2-6.9"></path>
        </svg>
      </div>
      <h3>Cargando expediente</h3>
      <p>${escapeHtml(getPersonnelFullName(employee) || "Preparando la información del colaborador.")}</p>
    </div>
  `;
}

function buildPersonnelExpedienteField(label, value, options = {}) {
  const toneClass = options.tone ? ` tone-${escapeAttr(options.tone)}` : "";
  const spanClass = options.span ? ` span-${escapeAttr(String(options.span))}` : "";
  return `
    <div class="personnel-expediente-field${toneClass}${spanClass}">
      <span>${escapeHtml(label)}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function buildPersonnelExpedienteFields(items = []) {
  return items
    .filter((item) => item && item.label)
    .map((item) => buildPersonnelExpedienteField(item.label, item.value, item))
    .join("");
}

function buildPersonnelExpedienteSection(title, content, extraClass = "") {
  const className = extraClass
    ? `personnel-expediente-section ${extraClass}`.trim()
    : "personnel-expediente-section";
  return `
    <section class="${className}">
      <header class="personnel-expediente-section-head">
        <h4>${escapeHtml(title)}</h4>
      </header>
      <div class="personnel-expediente-section-body">
        ${content}
      </div>
    </section>
  `;
}

function buildPersonnelExpedienteCollection(items = [], emptyMessage = "Sin información registrada.", renderItem) {
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) {
    return `<div class="personnel-expediente-empty-block">${escapeHtml(emptyMessage)}</div>`;
  }
  return safeItems.map((item, index) => renderItem(item, index)).join("");
}

function toPersonnelDisplayCase(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("es-CO")
    .replace(/(^|[\s\-/.(])([\p{L}])/gu, (match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("es-CO")}`);
}

function formatPersonnelBoolean(value) {
  if (value === true || value === "true" || value === "SI" || value === "Sí") return "Sí";
  if (value === false || value === "false" || value === "NO") return "No";
  return "—";
}

function formatPersonnelDocumentSummary(summary = {}, fallbackMetrics = {}) {
  const total = Number(summary.totalRequired || fallbackMetrics.total || 0);
  const uploaded = Number(summary.uploaded || fallbackMetrics.uploaded || summary.approved || fallbackMetrics.validated || 0);
  const approved = Number(summary.approved || fallbackMetrics.validated || uploaded || 0);
  const expiring = Number(summary.expiring || fallbackMetrics.expiring || 0);
  const expired = Number(summary.expired || fallbackMetrics.expired || 0);
  const missing = Number(summary.missing || fallbackMetrics.missing || 0);
  const rejected = Number(summary.rejected || fallbackMetrics.rejected || 0);
  const pending = Number(summary.pending || fallbackMetrics.pending || 0);
  const percent = total ? Math.round((approved / total) * 100) : Number(fallbackMetrics.percent || 0);
  return {
    total,
    uploaded,
    approved,
    expiring,
    expired,
    missing,
    rejected,
    pending,
    percent: Math.max(0, Math.min(100, percent)),
  };
}

function buildPersonnelDocumentsTab(employee, dossierSummary, docMetrics) {
  const summary = formatPersonnelDocumentSummary(dossierSummary.documents.summary, docMetrics);
  const hvStatus = getPersonnelHvStatusFull(employee, []);
  const progressTone = summary.percent >= 100 ? "success" : summary.percent >= 60 ? "warning" : "danger";
  const progressLabel = summary.percent >= 100
    ? "Completo"
    : summary.percent >= 60
      ? "En revisión"
      : "Incompleto";
  const documentItems = Array.isArray(dossierSummary.documents.items) ? dossierSummary.documents.items : [];

  // Donut chart SVG para completitud
  const _r = 24, _cx = 32, _cy = 32, _circ = +(2 * Math.PI * _r).toFixed(2);
  const _offset = +(_circ - (Math.min(summary.percent, 100) / 100) * _circ).toFixed(2);
  const _fillMap = { success: "#16a34a", warning: "#f59e0b", danger: "#ef4444" };
  const _fill = _fillMap[progressTone] || "#3b82f6";
  const _donut = `<svg class="personnel-doc-donut-svg" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><circle cx="${_cx}" cy="${_cy}" r="${_r}" fill="none" stroke="rgba(226,232,240,0.7)" stroke-width="7"/><circle cx="${_cx}" cy="${_cy}" r="${_r}" fill="none" stroke="${_fill}" stroke-width="7" stroke-dasharray="${_circ}" stroke-dashoffset="${_offset}" stroke-linecap="round" transform="rotate(-90 ${_cx} ${_cy})"/></svg>`;

  const itemsHtml = buildPersonnelExpedienteCollection(
    documentItems,
    "La matriz documental detallada estará disponible cuando el expediente tenga soportes vinculados.",
    (item) => {
      const name = item.name || item.label || item.documentName || item.documentTypeName || item.documentType || "Documento";
      const status = item.statusLabel || item.status || item.validationStatus || "Pendiente";
      const required = item.required === false ? "Opcional" : "Obligatorio";
      const tone = normalizeChipStatus(status);
      const icon = tone === "success"
        ? "✓"
        : tone === "warning"
          ? "•"
          : tone === "danger"
            ? "!"
            : "•";
      const dateParts = [
        item.issueDate ? `Exp. ${formatUiDate(item.issueDate)}` : "",
        item.expirationDate ? `Vence ${formatUiDate(item.expirationDate)}` : "",
      ].filter(Boolean);
      return `
        <article class="personnel-expediente-check-item tone-${escapeAttr(tone)}">
          <div class="personnel-expediente-check-icon" aria-hidden="true">${escapeHtml(icon)}</div>
          <div class="personnel-expediente-check-copy">
            <strong>${escapeHtml(name)}</strong>
            <p>${escapeHtml(required)}${dateParts.length ? ` · ${escapeHtml(dateParts.join(" · "))}` : ""}</p>
          </div>
          <span class="status-chip ${tone}">${escapeHtml(status)}</span>
        </article>
      `;
    }
  );

  const checklistHtml = documentItems.length
    ? `<div class="personnel-expediente-checklist-grid">${itemsHtml}</div>`
    : itemsHtml;

  return [
    buildPersonnelExpedienteSection(
      "Checklist documental",
      `
        <div class="personnel-expediente-doc-summary">
          <div class="personnel-expediente-doc-hero">
            <div class="personnel-doc-donut-wrap">
              ${_donut}
              <div class="personnel-doc-donut-legend">
                <strong>${summary.percent}%</strong>
                <span>${escapeHtml(progressLabel)}</span>
              </div>
            </div>
            <span class="status-chip ${hvStatus.className}">${escapeHtml(hvStatus.label)}</span>
          </div>
          <div class="personnel-expediente-metrics personnel-expediente-metrics-4">
            ${buildPersonnelExpedienteField("Cargados", escapeHtml(`${summary.uploaded || docMetrics.uploaded || 0}/${summary.total || 0}`), { tone: "info" })}
            ${buildPersonnelExpedienteField("Pendientes", escapeHtml(String(summary.pending + summary.missing)), { tone: "warning" })}
            ${buildPersonnelExpedienteField("Por vencer", escapeHtml(String(summary.expiring)), { tone: "caution" })}
            ${buildPersonnelExpedienteField("Vencidos / rechazados", escapeHtml(String(summary.expired + summary.rejected)), { tone: "danger" })}
          </div>
          <div class="personnel-expediente-doc-actions">
            <div class="personnel-expediente-doc-caption">
              <strong>${escapeHtml(`${summary.approved || 0} validados`)}</strong>
              <span>${escapeHtml(summary.total ? `${summary.total} requisitos en matriz` : "Sin matriz documental cargada")}</span>
            </div>
            <button type="button" class="btn btn-gestionar-docs" data-documents-personnel-id="${escapeAttr(employee.id)}">Gestionar documentos →</button>
          </div>
        </div>
        ${checklistHtml}
      `,
      "personnel-expediente-section-docs"
    ),
    buildPersonnelExpedienteSection(
      "Desprendibles de nómina",
      `<div class="personnel-payroll-slips-shell" data-slips-employee-id="${escapeAttr(String(employee.id))}">
        <div class="personnel-expediente-empty">Consultando desprendibles…</div>
      </div>`,
      "personnel-expediente-section-slips"
    ),
  ].join("");
}

function buildPersonnelObservationsTab(observations = []) {
  return buildPersonnelExpedienteSection(
    "Observaciones registradas",
    buildPersonnelExpedienteCollection(
      observations,
      "No hay observaciones registradas para este colaborador.",
      (observation) => `
        <article class="personnel-expediente-note">
          <div class="personnel-expediente-note-meta">
            <strong>${escapeHtml(observation.user || "Sistema")}</strong>
            <span>${escapeHtml(formatUiDate(observation.date || ""))}</span>
          </div>
          <p>${escapeHtml(observation.text || "")}</p>
          ${observation.attachmentUrl
            ? `<a href="${escapeAttr(observation.attachmentUrl)}" rel="noopener noreferrer">${escapeHtml(observation.attachmentName || "Ver adjunto")}</a>`
            : ""}
        </article>
      `
    )
  );
}

function buildPersonnelStudiesTab(draft) {
  const studies = Array.isArray(draft.studies) ? draft.studies : [];
  return buildPersonnelExpedienteSection(
    "Formación académica",
    `<div class="personnel-expediente-card-grid">${buildPersonnelExpedienteCollection(
      studies,
      "No hay estudios registrados para este colaborador.",
      (study) => `
        <article class="personnel-expediente-record">
          <strong>${escapeHtml(study.degree || "Sin título registrado")}</strong>
          <p>${escapeHtml([study.educationLevel, study.institution, study.year].filter(Boolean).join(" · ") || "Sin detalles de formación")}</p>
        </article>
      `
    )}</div>`
  );
}

function buildPersonnelExperienceTab(draft) {
  const experiences = Array.isArray(draft.workExperience) ? draft.workExperience : [];
  return buildPersonnelExpedienteSection(
    "Experiencia laboral",
    `<div class="personnel-expediente-card-grid">${buildPersonnelExpedienteCollection(
      experiences,
      "No hay experiencia laboral registrada para este colaborador.",
      (experience) => `
        <article class="personnel-expediente-record">
          <strong>${escapeHtml(experience.empresa || "Empresa sin nombre")}</strong>
          <p>${escapeHtml([
            experience.cargo || "",
            experience.fechaInicio ? `Inicio ${experience.fechaInicio}` : "",
            experience.fechaFin ? `Fin ${experience.fechaFin}` : "Actual",
            experience.dias != null ? `${experience.dias} días` : "",
          ].filter(Boolean).join(" · ") || "Sin detalle de experiencia")}</p>
        </article>
      `
    )}</div>`
  );
}

function getPersonnelComplianceSummary(item, allDocuments = []) {
  const metrics = getPersonnelDocumentMetrics(item, allDocuments);
  const hv = allDocuments.length
    ? getPersonnelHvStatusFull(item, allDocuments)
    : { label: "", className: "" };
  let label = "Parcial";
  let tone = "warning";
  const percent = Math.max(0, Math.min(100, Number(metrics.percent || 0)));

  if (hv.label === "No apto documental" || metrics.rejected > 0 || metrics.expired > 0 || percent < 50) {
    label = "Crítico";
    tone = "danger";
  } else if (hv.label === "Completa" || percent >= 95) {
    label = "Completo";
    tone = "success";
  }

  return {
    percent,
    label,
    tone,
  };
}

function buildPersonnelWorkspaceListItem(item, isSelected, allDocuments = []) {
  const fullName = getPersonnelFullName(item);
  const documentNumber = getPersonnelDocument(item);
  const municipality = getPersonnelMunicipality(item) || "Sin municipio";
  const displayName = toPersonnelDisplayCase(fullName || "Sin nombre");
  const displayMunicipality = toPersonnelDisplayCase(municipality);
  const compliance = getPersonnelComplianceSummary(item, allDocuments);
  return `
    <button
      type="button"
      class="personnel-dossier-list-item${isSelected ? " selected" : ""}"
      data-select-personnel-id="${escapeAttr(item.id)}"
      aria-pressed="${isSelected ? "true" : "false"}"
      title="${escapeAttr(`${displayName} · CC ${documentNumber || "—"} · ${displayMunicipality}`)}"
    >
      <span class="personnel-dossier-list-dot tone-${escapeAttr(compliance.tone)}" aria-hidden="true"></span>
      <span class="personnel-dossier-list-copy">
        <strong title="${escapeAttr(displayName)}">${escapeHtml(displayName)}</strong>
        <span class="personnel-dossier-list-meta" title="${escapeAttr(`CC ${documentNumber || "—"} · ${displayMunicipality}`)}">
          CC ${escapeHtml(documentNumber || "—")} · ${escapeHtml(displayMunicipality)}
        </span>
      </span>
    </button>
  `;
}

function buildPersonnelDetailPanel(employee, allDocuments = null, dossier = null, options = {}) {
  if (!employee) {
    return buildPersonnelDetailEmptyState(options);
  }
  if (allDocuments === null) {
    return buildPersonnelDetailLoadingState(employee);
  }

  const draft = hydratePersonnelDraft(employee);
  const draftValue = (name, fallback = "") => {
    const value = draft[name];
    if (value === undefined || value === null || value === "") return fallback;
    return value;
  };
  const assignment = dossier?.currentAssignment || {};
  const fullName = getPersonnelDraftDisplayName(draftValue);
  const workStatus = getPersonnelWorkStatus(employee);
  const statusBadge = formatPersonnelStatusBadge(workStatus);
  const role = getPersonnelRole(employee);
  const company = getPersonnelCompanyLabel(employee);
  const municipality = getPersonnelMunicipality(employee) || draftValue("municipalityName");
  const institution = getPersonnelInstitution(employee);
  const site = getPersonnelSite(employee);
  const modality = getPersonnelModality(employee);
  const documentType = String(draftValue("documentType", employee.documentType || employee.tipo_documento || "CC")).toUpperCase();
  const documentNumber = getPersonnelDocument(employee);
  const documentLabel = [documentType, documentNumber].filter(Boolean).join(" ");
  const birthDate = getPersonnelBirthDate(employee);
  const expeditionDate = getPersonnelExpeditionDate(employee);
  const age = getPersonnelAge(employee);
  const documentMetrics = getPersonnelDocumentMetrics(employee, allDocuments);
  const compliance = getPersonnelComplianceSummary(employee, allDocuments);
  const dossierSummary = buildDossierOperationalSummaryModel(dossier);
  const indicators = dossierSummary.indicators || {};
  const coverageSummary = dossierSummary.coverage?.summary || {};
  const payrollSummary = dossierSummary.payroll || {};
  const dossierAlerts = dossierSummary.history?.alerts || [];
  const observations = Array.isArray(draft.observations)
    ? draft.observations.slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    : [];
  const activeTab = getPersonnelWorkspaceTab();
  const photoUrl = employee.photoUrl || employee.photo_url || draft.photoUrl || "";
  const photoHtml = photoUrl
    ? `<img src="${escapeAttr(photoUrl)}" alt="Foto del colaborador" class="cv-photo-img" />`
    : `<span class="cv-photo-initials" style="${getPersonnelAvatarStyle(employee)}">${escapeHtml(getPersonnelInitials(employee))}</span>`;
  const headerChips = [
    { label: statusBadge.label, tone: statusBadge.tone },
  ].filter((item) => String(item.label || "").trim());
  const documentsBadge = formatDossierDocumentsBadge(dossierSummary.documents.summary || {}, indicators.documentsStatus || "");
  const coverageBadge = formatDossierCoverageBadge(coverageSummary, assignment);
  const payrollBadge = formatDossierPayrollBadge(indicators, payrollSummary);
  const noveltiesBadge = formatDossierNoveltiesBadge(indicators.activeNovelties ?? payrollSummary.activeNoveltiesCount ?? 0);
  const alertsBadge = formatDossierAlertsBadge(dossierAlerts);
  const heroBadgesHtml = [
    buildDossierBadge(documentsBadge),
    buildDossierBadge(coverageBadge),
    buildDossierBadge(payrollBadge),
    buildDossierBadge(noveltiesBadge),
    buildDossierBadge(alertsBadge),
  ].join("");

  const identificationHtml = buildPersonnelExpedienteSection(
    "Identificación",
    `<div class="personnel-expediente-grid personnel-expediente-grid-4">
      ${buildPersonnelExpedienteFields([
        { label: "Documento", value: escapeHtml(documentLabel || "—"), span: 2 },
        { label: "Fecha de nacimiento", value: escapeHtml(birthDate ? `${formatUiDate(birthDate)}${age && age !== "—" ? ` · ${age}` : ""}` : "—") },
        { label: "Fecha de expedición", value: escapeHtml(expeditionDate ? formatUiDate(expeditionDate) : "—") },
        { label: "Sexo", value: escapeHtml(({ F: "Femenino", M: "Masculino" }[String(draftValue("biologicalSex", employee.biologicalSex || employee.sex || "")).toUpperCase()] || "—")) },
        { label: "Grupo sanguíneo", value: escapeHtml(draftValue("bloodType", employee.grupo_sanguineo || "—")) },
        { label: "Estado civil", value: escapeHtml(draftValue("civilStatus", employee.estado_civil || "—")) },
        { label: "Nacionalidad", value: escapeHtml(draftValue("birthCountry", employee.birthCountry || employee.pais_nacimiento || "Colombia") || "—") },
      ])}
    </div>`
  );

  const identificationOriginHtml = buildPersonnelExpedienteSection(
    "Origen y expedición",
    `<div class="personnel-expediente-grid personnel-expediente-grid-4">
      ${buildPersonnelExpedienteFields([
        { label: "Departamento de expedición", value: escapeHtml(draftValue("expeditionDepartment", employee.expeditionDepartment || employee.departamento_expedicion || "—")) },
        { label: "Municipio de expedición", value: escapeHtml(getNormalizedMunicipalityValue([draftValue("expeditionMunicipality"), employee.expeditionMunicipalityName, employee.expedition_municipality_name, employee.expeditionMunicipality, employee.municipio_expedicion])) },
        { label: "Departamento de nacimiento", value: escapeHtml(draftValue("birthDepartment", employee.birthDepartment || employee.departamento_nacimiento || "—")) },
        { label: "Municipio de nacimiento", value: escapeHtml(getNormalizedMunicipalityValue([draftValue("birthMunicipality"), employee.birthMunicipalityName, employee.birth_municipality_name, employee.birthMunicipality, employee.municipio_nacimiento])) },
      ])}
    </div>`
  );

  const generalContactHtml = buildPersonnelExpedienteSection(
    "Datos personales",
    `<div class="personnel-expediente-grid personnel-expediente-grid-4">
      ${buildPersonnelExpedienteFields([
        { label: "Teléfono", value: escapeHtml(draftValue("phone", employee.celular || "—")) },
        { label: "Correo", value: escapeHtml(draftValue("email", employee.correo_electronico || "—")), span: 2 },
        { label: "Dirección", value: escapeHtml(draftValue("address", employee.direccion_residencia || "—")), span: 2 },
        { label: "Barrio", value: escapeHtml(draftValue("neighborhood", employee.barrio_residencia || "—")) },
        { label: "Municipio de residencia", value: escapeHtml(getNormalizedMunicipalityValue([draftValue("residenceMunicipality"), employee.residenceMunicipalityName, employee.residence_municipality_name, employee.residenceMunicipality, employee.municipio_residencia])), span: 2 },
        { label: "Zona", value: escapeHtml(draftValue("residenceZone", employee.zona_residencia || "—")) },
      ])}
    </div>`
  );

  const licitationHtml = buildPersonnelExpedienteSection(
    "Licitación",
    `<div class="personnel-expediente-grid personnel-expediente-grid-4">
      ${buildPersonnelExpedienteFields([
        { label: "Presentado en oferta", value: escapeHtml(formatPersonnelBoolean(draftValue("presentedInOffer", employee.presentedInOffer || employee.presented_in_offer || ""))) },
        { label: "Cargo presentado", value: escapeHtml(draftValue("offerPosition", employee.offerPosition || employee.cargo_presentado_en_licitacion || "—")), span: 3 },
      ])}
    </div>`
  );

  const vinculationHtml = [
    buildPersonnelExpedienteSection(
      "Vinculación laboral",
      `<div class="personnel-expediente-grid personnel-expediente-grid-4">
        ${buildPersonnelExpedienteFields([
          { label: "Empresa", value: escapeHtml(company) },
          { label: "Cargo", value: escapeHtml(role) },
          { label: "Contrato", value: escapeHtml(getPersonnelContractLabel(employee)) },
          { label: "Tipo de contrato", value: escapeHtml(getPersonnelContractType(employee)) },
          { label: "Jornada", value: escapeHtml(getPersonnelWorkTime(employee)) },
          { label: "Estado", value: escapeHtml(workStatus), tone: statusBadge.tone },
          { label: "Ingreso", value: escapeHtml(formatUiDate(draftValue("startDate", employee.startDate || employee.start_date || ""))) },
          { label: "Inicio cobertura", value: escapeHtml(formatUiDate(getPersonnelCoverageStart(employee))) },
          { label: "Vinculación ARL", value: escapeHtml(formatUiDate(draftValue("arlVinculationDate", employee.arlVinculationDate || employee.fecha_real_vinculacion_arl || ""))) },
          { label: "Retiro", value: escapeHtml(formatUiDate(draftValue("terminationDate", employee.fecha_retiro || ""))) },
        ])}
      </div>`
    ),
    buildPersonnelExpedienteSection(
      "Seguridad social",
      `<div class="personnel-expediente-grid personnel-expediente-grid-4">
        ${buildPersonnelExpedienteFields([
          { label: "EPS", value: escapeHtml(getPersonnelEps(employee)) },
          { label: "ARL", value: escapeHtml(getPersonnelArl(employee)) },
          { label: "Pensión", value: escapeHtml(draftValue("pensionFund", employee.fondo_pensiones || "—")) },
          { label: "Caja de compensación", value: escapeHtml(draftValue("compensationBox", employee.caja_compensacion || "COFREM")) },
        ])}
      </div>`
    ),
  ].join("");

  const contractingHtml = [
    buildPersonnelExpedienteSection(
      "Condiciones contractuales",
      `<div class="personnel-expediente-grid personnel-expediente-grid-4">
        ${buildPersonnelExpedienteFields([
          { label: "Salario", value: escapeHtml(getPersonnelSalary(employee)) },
          { label: "Tipo de cuenta", value: escapeHtml(draftValue("accountType", employee.accountType || employee.account_type || "—")) },
          { label: "Banco", value: escapeHtml(draftValue("bankName", employee.bankName || employee.bank_name || "—")) },
          { label: "Número de cuenta", value: escapeHtml(draftValue("accountNumber", employee.accountNumber || employee.account_number || "—")) },
        ])}
      </div>`
    ),
    buildPersonnelExpedienteSection(
      "Dotación",
      `<div class="personnel-expediente-grid personnel-expediente-grid-4">
        ${buildPersonnelExpedienteFields([
          { label: "Camisa", value: escapeHtml(draftValue("shirtSize", employee.shirtSize || employee.shirt_size || "—")) },
          { label: "Pantalón", value: escapeHtml(draftValue("pantsSize", employee.pantsSize || employee.pants_size || "—")) },
          { label: "Calzado", value: escapeHtml(draftValue("shoeSize", employee.shoeSize || employee.shoe_size || "—")) },
        ])}
      </div>`
    ),
  ].join("");

  const institutionalHtml = buildPersonnelExpedienteSection(
    "Cobertura",
    `<div class="personnel-expediente-grid personnel-expediente-grid-4">
      ${buildPersonnelExpedienteFields([
        { label: "Institución", value: escapeHtml(institution || "Sin institución") },
        { label: "Sede", value: escapeHtml(site || "Sin sede") },
        { label: "Municipio operativo", value: escapeHtml(municipality || "—") },
        { label: "Modalidad", value: escapeHtml(modality || "—") },
        { label: "Gestor de zona", value: escapeHtml(draftValue("gestorZona", employee.gestor_zona || "—")) },
        { label: "Auxiliar gestor", value: escapeHtml(draftValue("auxiliarGestorZona", employee.auxiliar_gestor_zona || "—")) },
        { label: "Municipios a cargo", value: escapeHtml(draftValue("municipiosACargo", employee.municipios_a_cargo || "—")) },
      ])}
    </div>`
  );

  const seguimientoHtml = [
    buildPersonnelExpedienteSection(
      "SISBEN y residencia",
      `<div class="personnel-expediente-grid personnel-expediente-grid-4">
        ${buildPersonnelExpedienteFields([
          { label: "Tiene SISBEN", value: escapeHtml(formatPersonnelBoolean(draftValue("sisben", employee.sisben || employee.sisben_tiene || ""))) },
          { label: "Categoría SISBEN", value: escapeHtml(draftValue("sisbenCategory", employee.sisben_categoria || "—")) },
          { label: "Expedición SISBEN", value: escapeHtml(formatUiDate(draftValue("sisbenIssueDate", employee.sisbenIssueDate || employee.sisben_issue_date || ""))) },
          { label: "Vencimiento SISBEN", value: escapeHtml(formatUiDate(draftValue("sisbenExpirationDate", employee.sisbenExpirationDate || employee.sisben_expiration_date || ""))) },
          { label: "Certificado de residencia", value: escapeHtml(formatPersonnelBoolean(draftValue("hasResidenceCertificate", employee.hasResidenceCertificate || employee.has_residence_certificate || ""))) },
          { label: "Expedición residencia", value: escapeHtml(formatUiDate(draftValue("residenceCertificateIssueDate", employee.residenceCertificateIssueDate || employee.residence_certificate_issue_date || ""))) },
          { label: "Vencimiento residencia", value: escapeHtml(formatUiDate(draftValue("residenceCertificateExpiration", employee.residenceCertificateExpiration || employee.residence_certificate_expiration || ""))) },
        ])}
      </div>`
    ),
    buildPersonnelExpedienteSection(
      "Manipulación de alimentos",
      `<div class="personnel-expediente-grid personnel-expediente-grid-4">
        ${buildPersonnelExpedienteFields([
          { label: "Curso · expedición", value: escapeHtml(formatUiDate(draftValue("foodHandlingCourseIssueDate", employee.foodHandlingCourseIssueDate || employee.food_handling_course_issue_date || ""))) },
          { label: "Curso · vencimiento", value: escapeHtml(formatUiDate(draftValue("foodHandlingCourseExpirationDate", employee.foodHandlingCourseExpirationDate || employee.food_handling_course_expiration_date || ""))) },
          { label: "Exámenes · expedición", value: escapeHtml(formatUiDate(draftValue("foodHandlingExamIssueDate", employee.foodHandlingExamIssueDate || employee.food_handling_exam_issue_date || ""))) },
          { label: "Exámenes · vencimiento", value: escapeHtml(formatUiDate(draftValue("foodHandlingExamExpirationDate", employee.foodHandlingExamExpirationDate || employee.food_handling_exam_expiration_date || ""))) },
        ])}
      </div>`
    ),
  ].join("");

  const tabsHtml = PERSONNEL_WORKSPACE_TABS.map((tab) => `
    <button
      type="button"
      class="personnel-expediente-tab${activeTab === tab.key ? " active" : ""}"
      data-expediente-tab="${escapeAttr(tab.key)}"
    >
      ${escapeHtml(tab.label)}
    </button>
  `).join("");

  const tabPanels = [
    { key: "identificacion", content: [identificationHtml, identificationOriginHtml].join("") },
    { key: "datos_generales", content: [generalContactHtml, buildPersonnelStudiesTab(draft), buildPersonnelExperienceTab(draft), seguimientoHtml].join("") },
    { key: "vinculacion_laboral", content: [licitationHtml, vinculationHtml, contractingHtml, institutionalHtml].join("") },
    { key: "historial_observaciones", content: [buildPersonnelDocumentsTab(employee, dossierSummary, documentMetrics), buildPersonnelObservationsTab(observations), buildPersonnelExpedienteSection("Historial del expediente", buildTabHistorial(dossier || {}))].join("") },
  ].map((panel) => `
    <section
      class="personnel-expediente-tab-panel${activeTab === panel.key ? " active" : ""}"
      data-expediente-panel="${escapeAttr(panel.key)}"
    >
      ${panel.content}
    </section>
  `).join("");

  return `
    <article class="personnel-expediente-shell employee-detail">
      <header class="personnel-expediente-hero employee-detail-header employee-dossier-header-premium">
        <div class="employee-dossier-header-main personnel-expediente-hero-main">
          <div class="personnel-expediente-toolbelt" aria-label="Acciones del expediente">
            <button
              type="button"
              class="personnel-icon-btn personnel-expediente-icon-btn btn-icon-edit"
              data-edit-personnel-id="${escapeAttr(employee.id)}"
              title="Editar expediente"
              aria-label="Editar expediente"
            >
              <svg viewBox="0 0 24 24">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
              </svg>
            </button>
            <button
              type="button"
              class="personnel-icon-btn personnel-expediente-icon-btn btn-icon-docs"
              data-documents-personnel-id="${escapeAttr(employee.id)}"
              title="Documentos"
              aria-label="Documentos"
            >
              <svg viewBox="0 0 24 24">
                <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"></path>
                <path d="M14 2v5h5"></path>
                <path d="M9 13h6"></path>
                <path d="M9 17h6"></path>
              </svg>
            </button>
            <button
              type="button"
              class="personnel-icon-btn personnel-expediente-icon-btn btn-icon-view"
              data-cv-personnel-id="${escapeAttr(employee.id)}"
              title="Hoja de vida"
              aria-label="Hoja de vida"
            >
              <svg viewBox="0 0 24 24">
                <path d="M6 9V4h12v16H6z"></path>
                <path d="M9 8h6"></path>
                <path d="M9 12h6"></path>
                <path d="M9 16h4"></path>
              </svg>
            </button>
            <button
              type="button"
              class="personnel-icon-btn personnel-expediente-icon-btn btn-icon-close"
              data-clear-personnel-selection
              title="Cerrar expediente"
              aria-label="Cerrar expediente"
            >
              <svg viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="employee-dossier-title-row personnel-expediente-title-row">
            <div class="employee-dossier-identity personnel-expediente-identity">
            <div class="personnel-expediente-photo ring-${escapeAttr(statusBadge.tone)}" data-photo-upload-id="${escapeAttr(employee.id)}">
              ${photoHtml}
              <div class="cv-photo-overlay">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <span>Actualizar foto</span>
              </div>
              <input type="file" class="cv-photo-input" accept="image/*" style="display:none" />
            </div>
            <div class="employee-dossier-identity-copy personnel-expediente-copy">
              <div class="personnel-expediente-row personnel-expediente-row-main">
                <div class="personnel-expediente-primary employee-dossier-secondary-block">
                  <h2 title="${escapeAttr(fullName || "Sin nombre")}">${escapeHtml(fullName || "Sin nombre")}</h2>
                  <p class="emp-doc-subtitle">${escapeHtml(documentLabel || "Documento pendiente")}</p>
                  ${buildDossierSecondaryLine([role], "Sin cargo", "employee-dossier-secondary-primary")}
                  ${buildDossierSecondaryLine([municipality, institution, company], "Sin informacion operativa", "employee-dossier-secondary-contract")}
                </div>
              </div>
              <div class="personnel-expediente-row personnel-expediente-row-meta personnel-expediente-row-meta-premium">
                <div class="personnel-expediente-badges personnel-expediente-status-badges">
                  ${headerChips.map((badge) => `<span class="status-chip ${escapeAttr(badge.tone)}">${escapeHtml(badge.label)}</span>`).join("")}
                </div>
                <div class="employee-dossier-badges-row personnel-expediente-kpi-badges">
                  ${heroBadgesHtml}
                </div>
              </div>
              <div class="personnel-expediente-row personnel-expediente-row-progress">
                <div class="personnel-expediente-progress personnel-expediente-progress-premium">
                  <div class="personnel-expediente-progress-head">
                    <span>Completitud expediente</span>
                    <strong>${escapeHtml(`${compliance.percent}%`)}</strong>
                  </div>
                  <div class="personnel-expediente-progress-bar tone-${escapeAttr(compliance.tone)}">
                    <span style="width:${escapeAttr(compliance.percent)}%"></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>
      </header>

      <div class="personnel-expediente-scroll-shell employee-detail-body">
        <div class="personnel-expediente-scroll">
          <nav class="personnel-expediente-tabs" aria-label="Secciones del expediente">
            ${tabsHtml}
          </nav>

          <div class="personnel-expediente-content">
            ${tabPanels}
          </div>
        </div>
      </div>
    </article>
  `;
}

function getRequiredDocumentsForEmployee(employee) {
  const normalize = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .trim();

  const isPresented =
    employee.presentacion_en_licitacion === true ||
    employee.presentacion_en_licitacion === "true" ||
    employee.presented_in_offer === true ||
    employee.presented_in_offer === "true" ||
    employee.presentedInOffer === true ||
    employee.presentedInOffer === "true";

  const offerPosition = normalize(
    employee.cargo_presentado_en_licitacion ||
      employee.offered_position ||
      employee.offerPosition ||
      employee.offer_position
  );

  const realPosition = normalize(
    employee.cargo_real ||
      employee.real_position ||
      employee.position ||
      employee.cargo
  );

  const position = isPresented ? offerPosition : realPosition;

  const doc = (name, options = {}) => ({
    name,
    required: options.required !== false,
    issueDateRequired: !!options.issueDateRequired,
    expirationDateRequired: !!options.expirationDateRequired,
    requiresPdf: options.requiresPdf !== false,
    requiresValidation: options.requiresValidation !== false,
    group: options.group || "GENERAL",
  });

  const BASE = [
    doc("CEDULA", { group: "IDENTIFICACION" }),
    doc("HOJA DE VIDA", { group: "IDENTIFICACION" }),
    doc("EXPERIENCIA LABORAL", { group: "SOPORTE" }),
    doc("AUTORIZACION DE DATOS PERSONALES", { group: "AUTORIZACIONES" }),
    doc("AUTORIZACION DE CONSULTA DE INHABILIDADES", { group: "AUTORIZACIONES" }),
  ];

  const ANTECEDENTES = [
    doc("CONTRALORIA",                    { issueDateRequired: true, expirationDateRequired: true, group: "ANTECEDENTES" }),
    doc("PROCURADURIA",                   { issueDateRequired: true, expirationDateRequired: true, group: "ANTECEDENTES" }),
    doc("ANTECEDENTES JUDICIALES",        { issueDateRequired: true, expirationDateRequired: true, group: "ANTECEDENTES" }),
    doc("ANTECEDENTES DE MEDIDAS CORRECTIVAS", { issueDateRequired: true, expirationDateRequired: true, group: "ANTECEDENTES" }),
    doc("REDAM",                          { issueDateRequired: true, expirationDateRequired: true, group: "ANTECEDENTES" }),
    doc("CONSULTA DE INHABILIDADES",      { issueDateRequired: true, expirationDateRequired: true, group: "ANTECEDENTES" }),
  ];

  const ALIMENTOS = [
    doc("CURSO MANIPULACION DE ALIMENTOS",   { issueDateRequired: true, expirationDateRequired: true, group: "ALIMENTOS" }),
    doc("EXAMENES MANIPULACION DE ALIMENTOS",{ issueDateRequired: true, expirationDateRequired: true, group: "ALIMENTOS" }),
  ];

  const AFILIACIONES = [
    doc("CONTRATO",                           { group: "CONTRATACION" }),
    doc("AFILIACION ARL",                     { group: "SEGURIDAD SOCIAL" }),
    doc("AFILIACION EPS",                     { group: "SEGURIDAD SOCIAL" }),
    doc("AFILIACION AFP",                     { group: "SEGURIDAD SOCIAL" }),
    doc("AFILIACION CAJA DE COMPENSACION COFREM", { group: "SEGURIDAD SOCIAL" }),
  ];

  const FORMATOS = [
    doc("FORMATO DE INDUCCION", { group: "FORMATOS" }),
    doc("FORMATO DE DOTACION",  { group: "FORMATOS" }),
  ];

  const OPTIONAL_TERRITORIAL = [
    doc("RESIDENCIA EXPEDIDA POR ALCALDIA", { required: false, issueDateRequired: true, expirationDateRequired: true, group: "TERRITORIAL" }),
    doc("SISBEN",                           { required: false, issueDateRequired: true, expirationDateRequired: true, group: "TERRITORIAL" }),
  ];

  const studiesByPosition = () => {
    if (
      position === "COORDINADOR DE SUMINISTRO" ||
      position === "SUPERVISOR DE CALIDAD" ||
      position === "AREA DE CALIDAD"
    ) {
      return [
        doc("ESTUDIOS PROFESIONAL", { group: "ESTUDIOS" }),
        doc("TARJETA PROFESIONAL",  { group: "ESTUDIOS" }),
        doc("ANTECEDENTES DE LA PROFESION", { issueDateRequired: true, expirationDateRequired: true, group: "ESTUDIOS" }),
      ];
    }
    if (position === "COORDINADOR DE ZONA") {
      return [doc("ESTUDIOS TECNICO", { group: "ESTUDIOS" })];
    }
    return [doc("ESTUDIOS BACHILLER", { group: "ESTUDIOS" })];
  };

  const docs = [
    ...BASE,
    ...studiesByPosition(),
    ...OPTIONAL_TERRITORIAL,
    ...ANTECEDENTES,
    ...ALIMENTOS,
    ...AFILIACIONES,
    ...FORMATOS,
  ];

  const uniqueDocs = [];
  const seen = new Set();
  docs.forEach((item) => {
    const key = normalize(item.name);
    if (seen.has(key)) return;
    seen.add(key);
    uniqueDocs.push(item);
  });

  return uniqueDocs;
}

// ── Part 4: loadPersonnelModule — setup inicial + tab identificacion ──────────

// ── Module-level state ────────────────────────────────────────────────────────

let _cachedPayload = null;
let _contractPositions = null; // { licitacion: string[], real: string[] }

export function _clearPersonnelCache() {
  _cachedPayload       = null;
  _contractPositions   = null;
}

function getPersonnelMunicipalityNameById(municipalityId) {
  return getMunicipalityName(municipalityId, null, "");
}

function getDraftMunicipalityId(draft = {}) {
  const raw = draft.municipality_id ?? draft.municipalityId ?? draft.municipio_id ?? "";
  if (String(raw || "").trim()) return String(raw).trim();

  const rawName = draft.municipalityName ?? draft.municipality_name ?? draft.municipality ?? draft.municipio ?? "";
  if (!String(rawName || "").trim()) return "";

  const found = findOfficialMunicipality(rawName, { includeFallback: true });
  return found?.id ? String(found.id) : "";
}

function getDraftMunicipalityName(draft = {}) {
  return getPersonnelMunicipalityNameById(getDraftMunicipalityId(draft))
    || getMunicipalityName(
      draft.municipalityName || draft.municipality_name || draft.municipality || draft.municipio || "",
      null,
      ""
    );
}

function getNormalizedMunicipalityValue(values = [], fallback = "No registrado") {
  for (const value of values) {
    const resolved = getMunicipalityName(value, null, "");
    if (resolved) return resolved;
  }
  return fallback;
}

function syncDraftOfficialMunicipality(draft = state.personnelDraft || {}) {
  const municipalityId = getDraftMunicipalityId(draft);
  draft.municipalityId = municipalityId;
  draft.municipality_id = municipalityId;
  const municipalityName = municipalityId
    ? getPersonnelMunicipalityNameById(municipalityId)
    : getMunicipalityName(
      draft.municipalityName || draft.municipality_name || draft.municipality || draft.municipio || "",
      null,
      ""
    );
  draft.municipalityName = municipalityName;
  draft.municipality_name = municipalityName;
  draft.educationalMunicipality = municipalityName;
  draft.educational_municipality = municipalityName;
  return municipalityId;
}

function getOperationalMunicipalityOptions() {
  return getOfficialMunicipalities({ includeFallback: false }).filter((item) => item?.id && item?.name);
}

function hasManagedMunicipalitySelection(rawValue = "", municipality) {
  const selectedValues = String(rawValue || "")
    .split("|")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (!selectedValues.length || !municipality) return false;

  const targetId = String(municipality.id);
  const targetName = normalizeMunicipalityText(municipality.name);
  return selectedValues.some((value) => {
    const matched = findOfficialMunicipality(value, { includeFallback: true });
    if (matched) return String(matched.id) === targetId;
    return normalizeMunicipalityText(value) === targetName || String(value) === targetId;
  });
}

async function loadEducationalScopeOptions(draft = state.personnelDraft || {}, { force = false } = {}) {
  if (!_cachedPayload) _cachedPayload = {};

  const companyId = String(draft?.companyId || state.currentUser?.companyId || "").trim();
  const contractId = String(draft?.contractId || state.currentUser?.contractId || "").trim();
  const scopeKey = `${companyId}::${contractId}`;

  if (!force && _cachedPayload.educationalCatalogScopeKey === scopeKey) return;

  if (!companyId || !contractId) {
    _cachedPayload.educationalCatalogScopeKey = scopeKey;
    _cachedPayload.educationalCatalog = {};
    _cachedPayload.educationalCatalogMeta = {
      companyId: companyId || null,
      contractId: contractId || null,
      periodMonth: null,
      uploadId: null,
      hasCoverage: false,
      municipalities: [],
      message: "Selecciona empresa y contrato para cargar la cobertura PAE.",
    };
    state.educationalCatalog = {};
    return;
  }

  const query = new URLSearchParams();
  query.set("companyId", companyId);
  query.set("contractId", contractId);
  const payload = await apiFetch(`/personnel/catalog?${query.toString()}`);

  _cachedPayload.educationalCatalogScopeKey = scopeKey;
  _cachedPayload.educationalCatalog = payload?.educationalCatalog && typeof payload.educationalCatalog === "object"
    ? payload.educationalCatalog
    : {};
  _cachedPayload.educationalCatalogMeta = payload?.educationalCatalogMeta || {
    companyId: Number(companyId) || null,
    contractId: Number(contractId) || null,
    periodMonth: null,
    uploadId: null,
    hasCoverage: false,
    municipalities: [],
    message: "No existe cobertura PAE cargada para este contexto.",
  };
  state.educationalCatalog = _cachedPayload.educationalCatalog;
}

async function loadGestorScopeOptions(draft = state.personnelDraft || {}, { force = false } = {}) {
  if (!_cachedPayload) _cachedPayload = {};

  const companyId = String(draft?.companyId || state.currentUser?.companyId || "").trim();
  const contractId = String(draft?.contractId || state.currentUser?.contractId || "").trim();
  const rawMunicipalityId = String(draft?.municipalityId || "").trim();
  const municipalityOption = findOfficialMunicipality(rawMunicipalityId, { includeFallback: true });
  const municipalityId = municipalityOption ? String(municipalityOption.id) : rawMunicipalityId;
  const municipalityName =
    municipalityOption?.name
    || getPersonnelMunicipalityNameById(municipalityId)
    || String(draft?.municipalityName || draft?.municipality || draft?.municipio || "").trim();
  const scopeKey = `${companyId}::${contractId}::${municipalityId}`;

  if (!force && _cachedPayload.gestorScopeKey === scopeKey) return;

  if (!municipalityId) {
    _cachedPayload.gestorScopeKey = scopeKey;
    _cachedPayload.gestorNames = [];
    _cachedPayload.auxiliarGestorNames = [];
    _cachedPayload.gestorStatusMessage = "Selecciona un municipio para cargar gestores disponibles.";
    return;
  }

  try {
    const query = new URLSearchParams();
    if (companyId) query.set("companyId", companyId);
    if (contractId) query.set("contractId", contractId);
    if (/^\d+$/.test(municipalityId)) query.set("municipalityId", municipalityId);
    if (municipalityName) query.set("municipalityName", municipalityName);
    const payload = await apiFetch(`/personnel/managers?${query.toString()}`);

    _cachedPayload.gestorScopeKey = scopeKey;
    _cachedPayload.gestorNames = Array.isArray(payload?.gestores) ? payload.gestores : [];
    _cachedPayload.auxiliarGestorNames = Array.isArray(payload?.auxiliares) ? payload.auxiliares : [];
    _cachedPayload.gestorStatusMessage = payload?.message
      || (_cachedPayload.gestorNames.length
        ? `Gestores disponibles para ${municipalityName} en ${formatContract(contractId)}.`
        : "No hay gestores asignados a este municipio.");
  } catch (error) {
    _cachedPayload.gestorScopeKey = scopeKey;
    _cachedPayload.gestorNames = [];
    _cachedPayload.auxiliarGestorNames = [];
    _cachedPayload.gestorStatusMessage = "No fue posible cargar los gestores disponibles.";
    throw error;
  }
}

// ── Partial section refresh (no full re-render, no flicker) ──────────────────
function _refreshPersonnelSection() {
  const sectionEl = document.getElementById("personnelActiveSection");
  if (!sectionEl) return false;

  const draft     = state.personnelDraft || {};
  const activeTab = normalizePersonnelTabKey(state.personnelCreateTab);
  state.personnelCreateTab = activeTab;

  const dv = (name, fallback = "") =>
    draft[name] !== undefined && draft[name] !== null ? draft[name] : fallback;

  const firstDv = (...names) => {
    for (const name of names) {
      if (draft[name] !== undefined && draft[name] !== null && String(draft[name]).trim() !== "")
        return draft[name];
    }
    return "";
  };

  const selected = (name, value) =>
    String(dv(name, "")) === String(value) ? "selected" : "";

  const currentCargoReal    = String(draft.cargo_real || "").toUpperCase();
  const institutionalEnabled = isInstitutionalTabEnabled(currentCargoReal);
  const managerRole          = ["GESTOR DE ZONA", "AUXILIAR DE GESTOR DE ZONA"].includes(currentCargoReal);
  const expeditionDepartment = dv("expeditionDepartment");
  const birthDepartment      = dv("birthDepartment");
  const residenceMunicipality = dv("residenceMunicipality");
  const vinculationCompanyId  = dv("companyId", state.currentUser?.companyId ?? "");
  const gestorNames          = _cachedPayload?.gestorNames         || [];
  const auxiliarGestorNames  = _cachedPayload?.auxiliarGestorNames  || [];
  const gestorStatusMessage  = _cachedPayload?.gestorStatusMessage  || "";

  const educationalCatalog =
    (_cachedPayload?.educationalCatalog && Object.keys(_cachedPayload.educationalCatalog).length > 0)
      ? _cachedPayload.educationalCatalog
      : state.educationalCatalog || {};
  const educationalCatalogMeta = _cachedPayload?.educationalCatalogMeta || {};
  const officialMunicipalities = getOperationalMunicipalityOptions();

  syncDraftOfficialMunicipality(draft);
  const municipalityIdResolved = getDraftMunicipalityId(draft);
  const municipalityNameResolved = getDraftMunicipalityName(draft);
  const institutionalMunicipality = municipalityIdResolved ? String(municipalityIdResolved) : "";
  const municipalityCatalog  = institutionalMunicipality ? (educationalCatalog[institutionalMunicipality] || {}) : {};
  const institutionalMunicipalities = Array.isArray(educationalCatalogMeta?.municipalities)
    ? educationalCatalogMeta.municipalities
    : officialMunicipalities;
  const institutionNames     = Object.keys(municipalityCatalog);
  const selectedInstitutionRaw = firstDv("institution", "institucion_educativa");
  const institutionKey       = findCatalogKey(municipalityCatalog, selectedInstitutionRaw);
  const selectedInstitution  = institutionKey || selectedInstitutionRaw;
  const sedeCatalog          = institutionKey ? municipalityCatalog[institutionKey] : {};
  const sedeNames            = Object.keys(sedeCatalog);
  const selectedSedeRaw      = firstDv("site", "sede_educativa");
  const sedeKey              = findCatalogKey(sedeCatalog, selectedSedeRaw);
  const selectedSede         = sedeKey || selectedSedeRaw;
  const modalidadCatalog     = sedeKey ? sedeCatalog[sedeKey] : [];
  const selectedModality     = firstDv("educationalModality", "modalidad");

  const html = buildPersonnelMacroSection({
    activeTab,
    draftValue: dv,
    draft,
    expeditionDepartment,
    birthDepartment,
    isEditMode: state.personnelViewMode === "edit",
    residenceMunicipality,
    selected,
    vinculationCompanyId,
    gestorNames,
    auxiliarGestorNames,
    gestorStatusMessage,
    institutionalEnabled,
    managerRole,
    institutionalMunicipality,
    municipalityNameResolved,
    institutionalMunicipalities,
    institutionNames,
    selectedInstitution,
    sedeNames,
    selectedSede,
    modalidadCatalog,
    selectedModality,
    educationalCatalogMeta,
    currentCargoReal,
    dossier: state.personnelDossier || null,
  });

  sectionEl.innerHTML = html;

  const ageSlot = document.getElementById("personnelAgeSlot");
  if (ageSlot) {
    ageSlot.innerHTML = activeTab === "identificacion"
      ? buildAgeIndicator(dv("birthDay"), dv("birthMonth"), dv("birthYear"))
      : "";
  }

  // Update tab buttons in-place (no DOM replacement)
  document.querySelectorAll("[data-step-tab]").forEach(btn => {
    const key = btn.dataset.stepTab;
    btn.classList.toggle("active", key === activeTab);

    const existingCheck = btn.querySelector(".tab-saved-check");
    const isSaved = (state.personnelSavedTabs || new Set()).has(key);
    if (isSaved && !existingCheck) {
      const chk = document.createElement("span");
      chk.className = "tab-saved-check";
      chk.textContent = "✓";
      btn.appendChild(chk);
    } else if (!isSaved && existingCheck) {
      existingCheck.remove();
    }
  });

  enforceInputRestrictions(sectionEl);
  syncEmployeeHeaderFromDraft();
  configurePersonnelFormForKeyboard(document.getElementById("personnelForm"));
  return true;
}

// ── Tab buttons template ──────────────────────────────────────────────────────

function _buildTabButtonsLegacy(activeTab, institutionalEnabled) {
  const tabs = [
    { key: "identificacion",   label: "Identificación",   icon: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M13 10h4M13 14h4M5 14c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2"/></svg>` },
    { key: "datos_personales", label: "Datos",            icon: `<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>` },
    { key: "estudios",         label: "Estudios",         icon: `<svg viewBox="0 0 24 24"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>` },
    { key: "experiencia",      label: "Experiencia",      icon: `<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><path d="M12 12h.01"/></svg>` },
    { key: "seguimiento",      label: "Seguimiento",      icon: `<svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>` },
    { key: "licitacion",       label: "Licitación",       icon: `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>` },
    { key: "vinculacion",      label: "Vinculación",      icon: `<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>` },
    { key: "contratacion",     label: "Contratación",     icon: `<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>` },
    { key: "institucional",    label: "Institucional",    icon: `<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`, disabled: !institutionalEnabled },
    { key: "observaciones",    label: "Notas",            icon: `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>` },
  ];

  return `
    <div class="employee-steps">
      ${tabs.map(({ key, label, icon, disabled }) => `
        <button
          type="button"
          class="employee-step-tab ${activeTab === key ? "active" : ""} ${disabled ? "disabled" : ""}"
          data-step-tab="${key}"
          ${disabled ? "disabled" : ""}
          title="${label}"
        >
          <span class="employee-step-icon">${icon}</span>
          <span class="employee-step-label">${label}</span>
          ${(state.personnelSavedTabs || new Set()).has(key) ? `<span class="tab-saved-check">✓</span>` : ""}
        </button>
      `).join("")}
    </div>
  `;
}

function _buildTabButtonsPremiumLegacy(activeTab, institutionalEnabled) {
  const tabs = [
    { key: "identificacion", label: "Identificacion", icon: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M13 10h4M13 14h4M5 14c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2"/></svg>` },
    { key: "datos_generales", label: "Complementarios", icon: `<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>` },
    { key: "vinculacion_laboral", label: "Vinculacion laboral", icon: `<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>` },
    { key: "historial_observaciones", label: "Historial y observaciones", icon: `<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/><path d="M12 7v5l3 3"/></svg>` },
  ];
  return `
    <div class="employee-steps-shell employee-steps-shell-premium">
      <div class="employee-steps employee-steps-compact employee-steps-premium" role="tablist" aria-label="Secciones del expediente">
      ${tabs.map(({ key, label, icon }) => `
        <button
          type="button"
          class="employee-step-tab ${activeTab === key ? "active" : ""}"
          data-step-tab="${key}"
          title="${label}"
        >
          <span class="employee-step-icon">${icon}</span>
          <span class="employee-step-label">${label}</span>
          ${(state.personnelSavedTabs || new Set()).has(key) ? `<span class="tab-saved-check">✓</span>` : ""}
        </button>
      `).join("")}
      </div>
    </div>
  `;
}

// ── Catalog helpers ───────────────────────────────────────────────────────────

function buildTabButtons(activeTab, institutionalEnabled) {
  const tabs = [
    { key: "identificacion", label: "Identificacion" },
    { key: "datos_generales", label: "Complementarios" },
    { key: "vinculacion_laboral", label: "Vinculacion Laboral" },
    { key: "historial_observaciones", label: "Historial" },
  ];
  return `
    <div class="employee-steps-shell employee-steps-shell-premium">
      <div class="employee-steps employee-steps-compact employee-steps-premium" role="tablist" aria-label="Secciones del expediente">
      ${tabs.map(({ key, label }) => `
        <button
          type="button"
          class="employee-step-tab ${activeTab === key ? "active" : ""}"
          data-step-tab="${key}"
          title="${label}"
        >
          <span class="employee-step-label">${label}</span>
          ${(state.personnelSavedTabs || new Set()).has(key) ? `<span class="tab-saved-check">&#10003;</span>` : ""}
        </button>
      `).join("")}
      </div>
    </div>
  `;
}

function normalizeCatalogText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

function findCatalogKey(object, value) {
  const norm = normalizeCatalogText(value);
  if (!norm) return "";
  const keys = Object.keys(object || {});
  return (
    keys.find((k) => normalizeCatalogText(k) === norm) ||
    keys.find((k) => normalizeCatalogText(k).includes(norm)) ||
    keys.find((k) => norm.includes(normalizeCatalogText(k))) ||
    ""
  );
}

function syncInstitutionalSelectionsWithCatalog(draft = state.personnelDraft || {}, educationalCatalog = {}) {
  if (!draft || !educationalCatalog || typeof educationalCatalog !== "object") return;

  const municipalityId   = getDraftMunicipalityId(draft);
  const municipalityName = getDraftMunicipalityName(draft);
  draft.educationalMunicipality  = municipalityName;
  draft.educational_municipality = municipalityName;
  const municipalityKey = municipalityId ? String(municipalityId) : "";

  // Sin municipio seleccionado → limpiar todo
  if (!municipalityKey) {
    draft.institution       = "";
    draft.site              = "";
    draft.educationalModality = "";
    return;
  }

  // Si el catálogo está vacío (aún no cargó o el contrato no tiene cobertura),
  // NO limpiar los valores existentes — solo preservar.
  const catalogHasData = Object.keys(educationalCatalog).length > 0;
  if (!catalogHasData) return;

  const municipalityCatalog = educationalCatalog[municipalityKey] || {};
  const municipalityHasData = Object.keys(municipalityCatalog).length > 0;

  const institutionKey = findCatalogKey(municipalityCatalog, draft.institution || draft.institucion_educativa || "");
  if (!institutionKey) {
    // Solo limpiar si el catálogo del municipio realmente tiene instituciones
    // (evita limpiar cuando la clave del municipio simplemente no está en el catálogo)
    if (municipalityHasData) {
      draft.institution       = "";
      draft.site              = "";
      draft.educationalModality = "";
    }
    return;
  }

  draft.institution   = institutionKey;
  const siteCatalog   = municipalityCatalog[institutionKey] || {};
  const siteHasData   = Object.keys(siteCatalog).length > 0;

  const siteKey = findCatalogKey(siteCatalog, draft.site || draft.sede_educativa || "");
  if (!siteKey) {
    if (siteHasData) {
      draft.site              = "";
      draft.educationalModality = "";
    }
    return;
  }

  draft.site = siteKey;
  const modalityCatalog = Array.isArray(siteCatalog[siteKey]) ? siteCatalog[siteKey] : [];
  const currentModality = draft.educationalModality || draft.modality || draft.modalidad || "";

  const modalityMatch = modalityCatalog.find(
    (item) => normalizeCatalogText(item) === normalizeCatalogText(currentModality)
  );

  // Solo actualizar si el catálogo tiene modalidades Y se encontró match.
  // Si no se encuentra, conservar el valor existente — nunca borrar.
  if (modalityMatch !== undefined) {
    draft.educationalModality = modalityMatch;
  }
  // else: draft.educationalModality ya tiene el valor correcto, no se toca
}

// ── Age helpers ───────────────────────────────────────────────────────────────

function calcAge(day, month, year) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  if (!y || y < 1900 || y > new Date().getFullYear()) return null;
  const birth = new Date(y, (m || 1) - 1, d || 1);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const hasPassedBirthday =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  if (!hasPassedBirthday) age--;
  return age >= 0 && age < 130 ? age : null;
}

function buildAgeIndicator(day, month, year) {
  const age = calcAge(day, month, year);
  if (age === null || age < 18) return "";
  const iconCheck = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>`;
  const iconWarn  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12.5"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/></svg>`;
  if (age >= 57)
    return `<div class="age-indicator age-red">${iconWarn} ${age} años</div>`;
  if (age >= 46)
    return `<div class="age-indicator age-yellow">${iconWarn} ${age} años</div>`;
  return `<div class="age-indicator age-green">${iconCheck} ${age} años</div>`;
}

// ── Confirm dialog ────────────────────────────────────────────────────────────

function showPersonnelConfirmDialog() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "personnel-confirm-overlay";
    overlay.innerHTML = `
      <div class="personnel-confirm-box">
        <div class="personnel-confirm-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12.5"/>
            <circle cx="12" cy="16.5" r="0.7" fill="currentColor"/>
          </svg>
        </div>
        <div class="personnel-confirm-title">Verificar datos ingresados</div>
        <div class="personnel-confirm-msg">
          Una vez guardados los datos <strong>no se podrán modificar</strong>.<br>¿Desea continuar?
        </div>
        <div class="personnel-confirm-actions">
          <button class="btn-confirm-no">NO</button>
          <button class="btn-confirm-yes">SÍ</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector(".btn-confirm-yes").addEventListener("click", () => close(true));
    overlay.querySelector(".btn-confirm-no").addEventListener("click",  () => close(false));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
  });
}

// ── Tab: identificacion ───────────────────────────────────────────────────────

function buildTabIdentificacion(draftValue, expeditionDepartment, birthDepartment, isEditMode = false) {
  const isAdmin = (state.currentUser?.role || "").toLowerCase() === "administrador";
  const locked  = isEditMode && !isAdmin;
  const lock    = locked ? "disabled" : "";
  const ro      = locked ? "readonly"  : "";

  return `
    <section class="personnel-section personnel-identification-layout">
      ${isEditMode && !isAdmin ? `
        <div class="id-lock-banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Los datos de identificacion estan bloqueados. Para modificarlos contacte al administrador.
        </div>
      ` : ""}

      ${buildFormInsetCard("Nombres y Apellidos", "", `
        <div class="personnel-compact-grid personnel-compact-grid-4">
          <label>
            <span>Primer Nombre *</span>
            <input name="firstName" data-only-letters type="text"
              value="${escapeAttr(draftValue("firstName"))}" ${ro} required />
          </label>
          <label>
            <span>Segundo Nombre</span>
            <input name="secondName" data-only-letters type="text"
              value="${escapeAttr(draftValue("secondName"))}" ${ro} />
          </label>
          <label>
            <span>Primer Apellido *</span>
            <input name="firstLastName" data-only-letters type="text"
              value="${escapeAttr(draftValue("firstLastName"))}" ${ro} required />
          </label>
          <label>
            <span>Segundo Apellido</span>
            <input name="secondLastName" data-only-letters type="text"
              value="${escapeAttr(draftValue("secondLastName"))}" ${ro} />
          </label>
        </div>
      `)}

      <div class="expediente-group-grid">
        ${buildExpedienteSectionBlock("Identificación", `
          <section class="personnel-section">
            <div class="personnel-compact-stack">
              <div class="personnel-compact-grid personnel-compact-grid-ident-main">
                <label class="personnel-compact-field">
                  <span>Documento *</span>
                  <div class="personnel-inline-field personnel-inline-field--document">
                    <input name="documentNumber" data-only-numbers type="text"
                      value="${escapeAttr(draftValue("documentNumber"))}" ${ro} ${!isEditMode ? "required" : ""} />
                    <select name="documentType" ${lock} ${!isEditMode ? "required" : ""}>
                      ${renderOptions(["CC", "PA", "PPT", "CE", "NIT"], draftValue("documentType"), "Tipo")}
                    </select>
                  </div>
                </label>
                <label class="personnel-compact-field">
                  <span>Fecha de Nacimiento</span>
                  <div class="personnel-inline-date">
                    <input name="birthDay" data-only-numbers type="text" maxlength="2"
                      placeholder="DD"
                      value="${escapeAttr(draftValue("birthDay"))}" ${ro} />
                    <input name="birthMonth" data-only-numbers type="text" maxlength="2"
                      placeholder="MM"
                      value="${escapeAttr(draftValue("birthMonth"))}" ${ro} />
                    <input name="birthYear" data-only-numbers type="text" maxlength="4"
                      placeholder="AAAA"
                      value="${escapeAttr(draftValue("birthYear"))}" ${ro} />
                  </div>
                </label>
                <label class="personnel-compact-field">
                  <span>Fecha de Expedición</span>
                  <div class="personnel-inline-date">
                    <input name="expeditionDay" data-only-numbers type="text" maxlength="2"
                      placeholder="DD"
                      value="${escapeAttr(draftValue("expeditionDay"))}" ${ro} />
                    <input name="expeditionMonth" data-only-numbers type="text" maxlength="2"
                      placeholder="MM"
                      value="${escapeAttr(draftValue("expeditionMonth"))}" ${ro} />
                    <input name="expeditionYear" data-only-numbers type="text" maxlength="4"
                      placeholder="AAAA"
                      value="${escapeAttr(draftValue("expeditionYear"))}" ${ro} />
                  </div>
                </label>
              </div>

              <div class="personnel-compact-grid personnel-compact-grid-ident-secondary">
                <label class="personnel-compact-field">
                  <span>Sexo *</span>
                  <select name="biologicalSex" ${lock}>
                    ${renderOptions(["F", "M"], draftValue("biologicalSex"), "Selecciona")}
                  </select>
                </label>
                <label class="personnel-compact-field">
                  <span>Grupo Sanguíneo *</span>
                  <select name="bloodType" ${lock}>
                    ${renderOptions(["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"], draftValue("bloodType"), "Selecciona")}
                  </select>
                </label>
                <label class="personnel-compact-field">
                  <span>Estado Civil</span>
                  <select name="civilStatus">
                    ${renderOptions(
                      ["soltero", "casado", "union_libre", "separado", "divorciado", "viudo"],
                      draftValue("civilStatus"),
                      "Selecciona"
                    )}
                  </select>
                </label>
                <label class="personnel-compact-field">
                  <span>Nacionalidad</span>
                  <input name="birthCountry" data-only-letters type="text"
                    value="${escapeAttr(draftValue("birthCountry", "Colombia"))}" ${ro} />
                </label>
              </div>
            </div>
          </section>
        `)}

        ${buildExpedienteSectionBlock("Datos Personales", buildTabDatosPersonales(draftValue, draftValue("residenceMunicipality")))}
      </div>
    </section>
  `;
}

function buildTabIdentificacionComplementary(draftValue, expeditionDepartment, birthDepartment, isEditMode = false) {
  const expeditionMunicipalities = getDepartmentMunicipalities(expeditionDepartment);
  const birthMunicipalities = getDepartmentMunicipalities(birthDepartment);
  const isAdmin = (state.currentUser?.role || "").toLowerCase() === "administrador";
  const locked = isEditMode && !isAdmin;
  const lock = locked ? "disabled" : "";

  return `
    <section class="personnel-section">
      <div class="personnel-compact-stack">
        <div class="personnel-compact-grid personnel-compact-grid-2">
          <label class="personnel-compact-field">
            <span>Departamento de Expedición</span>
            <select name="expeditionDepartment" ${lock}>
              ${renderOptions(COLOMBIA_DEPARTMENTS, expeditionDepartment, "Selecciona")}
            </select>
          </label>
          <label class="personnel-compact-field">
            <span>Municipio de Expedición</span>
            <select name="expeditionMunicipality" ${lock}>
              ${renderOptions(
                expeditionMunicipalities,
                draftValue("expeditionMunicipality"),
                expeditionDepartment ? "Selecciona" : "Selecciona depto. primero"
              )}
            </select>
          </label>
        </div>

        <div class="personnel-compact-grid personnel-compact-grid-2">
          <label class="personnel-compact-field">
            <span>Departamento de Nacimiento</span>
            <select name="birthDepartment" ${lock}>
              ${renderOptions(COLOMBIA_DEPARTMENTS, birthDepartment, "Selecciona")}
            </select>
          </label>
          <label class="personnel-compact-field">
            <span>Municipio de Nacimiento</span>
            <select name="birthMunicipality" ${lock}>
              ${renderOptions(
                birthMunicipalities,
                draftValue("birthMunicipality"),
                birthDepartment ? "Selecciona" : "Selecciona depto. primero"
              )}
            </select>
          </label>
        </div>
      </div>
    </section>
  `;
}

function buildTabVinculacion(draftValue, vinculationCompanyId, gestorNames, auxiliarGestorNames = [], gestorStatusMessage = "") {
  const municipalityOptions = getOperationalMunicipalityOptions();
  const currentGestor = draftValue("gestorZona");
  const gestorOptions = gestorNames.map((g) => `
    <option value="${escapeAttr(g)}" ${currentGestor === g ? "selected" : ""}>${escapeHtml(g)}</option>
  `).join("");

  const currentAuxiliar   = draftValue("auxiliarGestorZona");
  const hasAuxiliarValue  = draftValue("hasAuxiliarGestor");
  const showAuxiliarBlock = hasAuxiliarValue === "true";

  const auxiliarOptions = auxiliarGestorNames.map((a) =>
    `<option value="${escapeAttr(a)}" ${currentAuxiliar === a ? "selected" : ""}>${escapeHtml(a)}</option>`
  ).join("");

  // Para usuarios de contrato la empresa/contrato viene fija de su sesión
  const cuVinc = state.currentUser;
  const isAdminVinc = (cuVinc?.role || "").toLowerCase() === "administrador";
  const lockedCompany = !isAdminVinc && cuVinc?.companyId;
  const lockedContract = !isAdminVinc && cuVinc?.contractId;
  const companyField = lockedCompany
    ? `<select name="companyId" required disabled>
        <option value="${escapeAttr(String(cuVinc.companyId))}" selected>
          ${escapeHtml(formatCompany(cuVinc.companyId))}
        </option>
       </select>
       <input type="hidden" name="companyId" value="${escapeAttr(String(cuVinc.companyId))}">`
    : `<select name="companyId" required>${getCompanyOptionsHtml(vinculationCompanyId)}</select>`;
  const contractField = lockedContract
    ? `<select name="contractId" required disabled>
        <option value="${escapeAttr(String(cuVinc.contractId))}" selected>
          ${escapeHtml(formatContract(cuVinc.contractId))}
        </option>
       </select>
       <input type="hidden" name="contractId" value="${escapeAttr(String(cuVinc.contractId))}">`
    : `<select name="contractId" required>${getContractOptionsHtml(vinculationCompanyId, draftValue("contractId"))}</select>`;

  return `
    <section class="personnel-section">
      <div class="form-grid form-grid-3">
        <label>
          <span>Empresa *</span>
          ${companyField}
        </label>
        <label>
          <span>Contrato *</span>
          ${contractField}
        </label>
        <label>
          <span>Municipio *</span>
          <select name="municipalityId" required>
            ${renderOptions(municipalityOptions, draftValue("municipalityId"), "Selecciona municipio")}
          </select>
        </label>
      </div>

      <div class="form-grid form-grid-1">
        <label>
          <span>Gestor de Zona</span>
          <select name="gestorZona">
            <option value="">— Sin asignar —</option>
            ${gestorOptions}
          </select>
          <small style="display:block;margin-top:6px;color:#64748b;font-size:12px;">
            ${escapeHtml(gestorStatusMessage || "Selecciona un municipio para filtrar los gestores disponibles.")}
          </small>
        </label>
      </div>

      <div class="form-grid form-grid-2">
        <label>
          <span>¿Tiene Auxiliar de Gestor de Zona asignado?</span>
          <select name="hasAuxiliarGestor">
            <option value="">Selecciona</option>
            <option value="true"  ${hasAuxiliarValue === "true"  ? "selected" : ""}>Sí</option>
            <option value="false" ${hasAuxiliarValue === "false" ? "selected" : ""}>No</option>
          </select>
        </label>
        <label class="${showAuxiliarBlock ? "" : "hidden"}" id="auxiliarGestorZonaWrap">
          <span>Auxiliar de Gestor de Zona</span>
                <select name="auxiliarGestorZona">
                  <option value="">— Sin asignar —</option>
                  ${auxiliarOptions}
                </select>
              </label>
            </div>

      <div class="form-grid form-grid-3">
        <label>
          <span>Tipo de cuenta</span>
          <select name="accountType">
            <option value="">Selecciona</option>
            <option value="Ahorros"  ${draftValue("accountType") === "Ahorros"  ? "selected" : ""}>Ahorros</option>
            <option value="Corriente" ${draftValue("accountType") === "Corriente" ? "selected" : ""}>Corriente</option>
          </select>
        </label>
        <label>
          <span>Banco</span>
          <select name="bankName">
            <option value="">Selecciona banco</option>
            ${BANKS.map(b => `<option value="${escapeAttr(b.name)}"${draftValue("bankName") === b.name ? " selected" : ""}>${b.code} — ${escapeHtml(b.name)}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Número de cuenta</span>
          <input name="accountNumber" type="text" data-only-numbers
            placeholder="Número de cuenta"
            value="${escapeAttr(draftValue("accountNumber"))}" />
        </label>
      </div>
    </section>
  `;
}

function buildTabLicitacion(draftValue, selected) {
  const presentado  = String(draftValue("presentedInOffer"));
  const cargoReal   = String(draftValue("cargo_real") || "").toUpperCase();
  const isGestor    = cargoReal === "GESTOR DE ZONA" || cargoReal === "AUXILIAR DE GESTOR DE ZONA";
  const municipalityOptions = getOperationalMunicipalityOptions();
  const selectedMunicipalities = String(draftValue("municipiosACargo", ""));
  const selectedMunsCount = municipalityOptions.filter((item) =>
    hasManagedMunicipalitySelection(selectedMunicipalities, item)
  ).length;

  // Use positions from contract config if available, else fall back to static lists
  const licitacionOpts = (_contractPositions?.licitacion?.length)
    ? _contractPositions.licitacion
    : LICITACION_CARGOS;
  const realesBase = (_contractPositions?.real?.length)
    ? _contractPositions.real
    : CARGOS_REALES;
  const realesOpts = realesBase;

  // Status: auto-computed from terminationDate — no editable dropdown
  const hasTermination  = String(draftValue("hasTermination", "")) === "true";
  const terminationDate = draftValue("terminationDate", "");
  const computedStatus  = (hasTermination && terminationDate) ? "INACTIVO" : "ACTIVO";
  const statusCls       = computedStatus === "ACTIVO" ? "pnl-status-auto-active" : "pnl-status-auto-inactive";

  const munPickerHtml = isGestor ? `
    <div class="mun-picker-wrap">
      <div class="mun-picker-label">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>
        ¿Qué municipios tiene asignado?
        <span class="mun-picker-count" id="munPickerCount">
          ${selectedMunsCount ? `${selectedMunsCount} seleccionado${selectedMunsCount > 1 ? "s" : ""}` : "Ninguno"}
        </span>
      </div>
      <div class="mun-picker-grid">
        ${municipalityOptions.map((m) => `
          <label class="mun-chip ${hasManagedMunicipalitySelection(selectedMunicipalities, m) ? "mun-chip-active" : ""}">
            <input type="checkbox" name="municipioACargo" value="${escapeAttr(m.id)}"
              ${hasManagedMunicipalitySelection(selectedMunicipalities, m) ? "checked" : ""}>
            ${escapeHtml(m.name)}
          </label>
        `).join("")}
      </div>
    </div>
  ` : "";

  return `
    <section class="personnel-section">
      <div class="form-grid form-grid-2">
        <label>
          <span>¿Presentado en Licitación? *</span>
          <select name="presentedInOffer" id="presentedInOffer" required>
            <option value="">Selecciona</option>
            <option value="true"  ${selected("presentedInOffer", "true")}>Sí</option>
            <option value="false" ${selected("presentedInOffer", "false")}>No</option>
          </select>
        </label>

        <label id="offerPositionWrap" class="${presentado === "true" ? "" : "hidden"}">
          <span>Cargo en Licitación</span>
          <select name="offerPosition">
            ${renderOptions(licitacionOpts, draftValue("offerPosition"), "Selecciona")}
          </select>
        </label>
      </div>

      <div class="form-grid form-grid-2">
        <label>
          <span>Cargo Operacional</span>
          <select name="cargo_real">
            ${renderOptions(realesOpts, draftValue("cargo_real"), "Selecciona")}
          </select>
        </label>
        <label>
          <span>Estado</span>
          <div class="pnl-status-auto">
            <input type="hidden" name="status" value="${escapeAttr(computedStatus)}">
            <span class="pnl-status-auto-badge ${statusCls}">${computedStatus}</span>
            <span class="pnl-status-auto-hint">
              ${computedStatus === "INACTIVO" ? "Fecha de retiro registrada" : "Sin fecha de retiro"}
            </span>
          </div>
        </label>
      </div>

      ${presentado === "true" ? `
        <div class="licit-cargo-visual">
          <div class="licit-cargo-badge licit-cargo-badge--offer">
            <small>Cargo licitación</small>
            <strong>${escapeHtml(draftValue("offerPosition") || "—")}</strong>
          </div>
          <div class="licit-cargo-badge licit-cargo-badge--real">
            <small>Cargo operacional</small>
            <strong>${escapeHtml(draftValue("cargo_real") || cargoReal || "—")}</strong>
          </div>
        </div>
      ` : ""}

      ${munPickerHtml}
    </section>
  `;
}

function buildTabDatosPersonales(draftValue, residenceMunicipality) {
  const municipalityOptions = getOperationalMunicipalityOptions();
  return `
    <section class="personnel-section">
      <div class="personnel-compact-stack">
        <div class="personnel-compact-grid personnel-compact-grid-contact-main">
          <label class="personnel-compact-field">
            <span>Teléfono *</span>
            <input name="phone" data-only-numbers type="text"
              value="${escapeAttr(draftValue("phone"))}" required />
          </label>
          <label class="personnel-compact-field">
            <span>Correo Electrónico *</span>
            <input name="email" type="email"
              value="${escapeAttr(draftValue("email"))}" required />
          </label>
        </div>

        <div class="personnel-compact-grid personnel-compact-grid-contact-secondary">
          <label class="personnel-compact-field">
            <span>Dirección *</span>
            <input name="address" type="text"
              value="${escapeAttr(draftValue("address"))}" required />
          </label>
          <label class="personnel-compact-field">
            <span>Barrio</span>
            <input name="neighborhood" type="text"
              value="${escapeAttr(draftValue("neighborhood"))}" />
          </label>
          <label class="personnel-compact-field">
            <span>Municipio de Residencia *</span>
            <select name="residenceMunicipality" required>
              ${renderOptions(municipalityOptions, residenceMunicipality, "Selecciona municipio")}
            </select>
          </label>
          <label class="personnel-compact-field">
            <span>Zona</span>
            <select name="residenceZone">
              ${renderOptions(["urbano", "rural"], draftValue("residenceZone"), "Selecciona")}
            </select>
          </label>
        </div>
      </div>
    </section>
  `;
}

// ── Part 6: tabs institucional, contratacion, seguimiento, estudios, experiencia, observaciones ──

function buildTabInstitucional(
  draftValue, institutionalEnabled, managerRole,
  institutionalMunicipality, municipalityNameResolved,
  institutionalMunicipalities,
  institutionNames, selectedInstitution,
  sedeNames, selectedSede,
  modalidadCatalog, selectedModality,
  normalizeCatalogTextFn,
  educationalCatalogMessage = ""
) {
  if (!institutionalEnabled) {
    return `
      <section class="personnel-section">
        <div class="personnel-note-box">
          Esta pestaña solo se habilita para el cargo operacional:
          <strong>OPERARIO MANIPULADOR DE ALIMENTOS</strong>.
        </div>
      </section>
    `;
  }

  if (managerRole) {
    const municipalityOptions = getOperationalMunicipalityOptions();
    const currentSelection = String(draftValue("municipiosACargo", ""));

    return `
      <section class="personnel-section">
        <label>
          <span>Municipios a Cargo</span>
          <select name="municipiosACargo" multiple size="8">
            ${municipalityOptions.map((m) => `
              <option value="${escapeAttr(m.id)}" ${hasManagedMunicipalitySelection(currentSelection, m) ? "selected" : ""}>${escapeHtml(m.name)}</option>
            `).join("")}
          </select>
        </label>
      </section>
    `;
  }

  const hasOfficialMunicipality = Boolean(String(draftValue("municipalityId") || "").trim());
  const hasCoverageCatalog = Array.isArray(institutionalMunicipalities) && institutionalMunicipalities.length > 0;
  const infoMessage = educationalCatalogMessage || (
    !hasOfficialMunicipality
      ? "Seleccione primero el municipio en Vinculación."
      : hasCoverageCatalog ? "Selecciona institución, sede y modalidad desde la cobertura PAE vigente." : ""
  );

  return `
    <section class="personnel-section">
      ${infoMessage ? `
        <div class="personnel-note-box" style="margin-bottom:16px;">
          ${escapeHtml(infoMessage)}
        </div>
      ` : ""}
      <div class="form-grid form-grid-2">
        <label>
          <span>Municipio de Vinculación</span>
          <input type="text"
            value="${escapeHtml(municipalityNameResolved || institutionalMunicipality || '— Sin municipio —')}"
            disabled readonly
            style="background:var(--bg-alt,#f8fafc);color:var(--text-secondary,#64748B);cursor:default;">
          <small style="color:var(--text-secondary,#64748B);font-size:11px;margin-top:2px;">
            Cambia el municipio desde la pestaña <strong>Vinculación</strong>
          </small>
        </label>
        <label>
          <span>Institución Educativa *</span>
          <select name="institution" required ${institutionalMunicipality ? "" : "disabled"}>
            ${renderOptions(
              institutionNames,
              selectedInstitution,
              institutionalMunicipality ? "Selecciona institución" : "Seleccione primero el municipio en Vinculación"
            )}
          </select>
        </label>
        <label>
          <span>Sede Educativa *</span>
          <select name="site" required ${selectedInstitution ? "" : "disabled"}>
            ${renderOptions(
              sedeNames,
              selectedSede,
              selectedInstitution ? "Selecciona sede" : "Selecciona primero institución"
            )}
          </select>
        </label>
        <label>
          <span>Modalidad *</span>
          <select name="educationalModality" required ${selectedSede ? "" : "disabled"}>
            ${renderOptions(
              modalidadCatalog,
              selectedModality,
              selectedSede ? "Selecciona modalidad" : "Selecciona primero sede"
            )}
          </select>
        </label>
      </div>
    </section>
  `;
}

function buildTabContratacion(draftValue, cargoReal) {
  const EPS_LIST = [
    "ASMET",
    "PROTEGER EPS",
    "CAPITAL SALUD",
    "COOSALUD",
    "FAMISANAR",
    "NUEVA EPS",
    "SALUD TOTAL",
    "SANITAS",
    "MALLAMAS",
    "PIJAOS",
  ];
  const AFP_LIST = ["COLPENSIONES","PORVENIR","PROTECCIÓN","SKANDIA","COLFONDOS"];

  const TALLAS_ROPA        = ["XS","S","M","L","XL","XXL","XXXL","XXXXL","XXXXXL"];
  const TALLAS_CALZ_OPR    = ["34","35","36","37","38","39","40","41","42"];
  const TALLAS_CALZ_OTROS  = ["34","35","36","37","38","39","40","41","42","43"];
  const TALLAS_PANT_FEM    = ["4","6","8","10","12","14","16","18","20","22","24","26"];
  const TALLAS_PANT_MASC   = ["28","30","32","34","36","38","40","42"];

  const isManipulador = String(cargoReal || "").toUpperCase() === "OPERARIO MANIPULADOR DE ALIMENTOS";
  const sexo = String(draftValue("biologicalSex") || "").toUpperCase();
  const tallaPantOtros = sexo === "F" ? TALLAS_PANT_FEM
    : sexo === "M"                    ? TALLAS_PANT_MASC
    : [...TALLAS_PANT_FEM, ...TALLAS_PANT_MASC];

  const dotacionBlock = isManipulador ? `
    <div class="subsection-title">Tallas de Dotación</div>
    <div class="form-grid form-grid-2">
      <label>
        <span>Talla Uniforme</span>
        <select name="shirtSize">
          ${renderOptions(TALLAS_ROPA, draftValue("shirtSize"), "Selecciona")}
        </select>
      </label>
      <label>
        <span>Talla Calzado</span>
        <select name="shoeSize">
          ${renderOptions(TALLAS_CALZ_OPR, draftValue("shoeSize"), "Selecciona")}
        </select>
      </label>
    </div>
  ` : `
    <div class="subsection-title">Tallas de Dotación</div>
    <div class="form-grid form-grid-3">
      <label>
        <span>Talla Camisa</span>
        <select name="shirtSize">
          ${renderOptions(TALLAS_ROPA, draftValue("shirtSize"), "Selecciona")}
        </select>
      </label>
      <label>
        <span>Talla Pantalón${!sexo ? " (define el sexo en Identificación)" : ""}</span>
        <select name="pantsSize" ${!sexo ? 'disabled title="Define el sexo en la pestaña Identificación"' : ""}>
          ${renderOptions(tallaPantOtros, draftValue("pantsSize"), "Selecciona")}
        </select>
      </label>
      <label>
        <span>Talla Calzado</span>
        <select name="shoeSize">
          ${renderOptions(TALLAS_CALZ_OTROS, draftValue("shoeSize"), "Selecciona")}
        </select>
      </label>
    </div>
  `;

  const hasTermination = String(draftValue("hasTermination", "")) === "true";

  return `
    <section class="personnel-section">
      <div class="form-grid form-grid-4">
        <label>
          <span>Tipo de Contrato *</span>
          <select name="contractType" required>
            ${renderOptions(
              [
                { value: "obra_labor",           label: "Obra o labor" },
                { value: "termino_fijo",          label: "Término fijo" },
                { value: "prestacion_servicios",  label: "Prestación de servicios" },
              ],
              draftValue("contractType"),
              "Selecciona"
            )}
          </select>
        </label>
        <label>
          <span>Tipo de tiempo *</span>
          <select name="workTimeType" required>
            <option value="">Selecciona</option>
            <option value="TC" ${draftValue("workTimeType") === "TC" ? "selected" : ""}>Tiempo completo</option>
            <option value="MT" ${draftValue("workTimeType") === "MT" ? "selected" : ""}>Medio tiempo</option>
          </select>
        </label>
        <label>
          <span>Fecha real de ingreso *</span>
          <input name="startDate" type="date" value="${escapeAttr(draftValue("startDate"))}" required />
        </label>
        <label>
          <span>Fecha inicio por cobertura *</span>
          <input name="coverageStartDate" type="date" value="${escapeAttr(draftValue("coverageStartDate"))}" required />
        </label>
      </div>

      <div class="subsection-title">Seguridad Social</div>

      <div class="form-grid form-grid-4">
        <label>
          <span>EPS *</span>
          <select name="eps" required>
            ${renderOptions(EPS_LIST, draftValue("eps"), "Selecciona EPS")}
          </select>
        </label>
        <label>
          <span>Fondo de Pensiones *</span>
          <select name="pensionFund" required>
            ${renderOptions(AFP_LIST, draftValue("pensionFund"), "Selecciona fondo")}
          </select>
        </label>
        <label>
          <span>Caja de Compensación *</span>
          <input name="compensationBox" type="text" value="COFREM" readonly required />
        </label>
        <label>
          <span>ARL *</span>
          <input name="arl" type="text" value="SURA" readonly required />
        </label>
      </div>

      <div class="subsection-title">Retiro</div>

      <div class="checkbox-row" style="margin-top:8px; gap:16px">
        <label style="display:flex;align-items:center;gap:10px;flex-shrink:0">
          <input type="checkbox" name="hasTermination" ${hasTermination ? "checked" : ""} />
          <span>¿La persona presenta renuncia o se retira?</span>
        </label>
        ${hasTermination ? `
        <label style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <span style="white-space:nowrap;font-size:13px;font-weight:600;color:#374151">Fecha de retiro</span>
          <input name="terminationDate" type="date" value="${escapeAttr(draftValue("terminationDate"))}" style="min-width:150px" />
        </label>
        ` : ""}
      </div>

      ${dotacionBlock}
    </section>
  `;
}

function _addMonths(dateStr, months) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function buildTabSeguimiento(draftValue) {
  const hasSisben = String(draftValue("sisben", "")) === "true"
    || !!draftValue("sisbenCategory")
    || !!draftValue("sisbenIssueDate");
  const hasResidenceCert = String(draftValue("hasResidenceCertificate", "")) === "true"
    || !!draftValue("residenceCertificateIssueDate")
    || !!draftValue("residenceCertificateExpiration");

  const SISBEN_CATEGORIES = ["A1","A2","A3","B1","B2","B3","B4","B5","B6","B7","C1","C2","C3","C4","C5","C6","C7","C8","C9","C10","C11","C12","C13","C14","C15","C16","C17","C18","D1","D2","D3","D4","D5","D6","D7","D8","D9","D10","D11","D12","D13","D14","D15","D16","D17","D18","D19","D20","D21"];

  const currentCat   = draftValue("sisbenCategory") || "";
  const currentIssue = draftValue("sisbenIssueDate") || "";
  const currentExpiry = draftValue("sisbenExpirationDate") || _addMonths(currentIssue, 4);

  const sisbenBlock = hasSisben ? `
    <div class="subsection-title">Datos del SISBEN</div>
    <div class="form-grid form-grid-3">
      <label>
        <span>Categoría SISBEN</span>
        <select name="sisbenCategory">
          <option value="">Selecciona</option>
          ${SISBEN_CATEGORIES.map(c => `<option value="${c}" ${currentCat === c ? "selected" : ""}>${c}</option>`).join("")}
        </select>
      </label>
      <label>
        <span>Fecha de expedición SISBEN</span>
        <input name="sisbenIssueDate" type="date" value="${escapeAttr(currentIssue)}" />
      </label>
      <label>
        <span>Vencimiento SISBEN <small style="color:var(--text-faint);font-weight:400">(auto · 4 meses)</small></span>
        <input name="sisbenExpirationDate" type="date" readonly
          style="background:var(--input-bg,#f1f5f9);cursor:default"
          value="${escapeAttr(currentExpiry)}" />
      </label>
    </div>
  ` : "";

  const currentResidIssue  = draftValue("residenceCertificateIssueDate") || "";
  const currentResidExpiry = draftValue("residenceCertificateExpiration") || _addMonths(currentResidIssue, 6);

  const residCertBlock = hasResidenceCert ? `
    <div class="subsection-title">Datos del certificado de residencia</div>
    <div class="form-grid form-grid-2">
      <label>
        <span>Fecha de expedición</span>
        <input name="residenceCertificateIssueDate" type="date" value="${escapeAttr(currentResidIssue)}" />
      </label>
      <label>
        <span>Vencimiento <small style="color:var(--text-faint);font-weight:400">(auto · 6 meses)</small></span>
        <input name="residenceCertificateExpiration" type="date" readonly
          style="background:var(--input-bg,#f1f5f9);cursor:default"
          value="${escapeAttr(currentResidExpiry)}" />
      </label>
    </div>
  ` : "";

  return `
    <section class="personnel-section">
      <div class="form-grid form-grid-2">
        <label>
          <span>¿Tiene SISBEN?</span>
          <select name="sisben">
            <option value="">Selecciona</option>
            <option value="true"  ${hasSisben ? "selected" : ""}>Sí</option>
            <option value="false" ${!hasSisben && draftValue("sisben") !== "" ? "selected" : ""}>No</option>
          </select>
        </label>
        <label>
          <span>¿Tiene certificado de residencia?</span>
          <select name="hasResidenceCertificate">
            <option value="">Selecciona</option>
            <option value="true"  ${hasResidenceCert ? "selected" : ""}>Sí</option>
            <option value="false" ${!hasResidenceCert && draftValue("hasResidenceCertificate") !== "" ? "selected" : ""}>No</option>
          </select>
        </label>
      </div>
      ${sisbenBlock}
      ${residCertBlock}
    </section>
  `;
}

function buildTabEstudios(draftValue) {
  const estudios = Array.isArray(draftValue("studies", [])) ? draftValue("studies", []) : [];

  const listHtml = estudios.length
    ? `<div class="estudios-list">
        ${estudios.map((s, i) => `
          <div class="estudio-item">
            <div class="estudio-item-info">
              <strong>${escapeHtml(s.degree || "Sin título")}</strong>
              <span>
                ${escapeHtml(s.educationLevel || "")}
                ${s.institution ? " · " + escapeHtml(s.institution) : ""}
                ${s.year ? " · " + escapeHtml(String(s.year)) : ""}
              </span>
            </div>
            <button type="button" class="btn-remove-estudio" data-study-index="${i}">Eliminar</button>
          </div>
        `).join("")}
      </div>`
    : `<p class="obs-empty">No hay estudios registrados aún.</p>`;

  return `
    <section class="personnel-section">

      <div class="food-handling-section">
        <h5>Curso de manipulación de alimentos</h5>
        <div class="form-grid form-grid-4">
          <label>
            <span>Curso · Fecha de expedición</span>
            <input name="foodHandlingCourseIssueDate" type="date"
              value="${escapeAttr(draftValue("foodHandlingCourseIssueDate"))}" />
          </label>
          <label>
            <span>Curso · Vencimiento <small style="color:var(--text-faint);font-weight:400">(auto)</small></span>
            <input name="foodHandlingCourseExpirationDate" type="date" readonly
              style="background:var(--input-bg,#f1f5f9);cursor:default"
              value="${escapeAttr(draftValue("foodHandlingCourseExpirationDate"))}" />
          </label>
          <label>
            <span>Exámenes · Fecha de expedición</span>
            <input name="foodHandlingExamIssueDate" type="date"
              value="${escapeAttr(draftValue("foodHandlingExamIssueDate"))}" />
          </label>
          <label>
            <span>Exámenes · Vencimiento <small style="color:var(--text-faint);font-weight:400">(auto)</small></span>
            <input name="foodHandlingExamExpirationDate" type="date" readonly
              style="background:var(--input-bg,#f1f5f9);cursor:default"
              value="${escapeAttr(draftValue("foodHandlingExamExpirationDate"))}" />
          </label>
        </div>
      </div>

      <div class="estudios-add-form" style="margin-top:18px">
        <h5>Agregar estudio</h5>
        <div class="form-grid form-grid-4">
          <label>
            <span>Nivel educativo</span>
            <select id="newStudyLevel">
              <option value="">Selecciona</option>
              ${["Primaria","Bachillerato","Técnico","Tecnólogo","Profesional",
                 "Especialización","Maestría","Doctorado","Otro"]
                .map((v) => `<option value="${v}">${v}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>Año de grado</span>
            <input id="newStudyYear" type="number" min="1950" max="2099" placeholder="Ej: 2020" />
          </label>
          <label>
            <span>Institución educativa</span>
            <input id="newStudyInstitution" type="text" placeholder="Nombre de la institución" />
          </label>
          <label>
            <span>Título obtenido</span>
            <input id="newStudyDegree" type="text" placeholder="Nombre del título" />
          </label>
        </div>
        <div style="margin-top:12px">
          <button type="button" id="btnAddEstudio"
            style="background:#2563eb;color:#fff;border:none;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px">
            + Agregar estudio
          </button>
        </div>
      </div>

      ${listHtml}
    </section>
  `;
}

function buildTabExperiencia(draft) {
  const experiencias = Array.isArray(draft.workExperience) ? draft.workExperience : [];

  const listHtml = experiencias.length
    ? `<div class="estudios-list">
        ${experiencias.map((exp, i) => `
          <div class="estudio-item">
            <div class="estudio-item-info">
              <strong>${escapeHtml(exp.empresa || "Empresa sin nombre")}</strong>
              <span>
                ${escapeHtml(exp.cargo || "")}
                ${exp.fechaInicio ? " · " + escapeHtml(exp.fechaInicio) : ""}
                ${exp.fechaFin ? " → " + escapeHtml(exp.fechaFin) : " (actual)"}
                ${exp.dias != null ? " · " + exp.dias + " días" : ""}
              </span>
            </div>
            <button type="button" class="btn-remove-experiencia" data-exp-index="${i}">Eliminar</button>
          </div>
        `).join("")}
      </div>`
    : `<p class="obs-empty">No hay experiencia laboral registrada aún.</p>`;

  return `
    <section class="personnel-section">
      <div style="background:var(--panel-2);padding:1rem;border-radius:10px;margin-bottom:1rem;display:flex;flex-direction:column;gap:12px">
        <div class="form-grid form-grid-2">
          <label>
            <span>Empresa / Empleador</span>
            <input id="expEmpresa" type="text" placeholder="Nombre de la empresa" />
          </label>
          <label>
            <span>Cargo desempeñado</span>
            <input id="expCargo" type="text" placeholder="Cargo o posición" />
          </label>
        </div>
        <div class="form-grid form-grid-3">
          <label>
            <span>Fecha de inicio</span>
            <input id="expFechaInicio" type="date" />
          </label>
          <label>
            <span>Fecha de fin</span>
            <input id="expFechaFin" type="date" />
          </label>
          <label>
            <span>Días trabajados</span>
            <input id="expDias" type="text" readonly placeholder="Se calcula automáticamente"
              style="background:var(--panel-2);cursor:default;color:var(--text-soft)" />
          </label>
        </div>
        <div class="form-grid form-grid-2">
          <label>
            <span>Motivo de retiro</span>
            <input id="expMotivoRetiro" type="text" placeholder="Opcional" />
          </label>
        </div>
      </div>

      <div style="margin-bottom:1.2rem">
        <button type="button" id="btnAddExperiencia"
          style="background:#2563eb;color:#fff;border:none;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px">
          + Agregar experiencia
        </button>
      </div>

      ${listHtml}
    </section>
  `;
}

function buildTabObservaciones(draftValue) {
  const observations = Array.isArray(draftValue("observations", [])) ? draftValue("observations", []) : [];

  const historyHtml = observations.length
    ? observations.slice().reverse().map((o) => `
        <div class="obs-item">
          <div class="obs-item-meta">
            ${escapeHtml(o.date ? new Date(o.date).toLocaleString("es-CO") : "—")} · ${escapeHtml(o.user || "—")}
          </div>
        <div class="obs-item-text">${escapeHtml(o.text || "")}</div>
        ${o.attachmentUrl
            ? `<div class="obs-item-attachment">
                <a href="${escapeAttr(o.attachmentUrl)}" rel="noopener">
                  📎 ${escapeHtml(o.attachmentName || "Archivo adjunto")}
                </a>
               </div>`
            : ""}
        </div>
      `).join("")
    : `<p class="obs-empty">No hay observaciones registradas.</p>`;

  return `
    <section class="personnel-section">
      <div class="form-grid form-grid-1">
        <label>
          <span>Nueva observación</span>
          <textarea id="newObservationText" rows="4"
            placeholder="Escribe aquí la observación..."></textarea>
        </label>
        <label>
          <span>Adjuntar archivo</span>
          <span style="font-size:11px;color:var(--text-faint)">
            Los adjuntos quedan deshabilitados en este flujo.
          </span>
        </label>
      </div>

      <div style="margin-top:10px">
        <button type="button" id="btnAddObservacion" class="btn btn-primary btn-row">Guardar observación</button>
      </div>

      <div class="obs-history">${historyHtml}</div>
    </section>
  `;
}

// ── loadPersonnelModule ───────────────────────────────────────────────────────

export async function loadPersonnelModule(moduleConfig, submoduleKey) {
  let payload;

  try {
    payload = await apiFetch("/personnel?page=1&pageSize=1");
    _cachedPayload = payload;
  } catch (error) {
    return `
      <article class="info-card">
        <h3>Error en Gestión del Personal</h3>
        <p>${escapeHtml(error.message)}</p>
      </article>
    `;
  }

  if (!state.personnelDraft)      state.personnelDraft = {};
  if (!state.personnelDraftBaselineData) {
    state.personnelDraftBaselineData = clonePersonnelDraftSnapshot(state.personnelDraft);
  }
  if (!state.personnelCreateTab)  state.personnelCreateTab = "identificacion";
  if (!state.personnelDraftBaselineFingerprint) {
    state.personnelDraftBaselineFingerprint = getPersonnelDraftFingerprint(state.personnelDraft);
  }
  if (!state.personnelSaveState) state.personnelSaveState = "clean";
  state.personnelCreateTab = normalizePersonnelTabKey(state.personnelCreateTab);

  try {
    await loadEducationalScopeOptions(state.personnelDraft, { force: true });
    syncInstitutionalSelectionsWithCatalog(state.personnelDraft, _cachedPayload?.educationalCatalog || {});
    await loadGestorScopeOptions(state.personnelDraft);
  } catch (error) {
    console.warn("[personnel] No fue posible cargar catálogos del formulario:", error.message);
  }

  // Limpiar gestor/auxiliar del draft SOLO si el scope cargado corresponde al municipio
  // del empleado Y el nombre no está en la lista. Evita borrar datos válidos cuando
  // la lista se cargó para un municipio distinto o está incompleta.
  const gestorNamesLoaded = (_cachedPayload?.gestorNames || []).length > 0;
  const draftMuniId = String(getDraftMunicipalityId(state.personnelDraft) || "").trim();
  const gestorScopeMatchesDraft = !draftMuniId ||
    String(_cachedPayload?.gestorScopeKey || "").includes(draftMuniId);
  if (gestorNamesLoaded && gestorScopeMatchesDraft &&
      state.personnelDraft?.gestorZona &&
      !(_cachedPayload.gestorNames).includes(state.personnelDraft.gestorZona)) {
    state.personnelDraft.gestorZona = "";
  }
  const auxiliarNamesLoaded = (_cachedPayload?.auxiliarGestorNames || []).length > 0;
  if (auxiliarNamesLoaded && gestorScopeMatchesDraft &&
      state.personnelDraft?.auxiliarGestorZona &&
      !(_cachedPayload.auxiliarGestorNames).includes(state.personnelDraft.auxiliarGestorZona)) {
    state.personnelDraft.auxiliarGestorZona = "";
  }

  // Fetch contract positions for dropdown config
  const draftContractId = state.personnelDraft?.contractId || state.currentUser?.contractId;
  if (draftContractId && !_contractPositions) {
    try {
      const posData = await apiFetch(`/contracts/${draftContractId}/positions`);
      const all = Array.isArray(posData.positions) ? posData.positions : [];
      _contractPositions = {
        licitacion: all.filter(p => p.type === "licitacion").map(p => p.name).filter(Boolean),
        real:       all.filter(p => p.type === "real").map(p => p.name).filter(Boolean),
      };
    } catch { _contractPositions = { licitacion: [], real: [] }; }
  }

  const draft     = state.personnelDraft;
  const activeTab = normalizePersonnelTabKey(state.personnelCreateTab);
  state.personnelCreateTab = activeTab;

  const currentCargoReal     = String(draft.cargo_real || draft.real_position || draft.position || "").toUpperCase();
  const institutionalEnabled = isInstitutionalTabEnabled(currentCargoReal);
  const isEditMode           = state.personnelViewMode === "edit";

  // ── Draft accessors ───────────────────────────────────────────────────────

  const draftValue = (name, fallback = "") =>
    draft[name] !== undefined && draft[name] !== null ? draft[name] : fallback;

  const firstDraftValue = (...names) => {
    for (const name of names) {
      if (draft[name] !== undefined && draft[name] !== null && String(draft[name]).trim() !== "") {
        return draft[name];
      }
    }
    return "";
  };

  const selected = (name, value) =>
    String(draftValue(name, "")) === String(value) ? "selected" : "";

  // ── Derived values ────────────────────────────────────────────────────────

  const expeditionDepartment   = draftValue("expeditionDepartment", "");
  const birthDepartment        = draftValue("birthDepartment", "");
  const vinculationCompanyId   = draftValue("companyId", state.currentUser?.companyId ?? "");
  const residenceMunicipality  = draftValue("residenceMunicipality", "");

  const educationalCatalog =
    (_cachedPayload?.educationalCatalog && Object.keys(_cachedPayload.educationalCatalog).length > 0)
      ? _cachedPayload.educationalCatalog
      : state.educationalCatalog || {};
  const educationalCatalogMeta = _cachedPayload?.educationalCatalogMeta || {};
  const officialMunicipalities = getOperationalMunicipalityOptions();

  syncDraftOfficialMunicipality(draft);
  const municipalityIdResolved = getDraftMunicipalityId(draft);
  const municipalityNameResolved = getDraftMunicipalityName(draft);

  const institutionalMunicipality = municipalityIdResolved ? String(municipalityIdResolved) : "";
  const municipalityCatalog   = institutionalMunicipality ? (educationalCatalog[institutionalMunicipality] || {}) : {};
  const institutionalMunicipalities = Array.isArray(educationalCatalogMeta?.municipalities)
    ? educationalCatalogMeta.municipalities
    : officialMunicipalities;
  const institutionNames      = Object.keys(municipalityCatalog);

  const selectedInstitutionRaw = firstDraftValue("institution", "institucion_educativa");
  const institutionKey         = findCatalogKey(municipalityCatalog, selectedInstitutionRaw);
  const selectedInstitution    = institutionKey || selectedInstitutionRaw;
  const sedeCatalog            = institutionKey ? municipalityCatalog[institutionKey] : {};
  const sedeNames              = Object.keys(sedeCatalog);

  const selectedSedeRaw = firstDraftValue("site", "sede_educativa");
  const sedeKey         = findCatalogKey(sedeCatalog, selectedSedeRaw);
  const selectedSede    = sedeKey || selectedSedeRaw;
  const modalidadCatalog = sedeKey ? sedeCatalog[sedeKey] : [];

  const selectedModalityRaw = firstDraftValue("educationalModality", "modalidad");
  const selectedModality =
    modalidadCatalog.find(
      (m) => normalizeCatalogText(m) === normalizeCatalogText(selectedModalityRaw)
    ) || selectedModalityRaw;

  const gestorNames = _cachedPayload?.gestorNames || [];
  const auxiliarGestorNames = _cachedPayload?.auxiliarGestorNames || [];
  const gestorStatusMessage = _cachedPayload?.gestorStatusMessage || "";

  const managerRole = ["GESTOR DE ZONA", "AUXILIAR DE GESTOR DE ZONA"].includes(currentCargoReal);

  // ── Part 7: event wiring (deferred) ──────────────────────────────────────

  setTimeout(() => {
    const form    = document.getElementById("personnelForm");
    const backBtn = document.getElementById("backToPersonnelTable");
    if (!form) return;

    // ── Back button ───────────────────────────────────────────────────────
    if (backBtn) {
      backBtn.addEventListener("click", async () => {
        state.personnelViewMode   = "table";
        state.personnelEditingId  = null;
        state.personnelDossier    = null;
        state.personnelCreateTab  = "identificacion";
        state.personnelSelectedId = "__none__";
        state.personnelSavedTabs  = null;
        await openModule(state.activeModule || "gestion_personal");
      });
    }

    // ── Tab navigation — swap sin re-render completo ──────────────────────
    document.querySelectorAll("[data-step-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        state.personnelCreateTab = normalizePersonnelTabKey(btn.dataset.stepTab);
        _refreshPersonnelSection();
      });
    });

    // ── Campos reactivos y sync — delegation sobre el form ───────────────
    document.querySelectorAll("[data-dossier-chip]").forEach((chip) => {
      chip.addEventListener("click", async () => {
        const action = String(chip.dataset.dossierChip || "").trim();
        if (!action) return;

        if (action === "documents") {
          const employeeId = state.personnelEditingId || state.personnelDraft?.id || "";
          if (!employeeId) return;
          const found = await getFullEmployee(employeeId);
          if (!found) return;
          state.personnelDraft = hydratePersonnelDraft(found);
          state.personnelDossier = null;
          state.personnelViewMode = "documents";
          state.personnelEditingId = found.id || employeeId || null;
          state.personnelSelectedId = found.id || employeeId || null;
          state.personnelDocumentsEmployee = found;
          await openModule(state.activeModule || "gestion_personal");
          return;
        }

        if (action === "coverage") {
          state.personnelCreateTab = "vinculacion_laboral";
          _refreshPersonnelSection();
          return;
        }

        if (action === "payroll" || action === "novelties" || action === "alerts") {
          state.personnelCreateTab = "historial_observaciones";
          _refreshPersonnelSection();
        }
      });
    });

    const REACTIVE_FIELDS = [
      "expeditionDepartment", "birthDepartment", "companyId",
      "municipalityId", "educationalMunicipality", "institution", "site",
      "cargo_real", "biologicalSex", "sisben", "hasResidenceCertificate", "presentedInOffer",
      "hasTermination", "terminationDate", "hasAuxiliarGestor",
      "birthDay", "birthMonth", "birthYear",
    ];

    form.addEventListener("input", (e) => {
      if (!e.target.matches("input, select, textarea")) return;
      syncPersonnelDraftField(e.target);
      state.personnelSaveState = "editing";
      syncPersonnelSaveStateDom();
      syncEmployeeHeaderFromDraft();
    });

    form.addEventListener("change", async (e) => {
      if (!e.target.matches("input, select, textarea")) return;

      // Municipios asignados al gestor — collect all checked boxes into draft
      if (e.target.name === "municipioACargo") {
        const checked = Array.from(form.querySelectorAll('input[name="municipioACargo"]:checked'))
          .map(cb => cb.value);
        state.personnelDraft.municipiosACargo = checked.join("|");
        const countEl = document.getElementById("munPickerCount");
        if (countEl) countEl.textContent = checked.length
          ? `${checked.length} seleccionado${checked.length > 1 ? "s" : ""}`
          : "Ninguno";
        // Toggle active class on chip
        const chip = e.target.closest(".mun-chip");
        if (chip) chip.classList.toggle("mun-chip-active", e.target.checked);
        return;
      }

      syncPersonnelDraftField(e.target);
      state.personnelSaveState = "editing";

      // Auto-vencimiento SISBEN (+4 meses) y certificado de residencia (+6 meses)
      if (e.target.name === "sisbenIssueDate" && e.target.value) {
        const exp = new Date(e.target.value + "T00:00:00");
        exp.setMonth(exp.getMonth() + 4);
        const expStr = exp.toISOString().slice(0, 10);
        state.personnelDraft.sisbenExpirationDate = expStr;
        const expInput = form.querySelector('[name="sisbenExpirationDate"]');
        if (expInput) expInput.value = expStr;
        syncPersonnelSaveStateDom();
        return;
      }
      if (e.target.name === "residenceCertificateIssueDate" && e.target.value) {
        const exp = new Date(e.target.value + "T00:00:00");
        exp.setMonth(exp.getMonth() + 6);
        const expStr = exp.toISOString().slice(0, 10);
        state.personnelDraft.residenceCertificateExpiration = expStr;
        const expInput = form.querySelector('[name="residenceCertificateExpiration"]');
        if (expInput) expInput.value = expStr;
        syncPersonnelSaveStateDom();
        return;
      }

      // Auto-vencimiento manipulación de alimentos (+1 año)
      if (e.target.name === "foodHandlingCourseIssueDate" && e.target.value) {
        const exp = new Date(e.target.value);
        exp.setFullYear(exp.getFullYear() + 1);
        const expStr = exp.toISOString().slice(0, 10);
        state.personnelDraft.foodHandlingCourseExpirationDate = expStr;
        const expInput = form.querySelector('[name="foodHandlingCourseExpirationDate"]');
        if (expInput) expInput.value = expStr;
        syncPersonnelSaveStateDom();
        return;
      }
      if (e.target.name === "foodHandlingExamIssueDate" && e.target.value) {
        const exp = new Date(e.target.value);
        exp.setFullYear(exp.getFullYear() + 1);
        const expStr = exp.toISOString().slice(0, 10);
        state.personnelDraft.foodHandlingExamExpirationDate = expStr;
        const expInput = form.querySelector('[name="foodHandlingExamExpirationDate"]');
        if (expInput) expInput.value = expStr;
        syncPersonnelSaveStateDom();
        return;
      }

      // Calculadora de días de experiencia
      if (e.target.id === "expFechaInicio" || e.target.id === "expFechaFin") {
        const inicio = document.getElementById("expFechaInicio")?.value;
        const fin    = document.getElementById("expFechaFin")?.value;
        const diasEl = document.getElementById("expDias");
        if (diasEl) {
          if (inicio && fin && fin >= inicio) {
            const d = Math.round((new Date(fin) - new Date(inicio)) / 86_400_000);
            diasEl.value = d + (d === 1 ? " día" : " días");
          } else {
            diasEl.value = "";
          }
        }
        return;
      }

      if (REACTIVE_FIELDS.includes(e.target.name)) {
        // Cascading clears
        let shouldReloadGestores = false;
        let shouldValidateGestorSelection = false;
        let shouldReloadEducationalCatalog = false;
        if (e.target.name === "companyId") {
          state.personnelDraft.contractId = "";
          state.personnelDraft.educationalMunicipality = "";
          state.personnelDraft.institution = "";
          state.personnelDraft.site = "";
          state.personnelDraft.educationalModality = "";
          state.personnelDraft.gestorZona = "";
          state.personnelDraft.auxiliarGestorZona = "";
        }
        if (e.target.name === "companyId" || e.target.name === "contractId") {
          shouldReloadEducationalCatalog = true;
          shouldReloadGestores = true;
          shouldValidateGestorSelection = true;
          state.personnelDraft.educationalMunicipality = "";
          state.personnelDraft.institution = "";
          state.personnelDraft.site = "";
          state.personnelDraft.educationalModality = "";
          state.personnelDraft.gestorZona = "";
          state.personnelDraft.auxiliarGestorZona = "";
        }
        if (e.target.name === "expeditionDepartment")
          state.personnelDraft.expeditionMunicipality = "";
        if (e.target.name === "birthDepartment")
          state.personnelDraft.birthMunicipality = "";
        if (e.target.name === "presentedInOffer" && e.target.value !== "true")
          state.personnelDraft.offerPosition = "";
        if (e.target.name === "municipalityId") {
          // syncPersonnelDraftField ya escribió draft.municipalityId con el nuevo valor,
          // pero draft.municipality_id sigue con el valor de la hidratación (el viejo municipio).
          // getDraftMunicipalityId lee municipality_id primero con ??, por lo que volvería al
          // municipio anterior aunque el usuario haya seleccionado uno nuevo.
          // Sincronizamos municipality_id ANTES de que syncDraftOfficialMunicipality lo lea.
          state.personnelDraft.municipality_id = state.personnelDraft.municipalityId || "";
          syncDraftOfficialMunicipality(state.personnelDraft);
          state.personnelDraft.institution             = "";
          state.personnelDraft.site                    = "";
          state.personnelDraft.educationalModality     = "";
          state.personnelDraft.gestorZona              = "";
          state.personnelDraft.auxiliarGestorZona      = "";
          shouldReloadGestores = true;
          shouldValidateGestorSelection = true;
        }
        if (e.target.name === "institution") {
          state.personnelDraft.site                = "";
          state.personnelDraft.educationalModality = "";
        }
        if (e.target.name === "site")
          state.personnelDraft.educationalModality = "";
        if (e.target.name === "hasAuxiliarGestor" && e.target.value !== "true")
          state.personnelDraft.auxiliarGestorZona = "";
        if (e.target.name === "hasTermination" && !e.target.checked)
          state.personnelDraft.terminationDate = "";
        if (e.target.name === "cargo_real" && !isInstitutionalTabEnabled(e.target.value)) {
          state.personnelDraft.educationalMunicipality = "";
          state.personnelDraft.institution             = "";
          state.personnelDraft.site                    = "";
          state.personnelDraft.educationalModality     = "";
          state.personnelDraft.municipiosACargo        = "";
        }
        if (shouldReloadEducationalCatalog) {
          try {
            await loadEducationalScopeOptions(state.personnelDraft, { force: true });
          } catch (error) {
            showWarning(error.message || "No fue posible actualizar la cobertura PAE del formulario.");
          }
        }

        syncInstitutionalSelectionsWithCatalog(state.personnelDraft, _cachedPayload?.educationalCatalog || {});

        if (shouldReloadGestores) {
          try {
            await loadGestorScopeOptions(state.personnelDraft, { force: true });
          } catch (error) {
            showWarning(error.message || "No fue posible actualizar la lista de gestores.");
          }

          if (shouldValidateGestorSelection) {
            const gestorNamesInScope = _cachedPayload?.gestorNames || [];
            const auxiliarNamesInScope = _cachedPayload?.auxiliarGestorNames || [];
            if (state.personnelDraft.gestorZona && !gestorNamesInScope.includes(state.personnelDraft.gestorZona)) {
              state.personnelDraft.gestorZona = "";
            }
            if (state.personnelDraft.auxiliarGestorZona && !auxiliarNamesInScope.includes(state.personnelDraft.auxiliarGestorZona)) {
              state.personnelDraft.auxiliarGestorZona = "";
            }
          }
        }
        _refreshPersonnelSection();
        return;
      }

      syncPersonnelSaveStateDom();
      syncEmployeeHeaderFromDraft();
    });

    enforceInputRestrictions(document.getElementById("personnelActiveSection") || form);
    attachPersonnelFormValidation(form);
    syncPersonnelSaveStateDom();
    syncEmployeeHeaderFromDraft();
    configurePersonnelFormForKeyboard(form, { focusFirst: isEditMode && activeTab === "identificacion" });
    form.addEventListener("submit", handlePersonnelFormSubmit);

    document.getElementById("cancelPersonnelEdit")?.addEventListener("click", async () => {
      await restorePersonnelDraftFromBaseline();
      _refreshPersonnelSection();
      syncPersonnelSaveStateDom();
      configurePersonnelFormForKeyboard(document.getElementById("personnelForm"), { focusFirst: true });
    });

    // ── Botones de sección — delegation sobre el form ─────────────────────
    form.addEventListener("click", (e) => {
      // Estudios: agregar
      if (e.target.closest("#btnAddEstudio")) {
        const level       = document.getElementById("newStudyLevel")?.value || "";
        const year        = document.getElementById("newStudyYear")?.value || "";
        const institution = document.getElementById("newStudyInstitution")?.value || "";
        const degree      = document.getElementById("newStudyDegree")?.value || "";
        if (!degree && !institution) { showWarning("Ingresa al menos el título o la institución."); return; }
        if (!Array.isArray(state.personnelDraft.studies)) state.personnelDraft.studies = [];
        state.personnelDraft.studies.push({ educationLevel: level, year, institution, degree });
        state.personnelCreateTab = "datos_generales";
        _refreshPersonnelSection();
        return;
      }
      // Estudios: eliminar
      const removeEstudio = e.target.closest(".btn-remove-estudio");
      if (removeEstudio) {
        const idx = parseInt(removeEstudio.dataset.studyIndex, 10);
        if (!Array.isArray(state.personnelDraft.studies)) return;
        state.personnelDraft.studies.splice(idx, 1);
        state.personnelCreateTab = "datos_generales";
        _refreshPersonnelSection();
        return;
      }
      // Experiencia: agregar
      if (e.target.closest("#btnAddExperiencia")) {
        const empresa      = (document.getElementById("expEmpresa")?.value || "").trim();
        const cargo        = (document.getElementById("expCargo")?.value || "").trim();
        const fechaInicio  = document.getElementById("expFechaInicio")?.value || "";
        const fechaFin     = document.getElementById("expFechaFin")?.value || "";
        const motivoRetiro = (document.getElementById("expMotivoRetiro")?.value || "").trim();
        const dias = fechaInicio && fechaFin && fechaFin >= fechaInicio
          ? Math.round((new Date(fechaFin) - new Date(fechaInicio)) / 86_400_000)
          : null;
        if (!empresa && !cargo) { showWarning("Ingresa al menos empresa o cargo."); return; }
        if (!Array.isArray(state.personnelDraft.workExperience)) state.personnelDraft.workExperience = [];
        state.personnelDraft.workExperience.push({ empresa, cargo, fechaInicio, fechaFin, dias, motivoRetiro });
        state.personnelCreateTab = "datos_generales";
        _refreshPersonnelSection();
        return;
      }
      // Experiencia: eliminar
      const removeExp = e.target.closest(".btn-remove-experiencia");
      if (removeExp) {
        const idx = parseInt(removeExp.dataset.expIndex, 10);
        if (!Array.isArray(state.personnelDraft.workExperience)) return;
        state.personnelDraft.workExperience.splice(idx, 1);
        state.personnelCreateTab = "datos_generales";
        _refreshPersonnelSection();
        return;
      }
    });

    // ── Observaciones (async — delegation separada) ───────────────────────
    form.addEventListener("click", async (e) => {
      if (!e.target.closest("#btnAddObservacion")) return;
      const txt      = (document.getElementById("newObservationText")?.value || "").trim();
      if (!txt) { showWarning("Escribe la observación antes de guardar."); return; }
      if (!Array.isArray(state.personnelDraft.observations)) state.personnelDraft.observations = [];
      state.personnelDraft.observations.push({
        text: txt,
        date: new Date().toISOString(),
        user: state.currentUser?.name || "Usuario",
      });
      state.personnelCreateTab = "historial_observaciones";
      _refreshPersonnelSection();
    });
  }, 0);

  // ── Tab section ───────────────────────────────────────────────────────────

  const activeSectionHtml = buildPersonnelMacroSection({
    activeTab,
    draftValue,
    draft,
    expeditionDepartment,
    birthDepartment,
    isEditMode,
    residenceMunicipality,
    selected,
    vinculationCompanyId,
    gestorNames,
    auxiliarGestorNames,
    gestorStatusMessage,
    institutionalEnabled,
    managerRole,
    institutionalMunicipality,
    municipalityNameResolved,
    institutionalMunicipalities,
    institutionNames,
    selectedInstitution,
    sedeNames,
    selectedSede,
    modalidadCatalog,
    selectedModality,
    educationalCatalogMeta,
    currentCargoReal,
    dossier: state.personnelDossier || null,
  });

  // ── Shell ─────────────────────────────────────────────────────────────────

  const tabButtons = buildTabButtons(activeTab, institutionalEnabled);
  const displayName = getPersonnelDraftDisplayName(draftValue);
  const docType   = draftValue("documentType") || "";
  const docNumber = draftValue("documentNumber") || "";
  const headerHtml = buildEmployeeDossierHeader({
    draftValue,
    fullName: displayName,
    docType,
    docNumber,
    isEditMode,
    dossier: isEditMode ? state.personnelDossier || null : null,
  });
  const saveState = computePersonnelSaveState(isEditMode);

  return `
    <div class="personnel-grid">
      <article class="info-card personnel-form-card employee-form-shell">

        ${headerHtml}

        ${tabButtons}

        <div class="form-scroll-area">
          <form id="personnelForm" class="personnel-form-v2" novalidate>
            <div class="personnel-form-actions">
              <div class="personnel-form-actions-meta">
                <div id="personnelAgeSlot">${activeTab === "identificacion" ? buildAgeIndicator(draftValue("birthDay"), draftValue("birthMonth"), draftValue("birthYear")) : ""}</div>
                <span id="personnelSaveState" class="personnel-save-state state-${saveState.tone}">${saveState.label}</span>
              </div>
              <div class="personnel-form-actions-buttons">
                ${isEditMode ? `<button type="button" id="cancelPersonnelEdit" class="btn btn-secondary personnel-cancel-btn" data-personnel-primary-action>Cancelar</button>` : ""}
                <button type="submit" class="primary-soft-btn personnel-save-btn" data-personnel-primary-action>
                  ${isEditMode
                    ? "Guardar cambios"
                    : _PRE_SUBMIT_TABS.has(activeTab)
                      ? "Guardar y continuar →"
                      : "Crear empleado"}
                </button>
              </div>
            </div>

            <div id="personnelActiveSection" class="personnel-active-section personnel-active-section-${escapeAttr(activeTab)}">${activeSectionHtml}</div>
          </form>
        </div>
      </article>
    </div>
  `;
}

// ── Part 8: renderPersonnelTableModule ───────────────────────────────────────

// ── Helpers de HV (frontend — usa allDocuments del API) ──────────────────────

function _norm(v) {
  return String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

function getPersonnelHvStatusFull(employee, allDocuments = []) {
  if (!allDocuments.length && employee?.hvStatus) {
    const label = employee.hvStatus;
    return { label, className: normalizeChipStatus(label) };
  }

  const employeeDocs = allDocuments.filter(
    (d) => String(d.employeeId) === String(employee.id)
  );
  const required = getRequiredDocumentsForEmployee(employee).filter((d) => d.required);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let hasMissing = false, hasRejected = false, hasExpired = false;
  let hasPending = false, hasInvalidDates = false, hasSoonToExpire = false;

  for (const req of required) {
    const uploaded = employeeDocs
      .filter((d) => sameDocumentType(d.documentType, req.name))
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];

    if (!uploaded?.fileUrl) { hasMissing = true; continue; }

    const vs = _norm(uploaded.validationStatus || uploaded.status);
    if (vs === "RECHAZADO") hasRejected = true;
    if (vs !== "VALIDADO")  hasPending  = true;

    if (req.issueDateRequired    && !uploaded.issueDate)      hasInvalidDates  = true;
    if (req.expirationDateRequired && !uploaded.expirationDate) hasInvalidDates = true;

    if (req.expirationDateRequired && uploaded.expirationDate) {
      const exp  = new Date(uploaded.expirationDate);
      exp.setHours(0, 0, 0, 0);
      const diff = Math.ceil((exp - today) / 86_400_000);
      if (diff < 0)             hasExpired      = true;
      else if (diff <= 30)      hasSoonToExpire = true;
    }
  }

  if (hasExpired || hasRejected) return { label: "No apto documental", className: "danger" };
  if (hasMissing)                return { label: "Incompleta",          className: "danger" };
  if (hasPending || hasInvalidDates || hasSoonToExpire)
                                 return { label: "En revisión",         className: "warning" };
  return                                { label: "Completa",            className: "success" };
}

function calculateDocumentAlertsFrontend(rows = [], allDocuments = []) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const alerts = { vencidos: 0, proximosVencer: 0, revision: 0, rechazados: 0 };

  for (const emp of rows) {
    const empDocs = allDocuments.filter((d) => String(d.employeeId) === String(emp.id));
    for (const req of getRequiredDocumentsForEmployee(emp).filter((d) => d.required)) {
      const up = empDocs
        .filter((d) => sameDocumentType(d.documentType, req.name))
        .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];

      if (!up?.fileUrl) continue;
      const vs = _norm(up.validationStatus || up.status);
      if (vs === "RECHAZADO") { alerts.rechazados++; continue; }
      if (req.expirationDateRequired && up.expirationDate) {
        const exp  = new Date(up.expirationDate);
        exp.setHours(0, 0, 0, 0);
        const diff = Math.ceil((exp - today) / 86_400_000);
        if (diff < 0)        { alerts.vencidos++;       continue; }
        if (diff <= 30)        alerts.proximosVencer++;
      }
      if (vs !== "VALIDADO") alerts.revision++;
    }
  }
  return alerts;
}

function calculatePersonnelDashboardFrontend(rows = [], allDocuments = []) {
  const s = { total: rows.length, completa: 0, revision: 0, incompleta: 0, noApto: 0 };
  for (const emp of rows) {
    const { label } = getPersonnelHvStatusFull(emp, allDocuments);
    if (label === "Completa")          s.completa++;
    else if (label === "En revisión")  s.revision++;
    else if (label === "Incompleta")   s.incompleta++;
    else if (label === "No apto documental") s.noApto++;
  }
  return s;
}

// ── hydratePersonnelDraft ─────────────────────────────────────────────────────

// Normaliza cualquier valor de fecha a "YYYY-MM-DD" para <input type="date">
function fmtDate(v) {
  if (!v) return "";
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : "";
}

function hydratePersonnelDraft(found) {
  const isPresentedInOffer =
    found.presentacion_en_licitacion === true  ||
    found.presentacion_en_licitacion === "true" ||
    found.presented_in_offer === true           ||
    found.presented_in_offer === "true"         ||
    found.presentedInOffer === true             ||
    found.presentedInOffer === "true";

  const rawMunicipalityId =
    found.municipality_id ?? found.municipalityId ?? found.municipio_id ?? "";
  const rawMunicipalityName =
    found.municipality_name ?? found.municipalityName ?? found.municipality ?? found.municipio ?? "";
  const normalizedMunicipalityId = String(rawMunicipalityId || "").trim()
    || String(findOfficialMunicipality(rawMunicipalityName, { includeFallback: true })?.id || "");
  const normalizedMunicipalityName = normalizedMunicipalityId
    ? getPersonnelMunicipalityNameById(normalizedMunicipalityId)
    : getMunicipalityName(rawMunicipalityName, null, "");
  const normalizedExpeditionMunicipality = getNormalizedMunicipalityValue([
    found.expedition_municipality_name,
    found.expeditionMunicipalityName,
    found.municipio_expedicion,
    found.expeditionMunicipality,
  ], "");
  const normalizedBirthMunicipality = getNormalizedMunicipalityValue([
    found.birth_municipality_name,
    found.birthMunicipalityName,
    found.municipio_nacimiento,
    found.birthMunicipality,
  ], "");
  const normalizedResidenceMunicipality = getNormalizedMunicipalityValue([
    found.residence_municipality_name,
    found.residenceMunicipalityName,
    found.municipio_residencia,
    found.residenceMunicipality,
  ], "");

  const draft = {
    fullName: found.full_name || found.fullName || found.nombre || "",
    full_name: found.full_name || found.fullName || found.nombre || "",
    nombre_completo: found.nombre_completo || found.full_name || found.fullName || found.nombre || "",
    firstName:    found.primer_nombre  || found.firstName  || "",
    first_name:   found.primer_nombre  || found.first_name || found.firstName || "",
    primer_nombre: found.primer_nombre || found.first_name || found.firstName || "",
    secondName:   found.segundo_nombre || found.secondName || "",
    second_name:  found.segundo_nombre || found.second_name || found.secondName || "",
    segundo_nombre: found.segundo_nombre || found.second_name || found.secondName || "",
    firstLastName:  found.primer_apellido  || found.firstLastName  || "",
    first_last_name: found.primer_apellido || found.first_last_name || found.firstLastName || "",
    primer_apellido: found.primer_apellido || found.first_last_name || found.firstLastName || "",
    secondLastName: found.segundo_apellido || found.secondLastName || "",
    second_last_name: found.segundo_apellido || found.second_last_name || found.secondLastName || "",
    segundo_apellido: found.segundo_apellido || found.second_last_name || found.secondLastName || "",

    documentType:   found.tipo_documento  || found.documentType   || "",
    document_type:  found.tipo_documento  || found.document_type  || found.documentType || "",
    tipo_documento: found.tipo_documento  || found.document_type  || found.documentType || "",
    documentNumber: found.numero_documento || found.documentNumber || "",
    document_number: found.numero_documento || found.document_number || found.documentNumber || "",
    numero_documento: found.numero_documento || found.document_number || found.documentNumber || "",

    expeditionDay:        found.fecha_expedicion_dia  || found.expeditionDay        || "",
    expeditionMonth:      found.fecha_expedicion_mes  || found.expeditionMonth      || "",
    expeditionYear:       found.fecha_expedicion_anio || found.expeditionYear       || "",
    expeditionDepartment: found.departamento_expedicion || found.expeditionDepartment || "",
    expeditionMunicipality: normalizedExpeditionMunicipality,

    birthDay:        found.fecha_nacimiento_dia  || found.birthDay        || "",
    birthMonth:      found.fecha_nacimiento_mes  || found.birthMonth      || "",
    birthYear:       found.fecha_nacimiento_anio || found.birthYear       || "",
    birthCountry:    found.pais_nacimiento  || found.birthCountry  || "Colombia",
    birthDepartment: found.departamento_nacimiento || found.birthDepartment || "",
    birthMunicipality: normalizedBirthMunicipality,

    bloodType:    found.grupo_sanguineo || found.bloodType    || "",
    biologicalSex: found.sexo_biologico || found.biologicalSex || "",

    companyId:    found.company_id  || found.companyId  || "",
    contractId:   found.contract_id || found.contractId || "",
    municipalityId: normalizedMunicipalityId,
    municipality_id: normalizedMunicipalityId,
    municipalityName: normalizedMunicipalityName,
    municipality_name: normalizedMunicipalityName,

    presentedInOffer: isPresentedInOffer ? "true" : "false",
    offerPosition: isPresentedInOffer
      ? (found.cargo_presentado_en_licitacion || found.offered_position || found.offerPosition || "")
      : "",

    cargo_real: found.cargo_real || found.real_position || found.position || "",
    status:     found.estado     || found.status        || "",

    phone:              found.celular              || found.phone              || "",
    email:              found.correo_electronico   || found.email              || "",
    address:            found.direccion_residencia || found.address            || "",
    neighborhood:       found.barrio_residencia    || found.neighborhood       || "",
    residenceMunicipality: normalizedResidenceMunicipality,
    civilStatus:        found.estado_civil  || found.civilStatus  || "",
    residenceZone:      found.zona_residencia || found.residenceZone || "",

    educationalMunicipality: normalizedMunicipalityName,
    educational_municipality: normalizedMunicipalityName,
    institution:       found.institution || found.institutionName || found.institution_name || found.institucion_educativa || "",
    site:              found.site        || found.siteName        || found.site_name        || found.sede_educativa        || "",
    educationalModality: found.educationalModality || found.modality || found.modalidad || "",

    accountType:   found.accountType   || found.account_type   || "",
    bankName:      found.bankName      || found.bank_name      || "",
    accountNumber: found.accountNumber || found.account_number || "",

    contractType: found.contractType  || found.contract_type  || found.tipo_contrato || "",
    workTimeType: found.workTimeType  || found.work_time_type || found.workdayType   || found.workday_type || found.tipo_tiempo || "",

    shirtSize: found.shirtSize || found.shirt_size || "",
    pantsSize: found.pantsSize || found.pants_size || "",
    shoeSize:  found.shoeSize  || found.shoe_size  || "",

    startDate:           fmtDate(found.fecha_inicio_real  || found.startDate  || found.start_date),
    coverageStartDate:   fmtDate(found.coverageStartDate  || found.coverage_start_date || found.fecha_inicio_cobertura),
    arlVinculationDate:  fmtDate(found.arlVinculationDate || found.fecha_real_vinculacion_arl || found.arl_vinculation_date),
    terminationDate:     fmtDate(found.terminationDate    || found.fecha_retiro),
    hasTermination:      (found.terminationDate || found.fecha_retiro) ? "true" : "",

    eps:             found.eps             || "",
    pensionFund:     found.fondo_pensiones || found.pensionFund   || found.pension_fund  || "",
    compensationBox: found.caja_compensacion || found.compensationBox || found.compensation_box || "COFREM",
    arl:             found.arl             || "SURA",

    sisbenCategory:       found.sisben_categoria || found.sisbenCategory || "",
    sisbenIssueDate:      fmtDate(found.sisbenIssueDate  || found.sisben_issue_date || found.sisben_exp_date),
    sisbenExpirationDate: fmtDate(found.sisbenExpirationDate || found.sisben_expiration_date || found.sisben_expiry),
    sisben: (() => {
      const raw = found.sisben_tiene != null ? String(found.sisben_tiene) : (found.sisben != null ? String(found.sisben) : "");
      const cat = found.sisben_categoria || found.sisbenCategory || "";
      const iss = found.sisbenIssueDate  || found.sisben_issue_date || found.sisben_exp_date || "";
      return raw === "true" || !!cat || !!iss ? "true" : raw;
    })(),

    residenceCertificateIssueDate:
      fmtDate(found.residenceCertificateIssueDate || found.residence_certificate_issue_date),
    residenceCertificateExpiration:
      fmtDate(found.residenceCertificateExpiration || found.residence_certificate_expiration || found.residence_certificate_expiry),
    hasResidenceCertificate: (() => {
      const raw = found.hasResidenceCertificate || found.has_residence_certificate || "";
      const iss = found.residenceCertificateIssueDate || found.residence_certificate_issue_date || "";
      return raw === "true" || !!iss ? "true" : raw;
    })(),

    foodHandlingCourseIssueDate:
      fmtDate(found.foodHandlingCourseIssueDate || found.food_handling_course_issue_date),
    foodHandlingCourseExpirationDate:
      fmtDate(found.foodHandlingCourseExpirationDate || found.food_handling_course_expiration_date || found.food_handling_course_expiry_date),
    foodHandlingExamIssueDate:
      fmtDate(found.foodHandlingExamIssueDate || found.food_handling_exam_issue_date),
    foodHandlingExamExpirationDate:
      fmtDate(found.foodHandlingExamExpirationDate || found.food_handling_exam_expiration_date || found.food_handling_exam_expiry_date),

    studies:       Array.isArray(found.studies)       ? found.studies       : [],
    workExperience: Array.isArray(found.workExperience) ? found.workExperience : [],
    observations:  Array.isArray(found.observations)  ? found.observations  : [],
    internalNotes: found.observaciones_internas || found.internalNotes || "",

    gestorZona:          found.gestorZona          || found.gestor_zona          || "",
    auxiliarGestorZona:  found.auxiliarGestorZona   || found.auxiliar_gestor_zona  || "",
    hasAuxiliarGestor:   (found.auxiliarGestorZona  || found.auxiliar_gestor_zona) ? "true" : "",
    municipiosACargo:    found.municipiosACargo      || found.municipios_a_cargo    || "",
  };
  syncDraftOfficialMunicipality(draft);
  return draft;
}

// ── renderPersonnelTableModule ────────────────────────────────────────────────

export async function renderPersonnelTableModule() {
  await ensureOfficialMunicipalitiesLoaded().catch(() => {});
  if (!state.personnelFilters) {
    state.personnelFilters = { search: "", status: "ACTIVO", role: "", hvStatus: "", municipalityId: "",
      companyId: "", contractId: "", gestorZona: "", institution: "", site: "", modality: "", sort: "" };
  }
  if (!state.personnelPagination) {
    state.personnelPagination = { page: 1, pageSize: 25, total: 0, totalPages: 0 };
  }
  const f = state.personnelFilters;
  const pg = state.personnelPagination;
  const buildPersonnelListParams = ({ exportAll = false } = {}) => {
    const params = new URLSearchParams();
    params.set("page", exportAll ? "1" : String(pg.page || 1));
    params.set("pageSize", exportAll ? "5000" : String(pg.pageSize || 25));
    if (exportAll) params.set("export", "1");
    if (f.search) params.set("search", f.search);
    if (f.status) params.set("status", f.status);
    if (f.role) params.set("position", f.role);
    if (f.hvStatus) params.set("hvStatus", f.hvStatus);
    if (f.companyId) params.set("companyId", f.companyId);
    if (f.contractId) params.set("contractId", f.contractId);
    if (f.municipalityId) params.set("municipalityId", f.municipalityId);
    if (f.gestorZona) params.set("gestorZona", f.gestorZona);
    if (f.institution) params.set("institution", f.institution);
    if (f.site) params.set("site", f.site);
    if (f.modality) params.set("modality", f.modality);
    if (state.personnelTipo === "operarios") params.set("personnelType", "OPERARIO");
    if (state.personnelTipo === "equipo")    params.set("personnelType", "EQUIPO");
    return params;
  };

  const hasAnyFilter = !!(f.search || f.status || f.role || f.hvStatus || f.municipalityId ||
    f.companyId || f.contractId || f.gestorZona || f.institution || f.site || f.modality);

  let rows = [];
  let allDocuments = [];

  const _listParams = buildPersonnelListParams();

  let _total = 0;
  let _totalPages = 0;

  try {
    const payload = await apiFetch(`/personnel?${_listParams}`);
    if (payload.educationalCatalog && Object.keys(payload.educationalCatalog).length > 0) {
      state.educationalCatalog = payload.educationalCatalog;
    }
    rows = Array.isArray(payload.data) ? payload.data
      : Array.isArray(payload.personnel) ? payload.personnel : [];
    allDocuments = [];
    const payloadPagination = payload.pagination || {};
    _total = Number(payloadPagination.total || payload.total || rows.length);
    _totalPages = Number(payloadPagination.totalPages || Math.ceil(_total / (pg.pageSize || 25)) || 0);
    state.personnelPagination = {
      page: Number(payloadPagination.page || pg.page || 1),
      pageSize: Number(payloadPagination.pageSize || payload.pageSize || payload.limit || pg.pageSize || 25),
      total: _total,
      totalPages: _totalPages,
    };
  } catch (error) {
    return `<article class="info-card"><h3>Error en Gestión del Personal</h3><p>${escapeHtml(error.message)}</p></article>`;
  }

  if (!state.personnelDetailCache) state.personnelDetailCache = new Map();
  const getFullEmployee = async (id) => {
    const key = String(id || "");
    if (!key) return null;
    // Usar caché si ya existe el detalle completo
    if (state.personnelDetailCache.has(key)) {
      const cached = state.personnelDetailCache.get(key);
      console.log("[employee load]", { employeeId: key, source: "cache", employeeData: cached });
      return cached;
    }
    // Siempre obtener el detalle completo desde la API.
    // Las filas del listado omiten campos clave (modality, institution, site, etc.)
    // por lo que usarlas directamente deja el formulario con campos vacíos.
    const listFallback = rows.find((r) => String(r.id) === key) || null;
    try {
      const payload = await apiFetch(`/personnel/${encodeURIComponent(key)}`);
      const full = payload?.data || listFallback;
      console.log("[employee load]", { employeeId: key, source: "api", employeeData: full });
      if (full) state.personnelDetailCache.set(key, full);
      return full;
    } catch (err) {
      console.warn("[employee load] fallo API, usando fila del listado:", err.message);
      return listFallback;
    }
  };

  // ── Filtrar ───────────────────────────────────────────────────────────────
  const filteredRows = rows;

  // ── Ordenar ───────────────────────────────────────────────────────────────
  if (f.sort) {
    filteredRows.sort((a, b) => {
      if (f.sort === "nombre_az") return getPersonnelFullName(a).localeCompare(getPersonnelFullName(b), "es");
      if (f.sort === "nombre_za") return getPersonnelFullName(b).localeCompare(getPersonnelFullName(a), "es");
      if (f.sort === "cargo_az")  return getPersonnelRole(a).localeCompare(getPersonnelRole(b), "es");
      if (f.sort === "estado")    return getPersonnelWorkStatus(a).localeCompare(getPersonnelWorkStatus(b), "es");
      if (f.sort === "municipio") return getPersonnelMunicipality(a).localeCompare(getPersonnelMunicipality(b), "es");
      const getDate = (r) => r.startDate || r.start_date || r.fecha_inicio || "";
      if (f.sort === "fecha_desc") return getDate(b).localeCompare(getDate(a));
      if (f.sort === "fecha_asc")  return getDate(a).localeCompare(getDate(b));
      return 0;
    });
  }

  // ── Opciones de filtros ───────────────────────────────────────────────────
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const municipalityOptions  = getOperationalMunicipalityOptions();
  const roleOptions          = uniq([f.role, ...rows.map((r) => getPersonnelRole(r).trim())]);
  const gestorZonaOptions    = uniq([f.gestorZona, ...rows.map((r) => (r.gestorZona || r.gestor_zona || "").trim())]);
  const institutionOptions   = uniq([f.institution, ...rows.map((r) => (r.institution || r.institucion_educativa || r.institutionName || "").trim())]);
  const siteOptions          = uniq([f.site, ...rows.map((r) => (r.site || r.sede_educativa || r.siteName || "").trim())]);
  const modalityOptions      = uniq([f.modality, ...rows.map((r) => (r.educationalModality || r.modalidad || r.modality || "").trim())]);
  const companyOptions       = Array.from(new Map(
    rows
      .filter((r) => r.companyId || r.company_id)
      .map((r) => [String(r.companyId || r.company_id), getPersonnelCompanyLabel(r)])
  ).entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "es"));
  const contractOptions      = Array.from(new Map(
    rows
      .filter((r) => r.contractId || r.contract_id)
      .map((r) => [String(r.contractId || r.contract_id), getPersonnelContractLabel(r)])
  ).entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "es"));

  const opt = (val, current) =>
    `<option value="${escapeAttr(val)}" ${current === val ? "selected" : ""}>${escapeHtml(val)}</option>`;
  const optObj = ({ value, label }, current) =>
    `<option value="${escapeAttr(value)}" ${String(current) === String(value) ? "selected" : ""}>${escapeHtml(label)}</option>`;

  // ── KPIs ──────────────────────────────────────────────────────────────────
  if (!filteredRows.length) {
    state.personnelSelectedId = null;
  }

  const selectedEmployeeRow = state.personnelSelectedId === "__none__"
    ? null
    : filteredRows.find((item) => String(item.id) === String(state.personnelSelectedId)) || null;
  const selectedEmployee = selectedEmployeeRow
    ? state.personnelDetailCache?.get(String(selectedEmployeeRow.id)) || selectedEmployeeRow
    : null;
  const selectedEmployeeDossier = selectedEmployeeRow
    ? state.personnelDossierCache?.get(String(selectedEmployeeRow.id)) || null
    : null;
  const selectedEmployeeDocuments = selectedEmployeeRow
    ? (state.personnelEmployeeDocumentsCache?.has(String(selectedEmployeeRow.id))
      ? state.personnelEmployeeDocumentsCache.get(String(selectedEmployeeRow.id))
      : null)
    : null;
  const canSelectFirstEmployee = filteredRows.length > 0;

  // ── Listado de colaboradores ──────────────────────────────────────────────
  const listRows = filteredRows.length
    ? filteredRows.map((item) => buildPersonnelWorkspaceListItem(
        item,
        String(state.personnelSelectedId) === String(item.id),
        allDocuments
      )).join("")
    : `
      <div class="personnel-dossier-list-empty">
        ${escapeHtml(
          hasAnyFilter
            ? "No hay registros que coincidan con los filtros."
            : "No hay personal registrado."
        )}
      </div>
    `;

  // ── Event wiring (diferido) ───────────────────────────────────────────────
  setTimeout(() => {
    let searchTimer = null;

    const applyFilters = async () => {
      state.personnelFilters = {
        search:       document.getElementById("personnelSearch")?.value            || "",
        status:       document.getElementById("personnelFilterStatus")?.value      || "",
        role:         document.getElementById("personnelFilterRole")?.value        || "",
        hvStatus:     document.getElementById("personnelFilterHvStatus")?.value    || "",
        companyId:    document.getElementById("personnelFilterCompany")?.value     || "",
        contractId:   document.getElementById("personnelFilterContract")?.value    || "",
        municipalityId: document.getElementById("personnelFilterMunicipality")?.value || "",
        gestorZona:   document.getElementById("personnelFilterGestorZona")?.value  || "",
        institution:  document.getElementById("personnelFilterInstitution")?.value || "",
        site:         document.getElementById("personnelFilterSite")?.value        || "",
        modality:     document.getElementById("personnelFilterModality")?.value    || "",
        sort:         document.getElementById("personnelSort")?.value              || "",
      };
      state.personnelPagination = { ...(state.personnelPagination || {}), page: 1 };
      await openModule(state.activeModule || "gestion_personal");
    };

    ["personnelFilterStatus","personnelFilterRole","personnelFilterHvStatus",
     "personnelFilterMunicipality","personnelFilterGestorZona",
     "personnelFilterInstitution","personnelFilterSite","personnelFilterModality","personnelSort"]
      .forEach((id) => document.getElementById(id)?.addEventListener("change", applyFilters));

    const searchEl = document.getElementById("personnelSearch");
    if (searchEl) {
      searchEl.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyFilters, 400);
      });
    }


    document.getElementById("clearPersonnelFilters")?.addEventListener("click", async () => {
      state.personnelFilters = { search:"", status:"ACTIVO", role:"", hvStatus:"", municipalityId:"",
        companyId:"", contractId:"", gestorZona:"", institution:"", site:"", modality:"", sort:"" };
      state.personnelPagination = { page: 1, pageSize: state.personnelPagination?.pageSize || 25, total: 0, totalPages: 0 };
      state.personnelSelectedId = null;
      await openModule(state.activeModule || "gestion_personal");
    });

    document.getElementById("btnNewEmployee")?.addEventListener("click", async () => {
      state.personnelDraft          = {};
      state.personnelDraftBaselineData = clonePersonnelDraftSnapshot(state.personnelDraft);
      state.personnelDraftBaselineFingerprint = getPersonnelDraftFingerprint(state.personnelDraft);
      state.personnelSaveState      = "clean";
      state.personnelDossier        = null;
      state.personnelCreateTab      = "identificacion";
      state.personnelViewMode       = "create";
      state.personnelEditingId      = null;
      state.personnelSelectedId     = null;
      state.personnelDocumentsEmployee = null;
      await openModule(state.activeModule || "gestion_personal");
    });

    document.getElementById("btnExportPersonnel")?.addEventListener("click", async () => {
      try {
        const exportParams = buildPersonnelListParams({ exportAll: true });
        const payload = await apiFetch(`/personnel?${exportParams}`);
        const exportRows = Array.isArray(payload.data) ? payload.data : filteredRows;
        openExportPersonnelModal(exportRows);
      } catch (error) {
        showError(error.message || "No fue posible preparar la exportación.");
      }
    });

    document.getElementById("personnelPrevPage")?.addEventListener("click", async () => {
      const current = state.personnelPagination?.page || 1;
      if (current <= 1) return;
      state.personnelPagination = { ...(state.personnelPagination || {}), page: current - 1 };
      state.personnelSelectedId = null;
      await openModule(state.activeModule || "gestion_personal");
    });

    document.getElementById("personnelNextPage")?.addEventListener("click", async () => {
      const current = state.personnelPagination?.page || 1;
      const totalPages = state.personnelPagination?.totalPages || 0;
      if (totalPages && current >= totalPages) return;
      state.personnelPagination = { ...(state.personnelPagination || {}), page: current + 1 };
      state.personnelSelectedId = null;
      await openModule(state.activeModule || "gestion_personal");
    });

    document.getElementById("personnelPageSize")?.addEventListener("change", async (event) => {
      state.personnelPagination = {
        ...(state.personnelPagination || {}),
        page: 1,
        pageSize: Number(event.target.value) || 25,
      };
      state.personnelSelectedId = null;
      await openModule(state.activeModule || "gestion_personal");
    });

    document.getElementById("btnImportPersonnel")?.addEventListener("click", () => {
      openSafeImportPersonnelModal();
    });

    document.getElementById("btnBulkUpdatePersonnel")?.addEventListener("click", () => {
      openBulkUpdatePersonnelModal();
    });

    const openEmployeeCv = async (employeeId) => {
      const found = await getFullEmployee(employeeId);
      if (!found) return;
      state.personnelDraft = hydratePersonnelDraft(found);
      state.personnelDossier = null;
      state.personnelViewMode = "cv";
      state.personnelEditingId = found.id || null;
      state.personnelSelectedId = found.id || null;
      await openModule(state.activeModule || "gestion_personal");
    };

    const openEmployeeDocuments = async (employeeId) => {
      const found = await getFullEmployee(employeeId);
      if (!found) return;
      state.personnelDraft = hydratePersonnelDraft(found);
      state.personnelDossier = null;
      state.personnelViewMode = "documents";
      state.personnelEditingId = found.id || null;
      state.personnelSelectedId = found.id || null;
      state.personnelDocumentsEmployee = found;
      await openModule(state.activeModule || "gestion_personal");
    };

    const openEmployeeEditor = async (employeeId) => {
      const [found, dossier] = await Promise.all([
        getFullEmployee(employeeId),
        getEmployeeDossierPayload(employeeId, { force: true }).catch(() => null),
      ]);
      if (!found) return;
      state.personnelDraft = hydratePersonnelDraft(found);
      state.personnelDraftBaselineData = clonePersonnelDraftSnapshot(state.personnelDraft);
      state.personnelDraftBaselineFingerprint = getPersonnelDraftFingerprint(state.personnelDraft);
      state.personnelSaveState = "clean";
      state.personnelDossier = dossier;
      state.personnelCreateTab = "identificacion";
      state.personnelViewMode = "edit";
      state.personnelEditingId = found.id || null;
      state.personnelSelectedId = "__none__";
      state.personnelDocumentsEmployee = null;
      state.personnelSavedTabs = null;
      await openModule(state.activeModule || "gestion_personal");
    };

    document.querySelectorAll("[data-cv-personnel-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await openEmployeeCv(btn.dataset.cvPersonnelId);
      });
    });

    document.querySelectorAll("[data-edit-personnel-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await openEmployeeEditor(btn.dataset.editPersonnelId);
      });
    });

    document.querySelectorAll("[data-documents-personnel-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await openEmployeeDocuments(btn.dataset.documentsPersonnelId);
      });
    });

    document.querySelectorAll("[data-delete-personnel-id]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openDeleteEmployeeModal(btn.dataset.deletePersonnelId, btn.dataset.deletePersonnelName);
      });
    });

    const pnlShellEl  = document.getElementById("personnelWorkspaceRoot");
    const pnlDetailEl = document.getElementById("pnlDetail");
    const renderDetail = (employee, dossier, documents = null) => {
      if (!pnlDetailEl) return;
      pnlDetailEl.innerHTML = buildPersonnelDetailPanel(employee, documents, dossier, { canSelectFirst: canSelectFirstEmployee });
      wireDetail(pnlDetailEl);
    };

    const closeDetail = () => {
      state.personnelSelectedId = "__none__";
      pnlShellEl?.classList.remove("detail-open");
      renderDetail(null, null, null);
      document.querySelectorAll("[data-select-personnel-id]").forEach((row) => row.classList.remove("selected"));
    };

    const wireDetail = (container) => {
      container.querySelectorAll("[data-clear-personnel-selection]").forEach((btn) =>
        btn.addEventListener("click", closeDetail));

      container.querySelectorAll("[data-open-first-personnel]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          const firstRow = document.querySelector("[data-select-personnel-id]");
          if (!firstRow?.dataset.selectPersonnelId) return;
          await selectEmployee(firstRow.dataset.selectPersonnelId);
        }));

      // Photo upload
      container.querySelectorAll("[data-photo-upload-id]").forEach((wrap) => {
        const input = wrap.querySelector(".cv-photo-input");
        if (!input) return;
        wrap.addEventListener("click", () => input.click());
        input.addEventListener("change", async () => {
          const file = input.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async (e) => {
            const photoUrl = e.target.result;
            try {
              await apiFetch("/personnel/photo", { method: "PATCH", body: JSON.stringify({ id: wrap.dataset.photoUploadId, photoUrl }) });
              // Replace avatar in the detail panel
              const imgWrap = wrap.querySelector(".cv-photo-img, .cv-photo-initials");
              if (imgWrap) {
                const img = document.createElement("img");
                img.src = photoUrl; img.alt = "Foto"; img.className = "cv-photo-img";
                imgWrap.replaceWith(img);
              }
              // Update in-memory row so CV view and re-renders show the new photo
              const empRow = rows.find(r => String(r.id) === String(wrap.dataset.photoUploadId));
              if (empRow) empRow.photoUrl = photoUrl;
              // Also update any table avatar chips that may show initials
              document.querySelectorAll(`[data-row-photo-id="${wrap.dataset.photoUploadId}"]`).forEach(el => {
                el.style.backgroundImage = `url(${photoUrl})`;
                el.textContent = "";
              });
              showSuccess("Foto actualizada correctamente.", "Foto de perfil");
            } catch (err) {
              console.error("Error subiendo foto:", err.message);
              showError(err.message || "No fue posible subir la foto.");
            }
          };
          reader.readAsDataURL(file);
        });
      });
      container.querySelectorAll("[data-edit-personnel-id]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await openEmployeeEditor(btn.dataset.editPersonnelId);
        });
      });
      container.querySelectorAll("[data-documents-personnel-id]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await openEmployeeDocuments(btn.dataset.documentsPersonnelId);
        });
      });
      container.querySelectorAll("[data-cv-personnel-id]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await openEmployeeCv(btn.dataset.cvPersonnelId);
        });
      });

      container.querySelectorAll("[data-expediente-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tab = btn.dataset.expedienteTab;
          state.personnelWorkspaceTab = tab;
          container.querySelectorAll("[data-expediente-tab]").forEach((tabBtn) => {
            tabBtn.classList.toggle("active", tabBtn.dataset.expedienteTab === tab);
          });
          container.querySelectorAll("[data-expediente-panel]").forEach((panel) => {
            panel.classList.toggle("active", panel.dataset.expedientePanel === tab);
          });
        });
      });

      container.querySelectorAll(".personnel-payroll-slips-shell[data-slips-employee-id]").forEach((shell) => {
        const empId = shell.dataset.slipsEmployeeId;
        if (!empId) return;
        fetch(`/payroll/employees/${encodeURIComponent(empId)}/slips`)
          .then((r) => r.json())
          .then(({ ok, data }) => {
            if (!ok || !Array.isArray(data) || !data.length) {
              shell.innerHTML = `<div class="personnel-expediente-empty">Sin desprendibles de nómina registrados.</div>`;
              return;
            }
            const fmtDate = (d) => d ? new Date(d).toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric" }) : "—";
            shell.innerHTML = `<div class="personnel-payroll-slips-list">${data.map((s) => `
              <article class="personnel-payroll-slip-row">
                <div class="personnel-payroll-slip-info">
                  <strong>${escapeHtml(s.period_label || "Período")}</strong>
                  <span>${escapeHtml(fmtDate(s.period_start))} – ${escapeHtml(fmtDate(s.period_end))}</span>
                </div>
                <div class="personnel-payroll-slip-amount">
                  <span>Neto a pagar</span>
                  <strong>${escapeHtml(formatCurrencyValue(s.neto_pagar))}</strong>
                </div>
                <button type="button" class="btn btn-sm btn-outline"
                  data-print-slip-employee="${escapeAttr(String(empId))}"
                  data-print-slip-period="${escapeAttr(String(s.period_id))}">Imprimir</button>
              </article>
            `).join("")}</div>`;
            shell.querySelectorAll("[data-print-slip-period]").forEach((btn) => {
              btn.addEventListener("click", async () => {
                const periodId = btn.dataset.printSlipPeriod;
                const employeeIdBtn = btn.dataset.printSlipEmployee;
                try {
                  const resp = await fetch(`/payroll/employees/${encodeURIComponent(employeeIdBtn)}/slip?periodId=${periodId}`);
                  const { ok: slipOk, data: slipData } = await resp.json();
                  if (!slipOk || !slipData) { alert("No se pudo cargar el desprendible."); return; }
                  const pp = slipData.period || {};
                  const sl = slipData.slip || {};
                  const win = window.open("", "_blank", "width=960,height=720");
                  if (!win) { alert("El navegador bloqueó la ventana emergente."); return; }
                  win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
                    <title>Desprendible ${escapeHtml(pp.label || "")}</title>
                    <style>body{font-family:Arial,sans-serif;font-size:13px;padding:24px;max-width:680px;margin:auto}
                    h2{font-size:15px;margin:0 0 4px}p{margin:2px 0 12px;color:#555}
                    table{width:100%;border-collapse:collapse;margin-top:8px}
                    td,th{padding:6px 10px;border:1px solid #d1d5db}th{background:#f1f5f9;text-align:left;font-weight:600}
                    .total td{font-weight:700;background:#f0fdf4}
                    @media print{@page{margin:1.5cm}}</style></head><body>
                    <h2>Desprendible de pago — ${escapeHtml(pp.label || "")}</h2>
                    <p>${escapeHtml(sl.employeeName || "")} · CC ${escapeHtml(sl.documentNumber || "")}</p>
                    <table>
                      <tr><th>Concepto</th><th style="text-align:right">Valor</th></tr>
                      <tr><td>Salario base mensual</td><td style="text-align:right">${escapeHtml(formatCurrencyValue(sl.baseSalaryMonthly || sl.baseSalary))}</td></tr>
                      <tr><td>Días trabajados</td><td style="text-align:right">${escapeHtml(String(sl.workedDays ?? ""))}</td></tr>
                      <tr><td>Salario proporcional</td><td style="text-align:right">${escapeHtml(formatCurrencyValue(sl.baseEarned || sl.baseSalary))}</td></tr>
                      <tr><td>Aux. de transporte</td><td style="text-align:right">${escapeHtml(formatCurrencyValue(sl.transportAllowance))}</td></tr>
                      <tr><td>Otros devengados</td><td style="text-align:right">${escapeHtml(formatCurrencyValue(sl.otherEarnings))}</td></tr>
                      <tr><td><strong>Total devengado</strong></td><td style="text-align:right"><strong>${escapeHtml(formatCurrencyValue(sl.totalDevengado))}</strong></td></tr>
                      <tr><td>Deducción salud (4%)</td><td style="text-align:right">–${escapeHtml(formatCurrencyValue(sl.deduccionSalud))}</td></tr>
                      <tr><td>Deducción pensión (4%)</td><td style="text-align:right">–${escapeHtml(formatCurrencyValue(sl.deduccionPension))}</td></tr>
                      <tr><td>Novedades / descuentos</td><td style="text-align:right">–${escapeHtml(formatCurrencyValue(sl.novedadDescuento))}</td></tr>
                      <tr class="total"><td>Neto a pagar</td><td style="text-align:right">${escapeHtml(formatCurrencyValue(sl.netoPagar))}</td></tr>
                    </table>
                    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400))<\/script>
                    </body></html>`);
                  win.document.close();
                } catch {
                  alert("No se pudo cargar el desprendible.");
                }
              });
            });
          })
          .catch(() => {
            shell.innerHTML = `<div class="personnel-expediente-empty">No se pudo consultar los desprendibles.</div>`;
          });
      });
    };

    const selectEmployee = async (employeeId) => {
      const key = String(employeeId || "").trim();
      if (!key) return;
      state.personnelSelectedId = key;
      document.querySelectorAll("[data-select-personnel-id]").forEach((row) => {
        row.classList.toggle("selected", row.dataset.selectPersonnelId === key);
      });
      pnlShellEl?.classList.add("detail-open");

      const fallback = filteredRows.find((row) => String(row.id) === key) || rows.find((row) => String(row.id) === key) || null;
      const cachedEmployee = state.personnelDetailCache?.get(key) || fallback;
      const cachedDossier = state.personnelDossierCache?.get(key) || null;
      const cachedDocuments = state.personnelEmployeeDocumentsCache?.has(key)
        ? state.personnelEmployeeDocumentsCache.get(key)
        : null;
      renderDetail(cachedEmployee || fallback, cachedDossier, cachedDocuments);

      try {
        const [found, dossier, documents] = await Promise.all([
          getFullEmployee(key),
          getEmployeeDossierPayload(key).catch(() => null),
          getEmployeeDocumentsCollection(key).catch(() => cachedDocuments),
        ]);
        if (String(state.personnelSelectedId) !== key) return;
        renderDetail(found || cachedEmployee || fallback, dossier || cachedDossier, documents || cachedDocuments);
      } catch {
        if (String(state.personnelSelectedId) !== key) return;
        renderDetail(cachedEmployee || fallback, cachedDossier, cachedDocuments);
      }
    };

    document.querySelectorAll("[data-select-personnel-id]").forEach((row) => {
      row.addEventListener("click", async () => {
        await selectEmployee(row.dataset.selectPersonnelId);
      });
    });

    // Wire buttons inside the initially-rendered detail panel (pre-selected employee)
    if (pnlDetailEl) {
      wireDetail(pnlDetailEl);
    }
    if (selectedEmployeeRow && (!state.personnelDetailCache?.has(String(selectedEmployeeRow.id)) || !state.personnelDossierCache?.has(String(selectedEmployeeRow.id)))) {
      void selectEmployee(selectedEmployeeRow.id);
    }
  }, 0);

  // ── Context banner for non-admin users ───────────────────────────────────
  const cu = state.currentUser;
  const isAdmin = (cu?.role || "").toLowerCase() === "administrador";
  const isDemoU = !isAdmin && !cu?.companyId && !cu?.contractId;
  let contextBanner = "";
  if (isDemoU) {
    contextBanner = `<div class="personnel-demo-banner">
      <strong>Modo Demo</strong> — No hay datos de empresa asignada. Los módulos funcionan con información vacía para previsualización.
    </div>`;
  } else if (!isAdmin && cu?.companyId) {
    const cLabel = (state.companies.find((c) => c.id === Number(cu.companyId))?.name) || `Empresa #${cu.companyId}`;
    const ctLabel = (state.contracts.find((c) => c.id === Number(cu.contractId))?.name) || (cu.contractId ? `Contrato #${cu.contractId}` : "");
    contextBanner = `<div class="personnel-ctx-banner">
      <span class="personnel-ctx-item"><span class="personnel-ctx-lbl">Empresa</span>${escapeHtml(cLabel)}</span>
      ${ctLabel ? `<span class="personnel-ctx-sep">|</span><span class="personnel-ctx-item"><span class="personnel-ctx-lbl">Contrato</span>${escapeHtml(ctLabel)}</span>` : ""}
    </div>`;
  }

  const currentPagination = state.personnelPagination || {};
  const currentPage = Number(currentPagination.page || 1);
  const currentPageSize = Number(currentPagination.pageSize || 25);
  const totalPages = Number(currentPagination.totalPages || _totalPages || 0);
  const pageStart = _total ? ((currentPage - 1) * currentPageSize) + 1 : 0;
  const pageEnd = _total ? Math.min(_total, pageStart + rows.length - 1) : 0;
  const visibleCount = rows.length || 0;
  const totalCount = Number(_total || 0);

  // ── HTML ──────────────────────────────────────────────────────────────────
  return `
    <div class="personnel-master-module personnel-workspace-shell personnel-dossier-shell pnl-shell${selectedEmployee ? " detail-open" : ""}" id="personnelWorkspaceRoot">

      ${contextBanner}

      <!-- 1. Acciones + Búsqueda + Filtros -->
      <section class="pnl-controls">
        <div class="pnl-actions">
          <button type="button" id="btnNewEmployee" class="btn btn-primary">+ Nuevo empleado</button>
          <button type="button" id="btnImportPersonnel" class="btn btn-secondary">Importar Excel</button>
          <button type="button" id="btnBulkUpdatePersonnel" class="btn btn-secondary">Actualizar por Excel</button>
          <button type="button" id="btnExportPersonnel" class="btn btn-secondary">Exportar</button>
          <input id="personnelSearch" type="text" class="pnl-search-input"
            placeholder="Buscar por nombre, documento o cargo"
            value="${escapeAttr(f.search)}" />
        </div>
        <div class="pnl-filters-row">
          <select id="personnelFilterStatus">
            <option value="">Todos</option>
            ${ESTADOS_PERSONAL.map((v) => opt(v, f.status)).join("")}
            <option value="INACTIVO" ${f.status === "INACTIVO" ? "selected" : ""}>INACTIVO</option>
            <option value="RETIRADO" ${f.status === "RETIRADO" ? "selected" : ""}>RETIRADO</option>
          </select>
          <select id="personnelFilterRole">
            <option value="">Cargo</option>
            ${roleOptions.map((v) => opt(v, f.role)).join("")}
          </select>
          <select id="personnelFilterHvStatus">
            <option value="">Documentación</option>
            ${["Completa","Incompleta","En revisión","No apto documental"].map((v) => opt(v, f.hvStatus)).join("")}
          </select>
          <select id="personnelFilterMunicipality">
            <option value="">Municipio</option>
            ${municipalityOptions.map((item) => optObj({ value: item.id, label: item.name }, f.municipalityId)).join("")}
          </select>
          <select id="personnelFilterGestorZona">
            <option value="">Gestor de Zona</option>
            ${gestorZonaOptions.map((v) => opt(v, f.gestorZona)).join("")}
          </select>
          <select id="personnelFilterInstitution">
            <option value="">Institución</option>
            ${institutionOptions.map((v) => opt(v, f.institution)).join("")}
          </select>
          <select id="personnelFilterSite">
            <option value="">Sede</option>
            ${siteOptions.map((v) => opt(v, f.site)).join("")}
          </select>
          <select id="personnelFilterModality">
            <option value="">Modalidad</option>
            ${modalityOptions.map((v) => opt(v, f.modality)).join("")}
          </select>
          <select id="personnelSort">
            <option value="">Ordenar por...</option>
            ${[
              ["nombre_az","Nombre A-Z"],["nombre_za","Nombre Z-A"],
              ["cargo_az","Cargo A-Z"],["estado","Estado"],["municipio","Municipio"],
              ["fecha_desc","Ingreso (reciente)"],["fecha_asc","Ingreso (antiguo)"],
            ].map(([v, l]) => `<option value="${v}" ${f.sort === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
          <button type="button" id="clearPersonnelFilters"
            class="btn btn-secondary btn-icon-only personnel-clear-btn" title="Limpiar filtros">Limpiar</button>
        </div>
      </section>

      <!-- 2. Workspace de expediente -->
      <section class="personnel-dossier-body" id="pnlBody">
        <aside class="personnel-dossier-list-panel">
          <div class="personnel-dossier-list-panel-head">
            <div>
              <p>Colaboradores</p>
              <h3>Listado de expedientes</h3>
              <span class="personnel-dossier-list-count">${visibleCount} visibles / ${totalCount} total</span>
            </div>
          </div>

          <div class="personnel-dossier-list-shell">
            <div class="personnel-dossier-list-scroll">
              ${listRows}
            </div>
          </div>

          <div class="personnel-pagination personnel-dossier-pagination">
            <span class="personnel-dossier-page-info">${pageStart}-${pageEnd} de ${_total || 0}</span>
            <select id="personnelPageSize" class="personnel-dossier-page-size">
              ${[25, 50, 100].map((size) => `<option value="${size}" ${currentPageSize === size ? "selected" : ""}>${size}</option>`).join("")}
            </select>
            <button type="button" id="personnelPrevPage" class="btn btn-secondary personnel-dossier-page-btn" ${currentPage <= 1 ? "disabled" : ""}>Anterior</button>
            <span class="personnel-dossier-page-info">Página ${currentPage} de ${totalPages || 1}</span>
            <button type="button" id="personnelNextPage" class="btn btn-secondary personnel-dossier-page-btn" ${totalPages && currentPage >= totalPages ? "disabled" : ""}>Siguiente</button>
          </div>
        </aside>

        <section class="pnl-detail personnel-dossier-detail-panel" id="pnlDetail">
          ${buildPersonnelDetailPanel(selectedEmployee, selectedEmployeeDocuments, selectedEmployeeDossier, { canSelectFirst: canSelectFirstEmployee })}
        </section>
      </section>
    </div>
  `;
}

// ─── Part 9: handlePersonnelFormSubmit ───────────────────────────────────────

// Tabs en orden. Los que preceden a "vinculacion" solo guardan borrador y avanzan.
const _TAB_ORDER = [
  "identificacion",
  "datos_generales",
  "vinculacion_laboral",
  "historial_observaciones",
];
const _PRE_SUBMIT_TABS = new Set(["identificacion", "datos_generales", "vinculacion_laboral"]);

export async function handlePersonnelFormSubmit(event) {
  event.preventDefault();

  const isCreate = state.personnelViewMode !== "edit";
  const currentTab = normalizePersonnelTabKey(state.personnelCreateTab || "identificacion");
  state.personnelCreateTab = currentTab;

  // En modo creación, tabs pre-vinculación guardan en borrador y avanzan a la siguiente.
  if (isCreate && _PRE_SUBMIT_TABS.has(currentTab)) {
    // Validaciones mínimas de la pestaña Identificación
    if (currentTab === "identificacion") {
      const d = state.personnelDraft;
      if (!String(d.firstName || "").trim() || !String(d.firstLastName || "").trim()) {
        showWarning("El nombre y apellido son obligatorios.");
        return;
      }
      if (!String(d.documentNumber || "").trim()) {
        showWarning("El número de documento es obligatorio.");
        return;
      }
    }
    // Marcar tab actual como guardado y avanzar a la siguiente
    if (!state.personnelSavedTabs) state.personnelSavedTabs = new Set();
    state.personnelSavedTabs.add(currentTab);
    const nextIdx = _TAB_ORDER.indexOf(currentTab) + 1;
    state.personnelCreateTab = _TAB_ORDER[nextIdx] || currentTab;
    _refreshPersonnelSection();
    return;
  }

  if (state.personnelViewMode === "edit") {
    const confirmed = await showPersonnelConfirmDialog();
    if (!confirmed) return;
  }

  const d = state.personnelDraft;

  if (!String(d.firstName || "").trim() || !String(d.firstLastName || "").trim()) {
    showWarning("El nombre y apellido del empleado son obligatorios (pestaña Identificación).");
    return;
  }
  if (!String(d.documentNumber || "").trim()) {
    showWarning("El número de documento es obligatorio (pestaña Identificación).");
    return;
  }
  if (d.presentedInOffer === "true" && !d.offerPosition) {
    showWarning("Selecciona el cargo presentado en la oferta (pestaña Licitación).");
    return;
  }
  if (d.sisben === "true" && (!d.sisbenIssueDate || !d.sisbenExpirationDate)) {
    showWarning("Completa las fechas del SISBEN (pestaña Seguimiento).");
    return;
  }
  if (d.hasResidenceCertificate === "true" && (!d.residenceCertificateIssueDate || !d.residenceCertificateExpiration)) {
    showWarning("Completa las fechas del certificado de residencia (pestaña Seguimiento).");
    return;
  }

  if (String(d.gestorZona || "").trim()) {
    if (!String(d.municipalityId || "").trim()) {
      showWarning("Debes seleccionar un municipio antes de asignar gestor.");
      return;
    }
    const validGestores = _cachedPayload?.gestorNames || [];
    if (!validGestores.includes(String(d.gestorZona).trim())) {
      showWarning(validGestores.length
        ? "El gestor seleccionado no corresponde al municipio elegido."
        : "No hay gestores asignados a este municipio.");
      return;
    }
  }
  if (String(d.auxiliarGestorZona || "").trim()) {
    const validAuxiliares = _cachedPayload?.auxiliarGestorNames || [];
    if (!validAuxiliares.includes(String(d.auxiliarGestorZona).trim())) {
      showWarning(validAuxiliares.length
        ? "El auxiliar de gestor seleccionado no corresponde al municipio elegido."
        : "No hay auxiliares de gestor asignados a este municipio.");
      return;
    }
  }

  // Municipio laboral requerido al finalizar la creación
  if (!String(d.municipalityId || d.municipality_id || "").trim()) {
    showWarning("Debe seleccionar el municipio de vinculación (pestaña Vinculación).");
    state.personnelCreateTab = "vinculacion_laboral";
    _refreshPersonnelSection();
    return;
  }

  syncDraftOfficialMunicipality(d);

  const payload = {
    // Identificación
    firstName:              d.firstName              || "",
    secondName:             d.secondName             || "",
    firstLastName:          d.firstLastName          || "",
    secondLastName:         d.secondLastName         || "",
    documentType:           d.documentType           || "",
    documentNumber:         d.documentNumber         || "",
    expeditionDay:          d.expeditionDay          || "",
    expeditionMonth:        d.expeditionMonth        || "",
    expeditionYear:         d.expeditionYear         || "",
    expeditionDepartment:   d.expeditionDepartment   || "",
    expeditionMunicipality: d.expeditionMunicipality || "",
    birthDay:               d.birthDay               || "",
    birthMonth:             d.birthMonth             || "",
    birthYear:              d.birthYear              || "",
    birthCountry:           d.birthCountry           || "",
    birthDepartment:        d.birthDepartment        || "",
    birthMunicipality:      d.birthMunicipality      || "",
    bloodType:              d.bloodType              || "",
    biologicalSex:          d.biologicalSex          || "",

    // Vinculación
    companyId:    d.companyId    || "",
    contractId:   d.contractId   || "",
    accountType:   d.accountType   || "",
    bankName:      d.bankName      || "",
    accountNumber: d.accountNumber || "",
    municipalityId:
      document.querySelector('#personnelForm [name="municipalityId"]')?.value ||
      d.municipalityId || "",
    municipality_id:
      document.querySelector('#personnelForm [name="municipalityId"]')?.value ||
      d.municipality_id || d.municipalityId || "",

    // Licitación
    presentedInOffer: d.presentedInOffer || "",
    offerPosition:    d.offerPosition    || "",
    cargo_real:       d.cargo_real       || "",
    status:           (d.hasTermination === "true" && d.terminationDate) ? "INACTIVO" : "ACTIVO",

    // Datos personales
    phone:                d.phone                || "",
    email:                d.email                || "",
    civilStatus:          d.civilStatus          || "",
    neighborhood:         d.neighborhood         || "",
    address:              d.address              || "",
    residenceMunicipality: d.residenceMunicipality || "",
    residenceZone:        d.residenceZone        || "",

    // Institucional
    educationalMunicipality: getDraftMunicipalityName(d),
    institution:             d.institution             || "",
    site:                    d.site                    || "",
    educationalModality:     d.educationalModality     || "",

    // Contratación
    shirtSize: d.shirtSize || "",
    pantsSize: d.pantsSize || "",
    shoeSize:  d.shoeSize  || "",
    contractType:    d.contractType    || "",
    workTimeType:
      document.querySelector('#personnelForm [name="workTimeType"]')?.value ||
      d.workTimeType || "",
    startDate:          d.startDate          || "",
    coverageStartDate:  d.coverageStartDate  || "",
    terminationDate:    d.hasTermination === "true" ? (d.terminationDate || "") : "",
    eps:                d.eps                || "",
    pensionFund:        d.pensionFund        || "",
    compensationBox:    d.compensationBox    || "",
    arl:                d.arl                || "",

    // Manipulación de alimentos
    foodHandlingCourseIssueDate:      d.foodHandlingCourseIssueDate      || "",
    foodHandlingCourseExpirationDate: d.foodHandlingCourseExpirationDate || "",
    foodHandlingExamIssueDate:        d.foodHandlingExamIssueDate        || "",
    foodHandlingExamExpirationDate:   d.foodHandlingExamExpirationDate   || "",

    // Seguimiento
    sisben:                         d.sisben                         || "",
    sisbenCategory:                 d.sisbenCategory                 || "",
    sisbenIssueDate:                d.sisbenIssueDate                || "",
    sisbenExpirationDate:           d.sisbenExpirationDate           || "",
    hasResidenceCertificate:        d.hasResidenceCertificate        || "",
    residenceCertificateIssueDate:  d.residenceCertificateIssueDate  || "",
    residenceCertificateExpiration: d.residenceCertificateExpiration || "",

    // Dinámicos
    studies:       d.studies       || [],
    workExperience: d.workExperience || [],

    // Observaciones
    observations: d.observations || [],
    internalNotes: d.internalNotes || "",

    // Gestión
    gestorZona:         d.gestorZona         || "",
    auxiliarGestorZona: d.auxiliarGestorZona || "",
    municipiosACargo:   d.municipiosACargo   || "",
  };

  const isEdit = state.personnelViewMode === "edit" && state.personnelEditingId;
  if (isEdit) payload.id = state.personnelEditingId;

  console.log("[employee save]", {
    employeeId:      state.personnelEditingId,
    payloadReceived: {
      educationalModality: payload.educationalModality,
      institution:         payload.institution,
      site:                payload.site,
      municipalityId:      payload.municipalityId,
      workTimeType:        payload.workTimeType,
      gestorZona:          payload.gestorZona,
      contractType:        payload.contractType,
    },
    payloadSaved: payload,
  });

  try {
    await apiFetch("/personnel", {
      method: isEdit ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });

    if (isEdit) {
      // Invalidar caché del empleado para que la próxima apertura de "Editar"
      // siempre obtenga los datos actualizados desde la API.
      if (state.personnelDetailCache) {
        state.personnelDetailCache.delete(String(state.personnelEditingId));
      }
      if (state.personnelDossierCache) {
        state.personnelDossierCache.delete(String(state.personnelEditingId));
      }
      // Re-fetch inmediato para actualizar el draft con los datos confirmados por el servidor
      try {
        const [freshPayload, freshDossier] = await Promise.all([
          apiFetch(`/personnel/${encodeURIComponent(state.personnelEditingId)}`),
          getEmployeeDossierPayload(state.personnelEditingId, { force: true }).catch(() => null),
        ]);
        const freshData = freshPayload?.data || null;
        console.log("[employee load]", { employeeId: state.personnelEditingId, source: "post-save", employeeData: freshData });
        if (freshData) {
          if (state.personnelDetailCache) {
            state.personnelDetailCache.set(String(state.personnelEditingId), freshData);
          }
          state.personnelDraft = hydratePersonnelDraft(freshData);
          state.personnelDraftBaselineData = clonePersonnelDraftSnapshot(state.personnelDraft);
          state.personnelDraftBaselineFingerprint = getPersonnelDraftFingerprint(state.personnelDraft);
        }
        state.personnelDossier = freshDossier;
      } catch (refreshErr) {
        // No bloquear el flujo si falla la recarga — el draft actual ya tiene los valores
        console.warn("[employee load] No se pudo recargar tras guardar:", refreshErr.message);
      }
      state.personnelSaveState = "saved";
      showSuccess("Los datos del empleado han sido actualizados.", "Empleado actualizado");
      if (!state.personnelSavedTabs) state.personnelSavedTabs = new Set();
      state.personnelSavedTabs.add(state.personnelCreateTab);
      _refreshPersonnelSection();
    } else {
      showSuccess("El empleado fue registrado en el sistema.", "Empleado creado");
      state.personnelDraft          = {};
      state.personnelDraftBaselineData = clonePersonnelDraftSnapshot(state.personnelDraft);
      state.personnelDraftBaselineFingerprint = getPersonnelDraftFingerprint(state.personnelDraft);
      state.personnelSaveState      = "saved";
      state.personnelDossier        = null;
      state.personnelSavedTabs      = null;
      state.personnelCreateTab      = "identificacion";
      state.personnelViewMode       = "table";
      state.personnelEditingId      = null;
      state.personnelDocumentsEmployee = null;
      const _personnelModule = state.activeModule || "gestion_personal";
      state.activeModule    = _personnelModule;
      state.expandedModule  = _personnelModule;
      state.activeSubmodule = null;
      await openModule(_personnelModule);
    }
  } catch (error) {
    showError(error.message || "Ocurrió un error inesperado.");
  }
}

// ─── Part 10: loadEmployeeDocumentsModule + renderPersonnelCvModule ───────────

function _getRequiredDocsByEmployee(employee) {
  const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

  const isPresented =
    employee.presentacion_en_licitacion === true ||
    employee.presentacion_en_licitacion === "true" ||
    employee.presented_in_offer === true ||
    employee.presented_in_offer === "true" ||
    employee.presentedInOffer === true ||
    employee.presentedInOffer === "true";

  const offerPos = norm(
    employee.cargo_presentado_en_licitacion || employee.offered_position ||
    employee.offerPosition || employee.offer_position
  );
  const realPos = norm(
    employee.cargo_real || employee.real_position || employee.position || employee.cargo
  );
  const position = isPresented ? offerPos : realPos;

  const doc = (name, opts = {}) => ({
    name,
    required: opts.required !== false,
    issueDateRequired: !!opts.issueDateRequired,
    expirationDateRequired: !!opts.expirationDateRequired,
    group: opts.group || "GENERAL",
  });

  const BASE = [
    doc("CEDULA", { group: "IDENTIFICACION" }),
    doc("HOJA DE VIDA", { group: "IDENTIFICACION" }),
    doc("EXPERIENCIA LABORAL", { group: "SOPORTE" }),
    doc("AUTORIZACION DE DATOS PERSONALES", { group: "AUTORIZACIONES" }),
    doc("AUTORIZACION DE CONSULTA DE INHABILIDADES", { group: "AUTORIZACIONES" }),
  ];

  const ANTECEDENTES = [
    doc("CONTRALORIA",                    { issueDateRequired: true, expirationDateRequired: true, group: "ANTECEDENTES" }),
    doc("PROCURADURIA",                   { issueDateRequired: true, expirationDateRequired: true, group: "ANTECEDENTES" }),
    doc("ANTECEDENTES JUDICIALES",        { issueDateRequired: true, expirationDateRequired: true, group: "ANTECEDENTES" }),
    doc("ANTECEDENTES DE MEDIDAS CORRECTIVAS", { issueDateRequired: true, expirationDateRequired: true, group: "ANTECEDENTES" }),
    doc("REDAM",                          { issueDateRequired: true, expirationDateRequired: true, group: "ANTECEDENTES" }),
    doc("CONSULTA DE INHABILIDADES",      { issueDateRequired: true, expirationDateRequired: true, group: "ANTECEDENTES" }),
  ];

  const ALIMENTOS = [
    doc("CURSO MANIPULACION DE ALIMENTOS",   { issueDateRequired: true, expirationDateRequired: true, group: "ALIMENTOS" }),
    doc("EXAMENES MANIPULACION DE ALIMENTOS", { issueDateRequired: true, expirationDateRequired: true, group: "ALIMENTOS" }),
  ];

  const AFILIACIONES = [
    doc("CONTRATO", { group: "CONTRATACION" }),
    doc("AFILIACION ARL", { group: "SEGURIDAD SOCIAL" }),
    doc("AFILIACION EPS", { group: "SEGURIDAD SOCIAL" }),
    doc("AFILIACION AFP", { group: "SEGURIDAD SOCIAL" }),
    doc("AFILIACION CAJA DE COMPENSACION COFREM", { group: "SEGURIDAD SOCIAL" }),
  ];

  const FORMATOS = [
    doc("FORMATO DE INDUCCION", { group: "FORMATOS" }),
    doc("FORMATO DE DOTACION",  { group: "FORMATOS" }),
  ];

  const OPTIONAL_TERRITORIAL = [
    doc("RESIDENCIA EXPEDIDA POR ALCALDIA", { required: false, issueDateRequired: true, expirationDateRequired: true, group: "TERRITORIAL" }),
    doc("SISBEN",                           { required: false, issueDateRequired: true, expirationDateRequired: true, group: "TERRITORIAL" }),
  ];

  let studies;
  if (position === "COORDINADOR DE SUMINISTRO" || position === "SUPERVISOR DE CALIDAD" || position === "AREA DE CALIDAD") {
    studies = [
      doc("ESTUDIOS PROFESIONAL",  { group: "ESTUDIOS" }),
      doc("TARJETA PROFESIONAL",   { group: "ESTUDIOS" }),
      doc("ANTECEDENTES DE LA PROFESION", { issueDateRequired: true, expirationDateRequired: true, group: "ESTUDIOS" }),
    ];
  } else if (position === "COORDINADOR DE ZONA") {
    studies = [doc("ESTUDIOS TECNICO", { group: "ESTUDIOS" })];
  } else {
    studies = [doc("ESTUDIOS BACHILLER", { group: "ESTUDIOS" })];
  }

  const all = [...BASE, ...studies, ...OPTIONAL_TERRITORIAL, ...ANTECEDENTES, ...ALIMENTOS, ...AFILIACIONES, ...FORMATOS];
  const seen = new Set();
  return all.filter((d) => {
    const k = norm(d.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function _resolveMunName(value) {
  return getMunicipalityName(value, null, "No registrado");
}

async function openDocumentCenterModule() {
  console.log("[documents] NEW FLOW ACTIVE");
  await openModule("centro_documentos");
}

function renderStableEmployeeDocuments(employee, documents, requiredDocuments) {
  const rowsHtml = requiredDocuments.map((req) => {
    const found = documents
      .filter((doc) => sameDocumentType(doc.document_type_name || doc.documentType || doc.docTypeName || "", req.name))
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
    const uploaded = Boolean(found);
    const docStatus = found ? (found.status || "cargado").toLowerCase() : "pendiente";
    const statusLabels = { cargado: "Cargado", aprobado: "Aprobado", rechazado: "Rechazado", vencido: "Vencido", pendiente: "Pendiente" };
    const statusChips  = { cargado: "warning", aprobado: "success", rechazado: "danger", vencido: "warning", pendiente: "neutral" };
    const statusLabel  = statusLabels[docStatus] || "Cargado";
    const statusChip   = statusChips[docStatus]  || "warning";
    const iconClass    = uploaded ? (docStatus === "rechazado" ? "danger" : "success") : (req.required ? "danger" : "neutral");
    const iconChar     = uploaded ? (docStatus === "rechazado" ? "✗" : "✓") : "—";

    let approvalActions = "";
    if (found) {
      const viewBtn = `<button type="button" class="btn btn-secondary btn-row" data-document-action="view" data-document-id="${escapeAttr(found.id)}" data-document-name="${escapeAttr(req.name || '')}">Ver</button>`;
      if (docStatus === "cargado") {
        approvalActions = `${viewBtn}
          <button type="button" class="btn btn-success btn-row" data-document-action="validate" data-document-id="${escapeAttr(found.id)}">✅ Validar</button>
          <button type="button" class="btn btn-danger btn-row" data-document-action="reject" data-document-id="${escapeAttr(found.id)}">❌ Rechazar</button>`;
      } else {
        approvalActions = viewBtn;
      }
    }

    const docItemAttrs = found
      ? `class="document-check-row document-item" data-doc-id="${escapeAttr(found.id)}"`
      : `class="document-check-row"`;

    return `
      <div ${docItemAttrs}>
        <div class="document-check-name">
          <span class="document-check-icon ${iconClass}">${iconChar}</span>
          <div>
            <strong>${escapeHtml(req.name)}</strong>
            <small>${escapeHtml(req.group || "GENERAL")}</small>
          </div>
        </div>
        <div class="document-check-conditional">
          <span class="status-chip ${req.required ? "danger" : "neutral"}">${req.required ? "Obligatorio" : "Opcional"}</span>
        </div>
        <div class="document-check-date-cell">${req.issueDateRequired ? `<strong>${escapeHtml(found?.uploaded_at || found?.uploadedAt || "Pendiente")}</strong>` : `<span class="doc-na">No aplica</span>`}</div>
        <div class="document-check-date-cell">${req.expirationDateRequired ? `<strong>${escapeHtml(found?.expirationDate || "Pendiente")}</strong>` : `<span class="doc-na">No aplica</span>`}</div>
        <div class="document-check-status"><span class="status-chip ${statusChip}">${statusLabel}</span></div>
        <div class="document-check-actions">${approvalActions}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="documents-workspace" id="documents-panel" data-employee-id="${escapeAttr(employee.id)}">
      <article class="documents-audit-panel">
        <section class="documents-audit-hero">
          <div>
            <span class="personnel-premium-eyebrow">Documentos</span>
            <h2>${escapeHtml(getPersonnelFullName(employee))}</h2>
            <p>Flujo estable sin preview automático.</p>
          </div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:flex-end">
            <button type="button" id="openBulkDocumentUpload" class="btn btn-primary">Abrir Centro Documental</button>
            <button type="button" id="backToPersonnel" class="btn btn-secondary">Volver</button>
          </div>
        </section>

        <section class="documents-upload-card">
          <div>
            <h3>Cargar documento</h3>
            <p>Selecciona un tipo documental y luego el PDF. Máximo 10 MB.</p>
          </div>
          <div class="documents-upload-form">
            <select id="employeeDocumentTypeSelect">
              <option value="">Selecciona documento</option>
              ${requiredDocuments.map((d) => `<option value="${escapeAttr(d.name)}">${escapeHtml(d.name)}</option>`).join("")}
            </select>
            <input type="file" id="employeeDocumentFileInput" accept="application/pdf,.pdf" style="display:none" />
            <button type="button" id="employeeDocumentUploadButton" class="btn btn-primary btn-upload-document">Cargar documento</button>
          </div>
        </section>

        <section class="documents-checklist-card">
          <div class="documents-checklist-table-header">
            <div>Documento</div>
            <div>Condicional</div>
            <div>Expedición</div>
            <div>Vencimiento</div>
            <div>Estado</div>
            <div>Aprobación</div>
          </div>
          <div class="documents-checklist">${rowsHtml}</div>
        </section>
      </article>
    </div>
  `;
}

function bindEmployeeDocumentHandlers() {
  if (employeeDocumentHandlersBound) return;
  employeeDocumentHandlersBound = true;

  document.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-document-action]");
    if (actionButton) {
      event.preventDefault();
      event.stopPropagation();
      const action = actionButton.dataset.documentAction;
      const docId = actionButton.dataset.documentId;
      const typeKey = actionButton.dataset.documentTypeKey || "";

      if (action === "view") {
        const docName = actionButton.dataset.documentName || "Documento";
        await openDocViewer(docId, docName);
        return;
      }
      if (action === "download") {
        try {
          const vtRes = await apiFetch(`/documents/${encodeURIComponent(docId)}/view-token`, { method: "POST" });
          if (!vtRes?.token) throw new Error("Sin token");
          window.open(`/documents/${encodeURIComponent(docId)}/download?vt=${encodeURIComponent(vtRes.token)}`, "_blank", "noopener");
        } catch {
          alert("No se pudo descargar el documento. Intenta de nuevo.");
        }
        return;
      }
      if (action === "replace") {
        EMPLOYEE_DOCUMENT_UI_STATE.replaceDocumentId = docId;
        EMPLOYEE_DOCUMENT_UI_STATE.replaceDocumentTypeKey = typeKey;
        const typeSelect = document.getElementById("employeeDocumentTypeSelect");
        if (typeSelect && typeKey) typeSelect.value = typeKey;
        document.getElementById("employeeDocumentFileInput")?.click();
        return;
      }
      if (action === "validate") {
        if (!confirm("¿Validar este documento?")) return;
        try {
          await apiFetch(`/documents/${encodeURIComponent(docId)}/status`, { method: "PATCH", body: JSON.stringify({ status: "aprobado" }) });
          state.personnelEmployeeDocumentsCache?.delete?.(String(EMPLOYEE_DOCUMENT_UI_STATE.employeeId || ""));
          await openModule(state.activeModule || "gestion_personal");
        } catch {
          alert("No se pudo validar el documento. Intenta de nuevo.");
        }
        return;
      }
      if (action === "reject") {
        const reason = prompt("Motivo del rechazo (opcional):");
        if (reason === null) return;
        try {
          await apiFetch(`/documents/${encodeURIComponent(docId)}/status`, { method: "PATCH", body: JSON.stringify({ status: "rechazado", reviewNotes: reason || null }) });
          state.personnelEmployeeDocumentsCache?.delete?.(String(EMPLOYEE_DOCUMENT_UI_STATE.employeeId || ""));
          await openModule(state.activeModule || "gestion_personal");
        } catch {
          alert("No se pudo rechazar el documento. Intenta de nuevo.");
        }
        return;
      }
      if (action === "delete") {
        if (!confirm("¿Eliminar este documento? Esta acción no se puede deshacer.")) return;
        await apiFetch(`/documents/${encodeURIComponent(docId)}`, { method: "DELETE" });
        state.personnelEmployeeDocumentsCache?.delete?.(String(EMPLOYEE_DOCUMENT_UI_STATE.employeeId || ""));
        await openModule(state.activeModule || "gestion_personal");
      }
      return;
    }

    if (event.target.closest("#employeeDocumentUploadButton")) {
      event.preventDefault();
      event.stopPropagation();
      console.log("[documents] click upload");
      document.getElementById("employeeDocumentFileInput")?.click();
      return;
    }

    if (event.target.closest("#openBulkDocumentUpload")) {
      event.preventDefault();
      event.stopPropagation();
      await openDocumentCenterModule();
      return;
    }

    if (event.target.closest("#backToPersonnel")) {
      event.preventDefault();
      event.stopPropagation();
      state.personnelViewMode = "table";
      state.personnelSelectedId = "__none__";
      state.personnelDocumentsEmployee = null;
      await openModule(state.activeModule || "gestion_personal");
    }
  });

  document.addEventListener("change", async (event) => {
    const fileInput = event.target;
    if (!(fileInput instanceof HTMLInputElement) || fileInput.id !== "employeeDocumentFileInput") return;
    const file = fileInput.files?.[0];
    if (!file) return;
    console.log("[documents] file selected", file.name);

    const employeeId = EMPLOYEE_DOCUMENT_UI_STATE.employeeId || state.personnelDocumentsEmployee?.id || "";
    const typeSelect = document.getElementById("employeeDocumentTypeSelect");
    const documentTypeKey = String(typeSelect?.value || EMPLOYEE_DOCUMENT_UI_STATE.replaceDocumentTypeKey || "").trim();
    if (!employeeId) { fileInput.value = ""; showError("No hay empleado seleccionado."); return; }
    if (!documentTypeKey) { fileInput.value = ""; showError("Selecciona un tipo documental."); return; }
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name || "")) { fileInput.value = ""; showError("Solo se permiten archivos PDF."); return; }
    if (file.size > 10 * 1024 * 1024) { fileInput.value = ""; showError("El archivo supera el límite de 10 MB."); return; }

    const uploadButton = document.getElementById("employeeDocumentUploadButton");
    const originalText = uploadButton?.textContent || "Cargar documento";
    const isReplace = Boolean(EMPLOYEE_DOCUMENT_UI_STATE.replaceDocumentId);
    try {
      if (uploadButton) { uploadButton.disabled = true; uploadButton.textContent = "Subiendo..."; }
      console.log("[documents] uploading multipart");
      const formData = new FormData();
      formData.append("employee_id", employeeId);
      formData.append("document_type_key", documentTypeKey);
      formData.append("file", file);

      const endpoint = isReplace
        ? `/documents/${encodeURIComponent(EMPLOYEE_DOCUMENT_UI_STATE.replaceDocumentId)}/replace`
        : "/documents/upload";
      const response = await apiFetch(endpoint, { method: isReplace ? "PUT" : "POST", body: formData, noContentType: true });
      state.personnelEmployeeDocumentsCache?.delete?.(String(employeeId));
      state.personnelDossierCache?.delete?.(String(employeeId));
      EMPLOYEE_DOCUMENT_UI_STATE.replaceDocumentId = null;
      EMPLOYEE_DOCUMENT_UI_STATE.replaceDocumentTypeKey = "";
      fileInput.value = "";
      showSuccess(response.message || "Documento cargado correctamente.");
      await openModule(state.activeModule || "gestion_personal");
    } catch (error) {
      showError(error.message || "No se pudo guardar el documento.");
    } finally {
      fileInput.value = "";
      if (uploadButton) { uploadButton.disabled = false; uploadButton.textContent = originalText; }
    }
  });
}

export async function loadEmployeeDocumentsModule() {
  const employee = state.personnelDocumentsEmployee;
  if (!employee) {
    return `<article class="info-card"><h3>Error</h3><p>No se encontró el empleado.</p></article>`;
  }

  let documents = [];
  try {
    documents = await getEmployeeDocumentsCollection(employee.id, { force: true });
  } catch (error) {
    return `<article class="info-card"><h3>Error cargando documentos</h3><p>${escapeHtml(error.message)}</p></article>`;
  }

  EMPLOYEE_DOCUMENT_UI_STATE.employeeId = String(employee.id);
  console.log("[documents-personnel] NEW EXPEDIENTE FLOW ACTIVE");
  bindEmployeeDocumentHandlers();
  return renderStableEmployeeDocuments(employee, documents, _getRequiredDocsByEmployee(employee));
}

export function renderPersonnelCvModule() {
  const d = state.personnelDraft || {};
  const fullName = [d.firstName, d.secondName, d.firstLastName, d.secondLastName]
    .filter(Boolean).join(" ").toUpperCase() || "SIN NOMBRE";
  const initials = [d.firstName, d.firstLastName].filter(Boolean).map((n) => n[0]).join("").toUpperCase() || "?";
  const photoUrl = d.photoUrl || "";
  const role = String(d.cargo_real || d.offerPosition || "CARGO NO REGISTRADO").toUpperCase();
  const now = new Date();
  const generationDate = now.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const generationTime = now.toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const joinDateParts = (day, month, year) => {
    const dd = String(day || "").trim().padStart(2, "0");
    const mm = String(month || "").trim().padStart(2, "0");
    const yyyy = String(year || "").trim();
    if (!dd || !mm || !yyyy) return "—";
    return `${dd}/${mm}/${yyyy}`;
  };

  const cleanValue = (value) => {
    const text = String(value || "").trim();
    return text || "—";
  };

  const normalizeLevelLabel = (study = {}) => {
    const level = String(study.educationLevel || study.level || "").trim();
    if (level) return level;
    const degree = String(study.degree || "").trim();
    return degree || "No registra";
  };

  const formatExperiencePeriod = (experience = {}) => {
    const start = String(experience.fechaInicio || experience.startDate || "").trim();
    const end = String(experience.fechaFin || experience.endDate || "").trim();
    const startYear = start ? (start.match(/\d{4}/)?.[0] || start) : "";
    const endYear = end ? (end.match(/\d{4}/)?.[0] || end) : "";
    if (startYear && endYear) return `${startYear} - ${endYear}`;
    if (startYear && !endYear) return `${startYear} - ACTUAL`;
    if (!startYear && endYear) return `HASTA ${endYear}`;
    return "PERIODO NO REGISTRADO";
  };

  const sortExperiences = (items = []) =>
    items.slice().sort((left, right) => {
      const leftEnd = String(left.fechaFin || left.endDate || "").trim();
      const rightEnd = String(right.fechaFin || right.endDate || "").trim();
      const leftStart = String(left.fechaInicio || left.startDate || "").trim();
      const rightStart = String(right.fechaInicio || right.startDate || "").trim();
      const leftKey = leftEnd || leftStart || "";
      const rightKey = rightEnd || rightStart || "";
      return rightKey.localeCompare(leftKey);
    });

  const buildFunctionBullets = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return ["Sin funciones registradas"];
    const parts = raw
      .split(/\r?\n|•|;|(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ])/)
      .map((item) => item.replace(/^[\s\-–—•]+/, "").trim())
      .filter(Boolean);
    return parts.length ? parts.slice(0, 5) : [raw];
  };

  const birthDate = joinDateParts(d.birthDay, d.birthMonth, d.birthYear);
  const birthPlace = [
    _resolveMunName(d.birthMunicipality),
    cleanValue(d.birthDepartment) !== "—" ? cleanValue(d.birthDepartment) : "",
  ].filter((item) => item && item !== "—").join(", ") || "—";
  const municipality = _resolveMunName(d.residenceMunicipality);
  const documentLabel = [cleanValue(d.documentType), cleanValue(d.documentNumber)]
    .filter((item) => item !== "—")
    .join(" ");
  const isProfessional = (Array.isArray(d.studies) ? d.studies : []).some((study) => {
    const level = normalizeLevelLabel(study).toLowerCase();
    return ["profes", "especial", "maestr", "doctor", "tecnolog"].some((token) => level.includes(token));
  }) || /(profesional|ingenier|coordinador|analista|psicolog|contador|abogado|supervisor)/i.test(role);

  const personalRows = [
    ["Documento", documentLabel || "—"],
    ["Fecha de nacimiento", birthDate],
    ["Lugar de nacimiento", birthPlace],
    ["Dirección", cleanValue(d.address)],
    ["Municipio de residencia", municipality || "—"],
    ["Teléfono", cleanValue(d.phone)],
    ["Correo electrónico", cleanValue(d.email)],
  ];

  const estudios = (Array.isArray(d.studies) ? d.studies : [])
    .filter((study) => String(study.degree || study.educationLevel || study.institution || study.year || "").trim());
  const experiencias = sortExperiences(
    (Array.isArray(d.workExperience) ? d.workExperience : [])
      .filter((experience) => String(experience.empresa || experience.cargo || experience.funciones || experience.fechaInicio || experience.fechaFin || "").trim())
  );

  setTimeout(() => {
    document.getElementById("btnBackFromCv")?.addEventListener("click", async () => {
      state.personnelViewMode   = "table";
      state.personnelSelectedId = "__none__";
      await openModule(state.activeModule || "gestion_personal");
    });
    document.getElementById("btnPrintCv")?.addEventListener("click", () => {
      printHtml(document.getElementById("cvPrintArea"), "Hoja de Vida");
    });
    document.getElementById("btnSavePdfCv")?.addEventListener("click", () => {
      savePdf(document.getElementById("cvPrintArea"));
    });
  }, 0);

  return `
    <div class="cv-page-wrapper">
      <div class="cv-actions" style="padding: 0 0 16px; display:flex; gap:10px;">
        <button id="btnBackFromCv" type="button" class="btn btn-secondary">← Volver al listado</button>
        <button id="btnPrintCv" type="button" class="btn btn-secondary">Imprimir</button>
        <button id="btnSavePdfCv" type="button" class="btn btn-primary">Guardar como PDF</button>
      </div>
      <div class="cv-print-shell ${isProfessional ? "cv-print-shell-professional" : "cv-print-shell-operational"}" id="cvPrintArea">
        <header class="cv-print-header">
          <div class="cv-print-accent" aria-hidden="true">
            <span class="cv-print-accent-blue"></span>
            <span class="cv-print-accent-green"></span>
          </div>
          <div class="cv-print-header-layout">
            <div class="cv-print-photo-wrap">
              ${photoUrl
                ? `<img src="${escapeAttr(photoUrl)}" alt="Foto del colaborador" class="cv-print-photo-img" />`
                : `<div class="cv-print-photo-fallback">${escapeHtml(initials)}</div>`}
            </div>
            <div class="cv-print-header-copy">
              <h1>${escapeHtml(fullName)}</h1>
              <p class="cv-print-document">${escapeHtml(documentLabel || "DOCUMENTO NO REGISTRADO")}</p>
              <p class="cv-print-role">${escapeHtml(role)}</p>
              <div class="cv-print-contact-inline">
                <span class="cv-print-contact-phone">${escapeHtml(cleanValue(d.phone))}</span>
                <span class="cv-print-contact-email">${escapeHtml(cleanValue(d.email))}</span>
                <span class="cv-print-contact-municipality">${escapeHtml(municipality || "—")}</span>
              </div>
            </div>
          </div>
        </header>

        <main class="cv-print-body">
          <section class="cv-print-section">
            <div class="cv-print-section-head">
              <span class="cv-print-section-number">1.</span>
              <h2>INFORMACIÓN PERSONAL</h2>
            </div>
            <table class="cv-print-info-table">
              <tbody>
                ${personalRows.map(([label, value]) => `
                  <tr>
                    <th>${escapeHtml(label)}</th>
                    <td>${escapeHtml(cleanValue(value))}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </section>

          <section class="cv-print-section">
            <div class="cv-print-section-head">
              <span class="cv-print-section-number">2.</span>
              <h2>EXPERIENCIA LABORAL</h2>
            </div>
            <div class="cv-print-timeline">
              ${experiencias.length ? experiencias.map((exp) => `
                <article class="cv-print-timeline-item">
                  <div class="cv-print-timeline-marker" aria-hidden="true"></div>
                  <div class="cv-print-timeline-period">${escapeHtml(formatExperiencePeriod(exp))}</div>
                  <div class="cv-print-timeline-content">
                    <h3>${escapeHtml(String(exp.cargo || "Cargo no registrado").toUpperCase())}</h3>
                    <p class="cv-print-timeline-company">${escapeHtml(String(exp.empresa || "Empresa no registrada").toUpperCase())}</p>
                    <ul>
                      ${buildFunctionBullets(exp.funciones).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                    </ul>
                  </div>
                </article>
              `).join("") : `
                <article class="cv-print-empty-note">
                  No registra experiencia laboral.
                </article>
              `}
            </div>
          </section>

          <section class="cv-print-section">
            <div class="cv-print-section-head">
              <span class="cv-print-section-number">3.</span>
              <h2>FORMACIÓN ACADÉMICA</h2>
            </div>
            <table class="cv-print-education-table">
              <thead>
                <tr>
                  <th>Nivel</th>
                  <th>Institución</th>
                  <th>Año</th>
                </tr>
              </thead>
              <tbody>
                ${estudios.length ? estudios.map((study) => `
                  <tr>
                    <td>${escapeHtml(cleanValue(normalizeLevelLabel(study)))}</td>
                    <td>${escapeHtml(cleanValue(study.institution))}</td>
                    <td>${escapeHtml(cleanValue(study.year))}</td>
                  </tr>
                `).join("") : `
                  <tr>
                    <td colspan="3" class="cv-print-table-empty">No registra formación académica.</td>
                  </tr>
                `}
              </tbody>
            </table>
          </section>
        </main>

        <footer class="cv-print-footer">
          <p>Hoja de Vida generada automáticamente</p>
          <p>Fecha de generación: ${escapeHtml(`${generationDate} ${generationTime}`)}</p>
        </footer>
      </div>
    </div>
  `;
}

// ── Helpers de validación del formulario ──────────────────────────────────────

function validatePersonnelForm(form) {
  let isValid = true;
  form.querySelectorAll("[required]").forEach((field) => {
    field.classList.remove("input-error");
    if (!String(field.value || "").trim()) {
      field.classList.add("input-error");
      isValid = false;
    }
  });
  return isValid;
}

function attachPersonnelFormValidation(form) {
  if (!form) return;
  form.querySelectorAll("[required]").forEach((field) => {
    const clear = () => {
      if (String(field.value || "").trim()) field.classList.remove("input-error");
    };
    field.addEventListener("input",  clear);
    field.addEventListener("change", clear);
  });
}

// ── Export / Import modals ────────────────────────────────────────────────────

function openExportPersonnelModal(rows) {
  const EXPORT_GROUPS = [
    {
      label: "Identificación",
      icon: "🪪",
      cols: [
        { key: "documentNumber", label: "Cédula / Documento",  checked: true },
        { key: "fullName",       label: "Nombre completo",     checked: true },
        { key: "documentType",   label: "Tipo de documento",   checked: false },
        { key: "biologicalSex",  label: "Sexo biológico",      checked: false },
        { key: "birthYear",      label: "Año de nacimiento",   checked: false },
        { key: "bloodType",      label: "Tipo de sangre",      checked: false },
      ],
    },
    {
      label: "Laboral",
      icon: "💼",
      cols: [
        { key: "cargo_real",    label: "Cargo real",           checked: true  },
        { key: "status",        label: "Estado laboral",       checked: true  },
        { key: "workdayType",   label: "Jornada (TC/MT)",      checked: true  },
        { key: "startDate",     label: "Fecha de ingreso",     checked: true  },
        { key: "contractType",  label: "Tipo de contrato",     checked: false },
        { key: "gestorZona",    label: "Gestor de zona",       checked: false },
      ],
    },
    {
      label: "Ubicación operativa",
      icon: "📍",
      cols: [
        { key: "municipality",        label: "Municipio",       checked: true  },
        { key: "institution",         label: "Institución",     checked: true  },
        { key: "site",                label: "Sede educativa",  checked: true  },
        { key: "educationalModality", label: "Modalidad",       checked: true  },
      ],
    },
    {
      label: "Contacto",
      icon: "📞",
      cols: [
        { key: "phone",       label: "Celular",    checked: false },
        { key: "email",       label: "Correo",     checked: false },
        { key: "address",     label: "Dirección",  checked: false },
        { key: "neighborhood",label: "Barrio",     checked: false },
      ],
    },
    {
      label: "Seguridad social",
      icon: "🏥",
      cols: [
        { key: "eps",             label: "EPS",                 checked: false },
        { key: "pensionFund",     label: "Fondo de pensiones",  checked: false },
        { key: "compensationBox", label: "Caja de compensación",checked: false },
        { key: "arl",             label: "ARL",                 checked: false },
      ],
    },
    {
      label: "Dotación",
      icon: "👕",
      cols: [
        { key: "shirtSize", label: "Talla camisa / uniforme", checked: false },
        { key: "pantsSize", label: "Talla pantalón",          checked: false },
        { key: "shoeSize",  label: "Talla calzado",           checked: false },
      ],
    },
  ];

  const ALL_COLS = EXPORT_GROUPS.flatMap(g => g.cols);

  const institutions = [
    ...new Set(rows.map((r) => (r.institution || r.institucion_educativa || "").trim()).filter(Boolean))
  ].sort();

  document.getElementById("exportPersonnelModal")?.remove();

  const FILTER_FIELDS = [
    { value: "status",      label: "Estado laboral",    getter: r => r.status || r.estado || "" },
    { value: "cargo_real",  label: "Cargo",             getter: r => r.cargo_real || r.position || r.cargo || "" },
    { value: "municipality",label: "Municipio",         getter: r => r.municipalityName || r.municipality_name || r.municipio || "" },
    { value: "institution", label: "Institución",       getter: r => r.institutionName || r.institution || r.institucion_educativa || "" },
    { value: "site",        label: "Sede",              getter: r => r.siteName || r.site || r.sede_educativa || "" },
    { value: "modality",    label: "Modalidad",         getter: r => r.modality || r.modalidad || "" },
    { value: "gestorZona",  label: "Gestor de zona",    getter: r => r.gestorZona || r.gestor_zona || "" },
    { value: "workdayType", label: "Jornada",           getter: r => r.workdayType || r.workday_type || "" },
    { value: "hvStatus",    label: "Estado HV",         getter: r => r.hvStatus || "" },
    { value: "eps",         label: "EPS",               getter: r => r.eps || r.eps_name || "" },
    { value: "pensionFund", label: "Fondo de pensiones",getter: r => r.pensionFund || r.pension_fund || r.fondo_pensiones || "" },
  ];

  const modal = document.createElement("div");
  modal.id = "exportPersonnelModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card xp-modal">
      <div class="modal-header xp-header">
        <div class="xp-header-inner">
          <span class="xp-header-icon">📊</span>
          <div>
            <h3 class="xp-title">Exportar personal</h3>
            <p class="xp-subtitle">Selecciona las columnas y el filtro que necesitas</p>
          </div>
        </div>
        <button type="button" class="modal-close" id="closeExportModal">&#x2715;</button>
      </div>

      <div class="xp-toolbar">
        <button type="button" class="xp-sel-btn" id="xpSelAll">Seleccionar todo</button>
        <button type="button" class="xp-sel-btn" id="xpSelNone">Quitar todo</button>
        <span class="xp-counter" id="xpCounter"></span>
      </div>

      <div class="modal-body xp-body">
        ${EXPORT_GROUPS.map(group => `
          <div class="xp-group">
            <div class="xp-group-hdr">
              <span class="xp-group-icon">${group.icon}</span>
              <span class="xp-group-label">${escapeHtml(group.label)}</span>
            </div>
            <div class="xp-cols-grid">
              ${group.cols.map(col => `
                <div class="xp-col-item">
                  <input type="checkbox" class="xp-check" value="${escapeAttr(col.key)}" ${col.checked ? "checked" : ""}>
                  <span class="xp-col-label">${escapeHtml(col.label)}</span>
                </div>
              `).join("")}
            </div>
          </div>
        `).join("")}

        <div class="xp-filter-row">
          <div class="xp-filter-field">
            <span class="xp-filter-label">Filtrar por</span>
            <select id="exportFilterField" class="xp-select">
              <option value="">Sin filtro — todos los registros</option>
              ${FILTER_FIELDS.map(f => `<option value="${escapeAttr(f.value)}">${escapeHtml(f.label)}</option>`).join("")}
            </select>
          </div>
          <div class="xp-filter-field" id="xpFilterValueWrap" style="display:none">
            <span class="xp-filter-label">Valor</span>
            <select id="exportFilterValue" class="xp-select">
              <option value="">Todos</option>
            </select>
          </div>
          <div class="xp-record-badge" id="xpRecordBadge">${rows.length} registros</div>
        </div>
      </div>

      <div class="modal-footer xp-footer">
        <button type="button" class="btn btn-primary xp-btn-export" id="doExportPersonnel">
          ⬇ Exportar Excel
        </button>
        <button type="button" class="btn btn-secondary" id="closeExportModal2">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // ── Helpers ──
  const close = () => modal.remove();
  const getChecked = () => [...modal.querySelectorAll(".xp-check:checked")].map(c => c.value);

  const filterField = modal.querySelector("#exportFilterField");
  const filterValue = modal.querySelector("#exportFilterValue");
  const filterValueWrap = modal.querySelector("#xpFilterValueWrap");

  const getFilteredRows = () => {
    const fieldKey = filterField.value;
    const val = filterValue.value;
    const fieldDef = FILTER_FIELDS.find(f => f.value === fieldKey);
    return (fieldKey && val && fieldDef)
      ? rows.filter(r => String(fieldDef.getter(r)).trim() === val)
      : rows;
  };

  const updateBadge = () => {
    const badge = modal.querySelector("#xpRecordBadge");
    if (badge) badge.textContent = `${getFilteredRows().length} registros`;
  };

  const updateCounter = () => {
    const n = getChecked().length;
    const counter = modal.querySelector("#xpCounter");
    if (counter) counter.textContent = `${n} de ${ALL_COLS.length} columnas seleccionadas`;
    const btn = modal.querySelector("#doExportPersonnel");
    if (btn) btn.disabled = n === 0;
  };

  // ── Events ──
  modal.querySelector("#closeExportModal").addEventListener("click", close);
  modal.querySelector("#closeExportModal2").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  modal.querySelector("#xpSelAll").addEventListener("click", () => {
    modal.querySelectorAll(".xp-check").forEach(cb => { cb.checked = true; });
    updateCounter();
  });
  modal.querySelector("#xpSelNone").addEventListener("click", () => {
    modal.querySelectorAll(".xp-check").forEach(cb => { cb.checked = false; });
    updateCounter();
  });
  modal.querySelectorAll(".xp-check").forEach(cb => cb.addEventListener("change", updateCounter));
  modal.querySelectorAll(".xp-col-item").forEach(item => {
    item.addEventListener("click", e => {
      if (e.target.classList.contains("xp-check")) return;
      const cb = item.querySelector(".xp-check");
      if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); }
    });
    item.setAttribute("tabindex", "0");
  });

  filterField.addEventListener("change", () => {
    const fieldKey = filterField.value;
    const fieldDef = FILTER_FIELDS.find(f => f.value === fieldKey);
    if (!fieldKey || !fieldDef) {
      filterValueWrap.style.display = "none";
      updateBadge();
      return;
    }
    const uniqueVals = [...new Set(rows.map(r => String(fieldDef.getter(r)).trim()).filter(Boolean))].sort();
    filterValue.innerHTML = `<option value="">Todos (${rows.length})</option>` +
      uniqueVals.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("");
    filterValueWrap.style.display = "";
    updateBadge();
  });

  filterValue.addEventListener("change", updateBadge);

  modal.querySelector("#doExportPersonnel").addEventListener("click", () => {
    const selected = getChecked();
    if (!selected.length) { showWarning("Selecciona al menos una columna."); return; }

    const exportRows = getFilteredRows();

    const colDefs  = ALL_COLS.filter(c => selected.includes(c.key));
    const headers  = colDefs.map(c => c.label);
    const dataRows = exportRows.map(r =>
      colDefs.map(c => {
        if (c.key === "fullName")       return getPersonnelFullName(r);
        if (c.key === "municipality")   return getPersonnelMunicipality(r);
        if (c.key === "documentNumber") return getPersonnelDocument(r);
        if (c.key === "status")         return getPersonnelWorkStatus(r);
        return r[c.key] || r[c.key.replace(/([A-Z])/g, "_$1").toLowerCase()] || "";
      })
    );

    exportToExcel(headers, dataRows, `personal_${new Date().toISOString().slice(0, 10)}`);
    close();
    showSuccess(`${exportRows.length} registros exportados a Excel`);
  });

  updateCounter();
}

function openSafeImportPersonnelModal() {
  document.getElementById("importPersonnelModal")?.remove();

  const cu = state.currentUser || {};
  const role = (cu.role || "").toLowerCase();
  const isAdmin = role === "administrador";
  const isTalent = role === "talento_humano";
  if (!isAdmin && !isTalent) {
    showError("Solo administrador y talento humano pueden importar empleados.");
    return;
  }

  const fixedContract = !isAdmin && cu.contractId ? String(cu.contractId) : null;
  let currentBatchId = null;
  let currentRows = [];
  let currentSummary = null;
  let catalogs = { municipalities: [], managers: [], contracts: [], positions: [] };
  let updateFieldsCatalog = [];

  const contractSelectorHtml = isAdmin
    ? `<label style="display:block;font-size:13px;font-weight:600;margin-bottom:.4rem;margin-top:.8rem">Contrato de destino *</label>
       <select id="importContractId" style="width:100%;padding:.5rem;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-bottom:.8rem">
         <option value="">Selecciona un contrato</option>
         ${(state.contracts || []).map(c => `<option value="${escapeAttr(String(c.id))}">${escapeHtml(c.name || String(c.id))}</option>`).join("")}
       </select>`
    : `<input type="hidden" id="importContractId" value="${escapeAttr(fixedContract || "")}">`;

  const modal = document.createElement("div");
  modal.id = "importPersonnelModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card" style="max-width:1120px;width:min(1120px,96vw)">
      <div class="modal-header">
        <h3>Preimportacion de empleados</h3>
        <button type="button" class="modal-close" id="closeImportModal">&#x2715;</button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:minmax(260px,340px) 1fr;gap:1rem;align-items:start">
          <section style="border:1px solid var(--border);border-radius:8px;padding:1rem">
            <button type="button" id="btnDownloadTemplate" class="btn btn-secondary" style="width:100%;margin-bottom:1rem">Descargar plantilla (.xls)</button>
            ${contractSelectorHtml}
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:.4rem">Subir archivo Excel</label>
            <input type="file" id="importExcelFile" accept=".xlsx,.xls" style="width:100%;padding:.5rem;border:1px solid var(--border);border-radius:6px;font-size:13px"/>
            <button type="button" class="btn btn-primary" id="doPreviewImport" style="width:100%;margin-top:1rem">Previsualizar</button>
            <p id="importResult" style="margin-top:.8rem;font-size:13px"></p>
          </section>
          <section>
            <div id="importSummary" style="display:grid;grid-template-columns:repeat(5,minmax(110px,1fr));gap:.6rem;margin-bottom:1rem"></div>
            <div id="importResolvePanel" style="display:none;border:1px solid var(--border);border-radius:8px;padding:.85rem;margin-bottom:1rem">
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:.6rem;align-items:end">
                <label style="font-size:12px;font-weight:600">Campo
                  <select id="importResolveType" style="width:100%;margin-top:.25rem;padding:.45rem;border:1px solid var(--border);border-radius:6px">
                    <option value="municipality">Municipio</option>
                    <option value="manager">Gestor</option>
                    <option value="contract">Contrato</option>
                    <option value="position">Cargo real</option>
                  </select>
                </label>
                <label style="font-size:12px;font-weight:600">Valor del Excel
                  <select id="importSourceValue" style="width:100%;margin-top:.25rem;padding:.45rem;border:1px solid var(--border);border-radius:6px"></select>
                </label>
                <label style="font-size:12px;font-weight:600">Valor correcto
                  <select id="importTargetValue" style="width:100%;margin-top:.25rem;padding:.45rem;border:1px solid var(--border);border-radius:6px"></select>
                </label>
                <button type="button" class="btn btn-secondary" id="applyImportResolve">Aplicar</button>
              </div>
              <label style="display:flex;gap:.45rem;align-items:center;margin-top:.7rem;font-size:12px">
                <input type="checkbox" id="importSaveAlias"/>
                Guardar equivalencia para futuras importaciones
              </label>
            </div>
            <div id="importUpdateFieldsPanel" style="display:none;border:1px solid var(--border);border-radius:8px;padding:.9rem;margin-bottom:1rem;background:#fff">
              <div style="display:flex;justify-content:space-between;gap:.75rem;align-items:center;margin-bottom:.75rem;flex-wrap:wrap">
                <div>
                  <strong style="font-size:13px;display:block">Campos a actualizar</strong>
                  <span style="font-size:12px;color:#64748b">Por defecto solo se actualiza dotacion/calzado. Los demas datos se mantienen.</span>
                </div>
                <label style="display:flex;gap:.4rem;align-items:center;font-size:12px;color:#64748b">
                  <input type="checkbox" id="importAllowOverwriteEmpty"/>
                  permitir sobrescribir con vacio
                </label>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:.5rem;align-items:end;margin-bottom:.7rem">
                <label style="font-size:12px;font-weight:600">Aplicar mismo valor
                  <select id="importMassField" style="width:100%;margin-top:.25rem;padding:.4rem;border:1px solid var(--border);border-radius:6px"></select>
                </label>
                <label style="font-size:12px;font-weight:600">Valor
                  <input id="importMassValue" type="text" style="width:100%;margin-top:.25rem;padding:.4rem;border:1px solid var(--border);border-radius:6px"/>
                </label>
                <button type="button" class="btn btn-secondary" id="applyImportMassValue">Usar valor</button>
              </div>
              <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.7rem">
                <button type="button" class="btn btn-secondary" id="selectImportDotacionFields">Solo dotacion/calzado</button>
                <button type="button" class="btn btn-secondary" id="selectImportWorkFields">Datos laborales</button>
                <button type="button" class="btn btn-secondary" id="clearImportUpdateFields">Limpiar</button>
              </div>
              <div id="importUpdateFields" style="display:grid;grid-template-columns:repeat(2,minmax(230px,1fr));gap:.75rem"></div>
            </div>
            <div style="max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:8px">
              <table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead style="position:sticky;top:0;background:var(--panel);z-index:1">
                  <tr>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Fila</th>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Empleado</th>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Documento</th>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Dotacion y tallas</th>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Estado</th>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Diferencias / errores</th>
                  </tr>
                </thead>
                <tbody id="importErrorsBody">
                  <tr><td colspan="6" style="padding:1rem;color:#64748b">Carga un Excel para ver la prevalidacion.</td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="commitImportPersonnel" disabled>Importar empleados validos</button>
        <button type="button" class="btn btn-secondary" id="closeImportModal2">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById("closeImportModal").addEventListener("click", close);
  document.getElementById("closeImportModal2").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  const renderSummary = () => {
    const wrap = document.getElementById("importSummary");
    if (!wrap || !currentSummary) { if (wrap) wrap.innerHTML = ""; return; }
    const card = (label, value, color) => `
      <div style="border:1px solid var(--border);border-radius:8px;padding:.7rem;background:#fff">
        <span style="display:block;font-size:11px;color:#64748b">${label}</span>
        <strong style="font-size:22px;color:${color}">${Number(value || 0)}</strong>
      </div>`;
    wrap.innerHTML =
      card("Filas leidas", currentSummary.totalRows, "#0f172a") +
      card("Listas", currentSummary.validRows, "#15803d") +
      card("Errores", currentSummary.errorRows, "#dc2626") +
      card("Existentes", currentSummary.existingRows, "#2563eb") +
      card("Diferencias", currentSummary.conflictRows, "#d97706");
    document.getElementById("commitImportPersonnel").disabled =
      !currentSummary.validRows && !currentSummary.existingRows && !currentSummary.conflictRows;
    document.getElementById("importResolvePanel").style.display = currentRows.length ? "" : "none";
    document.getElementById("importUpdateFieldsPanel").style.display =
      (currentSummary.existingRows || currentSummary.conflictRows) ? "" : "none";
  };

  const renderRows = () => {
    const body = document.getElementById("importErrorsBody");
    if (!body) return;
    if (!currentRows.length) {
      body.innerHTML = `<tr><td colspan="6" style="padding:1rem;color:#64748b">No hay errores pendientes.</td></tr>`;
      return;
    }
    const selectedFields = new Set(
      [...document.querySelectorAll("[data-import-update-field]:checked")]
        .map((input) => input.dataset.importUpdateField)
        .filter(Boolean)
    );
    body.innerHTML = currentRows.map((row) => {
      const errors = (row.errors || [])
        .filter((e) => e.code !== "EXISTING_EMPLOYEE")
        .map((e) => e.message || e.code);
      const visibleConflicts = (row.conflicts || [])
        .filter((c) => selectedFields.size ? selectedFields.has(c.field) : false);
      const conflicts = visibleConflicts.map((c) => `${c.label}: "${c.current || "vacio"}" -> "${c.incoming || "vacio"}"`);
      const sizes = row.sizes || {};
      const sizeText = Object.entries(sizes)
        .filter(([, value]) => value)
        .map(([key, value]) => `${key.replace("talla_", "").replace("_", " ")}: ${value}`)
        .join(" | ");
      const color = row.status === "ERROR" ? "#dc2626"
        : row.status === "EXISTING_EMPLOYEE" ? "#2563eb"
        : row.status === "HAS_CONFLICTS" ? "#d97706"
        : "#15803d";
      const statusLabel = row.status === "HAS_CONFLICTS" ? "DIFERENCIAS"
        : row.status === "EXISTING_EMPLOYEE" ? "EXISTENTE"
        : row.status;
      return `<tr>
        <td style="padding:.55rem;border-bottom:1px solid var(--border)">${escapeHtml(String(row.rowNumber || ""))}</td>
        <td style="padding:.55rem;border-bottom:1px solid var(--border)">${escapeHtml(row.fullName || "")}</td>
        <td style="padding:.55rem;border-bottom:1px solid var(--border)">${escapeHtml(row.documentNumber || "")}</td>
        <td style="padding:.55rem;border-bottom:1px solid var(--border)">${escapeHtml(sizeText || "Sin tallas")}</td>
        <td style="padding:.55rem;border-bottom:1px solid var(--border);color:${color};font-weight:700">${escapeHtml(statusLabel || "")}</td>
        <td style="padding:.55rem;border-bottom:1px solid var(--border)">${escapeHtml([...conflicts, ...errors].join("; ") || "Sin cambios en campos seleccionados")}</td>
      </tr>`;
    }).join("");
  };

  const renderUpdateFields = () => {
    const wrap = document.getElementById("importUpdateFields");
    if (!wrap) return;
    const fields = updateFieldsCatalog.length ? updateFieldsCatalog : [];
    const dotacion = fields.filter((field) => field.group === "Dotacion y tallas");
    const others = fields.filter((field) => field.group !== "Dotacion y tallas");
    const check = (field, checked = false) => `
      <label style="display:flex;gap:.5rem;align-items:center;font-size:12px;padding:.32rem .35rem;border-radius:6px">
        <input type="checkbox" data-import-update-field="${escapeAttr(field.key)}"${checked ? " checked" : ""}/>
        <span>${escapeHtml(field.label || field.key)}</span>
      </label>`;
    const group = (title, description, items, checked = false) => `
      <section style="border:1px solid var(--border);border-radius:8px;padding:.75rem;background:#f8fafc">
        <strong style="display:block;font-size:12px;margin-bottom:.15rem">${escapeHtml(title)}</strong>
        <span style="display:block;font-size:11px;color:#64748b;margin-bottom:.45rem">${escapeHtml(description)}</span>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.15rem">${items.map((field) => check(field, checked)).join("")}</div>
      </section>`;
    wrap.innerHTML = [
      group("Dotacion y calzado", "Recomendado para cargar tallas sin tocar datos personales.", dotacion, true),
      group("Datos del empleado", "Activalos solo si vas a corregir esos datos.", others, false),
    ].join("");
    wrap.querySelectorAll("[data-import-update-field]").forEach((input) => {
      input.addEventListener("change", renderRows);
    });
    const massField = document.getElementById("importMassField");
    if (massField) {
      massField.innerHTML = fields.map((field) =>
        `<option value="${escapeAttr(field.key)}">${escapeHtml(field.label || field.key)}</option>`
      ).join("");
    }
  };

  const targetCatalogForType = (type) => {
    if (type === "municipality") return catalogs.municipalities || [];
    if (type === "manager") return catalogs.managers || [];
    if (type === "contract") return catalogs.contracts || [];
    if (type === "position") return catalogs.positions || [];
    return [];
  };
  const sourceValueForType = (row, type) => {
    if (type === "municipality") return row.municipalityText || "";
    if (type === "manager") return row.managerText || "";
    if (type === "contract") return row.contractText || "";
    if (type === "position") return row.realPositionText || "";
    return "";
  };
  const refreshResolveControls = () => {
    const type = document.getElementById("importResolveType")?.value || "municipality";
    const sourceSelect = document.getElementById("importSourceValue");
    const targetSelect = document.getElementById("importTargetValue");
    if (!sourceSelect || !targetSelect) return;
    const sourceValues = [...new Set(currentRows.map((row) => sourceValueForType(row, type)).filter(Boolean))].sort();
    sourceSelect.innerHTML = sourceValues.map((v) => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("");
    targetSelect.innerHTML = targetCatalogForType(type).map((item) =>
      `<option value="${escapeAttr(String(item.id || ""))}" data-label="${escapeAttr(item.name || item.label || "")}">${escapeHtml(item.name || item.label || String(item.id))}</option>`
    ).join("");
  };
  const setPreviewState = (payload) => {
    currentSummary = payload.summary || null;
    currentBatchId = currentSummary?.importBatchId || currentBatchId;
    currentRows = Array.isArray(payload.rows) ? payload.rows : [];
    catalogs = payload.catalogs || catalogs;
    updateFieldsCatalog = catalogs.updateFields || updateFieldsCatalog;
    renderSummary();
    renderUpdateFields();
    renderRows();
    refreshResolveControls();
  };

  document.getElementById("btnDownloadTemplate").addEventListener("click", () => {
    exportToExcel(
      [
        "PRIMER NOMBRE","SEGUNDO NOMBRE","PRIMER APELLIDO","SEGUNDO APELLIDO",
        "TIPO DOCUMENTO","NUMERO DOCUMENTO","EMPRESA","CONTRATO",
        "CARGO REAL","TIPO JORNADA","ESTADO","GESTOR ZONA","MUNICIPIO OPERACION",
        "INSTITUCION EDUCATIVA","SEDE EDUCATIVA","MODALIDAD",
        "CELULAR","CORREO","DIRECCION","BARRIO","ESTADO CIVIL",
        "EPS","FONDO PENSIONES","CAJA COMPENSACION","ARL",
        "UNIFORME","TALLA CAMISA","TALLA PANTALON","CALZADO",
      ],
      [[
        "JUAN","CARLOS","PEREZ","GARCIA","CC","12345678","EMPIRIA","Contrato PAE",
        "OPERARIO MANIPULADOR DE ALIMENTOS","TC","ACTIVO","Laura Gomez","Acacias",
        "INST. EDUCATIVA EJEMPLO","SEDE PRINCIPAL","CAA",
        "3101234567","juan@email.com","CRA 5 #10-20","CENTRO","SOLTERO",
        "COMPENSAR","COLPENSIONES","COFREM","SURA",
        "M","","","38",
      ]],
      "plantilla_importacion_personal"
    );
  });

  document.getElementById("importResolveType").addEventListener("change", refreshResolveControls);

  const setUpdateFieldSelection = (predicate) => {
    document.querySelectorAll("[data-import-update-field]").forEach((input) => {
      const field = updateFieldsCatalog.find((item) => item.key === input.dataset.importUpdateField);
      input.checked = Boolean(field && predicate(field));
    });
    renderRows();
  };

  document.getElementById("selectImportDotacionFields").addEventListener("click", () => {
    setUpdateFieldSelection((field) => field.group === "Dotacion y tallas");
  });

  document.getElementById("selectImportWorkFields").addEventListener("click", () => {
    setUpdateFieldSelection((field) => field.group !== "Dotacion y tallas");
  });

  document.getElementById("clearImportUpdateFields").addEventListener("click", () => {
    setUpdateFieldSelection(() => false);
  });

  document.getElementById("applyImportMassValue").addEventListener("click", () => {
    const field = document.getElementById("importMassField")?.value || "";
    if (!field) return;
    const checkbox = [...document.querySelectorAll("[data-import-update-field]")]
      .find((input) => input.dataset.importUpdateField === field);
    if (checkbox) checkbox.checked = true;
    renderRows();
    showSuccess("Valor masivo preparado para el commit.");
  });

  document.getElementById("doPreviewImport").addEventListener("click", async () => {
    const fileInput = document.getElementById("importExcelFile");
    const resultEl = document.getElementById("importResult");
    if (!fileInput?.files?.length) { showWarning("Selecciona un archivo Excel."); return; }
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      const contractId = document.getElementById("importContractId")?.value || null;
      if (isAdmin && !contractId) {
        if (resultEl) resultEl.textContent = "Selecciona un contrato antes de importar.";
        return;
      }
      if (resultEl) resultEl.textContent = "Validando archivo...";
      try {
        const res = await apiFetch("/employee-import/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileBase64: e.target.result,
            fileName: file.name,
            contractId: contractId ? Number(contractId) : (Number(cu.contractId) || null),
            companyId:  cu.companyId  ? Number(cu.companyId)  : null,
          }),
        });
        setPreviewState(res);
        if (resultEl) resultEl.textContent = "Prevalidacion completada.";
      } catch (err) {
        if (resultEl) resultEl.innerHTML = `<span style="color:#dc2626">${escapeHtml(err.message)}</span>`;
      }
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("applyImportResolve").addEventListener("click", async () => {
    if (!currentBatchId) { showWarning("Primero previsualiza un archivo."); return; }
    const type = document.getElementById("importResolveType")?.value || "";
    const sourceValue = document.getElementById("importSourceValue")?.value || "";
    const targetEl = document.getElementById("importTargetValue");
    const targetId = targetEl?.value || "";
    const targetLabel = targetEl?.selectedOptions?.[0]?.dataset?.label || targetEl?.selectedOptions?.[0]?.textContent || "";
    if (!sourceValue || !targetId) { showWarning("Selecciona el valor del Excel y el valor correcto."); return; }
    try {
      const res = await apiFetch(`/employee-import/${currentBatchId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          sourceValue,
          target: { id: Number(targetId), label: targetLabel },
          applyToAll: true,
          saveAlias: document.getElementById("importSaveAlias")?.checked || false,
        }),
      });
      setPreviewState(res);
      showSuccess("Correccion aplicada a todos los casos iguales.");
    } catch (err) {
      showError(err.message);
    }
  });

  document.getElementById("commitImportPersonnel").addEventListener("click", async () => {
    if (!currentBatchId) return;
    try {
      const updateFields = [...document.querySelectorAll("[data-import-update-field]:checked")]
        .map((input) => input.dataset.importUpdateField)
        .filter(Boolean);
      const massField = document.getElementById("importMassField")?.value || "";
      const massValue = document.getElementById("importMassValue")?.value ?? "";
      const allowOverwriteEmpty = document.getElementById("importAllowOverwriteEmpty")?.checked || false;
      const overrideValues = massField && (massValue !== "" || allowOverwriteEmpty) ? { [massField]: massValue } : {};
      const contractIdForCommit = document.getElementById("importContractId")?.value || null;
      const res = await apiFetch(`/employee-import/${currentBatchId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updateFields,
          overrideValues,
          allowOverwriteEmpty,
          // Contexto del usuario para rellenar company/contract en filas sin esos datos
          contractId: contractIdForCommit ? Number(contractIdForCommit) : (Number(cu.contractId) || null),
          companyId:  cu.companyId ? Number(cu.companyId) : null,
        }),
      });
      setPreviewState(res);
      const imported = res.summary?.importedRows || 0;
      const updated  = res.summary?.updatedRows  || 0;
      const skipped  = res.summary?.skippedRows  || 0;
      const failed   = res.summary?.failedOnCommit || 0;
      const msg = `${imported} empleados creados, ${updated} actualizados, ${skipped} sin cambios${failed ? `, ${failed} con errores` : ""}.`;
      showSuccess(msg);
      if (imported > 0 || updated > 0) setTimeout(() => { close(); openModule(state.activeModule || "gestion_personal"); }, 1200);
    } catch (err) {
      showError(err.message);
    }
  });
}

async function downloadPersonnelBulkUpdateTemplate() {
  const token = state.token || localStorage.getItem("empiria_token") || "";
  const response = await fetch("/personnel/bulk-update/template", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    let message = "No fue posible descargar la plantilla.";
    try {
      const payload = await response.json();
      message = payload.message || message;
    } catch {}
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `plantilla_actualizacion_expediente_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function openBulkUpdatePersonnelModal() {
  document.getElementById("bulkUpdatePersonnelModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "bulkUpdatePersonnelModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card" style="max-width:1240px;width:min(1240px,96vw)">
      <div class="modal-header">
        <h3>Actualización masiva del expediente</h3>
        <button type="button" class="modal-close" id="closeBulkUpdatePersonnelModal">&#x2715;</button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:minmax(280px,340px) 1fr;gap:1rem;align-items:start">
          <section style="border:1px solid var(--border);border-radius:10px;padding:1rem;background:#fff">
            <button type="button" id="downloadBulkUpdateTemplate" class="btn btn-secondary" style="width:100%;margin-bottom:1rem">Descargar plantilla de actualización</button>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:.4rem">Archivo Excel</label>
            <input type="file" id="bulkUpdateExcelFile" accept=".xlsx,.xls" style="width:100%;padding:.55rem;border:1px solid var(--border);border-radius:8px;font-size:13px"/>
            <label style="display:flex;gap:.5rem;align-items:center;margin-top:1rem;font-size:12px;color:#475569">
              <input type="checkbox" id="bulkUpdateAllowOverwriteEmpty"/>
              Permitir limpiar campos vacíos
            </label>
            <label style="display:flex;gap:.5rem;align-items:center;margin-top:.55rem;font-size:12px;color:#475569">
              <input type="checkbox" id="bulkUpdateConfirmSensitive"/>
              Confirmar cambios sensibles de documento
            </label>
            <button type="button" class="btn btn-primary" id="previewBulkUpdatePersonnel" style="width:100%;margin-top:1rem">Previsualizar cambios</button>
            <button type="button" class="btn btn-secondary" id="downloadBulkUpdateErrors" style="display:none;width:100%;margin-top:.6rem">Descargar reporte de errores</button>
            <p id="bulkUpdateResult" style="margin-top:.8rem;font-size:13px;color:#475569"></p>
          </section>
          <section>
            <div id="bulkUpdateSummary" style="display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:.6rem;margin-bottom:1rem"></div>
            <div style="max-height:520px;overflow:auto;border:1px solid var(--border);border-radius:10px;background:#fff">
              <table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead style="position:sticky;top:0;background:var(--panel);z-index:1">
                  <tr>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Empleado</th>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Campo</th>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Valor actual</th>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Valor nuevo</th>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Tipo</th>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Personal</th>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Cobertura</th>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Nomina</th>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">SST</th>
                    <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Errores</th>
                  </tr>
                </thead>
                <tbody id="bulkUpdatePreviewBody">
                  <tr><td colspan="10" style="padding:1rem;color:#64748b">Carga una plantilla para ver la vista previa.</td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="applyBulkUpdatePersonnel" disabled>Aplicar cambios</button>
        <button type="button" class="btn btn-secondary" id="closeBulkUpdatePersonnelModal2">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  let currentPreview = null;
  let currentFileBase64 = "";
  let currentFileName = "";

  const close = () => modal.remove();
  modal.querySelector("#closeBulkUpdatePersonnelModal")?.addEventListener("click", close);
  modal.querySelector("#closeBulkUpdatePersonnelModal2")?.addEventListener("click", close);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });

  const renderSummary = () => {
    const wrap = modal.querySelector("#bulkUpdateSummary");
    if (!wrap) return;
    if (!currentPreview?.summary) {
      wrap.innerHTML = "";
      return;
    }
    const { totalRows, readyRows, skippedRows, errorRows, changeCount } = currentPreview.summary;
    const card = (label, value, color) => `
      <div style="border:1px solid var(--border);border-radius:10px;padding:.75rem;background:#fff">
        <span style="display:block;font-size:11px;color:#64748b">${label}</span>
        <strong style="font-size:22px;color:${color}">${Number(value || 0)}</strong>
      </div>`;
    wrap.innerHTML = [
      card("Filas", totalRows, "#0f172a"),
      card("Listas", readyRows, "#15803d"),
      card("Sin cambios", skippedRows, "#475569"),
      card("Errores", errorRows, "#dc2626"),
      card("Cambios", changeCount, "#2563eb"),
    ].join("");
    modal.querySelector("#applyBulkUpdatePersonnel").disabled = !readyRows;
    const errorBtn = modal.querySelector("#downloadBulkUpdateErrors");
    if (errorBtn) errorBtn.style.display = errorRows ? "" : "none";
  };

  const formatBulkUpdateRowErrors = (row) => {
    const detailed = Array.isArray(row?.validationErrors) ? row.validationErrors : [];
    if (detailed.length) {
      return detailed
        .map((issue) => {
          const field = issue.label || issue.field || "Campo";
          const received = issue.valueReceived ? ` Recibido: ${issue.valueReceived}.` : "";
          const valid = issue.validValuesText ? ` Válidos: ${issue.validValuesText}.` : "";
          return `${field}: ${issue.message || "Valor inválido."}${received}${valid}`;
        })
        .join(" ; ");
    }
    return (row?.errors || []).join("; ");
  };

  const renderRows = () => {
    const body = modal.querySelector("#bulkUpdatePreviewBody");
    if (!body) return;
    if (!currentPreview?.rows?.length) {
      body.innerHTML = `<tr><td colspan="10" style="padding:1rem;color:#64748b">No hay cambios para mostrar.</td></tr>`;
      return;
    }
    const html = [];
    currentPreview.rows.forEach((row) => {
      const errorText = formatBulkUpdateRowErrors(row);
      if (row.changes?.length) {
        row.changes.forEach((change, index) => {
          html.push(`
            <tr>
              <td style="padding:.55rem;border-bottom:1px solid var(--border)">${index === 0 ? escapeHtml(row.employee || "") : ""}</td>
              <td style="padding:.55rem;border-bottom:1px solid var(--border)">${escapeHtml(change.label || "")}</td>
              <td style="padding:.55rem;border-bottom:1px solid var(--border)">${escapeHtml(String(change.currentValue ?? ""))}</td>
              <td style="padding:.55rem;border-bottom:1px solid var(--border)">${escapeHtml(String(change.newValue ?? ""))}</td>
              <td style="padding:.55rem;border-bottom:1px solid var(--border)">${escapeHtml(change.changeType || "")}</td>
              <td style="padding:.55rem;border-bottom:1px solid var(--border)">${change.impacts?.personal ? "Si" : "No"}</td>
              <td style="padding:.55rem;border-bottom:1px solid var(--border)">${change.impacts?.coverage ? "Si" : "No"}</td>
              <td style="padding:.55rem;border-bottom:1px solid var(--border)">${change.impacts?.payroll ? "Si" : "No"}</td>
              <td style="padding:.55rem;border-bottom:1px solid var(--border)">${change.impacts?.sst ? "Si" : "No"}</td>
              <td style="padding:.55rem;border-bottom:1px solid var(--border);color:${errorText ? "#dc2626" : "#64748b"}">${escapeHtml(errorText || (row.payrollAlerts?.[0]?.message || ""))}</td>
            </tr>
          `);
        });
      } else {
        html.push(`
          <tr>
            <td style="padding:.55rem;border-bottom:1px solid var(--border)">${escapeHtml(row.employee || "")}</td>
            <td style="padding:.55rem;border-bottom:1px solid var(--border)">—</td>
            <td style="padding:.55rem;border-bottom:1px solid var(--border)">—</td>
            <td style="padding:.55rem;border-bottom:1px solid var(--border)">—</td>
            <td style="padding:.55rem;border-bottom:1px solid var(--border)">${escapeHtml(row.status || "")}</td>
            <td style="padding:.55rem;border-bottom:1px solid var(--border)">No</td>
            <td style="padding:.55rem;border-bottom:1px solid var(--border)">No</td>
            <td style="padding:.55rem;border-bottom:1px solid var(--border)">No</td>
            <td style="padding:.55rem;border-bottom:1px solid var(--border)">No</td>
            <td style="padding:.55rem;border-bottom:1px solid var(--border);color:${row.errors?.length ? "#dc2626" : "#64748b"}">${escapeHtml((row.errors || []).join("; ") || "Sin cambios")}</td>
          </tr>
        `);
      }
    });
    body.innerHTML = html.join("");
  };

  modal.querySelector("#downloadBulkUpdateTemplate")?.addEventListener("click", async () => {
    try {
      await downloadPersonnelBulkUpdateTemplate();
    } catch (error) {
      showError(error.message || "No fue posible descargar la plantilla.");
    }
  });

  modal.querySelector("#previewBulkUpdatePersonnel")?.addEventListener("click", async () => {
    const fileInput = modal.querySelector("#bulkUpdateExcelFile");
    const resultEl = modal.querySelector("#bulkUpdateResult");
    if (!fileInput?.files?.length) {
      showWarning("Selecciona un archivo Excel.");
      return;
    }
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = async (event) => {
      currentFileBase64 = event.target?.result || "";
      currentFileName = file.name;
      if (resultEl) resultEl.textContent = "Analizando archivo...";
      try {
        const response = await apiFetch("/personnel/bulk-update/preview", {
          method: "POST",
          body: JSON.stringify({
            fileBase64: currentFileBase64,
            fileName: currentFileName,
            allowOverwriteEmpty: modal.querySelector("#bulkUpdateAllowOverwriteEmpty")?.checked || false,
            confirmSensitiveChanges: modal.querySelector("#bulkUpdateConfirmSensitive")?.checked || false,
          }),
        });
        currentPreview = response.data || null;
        renderSummary();
        renderRows();
        if (resultEl) resultEl.textContent = "Vista previa generada.";
      } catch (error) {
        currentPreview = null;
        renderSummary();
        renderRows();
        if (resultEl) resultEl.innerHTML = `<span style="color:#dc2626">${escapeHtml(error.message || "No fue posible generar la vista previa.")}</span>`;
      }
    };
    reader.readAsDataURL(file);
  });

  modal.querySelector("#downloadBulkUpdateErrors")?.addEventListener("click", () => {
    if (!currentPreview?.rows?.length) return;
    const errorRows = currentPreview.rows
      .filter((row) => Array.isArray(row.errors) && row.errors.length)
      .flatMap((row) => {
        const detailed = Array.isArray(row.validationErrors) ? row.validationErrors : [];
        if (detailed.length) {
          return detailed.map((issue) => [
            row.rowNumber || "",
            row.employee || "",
            row.documentNumber || "",
            issue.label || issue.field || "",
            issue.valueReceived || "",
            issue.validValuesText || "",
            issue.message || "",
          ]);
        }
        return [[
          row.rowNumber || "",
          row.employee || "",
          row.documentNumber || "",
          "",
          "",
          "",
          (row.errors || []).join(" | "),
        ]];
      });
    if (!errorRows.length) {
      showWarning("No hay errores para exportar.");
      return;
    }
    exportToExcel(
      ["Fila", "Empleado", "Documento", "Campo", "Valor recibido", "Valores válidos", "Error"],
      errorRows,
      `errores_actualizacion_expediente_${new Date().toISOString().slice(0, 10)}`
    );
  });

  modal.querySelector("#applyBulkUpdatePersonnel")?.addEventListener("click", async () => {
    if (!currentFileBase64) {
      showWarning("Primero genera la vista previa.");
      return;
    }
    const resultEl = modal.querySelector("#bulkUpdateResult");
    if (resultEl) resultEl.textContent = "Aplicando cambios...";
    try {
      const response = await apiFetch("/personnel/bulk-update/apply", {
        method: "POST",
        body: JSON.stringify({
          fileBase64: currentFileBase64,
          fileName: currentFileName,
          allowOverwriteEmpty: modal.querySelector("#bulkUpdateAllowOverwriteEmpty")?.checked || false,
          confirmSensitiveChanges: modal.querySelector("#bulkUpdateConfirmSensitive")?.checked || false,
        }),
      });
      const data = response.data || {};
      showSuccess(`${data.appliedRows || 0} expedientes actualizados.`);
      if (resultEl) resultEl.textContent = `${data.appliedRows || 0} expedientes actualizados. ${data.errorRows || 0} filas con error.`;
      setTimeout(async () => {
        close();
        await openModule(state.activeModule || "gestion_personal");
      }, 1200);
    } catch (error) {
      if (resultEl) resultEl.innerHTML = `<span style="color:#dc2626">${escapeHtml(error.message || "No fue posible aplicar la actualización.")}</span>`;
      showError(error.message || "No fue posible aplicar la actualización.");
    }
  });
}

function openImportPersonnelModal() {
  document.getElementById("importPersonnelModal")?.remove();

  const cu           = state.currentUser || {};
  const isAdmin      = (cu.role || "").toLowerCase() === "administrador";
  const fixedContract = !isAdmin && cu.contractId ? String(cu.contractId) : null;

  // Build contract selector for admins
  const contractSelectorHtml = isAdmin
    ? `<label style="display:block;font-size:13px;font-weight:600;margin-bottom:.4rem;margin-top:.8rem">Contrato de destino *</label>
       <select id="importContractId" style="width:100%;padding:.5rem;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-bottom:.8rem">
         <option value="">— Selecciona un contrato —</option>
         ${(state.contracts || []).map(c =>
           `<option value="${escapeAttr(String(c.id))}">${escapeHtml(c.name || String(c.id))}</option>`
         ).join("")}
       </select>`
    : `<input type="hidden" id="importContractId" value="${escapeAttr(fixedContract || "")}">`;

  const modal = document.createElement("div");
  modal.id = "importPersonnelModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card" style="max-width:520px">
      <div class="modal-header">
        <h3>Importar personal desde Excel</h3>
        <button type="button" class="modal-close" id="closeImportModal">&#x2715;</button>
      </div>
      <div class="modal-body">
        <div style="margin-bottom:1rem;padding:.8rem 1rem;background:var(--panel-2);border-radius:8px;font-size:13px">
          <p style="font-weight:600;margin-bottom:.4rem">Pasos para importar:</p>
          <ol style="margin-left:1.2rem;line-height:1.7">
            <li>Descarga la plantilla Excel con el botón de abajo.</li>
            <li>Completa los datos respetando los encabezados.</li>
            <li>Guarda el archivo y súbelo aquí.</li>
          </ol>
        </div>
        ${contractSelectorHtml}
        <button type="button" id="btnDownloadTemplate" class="btn btn-secondary" style="width:100%;margin-bottom:1rem">Descargar plantilla (.xls)</button>
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:.4rem">Subir archivo Excel:</label>
        <input type="file" id="importExcelFile" accept=".xlsx,.xls" style="width:100%;padding:.5rem;border:1px solid var(--border);border-radius:6px;font-size:13px"/>
        <p id="importResult" style="margin-top:.8rem;font-size:13px"></p>
        <button type="button" id="btnDownloadResult" class="btn btn-secondary" style="display:none;width:100%;margin-top:.5rem">⬇ Descargar resultado de carga (.xlsx)</button>
        <p style="margin-top:.8rem;font-size:11px;color:#6b7280">Solo se marcan como DUPLICADOS los registros que ya existen en el mismo contrato.</p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="doImportPersonnel">Importar</button>
        <button type="button" class="btn btn-secondary" id="closeImportModal2">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById("closeImportModal").addEventListener("click", close);
  document.getElementById("closeImportModal2").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  document.getElementById("btnDownloadTemplate").addEventListener("click", () => {
    exportToExcel(
      [
        "PRIMER NOMBRE","SEGUNDO NOMBRE","PRIMER APELLIDO","SEGUNDO APELLIDO",
        "TIPO DOCUMENTO","NUMERO DOCUMENTO",
        "DIA NACIMIENTO","MES NACIMIENTO","ANO NACIMIENTO","PAIS NACIMIENTO","DEPARTAMENTO NACIMIENTO","MUNICIPIO NACIMIENTO",
        "DIA EXPEDICION","MES EXPEDICION","ANO EXPEDICION","DEPARTAMENTO EXPEDICION","MUNICIPIO EXPEDICION",
        "TIPO SANGRE","SEXO",
        "CELULAR","CORREO","DIRECCION","BARRIO","ESTADO CIVIL",
        "CARGO REAL","TIPO JORNADA","ESTADO","GESTOR ZONA",
        "MUNICIPIO OPERACION","INSTITUCION EDUCATIVA","SEDE EDUCATIVA","MODALIDAD",
        "EPS","FONDO PENSIONES","CAJA COMPENSACION","ARL",
        "FECHA VINCULACION ARL","FECHA INICIO COBERTURA",
      ],
      [[
        "JUAN","CARLOS","PEREZ","GARCIA",
        "CC","12345678",
        "5","3","1990","COLOMBIA","META","ACACIAS",
        "10","7","2008","META","ACACIAS",
        "O+","MASCULINO",
        "3101234567","juan@email.com","CRA 5 #10-20","CENTRO","SOLTERO",
        "OPERARIO MANIPULADOR DE ALIMENTOS","TC","ACTIVO","ZONA 1",
        "Acacías","INST. EDUCATIVA EJEMPLO","SEDE PRINCIPAL","CAA",
        "COMPENSAR","COLPENSIONES","COFREM","SURA",
        "2024-01-15","2024-02-01",
      ]],
      "plantilla_importacion_personal"
    );
  });

  document.getElementById("doImportPersonnel").addEventListener("click", async () => {
    const fileInput = document.getElementById("importExcelFile");
    const resultEl  = document.getElementById("importResult");
    const dlBtn     = document.getElementById("btnDownloadResult");
    if (!fileInput?.files?.length) { showWarning("Selecciona un archivo Excel."); return; }
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64     = e.target.result;
      const contractId = document.getElementById("importContractId")?.value || null;
      if (isAdmin && !contractId) {
        if (resultEl) resultEl.textContent = "Selecciona un contrato antes de importar.";
        return;
      }
      if (resultEl) resultEl.textContent = "Importando…";
      if (dlBtn) dlBtn.style.display = "none";
      try {
        const res = await apiFetch("/personnel/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileBase64: base64,
            fileName: file.name,
            contractId: contractId ? Number(contractId) : (Number(cu.contractId) || null),
            companyId:  cu.companyId  ? Number(cu.companyId)  : null,
          }),
        });
        const d = res.data || {};
        const created  = d.created  || 0;
        const skipped  = d.skipped  || 0;
        const errored  = d.errored  || 0;
        if (resultEl) resultEl.innerHTML =
          `<span style="color:#15803d;font-weight:600">✔ ${created} creados</span>&nbsp;`
          + `<span style="color:#d97706">⚠ ${skipped} duplicados</span>&nbsp;`
          + (errored ? `<span style="color:#dc2626">✖ ${errored} errores</span>` : "");

        if (d.resultExcelBase64 && dlBtn) {
          dlBtn.style.display = "";
          dlBtn.onclick = () => {
            const link = document.createElement("a");
            link.href = d.resultExcelBase64;
            link.download = `resultado_importacion_${new Date().toISOString().slice(0,10)}.xlsx`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          };
        }
        showSuccess(`Importación: ${created} creados, ${skipped} duplicados rechazados`);
        if (created > 0) setTimeout(() => { close(); openModule(state.activeModule || "gestion_personal"); }, 2500);
      } catch (err) {
        if (resultEl) resultEl.innerHTML = `<span style="color:#dc2626">✖ ${escapeHtml(err.message)}</span>`;
      }
    };
    reader.readAsDataURL(file);
  });
}

// ── Modal de eliminación segura de empleado ───────────────────────────────────
function openDeleteEmployeeModal(employeeId, employeeName) {
  const existing = document.getElementById("delEmpModal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "delEmpModal";
  overlay.innerHTML = `
<style>
#delEmpModal{position:fixed;inset:0;background:rgba(15,23,42,.48);display:flex;align-items:center;justify-content:center;z-index:2000;padding:16px}
.del-emp-dialog{background:#fff;border-radius:14px;width:100%;max-width:460px;box-shadow:0 20px 60px rgba(0,0,0,.22);overflow:hidden}
.del-emp-header{display:flex;align-items:center;gap:12px;padding:20px 20px 0}
.del-emp-icon{width:40px;height:40px;border-radius:10px;background:#FEF2F2;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.del-emp-icon svg{width:20px;height:20px;stroke:#DC2626;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.del-emp-title{font-size:15px;font-weight:700;color:#0F172A}
.del-emp-body{padding:18px 20px 20px;display:flex;flex-direction:column;gap:14px}
.del-emp-warning{background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:12px 14px;font-size:12.5px;color:#92400E;line-height:1.6}
.del-emp-field label{display:block;font-size:11.5px;font-weight:700;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em}
.del-emp-pw{width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:13px;color:#0F172A;outline:none;transition:border-color .15s;box-sizing:border-box}
.del-emp-pw:focus{border-color:#DC2626}
.del-emp-error{font-size:12px;color:#DC2626;min-height:16px;margin-top:-8px}
.del-emp-footer{display:flex;gap:10px;justify-content:flex-end;padding-top:4px}
.del-emp-btn{border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s}
.del-emp-btn-cancel{background:#F1F5F9;color:#475569}.del-emp-btn-cancel:hover{background:#E2E8F0}
.del-emp-btn-confirm{background:#DC2626;color:#fff}.del-emp-btn-confirm:hover{background:#B91C1C}.del-emp-btn-confirm:disabled{opacity:.55;cursor:not-allowed}
</style>
<div class="del-emp-dialog">
  <div class="del-emp-header">
    <div class="del-emp-icon">
      <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
    </div>
    <div>
      <div class="del-emp-title">Eliminar empleado</div>
      <div style="font-size:12px;color:#64748B;margin-top:2px">${escapeHtml(employeeName || "")}</div>
    </div>
  </div>
  <div class="del-emp-body">
    <div class="del-emp-warning">
      Está a punto de eliminar este empleado.<br>
      Esta acción puede afectar información histórica relacionada con nómina, novedades, remisiones, cobertura y documentación.<br><br>
      <b>Si el empleado tiene historial</b>, será inactivado (baja lógica) y su información se conservará.<br>
      <b>Si no tiene registros</b>, será eliminado definitivamente.
    </div>
    <div class="del-emp-field">
      <label>Contraseña de administrador</label>
      <input type="password" class="del-emp-pw" id="delEmpPassword" placeholder="Ingrese su contraseña" autocomplete="current-password">
    </div>
    <div class="del-emp-error" id="delEmpError"></div>
    <div class="del-emp-footer">
      <button class="del-emp-btn del-emp-btn-cancel" id="delEmpCancel">Cancelar</button>
      <button class="del-emp-btn del-emp-btn-confirm" id="delEmpConfirm">Continuar</button>
    </div>
  </div>
</div>`;

  document.body.appendChild(overlay);

  const pwInput   = document.getElementById("delEmpPassword");
  const errorEl   = document.getElementById("delEmpError");
  const confirmBtn= document.getElementById("delEmpConfirm");
  const cancelBtn = document.getElementById("delEmpCancel");

  const closeModal = () => overlay.remove();

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  cancelBtn.addEventListener("click", closeModal);
  pwInput.focus();

  confirmBtn.addEventListener("click", async () => {
    errorEl.textContent = "";
    const password = pwInput.value.trim();
    if (!password) { errorEl.textContent = "La contraseña es obligatoria."; pwInput.focus(); return; }

    confirmBtn.disabled = true;
    confirmBtn.textContent = "Procesando…";

    try {
      const res = await apiFetch(`/personnel/${employeeId}`, {
        method: "DELETE",
        body: JSON.stringify({ password }),
      });
      closeModal();
      if (res.action === "INACTIVACION") {
        showSuccess("Empleado inactivado correctamente. Su historial permanecerá disponible para consulta.");
      } else {
        showSuccess("Empleado eliminado correctamente.");
      }
      // Refrescar tabla
      state.personnelSelectedId = null;
      await openModule(state.activeModule || "gestion_personal");
    } catch (err) {
      const msg = err.message || "Error al procesar la solicitud.";
      errorEl.textContent = msg.includes("401") || msg.toLowerCase().includes("incorrecta")
        ? "Contraseña incorrecta."
        : msg;
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Continuar";
      pwInput.focus();
    }
  });

  pwInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmBtn.click();
  });
}
