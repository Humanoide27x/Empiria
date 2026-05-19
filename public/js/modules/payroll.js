import { state }     from '../state.js';
import { apiFetch }  from '../api.js';
import { escapeHtml } from '../utils.js';
import { showSuccess, showError } from '../toast.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const NOVELTY_TYPES = [
  { id: "incapacidad_eps", label: "Incapacidad EPS",          paid: true,  coverage: "EPS" },
  { id: "incapacidad_arl", label: "Incapacidad ARL",          paid: true,  coverage: "ARL" },
  { id: "licencia_mat",    label: "Licencia de maternidad",   paid: true,  coverage: "EPS" },
  { id: "licencia_nr",     label: "Licencia no remunerada",   paid: false, coverage: null  },
  { id: "ausencia",        label: "Ausencia injustificada",   paid: false, coverage: null  },
  { id: "suspension",      label: "Suspensión disciplinaria", paid: false, coverage: null  },
];

const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                   "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const MOD_COLOR = {
  CAARES1: "caares", CAARES2: "caares", CAARES3: "caares", CAARES4: "caares",
  CAA1: "caa", CAA2: "caa", RI: "ri",
};

const PAYROLL_GROUPS = [
  { key: "todos",           label: "Todos"                       },
  { key: "operarios",       label: "Operarios Manipuladores"     },
  { key: "bodega_ri",       label: "Bodega RI"                   },
  { key: "bodega_rp",       label: "Bodega RP"                   },
  { key: "administrativos", label: "Administrativos"             },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTH() {
  const r = String(state.currentUser?.role || "").toLowerCase();
  return r === "administrador" || r === "talento_humano";
}

function fmtCOP(n) {
  return Number(n).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
}

function periodLabel(periodStr) {
  const [y, m] = periodStr.split("-");
  return `${MONTHS_ES[Number(m) - 1]} ${y}`;
}

function statusBadge(status) {
  const map = {
    BORRADOR:  ["nm3-badge nm3-badge--draft",  "Borrador"],
    CALCULADO: ["nm3-badge nm3-badge--calc",   "Liquidado"],
    CERRADO:   ["nm3-badge nm3-badge--closed", "Cerrado"],
  };
  const [cls, lbl] = map[status] || ["nm3-badge", status];
  return `<span class="${cls}">${lbl}</span>`;
}

// ── Motor de cálculo ──────────────────────────────────────────────────────────

function calcEmployee(modalityClass, diasNoClase, novedades, salaryConfig, turnos = []) {
  const modalities  = salaryConfig.modalities || {};
  const modCfg      = modalities[modalityClass] || {};
  const smlv        = salaryConfig.smlv           || 1_750_905;
  const auxCfg      = salaryConfig.aux_transporte || 249_095;
  const salaryBase  = modCfg.salary               || smlv;
  const adicionales = (modCfg.adicionales || []).filter(
    a => String(a.label || "").trim() && Number(a.value) > 0
  );

  const diasSinPago       = novedades.filter(n => !n.paid).reduce((s, n) => s + n.days, 0);
  const diasCubiertos     = novedades.filter(n =>  n.paid).reduce((s, n) => s + n.days, 0);
  const diasConSalario    = Math.max(0, 30 - diasSinPago);
  const diasConTransporte = Math.max(0, 30 - diasNoClase - diasSinPago - diasCubiertos);

  // Si hay turnos registrados, calcular salario proporcional por modalidad de turno
  let salarioProp;
  let turnosInfo = [];
  if (turnos.length > 0) {
    salarioProp = 0;
    for (const t of turnos) {
      const tCfg   = modalities[t.modalidad] || modCfg;
      const tSal   = tCfg.salary || smlv;
      const tProp  = Math.round(tSal / 30 * Math.max(0, t.dias - diasSinPago));
      salarioProp += tProp;
      turnosInfo.push({ modalidad: t.modalidad, dias: t.dias, salario: tSal, prop: tProp });
    }
  } else {
    salarioProp = Math.round(salaryBase / 30 * diasConSalario);
  }

  const auxTrans    = Math.round(auxCfg / 30 * diasConTransporte);
  const adicsCalc   = adicionales.map(a => ({
    label: a.label,
    base:  Number(a.value),
    prop:  Math.round(Number(a.value) / 30 * diasConTransporte),
  }));
  const totalAdics = adicsCalc.reduce((s, a) => s + a.prop, 0);
  const totalDev   = salarioProp + auxTrans + totalAdics;
  const salud      = Math.ceil(salarioProp * 0.04 / 100) * 100;
  const pension    = salud;
  const totalDed   = salud * 2;
  const neto       = totalDev - totalDed;

  return {
    diasSinPago, diasCubiertos, diasConSalario, diasConTransporte,
    salaryBase, salarioProp, auxTrans, adicsCalc, totalAdics,
    totalDev, salud, pension, totalDed, neto, turnosInfo,
  };
}

// ── Estado del módulo ─────────────────────────────────────────────────────────

let _view          = "list";
let _periods       = [];
let _currentPeriod = null;
let _employees     = [];
let _salaryConfig  = {};
let _empState      = new Map();   // id → { diasNoClase, novedades, checked }
let _searchText       = "";
let _filterHasNov     = false;
let _filterMunicipio  = "";
let _filterModalidad  = "";
let _filterInstitucion = "";
let _filterSede       = "";
let _sortBy           = "";
let _sortDir          = "asc";
let _activeGroup      = "todos";
let _periodMonth   = String(new Date().getMonth() + 1).padStart(2, "0");
let _periodYear    = String(new Date().getFullYear());
let _modalEmpId    = null;

function getContractId() { return state.currentUser?.contractId || null; }
function getCompanyId()  { return state.currentUser?.companyId  || null; }

function _unique(key) {
  return [...new Set(_employees.map(e => e[key] || "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
}

function _selectOpts(values, current, placeholder) {
  return `<option value="">${placeholder}</option>` +
    values.map(v => `<option value="${escapeHtml(v)}" ${v === current ? "selected" : ""}>${escapeHtml(v)}</option>`).join("");
}

function _getGroup(emp) {
  const mc    = String(emp.modalityClass || "").toUpperCase();
  const mod   = String(emp.modality      || "").toUpperCase().trim();
  const cargo = String(emp.cargo         || "").toUpperCase();
  if (mc.startsWith("CAA") || mod === "CAA" || mod === "CAARES") return "operarios";
  if (mc === "RI" || mod === "RI") return "bodega_ri";
  if (mod === "RP" || cargo.includes("BODEGA RP") || cargo.includes("RP")) return "bodega_rp";
  return "administrativos";
}

function _groupTabsHtml() {
  const counts = { todos: _employees.length };
  for (const emp of _employees) {
    const g = _getGroup(emp);
    counts[g] = (counts[g] || 0) + 1;
  }
  return PAYROLL_GROUPS.map(g => `
    <button class="nm3-gtab ${_activeGroup === g.key ? "nm3-gtab--active" : ""}" data-group="${g.key}">
      ${escapeHtml(g.label)}
      <span class="nm3-gtab-count">${counts[g.key] || 0}</span>
    </button>`).join("");
}

function getEs(empId) {
  let es = _empState.get(empId);
  if (!es) { es = { diasNoClase: 0, novedades: [], horasDiarias: [], turnos: [], checked: false }; _empState.set(empId, es); }
  if (!es.turnos) es.turnos = [];
  return es;
}

function isHourBased(emp) {
  const g = _getGroup(emp);
  return g === "bodega_ri" || g === "bodega_rp" || g === "administrativos";
}

function calcHourEmployee(emp) {
  const es         = getEs(emp.id);
  const modCfg     = (_salaryConfig.modalities || {})[emp.modalityClass] || {};
  const salaryBase = modCfg.salary || (_salaryConfig.smlv || 1_750_905);
  const valorHora  = Math.round(salaryBase / 240);
  const totalHoras = es.horasDiarias.reduce((s, d) => s + (Number(d.horas) || 0), 0);
  const devengado  = Math.round(valorHora * totalHoras);
  const salud      = Math.ceil(devengado * 0.04 / 100) * 100;
  const pension    = salud;
  const totalDed   = salud * 2;
  const neto       = devengado - totalDed;
  return { valorHora, totalHoras, devengado, salud, pension, totalDed, neto };
}

function _groupEmployees() {
  if (_activeGroup === "todos") return _employees;
  return _employees.filter(e => _getGroup(e) === _activeGroup);
}

function _colCount() {
  if (_activeGroup === "todos")     return 7;
  if (_activeGroup === "operarios") return 12;
  return 10;
}

function _tableHeaderHtml() {
  if (_activeGroup === "todos") return `<tr>
    <th class="nm3-th-n">#</th>
    <th class="nm3-th-name">Nombre completo</th>
    <th class="nm3-th-doc">Cédula</th>
    <th class="nm3-th-inst">Institución / Sede</th>
    <th>Grupo</th>
    <th class="nm3-ar nm3-th-neto">Neto a pagar</th>
    <th class="nm3-th-act">✓</th>
  </tr>`;
  if (_activeGroup === "operarios") return `<tr>
    <th class="nm3-th-n">#</th>
    <th class="nm3-th-doc">Cédula</th>
    <th class="nm3-th-name">Nombre completo</th>
    <th class="nm3-th-inst">Institución / Sede</th>
    <th class="nm3-th-mod">Modalidad</th>
    <th class="nm3-th-nc" title="Días de no clase">No clase</th>
    <th class="nm3-th-nov">Novedades</th>
    <th class="nm3-th-turnos">Turnos</th>
    <th class="nm3-th-dev">Devengado</th>
    <th class="nm3-th-ded">Deducciones</th>
    <th class="nm3-th-neto">Neto a pagar</th>
    <th class="nm3-th-act">Acciones</th>
  </tr>`;
  return `<tr>
    <th class="nm3-th-n">#</th>
    <th class="nm3-th-doc">Cédula</th>
    <th class="nm3-th-name">Nombre completo</th>
    <th class="nm3-th-cargo">Cargo</th>
    <th class="nm3-th-horas">Horas</th>
    <th class="nm3-th-vh">Valor/hora</th>
    <th class="nm3-th-dev">Devengado</th>
    <th class="nm3-th-ded">Deducciones</th>
    <th class="nm3-th-neto">Neto a pagar</th>
    <th class="nm3-th-act">Acciones</th>
  </tr>`;
}

function _rowForEmp(emp, idx) {
  if (_activeGroup === "todos")   return _rowHtmlSummary(emp, idx);
  if (isHourBased(emp))          return _rowHtmlHours(emp, idx);
  return _rowHtml(emp, idx);
}

// ── Vista lista (períodos) ────────────────────────────────────────────────────

function _renderListView() {
  const root = document.getElementById("nm3-root");
  if (!root) return;

  const curYear = new Date().getFullYear();
  const years   = Array.from({ length: 5 }, (_, i) => curYear - 1 + i);

  root.innerHTML = `
<div class="nm3-card">
  <div class="nm3-card-hdr">
    <div>
      <h2 class="nm3-title">Nómina PAE</h2>
      <span class="nm3-subtitle">Períodos de liquidación</span>
    </div>
    ${isTH() ? `
    <div class="nm3-hdr-right">
      <select class="nm3-sel" id="nm3MonthSel">
        ${MONTHS_ES.map((n, i) => {
          const val = String(i + 1).padStart(2, "0");
          return `<option value="${val}" ${val === _periodMonth ? "selected" : ""}>${n}</option>`;
        }).join("")}
      </select>
      <select class="nm3-sel" id="nm3YearSel">
        ${years.map(y => `<option value="${y}" ${String(y) === _periodYear ? "selected" : ""}>${y}</option>`).join("")}
      </select>
      <button class="nm3-btn nm3-btn--primary" id="nm3BtnNew">＋ Nueva nómina</button>
    </div>` : ""}
  </div>

  <div class="nm3-card-body">
    ${_periods.length ? `
    <table class="nm3-periods-tbl">
      <thead>
        <tr>
          <th>Período</th>
          <th>Estado</th>
          <th class="nm3-ar">Empleados</th>
          <th class="nm3-ar">Neto total</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${_periods.map(p => `
        <tr class="nm3-period-row">
          <td class="nm3-period-name">${escapeHtml(p.label)}</td>
          <td>${statusBadge(p.status)}</td>
          <td class="nm3-ar">${p.employee_count || 0}</td>
          <td class="nm3-ar nm3-green">${fmtCOP(p.total_neto || 0)}</td>
          <td class="nm3-ar"><button class="nm3-btn nm3-btn--sm nm3-btn--outline" data-open="${p.id}">Abrir →</button></td>
        </tr>`).join("")}
      </tbody>
    </table>` : `
    <div class="nm3-empty-state">
      <span class="nm3-empty-icon">📋</span>
      <p>No hay períodos registrados.</p>
      ${isTH() ? `<p class="nm3-empty-hint">Selecciona mes y año y crea el primer período.</p>` : ""}
    </div>`}
  </div>
</div>`;

  _wireListEvents();
}

// ── Vista detalle (tabla empleados) ──────────────────────────────────────────

function _filtered() {
  let list = _employees.filter(e => {
    if (_searchText) {
      const hay = `${e.fullName} ${e.documentNumber} ${e.institutionName} ${e.siteName} ${e.municipalityName}`.toLowerCase();
      if (!hay.includes(_searchText)) return false;
    }
    if (_activeGroup !== "todos" && _getGroup(e) !== _activeGroup) return false;
    if (_filterHasNov     && !getEs(e.id).novedades.length)    return false;
    if (_filterMunicipio  && e.municipalityName !== _filterMunicipio)  return false;
    if (_filterModalidad  && e.modalityClass    !== _filterModalidad)   return false;
    if (_filterInstitucion && e.institutionName !== _filterInstitucion) return false;
    if (_filterSede       && e.siteName         !== _filterSede)        return false;
    return true;
  });

  if (_sortBy) {
    list = [...list].sort((a, b) => {
      if (_sortBy === "neto") {
        const na = calcEmployee(a.modalityClass, getEs(a.id).diasNoClase, getEs(a.id).novedades, _salaryConfig).neto;
        const nb = calcEmployee(b.modalityClass, getEs(b.id).diasNoClase, getEs(b.id).novedades, _salaryConfig).neto;
        return _sortDir === "asc" ? na - nb : nb - na;
      }
      const fieldMap = { nombre: "fullName", municipio: "municipalityName", institucion: "institutionName", sede: "siteName", modalidad: "modalityClass" };
      const va = String(a[fieldMap[_sortBy]] || "").toLowerCase();
      const vb = String(b[fieldMap[_sortBy]] || "").toLowerCase();
      const cmp = va.localeCompare(vb, "es");
      return _sortDir === "asc" ? cmp : -cmp;
    });
  }

  return list;
}

function _rowHtml(emp, idx) {
  const es       = getEs(emp.id);
  const calc     = calcEmployee(emp.modalityClass, es.diasNoClase, es.novedades, _salaryConfig, es.turnos);
  const modColor = MOD_COLOR[emp.modalityClass] || "caa";
  const novCount = es.novedades.length;
  const turnoCount = es.turnos.length;
  const canEdit  = isTH() && _currentPeriod?.status !== "CERRADO";
  const checkedCls = es.checked ? "nm3-row--done" : "";

  const novCell = novCount > 0
    ? `<button class="nm3-nov-pill nm3-nov-pill--has" data-emp="${emp.id}">⚠ ${novCount} nov.</button>`
    : `<span class="nm3-nov-pill nm3-nov-pill--none">—</span>`;

  const turnoCell = turnoCount > 0
    ? `<button class="nm3-turno-pill nm3-turno-pill--has" data-emp="${emp.id}">🔄 ${turnoCount} turno${turnoCount !== 1 ? "s" : ""}</button>`
    : (canEdit
        ? `<button class="nm3-turno-pill nm3-turno-pill--add" data-emp="${emp.id}">＋ Turno</button>`
        : `<span class="nm3-turno-pill nm3-turno-pill--none">—</span>`);

  return `
<tr class="nm3-tr ${checkedCls}" data-emp-id="${emp.id}">
  <td class="nm3-td-n">${idx + 1}</td>
  <td class="nm3-td-doc">
    <div class="nm3-doc-t">${escapeHtml(emp.documentType || "CC")}</div>
    <div class="nm3-doc-v">${escapeHtml(emp.documentNumber)}</div>
  </td>
  <td class="nm3-td-name">${escapeHtml(emp.fullName)}</td>
  <td class="nm3-td-inst">
    <div class="nm3-inst">${escapeHtml(emp.institutionName || "—")}</div>
    <div class="nm3-sede">${escapeHtml(emp.siteName || "—")}</div>
  </td>
  <td class="nm3-td-mod">
    <span class="nm3-mod nm3-mod--${modColor}">${escapeHtml(emp.modalityClass)}</span>
  </td>
  <td class="nm3-td-nc">
    ${canEdit
      ? `<input type="number" class="nm3-nc-inp" data-emp="${emp.id}" value="${es.diasNoClase}" min="0" max="30">`
      : `<span class="nm3-nc-ro">${es.diasNoClase}</span>`}
  </td>
  <td class="nm3-td-nov">${novCell}</td>
  <td class="nm3-td-turnos">${turnoCell}</td>
  <td class="nm3-td-dev">${fmtCOP(calc.totalDev)}</td>
  <td class="nm3-td-ded">
    <div class="nm3-ded-main">− ${fmtCOP(calc.totalDed)}</div>
    <div class="nm3-ded-det">S ${fmtCOP(calc.salud)} · P ${fmtCOP(calc.pension)}</div>
  </td>
  <td class="nm3-td-neto">${fmtCOP(calc.neto)}</td>
  <td class="nm3-td-act">
    ${canEdit ? `<button class="nm3-act nm3-act-nov" data-emp="${emp.id}" title="Registrar novedad">＋ Nov</button>` : ""}
    <button class="nm3-act nm3-act-calc" data-emp="${emp.id}" title="Ver cálculo detallado">🧾</button>
    ${canEdit ? `<button class="nm3-act nm3-act-ok ${es.checked ? "nm3-act-ok--on" : ""}" data-emp="${emp.id}" title="${es.checked ? "Marcar pendiente" : "Marcar listo"}">
      ${es.checked ? "✓" : "○"}
    </button>` : ""}
  </td>
</tr>`;
}

function _rowHtmlSummary(emp, idx) {
  const es    = getEs(emp.id);
  const neto  = isHourBased(emp)
    ? calcHourEmployee(emp).neto
    : calcEmployee(emp.modalityClass, es.diasNoClase, es.novedades, _salaryConfig).neto;
  const grp   = _getGroup(emp);
  const grpLabel = { operarios:"Operarios", bodega_ri:"Bodega RI", bodega_rp:"Bodega RP", administrativos:"Admin." }[grp] || grp;
  const grpColor = { operarios:"caa", bodega_ri:"ri", bodega_rp:"caares", administrativos:"ri" }[grp] || "caa";
  return `
<tr class="nm3-tr ${es.checked ? "nm3-row--done" : ""}" data-emp-id="${emp.id}">
  <td class="nm3-td-n">${idx + 1}</td>
  <td class="nm3-td-name">${escapeHtml(emp.fullName)}</td>
  <td class="nm3-td-doc">
    <div class="nm3-doc-t">${escapeHtml(emp.documentType || "CC")}</div>
    <div class="nm3-doc-v">${escapeHtml(emp.documentNumber)}</div>
  </td>
  <td class="nm3-td-inst">
    <div class="nm3-inst">${escapeHtml(emp.institutionName || "—")}</div>
    <div class="nm3-sede">${escapeHtml(emp.siteName || "—")}</div>
  </td>
  <td><span class="nm3-mod nm3-mod--${grpColor}">${grpLabel}</span></td>
  <td class="nm3-td-neto">${fmtCOP(neto)}</td>
  <td class="nm3-td-act">${es.checked ? "✓" : "—"}</td>
</tr>`;
}

function _rowHtmlHours(emp, idx) {
  const es      = getEs(emp.id);
  const calc    = calcHourEmployee(emp);
  const canEdit = isTH() && _currentPeriod?.status !== "CERRADO";
  return `
<tr class="nm3-tr ${es.checked ? "nm3-row--done" : ""}" data-emp-id="${emp.id}">
  <td class="nm3-td-n">${idx + 1}</td>
  <td class="nm3-td-doc">
    <div class="nm3-doc-t">${escapeHtml(emp.documentType || "CC")}</div>
    <div class="nm3-doc-v">${escapeHtml(emp.documentNumber)}</div>
  </td>
  <td class="nm3-td-name">${escapeHtml(emp.fullName)}</td>
  <td class="nm3-td-cargo">${escapeHtml(emp.cargo || "—")}</td>
  <td class="nm3-td-horas">
    <button class="nm3-horas-pill ${calc.totalHoras > 0 ? "nm3-horas-pill--has" : "nm3-horas-pill--none"}" data-emp="${emp.id}">
      ${calc.totalHoras > 0 ? `${calc.totalHoras}h` : "Sin horas"}
    </button>
  </td>
  <td class="nm3-td-vh">${fmtCOP(calc.valorHora)}<span class="nm3-vh-unit">/h</span></td>
  <td class="nm3-td-dev">${fmtCOP(calc.devengado)}</td>
  <td class="nm3-td-ded">
    <div class="nm3-ded-main">− ${fmtCOP(calc.totalDed)}</div>
    <div class="nm3-ded-det">S ${fmtCOP(calc.salud)} · P ${fmtCOP(calc.pension)}</div>
  </td>
  <td class="nm3-td-neto">${fmtCOP(calc.neto)}</td>
  <td class="nm3-td-act">
    ${canEdit ? `<button class="nm3-act nm3-act-horas" data-emp="${emp.id}" title="Registrar horas">📅</button>` : ""}
    <button class="nm3-act nm3-act-calc" data-emp="${emp.id}" title="Ver cálculo">🧾</button>
    ${canEdit ? `<button class="nm3-act nm3-act-ok ${es.checked ? "nm3-act-ok--on" : ""}" data-emp="${emp.id}">
      ${es.checked ? "✓" : "○"}
    </button>` : ""}
  </td>
</tr>`;
}

function _totalsHtml() {
  let dev = 0, ded = 0, neto = 0;
  const done    = [..._empState.values()].filter(e => e.checked).length;
  const empList = _groupEmployees();
  for (const emp of empList) {
    const c = isHourBased(emp)
      ? calcHourEmployee(emp)
      : calcEmployee(emp.modalityClass, getEs(emp.id).diasNoClase, getEs(emp.id).novedades, _salaryConfig);
    dev  += c.totalDev;
    ded  += c.totalDed;
    neto += c.neto;
  }
  return `
<div class="nm3-totals">
  <div class="nm3-tot"><span class="nm3-tot-lbl">Empleados</span><strong>${empList.length}</strong></div>
  <div class="nm3-tot"><span class="nm3-tot-lbl">Devengado</span><strong>${fmtCOP(dev)}</strong></div>
  <div class="nm3-tot nm3-tot-ded"><span class="nm3-tot-lbl">Deducciones</span><strong>− ${fmtCOP(ded)}</strong></div>
  <div class="nm3-tot nm3-tot-neto"><span class="nm3-tot-lbl">Neto total</span><strong>${fmtCOP(neto)}</strong></div>
  <div class="nm3-tot nm3-tot-done"><span class="nm3-tot-lbl">Revisados</span><strong>${done} / ${_employees.length}</strong></div>
</div>`;
}

function _renderDetailView() {
  const root     = document.getElementById("nm3-root");
  const period   = _currentPeriod;
  const filtered = _filtered();
  if (!root) return;

  const done  = [..._empState.values()].filter(e => e.checked).length;
  const total = _employees.length;

  root.innerHTML = `
<div class="nm3-card nm3-card--full">

  <!-- Header -->
  <div class="nm3-hdr">
    <button class="nm3-back" id="nm3Back">← Volver</button>
    <div class="nm3-hdr-center">
      <h2 class="nm3-period-title">${escapeHtml(period.label)}</h2>
      ${statusBadge(period.status)}
      <span class="nm3-done-pill" id="nm3DonePill">${done}/${total} revisados</span>
    </div>
    <div class="nm3-hdr-actions">
      ${isTH() && period.status !== "CERRADO" ? `
        <button class="nm3-btn nm3-btn--primary" id="nm3BtnSave">💾 Guardar</button>` : ""}
      <a class="nm3-btn nm3-btn--outline" href="/nomina/periods/${period.id}/export" download>⬇ Excel</a>
      ${isTH() && period.status === "CALCULADO" ? `
        <button class="nm3-btn nm3-btn--danger" id="nm3BtnClose">🔒 Cerrar</button>` : ""}
    </div>
  </div>

  <!-- Tabs de grupo nómina -->
  <div class="nm3-group-tabs" id="nm3GroupTabs">
    ${_groupTabsHtml()}
  </div>

  <!-- Filtros -->
  <div class="nm3-bar">
    <input type="text" class="nm3-search" id="nm3Search"
      placeholder="Nombre, cédula…"
      value="${escapeHtml(_searchText)}">
    <select class="nm3-fsel" id="nm3FiltMun">
      ${_selectOpts(_unique("municipalityName"), _filterMunicipio, "Municipio")}
    </select>
    <select class="nm3-fsel" id="nm3FiltMod">
      ${_selectOpts(_unique("modalityClass"), _filterModalidad, "Modalidad")}
    </select>
    <select class="nm3-fsel" id="nm3FiltInst">
      ${_selectOpts(_unique("institutionName"), _filterInstitucion, "Institución")}
    </select>
    <select class="nm3-fsel" id="nm3FiltSede">
      ${_selectOpts(_unique("siteName"), _filterSede, "Sede")}
    </select>
    <select class="nm3-fsel nm3-fsel--sort" id="nm3FiltSort">
      <option value="">Ordenar…</option>
      <option value="nombre"     ${_sortBy === "nombre"      ? "selected" : ""}>Nombre</option>
      <option value="municipio"  ${_sortBy === "municipio"   ? "selected" : ""}>Municipio</option>
      <option value="institucion"${_sortBy === "institucion" ? "selected" : ""}>Institución</option>
      <option value="sede"       ${_sortBy === "sede"        ? "selected" : ""}>Sede</option>
      <option value="modalidad"  ${_sortBy === "modalidad"   ? "selected" : ""}>Modalidad</option>
      <option value="neto"       ${_sortBy === "neto"        ? "selected" : ""}>Neto a pagar</option>
    </select>
    <button class="nm3-sort-dir-btn" id="nm3SortDir" title="${_sortDir === "asc" ? "Ascendente" : "Descendente"}">
      ${_sortDir === "asc" ? "↑" : "↓"}
    </button>
    <label class="nm3-chk-lbl">
      <input type="checkbox" id="nm3ChkNov" ${_filterHasNov ? "checked" : ""}>
      Nov.
    </label>
    <span class="nm3-count" id="nm3Count">${filtered.length} de ${total}</span>
  </div>

  <!-- Tabla con scroll -->
  <div class="nm3-tbl-wrap">
    <table class="nm3-tbl">
      <thead id="nm3Thead">
        ${_tableHeaderHtml()}
      </thead>
      <tbody id="nm3Tbody">
        ${filtered.length
          ? filtered.map((e, i) => _rowForEmp(e, i)).join("")
          : `<tr><td colspan="${_colCount()}" class="nm3-empty-td">Sin resultados.</td></tr>`}
      </tbody>
    </table>
  </div>

  <!-- Footer totales -->
  <div class="nm3-footer" id="nm3Footer">
    ${_totalsHtml()}
  </div>

</div>

<!-- Modal: novedades -->
<div class="nm3-overlay" id="nm3NovModal" hidden>
  <div class="nm3-modal">
    <div class="nm3-modal-hdr">
      <span class="nm3-modal-ttl" id="nm3NovTitle">Novedades</span>
      <button class="nm3-modal-x" id="nm3NovClose">×</button>
    </div>
    <div class="nm3-modal-body" id="nm3NovBody"></div>
  </div>
</div>

<!-- Modal: cálculo detallado -->
<div class="nm3-overlay" id="nm3CalcModal" hidden>
  <div class="nm3-modal nm3-modal--wide">
    <div class="nm3-modal-hdr">
      <span class="nm3-modal-ttl" id="nm3CalcTitle">Detalle de cálculo</span>
      <button class="nm3-modal-x" id="nm3CalcClose">×</button>
    </div>
    <div class="nm3-modal-body" id="nm3CalcBody"></div>
  </div>
</div>

<!-- Modal: horas diarias -->
<div class="nm3-overlay" id="nm3HorasModal" hidden>
  <div class="nm3-modal nm3-modal--wide">
    <div class="nm3-modal-hdr">
      <span class="nm3-modal-ttl" id="nm3HorasTitle">Horas diarias</span>
      <button class="nm3-modal-x" id="nm3HorasClose">×</button>
    </div>
    <div class="nm3-modal-body" id="nm3HorasBody"></div>
  </div>
</div>

<!-- Modal: turnos realizados -->
<div class="nm3-overlay" id="nm3TurnosModal" hidden>
  <div class="nm3-modal nm3-modal--wide">
    <div class="nm3-modal-hdr">
      <span class="nm3-modal-ttl" id="nm3TurnosTitle">Turnos realizados</span>
      <button class="nm3-modal-x" id="nm3TurnosClose">×</button>
    </div>
    <div class="nm3-modal-body" id="nm3TurnosBody"></div>
  </div>
</div>`;

  _wireDetailEvents();
}

// ── HTML de modales ───────────────────────────────────────────────────────────

function _novBodyHtml(empId) {
  const es      = getEs(empId);
  const canEdit = isTH() && _currentPeriod?.status !== "CERRADO";

  const rows = es.novedades.length
    ? es.novedades.map((n, i) => `
      <tr>
        <td>${escapeHtml(n.label)}</td>
        <td class="nm3-ar">${n.days} d</td>
        <td>${n.paid
          ? `<span class="nm3-tag nm3-tag--paid">${escapeHtml(n.coverage || "Cubierto")}</span>`
          : `<span class="nm3-tag nm3-tag--unpaid">Descuento</span>`}</td>
        ${canEdit ? `<td><button class="nm3-del-nov" data-idx="${i}" title="Eliminar">✕</button></td>` : ""}
      </tr>`).join("")
    : `<tr><td colspan="${canEdit ? 4 : 3}" class="nm3-empty-td">Sin novedades registradas.</td></tr>`;

  return `
<div class="nm3-nov-wrap">
  <table class="nm3-tbl nm3-tbl--modal">
    <thead>
      <tr>
        <th>Tipo de novedad</th>
        <th class="nm3-ar">Días</th>
        <th>Efecto</th>
        ${canEdit ? "<th></th>" : ""}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  ${canEdit ? `
  <div class="nm3-nov-form">
    <div class="nm3-nov-form-lbl">Registrar nueva novedad</div>
    <div class="nm3-nov-form-row">
      <select class="nm3-sel nm3-nov-sel" id="nm3NovType">
        <option value="">— Tipo de novedad —</option>
        ${NOVELTY_TYPES.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join("")}
      </select>
      <input type="number" class="nm3-nc-inp" id="nm3NovDays" value="1" min="1" max="30" placeholder="Días" style="width:72px">
      <span class="nm3-unit">días</span>
      <button class="nm3-btn nm3-btn--primary nm3-btn--sm" id="nm3NovAdd">＋ Agregar</button>
    </div>
  </div>` : ""}
</div>`;
}

function _calcBodyHtml(emp) {
  const es   = getEs(emp.id);
  const calc = calcEmployee(emp.modalityClass, es.diasNoClase, es.novedades, _salaryConfig, es.turnos);

  const adicsRows = calc.adicsCalc.map(a =>
    `<tr><td>${escapeHtml(a.label)} (${calc.diasConTransporte}/30 d)</td>
         <td class="nm3-ar nm3-green">+ ${fmtCOP(a.prop)}</td></tr>`
  ).join("");

  const novRows = es.novedades.length
    ? es.novedades.map(n => `
      <tr>
        <td>${escapeHtml(n.label)} — ${n.days} días</td>
        <td class="nm3-ar">${n.paid
          ? `<span class="nm3-tag nm3-tag--paid">${escapeHtml(n.coverage || "Cubierto")}</span>`
          : `<span class="nm3-tag nm3-tag--unpaid">Descuento</span>`}</td>
      </tr>`).join("")
    : `<tr><td colspan="2" class="nm3-empty-td">Sin novedades</td></tr>`;

  const salarioPropRows = calc.turnosInfo.length
    ? calc.turnosInfo.map(t =>
        `<tr><td>Turno ${escapeHtml(t.modalidad)} — ${t.dias} d (${fmtCOP(t.salario)}/mes)</td>
             <td class="nm3-ar nm3-green">+ ${fmtCOP(t.prop)}</td></tr>`
      ).join("")
    : `<tr><td>Salario proporcional (${calc.diasConSalario}/30 d)</td><td class="nm3-ar nm3-green">+ ${fmtCOP(calc.salarioProp)}</td></tr>`;

  return `
<div class="nm3-calc-wrap">

  <!-- Info empleado -->
  <div class="nm3-calc-info">
    <div class="nm3-ci"><span>Documento</span><b>${escapeHtml(emp.documentType || "CC")} ${escapeHtml(emp.documentNumber)}</b></div>
    <div class="nm3-ci"><span>Municipio</span><b>${escapeHtml(emp.municipalityName || "—")}</b></div>
    <div class="nm3-ci"><span>Institución</span><b>${escapeHtml(emp.institutionName || "—")}</b></div>
    <div class="nm3-ci"><span>Sede</span><b>${escapeHtml(emp.siteName || "—")}</b></div>
    <div class="nm3-ci"><span>Modalidad</span><b>${escapeHtml(emp.modalityClass)}</b></div>
    <div class="nm3-ci"><span>Días no clase</span><b>${es.diasNoClase}</b></div>
    <div class="nm3-ci"><span>Días sin salario</span><b>${calc.diasSinPago}</b></div>
    <div class="nm3-ci"><span>Días con salario</span><b>${calc.diasConSalario}/30</b></div>
    <div class="nm3-ci"><span>Días con transporte</span><b>${calc.diasConTransporte}/30</b></div>
    ${calc.turnosInfo.length ? `<div class="nm3-ci"><span>Turnos registrados</span><b>${calc.turnosInfo.length}</b></div>` : ""}
  </div>

  <!-- Tabla cálculo -->
  <table class="nm3-tbl nm3-tbl--calc">
    <tbody>
      <tr class="nm3-calc-sec"><td colspan="2">💰 Devengados</td></tr>
      ${salarioPropRows}
      <tr><td>Aux. transporte (${calc.diasConTransporte}/30 d)</td><td class="nm3-ar nm3-green">+ ${fmtCOP(calc.auxTrans)}</td></tr>
      ${adicsRows}
      <tr class="nm3-calc-sub"><td><b>Total devengado</b></td><td class="nm3-ar"><b>${fmtCOP(calc.totalDev)}</b></td></tr>

      <tr class="nm3-calc-sec"><td colspan="2">🔻 Deducciones</td></tr>
      <tr><td>Salud empleado (4%)</td><td class="nm3-ar nm3-red">− ${fmtCOP(calc.salud)}</td></tr>
      <tr><td>Pensión empleado (4%)</td><td class="nm3-ar nm3-red">− ${fmtCOP(calc.pension)}</td></tr>
      <tr class="nm3-calc-sub"><td><b>Total deducciones</b></td><td class="nm3-ar nm3-red"><b>− ${fmtCOP(calc.totalDed)}</b></td></tr>

      <tr class="nm3-calc-sec"><td colspan="2">📋 Novedades</td></tr>
      ${novRows}

      <tr class="nm3-calc-neto"><td>NETO A PAGAR</td><td class="nm3-ar"><strong>${fmtCOP(calc.neto)}</strong></td></tr>
    </tbody>
  </table>

</div>`;
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function _wireListEvents() {
  document.getElementById("nm3MonthSel")?.addEventListener("change", e => { _periodMonth = e.target.value; });
  document.getElementById("nm3YearSel")?.addEventListener("change",  e => { _periodYear  = e.target.value; });

  document.getElementById("nm3BtnNew")?.addEventListener("click", async () => {
    const period     = `${_periodYear}-${_periodMonth}`;
    const label      = `Nómina ${periodLabel(period)}`;
    const contractId = getContractId();
    const companyId  = getCompanyId();
    if (!contractId || !companyId) { showError("Sin contrato o empresa asociada"); return; }
    const btn = document.getElementById("nm3BtnNew");
    if (btn) { btn.disabled = true; btn.textContent = "Creando…"; }
    try {
      const r = await apiFetch("/nomina/periods", {
        method: "POST",
        body: JSON.stringify({ contractId, companyId, period, label }),
      });
      await _loadPeriodDetail(r.data.id);
    } catch (err) {
      showError(err.message);
      if (btn) { btn.disabled = false; btn.textContent = "＋ Nueva nómina"; }
    }
  });

  document.querySelector(".nm3-card-body")?.addEventListener("click", async e => {
    const btn = e.target.closest("[data-open]");
    if (btn) await _loadPeriodDetail(Number(btn.dataset.open));
  });
}

function _wireDetailEvents() {
  // Volver
  document.getElementById("nm3Back")?.addEventListener("click", async () => {
    _view = "list"; _currentPeriod = null;
    _searchText = ""; _filterHasNov = false;
    _filterMunicipio = ""; _filterModalidad = ""; _filterInstitucion = ""; _filterSede = "";
    _sortBy = ""; _sortDir = "asc"; _activeGroup = "todos";
    await _loadPeriods();
    _renderListView();
  });

  // Tabs de grupo
  document.getElementById("nm3GroupTabs")?.addEventListener("click", e => {
    const btn = e.target.closest("[data-group]");
    if (!btn) return;
    _activeGroup = btn.dataset.group;
    const tabsEl = document.getElementById("nm3GroupTabs");
    if (tabsEl) tabsEl.innerHTML = _groupTabsHtml();
    _refreshTbody();
  });

  // Búsqueda
  document.getElementById("nm3Search")?.addEventListener("input", e => {
    _searchText = e.target.value.trim().toLowerCase();
    _refreshTbody();
  });

  // Filtros de selección
  document.getElementById("nm3FiltMun")?.addEventListener("change",  e => { _filterMunicipio   = e.target.value; _refreshTbody(); });
  document.getElementById("nm3FiltMod")?.addEventListener("change",  e => { _filterModalidad   = e.target.value; _refreshTbody(); });
  document.getElementById("nm3FiltInst")?.addEventListener("change", e => { _filterInstitucion = e.target.value; _refreshTbody(); });
  document.getElementById("nm3FiltSede")?.addEventListener("change", e => { _filterSede        = e.target.value; _refreshTbody(); });

  // Ordenar
  document.getElementById("nm3FiltSort")?.addEventListener("change", e => { _sortBy = e.target.value; _refreshTbody(); });
  document.getElementById("nm3SortDir")?.addEventListener("click", () => {
    _sortDir = _sortDir === "asc" ? "desc" : "asc";
    const btn = document.getElementById("nm3SortDir");
    if (btn) { btn.textContent = _sortDir === "asc" ? "↑" : "↓"; btn.title = _sortDir === "asc" ? "Ascendente" : "Descendente"; }
    _refreshTbody();
  });

  // Filtro novedades
  document.getElementById("nm3ChkNov")?.addEventListener("change", e => {
    _filterHasNov = e.target.checked;
    _refreshTbody();
  });

  // Guardar / cerrar
  document.getElementById("nm3BtnSave")?.addEventListener("click", _saveLiquidation);
  document.getElementById("nm3BtnClose")?.addEventListener("click", _closePeriod);

  // Cerrar modales
  document.getElementById("nm3NovClose")?.addEventListener("click", _closeNovModal);
  document.getElementById("nm3NovModal")?.addEventListener("click", e => { if (e.target.id === "nm3NovModal") _closeNovModal(); });
  document.getElementById("nm3CalcClose")?.addEventListener("click", _closeCalcModal);
  document.getElementById("nm3CalcModal")?.addEventListener("click", e => { if (e.target.id === "nm3CalcModal") _closeCalcModal(); });
  document.getElementById("nm3HorasClose")?.addEventListener("click", _closeHorasModal);
  document.getElementById("nm3HorasModal")?.addEventListener("click", e => { if (e.target.id === "nm3HorasModal") _closeHorasModal(); });
  document.getElementById("nm3TurnosClose")?.addEventListener("click", _closeTurnosModal);
  document.getElementById("nm3TurnosModal")?.addEventListener("click", e => { if (e.target.id === "nm3TurnosModal") _closeTurnosModal(); });

  // Delegación de eventos en la tabla
  const tbody = document.getElementById("nm3Tbody");
  if (!tbody) return;

  tbody.addEventListener("click", e => {
    // Novedad badge → abrir modal de novedades
    const novPill = e.target.closest(".nm3-nov-pill--has");
    if (novPill) { _openNovModal(Number(novPill.dataset.emp)); return; }

    // Botón agregar novedad
    const novBtn = e.target.closest(".nm3-act-nov");
    if (novBtn)  { _openNovModal(Number(novBtn.dataset.emp)); return; }

    // Turno pill
    const turnoPill = e.target.closest(".nm3-turno-pill--has, .nm3-turno-pill--add");
    if (turnoPill) { _openTurnosModal(Number(turnoPill.dataset.emp)); return; }

    // Horas pill / botón horas
    const horasPill = e.target.closest(".nm3-horas-pill");
    if (horasPill) { _openHorasModal(Number(horasPill.dataset.emp)); return; }
    const horasBtn = e.target.closest(".nm3-act-horas");
    if (horasBtn)  { _openHorasModal(Number(horasBtn.dataset.emp));  return; }

    // Botón cálculo detallado
    const calcBtn = e.target.closest(".nm3-act-calc");
    if (calcBtn) { _openCalcModal(Number(calcBtn.dataset.emp)); return; }

    // Marcar listo
    const okBtn = e.target.closest(".nm3-act-ok");
    if (okBtn) {
      const empId = Number(okBtn.dataset.emp);
      const es    = getEs(empId);
      es.checked  = !es.checked;
      _refreshRow(empId);
      _refreshFooter();
      return;
    }
  });

  tbody.addEventListener("input", e => {
    const inp = e.target.closest(".nm3-nc-inp");
    if (!inp) return;
    const empId = Number(inp.dataset.emp);
    const val   = Math.max(0, Math.min(30, parseInt(inp.value, 10) || 0));
    getEs(empId).diasNoClase = val;
    _refreshRowCalc(empId);
    _refreshFooter();
  });
}

// ── Modal: novedades ──────────────────────────────────────────────────────────

function _openNovModal(empId) {
  const emp = _employees.find(e => e.id === empId);
  _modalEmpId = empId;
  document.getElementById("nm3NovTitle").textContent = emp ? emp.fullName : "Novedades";
  document.getElementById("nm3NovBody").innerHTML = _novBodyHtml(empId);
  document.getElementById("nm3NovModal").removeAttribute("hidden");
  _wireNovModal();
}

function _wireNovModal() {
  document.getElementById("nm3NovAdd")?.addEventListener("click", () => {
    const typeEl = document.getElementById("nm3NovType");
    const daysEl = document.getElementById("nm3NovDays");
    const id     = typeEl?.value;
    if (!id) { typeEl?.focus(); return; }
    const days    = Math.max(1, parseInt(daysEl?.value, 10) || 1);
    const novType = NOVELTY_TYPES.find(t => t.id === id);
    if (!novType) return;
    getEs(_modalEmpId).novedades.push({ ...novType, days });
    document.getElementById("nm3NovBody").innerHTML = _novBodyHtml(_modalEmpId);
    _wireNovModal();
    _refreshRow(_modalEmpId);
    _refreshFooter();
  });

  document.querySelectorAll(".nm3-del-nov").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      getEs(_modalEmpId).novedades.splice(idx, 1);
      document.getElementById("nm3NovBody").innerHTML = _novBodyHtml(_modalEmpId);
      _wireNovModal();
      _refreshRow(_modalEmpId);
      _refreshFooter();
    });
  });
}

function _closeNovModal() {
  document.getElementById("nm3NovModal")?.setAttribute("hidden", "");
  _modalEmpId = null;
}

// ── Modal: cálculo ────────────────────────────────────────────────────────────

function _openCalcModal(empId) {
  const emp = _employees.find(e => e.id === empId);
  if (!emp) return;
  document.getElementById("nm3CalcTitle").textContent = emp.fullName;
  document.getElementById("nm3CalcBody").innerHTML    = isHourBased(emp) ? _calcBodyHtmlHours(emp) : _calcBodyHtml(emp);
  document.getElementById("nm3CalcModal").removeAttribute("hidden");
}

function _closeCalcModal() {
  document.getElementById("nm3CalcModal")?.setAttribute("hidden", "");
}

function _calcBodyHtmlHours(emp) {
  const es      = getEs(emp.id);
  const calc    = calcHourEmployee(emp);
  const modCfg  = (_salaryConfig.modalities || {})[emp.modalityClass] || {};
  const salBase = modCfg.salary || (_salaryConfig.smlv || 1_750_905);

  const horasRows = es.horasDiarias.length
    ? es.horasDiarias.map(d => `
      <tr>
        <td>${d.fecha}</td>
        <td class="nm3-ar">${d.horas}h</td>
        <td class="nm3-ar nm3-green">+ ${fmtCOP(Math.round(calc.valorHora * d.horas))}</td>
      </tr>`).join("")
    : `<tr><td colspan="3" class="nm3-empty-td">Sin horas registradas</td></tr>`;

  return `
<div class="nm3-calc-wrap">
  <div class="nm3-calc-info">
    <div class="nm3-ci"><span>Documento</span><b>${escapeHtml(emp.documentType || "CC")} ${escapeHtml(emp.documentNumber)}</b></div>
    <div class="nm3-ci"><span>Cargo</span><b>${escapeHtml(emp.cargo || "—")}</b></div>
    <div class="nm3-ci"><span>Grupo</span><b>${_getGroup(emp)}</b></div>
    <div class="nm3-ci"><span>Salario base</span><b>${fmtCOP(salBase)}</b></div>
    <div class="nm3-ci"><span>Valor hora (÷240)</span><b>${fmtCOP(calc.valorHora)}</b></div>
    <div class="nm3-ci"><span>Total horas</span><b>${calc.totalHoras}h</b></div>
  </div>
  <table class="nm3-tbl nm3-tbl--calc">
    <tbody>
      <tr class="nm3-calc-sec"><td colspan="3">📅 Horas trabajadas</td></tr>
      <tr><th>Fecha</th><th class="nm3-ar">Horas</th><th class="nm3-ar">Valor</th></tr>
      ${horasRows}
      <tr class="nm3-calc-sec"><td colspan="3">💰 Devengados</td></tr>
      <tr><td>Devengado (${calc.totalHoras}h × ${fmtCOP(calc.valorHora)})</td><td colspan="2" class="nm3-ar nm3-green">+ ${fmtCOP(calc.devengado)}</td></tr>
      <tr class="nm3-calc-sub"><td><b>Total devengado</b></td><td colspan="2" class="nm3-ar"><b>${fmtCOP(calc.devengado)}</b></td></tr>
      <tr class="nm3-calc-sec"><td colspan="3">🔻 Deducciones</td></tr>
      <tr><td>Salud empleado (4%)</td><td colspan="2" class="nm3-ar nm3-red">− ${fmtCOP(calc.salud)}</td></tr>
      <tr><td>Pensión empleado (4%)</td><td colspan="2" class="nm3-ar nm3-red">− ${fmtCOP(calc.pension)}</td></tr>
      <tr class="nm3-calc-sub"><td><b>Total deducciones</b></td><td colspan="2" class="nm3-ar nm3-red"><b>− ${fmtCOP(calc.totalDed)}</b></td></tr>
      <tr class="nm3-calc-neto"><td>NETO A PAGAR</td><td colspan="2" class="nm3-ar"><strong>${fmtCOP(calc.neto)}</strong></td></tr>
    </tbody>
  </table>
</div>`;
}

// ── Modal: horas diarias ──────────────────────────────────────────────────────

function _horasBodyHtml(empId) {
  const es      = getEs(empId);
  const canEdit = isTH() && _currentPeriod?.status !== "CERRADO";
  const start   = new Date((_currentPeriod?.period_start || new Date().toISOString().slice(0, 10)) + "T00:00:00Z");
  const end     = new Date((_currentPeriod?.period_end   || new Date().toISOString().slice(0, 10)) + "T00:00:00Z");

  const horasMap = {};
  for (const d of es.horasDiarias) horasMap[d.fecha] = d.horas;

  const days = [];
  const cur  = new Date(start);
  while (cur <= end) { days.push(cur.toISOString().slice(0, 10)); cur.setUTCDate(cur.getUTCDate() + 1); }

  const DOW = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  const totalHoras = es.horasDiarias.reduce((s, d) => s + (Number(d.horas) || 0), 0);
  const emp        = _employees.find(e => e.id === empId);
  const modCfg     = (_salaryConfig.modalities || {})[emp?.modalityClass] || {};
  const salaryBase = modCfg.salary || (_salaryConfig.smlv || 1_750_905);
  const valorHora  = Math.round(salaryBase / 240);
  const devengado  = Math.round(valorHora * totalHoras);

  const dayInputs = days.map(fecha => {
    const d          = new Date(fecha + "T00:00:00Z");
    const dow        = d.getUTCDay();
    const isWeekend  = dow === 0 || dow === 6;
    const horas      = horasMap[fecha] ?? "";
    return `
<div class="nm3-horas-day ${isWeekend ? "nm3-horas-day--wknd" : ""}">
  <div class="nm3-horas-dow">${DOW[dow]}</div>
  <div class="nm3-horas-date">${d.getUTCDate()}</div>
  ${canEdit
    ? `<input type="number" class="nm3-horas-inp" data-fecha="${fecha}" value="${horas}" min="0" max="24" placeholder="0">`
    : `<div class="nm3-horas-ro">${horas !== "" ? horas + "h" : "—"}</div>`}
</div>`;
  }).join("");

  return `
<div class="nm3-horas-wrap">
  ${canEdit ? `
  <div class="nm3-horas-actions">
    <button class="nm3-btn nm3-btn--sm nm3-btn--outline" id="nm3HorasFillWk">Días hábiles (8h)</button>
    <button class="nm3-btn nm3-btn--sm nm3-btn--outline" id="nm3HorasClear">Limpiar todo</button>
  </div>` : ""}
  <div class="nm3-horas-grid">${dayInputs}</div>
  <div class="nm3-horas-summary" id="nm3HorasSummary">
    <span>Total horas: <strong>${totalHoras}h</strong></span>
    <span>Valor/hora: <strong>${fmtCOP(valorHora)}</strong></span>
    <span>Devengado: <strong class="nm3-green">${fmtCOP(devengado)}</strong></span>
  </div>
</div>`;
}

function _openHorasModal(empId) {
  const emp = _employees.find(e => e.id === empId);
  _modalEmpId = empId;
  document.getElementById("nm3HorasTitle").textContent = emp ? emp.fullName : "Horas diarias";
  document.getElementById("nm3HorasBody").innerHTML    = _horasBodyHtml(empId);
  document.getElementById("nm3HorasModal").removeAttribute("hidden");
  _wireHorasModal(empId);
}

function _closeHorasModal() {
  document.getElementById("nm3HorasModal")?.setAttribute("hidden", "");
  _modalEmpId = null;
}

function _wireHorasModal(empId) {
  const body = document.getElementById("nm3HorasBody");
  if (!body) return;

  const _update = () => {
    const es   = getEs(empId);
    const inps = body.querySelectorAll(".nm3-horas-inp");
    es.horasDiarias = [];
    inps.forEach(inp => {
      const horas = Number(inp.value) || 0;
      if (horas > 0) es.horasDiarias.push({ fecha: inp.dataset.fecha, horas });
    });
    const totalHoras = es.horasDiarias.reduce((s, d) => s + d.horas, 0);
    const emp        = _employees.find(e => e.id === empId);
    const modCfg     = (_salaryConfig.modalities || {})[emp?.modalityClass] || {};
    const salaryBase = modCfg.salary || (_salaryConfig.smlv || 1_750_905);
    const valorHora  = Math.round(salaryBase / 240);
    const devengado  = Math.round(valorHora * totalHoras);
    const sumEl      = document.getElementById("nm3HorasSummary");
    if (sumEl) sumEl.innerHTML = `
      <span>Total horas: <strong>${totalHoras}h</strong></span>
      <span>Valor/hora: <strong>${fmtCOP(valorHora)}</strong></span>
      <span>Devengado: <strong class="nm3-green">${fmtCOP(devengado)}</strong></span>`;
    _refreshRow(empId);
    _refreshFooter();
  };

  body.querySelectorAll(".nm3-horas-inp").forEach(inp => inp.addEventListener("input", _update));

  document.getElementById("nm3HorasFillWk")?.addEventListener("click", () => {
    body.querySelectorAll(".nm3-horas-inp").forEach(inp => {
      const dow = new Date(inp.dataset.fecha + "T00:00:00Z").getUTCDay();
      if (dow !== 0 && dow !== 6) inp.value = "8";
    });
    _update();
  });

  document.getElementById("nm3HorasClear")?.addEventListener("click", () => {
    body.querySelectorAll(".nm3-horas-inp").forEach(inp => { inp.value = ""; });
    _update();
  });
}

// ── Modal: turnos realizados ──────────────────────────────────────────────────

function _turnosBodyHtml(empId) {
  const es      = getEs(empId);
  const canEdit = isTH() && _currentPeriod?.status !== "CERRADO";
  const modalities = Object.keys(_salaryConfig.modalities || {});

  const rows = es.turnos.length
    ? es.turnos.map((t, i) => `
      <tr>
        <td>${escapeHtml(t.modalidad)}</td>
        <td class="nm3-ar">${t.dias} d</td>
        ${canEdit ? `<td><button class="nm3-del-turno" data-idx="${i}" title="Eliminar">✕</button></td>` : ""}
      </tr>`).join("")
    : `<tr><td colspan="${canEdit ? 3 : 2}" class="nm3-empty-td">Sin turnos registrados.</td></tr>`;

  return `
<div class="nm3-nov-wrap">
  <table class="nm3-tbl nm3-tbl--modal">
    <thead>
      <tr>
        <th>Modalidad</th>
        <th class="nm3-ar">Días</th>
        ${canEdit ? "<th></th>" : ""}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  ${canEdit ? `
  <div class="nm3-nov-form">
    <div class="nm3-nov-form-lbl">Agregar turno realizado</div>
    <div class="nm3-nov-form-row">
      <select class="nm3-sel nm3-nov-sel" id="nm3TurnoMod">
        <option value="">— Modalidad —</option>
        ${modalities.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("")}
      </select>
      <input type="number" class="nm3-nc-inp" id="nm3TurnoDias" value="1" min="1" max="30" placeholder="Días" style="width:72px">
      <span class="nm3-unit">días</span>
      <button class="nm3-btn nm3-btn--primary nm3-btn--sm" id="nm3TurnoAdd">＋ Agregar</button>
    </div>
  </div>` : ""}
</div>`;
}

function _openTurnosModal(empId) {
  const emp = _employees.find(e => e.id === empId);
  _modalEmpId = empId;
  document.getElementById("nm3TurnosTitle").textContent = emp ? emp.fullName : "Turnos realizados";
  document.getElementById("nm3TurnosBody").innerHTML    = _turnosBodyHtml(empId);
  document.getElementById("nm3TurnosModal").removeAttribute("hidden");
  _wireTurnosModal();
}

function _closeTurnosModal() {
  document.getElementById("nm3TurnosModal")?.setAttribute("hidden", "");
  _modalEmpId = null;
}

function _wireTurnosModal() {
  document.getElementById("nm3TurnoAdd")?.addEventListener("click", () => {
    const modEl  = document.getElementById("nm3TurnoMod");
    const diasEl = document.getElementById("nm3TurnoDias");
    const mod    = modEl?.value;
    if (!mod) { modEl?.focus(); return; }
    const dias = Math.max(1, parseInt(diasEl?.value, 10) || 1);
    getEs(_modalEmpId).turnos.push({ modalidad: mod, dias });
    document.getElementById("nm3TurnosBody").innerHTML = _turnosBodyHtml(_modalEmpId);
    _wireTurnosModal();
    _refreshRow(_modalEmpId);
    _refreshFooter();
  });

  document.querySelectorAll(".nm3-del-turno").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      getEs(_modalEmpId).turnos.splice(idx, 1);
      document.getElementById("nm3TurnosBody").innerHTML = _turnosBodyHtml(_modalEmpId);
      _wireTurnosModal();
      _refreshRow(_modalEmpId);
      _refreshFooter();
    });
  });
}

// ── Refreshes parciales ───────────────────────────────────────────────────────

function _refreshTbody() {
  const tbody   = document.getElementById("nm3Tbody");
  const theadEl = document.getElementById("nm3Thead");
  const countEl = document.getElementById("nm3Count");
  if (!tbody) return;
  if (theadEl) theadEl.innerHTML = _tableHeaderHtml();
  const filtered = _filtered();
  tbody.innerHTML = filtered.length
    ? filtered.map((e, i) => _rowForEmp(e, i)).join("")
    : `<tr><td colspan="${_colCount()}" class="nm3-empty-td">Sin resultados.</td></tr>`;
  if (countEl) countEl.textContent = `${filtered.length} de ${_employees.length}`;
  _refreshFooter();
}

function _refreshRow(empId) {
  const tbody = document.getElementById("nm3Tbody");
  if (!tbody) return;
  const emp = _employees.find(e => e.id === empId);
  if (!emp) return;
  const existing = tbody.querySelector(`[data-emp-id="${empId}"]`);
  if (!existing) return;
  const allFiltered = _filtered();
  const idx  = allFiltered.findIndex(e => e.id === empId);
  const temp = document.createElement("tbody");
  temp.innerHTML = _rowForEmp(emp, idx >= 0 ? idx : 0);
  existing.replaceWith(temp.firstElementChild);
}

function _refreshRowCalc(empId) {
  const emp = _employees.find(e => e.id === empId);
  if (!emp) return;
  const es   = getEs(empId);
  const calc = calcEmployee(emp.modalityClass, es.diasNoClase, es.novedades, _salaryConfig, es.turnos);
  const row  = document.querySelector(`#nm3Tbody [data-emp-id="${empId}"]`);
  if (!row) return;
  const devEl  = row.querySelector(".nm3-td-dev");
  const dedEl  = row.querySelector(".nm3-td-ded");
  const netoEl = row.querySelector(".nm3-td-neto");
  if (devEl)  devEl.textContent = fmtCOP(calc.totalDev);
  if (dedEl)  dedEl.innerHTML   = `<div class="nm3-ded-main">− ${fmtCOP(calc.totalDed)}</div><div class="nm3-ded-det">S ${fmtCOP(calc.salud)} · P ${fmtCOP(calc.pension)}</div>`;
  if (netoEl) netoEl.textContent = fmtCOP(calc.neto);
}

function _refreshFooter() {
  const el   = document.getElementById("nm3Footer");
  const pill = document.getElementById("nm3DonePill");
  if (el) el.innerHTML = _totalsHtml();
  if (pill) {
    const done = [..._empState.values()].filter(e => e.checked).length;
    pill.textContent = `${done}/${_employees.length} revisados`;
  }
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function _loadPeriods() {
  const contractId = getContractId();
  if (!contractId) return;
  try {
    const r = await apiFetch(`/nomina/periods?contractId=${contractId}`);
    _periods = Array.isArray(r.data) ? r.data : [];
  } catch { _periods = []; }
}

async function _loadPeriodDetail(periodId) {
  const contractId = getContractId();
  try {
    const [periodResp, empsResp, salResp] = await Promise.all([
      apiFetch(`/nomina/periods/${periodId}`),
      apiFetch(`/nomina/employees?contractId=${contractId}`),
      apiFetch(`/config/contracts/${contractId}/salary-config`),
    ]);

    _currentPeriod = periodResp.data.period;
    _employees     = Array.isArray(empsResp.data) ? empsResp.data : [];
    _salaryConfig  = salResp.data || {};
    _searchText    = "";
    _filterHasNov  = false;

    _empState.clear();
    for (const emp of _employees) {
      _empState.set(emp.id, { diasNoClase: 0, novedades: [], horasDiarias: [], turnos: [], checked: false });
    }
    for (const r of (periodResp.data.results || [])) {
      const es = _empState.get(Number(r.employeeId));
      if (es) {
        es.diasNoClase  = r.diasNoClase || 0;
        es.novedades    = Array.isArray(r.novedades)    ? r.novedades    : [];
        es.horasDiarias = Array.isArray(r.horasDiarias) ? r.horasDiarias : [];
        es.turnos       = Array.isArray(r.turnos)       ? r.turnos       : [];
      }
    }

    _view = "detail";
    _renderDetailView();
  } catch (err) {
    showError("Error cargando el período: " + err.message);
  }
}

async function _saveLiquidation() {
  if (!_currentPeriod) return;
  const btn = document.getElementById("nm3BtnSave");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  try {
    const lines = _employees.map(emp => {
      const es        = getEs(emp.id);
      const hourBased = isHourBased(emp);
      return {
        employeeId: emp.id, fullName: emp.fullName,
        documentNumber: emp.documentNumber, documentType: emp.documentType,
        siteName: emp.siteName, institutionName: emp.institutionName,
        municipalityName: emp.municipalityName, modality: emp.modality,
        modalityClass: emp.modalityClass, workdayType: emp.workdayType,
        cargo: emp.cargo || "",
        diasNoClase:  es.diasNoClase,
        novedades:    es.novedades,
        horasDiarias: es.horasDiarias,
        turnos:       es.turnos,
        payrollType:  hourBased ? "horas" : "mensual",
      };
    });

    const r = await apiFetch(`/nomina/periods/${_currentPeriod.id}/save`, {
      method: "POST",
      body: JSON.stringify({ lines }),
    });

    _currentPeriod.status = "CALCULADO";
    showSuccess(`Nómina guardada · ${r.data.totals.employees} empleados`);
    _renderDetailView();
  } catch (err) {
    showError("Error al guardar: " + err.message);
    if (btn) { btn.disabled = false; btn.textContent = "💾 Guardar"; }
  }
}

async function _closePeriod() {
  if (!_currentPeriod) return;
  if (!confirm(`¿Cerrar definitivamente la nómina "${_currentPeriod.label}"? Esta acción no se puede revertir.`)) return;
  try {
    await apiFetch(`/nomina/periods/${_currentPeriod.id}/close`, { method: "POST" });
    _currentPeriod.status = "CERRADO";
    showSuccess("Período cerrado");
    _renderDetailView();
  } catch (err) {
    showError("Error al cerrar: " + err.message);
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

export async function loadPayrollModule() {
  _view = "list"; _currentPeriod = null; _employees = [];
  _salaryConfig = {}; _empState.clear(); _searchText = ""; _filterHasNov = false;
  _filterMunicipio = ""; _filterModalidad = ""; _filterInstitucion = ""; _filterSede = "";
  _sortBy = ""; _sortDir = "asc"; _activeGroup = "todos";
  await _loadPeriods();
  return `<div class="nm3-shell"><div id="nm3-root"></div></div>`;
}

export function wirePayrollEvents() {
  _renderListView();
}
