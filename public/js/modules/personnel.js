import { state } from '../state.js';
import { apiFetch } from '../api.js';
import {
  escapeHtml, escapeAttr, printHtml, savePdf, exportToExcel, renderOptions,
  getPersonnelFullName, getPersonnelRole, getPersonnelMunicipality,
  isInstitutionalTabEnabled, syncPersonnelDraftField, enforceInputRestrictions,
  syncEmployeeHeaderFromDraft, getDepartmentMunicipalities,
  getCompanyOptionsHtml, getContractOptionsHtml, formatCompany, formatContract,
  ensureOfficialMunicipalitiesLoaded, getOfficialMunicipalities,
  findOfficialMunicipality, normalizeMunicipalityText,
} from '../utils.js';
import {
  COLOMBIA_DEPARTMENTS, LICITACION_CARGOS,
  CARGOS_REALES, ESTADOS_PERSONAL, BANKS,
} from '../constants.js';
import { showError, showSuccess, showWarning } from '../toast.js';
import { openModule } from '../nav.js';

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
    return {
      total,
      validated,
      pending,
      rejected,
      expired,
      expiring: 0,
      missing,
      percent: total ? Math.round((validated / total) * 100) : 0,
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
      .filter((doc) => _norm(doc.documentType) === _norm(req.name))
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
  const percent = total ? Math.round((validated / total) * 100) : 100;

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

function buildPersonnelDetailPanel(employee, allDocuments = []) {
  if (!employee) {
    return `
      <div class="pnl-empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
        </svg>
        <p>Selecciona un empleado para ver su expediente</p>
      </div>
    `;
  }

  const docMetrics    = getPersonnelDocumentMetrics(employee, allDocuments);
  const fullName      = getPersonnelFullName(employee);
  const role          = getPersonnelRole(employee);
  const documentNumber = getPersonnelDocument(employee);
  const workStatus    = getPersonnelWorkStatus(employee);
  const contractStart = formatUiDate(getPersonnelCoverageStart(employee));
  const contractEnd   = formatUiDate(employee.terminationDate || employee.fecha_retiro || "");
  const birthDate     = getPersonnelBirthDate(employee);
  const age           = getPersonnelAge(employee);
  const category      = getPersonnelCategory(employee);
  const docType       = escapeHtml(employee.documentType || employee.tipo_documento || "CC");
  const pct           = Math.max(0, Math.min(100, docMetrics.percent));
  const barColor      = pct >= 80 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626";
  const birthStr      = birthDate
    ? `${escapeHtml(formatUiDate(birthDate))}${age ? ` · ${escapeHtml(age)}` : ""}`
    : "—";
  const sexLabel = { F: "Femenino", M: "Masculino" }[String(employee.biologicalSex || employee.sex || "").toUpperCase()] || "—";

  const obsArr = Array.isArray(employee.observations)
    ? employee.observations.slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 6)
    : [];

  const avatarContent = employee.photoUrl
    ? `<img src="${escapeAttr(employee.photoUrl)}" alt="Foto" class="cv-photo-img" />`
    : `<span class="cv-photo-initials" style="${getPersonnelAvatarStyle(employee)}">${escapeHtml(getPersonnelInitials(employee))}</span>`;

  const statusCls = workStatus === "ACTIVO"   ? "pnl-chip-green"
                  : workStatus === "INACTIVO" ? "pnl-chip-red"
                  : "pnl-chip-gray";

  const row = (lbl, val, cls = "") =>
    `<div class="pnl-row">
       <span class="pnl-lbl">${lbl}</span>
       <span class="pnl-val${cls ? " " + cls : ""}">${val}</span>
     </div>`;

  return `
    <article class="pnl-card">

      <!-- ── HEADER ──────────────────────────────────── -->
      <div class="pnl-head">
        <button type="button" class="pnl-close-btn" data-clear-personnel-selection aria-label="Cerrar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <div class="pnl-avatar-wrap" data-photo-upload-id="${escapeAttr(employee.id)}">
          ${avatarContent}
          <div class="cv-photo-overlay">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>Subir Foto</span>
          </div>
          <input type="file" class="cv-photo-input" accept="image/*" style="display:none" />
        </div>

        <div class="pnl-head-info">
          <div class="pnl-head-name">${escapeHtml(fullName)}</div>
          <div class="pnl-head-role">${escapeHtml(role)}</div>
          <div class="pnl-head-doc">${docType} · ${escapeHtml(documentNumber)}</div>
          <div class="pnl-head-chips">
            <span class="pnl-chip ${statusCls}">${escapeHtml(workStatus)}</span>
            <span class="pnl-chip pnl-chip-gray">${escapeHtml(category)}</span>
          </div>
        </div>
      </div>

      <!-- ── ACTIONS ─────────────────────────────────── -->
      <div class="pnl-acts">
        <button type="button" class="pnl-act" data-edit-personnel-id="${escapeAttr(employee.id)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Editar
        </button>
        <button type="button" class="pnl-act" data-documents-personnel-id="${escapeAttr(employee.id)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          Documentos
        </button>
        <button type="button" class="pnl-act pnl-act-prime" data-cv-personnel-id="${escapeAttr(employee.id)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          Ver HV
        </button>
      </div>

      <!-- ── TABS ────────────────────────────────────── -->
      <div class="pnl-tabs">
        <button type="button" class="pnl-tab pnl-tab-active" data-panel-tab="personal">
          <svg class="pnl-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
          </svg>
          <span class="pnl-tab-lbl">Personal</span>
        </button>
        <button type="button" class="pnl-tab" data-panel-tab="laboral">
          <svg class="pnl-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
          </svg>
          <span class="pnl-tab-lbl">Laboral</span>
        </button>
        <button type="button" class="pnl-tab" data-panel-tab="docs">
          <svg class="pnl-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <span class="pnl-tab-lbl">Docs</span>
        </button>
        <button type="button" class="pnl-tab" data-panel-tab="notas">
          <svg class="pnl-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span class="pnl-tab-lbl">Notas</span>
        </button>
      </div>

      <!-- ── BODY ────────────────────────────────────── -->
      <div class="pnl-body">

        <!-- TAB: PERSONAL -->
        <div class="pnl-section pnl-sec-active" data-panel-section="personal">
          <div class="pnl-group-lbl">DATOS PERSONALES</div>
          ${row("Nacimiento", birthStr)}
          ${row("Sexo", sexLabel)}
          ${row("Grupo sang.", escapeHtml(employee.bloodType || employee.grupo_sanguineo || "—"))}
          ${row("Teléfono", escapeHtml(employee.phone || employee.celular || "—"))}
          ${row("Correo", escapeHtml(employee.email || employee.correo_electronico || "—"), "pnl-ellipsis")}
          ${row("Dirección", escapeHtml(employee.address || employee.direccion_residencia || "—"))}
          <div class="pnl-group-lbl">SEGURIDAD SOCIAL</div>
          ${row("EPS", escapeHtml(getPersonnelEps(employee)))}
          ${row("ARL", escapeHtml(getPersonnelArl(employee)))}
          ${row("Pensión", escapeHtml(employee.pensionFund || employee.fondo_pensiones || "—"))}
          ${row("Caja comp.", escapeHtml(employee.compensationBox || employee.caja_compensacion || "COFREM"))}
        </div>

        <!-- TAB: LABORAL -->
        <div class="pnl-section" data-panel-section="laboral">
          <div class="pnl-group-lbl">CARGO Y CONTRATO</div>
          ${row("Cargo real", escapeHtml(role))}
          ${row("Empresa", escapeHtml(getPersonnelCompanyLabel(employee)))}
          ${row("Contrato", escapeHtml(getPersonnelContractLabel(employee)))}
          ${row("Salario", escapeHtml(getPersonnelSalary(employee)))}
          <div class="pnl-group-lbl">ASIGNACIÓN</div>
          ${row("Municipio", escapeHtml(employee.municipality || employee.municipio_cobertura || employee.municipio || "—"))}
          ${row("Institución", escapeHtml(getPersonnelInstitution(employee)))}
          ${row("Sede", escapeHtml(getPersonnelSite(employee)))}
          ${row("Modalidad", escapeHtml(getPersonnelModality(employee)))}
          ${row("Gestor zona", escapeHtml(employee.gestorZona || employee.gestor_zona || "—"))}
          <div class="pnl-group-lbl">FECHAS</div>
          ${row("Ingreso", escapeHtml(contractStart))}
          ${contractEnd ? row("Retiro", escapeHtml(contractEnd)) : ""}
        </div>

        <!-- TAB: DOCS -->
        <div class="pnl-section" data-panel-section="docs">
          <div class="pnl-doc-summary">
            <div class="pnl-doc-pct-wrap">
              <span class="pnl-doc-pct-num" style="color:${barColor}">${pct}%</span>
              <span class="pnl-doc-pct-sub">completado</span>
            </div>
            <div class="pnl-doc-track">
              <div class="pnl-doc-fill" style="width:${pct}%;background:${barColor}"></div>
            </div>
          </div>
          <div class="pnl-doc-stats">
            <div class="pnl-doc-stat">
              <div class="pnl-doc-stat-n" style="color:#16a34a">${docMetrics.validated}</div>
              <div class="pnl-doc-stat-l">Al día</div>
            </div>
            <div class="pnl-doc-stat">
              <div class="pnl-doc-stat-n" style="color:#d97706">${docMetrics.pending + docMetrics.missing}</div>
              <div class="pnl-doc-stat-l">Pendientes</div>
            </div>
            <div class="pnl-doc-stat">
              <div class="pnl-doc-stat-n" style="color:#f59e0b">${docMetrics.expiring}</div>
              <div class="pnl-doc-stat-l">Por vencer</div>
            </div>
            <div class="pnl-doc-stat">
              <div class="pnl-doc-stat-n" style="color:#dc2626">${docMetrics.expired + docMetrics.rejected}</div>
              <div class="pnl-doc-stat-l">Vencidos</div>
            </div>
          </div>
          <div class="pnl-group-lbl" style="margin-top:14px">GESTIÓN</div>
          <button type="button" class="pnl-docs-link" data-documents-personnel-id="${escapeAttr(employee.id)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            Ver y gestionar documentos
          </button>
        </div>

        <!-- TAB: NOTAS -->
        <div class="pnl-section" data-panel-section="notas">
          ${obsArr.length ? obsArr.map(obs => `
            <div class="pnl-obs">
              <div class="pnl-obs-meta">
                <span class="pnl-obs-user">${escapeHtml(obs.user || "Sistema")}</span>
                <span class="pnl-obs-date">${escapeHtml(formatUiDate(obs.date || ""))}</span>
              </div>
              <p class="pnl-obs-text">${escapeHtml(obs.text || "")}</p>
            </div>
          `).join("") : `
            <div class="pnl-empty-tab">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <p>Sin novedades registradas</p>
            </div>
          `}
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
  const found = findOfficialMunicipality(municipalityId, { includeFallback: true });
  return found?.name || "";
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
  const id = getDraftMunicipalityId(draft);
  return getPersonnelMunicipalityNameById(id)
    || String(draft.municipalityName || draft.municipality_name || draft.municipality || draft.municipio || "").trim();
}

function syncDraftOfficialMunicipality(draft = state.personnelDraft || {}) {
  const municipalityId = getDraftMunicipalityId(draft);
  draft.municipalityId = municipalityId;
  draft.municipality_id = municipalityId;
  const municipalityName = municipalityId
    ? getPersonnelMunicipalityNameById(municipalityId)
    : String(draft.municipalityName || draft.municipality_name || draft.municipality || draft.municipio || "").trim();
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
  const activeTab = state.personnelCreateTab;

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

  let html = "";
  if      (activeTab === "identificacion")  html = buildTabIdentificacion(dv, expeditionDepartment, birthDepartment, state.personnelViewMode === "edit");
  else if (activeTab === "vinculacion")     html = buildTabVinculacion(dv, vinculationCompanyId, gestorNames, auxiliarGestorNames, gestorStatusMessage);
  else if (activeTab === "licitacion")      html = buildTabLicitacion(dv, selected);
  else if (activeTab === "datos_personales") html = buildTabDatosPersonales(dv, residenceMunicipality);
  else if (activeTab === "institucional")   html = buildTabInstitucional(
    dv, institutionalEnabled, managerRole,
    institutionalMunicipality, municipalityNameResolved,
    institutionalMunicipalities,
    institutionNames, selectedInstitution,
    sedeNames, selectedSede,
    modalidadCatalog, selectedModality,
    normalizeCatalogText,
    educationalCatalogMeta?.message || ""
  );
  else if (activeTab === "contratacion")    html = buildTabContratacion(dv, currentCargoReal);
  else if (activeTab === "seguimiento")     html = buildTabSeguimiento(dv);
  else if (activeTab === "estudios")        html = buildTabEstudios(dv);
  else if (activeTab === "experiencia")     html = buildTabExperiencia(draft);
  else if (activeTab === "observaciones")   html = buildTabObservaciones(dv);

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
    const isDisabled = key === "institucional" && !institutionalEnabled;
    btn.disabled = isDisabled;
    btn.classList.toggle("disabled", isDisabled);

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
  return true;
}

// ── Tab buttons template ──────────────────────────────────────────────────────

function buildTabButtons(activeTab, institutionalEnabled) {
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

// ── Catalog helpers ───────────────────────────────────────────────────────────

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
  const expeditionMunicipalities = getDepartmentMunicipalities(expeditionDepartment);
  const birthMunicipalities      = getDepartmentMunicipalities(birthDepartment);
  const isAdmin = (state.currentUser?.role || "").toLowerCase() === "administrador";
  // Non-admins: everything locked in edit mode. Admins: freely editable.
  const locked  = isEditMode && !isAdmin;
  const lock    = locked ? "disabled" : "";
  const ro      = locked ? "readonly"  : "";

  return `
    <section class="personnel-section">

      ${isEditMode && !isAdmin ? `
        <div class="id-lock-banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Los datos de identificación están bloqueados. Para modificarlos contacte al administrador.
        </div>
      ` : ""}

      <div class="form-grid form-grid-4">
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

      <div class="form-grid form-grid-2">
        <label>
          <span>Tipo de Documento *</span>
          <select name="documentType" ${lock} ${!isEditMode ? "required" : ""}>
            ${renderOptions(["CC", "PA", "PPT", "CE", "NIT"], draftValue("documentType"), "Selecciona")}
          </select>
        </label>
        <label>
          <span>Número de Documento *</span>
          <input name="documentNumber" data-only-numbers type="text"
            value="${escapeAttr(draftValue("documentNumber"))}" ${ro} ${!isEditMode ? "required" : ""} />
        </label>
      </div>

      <div class="form-grid form-grid-date-5">
        <label>
          <span>Día exp.</span>
          <input name="expeditionDay" data-only-numbers type="text" maxlength="2"
            placeholder="DD"
            value="${escapeAttr(draftValue("expeditionDay"))}" ${ro} />
        </label>
        <label>
          <span>Mes exp.</span>
          <input name="expeditionMonth" data-only-numbers type="text" maxlength="2"
            placeholder="MM"
            value="${escapeAttr(draftValue("expeditionMonth"))}" ${ro} />
        </label>
        <label>
          <span>Año exp.</span>
          <input name="expeditionYear" data-only-numbers type="text" maxlength="4"
            placeholder="AAAA"
            value="${escapeAttr(draftValue("expeditionYear"))}" ${ro} />
        </label>
        <label>
          <span>Departamento expedición *</span>
          <select name="expeditionDepartment" ${lock}>
            ${renderOptions(COLOMBIA_DEPARTMENTS, expeditionDepartment, "Selecciona")}
          </select>
        </label>
        <label>
          <span>Municipio expedición *</span>
          <select name="expeditionMunicipality" ${lock}>
            ${renderOptions(
              expeditionMunicipalities,
              draftValue("expeditionMunicipality"),
              expeditionDepartment ? "Selecciona" : "Selecciona depto. primero"
            )}
          </select>
        </label>
      </div>

      <div class="form-grid form-grid-date-6">
        <label>
          <span>Día nac.</span>
          <input name="birthDay" data-only-numbers type="text" maxlength="2"
            placeholder="DD"
            value="${escapeAttr(draftValue("birthDay"))}" ${ro} />
        </label>
        <label>
          <span>Mes nac.</span>
          <input name="birthMonth" data-only-numbers type="text" maxlength="2"
            placeholder="MM"
            value="${escapeAttr(draftValue("birthMonth"))}" ${ro} />
        </label>
        <label>
          <span>Año nac.</span>
          <input name="birthYear" data-only-numbers type="text" maxlength="4"
            placeholder="AAAA"
            value="${escapeAttr(draftValue("birthYear"))}" ${ro} />
        </label>
        <label>
          <span>País nacimiento *</span>
          <input name="birthCountry" data-only-letters type="text"
            value="${escapeAttr(draftValue("birthCountry", "Colombia"))}" ${ro} />
        </label>
        <label>
          <span>Departamento nacimiento *</span>
          <select name="birthDepartment" ${lock}>
            ${renderOptions(COLOMBIA_DEPARTMENTS, birthDepartment, "Selecciona")}
          </select>
        </label>
        <label>
          <span>Municipio nacimiento *</span>
          <select name="birthMunicipality" ${lock}>
            ${renderOptions(
              birthMunicipalities,
              draftValue("birthMunicipality"),
              birthDepartment ? "Selecciona" : "Selecciona depto. primero"
            )}
          </select>
        </label>
      </div>

      <div class="form-grid form-grid-2">
        <label>
          <span>Grupo Sanguíneo *</span>
          <select name="bloodType" ${lock}>
            ${renderOptions(["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"], draftValue("bloodType"), "Selecciona")}
          </select>
        </label>
        <label>
          <span>Sexo *</span>
          <select name="biologicalSex" ${lock}>
            ${renderOptions(["F", "M"], draftValue("biologicalSex"), "Selecciona")}
          </select>
        </label>
      </div>
    </section>
  `;
}

// ── Part 5: tabs vinculacion, licitacion, datos_personales ───────────────────

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
      <div class="form-grid form-grid-2">
        <label>
          <span>Celular *</span>
          <input name="phone" data-only-numbers type="text"
            value="${escapeAttr(draftValue("phone"))}" required />
        </label>
        <label>
          <span>Correo Electrónico *</span>
          <input name="email" type="email"
            value="${escapeAttr(draftValue("email"))}" required />
        </label>
      </div>

      <div class="form-grid form-grid-2">
        <label>
          <span>Estado Civil</span>
          <select name="civilStatus">
            ${renderOptions(
              ["soltero", "casado", "union_libre", "separado", "divorciado", "viudo"],
              draftValue("civilStatus"),
              "Selecciona"
            )}
          </select>
        </label>
        <label>
          <span>Barrio de Residencia</span>
          <input name="neighborhood" type="text"
            value="${escapeAttr(draftValue("neighborhood"))}" />
        </label>
      </div>

      <div class="form-grid form-grid-1">
        <label>
          <span>Dirección de Residencia *</span>
          <input name="address" type="text"
            value="${escapeAttr(draftValue("address"))}" required />
        </label>
      </div>

      <div class="form-grid form-grid-3">
        <label>
          <span>Departamento *</span>
          <input name="residenceDepartment" type="text" value="Meta" readonly />
        </label>
        <label>
          <span>Municipio *</span>
          <select name="residenceMunicipality" required>
            ${renderOptions(municipalityOptions, residenceMunicipality, "Selecciona municipio")}
          </select>
        </label>
        <label>
          <span>Zona de Residencia</span>
          <select name="residenceZone">
            ${renderOptions(["urbano", "rural"], draftValue("residenceZone"), "Selecciona")}
          </select>
        </label>
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
                <a href="${escapeAttr(o.attachmentUrl)}" target="_blank" rel="noopener">
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
          <span>Adjuntar archivo (PDF o imagen) — opcional</span>
          <input id="obsAttachmentInput" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
            style="margin-top:4px" />
          <span style="font-size:11px;color:var(--text-faint)">
            El archivo se guarda en el historial laboral y no aparece en la hoja de vida.
          </span>
        </label>
      </div>

      <div style="margin-top:10px">
        <button type="button" id="btnAddObservacion" class="btn btn-primary btn-row">Guardar observación</button>
        <span id="obsUploadStatus" style="margin-left:.8rem;font-size:13px;color:var(--text-faint)"></span>
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
  if (!state.personnelCreateTab)  state.personnelCreateTab = "identificacion";

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
  const activeTab = state.personnelCreateTab;

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
        state.personnelCreateTab  = "identificacion";
        state.personnelSelectedId = "__none__";
        state.personnelSavedTabs  = null;
        await openModule("gestion_personal");
      });
    }

    // ── Tab navigation — swap sin re-render completo ──────────────────────
    document.querySelectorAll("[data-step-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        state.personnelCreateTab = btn.dataset.stepTab;
        _refreshPersonnelSection();
      });
    });

    // ── Campos reactivos y sync — delegation sobre el form ───────────────
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

      // Auto-vencimiento SISBEN (+4 meses) y certificado de residencia (+6 meses)
      if (e.target.name === "sisbenIssueDate" && e.target.value) {
        const exp = new Date(e.target.value + "T00:00:00");
        exp.setMonth(exp.getMonth() + 4);
        const expStr = exp.toISOString().slice(0, 10);
        state.personnelDraft.sisbenExpirationDate = expStr;
        const expInput = form.querySelector('[name="sisbenExpirationDate"]');
        if (expInput) expInput.value = expStr;
        return;
      }
      if (e.target.name === "residenceCertificateIssueDate" && e.target.value) {
        const exp = new Date(e.target.value + "T00:00:00");
        exp.setMonth(exp.getMonth() + 6);
        const expStr = exp.toISOString().slice(0, 10);
        state.personnelDraft.residenceCertificateExpiration = expStr;
        const expInput = form.querySelector('[name="residenceCertificateExpiration"]');
        if (expInput) expInput.value = expStr;
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
        return;
      }
      if (e.target.name === "foodHandlingExamIssueDate" && e.target.value) {
        const exp = new Date(e.target.value);
        exp.setFullYear(exp.getFullYear() + 1);
        const expStr = exp.toISOString().slice(0, 10);
        state.personnelDraft.foodHandlingExamExpirationDate = expStr;
        const expInput = form.querySelector('[name="foodHandlingExamExpirationDate"]');
        if (expInput) expInput.value = expStr;
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
          if (state.personnelCreateTab === "institucional")
            state.personnelCreateTab = "licitacion";
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

      syncEmployeeHeaderFromDraft();
    });

    enforceInputRestrictions(document.getElementById("personnelActiveSection") || form);
    attachPersonnelFormValidation(form);
    syncEmployeeHeaderFromDraft();
    form.addEventListener("submit", handlePersonnelFormSubmit);

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
        state.personnelCreateTab = "estudios";
        _refreshPersonnelSection();
        return;
      }
      // Estudios: eliminar
      const removeEstudio = e.target.closest(".btn-remove-estudio");
      if (removeEstudio) {
        const idx = parseInt(removeEstudio.dataset.studyIndex, 10);
        if (!Array.isArray(state.personnelDraft.studies)) return;
        state.personnelDraft.studies.splice(idx, 1);
        state.personnelCreateTab = "estudios";
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
        state.personnelCreateTab = "experiencia";
        _refreshPersonnelSection();
        return;
      }
      // Experiencia: eliminar
      const removeExp = e.target.closest(".btn-remove-experiencia");
      if (removeExp) {
        const idx = parseInt(removeExp.dataset.expIndex, 10);
        if (!Array.isArray(state.personnelDraft.workExperience)) return;
        state.personnelDraft.workExperience.splice(idx, 1);
        state.personnelCreateTab = "experiencia";
        _refreshPersonnelSection();
        return;
      }
    });

    // ── Observaciones (async — delegation separada) ───────────────────────
    form.addEventListener("click", async (e) => {
      if (!e.target.closest("#btnAddObservacion")) return;
      const txt      = (document.getElementById("newObservationText")?.value || "").trim();
      const statusEl = document.getElementById("obsUploadStatus");
      if (!txt) { showWarning("Escribe la observación antes de guardar."); return; }

      const fileInput = document.getElementById("obsAttachmentInput");
      let attachmentUrl = "", attachmentName = "";
      if (fileInput?.files?.length > 0) {
        const file = fileInput.files[0];
        attachmentName = file.name;
        if (statusEl) statusEl.textContent = "Subiendo archivo...";
        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("employeeId", state.personnelEditingId || state.personnelDraft.id || "");
          const res  = await fetch("/documents/upload", {
            method: "POST",
            headers: { Authorization: `Bearer ${state.token}` },
            body: fd,
          });
          const data = await res.json();
          if (data.ok && data.url) attachmentUrl = data.url;
        } catch {
          if (statusEl) statusEl.textContent = "No se pudo subir el archivo.";
        }
      }
      if (!Array.isArray(state.personnelDraft.observations)) state.personnelDraft.observations = [];
      state.personnelDraft.observations.push({
        text: txt,
        date: new Date().toISOString(),
        user: state.currentUser?.name || "Usuario",
        ...(attachmentUrl ? { attachmentUrl, attachmentName } : {}),
      });
      state.personnelCreateTab = "observaciones";
      _refreshPersonnelSection();
    });
  }, 0);

  // ── Tab section ───────────────────────────────────────────────────────────

  let activeSectionHtml = "";

  if (activeTab === "identificacion") {
    activeSectionHtml = buildTabIdentificacion(draftValue, expeditionDepartment, birthDepartment, isEditMode);
  }

  if (activeTab === "vinculacion") {
    activeSectionHtml = buildTabVinculacion(
      draftValue,
      vinculationCompanyId,
      gestorNames,
      auxiliarGestorNames,
      gestorStatusMessage
    );
  }

  if (activeTab === "licitacion") {
    activeSectionHtml = buildTabLicitacion(draftValue, selected);
  }

  if (activeTab === "datos_personales") {
    activeSectionHtml = buildTabDatosPersonales(draftValue, residenceMunicipality);
  }

  if (activeTab === "institucional") {
    activeSectionHtml = buildTabInstitucional(
      draftValue, institutionalEnabled, managerRole,
      institutionalMunicipality, municipalityNameResolved,
      institutionalMunicipalities,
      institutionNames, selectedInstitution,
      sedeNames, selectedSede,
      modalidadCatalog, selectedModality,
      normalizeCatalogText,
      educationalCatalogMeta?.message || ""
    );
  }

  if (activeTab === "contratacion") {
    activeSectionHtml = buildTabContratacion(draftValue, currentCargoReal);
  }

  if (activeTab === "seguimiento") {
    activeSectionHtml = buildTabSeguimiento(draftValue);
  }

  if (activeTab === "estudios") {
    activeSectionHtml = buildTabEstudios(draftValue);
  }

  if (activeTab === "experiencia") {
    activeSectionHtml = buildTabExperiencia(draft);
  }

  if (activeTab === "observaciones") {
    activeSectionHtml = buildTabObservaciones(draftValue);
  }

  // ── Shell ─────────────────────────────────────────────────────────────────

  const tabButtons = buildTabButtons(activeTab, institutionalEnabled);
  const fn  = escapeHtml((draftValue("firstName")    || "").toUpperCase());
  const sn  = escapeHtml((draftValue("secondName")   || "").toUpperCase());
  const fln = escapeHtml((draftValue("firstLastName") || "").toUpperCase());
  const sln = escapeHtml((draftValue("secondLastName")|| "").toUpperCase());
  const docType   = escapeHtml(draftValue("documentType")   || "");
  const docNumber = escapeHtml(draftValue("documentNumber") || "");

  return `
    <div class="personnel-grid">
      <article class="info-card personnel-form-card employee-form-shell">

        <div class="employee-header-card">
          <div class="employee-header-copy">
            <h2 class="emp-name-title" id="employeeHeaderName">
              ${[fn, sn, fln, sln].filter(Boolean).join(" ") || "NOMBRE COMPLETO"}
            </h2>
            <p class="emp-doc-subtitle" id="employeeHeaderDocument">
              ${[docType, docNumber].filter(Boolean).join(" · ") || "Tipo de documento · Número"}
            </p>
          </div>
          <button type="button" id="backToPersonnelTable" class="btn btn-secondary emp-back-btn">
            ← Volver
          </button>
        </div>

        ${tabButtons}

        <div class="form-scroll-area">
          <form id="personnelForm" class="personnel-form-v2" novalidate>
            <div id="personnelActiveSection">${activeSectionHtml}</div>

            <div class="personnel-form-actions">
              <div id="personnelAgeSlot">${activeTab === "identificacion" ? buildAgeIndicator(draftValue("birthDay"), draftValue("birthMonth"), draftValue("birthYear")) : ""}</div>
              <button type="submit" class="primary-soft-btn">
                ${isEditMode
                  ? "Guardar cambios"
                  : _PRE_SUBMIT_TABS.has(activeTab)
                    ? "Guardar y continuar →"
                    : "Crear empleado"}
              </button>
            </div>
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
      .filter((d) => _norm(d.documentType) === _norm(req.name))
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
        .filter((d) => _norm(d.documentType) === _norm(req.name))
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
    : String(rawMunicipalityName || "").trim();

  const draft = {
    firstName:    found.primer_nombre  || found.firstName  || "",
    secondName:   found.segundo_nombre || found.secondName || "",
    firstLastName:  found.primer_apellido  || found.firstLastName  || "",
    secondLastName: found.segundo_apellido || found.secondLastName || "",

    documentType:   found.tipo_documento  || found.documentType   || "",
    documentNumber: found.numero_documento || found.documentNumber || "",

    expeditionDay:        found.fecha_expedicion_dia  || found.expeditionDay        || "",
    expeditionMonth:      found.fecha_expedicion_mes  || found.expeditionMonth      || "",
    expeditionYear:       found.fecha_expedicion_anio || found.expeditionYear       || "",
    expeditionDepartment: found.departamento_expedicion || found.expeditionDepartment || "",
    expeditionMunicipality: found.municipio_expedicion  || found.expeditionMunicipality || "",

    birthDay:        found.fecha_nacimiento_dia  || found.birthDay        || "",
    birthMonth:      found.fecha_nacimiento_mes  || found.birthMonth      || "",
    birthYear:       found.fecha_nacimiento_anio || found.birthYear       || "",
    birthCountry:    found.pais_nacimiento  || found.birthCountry  || "Colombia",
    birthDepartment: found.departamento_nacimiento || found.birthDepartment || "",
    birthMunicipality: found.municipio_nacimiento  || found.birthMunicipality || "",

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
    residenceMunicipality: found.municipio_residencia || found.residenceMunicipality || "",
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
    state.personnelFilters = { search: "", status: "", role: "", hvStatus: "", municipalityId: "",
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
  const summary = calculatePersonnelDashboardFrontend(filteredRows, allDocuments);
  const alerts  = calculateDocumentAlertsFrontend(filteredRows, allDocuments);

  if (!filteredRows.length) {
    state.personnelSelectedId = null;
  }

  const selectedEmployee = state.personnelSelectedId === "__none__"
    ? null
    : filteredRows.find((item) => String(item.id) === String(state.personnelSelectedId)) || null;

  // ── Filas de tabla ────────────────────────────────────────────────────────
  const tableRows = filteredRows.length
    ? filteredRows.map((item) => {
        const hv        = getPersonnelHvStatusFull(item, allDocuments);
        const docMetrics = getPersonnelDocumentMetrics(item, allDocuments);
        const isOffer   = item.presentedInOffer === true || item.presentedInOffer === "true" ||
                          item.presented_in_offer === true || item.presented_in_offer === "true";
        const roleClass = isOffer ? "role-offer" : "role-extra";
        const rowClass  = hv.label === "No apto documental" ? "personnel-row-blocked" : "";

        return `
          <tr class="${rowClass} ${String(state.personnelSelectedId) === String(item.id) ? "selected" : ""}" data-select-personnel-id="${escapeAttr(item.id)}">
            <td>${escapeHtml(getPersonnelDocument(item))}</td>
            <td class="personnel-name-cell">
              <div class="personnel-employee-cell">
                <div class="personnel-avatar" style="${getPersonnelAvatarStyle(item)}">${escapeHtml(getPersonnelInitials(item))}</div>
                <div class="personnel-employee-copy">
                  <strong class="personnel-name-link" data-open-cv-id="${escapeAttr(item.id)}">${escapeHtml(getPersonnelFullName(item))}</strong>
                </div>
              </div>
            </td>
            <td class="cargo-cell">
              <span class="role-chip ${roleClass}">${escapeHtml(getPersonnelRole(item))}</span>
            </td>
            <td><span class="role-chip ${roleClass}">${isOffer ? "Oferta" : "Extra"}</span></td>
            <td>${buildPersonnelStatusChip(getPersonnelWorkStatus(item))}</td>
            <td>
              <div class="personnel-doc-progress">
                <span class="status-chip ${hv.className}">${escapeHtml(hv.label)}</span>
                <div class="personnel-mini-progress"><span style="width:${Math.max(0, Math.min(100, docMetrics.percent))}%"></span></div>
                <small>${docMetrics.validated}/${docMetrics.total} validados</small>
              </div>
            </td>
            <td>${escapeHtml(getPersonnelMunicipality(item))}</td>
            <td class="gestor-zona-cell">${escapeHtml(item.gestorZona || item.gestor_zona || "—")}</td>
            <td>
              <div class="personnel-row-actions">
                <button type="button" class="personnel-icon-btn btn-icon-view" title="Ver hoja de vida"
                  data-cv-personnel-id="${escapeAttr(item.id)}">
                  <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button type="button" class="personnel-icon-btn btn-icon-edit" title="Editar empleado"
                  data-edit-personnel-id="${escapeAttr(item.id)}">
                  <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button type="button" class="personnel-icon-btn btn-icon-docs" title="Documentos"
                  data-documents-personnel-id="${escapeAttr(item.id)}">
                  <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join("")
    : `<tr><td colspan="9"><div class="personnel-table-empty">${
        hasAnyFilter
          ? "No hay registros que coincidan con los filtros."
          : "No hay personal registrado."
      }</div></td></tr>`;

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
      await openModule("gestion_personal");
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
      state.personnelFilters = { search:"", status:"", role:"", hvStatus:"", municipalityId:"",
        companyId:"", contractId:"", gestorZona:"", institution:"", site:"", modality:"", sort:"" };
      state.personnelPagination = { page: 1, pageSize: state.personnelPagination?.pageSize || 25, total: 0, totalPages: 0 };
      state.personnelSelectedId = null;
      await openModule("gestion_personal");
    });

    document.getElementById("btnNewEmployee")?.addEventListener("click", async () => {
      state.personnelDraft          = {};
      state.personnelCreateTab      = "identificacion";
      state.personnelViewMode       = "create";
      state.personnelEditingId      = null;
      state.personnelSelectedId     = null;
      state.personnelDocumentsEmployee = null;
      await openModule("gestion_personal");
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
      await openModule("gestion_personal");
    });

    document.getElementById("personnelNextPage")?.addEventListener("click", async () => {
      const current = state.personnelPagination?.page || 1;
      const totalPages = state.personnelPagination?.totalPages || 0;
      if (totalPages && current >= totalPages) return;
      state.personnelPagination = { ...(state.personnelPagination || {}), page: current + 1 };
      state.personnelSelectedId = null;
      await openModule("gestion_personal");
    });

    document.getElementById("personnelPageSize")?.addEventListener("change", async (event) => {
      state.personnelPagination = {
        ...(state.personnelPagination || {}),
        page: 1,
        pageSize: Number(event.target.value) || 25,
      };
      state.personnelSelectedId = null;
      await openModule("gestion_personal");
    });

    document.getElementById("btnImportPersonnel")?.addEventListener("click", () => {
      openSafeImportPersonnelModal();
    });

    document.querySelectorAll("[data-cv-personnel-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const found = await getFullEmployee(btn.dataset.cvPersonnelId);
        if (!found) return;
        state.personnelDraft    = hydratePersonnelDraft(found);
        state.personnelViewMode = "cv";
        state.personnelEditingId = found.id || null;
        state.personnelSelectedId = found.id || null;
        await openModule("gestion_personal");
      });
    });

    document.querySelectorAll("[data-edit-personnel-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const found = await getFullEmployee(btn.dataset.editPersonnelId);
        if (!found) return;
        state.personnelDraft             = hydratePersonnelDraft(found);
        state.personnelCreateTab         = "identificacion";
        state.personnelViewMode          = "edit";
        state.personnelEditingId         = found.id || null;
        state.personnelSelectedId        = "__none__";
        state.personnelDocumentsEmployee = null;
        state.personnelSavedTabs         = null;
        await openModule("gestion_personal");
      });
    });

    document.querySelectorAll("[data-documents-personnel-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const found = await getFullEmployee(btn.dataset.documentsPersonnelId);
        if (!found) return;
        state.personnelDraft          = hydratePersonnelDraft(found);
        state.personnelViewMode       = "documents";
        state.personnelEditingId      = found.id || null;
        state.personnelSelectedId     = found.id || null;
        state.personnelDocumentsEmployee = found;
        await openModule("gestion_personal");
      });
    });

    const pnlShellEl  = document.getElementById("personnelWorkspaceRoot");
    const pnlDetailEl = document.getElementById("pnlDetail");

    const closeDetail = () => {
      state.personnelSelectedId = "__none__";
      pnlShellEl?.classList.remove("detail-open");
      if (pnlDetailEl) pnlDetailEl.innerHTML = buildPersonnelDetailPanel(null, []);
      document.querySelectorAll("[data-select-personnel-id]").forEach(r => r.classList.remove("selected"));
    };

    const wireDetail = (container) => {
      container.querySelectorAll("[data-clear-personnel-selection]").forEach(btn =>
        btn.addEventListener("click", closeDetail));

      // Photo upload
      container.querySelectorAll("[data-photo-upload-id]").forEach(wrap => {
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
      container.querySelectorAll("[data-edit-personnel-id]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const found = await getFullEmployee(btn.dataset.editPersonnelId);
          if (!found) return;
          state.personnelDraft             = hydratePersonnelDraft(found);
          state.personnelCreateTab         = "identificacion";
          state.personnelViewMode          = "edit";
          state.personnelEditingId         = found.id || null;
          state.personnelSelectedId        = "__none__";
          state.personnelDocumentsEmployee = null;
          await openModule("gestion_personal");
        });
      });
      container.querySelectorAll("[data-documents-personnel-id]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const found = await getFullEmployee(btn.dataset.documentsPersonnelId);
          if (!found) return;
          state.personnelDraft = hydratePersonnelDraft(found);
          state.personnelViewMode = "documents";
          state.personnelEditingId = found.id || null;
          state.personnelSelectedId = found.id || null;
          state.personnelDocumentsEmployee = found;
          await openModule("gestion_personal");
        });
      });
      container.querySelectorAll("[data-cv-personnel-id]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const found = await getFullEmployee(btn.dataset.cvPersonnelId);
          if (!found) return;
          state.personnelDraft = hydratePersonnelDraft(found);
          state.personnelViewMode = "cv";
          state.personnelEditingId = found.id || null;
          state.personnelSelectedId = found.id || null;
          await openModule("gestion_personal");
        });
      });

      // Panel tab switching
      container.querySelectorAll("[data-panel-tab]").forEach(btn => {
        btn.addEventListener("click", () => {
          const tab = btn.dataset.panelTab;
          container.querySelectorAll("[data-panel-tab]").forEach(b => b.classList.remove("pnl-tab-active"));
          container.querySelectorAll("[data-panel-section]").forEach(s => s.classList.remove("pnl-sec-active"));
          btn.classList.add("pnl-tab-active");
          container.querySelector(`[data-panel-section="${tab}"]`)?.classList.add("pnl-sec-active");
        });
      });
    };

    document.querySelectorAll("[data-open-cv-id]").forEach((nameEl) => {
      nameEl.addEventListener("click", async (event) => {
        event.stopPropagation();
        const empId = nameEl.dataset.openCvId;
        const found = await getFullEmployee(empId);
        state.personnelSelectedId = empId;
        document.querySelectorAll("[data-select-personnel-id]").forEach(r => r.classList.remove("selected"));
        nameEl.closest("[data-select-personnel-id]")?.classList.add("selected");
        if (!pnlShellEl || !pnlDetailEl) return;
        pnlDetailEl.innerHTML = buildPersonnelDetailPanel(found, allDocuments);
        pnlShellEl.classList.add("detail-open");
        wireDetail(pnlDetailEl);
      });
    });

    // Wire buttons inside the initially-rendered detail panel (pre-selected employee)
    if (pnlDetailEl && pnlShellEl?.classList.contains("detail-open")) {
      wireDetail(pnlDetailEl);
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

  // ── HTML ──────────────────────────────────────────────────────────────────
  return `
    <div class="personnel-master-module personnel-workspace-shell pnl-shell${selectedEmployee ? " detail-open" : ""}" id="personnelWorkspaceRoot">

      ${contextBanner}

      <!-- 1. KPIs -->
      <section class="pnl-kpis">
        <div class="pnl-kpi pnl-kpi-main">
          <span class="pnl-kpi-label">Total personal</span>
          <strong class="pnl-kpi-value">${_total || summary.total || 0}</strong>
          <small class="pnl-kpi-sub">${filteredRows.length} mostrados</small>
        </div>
        <div class="pnl-kpi pnl-kpi-success">
          <span class="pnl-kpi-label">HV completas</span>
          <strong class="pnl-kpi-value">${summary.completa || 0}</strong>
        </div>
        <div class="pnl-kpi pnl-kpi-warning">
          <span class="pnl-kpi-label">En revisión</span>
          <strong class="pnl-kpi-value">${summary.revision || 0}</strong>
        </div>
        <div class="pnl-kpi pnl-kpi-neutral">
          <span class="pnl-kpi-label">Incompletas</span>
          <strong class="pnl-kpi-value">${summary.incompleta || 0}</strong>
        </div>
        <div class="pnl-kpi pnl-kpi-danger">
          <span class="pnl-kpi-label">No aptos</span>
          <strong class="pnl-kpi-value">${summary.noApto || 0}</strong>
        </div>
      </section>

      <!-- 2. Acciones + Búsqueda + Filtros -->
      <section class="pnl-controls">
        <div class="pnl-actions">
          <button type="button" id="btnNewEmployee" class="btn btn-primary">+ Nuevo empleado</button>
          <button type="button" id="btnImportPersonnel" class="btn btn-secondary">Importar Excel</button>
          <button type="button" id="btnExportPersonnel" class="btn btn-secondary">Exportar</button>
          <input id="personnelSearch" type="text" class="pnl-search-input"
            placeholder="Buscar por nombre, documento o cargo"
            value="${escapeAttr(f.search)}" />
          <span class="pnl-count">${filteredRows.length} registros</span>
        </div>
        <div class="pnl-filters-row">
          <select id="personnelFilterStatus">
            <option value="">Estado laboral</option>
            ${ESTADOS_PERSONAL.map((v) => opt(v, f.status)).join("")}
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

      <!-- 3. Tabla -->
      <section class="pnl-body" id="pnlBody">
        <div class="pnl-table-card">
          <div class="personnel-table-wrap premium-table-wrap">
            <table class="personnel-table">
              <thead>
                <tr>
                  <th>Documento</th><th>Nombre completo</th><th>Cargo</th>
                  <th>Tipo</th><th>Estado</th><th>HV</th>
                  <th>Municipio</th><th>Gestor de Zona</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
          <div class="personnel-pagination" style="display:flex;gap:.75rem;align-items:center;justify-content:flex-end;padding:.75rem 1rem;border-top:1px solid var(--border);font-size:13px">
            <span>${pageStart}-${pageEnd} de ${_total || 0}</span>
            <select id="personnelPageSize" style="width:auto">
              ${[25, 50, 100].map((size) => `<option value="${size}" ${currentPageSize === size ? "selected" : ""}>${size}</option>`).join("")}
            </select>
            <button type="button" id="personnelPrevPage" class="btn btn-secondary" ${currentPage <= 1 ? "disabled" : ""}>Anterior</button>
            <span>Página ${currentPage} de ${totalPages || 1}</span>
            <button type="button" id="personnelNextPage" class="btn btn-secondary" ${totalPages && currentPage >= totalPages ? "disabled" : ""}>Siguiente</button>
          </div>
        </div>
      </section>

      <!-- 4. Expediente: panel lateral sobre todo el workspace -->
      <aside class="pnl-detail" id="pnlDetail">
        ${buildPersonnelDetailPanel(selectedEmployee, allDocuments)}
      </aside>
    </div>
  `;
}

// ─── Part 9: handlePersonnelFormSubmit ───────────────────────────────────────

// Tabs en orden. Los que preceden a "vinculacion" solo guardan borrador y avanzan.
const _TAB_ORDER = [
  "identificacion", "datos_personales", "estudios", "experiencia",
  "seguimiento", "licitacion", "vinculacion", "contratacion",
  "institucional", "observaciones",
];
const _PRE_SUBMIT_TABS = new Set(["identificacion", "datos_personales", "estudios", "experiencia", "seguimiento", "licitacion"]);

export async function handlePersonnelFormSubmit(event) {
  event.preventDefault();

  const isCreate = state.personnelViewMode !== "edit";
  const currentTab = state.personnelCreateTab || "identificacion";

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
    state.personnelCreateTab = "vinculacion";
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
      // Re-fetch inmediato para actualizar el draft con los datos confirmados por el servidor
      try {
        const freshPayload = await apiFetch(`/personnel/${encodeURIComponent(state.personnelEditingId)}`);
        const freshData = freshPayload?.data || null;
        console.log("[employee load]", { employeeId: state.personnelEditingId, source: "post-save", employeeData: freshData });
        if (freshData) {
          if (state.personnelDetailCache) {
            state.personnelDetailCache.set(String(state.personnelEditingId), freshData);
          }
          state.personnelDraft = hydratePersonnelDraft(freshData);
        }
      } catch (refreshErr) {
        // No bloquear el flujo si falla la recarga — el draft actual ya tiene los valores
        console.warn("[employee load] No se pudo recargar tras guardar:", refreshErr.message);
      }
      showSuccess("Los datos del empleado han sido actualizados.", "Empleado actualizado");
      if (!state.personnelSavedTabs) state.personnelSavedTabs = new Set();
      state.personnelSavedTabs.add(state.personnelCreateTab);
      _refreshPersonnelSection();
    } else {
      showSuccess("El empleado fue registrado en el sistema.", "Empleado creado");
      state.personnelDraft          = {};
      state.personnelSavedTabs      = null;
      state.personnelCreateTab      = "identificacion";
      state.personnelViewMode       = "table";
      state.personnelEditingId      = null;
      state.personnelDocumentsEmployee = null;
      state.activeModule    = "gestion_personal";
      state.expandedModule  = "gestion_personal";
      state.activeSubmodule = null;
      await openModule("gestion_personal");
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
  if (!value) return "—";
  const found = findOfficialMunicipality(value, { includeFallback: true });
  return found ? found.name : String(value);
}

async function openBulkDocumentUploadModal() {
  document.getElementById("bulkDocumentModal")?.remove();

  let personnelPayload = {};
  try {
    personnelPayload = await apiFetch("/personnel?export=1&pageSize=5000");
  } catch {
    personnelPayload = {};
  }

  const employees = Array.isArray(personnelPayload.data)
    ? personnelPayload.data
    : Array.isArray(personnelPayload.personnel)
      ? personnelPayload.personnel
      : [];

  const modal = document.createElement("div");
  modal.id = "bulkDocumentModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card" style="max-width:1100px">
      <div class="modal-header">
        <h3>Validacion de carga documental masiva</h3>
        <button type="button" class="modal-close" id="closeBulkDocumentModal">x</button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:1fr auto;gap:.75rem;align-items:end;margin-bottom:1rem">
          <label style="font-size:13px;font-weight:600">PDFs
            <input id="bulkDocumentFiles" type="file" accept="application/pdf" multiple style="display:block;width:100%;margin-top:.35rem;padding:.5rem;border:1px solid var(--border);border-radius:6px" />
          </label>
          <button type="button" class="btn btn-secondary" id="previewBulkDocuments">Prevalidar</button>
        </div>
        <div id="bulkDocumentSummary" style="margin-bottom:.75rem;font-size:13px;color:#475569"></div>
        <div style="max-height:460px;overflow:auto;border:1px solid var(--border);border-radius:8px">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead style="position:sticky;top:0;background:var(--panel);z-index:1">
              <tr>
                <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Archivo</th>
                <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Tipo</th>
                <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Nombre extraido</th>
                <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Empleado detectado</th>
                <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Estado</th>
                <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Confianza</th>
                <th style="text-align:left;padding:.55rem;border-bottom:1px solid var(--border)">Correccion</th>
              </tr>
            </thead>
            <tbody id="bulkDocumentRows">
              <tr><td colspan="7" style="padding:1rem;color:#64748b">Selecciona PDFs para validar coincidencias.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="uploadBulkDocuments" disabled>Cargar seleccionados</button>
        <button type="button" class="btn btn-secondary" id="cancelBulkDocumentModal">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const fileInput = modal.querySelector("#bulkDocumentFiles");
  const rowsBody = modal.querySelector("#bulkDocumentRows");
  const summaryEl = modal.querySelector("#bulkDocumentSummary");
  const uploadBtn = modal.querySelector("#uploadBulkDocuments");
  let reviewRows = [];

  const close = () => modal.remove();
  modal.querySelector("#closeBulkDocumentModal")?.addEventListener("click", close);
  modal.querySelector("#cancelBulkDocumentModal")?.addEventListener("click", close);

  const renderRows = () => {
    if (!reviewRows.length) {
      rowsBody.innerHTML = `<tr><td colspan="7" style="padding:1rem;color:#64748b">Sin resultados.</td></tr>`;
      uploadBtn.disabled = true;
      return;
    }

    rowsBody.innerHTML = reviewRows.map((row, index) => {
      const detected = row.detectedEmployee?.fullName || "";
      const statusColor = row.status === "MATCHED" ? "#15803d"
        : row.status === "NO_MATCH" ? "#dc2626"
        : "#d97706";
      const options = `<option value="">No asignar</option>` + employees.map((emp) => {
        const selected = String(row.employeeId || "") === String(emp.id) ? " selected" : "";
        const label = `${getPersonnelFullName(emp)} - ${getPersonnelDocument(emp)}`;
        return `<option value="${escapeAttr(String(emp.id))}"${selected}>${escapeHtml(label)}</option>`;
      }).join("");

      return `<tr data-bulk-row="${index}">
        <td style="padding:.55rem;border-bottom:1px solid var(--border);max-width:220px;word-break:break-word">${escapeHtml(row.fileName || "")}</td>
        <td style="padding:.55rem;border-bottom:1px solid var(--border)">${escapeHtml(row.documentTypeName || row.documentTypeCode || "")}</td>
        <td style="padding:.55rem;border-bottom:1px solid var(--border)">${escapeHtml(row.extractedName || row.documentNumber || "")}</td>
        <td style="padding:.55rem;border-bottom:1px solid var(--border)">${escapeHtml(detected || "Pendiente")}</td>
        <td style="padding:.55rem;border-bottom:1px solid var(--border);font-weight:700;color:${statusColor}">${escapeHtml(row.status || "")}</td>
        <td style="padding:.55rem;border-bottom:1px solid var(--border)">${Number(row.confidence || 0)}%</td>
        <td style="padding:.55rem;border-bottom:1px solid var(--border)">
          <select data-bulk-employee-select="${index}" style="width:230px;padding:.35rem;border:1px solid var(--border);border-radius:6px">${options}</select>
        </td>
      </tr>`;
    }).join("");
    uploadBtn.disabled = false;
  };

  modal.querySelector("#previewBulkDocuments")?.addEventListener("click", async () => {
    const files = Array.from(fileInput?.files || []);
    if (!files.length) { showWarning("Selecciona al menos un PDF."); return; }
    try {
      const res = await apiFetch("/documents/bulk-preview", {
        method: "POST",
        body: JSON.stringify({ files: files.map((file) => file.name) }),
      });
      reviewRows = res.data?.rows || [];
      const summary = res.data?.summary || {};
      summaryEl.textContent = `${summary.total || 0} archivos - ${summary.MATCHED || 0} exactos - ${summary.PARTIAL_MATCH || 0} parciales - ${summary.NO_MATCH || 0} sin coincidencia - ${summary.DUPLICATE || 0} duplicados`;
      renderRows();
    } catch (err) {
      showError(err.message);
    }
  });

  uploadBtn.addEventListener("click", async () => {
    const files = Array.from(fileInput?.files || []);
    const byName = new Map(files.map((file) => [file.name, file]));
    const selectedRows = reviewRows.map((row, index) => ({
      ...row,
      employeeId: modal.querySelector(`[data-bulk-employee-select="${index}"]`)?.value || "",
    })).filter((row) => row.employeeId);

    if (!selectedRows.length) {
      showWarning("Selecciona al menos un empleado para cargar.");
      return;
    }

    let uploaded = 0;
    for (const row of selectedRows) {
      const file = byName.get(row.fileName);
      if (!file) continue;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("employeeId", row.employeeId);
      if (row.documentTypeId) formData.append("docTypeId", String(row.documentTypeId));
      await apiFetch("/documents/upload", { method: "POST", body: formData });
      uploaded += 1;
    }

    showSuccess(`${uploaded} documentos cargados.`);
    close();
    await openModule("gestion_personal");
  });
}

export async function loadEmployeeDocumentsModule() {
  const employee = state.personnelDocumentsEmployee;

  if (!employee) {
    return `<article class="info-card"><h3>Error</h3><p>No se encontró el empleado.</p></article>`;
  }

  let documents = [];
  try {
    const res = await apiFetch(`/documents?employeeId=${employee.id}`);
    documents = Array.isArray(res.data) ? res.data : [];
  } catch (error) {
    return `<article class="info-card"><h3>Error cargando documentos</h3><p>${escapeHtml(error.message)}</p></article>`;
  }

  const requiredDocuments = _getRequiredDocsByEmployee(employee);
  const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const findUploaded = (req) =>
    documents
      .filter((d) => norm(d.documentType) === norm(req.name))
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];

  const getStatus = (req) => {
    const found = findUploaded(req);
    if (!found || !found.fileUrl) {
      return req.required
        ? { label: "Faltante",  className: "danger",  icon: "✕", isOk: false }
        : { label: "Opcional",  className: "neutral", icon: "—", isOk: true  };
    }
    const vs = norm(found.validationStatus || found.status);
    if (vs === "RECHAZADO") return { label: "Rechazado",        className: "danger",  icon: "✕", isOk: false };
    if (req.issueDateRequired && !found.issueDate)
      return { label: "Falta expedición",  className: "warning", icon: "!", isOk: false };
    if (req.expirationDateRequired && !found.expirationDate)
      return { label: "Falta vencimiento", className: "warning", icon: "!", isOk: false };
    if (req.expirationDateRequired && found.expirationDate) {
      const diff = Math.ceil((new Date(found.expirationDate).setHours(0,0,0,0) - today) / 86_400_000);
      if (diff < 0)  return { label: "Vencido",    className: "danger",  icon: "!", isOk: false };
      if (diff <= 30) return { label: "Por vencer", className: "warning", icon: "!", isOk: false };
    }
    if (vs !== "VALIDADO") return { label: "En revisión", className: "warning", icon: "!", isOk: false };
    return { label: "Validado", className: "success", icon: "✓", isOk: true };
  };

  const docRows = requiredDocuments.map((req) => {
    const found = findUploaded(req);
    const status = getStatus(req);
    const vs = norm(found?.validationStatus || found?.status);
    const canValidate = found?.fileUrl && vs !== "VALIDADO" && vs !== "RECHAZADO";
    return { req, found, status, canValidate };
  });

  const reqRows    = docRows.filter((r) => r.req.required);
  const totalReq   = reqRows.length;
  const completedReq   = reqRows.filter((r) => r.status.isOk).length;
  const missingReq     = reqRows.filter((r) => r.status.label === "Faltante").length;
  const warningReq     = reqRows.filter((r) => r.status.className === "warning").length;
  const rejectedOrExp  = reqRows.filter((r) => r.status.label === "Rechazado" || r.status.label === "Vencido").length;
  const compliancePct  = totalReq ? Math.round((completedReq / totalReq) * 100) : 100;
  const generalStatus  =
    rejectedOrExp > 0 ? { label: "No apto documental", className: "danger" }
    : missingReq > 0  ? { label: "Incompleto",          className: "danger" }
    : warningReq > 0  ? { label: "Requiere revisión",   className: "warning" }
    :                   { label: "Completo",             className: "success" };

  const rowsHtml = docRows.map(({ req, found, status, canValidate }) => `
    <div class="document-check-row">
      <div class="document-check-name">
        <span class="document-check-icon ${status.className}">${escapeHtml(status.icon)}</span>
        <div>
          <strong>${escapeHtml(req.name)}</strong>
          <small>${escapeHtml(req.group || "GENERAL")}</small>
          ${found?.validationStatus === "RECHAZADO" && found?.rejectionReason
            ? `<p class="document-rejection">Motivo: ${escapeHtml(found.rejectionReason)}</p>` : ""}
          ${found?.validatedBy ? `<p class="document-reviewed">Revisado por: ${escapeHtml(found.validatedBy)}</p>` : ""}
        </div>
      </div>
      <div class="document-check-conditional">
        <span class="status-chip ${req.required ? "danger" : "neutral"}">${req.required ? "Obligatorio" : "Opcional"}</span>
      </div>
      <div class="document-check-date-cell">
        ${req.issueDateRequired
          ? `<strong>${escapeHtml(found?.issueDate || "Pendiente")}</strong>`
          : `<span class="doc-na">No aplica</span>`}
      </div>
      <div class="document-check-date-cell">
        ${req.expirationDateRequired
          ? `<strong>${escapeHtml(found?.expirationDate || "Pendiente")}</strong>`
          : `<span class="doc-na">No aplica</span>`}
      </div>
      <div class="document-check-status">
        <span class="status-chip ${status.className}">${escapeHtml(status.label)}</span>
      </div>
      <div class="document-check-actions">
        ${found?.fileUrl ? `<button type="button" class="btn btn-secondary btn-row" data-view-document-url="${escapeAttr(found.fileUrl)}" data-view-document-name="${escapeAttr(req.name)}">Ver</button>` : ""}
        ${canValidate ? `
          <button type="button" class="btn btn-primary btn-row" data-validate-document-id="${escapeAttr(found.id)}">Validar</button>
          <button type="button" class="btn btn-danger btn-row" data-reject-document-id="${escapeAttr(found.id)}">Rechazar</button>
        ` : ""}
      </div>
    </div>
  `).join("");

  setTimeout(() => {
    const docTypeInput        = document.getElementById("docType");
    const issueDateInput      = document.getElementById("docIssueDate");
    const expirationDateInput = document.getElementById("docExpirationDate");
    const fileInput           = document.getElementById("docFile");

    const syncDateVis = () => {
      const rule = requiredDocuments.find((d) => norm(d.name) === norm(docTypeInput?.value));
      if (!issueDateInput || !expirationDateInput) return;
      if (!rule) {
        issueDateInput.classList.add("hidden");
        expirationDateInput.classList.add("hidden");
        issueDateInput.value = "";
        expirationDateInput.value = "";
        return;
      }
      issueDateInput.classList.toggle("hidden", !rule.issueDateRequired);
      expirationDateInput.classList.toggle("hidden", !rule.expirationDateRequired);
      if (!rule.issueDateRequired) issueDateInput.value = "";
      if (!rule.expirationDateRequired) expirationDateInput.value = "";
    };

    if (docTypeInput) { docTypeInput.addEventListener("change", syncDateVis); syncDateVis(); }

    document.getElementById("backToPersonnel")?.addEventListener("click", async () => {
      state.personnelViewMode   = "table";
      state.personnelSelectedId = "__none__";
      state.personnelDocumentsEmployee = null;
      await openModule("gestion_personal");
    });

    document.getElementById("openBulkDocumentUpload")?.addEventListener("click", () => {
      openBulkDocumentUploadModal();
    });

    document.getElementById("saveDoc")?.addEventListener("click", async () => {
      const type  = docTypeInput?.value || "";
      const issue = issueDateInput?.value || "";
      const exp   = expirationDateInput?.value || "";
      const rule  = requiredDocuments.find((d) => norm(d.name) === norm(type));

      if (!type) { showWarning("Debes seleccionar un documento."); return; }
      if (rule?.issueDateRequired && !issue) { showWarning("Este documento requiere fecha de expedición."); return; }
      if (rule?.expirationDateRequired && !exp) { showWarning("Este documento requiere fecha de vencimiento."); return; }
      if (!fileInput?.files?.length) { showWarning("Debes subir el documento en PDF."); return; }
      const file = fileInput.files[0];
      if (file.type !== "application/pdf") { showWarning("Solo se permiten archivos PDF."); return; }

      try {
        const fileBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
        });
        await apiFetch("/documents", {
          method: "POST",
          body: JSON.stringify({
            employeeId: employee.id,
            documentType: type,
            issueDate:      rule?.issueDateRequired      ? issue : "",
            expirationDate: rule?.expirationDateRequired ? exp   : "",
            fileBase64,
            fileName: file.name,
            validationStatus: "PENDIENTE_VALIDACION",
            uploadedBy: state.currentUser?.name || "Usuario",
          }),
        });
        await openModule("gestion_personal");
      } catch { showError("No fue posible guardar el documento."); }
    });

    document.querySelectorAll("[data-view-document-url]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const url  = btn.dataset.viewDocumentUrl;
        const name = btn.dataset.viewDocumentName || "Documento";
        const overlay = document.createElement("div");
        overlay.className = "pdf-preview-overlay";
        overlay.innerHTML = `
          <div class="pdf-preview-header">
            <span class="pdf-preview-title">${escapeHtml(name)}</span>
            <a href="${escapeAttr(url)}" download class="pdf-preview-close" style="margin-right:8px">Descargar</a>
            <button type="button" class="pdf-preview-close" id="closePdfPreview">Cerrar ✕</button>
          </div>
          <iframe class="pdf-preview-frame" src="${escapeAttr(url)}" title="${escapeAttr(name)}"></iframe>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector("#closePdfPreview")?.addEventListener("click", () => overlay.remove());
        overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") overlay.remove(); });
        overlay.setAttribute("tabindex", "-1");
        overlay.focus();
      });
    });

    document.querySelectorAll("[data-validate-document-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const docId = btn.dataset.validateDocumentId;
        const overlay = document.createElement("div");
        overlay.className = "empiria-modal-overlay";
        overlay.innerHTML = `
          <div class="empiria-modal">
            <h3>Validar documento</h3>
            <p>¿Confirmas que este documento fue revisado y es válido? Esta acción quedará registrada.</p>
            <div class="empiria-modal-actions">
              <button type="button" id="btnCancelValidate" class="btn btn-secondary">Cancelar</button>
              <button type="button" id="btnConfirmValidate" class="btn btn-primary">Sí, validar</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector("#btnCancelValidate")?.addEventListener("click", () => overlay.remove());
        overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
        overlay.querySelector("#btnConfirmValidate")?.addEventListener("click", async () => {
          overlay.remove();
          try {
            await apiFetch("/documents/validate", {
              method: "PUT",
              body: JSON.stringify({ id: docId, userName: state.currentUser?.name || "Usuario" }),
            });
            showSuccess("Documento validado correctamente.", "Documento validado");
            await openModule("gestion_personal");
          } catch { showError("No fue posible validar el documento."); }
        });
      });
    });

    document.querySelectorAll("[data-reject-document-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.rejectDocumentId;
        const overlay = document.createElement("div");
        overlay.className = "empiria-modal-overlay";
        overlay.innerHTML = `
          <div class="empiria-modal">
            <h3>Rechazar documento</h3>
            <p>Escribe el motivo del rechazo. Esta razón quedará visible en el expediente del empleado.</p>
            <textarea id="rejectReasonInput" placeholder="Motivo del rechazo..."></textarea>
            <div class="empiria-modal-actions">
              <button type="button" id="btnCancelReject" class="btn btn-secondary">Cancelar</button>
              <button type="button" id="btnConfirmReject" class="btn btn-primary">Rechazar</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById("rejectReasonInput")?.focus();
        document.getElementById("btnCancelReject")?.addEventListener("click", () => overlay.remove());
        overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
        document.getElementById("btnConfirmReject")?.addEventListener("click", async () => {
          const reason = (document.getElementById("rejectReasonInput")?.value || "").trim();
          if (!reason) { showWarning("Debes escribir un motivo de rechazo."); return; }
          overlay.remove();
          try {
            await apiFetch("/documents/reject", {
              method: "PUT",
              body: JSON.stringify({ id, reason, userName: state.currentUser?.name || "Usuario" }),
            });
            await openModule("gestion_personal");
          } catch { showError("No fue posible rechazar el documento."); }
        });
      });
    });
  }, 0);

  return `
    <div class="documents-audit-module">
      <article class="documents-audit-card">
        <section class="documents-audit-hero">
          <div>
            <span class="personnel-premium-eyebrow">Auditoría documental</span>
            <h2>Documentos del empleado</h2>
            <p>${escapeHtml(getPersonnelFullName(employee))}</p>
          </div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:flex-end">
            <button id="openBulkDocumentUpload" class="btn btn-primary">Carga masiva</button>
            <button id="backToPersonnel" class="btn btn-secondary">Volver</button>
          </div>
        </section>

        <section class="documents-audit-summary">
          <div class="documents-audit-score">
            <span>Cumplimiento</span>
            <strong>${compliancePct}%</strong>
            <small>${completedReq} de ${totalReq} obligatorios validados</small>
          </div>
          <div class="documents-audit-status ${generalStatus.className}">
            <span>Estado documental</span>
            <strong>${escapeHtml(generalStatus.label)}</strong>
            <small>Según vencimientos, faltantes y validaciones.</small>
          </div>
          <div class="documents-audit-mini"><span>Faltantes</span><strong>${missingReq}</strong></div>
          <div class="documents-audit-mini"><span>Alertas</span><strong>${warningReq + rejectedOrExp}</strong></div>
        </section>

        <section class="documents-upload-card">
          <div>
            <h3>Cargar documento</h3>
            <p>Selecciona el tipo documental. Empiria solicitará fechas cuando sean obligatorias.</p>
          </div>
          <div class="documents-upload-form">
            <select id="docType">
              <option value="">Selecciona documento</option>
              ${requiredDocuments.map((d) => `<option value="${escapeAttr(d.name)}">${escapeHtml(d.name)}${d.required ? "" : " (Opcional)"}</option>`).join("")}
            </select>
            <input id="docIssueDate" type="date" class="hidden" />
            <input id="docExpirationDate" type="date" class="hidden" />
            <input id="docFile" type="file" accept="application/pdf" />
            <button id="saveDoc" class="btn btn-primary">Guardar documento</button>
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

export function renderPersonnelCvModule() {
  const d = state.personnelDraft || {};
  const fullName = [d.firstName, d.secondName, d.firstLastName, d.secondLastName]
    .filter(Boolean).join(" ").toUpperCase() || "SIN NOMBRE";
  const initials = [d.firstName, d.firstLastName].filter(Boolean).map((n) => n[0]).join("").toUpperCase() || "?";
  const fmtDate = (v) =>
    v ? new Date(v + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" }) : "—";
  const val = (v) => escapeHtml(v || "—");

  const estudios     = Array.isArray(d.studies) ? d.studies : [];
  const experiencias = Array.isArray(d.workExperience) ? d.workExperience : [];

  setTimeout(() => {
    document.getElementById("btnBackFromCv")?.addEventListener("click", async () => {
      state.personnelViewMode   = "table";
      state.personnelSelectedId = "__none__";
      await openModule("gestion_personal");
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
      <div class="cv-shell" id="cvPrintArea">
        <div class="cv-header">
          <div class="cv-avatar">${escapeHtml(initials)}</div>
          <div class="cv-header-info">
            <h2>${escapeHtml(fullName)}</h2>
            <p>${val(d.cargo_real)}${d.offerPosition && d.presentedInOffer === "true" ? " · Cargo licitación: " + escapeHtml(d.offerPosition) : ""}</p>
            <p style="margin-top:4px;opacity:.7">${val(d.documentType)} ${val(d.documentNumber)}</p>
          </div>
        </div>
        <div class="cv-body">

          <div class="cv-section">
            <div class="cv-section-title">Identificación</div>
            <div class="cv-grid">
              <div class="cv-field"><span>Tipo de documento</span><strong>${val(d.documentType)}</strong></div>
              <div class="cv-field"><span>Número de documento</span><strong>${val(d.documentNumber)}</strong></div>
              <div class="cv-field"><span>Fecha de expedición</span><strong>${val([d.expeditionDay, d.expeditionMonth, d.expeditionYear].filter(Boolean).join("/"))}</strong></div>
              <div class="cv-field"><span>Lugar de expedición</span><strong>${val(d.expeditionMunicipality)} · ${val(d.expeditionDepartment)}</strong></div>
              <div class="cv-field"><span>Fecha de nacimiento</span><strong>${val([d.birthDay, d.birthMonth, d.birthYear].filter(Boolean).join("/"))}</strong></div>
              <div class="cv-field"><span>Lugar de nacimiento</span><strong>${escapeHtml(_resolveMunName(d.birthMunicipality))} · ${val(d.birthDepartment)}</strong></div>
              <div class="cv-field"><span>Grupo sanguíneo</span><strong>${val(d.bloodType)}</strong></div>
              <div class="cv-field"><span>Sexo biológico</span><strong>${val(d.biologicalSex)}</strong></div>
            </div>
          </div>

          <div class="cv-section">
            <div class="cv-section-title">Datos de Contacto</div>
            <div class="cv-grid">
              <div class="cv-field"><span>Celular</span><strong>${val(d.phone)}</strong></div>
              <div class="cv-field"><span>Correo electrónico</span><strong>${val(d.email)}</strong></div>
              <div class="cv-field"><span>Dirección</span><strong>${val(d.address)}</strong></div>
              <div class="cv-field"><span>Barrio</span><strong>${val(d.neighborhood)}</strong></div>
              <div class="cv-field"><span>Municipio de residencia</span><strong>${escapeHtml(_resolveMunName(d.residenceMunicipality))}</strong></div>
              <div class="cv-field"><span>Estado civil</span><strong>${val(d.civilStatus)}</strong></div>
            </div>
          </div>

          <div class="cv-section">
            <div class="cv-section-title">Seguridad Social</div>
            <div class="cv-grid">
              <div class="cv-field"><span>EPS</span><strong>${val(d.eps)}</strong></div>
              <div class="cv-field"><span>Fondo de pensiones</span><strong>${val(d.pensionFund)}</strong></div>
            </div>
          </div>

          ${estudios.length ? `
          <div class="cv-section">
            <div class="cv-section-title">Formación Académica</div>
            ${estudios.map((s) => `
              <div class="cv-study-item">
                <strong>${escapeHtml(s.degree || "Sin título")}</strong>
                <span>${escapeHtml(s.educationLevel || "")}${s.institution ? " · " + escapeHtml(s.institution) : ""}${s.year ? " · " + escapeHtml(String(s.year)) : ""}</span>
              </div>
            `).join("")}
          </div>
          ` : ""}

          ${experiencias.length ? `
          <div class="cv-section">
            <div class="cv-section-title">Experiencia Laboral</div>
            ${experiencias.map((exp) => `
              <div class="cv-study-item">
                <strong>${escapeHtml(exp.empresa || "Empresa sin nombre")}</strong>
                <span>${escapeHtml(exp.cargo || "")}${exp.fechaInicio ? " · " + escapeHtml(exp.fechaInicio) : ""}${exp.fechaFin ? " → " + escapeHtml(exp.fechaFin) : exp.fechaInicio ? " (actual)" : ""}</span>
                ${exp.funciones ? `<span style="font-size:12px;opacity:.75">${escapeHtml(exp.funciones)}</span>` : ""}
              </div>
            `).join("")}
          </div>
          ` : ""}

          ${(d.foodHandlingCourseIssueDate || d.foodHandlingExamIssueDate) ? `
          <div class="cv-section">
            <div class="cv-section-title">Manipulación de Alimentos</div>
            <div class="cv-grid">
              ${d.foodHandlingCourseIssueDate      ? `<div class="cv-field"><span>Curso — Expedición</span><strong>${fmtDate(d.foodHandlingCourseIssueDate)}</strong></div>` : ""}
              ${d.foodHandlingCourseExpirationDate  ? `<div class="cv-field"><span>Curso — Vencimiento</span><strong>${fmtDate(d.foodHandlingCourseExpirationDate)}</strong></div>` : ""}
              ${d.foodHandlingExamIssueDate         ? `<div class="cv-field"><span>Examen — Expedición</span><strong>${fmtDate(d.foodHandlingExamIssueDate)}</strong></div>` : ""}
              ${d.foodHandlingExamExpirationDate    ? `<div class="cv-field"><span>Examen — Vencimiento</span><strong>${fmtDate(d.foodHandlingExamExpirationDate)}</strong></div>` : ""}
            </div>
          </div>
          ` : ""}

          <div class="cv-signature-block">
            <p class="cv-signature-declaration">
              Toda la información contenida en este formato corresponde a datos suministrados por el trabajador
              y son de su entera responsabilidad. El trabajador certifica que dicha información es verídica y
              autoriza a la empresa a verificarla en cualquier momento.
            </p>
            <div class="cv-signature-single">
              <div class="cv-signature-line"></div>
              <span class="cv-signature-label">Firma del trabajador</span>
              <span class="cv-signature-name">${escapeHtml(fullName)}</span>
              <span class="cv-signature-doc">${val(d.documentType)} ${val(d.documentNumber)}</span>
            </div>
          </div>

        </div>
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
      if (imported > 0 || updated > 0) setTimeout(() => { close(); openModule("gestion_personal"); }, 1200);
    } catch (err) {
      showError(err.message);
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
        if (created > 0) setTimeout(() => { close(); openModule("gestion_personal"); }, 2500);
      } catch (err) {
        if (resultEl) resultEl.innerHTML = `<span style="color:#dc2626">✖ ${escapeHtml(err.message)}</span>`;
      }
    };
    reader.readAsDataURL(file);
  });
}
