import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { escapeHtml, escapeAttr } from '../utils.js';
import { showSuccess, showError, showWarning } from '../toast.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAdminOrTH() {
  const r = String(state.currentUser?.role || '').toLowerCase();
  return r === 'administrador' || r === 'talento_humano';
}

function isGestor() {
  const r = String(state.currentUser?.role || '').toLowerCase();
  return r === 'gestores_auxiliares';
}

const fmtDate = d => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('es-CO', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }); }
  catch { return String(d).slice(0, 10); }
};

const fmtMoney = v => {
  if (v == null || v === '') return '—';
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(v));
};

const NOVELTY_LABELS = {
  INCAPACIDAD: 'Incapacidad',
  PERMISO_CITA_MEDICA: 'Permiso cita médica',
  VACACIONES: 'Vacaciones',
  LICENCIA_REMUNERADA: 'Lic. remunerada',
  LICENCIA_NO_REMUNERADA: 'Lic. / Permiso no remunerado',
  SUSPENSION: 'Suspensión',
  AUSENCIA: 'Ausencia injustificada',
  CAMBIO_CARGO: 'Cambio de cargo',
  CAMBIO_SALARIO: 'Cambio de salario',
  RETIRO: 'Retiro',
  OTRO: 'Otro',
};

function typeLabel(t) { return NOVELTY_LABELS[t] || t; }

function statusBadge(s) {
  const map = {
    PENDIENTE:  ['nm-badge nm-badge-pending',  'Pendiente'],
    APROBADA:   ['nm-badge nm-badge-approved',  'Aprobada'],
    RECHAZADA:  ['nm-badge nm-badge-rejected',  'Rechazada'],
    ANULADA:    ['nm-badge nm-badge-annulled',  'Anulada'],
  };
  const [cls, lbl] = map[s] || ['nm-badge nm-badge-pending', s];
  return `<span class="${cls}">${lbl}</span>`;
}

function _norm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function uniq(values) {
  return [...new Set(
    (values || [])
      .map(v => String(v || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'es'));
}

function getPayrollViewState() {
  if (!state.payrollView) {
    state.payrollView = {
      topContractId: state.currentUser?.contractId ? String(state.currentUser.contractId) : '',
      topMunicipality: '',
      search: '',
      filterSite: '',
      filterModality: '',
      filterRole: '',
      filterStatus: '',
      filterCompanyId: '',
      filterContractId: '',
      filterMunicipality: '',
      filterContractType: '',
      page: 1,
      pageSize: 10,
    };
  }
  if (!state.payrollView.pageSize) state.payrollView.pageSize = 10;
  if (!state.payrollView.page) state.payrollView.page = 1;
  return state.payrollView;
}

function getCompanyNameById(companyId, fallback = 'Sin empresa') {
  const id = String(companyId || '').trim();
  if (!id) return fallback;
  const match = (state.companies || []).find(item => String(item.id) === id);
  return match?.name || fallback;
}

function getContractNameById(contractId, fallback = 'Sin contrato') {
  const id = String(contractId || '').trim();
  if (!id) return fallback;
  const match = (state.contracts || []).find(item => String(item.id) === id);
  return match?.name || match?.label || fallback;
}

function getPayrollInitials(name) {
  const parts = String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return 'NM';
  return parts.map(part => part[0]).join('').toUpperCase();
}

function getPayrollAvatarStyle(seed) {
  let hash = 0;
  const source = String(seed || 'Empiria');
  for (let i = 0; i < source.length; i += 1) hash = source.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `--nmx-avatar-bg: linear-gradient(135deg, hsla(${hue}, 58%, 96%, 1), hsla(${(hue + 20) % 360}, 54%, 88%, 1)); --nmx-avatar-fg: hsl(${hue}, 34%, 28%);`;
}

function getPayrollEmployeeName(item) {
  return item.fullName || item.full_name || item.nombre_completo || item.employeeName || 'Sin nombre';
}

function getPayrollDocument(item) {
  return item.documentNumber || item.numero_documento || item.document_number || 'Sin documento';
}

function getPayrollRole(item) {
  return item.cargo_real || item.real_position || item.position || item.cargo || item.jobTitle || item.workTimeType || 'Sin cargo';
}

function getPayrollWorkStatus(item) {
  const raw = String(item.estado || item.status || item.estado_laboral || 'ACTIVO');
  const normalized = _norm(raw);
  if (['activo', 'active', 'vinculado'].includes(normalized)) return 'Vinculado';
  if (['retirado', 'inactivo', 'inactive'].includes(normalized)) return 'Retirado';
  if (['pendiente'].includes(normalized)) return 'Pendiente';
  return raw || 'Pendiente';
}

function getPayrollMunicipality(item) {
  return item.educationalMunicipality || item.educational_municipality || item.municipio_institucional || item.municipality || item.municipio || 'Sin municipio';
}

function getPayrollSite(item) {
  return item.site || item.sede_educativa || item.siteName || item.institution || item.institucion_educativa || 'Sin sede';
}

function getPayrollModality(item) {
  return item.educationalModality || item.modalidad || item.modality || 'Sin modalidad';
}

function getPayrollContractType(item) {
  return item.contractType || item.tipo_contrato || item.contract_type || 'Sin definir';
}

function getPayrollCompanyId(item) {
  return String(item.companyId || item.company_id || '');
}

function getPayrollContractId(item) {
  return String(item.contractId || item.contract_id || '');
}

function getPayrollCompanyLabel(item) {
  return getCompanyNameById(getPayrollCompanyId(item), item.companyName || item.empresa || 'Sin empresa');
}

function getPayrollContractLabel(item) {
  return getContractNameById(getPayrollContractId(item), item.contractName || item.contrato || 'Sin contrato');
}

function getPayrollSalaryNumber(item) {
  const value = item.salary || item.salario || item.salario_basico || item.basicSalary || item.basic_salary;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function getPayrollStatusTone(status) {
  const normalized = _norm(status);
  if (['pagado', 'completo', 'vinculado'].includes(normalized)) return 'success';
  if (['procesado', 'en proceso'].includes(normalized)) return 'info';
  if (['pendiente', 'por vencer'].includes(normalized)) return 'warning';
  if (['vencido', 'retirado', 'error', 'fallido', 'rechazado'].includes(normalized)) return 'danger';
  return 'neutral';
}

function getDocumentProgress(item) {
  const docs = item.documents || item.documentos || {};
  const keys = [
    ['cedula', 'cc', 'documento_identidad'],
    ['hoja_vida', 'hv', 'curriculum'],
    ['eps', 'certificado_eps', 'afiliacion_eps'],
    ['pension', 'afp', 'certificado_pension'],
    ['examen_medico', 'examenes', 'manipulacion_alimentos'],
  ];
  const count = keys.reduce((acc, group) => {
    const hasValue = group.some(key => {
      const current = docs[key];
      if (Array.isArray(current)) return current.length > 0;
      return Boolean(current);
    });
    return acc + (hasValue ? 1 : 0);
  }, 0);
  return {
    count,
    total: keys.length,
    percent: Math.round((count / keys.length) * 100),
  };
}

function getUniquePersonnelRows(personnelMap) {
  const unique = new Map();
  Object.values(personnelMap || {}).forEach(item => {
    const key =
      String(item.id || item.employeeId || item.legacyJsonId || item.legacy_json_id || getPayrollDocument(item) || Math.random());
    if (!unique.has(key)) unique.set(key, item);
  });
  return [...unique.values()];
}

function getPayrollProcessStatus(selectedPeriod) {
  if (selectedPeriod?.status === 'CERRADO') return 'Pagado';
  if (selectedPeriod?.status === 'CALCULADO') return 'Procesado';
  return 'Pendiente';
}

function buildPayrollRows(results, personnelMap, selectedPeriod, novedades) {
  const resultLines = results?.data?.lines || results?.lines || [];
  const noveltyByEmployee = {};
  const pendingNoveltyByEmployee = {};

  (novedades || []).forEach(item => {
    const key = String(item.employeeId || '');
    noveltyByEmployee[key] = (noveltyByEmployee[key] || 0) + 1;
    if (item.status === 'PENDIENTE') pendingNoveltyByEmployee[key] = (pendingNoveltyByEmployee[key] || 0) + 1;
  });

  if (resultLines.length) {
    return resultLines.map((line, index) => {
      const employee = personnelMap[String(line.employeeId)] || {};
      const salaryBasic = Number(line.baseSalary) || getPayrollSalaryNumber(employee);
      const net = Number(line.netoPagar) || 0;
      const explicitDeductions =
        Number(line.totalDeducciones) ||
        Number(line.deducciones) ||
        Number(line.novedadDescuento) ||
        0;
      const deductions = explicitDeductions || Math.max(salaryBasic - net, 0);
      const earnings = Number(line.totalDevengado) || Math.max(net + deductions, salaryBasic);
      const documentProgress = getDocumentProgress(employee);
      const employeeId = String(line.employeeId || employee.id || index);

      return {
        key: `${employeeId}-${index}`,
        employeeId,
        fullName: line.employeeName || getPayrollEmployeeName(employee),
        documentNumber: line.documentNumber || getPayrollDocument(employee),
        role: getPayrollRole(employee),
        contractType: getPayrollContractType(employee),
        salaryBasic,
        earnings,
        deductions,
        net,
        status: getPayrollProcessStatus(selectedPeriod),
        municipality: line.municipality || getPayrollMunicipality(employee),
        site: line.institution || getPayrollSite(employee),
        modality: line.modality || getPayrollModality(employee),
        companyId: getPayrollCompanyId(employee),
        companyLabel: getPayrollCompanyLabel(employee),
        contractId: getPayrollContractId(employee),
        contractLabel: getPayrollContractLabel(employee),
        workerStatus: getPayrollWorkStatus(employee),
        noveltyCount: noveltyByEmployee[employeeId] || 0,
        pendingNoveltyCount: pendingNoveltyByEmployee[employeeId] || 0,
        documentProgress,
      };
    });
  }

  return getUniquePersonnelRows(personnelMap)
    .filter(item => ['activo', 'active', 'vinculado'].includes(_norm(item.status || item.estado || 'ACTIVO')))
    .map((employee, index) => {
      const salaryBasic = getPayrollSalaryNumber(employee);
      const employeeId = String(employee.id || employee.employeeId || index);
      const documentProgress = getDocumentProgress(employee);
      return {
        key: `${employeeId}-${index}`,
        employeeId,
        fullName: getPayrollEmployeeName(employee),
        documentNumber: getPayrollDocument(employee),
        role: getPayrollRole(employee),
        contractType: getPayrollContractType(employee),
        salaryBasic,
        earnings: salaryBasic,
        deductions: 0,
        net: salaryBasic,
        status: getPayrollProcessStatus(selectedPeriod),
        municipality: getPayrollMunicipality(employee),
        site: getPayrollSite(employee),
        modality: getPayrollModality(employee),
        companyId: getPayrollCompanyId(employee),
        companyLabel: getPayrollCompanyLabel(employee),
        contractId: getPayrollContractId(employee),
        contractLabel: getPayrollContractLabel(employee),
        workerStatus: getPayrollWorkStatus(employee),
        noveltyCount: noveltyByEmployee[employeeId] || 0,
        pendingNoveltyCount: pendingNoveltyByEmployee[employeeId] || 0,
        documentProgress,
      };
    });
}

function applyPayrollFilters(rows, view) {
  return (rows || []).filter(item => {
    if (view.search) {
      const haystack = [
        item.fullName,
        item.documentNumber,
        item.role,
        item.site,
        item.municipality,
      ].map(_norm).join(' ');
      if (!haystack.includes(_norm(view.search))) return false;
    }
    if (view.topContractId && String(item.contractId || '') !== String(view.topContractId)) return false;
    if (view.topMunicipality && _norm(item.municipality) !== _norm(view.topMunicipality)) return false;
    if (view.filterSite && _norm(item.site) !== _norm(view.filterSite)) return false;
    if (view.filterModality && _norm(item.modality) !== _norm(view.filterModality)) return false;
    if (view.filterRole && _norm(item.role) !== _norm(view.filterRole)) return false;
    if (view.filterStatus && _norm(item.status) !== _norm(view.filterStatus)) return false;
    if (view.filterCompanyId && String(item.companyId || '') !== String(view.filterCompanyId)) return false;
    if (view.filterContractId && String(item.contractId || '') !== String(view.filterContractId)) return false;
    if (view.filterMunicipality && _norm(item.municipality) !== _norm(view.filterMunicipality)) return false;
    if (view.filterContractType && _norm(item.contractType) !== _norm(view.filterContractType)) return false;
    return true;
  });
}

function paginateRows(rows, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil((rows.length || 0) / pageSize) || 1);
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    totalPages,
    items: rows.slice(start, start + pageSize),
  };
}

function buildKpiModel(filteredRows, allRows, selectedPeriod, results, novedades, munStatusMap) {
  const totals = results?.data?.totals || results?.totals || {};
  const totalCollaborators = filteredRows.length;
  const totalDevengado = Number(totals.totalDevengado) || filteredRows.reduce((acc, item) => acc + (Number(item.earnings) || 0), 0);
  const totalDeducciones = Number(totals.totalDeducciones) || filteredRows.reduce((acc, item) => acc + (Number(item.deductions) || 0), 0);
  const netoPagar = Number(totals.netoPagar) || filteredRows.reduce((acc, item) => acc + (Number(item.net) || 0), 0);

  const noveltyRows = novedades || [];
  const reviewedCount = noveltyRows.filter(item => item.status && item.status !== 'PENDIENTE').length;
  const reviewRatio = noveltyRows.length ? (reviewedCount / noveltyRows.length) : (selectedPeriod ? 1 : 0);
  const municipalityKeys = Object.keys(munStatusMap || {});
  const municipalityRatio = municipalityKeys.length
    ? municipalityKeys.filter(key => munStatusMap[key]?.is_complete).length / municipalityKeys.length
    : (selectedPeriod ? 1 : 0);
  const calcRatio = ['CALCULADO', 'CERRADO'].includes(selectedPeriod?.status) ? 1 : 0;
  const closeRatio = selectedPeriod?.status === 'CERRADO' ? 1 : 0;
  const baseRatio = selectedPeriod ? 1 : 0;
  const execution = (((baseRatio + reviewRatio + municipalityRatio + calcRatio + closeRatio) / 5) * 100).toFixed(1);

  return {
    totalCollaborators,
    totalDevengado,
    totalDeducciones,
    netoPagar,
    execution,
    visibleRows: filteredRows.length,
    totalRows: allRows.length,
  };
}

function buildDonutModel(filteredRows) {
  const salaryBasic = filteredRows.reduce((acc, item) => acc + (Number(item.salaryBasic) || 0), 0);
  const transport = filteredRows.reduce((acc, item) => acc + (Number(item.transportAllowance) || 0), 0);
  const recargos = filteredRows.reduce((acc, item) => acc + (Number(item.recargos) || 0), 0);
  const prestaciones = filteredRows.reduce((acc, item) => acc + (Number(item.prestaciones) || 0), 0);
  const totalDevengado = filteredRows.reduce((acc, item) => acc + (Number(item.earnings) || 0), 0);
  const other = Math.max(totalDevengado - salaryBasic - transport - recargos - prestaciones, 0);
  const total = salaryBasic + transport + recargos + prestaciones + other;

  return [
    { label: 'Salario basico', value: salaryBasic, color: '#0a1f44' },
    { label: 'Auxilio transporte', value: transport, color: '#007bff' },
    { label: 'Recargos', value: recargos, color: '#00c288' },
    { label: 'Prestaciones', value: prestaciones, color: '#84cc16' },
    { label: 'Otros', value: other, color: '#94a3b8' },
  ].map(item => ({
    ...item,
    percent: total > 0 ? (item.value / total) * 100 : 0,
  }));
}

function buildDonutStyle(items) {
  let offset = 0;
  const segments = items.map(item => {
    const start = offset;
    const end = offset + item.percent;
    offset = end;
    return `${item.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  return segments.length
    ? `background: conic-gradient(${segments.join(', ')});`
    : 'background: conic-gradient(#e2e8f0 0 100%);';
}

function buildPayrollWorkspace({
  periods,
  selectedPeriod,
  personnelMap,
  novedades,
  munStatusMap,
  results,
}) {
  const view = getPayrollViewState();
  const rows = buildPayrollRows(results, personnelMap, selectedPeriod, novedades);
  const filteredRows = applyPayrollFilters(rows, view);
  const paged = paginateRows(filteredRows, view.page, view.pageSize || 10);
  view.page = paged.page;

  const municipalities = uniq(rows.map(item => item.municipality));
  const sites = uniq(rows.map(item => item.site));
  const modalities = uniq(rows.map(item => item.modality));
  const roles = uniq(rows.map(item => item.role));
  const statuses = uniq(rows.map(item => item.status));
  const contractTypes = uniq(rows.map(item => item.contractType));

  const companyOptions = uniq(rows.map(item => item.companyId).filter(Boolean))
    .map(id => ({ value: id, label: getCompanyNameById(id, 'Sin empresa') }));
  const contractOptions = uniq(rows.map(item => item.contractId).filter(Boolean))
    .map(id => ({ value: id, label: getContractNameById(id, 'Sin contrato') }));

  const kpis = buildKpiModel(filteredRows, rows, selectedPeriod, results, novedades, munStatusMap);
  const donut = buildDonutModel(filteredRows);
  const notificationsCount =
    (novedades || []).filter(item => item.status === 'PENDIENTE').length +
    (selectedPeriod && !['CALCULADO', 'CERRADO'].includes(selectedPeriod.status) ? 1 : 0);
  const canReviewLine = ['CALCULADO', 'CERRADO'].includes(selectedPeriod?.status);
  const exportHref = canReviewLine && selectedPeriod ? `/payroll/periods/${selectedPeriod.id}/export` : '';
  const currentUserName = state.currentUser?.name || 'Usuario';
  const processDisabled = !isAdminOrTH() || !selectedPeriod || selectedPeriod.status === 'CERRADO';

  const rowsHtml = paged.items.length ? paged.items.map(item => {
    const statusTone = getPayrollStatusTone(item.status);
    const docPercent = item.documentProgress.percent;
    return `
      <tr class="nmx-table-row">
        <td><input type="checkbox" class="nmx-check" aria-label="Seleccionar ${escapeAttr(item.fullName)}" /></td>
        <td>
          <button
            type="button"
            class="nmx-person-trigger ${canReviewLine ? 'nm-action-detail' : ''}"
            data-emp-id="${escapeAttr(item.employeeId)}"
            data-period-id="${escapeAttr(String(selectedPeriod?.id || ''))}"
            ${canReviewLine ? '' : 'disabled'}>
            <span class="nmx-avatar" style="${escapeAttr(getPayrollAvatarStyle(item.fullName))}">${escapeHtml(getPayrollInitials(item.fullName))}</span>
            <span class="nmx-person-copy">
              <span class="table-main">${escapeHtml(item.fullName)}</span>
              <span class="table-secondary">${escapeHtml(item.documentNumber)}</span>
            </span>
          </button>
          <div class="nmx-doc-progress">
            <span class="nmx-doc-progress-bar"><span style="width:${docPercent}%"></span></span>
            <span class="table-secondary">${item.documentProgress.count}/${item.documentProgress.total} docs</span>
          </div>
        </td>
        <td>
          <div class="table-main">${escapeHtml(item.role)}</div>
          <div class="table-secondary">${escapeHtml(item.site)}</div>
        </td>
        <td>
          <div class="table-main">${escapeHtml(item.contractType)}</div>
          <div class="table-secondary">${escapeHtml(item.contractLabel)}</div>
        </td>
        <td class="nmx-money-cell">${fmtMoney(item.salaryBasic)}</td>
        <td class="nmx-money-cell nmx-money-positive">${fmtMoney(item.earnings)}</td>
        <td class="nmx-money-cell nmx-money-negative">${fmtMoney(item.deductions)}</td>
        <td class="nmx-money-cell nmx-money-net">${fmtMoney(item.net)}</td>
        <td>
          <span class="status-chip nmx-status-chip is-${statusTone}">${escapeHtml(item.status)}</span>
        </td>
        <td>
          <details class="nmx-row-menu">
            <summary aria-label="Acciones de ${escapeAttr(item.fullName)}">...</summary>
            <div class="nmx-row-menu-body">
              <button type="button" class="nmx-menu-item nm-action-detail"
                data-emp-id="${escapeAttr(item.employeeId)}"
                data-period-id="${escapeAttr(String(selectedPeriod?.id || ''))}"
                ${canReviewLine ? '' : 'disabled'}>
                Ver detalle
              </button>
              <button type="button" class="nmx-menu-item nm-action-slip"
                data-emp-id="${escapeAttr(item.employeeId)}"
                data-emp-name="${escapeAttr(item.fullName)}"
                data-period-id="${escapeAttr(String(selectedPeriod?.id || ''))}"
                ${canReviewLine ? '' : 'disabled'}>
                Ver desprendible
              </button>
              <button type="button" class="nmx-menu-item" data-payroll-trigger-calc>
                Recalcular
              </button>
              <button type="button" class="nmx-menu-item" data-nm-open-panel="nmSideNovedades">
                Historial
              </button>
            </div>
          </details>
        </td>
      </tr>`;
  }).join('') : `
      <tr>
        <td colspan="10" class="nmx-table-empty">No hay registros para la combinacion actual de filtros.</td>
      </tr>`;

  const pages = Array.from({ length: paged.totalPages }, (_, index) => index + 1)
    .filter(page => Math.abs(page - paged.page) <= 1 || page === 1 || page === paged.totalPages);

  return `
<div class="nm-wrap nmx-shell">
  <article class="nmx-layout">
    <section class="nmx-opsbar">
      <div class="nmx-actionbar-spacer"></div>
      <div class="nmx-actionbar-controls">
        <details class="nmx-actions-menu">
          <summary class="btn-secondary">Acciones</summary>
          <div class="nmx-actions-dropdown">
            <button type="button" class="nmx-menu-item" data-nm-open-panel="nmSidePeriods">Generar reportes</button>
            <button type="button" class="nmx-menu-item" data-payroll-trigger-calc>Recalcular</button>
            ${exportHref ? `<a href="${escapeAttr(exportHref)}" class="nmx-menu-item" download>Exportar</a>` : `<button type="button" class="nmx-menu-item" disabled>Exportar</button>`}
            <button type="button" class="nmx-menu-item" data-nm-open-panel="nmSideConfirm">Auditoria</button>
          </div>
        </details>
        <button type="button" class="btn btn-primary nmx-process-btn" id="nmBtnCalculate" ${processDisabled ? 'disabled' : ''}>
          Procesar nomina
        </button>
      </div>
    </section>

    <section class="nmx-kpis">
      <article class="nmx-kpi-card">
        <div class="nmx-kpi-icon soft-blue"></div>
        <span class="kpi-label">Total colaboradores</span>
        <strong class="kpi-value">${kpis.totalCollaborators}</strong>
        <small class="kpi-meta">${kpis.visibleRows} visibles de ${kpis.totalRows} en operacion</small>
      </article>
      <article class="nmx-kpi-card">
        <div class="nmx-kpi-icon soft-navy"></div>
        <span class="kpi-label">Total devengado</span>
        <strong class="kpi-value">${fmtMoney(kpis.totalDevengado)}</strong>
        <small class="kpi-meta">Salarios, recargos, auxilios y bonos</small>
      </article>
      <article class="nmx-kpi-card">
        <div class="nmx-kpi-icon soft-red"></div>
        <span class="kpi-label">Total deducciones</span>
        <strong class="kpi-value">${fmtMoney(kpis.totalDeducciones)}</strong>
        <small class="kpi-meta">Salud, pension, libranzas y descuentos</small>
      </article>
      <article class="nmx-kpi-card">
        <div class="nmx-kpi-icon soft-green"></div>
        <span class="kpi-label">Neto a pagar</span>
        <strong class="kpi-value">${fmtMoney(kpis.netoPagar)}</strong>
        <small class="kpi-meta">Valor estimado para giro final</small>
      </article>
      <article class="nmx-kpi-card">
        <div class="nmx-kpi-icon soft-teal"></div>
        <span class="kpi-label">% ejecucion nomina</span>
        <strong class="kpi-value">${kpis.execution}%</strong>
        <small class="kpi-meta">Avance operativo del periodo activo</small>
      </article>
    </section>

    <section class="nmx-filterbar">
      <select id="nmFilterPeriod" class="form-input">
        <option value="">Periodo</option>
        ${periods.map(item => `<option value="${item.id}" ${String(selectedPeriod?.id || '') === String(item.id) ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
      </select>
      <select id="nmFilterSite" class="form-input">
        <option value="">Sede</option>
        ${sites.map(item => `<option value="${escapeAttr(item)}" ${_norm(view.filterSite) === _norm(item) ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
      </select>
      <select id="nmFilterModality" class="form-input">
        <option value="">Modalidad</option>
        ${modalities.map(item => `<option value="${escapeAttr(item)}" ${_norm(view.filterModality) === _norm(item) ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
      </select>
      <select id="nmFilterRole" class="form-input">
        <option value="">Cargo</option>
        ${roles.map(item => `<option value="${escapeAttr(item)}" ${_norm(view.filterRole) === _norm(item) ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
      </select>
      <select id="nmFilterStatus" class="form-input">
        <option value="">Estado</option>
        ${statuses.map(item => `<option value="${escapeAttr(item)}" ${_norm(view.filterStatus) === _norm(item) ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
      </select>
      <details class="nmx-advanced-filters">
        <summary class="btn-secondary">Filtros</summary>
        <div class="nmx-advanced-panel">
          <select id="nmFilterCompany" class="form-input">
            <option value="">Empresa</option>
            ${companyOptions.map(item => `<option value="${escapeAttr(item.value)}" ${String(view.filterCompanyId) === String(item.value) ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
          <select id="nmFilterContract" class="form-input">
            <option value="">Contrato</option>
            ${contractOptions.map(item => `<option value="${escapeAttr(item.value)}" ${String(view.filterContractId) === String(item.value) ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
          <select id="nmFilterMunicipality" class="form-input">
            <option value="">Municipio</option>
            ${municipalities.map(item => `<option value="${escapeAttr(item)}" ${_norm(view.filterMunicipality) === _norm(item) ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
          </select>
          <select id="nmFilterContractType" class="form-input">
            <option value="">Tipo contrato</option>
            ${contractTypes.map(item => `<option value="${escapeAttr(item)}" ${_norm(view.filterContractType) === _norm(item) ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
          </select>
        </div>
      </details>
      <button type="button" class="btn btn-secondary" id="nmBtnClearFilters">Limpiar filtros</button>
    </section>

    <section class="nmx-body">
      <div class="nmx-main">
        <section class="nmx-table-card">
          <div class="nmx-table-headline">
            <div>
              <h3 class="employee-name">Colaboradores en nomina (${kpis.totalCollaborators})</h3>
            </div>
            <div class="nmx-table-tools">
              <label class="nmx-table-search">
                <input
                  id="nmPayrollSearch"
                  type="text"
                  class="form-input"
                  placeholder="Buscar colaborador..."
                  value="${escapeAttr(view.search || '')}" />
                <span class="nmx-table-search-icon"></span>
              </label>
              <button type="button" class="nmx-table-tool" data-nm-open-panel="nmSideNovedades" aria-label="Alertas de nomina">
                <span class="nmx-toolbar-bars"></span>
              </button>
              <a
                class="nmx-table-tool ${exportHref ? '' : 'is-disabled'}"
                ${exportHref ? `href="${escapeAttr(exportHref)}" download` : 'role="button" aria-disabled="true"'}
                aria-label="Exportar nomina">
                <span class="nmx-toolbar-download"></span>
              </a>
              <button type="button" class="nmx-table-tool" data-nm-open-panel="nmSidePeriods" aria-label="Mas acciones">
                <span class="nmx-toolbar-dots"></span>
              </button>
            </div>
          </div>
          <div class="nmx-table-period">
            <span class="status-chip nmx-status-chip is-${getPayrollStatusTone(getPayrollProcessStatus(selectedPeriod))}">${escapeHtml(getPayrollProcessStatus(selectedPeriod))}</span>
            <span class="table-secondary">${selectedPeriod ? `${escapeHtml(selectedPeriod.label)} · ${fmtDate(selectedPeriod.periodStart)} - ${fmtDate(selectedPeriod.periodEnd)}` : 'Selecciona un periodo para operar'}</span>
          </div>
          <div class="nmx-table-scroll">
            <table class="nmx-table">
              <thead>
                <tr>
                  <th class="table-head"><input type="checkbox" class="nmx-check" aria-label="Seleccionar todos" /></th>
                  <th class="table-head">Colaborador</th>
                  <th class="table-head">Cargo</th>
                  <th class="table-head">Tipo contrato</th>
                  <th class="table-head">Salario basico</th>
                  <th class="table-head">Devengados</th>
                  <th class="table-head">Deducciones</th>
                  <th class="table-head">Neto a pagar</th>
                  <th class="table-head">Estado</th>
                  <th class="table-head">Accion</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
          <div class="nmx-legal-note">
            La nomina se procesa de acuerdo con la legislacion laboral vigente y los parametros contractuales activos del periodo seleccionado.
          </div>
          <div class="nmx-pagination">
            <button type="button" class="btn btn-secondary" data-payroll-page="${paged.page - 1}" ${paged.page <= 1 ? 'disabled' : ''}>Anterior</button>
            <div class="nmx-pagination-pages">
              ${pages.map(page => `<button type="button" class="nmx-page-btn ${page === paged.page ? 'is-active' : ''}" data-payroll-page="${page}">${page}</button>`).join('')}
            </div>
            <button type="button" class="btn btn-secondary" data-payroll-page="${paged.page + 1}" ${paged.page >= paged.totalPages ? 'disabled' : ''}>Siguiente</button>
          </div>
        </section>
      </div>

      <aside class="nmx-sidebar">
        <div class="nmx-sidebar-scroll">
          <section class="nmx-side-card">
            <div class="nmx-side-card-head">
              <h3 class="employee-name">Resumen nomina</h3>
              <span class="employee-role">${selectedPeriod?.label || 'Sin periodo activo'}</span>
            </div>
            <div class="nmx-summary-list">
              <div><span>Devengado</span><strong class="is-positive">${fmtMoney(kpis.totalDevengado)}</strong></div>
              <div><span>Deducciones</span><strong class="is-danger">${fmtMoney(kpis.totalDeducciones)}</strong></div>
              <div class="is-total"><span>Neto a pagar</span><strong class="is-primary">${fmtMoney(kpis.netoPagar)}</strong></div>
              <div><span>Total colaboradores</span><strong>${kpis.totalCollaborators}</strong></div>
            </div>
          </section>

          <section class="nmx-side-card">
            <div class="nmx-side-card-head">
              <h3 class="employee-name">Distribucion de devengados</h3>
              <span class="employee-role">Vista presupuestal</span>
            </div>
            <div class="nmx-donut-wrap">
              <div class="nmx-donut" style="${escapeAttr(buildDonutStyle(donut))}">
                <div class="nmx-donut-core">
                  <strong>${kpis.execution}%</strong>
                  <span>Ejecucion</span>
                </div>
              </div>
              <div class="nmx-donut-legend">
                ${donut.map(item => `
                  <div>
                    <span><i style="background:${escapeAttr(item.color)}"></i>${escapeHtml(item.label)}</span>
                    <strong>${fmtMoney(item.value)}</strong>
                  </div>`).join('')}
              </div>
            </div>
          </section>

          <section class="nmx-side-card">
            <div class="nmx-side-card-head">
              <h3 class="employee-name">Acciones rapidas</h3>
              <span class="employee-role">Productividad operativa</span>
            </div>
            <div class="nmx-quick-actions">
              <button type="button" class="nmx-quick-action" data-payroll-trigger-calc>
                <span class="nmx-qa-icon qa-green"></span>
                <strong>Liquidar nomina</strong>
                <span>Calculo completo</span>
              </button>
              <button type="button" class="nmx-quick-action" data-nm-open-panel="nmSideConfirm">
                <span class="nmx-qa-icon qa-blue"></span>
                <strong>Generar desprendibles</strong>
                <span>Comprobantes</span>
              </button>
              ${exportHref ? `<a href="${escapeAttr(exportHref)}" class="nmx-quick-action" download><span class="nmx-qa-icon qa-purple"></span><strong>Exportar a contabilidad</strong><span>ERP y software contable</span></a>` : `<button type="button" class="nmx-quick-action" disabled><span class="nmx-qa-icon qa-purple"></span><strong>Exportar a contabilidad</strong><span>Disponible al calcular</span></button>`}
              <button type="button" class="nmx-quick-action" data-nm-open-panel="nmSidePeriods">
                <span class="nmx-qa-icon qa-orange"></span>
                <strong>Historial de nominas</strong>
                <span>Trazabilidad</span>
              </button>
            </div>
          </section>

          <details class="nmx-side-disclosure" id="nmSidePeriods" open>
            <summary>Periodo y configuracion</summary>
            <div class="nmx-side-disclosure-body">
              ${buildPeriodCard(periods, selectedPeriod)}
            </div>
          </details>

          ${selectedPeriod ? `
            <details class="nmx-side-disclosure" id="nmSideNovedades">
              <summary>Novedades y validaciones</summary>
              <div class="nmx-side-disclosure-body">
                ${buildNovedadesCard(novedades, personnelMap, selectedPeriod)}
              </div>
            </details>

            <details class="nmx-side-disclosure" id="nmSideMunicipalities">
              <summary>Control territorial</summary>
              <div class="nmx-side-disclosure-body">
                ${buildMunicipalitiesCard(novedades, munStatusMap, personnelMap, selectedPeriod)}
              </div>
            </details>
          ` : ''}

          ${selectedPeriod ? `
            <details class="nmx-side-disclosure" id="nmSideConfirm">
              <summary>Confirmacion y cierre</summary>
              <div class="nmx-side-disclosure-body">
                ${buildConfirmCard(selectedPeriod)}
              </div>
            </details>
          ` : ''}
        </div>
      </aside>
    </section>
  </article>
</div>`;
}

function syncPayrollTopbar(periods, selectedPeriod, view, municipalities, contractOptions) {
  const host = document.getElementById('tbPayrollControls');
  if (!host) return;
  host.classList.remove('hidden');
  host.innerHTML = `
    <label class="nmx-topbar-field">
      <span>Contrato activo</span>
      <select id="nmTopContractSelect" class="form-input">
        <option value="">Todos los contratos</option>
        ${contractOptions.map(item => `<option value="${escapeAttr(item.value)}" ${String(view.topContractId) === String(item.value) ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
      </select>
    </label>
    <label class="nmx-topbar-field">
      <span>Municipio</span>
      <select id="nmTopMunicipalitySelect" class="form-input">
        <option value="">Todos los municipios</option>
        ${municipalities.map(item => `<option value="${escapeAttr(item)}" ${_norm(view.topMunicipality) === _norm(item) ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
      </select>
    </label>
    <label class="nmx-topbar-field">
      <span>Periodo</span>
      <select id="nmTopPeriodSelect" class="form-input">
        <option value="">Selecciona periodo</option>
        ${periods.map(item => `<option value="${item.id}" ${String(selectedPeriod?.id || '') === String(item.id) ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
      </select>
    </label>
  `;
}

// ── Card builders ─────────────────────────────────────────────────────────────

function buildPeriodCard(periods, selectedPeriod) {
  const admin = isAdminOrTH();
  const selId = state.payrollPeriodId ? String(state.payrollPeriodId) : '';

  return `
<div class="nm-card" id="nmPeriodCard">
  <div class="nm-card-head">
    <div class="nm-card-head-left">
      <span class="nm-step-badge">1</span>
      <div>
        <h3 class="nm-card-title"><span class="nm-card-title-icon">📅</span> Período de Nómina</h3>
        <p class="nm-card-subtitle">Selecciona o crea el período para gestionar la nómina</p>
      </div>
    </div>
    ${admin ? `<button type="button" class="nm-btn nm-btn-primary" id="nmBtnToggleCreate">+ Nuevo período</button>` : ''}
  </div>

  ${admin ? `
  <div id="nmCreatePeriodWrap" class="nm-create-form hidden">
    <div class="nm-form-row">
      <label class="nm-label">Etiqueta
        <input type="text" id="nmNewLabel" class="nm-input" placeholder="Ej: Nómina Abril 2026" />
      </label>
      <label class="nm-label">Fecha inicio
        <input type="date" id="nmNewStart" class="nm-input" />
      </label>
      <label class="nm-label">Fecha fin
        <input type="date" id="nmNewEnd" class="nm-input" />
      </label>
    </div>
    <div class="nm-form-actions">
      <button type="button" class="nm-btn nm-btn-ghost" id="nmBtnCancelCreate">Cancelar</button>
      <button type="button" class="nm-btn nm-btn-primary" id="nmBtnSavePeriod">Crear período</button>
    </div>
  </div>` : ''}

  <div class="nm-period-selector">
    ${periods.length === 0
      ? `<p class="nm-empty-hint">${admin ? 'No hay períodos. Crea el primero con el botón de arriba.' : 'No hay períodos disponibles.'}</p>`
      : `<select id="nmPeriodSelect" class="nm-select nm-select-period">
          <option value="">— Selecciona un período —</option>
          ${periods.map(p => `
            <option value="${p.id}" ${String(p.id) === selId ? 'selected' : ''}>
              ${escapeHtml(p.label)} &nbsp;·&nbsp; ${fmtDate(p.periodStart)} → ${fmtDate(p.periodEnd)}
              ${p.status === 'CERRADO' ? ' [CERRADO]' : p.status === 'CALCULADO' ? ' [Calculado]' : ''}
            </option>`).join('')}
        </select>`}
  </div>

  ${selectedPeriod ? `
  <div class="nm-period-info">
    <span class="nm-period-dates">${fmtDate(selectedPeriod.periodStart)} &rarr; ${fmtDate(selectedPeriod.periodEnd)}</span>
    <span class="nm-period-status nm-ps-${(selectedPeriod.status || '').toLowerCase()}">${selectedPeriod.status}</span>
  </div>` : ''}
</div>`;
}

function buildNovedadesCard(novedades, personnelMap, selectedPeriod) {
  const admin = isAdminOrTH();
  const gestor = isGestor();
  const canAdd = (admin || gestor) && selectedPeriod && selectedPeriod.status !== 'CERRADO';

  const employees = Object.values(personnelMap).filter(e => {
    const s = String(e.status || e.estado || '').toUpperCase();
    return s === 'ACTIVO' || s === 'ACTIVE';
  });
  const municipalities = [...new Set(employees.map(e =>
    e.educationalMunicipality || e.educational_municipality || e.municipio_institucional || e.municipality || e.municipio || ''
  ).filter(Boolean))].sort();

  return `
<div class="nm-card" id="nmNovedadesCard">
  <div class="nm-card-head">
    <div class="nm-card-head-left">
      <span class="nm-step-badge">2</span>
      <div>
        <h3 class="nm-card-title"><span class="nm-card-title-icon">📋</span> Novedades de Nómina</h3>
        <p class="nm-card-subtitle">${novedades.length} novedad${novedades.length !== 1 ? 'es' : ''} registrada${novedades.length !== 1 ? 's' : ''} en este período</p>
      </div>
    </div>
    ${canAdd ? `<button type="button" class="nm-btn nm-btn-primary" id="nmBtnAddNovedad">+ Registrar novedad</button>` : ''}
  </div>

  <div id="nmNovedadFormWrap" class="nm-create-form hidden" data-period-id="${selectedPeriod?.id || ''}">
    <div class="nm-form-row nm-form-row-5">
      <label class="nm-label">Municipio <span class="nm-req">*</span>
        <select id="nmNovMunicipality" class="nm-select">
          <option value="">Selecciona municipio</option>
          ${municipalities.map(m => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('')}
        </select>
      </label>
      <label class="nm-label">Empleado <span class="nm-req">*</span>
        <select id="nmNovEmployee" class="nm-select" disabled>
          <option value="">Primero selecciona municipio</option>
        </select>
      </label>
      <label class="nm-label">Tipo <span class="nm-req">*</span>
        <select id="nmNovType" class="nm-select">
          <option value="">Selecciona tipo</option>
          <option value="INCAPACIDAD">Incapacidad</option>
          <option value="PERMISO_CITA_MEDICA">Permiso por cita médica</option>
          <option value="VACACIONES">Vacaciones</option>
          <option value="LICENCIA_REMUNERADA">Licencia remunerada</option>
          <option value="LICENCIA_NO_REMUNERADA">Permiso / Licencia no remunerado</option>
          <option value="SUSPENSION">Suspensión</option>
          <option value="AUSENCIA">Ausencia injustificada</option>
          <option value="CAMBIO_CARGO">Cambio de cargo</option>
          <option value="CAMBIO_SALARIO">Cambio de salario</option>
          <option value="RETIRO">Retiro</option>
          <option value="OTRO">Otro</option>
        </select>
      </label>
      <label class="nm-label">Fecha inicio <span class="nm-req">*</span>
        <input type="date" id="nmNovStartDate" class="nm-input" />
      </label>
      <label class="nm-label">Fecha fin
        <input type="date" id="nmNovEndDate" class="nm-input" />
      </label>
      <label class="nm-label">Días
        <input type="number" id="nmNovDays" class="nm-input" min="1" placeholder="Ej: 3" />
      </label>
      <label class="nm-label nm-label-full">Observaciones
        <textarea id="nmNovObservations" class="nm-textarea" rows="2" placeholder="Motivo o descripción..."></textarea>
      </label>
    </div>
    <div class="nm-form-actions">
      <button type="button" class="nm-btn nm-btn-ghost" id="nmBtnCancelNovedad">Cancelar</button>
      <button type="button" class="nm-btn nm-btn-primary" id="nmBtnSaveNovedad">Guardar novedad</button>
    </div>
  </div>

  <div class="nm-table-wrap">
    <table class="nm-table">
      <thead>
        <tr>
          <th>Nombre</th>
          <th>Municipio</th>
          <th>Gestor / Fecha reporte</th>
          <th>Tipo</th>
          <th>Período novedad</th>
          <th>Estado</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        ${novedades.length ? novedades.map(n => {
          const emp = personnelMap[String(n.employeeId)] || {};
          const mun = emp.educationalMunicipality || emp.educational_municipality ||
                      emp.municipio_institucional || emp.municipality || emp.municipio || '—';
          return `
          <tr>
            <td>
              <div class="nm-name-cell">${escapeHtml(n.employeeName || '—')}</div>
              <div class="nm-doc-cell">CC ${escapeHtml(n.documentNumber || '—')}</div>
            </td>
            <td>${escapeHtml(mun)}</td>
            <td>
              <div class="nm-name-cell">${escapeHtml(n.createdByName || '—')}</div>
              <div class="nm-doc-cell">${fmtDate(n.createdAt)}</div>
            </td>
            <td><span class="nm-type-chip">${typeLabel(n.noveltyType)}</span></td>
            <td class="nm-doc-cell">
              ${fmtDate(n.startDate)}${n.endDate ? ` → ${fmtDate(n.endDate)}` : ''}
              ${n.days ? `<br>${n.days} día${n.days != 1 ? 's' : ''}` : ''}
            </td>
            <td>
              ${statusBadge(n.status)}
              ${n.reviewNotes ? `<div class="nm-review-note" title="${escapeAttr(n.reviewNotes)}">↩ ${escapeHtml(n.reviewNotes.length > 35 ? n.reviewNotes.slice(0, 35) + '…' : n.reviewNotes)}</div>` : ''}
            </td>
            <td>
              <div class="nm-actions-row">
                ${n.supportDocumentUrl ? `<a href="${escapeAttr(n.supportDocumentUrl)}" target="_blank" class="nm-action-btn nm-action-view">📎 Soporte</a>` : ''}
                ${admin && n.status === 'PENDIENTE' ? `
                  <button type="button" class="nm-action-btn nm-action-approve" data-nov-id="${n.id}">✓ Aprobar</button>
                  <button type="button" class="nm-action-btn nm-action-reject" data-nov-id="${n.id}">✗ Rechazar</button>
                ` : ''}
              </div>
            </td>
          </tr>`;
        }).join('')
        : `<tr><td colspan="7" class="nm-table-empty">No hay novedades registradas para este período.</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;
}

function buildMunicipalitiesCard(novedades, munStatusMap, personnelMap, selectedPeriod) {
  const admin = isAdminOrTH();
  const gestor = isGestor();
  const canMarkDone = (admin || gestor) && selectedPeriod && selectedPeriod.status !== 'CERRADO';

  const munStats = {};
  novedades.forEach(n => {
    const emp = personnelMap[String(n.employeeId)] || {};
    const mun = emp.educationalMunicipality || emp.educational_municipality ||
                emp.municipio_institucional || emp.municipality || emp.municipio || 'Sin municipio';
    if (!munStats[mun]) munStats[mun] = { total: 0, types: {}, approved: 0, pending: 0, rejected: 0 };
    munStats[mun].total++;
    munStats[mun].types[n.noveltyType] = (munStats[mun].types[n.noveltyType] || 0) + 1;
    if (n.status === 'APROBADA')  munStats[mun].approved++;
    if (n.status === 'PENDIENTE') munStats[mun].pending++;
    if (n.status === 'RECHAZADA') munStats[mun].rejected++;
  });

  const allMuns = Object.keys(munStats).sort();
  const completedCount = allMuns.filter(m => munStatusMap[m]?.is_complete).length;

  return `
<div class="nm-card" id="nmMunicipalitiesCard">
  <div class="nm-card-head">
    <div class="nm-card-head-left">
      <span class="nm-step-badge">3</span>
      <div>
        <h3 class="nm-card-title"><span class="nm-card-title-icon">🏙️</span> Estado por Municipio</h3>
        <p class="nm-card-subtitle">${completedCount} de ${allMuns.length} municipio${allMuns.length !== 1 ? 's' : ''} marcado${completedCount !== 1 ? 's' : ''} como terminado</p>
      </div>
    </div>
  </div>
  <div class="nm-municipalities-list" id="nmMunList">
    ${allMuns.length === 0
      ? `<p class="nm-empty-hint">No hay novedades registradas para este período.</p>`
      : allMuns.map(mun => {
          const s = munStats[mun];
          const statusData = munStatusMap[mun] || {};
          const isComplete = !!statusData.is_complete;
          const typeChips = Object.entries(s.types)
            .map(([t, c]) => `<span class="nm-mun-type-chip">${typeLabel(t)}: ${c}</span>`)
            .join('');
          return `
          <div class="nm-mun-row ${isComplete ? 'nm-mun-complete' : 'nm-mun-pending'}">
            <div class="nm-mun-info">
              <div class="nm-mun-name">${escapeHtml(mun)}</div>
              <div class="nm-mun-types">${typeChips}</div>
              <div class="nm-mun-stats">
                <span>${s.total} novedad${s.total !== 1 ? 'es' : ''}</span>
                ${s.pending  > 0 ? `<span class="nm-mun-stat-pending">${s.pending} pendiente${s.pending !== 1 ? 's' : ''}</span>` : ''}
                ${s.approved > 0 ? `<span class="nm-mun-stat-approved">${s.approved} aprobada${s.approved !== 1 ? 's' : ''}</span>` : ''}
                ${s.rejected > 0 ? `<span class="nm-mun-stat-rejected">${s.rejected} rechazada${s.rejected !== 1 ? 's' : ''}</span>` : ''}
              </div>
              ${isComplete && statusData.completed_by_name
                ? `<div class="nm-mun-completed-by">✓ Completado por ${escapeHtml(statusData.completed_by_name)} · ${fmtDate(statusData.completed_at)}</div>`
                : ''}
            </div>
            <div class="nm-mun-actions">
              ${isComplete
                ? `<span class="nm-mun-done-badge">✓ Terminado</span>`
                : canMarkDone
                  ? `<button type="button" class="nm-btn nm-btn-done" data-municipality="${escapeAttr(mun)}" data-period-id="${selectedPeriod?.id || ''}">Marcar terminado</button>`
                  : `<span class="nm-mun-pending-label">Pendiente</span>`}
            </div>
          </div>`;
        }).join('')}
  </div>
</div>`;
}

function buildResultsCard(results, selectedPeriod) {
  const admin = isAdminOrTH();
  const lines  = results?.data?.lines  || results?.lines  || [];
  const totals = results?.data?.totals || results?.totals || {};
  const isCalculated = selectedPeriod?.status === 'CALCULADO' || selectedPeriod?.status === 'CERRADO';
  const isClosed = selectedPeriod?.status === 'CERRADO';

  return `
<div class="nm-card" id="nmResultsCard">
  <div class="nm-card-head">
    <div class="nm-card-head-left">
      <span class="nm-step-badge">4</span>
      <div>
        <h3 class="nm-card-title"><span class="nm-card-title-icon">💰</span> Valores de Nómina</h3>
        <p class="nm-card-subtitle">${isCalculated ? `${lines.length} empleado${lines.length !== 1 ? 's' : ''} procesado${lines.length !== 1 ? 's' : ''}` : 'Sin calcular para este período'}</p>
      </div>
    </div>
    <div class="nm-results-actions">
      ${admin && selectedPeriod && !isClosed
        ? `<button type="button" class="nm-btn nm-btn-secondary" id="nmBtnCalculate">⚙ Calcular nómina</button>`
        : ''}
      ${isCalculated && selectedPeriod
        ? `<a href="/payroll/periods/${selectedPeriod.id}/export" class="nm-btn nm-btn-secondary" download>↓ Exportar Excel</a>`
        : ''}
    </div>
  </div>

  ${isCalculated && lines.length > 0 ? `
  <div class="nm-totals-bar">
    <div class="nm-total-item">
      <span class="nm-total-label">Total devengado</span>
      <span class="nm-total-value">${fmtMoney(totals.totalDevengado)}</span>
    </div>
    <div class="nm-total-sep"></div>
    <div class="nm-total-item">
      <span class="nm-total-label">Total deducciones</span>
      <span class="nm-total-value nm-deduction">${fmtMoney(totals.totalDeducciones)}</span>
    </div>
    <div class="nm-total-sep"></div>
    <div class="nm-total-item nm-total-neto">
      <span class="nm-total-label">Neto a pagar</span>
      <span class="nm-total-value nm-total-neto-val">${fmtMoney(totals.netoPagar)}</span>
    </div>
  </div>
  <div class="nm-table-wrap">
    <table class="nm-table">
      <thead>
        <tr>
          <th>Municipio</th>
          <th>Institución</th>
          <th>Modalidad</th>
          <th>Nombre completo</th>
          <th>Cédula</th>
          <th>Novedades</th>
          <th>Neto a pagar</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        ${lines.map(l => `
        <tr>
          <td>${escapeHtml(l.municipality || '—')}</td>
          <td class="nm-doc-cell">${escapeHtml(l.institution || '—')}</td>
          <td><span class="nm-mod-chip nm-mod-${(l.modality || '').toLowerCase()}">${escapeHtml(l.modality || '—')}</span></td>
          <td>
            <div class="nm-name-cell">${escapeHtml(l.employeeName || '—')}</div>
            <div class="nm-doc-cell">${escapeHtml(l.workTimeType || '')}</div>
          </td>
          <td class="nm-doc-cell">${escapeHtml(l.documentNumber || '—')}</td>
          <td class="nm-num">${l.novedadDescuento ? fmtMoney(l.novedadDescuento) : '—'}</td>
          <td class="nm-neto">${fmtMoney(l.netoPagar)}</td>
          <td>
            <div class="nm-actions-row">
              <button type="button" class="nm-action-btn nm-action-detail"
                data-emp-id="${escapeAttr(String(l.employeeId || ''))}"
                data-period-id="${selectedPeriod?.id || ''}">Ver</button>
              <button type="button" class="nm-action-btn nm-action-slip"
                data-emp-id="${escapeAttr(String(l.employeeId || ''))}"
                data-emp-name="${escapeAttr(l.employeeName || '')}"
                data-period-id="${selectedPeriod?.id || ''}">Desprendible</button>
            </div>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : selectedPeriod ? `
  <div class="nm-empty-hint" style="padding:24px 0">
    ${admin
      ? 'Haz clic en <strong>Calcular nómina</strong> para procesar los valores del período.'
      : 'La nómina aún no ha sido calculada para este período.'}
  </div>` : `<div class="nm-empty-hint" style="padding:24px 0">Selecciona un período para ver los valores.</div>`}
</div>`;
}

function buildConfirmCard(selectedPeriod) {
  if (!isAdminOrTH() || !selectedPeriod) return '';
  const isClosed = selectedPeriod.status === 'CERRADO';
  const isCalculated = selectedPeriod.status === 'CALCULADO';

  return `
<div class="nm-card" id="nmConfirmCard">
  <div class="nm-card-head">
    <div class="nm-card-head-left">
      <span class="nm-step-badge">5</span>
      <div>
        <h3 class="nm-card-title"><span class="nm-card-title-icon">✅</span> Confirmación y Envío</h3>
        <p class="nm-card-subtitle">${isClosed ? 'Nómina confirmada y cerrada' : 'Confirma la nómina y envía desprendibles por correo'}</p>
      </div>
    </div>
  </div>
  <div class="nm-confirm-body">
    ${isClosed ? `
    <div class="nm-confirm-done">
      <div class="nm-confirm-icon">✓</div>
      <div>
        <p class="nm-confirm-title">Nómina confirmada y cerrada</p>
        <p class="nm-confirm-text">Este período está cerrado e inmutable. Los desprendibles están disponibles en la tabla de valores.</p>
      </div>
    </div>`
    : isCalculated ? `
    <div class="nm-confirm-warn">
      <p>Al confirmar, el período quedará <strong>cerrado e inmutable</strong>. Se enviarán los desprendibles por correo a cada empleado con email registrado.</p>
    </div>
    <div class="nm-confirm-actions">
      <button type="button" class="nm-btn nm-btn-danger" id="nmBtnConfirmAndSend" data-period-id="${selectedPeriod.id}">
        Confirmar nómina y enviar desprendibles
      </button>
    </div>`
    : `<div class="nm-confirm-warn"><p>Primero calcula la nómina para poder confirmarla.</p></div>`}
  </div>
</div>`;
}

// ── Main loader ───────────────────────────────────────────────────────────────

export async function loadNominaModule() {
  let periods = [];
  try {
    const res = await apiFetch('/payroll/periods');
    periods = Array.isArray(res.data) ? res.data : [];
  } catch { periods = []; }

  periods.sort((a, b) =>
    new Date(b.periodStart || b.created_at || 0) - new Date(a.periodStart || a.created_at || 0)
  );

  if (!state.payrollPeriodId && periods.length > 0) {
    state.payrollPeriodId = String(periods[0].id);
  }

  const selId = state.payrollPeriodId ? String(state.payrollPeriodId) : '';
  const selectedPeriod = periods.find(p => String(p.id) === selId) || null;

  let personnelMap = {};
  try {
    const pp = await apiFetch('/personnel');
    const rows = Array.isArray(pp.data) ? pp.data : Array.isArray(pp.personnel) ? pp.personnel : [];
    rows.forEach(e => {
      personnelMap[String(e.id)] = e;
      if (e.legacyJsonId) personnelMap[String(e.legacyJsonId)] = e;
      if (e.legacy_json_id) personnelMap[String(e.legacy_json_id)] = e;
    });
  } catch { }

  let novedades = [];
  let munStatusMap = {};
  let results = null;

  if (selectedPeriod) {
    try {
      const nr = await apiFetch(`/payroll/periods/${selectedPeriod.id}/novelties`);
      novedades = Array.isArray(nr.data) ? nr.data : [];
    } catch { }

    try {
      const mr = await apiFetch(`/payroll/periods/${selectedPeriod.id}/municipality-status`);
      const rows = Array.isArray(mr.data) ? mr.data : [];
      rows.forEach(r => { munStatusMap[r.municipality] = r; });
    } catch { }

    if (selectedPeriod.status === 'CALCULADO' || selectedPeriod.status === 'CERRADO') {
      try {
        results = await apiFetch(`/payroll/periods/${selectedPeriod.id}/results`);
      } catch { }
    }
  }

  const payrollView = getPayrollViewState();
  const payrollRows = buildPayrollRows(results, personnelMap, selectedPeriod, novedades);
  const payrollMunicipalities = uniq(payrollRows.map(item => item.municipality));
  const payrollContracts = uniq(payrollRows.map(item => item.contractId).filter(Boolean)).map(id => ({
    value: id,
    label: getContractNameById(id, 'Sin contrato'),
  }));
  syncPayrollTopbar(periods, selectedPeriod, payrollView, payrollMunicipalities, payrollContracts);

  return buildPayrollWorkspace({
    periods,
    selectedPeriod,
    personnelMap,
    novedades,
    munStatusMap,
    results,
  });
  /*
<div class="nm-wrap">
  <section class="personnel-premium-hero">
    <div>
      <span class="personnel-premium-eyebrow">💼 Módulo de Gestión</span>
      <h2>Nómina y Liquidación</h2>
      <p>Gestión de períodos, registro de novedades por municipio, liquidación de valores y envío de desprendibles de pago.</p>
      <div class="nm-hero-steps">
        <span class="nm-hero-step"><span class="nm-hero-step-num">1</span> Período</span>
        <span class="nm-hero-step"><span class="nm-hero-step-num">2</span> Novedades</span>
        <span class="nm-hero-step"><span class="nm-hero-step-num">3</span> Municipios</span>
        <span class="nm-hero-step"><span class="nm-hero-step-num">4</span> Valores</span>
        <span class="nm-hero-step"><span class="nm-hero-step-num">5</span> Confirmar</span>
      </div>
    </div>
  </section>

  ${buildPeriodCard(periods, selectedPeriod)}
  ${selectedPeriod ? buildNovedadesCard(novedades, personnelMap, selectedPeriod) : ''}
  ${selectedPeriod ? buildMunicipalitiesCard(novedades, munStatusMap, personnelMap, selectedPeriod) : ''}
  ${buildResultsCard(results, selectedPeriod)}
  ${buildConfirmCard(selectedPeriod)}
</div>`;
  */
}

// ── Event wiring ──────────────────────────────────────────────────────────────

export function wireNominaEvents() {
  const wrap = document.querySelector('.nm-wrap');
  if (!wrap) return;
  const view = getPayrollViewState();
  let payrollSearchTimer = null;
  const reloadView = async (patch = {}, { resetPage = true } = {}) => {
    Object.assign(view, patch);
    if (resetPage) view.page = 1;
    await _reload();
  };

  document.getElementById('nmTopContractSelect')?.addEventListener('change', async e => {
    await reloadView({ topContractId: e.target.value || '' });
  });

  document.getElementById('nmTopMunicipalitySelect')?.addEventListener('change', async e => {
    await reloadView({ topMunicipality: e.target.value || '' });
  });

  document.getElementById('nmTopPeriodSelect')?.addEventListener('change', async e => {
    state.payrollPeriodId = e.target.value || null;
    await reloadView({}, { resetPage: true });
  });

  document.getElementById('nmFilterPeriod')?.addEventListener('change', async e => {
    state.payrollPeriodId = e.target.value || null;
    await reloadView({}, { resetPage: true });
  });

  document.getElementById('nmPayrollSearch')?.addEventListener('input', e => {
    const nextValue = e.target.value || '';
    window.clearTimeout(payrollSearchTimer);
    payrollSearchTimer = window.setTimeout(async () => {
      await reloadView({ search: nextValue });
    }, 220);
  });

  [
    ['nmFilterSite', 'filterSite'],
    ['nmFilterModality', 'filterModality'],
    ['nmFilterRole', 'filterRole'],
    ['nmFilterStatus', 'filterStatus'],
    ['nmFilterCompany', 'filterCompanyId'],
    ['nmFilterContract', 'filterContractId'],
    ['nmFilterMunicipality', 'filterMunicipality'],
    ['nmFilterContractType', 'filterContractType'],
  ].forEach(([id, key]) => {
    document.getElementById(id)?.addEventListener('change', async e => {
      await reloadView({ [key]: e.target.value || '' });
    });
  });

  document.getElementById('nmBtnClearFilters')?.addEventListener('click', async () => {
    Object.assign(view, {
      topContractId: state.currentUser?.contractId ? String(state.currentUser.contractId) : '',
      topMunicipality: '',
      search: '',
      filterSite: '',
      filterModality: '',
      filterRole: '',
      filterStatus: '',
      filterCompanyId: '',
      filterContractId: '',
      filterMunicipality: '',
      filterContractType: '',
      page: 1,
    });
    await _reload();
  });

  document.querySelectorAll('[data-payroll-page]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const nextPage = Number(btn.dataset.payrollPage || view.page || 1);
      if (!Number.isFinite(nextPage) || nextPage < 1) return;
      view.page = nextPage;
      await _reload();
    });
  });

  wrap.addEventListener('click', e => {
    const calcTrigger = e.target.closest('[data-payroll-trigger-calc]');
    if (calcTrigger) {
      e.preventDefault();
      document.getElementById('nmBtnCalculate')?.click();
      return;
    }

    const targetPanel = e.target.closest('[data-nm-open-panel]');
    if (targetPanel) {
      e.preventDefault();
      const panel = document.getElementById(targetPanel.dataset.nmOpenPanel || '');
      if (!panel) return;
      if (panel.tagName === 'DETAILS') panel.open = true;
      panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });

  // Period select
  document.getElementById('nmPeriodSelect')?.addEventListener('change', async e => {
    state.payrollPeriodId = e.target.value || null;
    await _reload();
  });

  // Toggle create period form
  const btnToggle = document.getElementById('nmBtnToggleCreate');
  if (btnToggle) {
    btnToggle.addEventListener('click', () => {
      const fw = document.getElementById('nmCreatePeriodWrap');
      if (!fw) return;
      const opening = fw.classList.contains('hidden');
      fw.classList.toggle('hidden', !opening);
      btnToggle.textContent = opening ? '✕ Cancelar' : '+ Nuevo período';
    });
  }

  document.getElementById('nmBtnCancelCreate')?.addEventListener('click', () => {
    document.getElementById('nmCreatePeriodWrap')?.classList.add('hidden');
    const btn = document.getElementById('nmBtnToggleCreate');
    if (btn) btn.textContent = '+ Nuevo período';
  });

  document.getElementById('nmBtnSavePeriod')?.addEventListener('click', async () => {
    const label = document.getElementById('nmNewLabel')?.value.trim();
    const start = document.getElementById('nmNewStart')?.value;
    const end   = document.getElementById('nmNewEnd')?.value;
    if (!label) { showWarning('Ingresa una etiqueta para el período.'); return; }
    if (!start || !end) { showWarning('Las fechas de inicio y fin son obligatorias.'); return; }
    if (start >= end) { showWarning('La fecha fin debe ser posterior al inicio.'); return; }
    const btn = document.getElementById('nmBtnSavePeriod');
    btn.disabled = true; btn.textContent = 'Creando…';
    try {
      const companyId  = state.currentUser?.companyId  || state.currentUser?.company_id  || 1;
      const contractId = state.currentUser?.contractId || state.currentUser?.contract_id || null;
      const res = await apiFetch('/payroll/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, periodStart: start, periodEnd: end, companyId, contractId }),
      });
      state.payrollPeriodId = String(res.data?.id || '');
      showSuccess('Período creado correctamente.');
      await _reload();
    } catch (e) {
      showError(e.message || 'Error al crear el período.');
      btn.disabled = false; btn.textContent = 'Crear período';
    }
  });

  // Toggle novedad form
  document.getElementById('nmBtnAddNovedad')?.addEventListener('click', () => {
    document.getElementById('nmNovedadFormWrap')?.classList.toggle('hidden');
  });

  document.getElementById('nmBtnCancelNovedad')?.addEventListener('click', () => {
    document.getElementById('nmNovedadFormWrap')?.classList.add('hidden');
  });

  // Municipality cascade in novedad form
  document.getElementById('nmNovMunicipality')?.addEventListener('change', async e => {
    const mun = e.target.value;
    const empSel = document.getElementById('nmNovEmployee');
    if (!empSel) return;
    if (!mun) {
      empSel.innerHTML = '<option value="">Primero selecciona municipio</option>';
      empSel.disabled = true;
      return;
    }
    empSel.innerHTML = '<option value="">Cargando…</option>';
    empSel.disabled = true;
    try {
      const pp = await apiFetch('/personnel');
      const rows = Array.isArray(pp.data) ? pp.data : Array.isArray(pp.personnel) ? pp.personnel : [];
      const munNorm = mun.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      const filtered = rows.filter(e => {
        const s = String(e.status || e.estado || '').toUpperCase();
        const active = s === 'ACTIVO' || s === 'ACTIVE';
        const em = String(e.educationalMunicipality || e.educational_municipality ||
                          e.municipio_institucional || e.municipality || e.municipio || '')
                   .toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
        return active && em === munNorm;
      });
      empSel.innerHTML = `<option value="">Selecciona empleado (${filtered.length})</option>` +
        filtered.map(e => {
          const name = e.fullName || e.full_name || e.nombre_completo || '';
          const doc  = e.documentNumber || e.numero_documento || '';
          return `<option value="${escapeAttr(String(e.id))}">${escapeHtml(name)} — ${escapeHtml(doc)}</option>`;
        }).join('');
      empSel.disabled = false;
    } catch {
      empSel.innerHTML = '<option value="">Error cargando empleados</option>';
      empSel.disabled = false;
    }
  });

  // Save novedad
  document.getElementById('nmBtnSaveNovedad')?.addEventListener('click', async () => {
    const fw         = document.getElementById('nmNovedadFormWrap');
    const periodId   = fw?.dataset.periodId;
    const employeeId = document.getElementById('nmNovEmployee')?.value;
    const noveltyType = document.getElementById('nmNovType')?.value;
    const startDate  = document.getElementById('nmNovStartDate')?.value;
    const endDate    = document.getElementById('nmNovEndDate')?.value;
    const days       = document.getElementById('nmNovDays')?.value;
    const observations = document.getElementById('nmNovObservations')?.value;

    if (!employeeId)  { showWarning('Selecciona un empleado.'); return; }
    if (!noveltyType) { showWarning('Selecciona el tipo de novedad.'); return; }
    if (!startDate)   { showWarning('La fecha de inicio es obligatoria.'); return; }

    const btn = document.getElementById('nmBtnSaveNovedad');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const endpoint = periodId
        ? `/payroll/periods/${periodId}/novelties`
        : '/payroll/novelties';
      await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, noveltyType, startDate, endDate: endDate || null, days: days || null, observations }),
      });
      showSuccess('Novedad registrada correctamente.');
      await _reload();
    } catch (e) {
      showError(e.message || 'Error al guardar la novedad.');
      btn.disabled = false; btn.textContent = 'Guardar novedad';
    }
  });

  // Approve novedades
  document.querySelectorAll('.nm-action-approve').forEach(btn => {
    btn.addEventListener('click', async () => {
      const novId = btn.dataset.novId;
      btn.disabled = true;
      try {
        await apiFetch(`/payroll/novelties/${novId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'APROBADA' }),
        });
        showSuccess('Novedad aprobada.');
        await _reload();
      } catch (e) {
        showError(e.message || 'Error al aprobar.');
        btn.disabled = false;
      }
    });
  });

  // Reject novedades
  document.querySelectorAll('.nm-action-reject').forEach(btn => {
    btn.addEventListener('click', async () => {
      const novId = btn.dataset.novId;
      const reason = window.prompt('Motivo del rechazo (obligatorio):');
      if (reason === null) return;
      if (!reason.trim()) { showWarning('El motivo del rechazo es obligatorio.'); return; }
      btn.disabled = true;
      try {
        await apiFetch(`/payroll/novelties/${novId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'RECHAZADA', reviewNotes: reason }),
        });
        showWarning('Novedad rechazada.');
        await _reload();
      } catch (e) {
        showError(e.message || 'Error al rechazar.');
        btn.disabled = false;
      }
    });
  });

  // Mark municipality as done
  document.querySelectorAll('.nm-btn-done[data-municipality]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const municipality = btn.dataset.municipality;
      const periodId = btn.dataset.periodId;
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await apiFetch(`/payroll/periods/${periodId}/municipality-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ municipality, isComplete: true }),
        });
        showSuccess(`Municipio ${municipality} marcado como terminado.`);
        await _reload();
      } catch (e) {
        showError(e.message || 'Error al marcar municipio.');
        btn.disabled = false; btn.textContent = 'Marcar terminado';
      }
    });
  });

  // Calculate
  document.getElementById('nmBtnCalculate')?.addEventListener('click', async () => {
    const periodId = state.payrollPeriodId;
    if (!periodId) return;
    if (!confirm('¿Calcular la nómina para este período?')) return;
    const btn = document.getElementById('nmBtnCalculate');
    btn.disabled = true; btn.textContent = '⚙ Calculando…';
    try {
      const res = await apiFetch(`/payroll/periods/${periodId}/calculate`, { method: 'POST' });
      showSuccess(res.message || 'Nómina calculada correctamente.');
      await _reload();
    } catch (e) {
      showError(e.message || 'Error al calcular.');
      btn.disabled = false; btn.textContent = '⚙ Calcular nómina';
    }
  });

  // Payslip / detail
  document.querySelectorAll('.nm-action-slip, .nm-action-detail').forEach(btn => {
    btn.addEventListener('click', async () => {
      const empId = btn.dataset.empId;
      const periodId = btn.dataset.periodId;
      const empName = btn.dataset.empName || '';
      btn.disabled = true;
      try {
        const res = await apiFetch(`/payroll/employees/${empId}/slip?periodId=${periodId}`);
        _showSlipModal(res.data, empName);
      } catch (e) {
        showError(e.message || 'No se pudo cargar el desprendible.');
      } finally { btn.disabled = false; }
    });
  });

  // Confirm and send
  document.getElementById('nmBtnConfirmAndSend')?.addEventListener('click', async () => {
    const periodId = document.getElementById('nmBtnConfirmAndSend')?.dataset.periodId;
    if (!confirm('¿Confirmar la nómina y enviar desprendibles? Esta acción cierra el período de forma IRREVERSIBLE.')) return;
    const btn = document.getElementById('nmBtnConfirmAndSend');
    btn.disabled = true; btn.textContent = 'Procesando…';
    try {
      const res = await apiFetch(`/payroll/periods/${periodId}/confirm-and-send`, { method: 'POST' });
      showSuccess(res.message || 'Nómina confirmada y desprendibles enviados.');
      await _reload();
    } catch (e) {
      showError(e.message || 'Error al confirmar.');
      btn.disabled = false; btn.textContent = 'Confirmar nómina y enviar desprendibles';
    }
  });
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function _reload() {
  const { openModule } = await import('../nav.js');
  await openModule('nomina_novedades');
}

function _showSlipModal(data, empName) {
  if (!data) { showError('No hay datos de desprendible disponibles.'); return; }

  const existing = document.getElementById('nmSlipModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'nmSlipModal';
  modal.className = 'nm-modal-overlay';
  modal.innerHTML = `
    <div class="nm-modal">
      <div class="nm-modal-head">
        <h3>Desprendible — ${escapeHtml(empName || data.employeeName || '')}</h3>
        <button class="nm-modal-close" type="button" title="Cerrar">✕</button>
      </div>
      <div class="nm-modal-body">
        <div class="nm-slip-grid">
          <div class="nm-slip-section nm-slip-full">
            <h4>Información del empleado</h4>
            <div class="nm-slip-2col">
              <div class="nm-slip-row"><span>Nombre:</span><span>${escapeHtml(data.employeeName || '—')}</span></div>
              <div class="nm-slip-row"><span>Documento:</span><span>${escapeHtml(data.documentNumber || '—')}</span></div>
              <div class="nm-slip-row"><span>Cargo:</span><span>${escapeHtml(data.workTimeType || '—')}</span></div>
              <div class="nm-slip-row"><span>Municipio:</span><span>${escapeHtml(data.municipality || '—')}</span></div>
              <div class="nm-slip-row"><span>Institución:</span><span>${escapeHtml(data.institution || '—')}</span></div>
              <div class="nm-slip-row"><span>Modalidad:</span><span>${escapeHtml(data.modality || '—')}</span></div>
              <div class="nm-slip-row"><span>Días trabajados:</span><span>${data.workedDays ?? '—'}</span></div>
            </div>
          </div>
          <div class="nm-slip-section">
            <h4>Devengados</h4>
            <div class="nm-slip-row"><span>Salario base:</span><span>${fmtMoney(data.baseSalary)}</span></div>
            <div class="nm-slip-row"><span>Aux. transporte:</span><span>${fmtMoney(data.transportAllowance)}</span></div>
            <div class="nm-slip-row"><span>Otros ingresos:</span><span>${fmtMoney(data.otherEarnings)}</span></div>
            <div class="nm-slip-row nm-slip-subtotal"><span>Total devengado:</span><span>${fmtMoney(data.totalDevengado)}</span></div>
          </div>
          <div class="nm-slip-section">
            <h4>Deducciones</h4>
            <div class="nm-slip-row"><span>Salud (4%):</span><span>${fmtMoney(data.deduccionSalud)}</span></div>
            <div class="nm-slip-row"><span>Pensión (4%):</span><span>${fmtMoney(data.deduccionPension)}</span></div>
            <div class="nm-slip-row"><span>Desc. novedades:</span><span>${fmtMoney(data.novedadDescuento)}</span></div>
            <div class="nm-slip-row nm-slip-subtotal"><span>Total deducciones:</span><span>${fmtMoney(data.totalDeducciones)}</span></div>
          </div>
          <div class="nm-slip-section nm-slip-full">
            <div class="nm-slip-neto-row"><span>NETO A PAGAR:</span><span>${fmtMoney(data.netoPagar)}</span></div>
          </div>
        </div>
      </div>
      <div class="nm-modal-foot">
        <button type="button" class="nm-btn nm-btn-primary" onclick="window.print()">Imprimir</button>
        <button type="button" class="nm-modal-close nm-btn nm-btn-ghost">Cerrar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('.nm-modal-close').forEach(b => b.addEventListener('click', () => modal.remove()));
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}
