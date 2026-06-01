/**
 * portal.js — Módulo Portal del Colaborador
 * Gestores y Talento Humano gestionan soportes, turnos y solicitudes.
 */

import { apiFetch } from '../api.js';
import { escapeHtml, escapeAttr } from '../utils.js';
import { state } from '../state.js';

// ─── Estado local ─────────────────────────────────────────────────────────────
const portalState = {
  view: 'dashboard',       // dashboard | soportes | turnos | tickets | auditoria
  soportes: [],
  turnos: [],
  tickets: [],
  kpis: {},
  recent: {},
  notifications: [],
  auditoria: [],
  loading: false,
  // Filtros
  soporteStatus: '',
  turnoStatus: '',
  ticketStatus: '',
  ticketType: '',
  // Modal
  modalOpen: false,
};

// ─── Roles ────────────────────────────────────────────────────────────────────
function getRole() {
  return (state.currentUser?.role || '').toLowerCase();
}

function isAdmin() { return getRole() === 'administrador'; }
function isTH()    { return getRole() === 'talento_humano'; }
function isGestor(){ return getRole() === 'gestores_auxiliares' || getRole() === 'gestor'; }
function canApprove() { return isAdmin() || isTH(); }

// ─── Utilidades ───────────────────────────────────────────────────────────────
function safe(v) { return v === undefined || v === null ? '' : String(v); }

function badge(status) {
  const map = {
    PENDIENTE:   'badge-warning',
    EN_REVISION: 'badge-info',
    APROBADO:    'badge-success',
    RECHAZADO:   'badge-danger',
    RADICADA:    'badge-secondary',
    EN_PROCESO:  'badge-info',
    RESPONDIDA:  'badge-success',
    CERRADA:     'badge-neutral',
    ENVIADO:     'badge-success',
    ERROR:       'badge-danger',
    PAGADO:      'badge-success',
  };
  const cls = map[status] || 'badge-secondary';
  const labels = {
    PENDIENTE: 'Pendiente', EN_REVISION: 'En revisión',
    APROBADO: 'Aprobado', RECHAZADO: 'Rechazado',
    RADICADA: 'Radicada', EN_PROCESO: 'En proceso',
    RESPONDIDA: 'Respondida', CERRADA: 'Cerrada',
    ENVIADO: 'Enviado', ERROR: 'Error',
    PAGADO: 'Pagado',
  };
  return `<span class="badge ${cls}">${labels[status] || status}</span>`;
}

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('es-CO'); } catch { return d; }
}

function fmtCurrency(v) {
  if (v == null) return '—';
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(v));
}

const docTypeLabels = {
  CERTIFICADO_LABORAL:    'Certificado laboral',
  DESPRENDIBLE_PAGO:      'Desprendible de pago',
  CUENTA_COBRO:           'Cuenta de cobro',
  CERTIFICACION_INGRESOS: 'Certificación de ingresos y retenciones',
  CERTIFICACION_PAGOS:    'Certificación de pagos',
  RECLAMACION_NOMINA:     'Reclamación de nómina',
  RECLAMACION_TURNOS:     'Reclamación de turnos',
  ACTUALIZACION_DATOS:    'Actualización de datos',
  OTRO:                   'Otro',
};

const AUTO_TYPES = [
  'CERTIFICADO_LABORAL', 'DESPRENDIBLE_PAGO', 'CUENTA_COBRO',
  'CERTIFICACION_INGRESOS', 'CERTIFICACION_PAGOS',
];

// ─── CSS inyectado ────────────────────────────────────────────────────────────
function injectPortalStyles() {
  if (document.getElementById('portal-styles')) return;
  const style = document.createElement('style');
  style.id = 'portal-styles';
  style.textContent = `
    .portal-wrap { display: flex; flex-direction: column; gap: 1.5rem; padding: 1rem 0; }
    .portal-tabs { display: flex; gap: 0.5rem; flex-wrap: wrap; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; }
    .portal-tab  { padding: 0.45rem 1rem; border-radius: 6px 6px 0 0; border: 1px solid transparent; cursor: pointer; background: transparent; font-weight: 500; color: #64748b; transition: all .15s; }
    .portal-tab:hover { background: #f1f5f9; color: #334155; }
    .portal-tab.active { background: #fff; border-color: #e2e8f0 #e2e8f0 #fff; color: #2563eb; font-weight: 600; }
    .portal-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; }
    .portal-kpi  { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 1.1rem 1.2rem; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
    .portal-kpi .kpi-val { font-size: 2rem; font-weight: 700; color: #1e40af; }
    .portal-kpi .kpi-lbl { font-size: .78rem; color: #64748b; margin-top: .2rem; }
    .portal-kpi.warn .kpi-val { color: #b45309; }
    .portal-kpi.danger .kpi-val { color: #dc2626; }
    .portal-kpi.ok .kpi-val { color: #16a34a; }
    .portal-section-title { font-size: 1rem; font-weight: 600; color: #334155; margin: .5rem 0; border-left: 3px solid #2563eb; padding-left: .6rem; }
    .portal-filters { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
    .portal-filters select, .portal-filters input { padding: .35rem .7rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: .88rem; background: #fff; }
    .portal-table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid #e2e8f0; }
    .portal-table { width: 100%; border-collapse: collapse; font-size: .88rem; }
    .portal-table th { background: #f8fafc; font-weight: 600; color: #475569; padding: .6rem .9rem; text-align: left; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
    .portal-table td { padding: .55rem .9rem; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    .portal-table tr:last-child td { border-bottom: none; }
    .portal-table tr:hover td { background: #f8fafc; }
    .badge { display: inline-block; padding: .2rem .55rem; border-radius: 999px; font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
    .badge-warning   { background: #fef3c7; color: #92400e; }
    .badge-info      { background: #dbeafe; color: #1e40af; }
    .badge-success   { background: #d1fae5; color: #065f46; }
    .badge-danger    { background: #fee2e2; color: #991b1b; }
    .badge-secondary { background: #f1f5f9; color: #475569; }
    .badge-neutral   { background: #f3f4f6; color: #6b7280; }
    .btn-xs   { padding: .2rem .55rem; font-size: .78rem; border-radius: 5px; border: 1px solid; cursor: pointer; font-weight: 500; }
    .btn-xs.primary  { background: #2563eb; color: #fff; border-color: #2563eb; }
    .btn-xs.secondary{ background: #fff; color: #374151; border-color: #d1d5db; }
    .btn-xs.danger   { background: #dc2626; color: #fff; border-color: #dc2626; }
    .btn-xs.success  { background: #16a34a; color: #fff; border-color: #16a34a; }
    .btn-xs.warning  { background: #d97706; color: #fff; border-color: #d97706; }
    .btn-xs:hover { opacity: .88; }
    .btn-xs:disabled { opacity: .5; cursor: not-allowed; }
    /* Modal */
    .portal-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 9000; display: flex; align-items: center; justify-content: center; }
    .portal-modal { background: #fff; border-radius: 12px; padding: 1.5rem; width: min(520px, 95vw); max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,.25); }
    .portal-modal h3 { margin: 0 0 1rem; font-size: 1.1rem; color: #1e293b; }
    .portal-modal .form-row { display: flex; flex-direction: column; gap: .35rem; margin-bottom: .9rem; }
    .portal-modal label { font-size: .83rem; font-weight: 600; color: #374151; }
    .portal-modal input, .portal-modal select, .portal-modal textarea { width: 100%; padding: .45rem .7rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: .88rem; box-sizing: border-box; }
    .portal-modal textarea { min-height: 90px; resize: vertical; }
    .portal-modal .modal-actions { display: flex; gap: .5rem; justify-content: flex-end; margin-top: 1rem; }
    .portal-modal .btn-modal { padding: .5rem 1.1rem; border-radius: 7px; font-weight: 600; cursor: pointer; border: none; font-size: .88rem; }
    .portal-modal .btn-modal.cancel { background: #f1f5f9; color: #374151; }
    .portal-modal .btn-modal.confirm { background: #2563eb; color: #fff; }
    .portal-modal .btn-modal.confirm:disabled { opacity: .5; cursor: not-allowed; }
    .portal-email-confirm { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; font-size: .88rem; line-height: 1.6; }
    .portal-email-confirm .email-val { font-weight: 700; color: #1e40af; }
    .portal-empty { text-align: center; color: #94a3b8; padding: 2rem; font-size: .9rem; }
    .portal-notif-badge { display: inline-flex; align-items: center; justify-content: center; background: #dc2626; color: #fff; border-radius: 999px; font-size: .72rem; font-weight: 700; min-width: 18px; height: 18px; padding: 0 4px; margin-left: 4px; }
    .portal-response-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: .8rem 1rem; margin-top: .5rem; font-size: .87rem; color: #14532d; }
  `;
  document.head.appendChild(style);
}

// ─── Carga de datos ───────────────────────────────────────────────────────────

async function loadDashboard() {
  const res = await apiFetch('/portal/dashboard');
  if (res.ok) {
    portalState.kpis   = res.data.kpis   || {};
    portalState.recent = res.data.recent || {};
  }
}

async function loadSoportes() {
  const params = new URLSearchParams();
  if (portalState.soporteStatus) params.set('status', portalState.soporteStatus);
  const res = await apiFetch('/portal/soportes?' + params);
  if (res.ok) portalState.soportes = res.data || [];
}

async function loadTurnos() {
  const params = new URLSearchParams();
  if (portalState.turnoStatus) params.set('status', portalState.turnoStatus);
  const res = await apiFetch('/portal/turnos?' + params);
  if (res.ok) portalState.turnos = res.data || [];
}

async function loadTickets() {
  const params = new URLSearchParams();
  if (portalState.ticketStatus) params.set('status', portalState.ticketStatus);
  if (portalState.ticketType)   params.set('type',   portalState.ticketType);
  const res = await apiFetch('/portal/tickets?' + params);
  if (res.ok) portalState.tickets = res.data || [];
}

async function loadAuditoria() {
  const res = await apiFetch('/portal/auditoria');
  if (res.ok) portalState.auditoria = res.data || [];
}

// ─── Vistas HTML ──────────────────────────────────────────────────────────────

function renderDashboardView() {
  const k = portalState.kpis;
  const recent = portalState.recent;

  const kpiCard = (val, label, cls = '') =>
    `<div class="portal-kpi ${cls}"><div class="kpi-val">${val ?? '—'}</div><div class="kpi-lbl">${label}</div></div>`;

  const recentSoportes = (recent.soportes || []).slice(0, 5).map((s) =>
    `<tr><td>${escapeHtml(s.employee_name || '—')}</td><td>${escapeHtml(s.doc_type || '—')}</td><td>${badge(s.status)}</td></tr>`
  ).join('') || `<tr><td colspan="3" class="portal-empty">Sin soportes recientes</td></tr>`;

  const recentTickets = (recent.tickets || []).slice(0, 5).map((t) =>
    `<tr><td>${escapeHtml(t.ticket_number || '—')}</td><td>${escapeHtml(t.employee_name || '—')}</td><td>${escapeHtml(docTypeLabels[t.ticket_type] || t.ticket_type || '—')}</td><td>${badge(t.status)}</td></tr>`
  ).join('') || `<tr><td colspan="4" class="portal-empty">Sin solicitudes recientes</td></tr>`;

  return `
    <div class="portal-section-title">Indicadores</div>
    <div class="portal-kpis">
      ${kpiCard(k.soportes_pendientes,   'Soportes pendientes',    k.soportes_pendientes  > 0 ? 'warn' : '')}
      ${kpiCard(k.soportes_rechazados,   'Soportes rechazados',    k.soportes_rechazados  > 0 ? 'danger' : '')}
      ${kpiCard(k.soportes_aprobados,    'Soportes aprobados',     'ok')}
      ${kpiCard(k.solicitudes_abiertas,  'Solicitudes abiertas',   k.solicitudes_abiertas > 0 ? 'warn' : '')}
      ${kpiCard(k.solicitudes_resueltas, 'Solicitudes resueltas',  'ok')}
      ${kpiCard(k.docs_generados,        'Documentos enviados',    'ok')}
    </div>

    <div class="portal-section-title">Últimos soportes</div>
    <div class="portal-table-wrap">
      <table class="portal-table">
        <thead><tr><th>Empleado</th><th>Documento</th><th>Estado</th></tr></thead>
        <tbody>${recentSoportes}</tbody>
      </table>
    </div>

    <div class="portal-section-title">Últimas solicitudes</div>
    <div class="portal-table-wrap">
      <table class="portal-table">
        <thead><tr><th>Radicado</th><th>Empleado</th><th>Tipo</th><th>Estado</th></tr></thead>
        <tbody>${recentTickets}</tbody>
      </table>
    </div>
  `;
}

function renderSoportesView() {
  const rows = portalState.soportes.map((s) => {
    const acciones = [];
    if (s.fileUrl) {
      acciones.push(`<a href="${escapeAttr(s.fileUrl)}" target="_blank" class="btn-xs secondary">Ver archivo</a>`);
    }
    if (!canApprove()) {
      acciones.push(`<button class="btn-xs primary" data-action="subir-soporte" data-id="${s.id}">
        ${s.fileUrl ? 'Reemplazar' : 'Subir'} archivo</button>`);
    }
    if (canApprove() && s.status !== 'APROBADO') {
      if (s.fileUrl) {
        acciones.push(`<button class="btn-xs success" data-action="aprobar-soporte" data-id="${s.id}">Aprobar</button>`);
        acciones.push(`<button class="btn-xs danger"  data-action="rechazar-soporte" data-id="${s.id}">Rechazar</button>`);
      }
    }
    return `<tr>
      <td>${escapeHtml(s.employeeName || '—')}</td>
      <td>${escapeHtml(s.docType || '—')}</td>
      <td>${s.deadline ? fmtDate(s.deadline) : '—'}</td>
      <td>${badge(s.status)}</td>
      <td title="${escapeAttr(s.observation || '')}">${escapeHtml((s.observation || '').slice(0, 40)) || '—'}</td>
      <td><div style="display:flex;gap:.3rem;flex-wrap:wrap">${acciones.join('')}</div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="portal-empty">No hay soportes para mostrar</td></tr>`;

  const statusOptions = ['', 'PENDIENTE', 'EN_REVISION', 'APROBADO', 'RECHAZADO']
    .map((s) => `<option value="${s}" ${portalState.soporteStatus === s ? 'selected' : ''}>${s || 'Todos los estados'}</option>`)
    .join('');

  const crearBtn = !canApprove()
    ? `<button class="btn-xs primary" data-action="nuevo-soporte">+ Nuevo soporte</button>`
    : '';

  return `
    <div class="portal-filters">
      <select id="filtro-soporte-status">${statusOptions}</select>
      <button class="btn-xs secondary" data-action="reload-soportes">Actualizar</button>
      ${crearBtn}
    </div>
    <div class="portal-table-wrap" style="margin-top:.7rem">
      <table class="portal-table">
        <thead><tr>
          <th>Empleado</th><th>Documento requerido</th><th>Fecha límite</th>
          <th>Estado</th><th>Observación</th><th>Acciones</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderTurnosView() {
  const rows = portalState.turnos.map((t) => {
    const acciones = [];
    if (t.supportUrl) {
      acciones.push(`<a href="${escapeAttr(t.supportUrl)}" target="_blank" class="btn-xs secondary">Ver soporte</a>`);
    }
    acciones.push(`<button class="btn-xs secondary" data-action="ver-turno" data-id="${t.id}">Ver</button>`);
    return `<tr>
      <td>${escapeHtml(t.employeeName || '—')}</td>
      <td>${fmtDate(t.turnDate)}</td>
      <td>${fmtCurrency(t.totalValue)}</td>
      <td>${badge(t.status || 'PENDIENTE')}</td>
      <td>${escapeHtml(t.institutionName || '—')} / ${escapeHtml(t.siteName || '—')}</td>
      <td><div style="display:flex;gap:.3rem">${acciones.join('')}</div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="portal-empty">No hay turnos externos para mostrar</td></tr>`;

  const statusOptions = ['', 'PENDIENTE', 'EN_REVISION', 'APROBADO', 'PAGADO']
    .map((s) => `<option value="${s}" ${portalState.turnoStatus === s ? 'selected' : ''}>${s || 'Todos los estados'}</option>`)
    .join('');

  return `
    <div class="portal-filters">
      <select id="filtro-turno-status">${statusOptions}</select>
      <button class="btn-xs secondary" data-action="reload-turnos">Actualizar</button>
    </div>
    <div class="portal-table-wrap" style="margin-top:.7rem">
      <table class="portal-table">
        <thead><tr>
          <th>Persona</th><th>Fecha</th><th>Valor</th><th>Estado</th>
          <th>Institución / Sede</th><th>Acciones</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderTicketsView() {
  const rows = portalState.tickets.map((t) => {
    const acciones = [];
    acciones.push(`<button class="btn-xs secondary" data-action="ver-ticket" data-id="${t.id}">Ver</button>`);
    if (canApprove() && !['CERRADA'].includes(t.status)) {
      acciones.push(`<button class="btn-xs primary" data-action="responder-ticket" data-id="${t.id}">Responder</button>`);
      if (t.status !== 'CERRADA') {
        acciones.push(`<button class="btn-xs warning" data-action="cerrar-ticket" data-id="${t.id}">Cerrar</button>`);
      }
    }
    return `<tr>
      <td style="font-family:monospace;font-size:.82rem">${escapeHtml(t.ticketNumber || '—')}</td>
      <td>${escapeHtml(t.employeeName || '—')}</td>
      <td>${escapeHtml(docTypeLabels[t.ticketType] || t.ticketType || '—')}</td>
      <td>${badge(t.status)}</td>
      <td>${fmtDate(t.createdAt)}</td>
      <td><div style="display:flex;gap:.3rem;flex-wrap:wrap">${acciones.join('')}</div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="portal-empty">No hay solicitudes para mostrar</td></tr>`;

  const statusOptions = ['', 'RADICADA', 'EN_PROCESO', 'RESPONDIDA', 'CERRADA']
    .map((s) => `<option value="${s}" ${portalState.ticketStatus === s ? 'selected' : ''}>${s || 'Todos los estados'}</option>`)
    .join('');

  const typeOptions = ['', ...Object.keys(docTypeLabels).filter((k) => !AUTO_TYPES.includes(k))]
    .map((k) => `<option value="${k}" ${portalState.ticketType === k ? 'selected' : ''}>${k ? docTypeLabels[k] : 'Todos los tipos'}</option>`)
    .join('');

  return `
    <div class="portal-filters">
      <select id="filtro-ticket-status">${statusOptions}</select>
      <select id="filtro-ticket-type">${typeOptions}</select>
      <button class="btn-xs secondary" data-action="reload-tickets">Actualizar</button>
      <button class="btn-xs primary"   data-action="nueva-solicitud">+ Nueva solicitud</button>
    </div>
    <div class="portal-table-wrap" style="margin-top:.7rem">
      <table class="portal-table">
        <thead><tr>
          <th>Radicado</th><th>Empleado</th><th>Tipo</th><th>Estado</th>
          <th>Fecha</th><th>Acciones</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderAuditoriaView() {
  const rows = portalState.auditoria.map((a) =>
    `<tr>
      <td>${fmtDate(a.createdAt)}</td>
      <td>${escapeHtml(a.userName || '—')}</td>
      <td>${escapeHtml(a.action || '—')}</td>
      <td>${escapeHtml(a.entityType || '—')} ${a.entityId ? `#${a.entityId}` : ''}</td>
      <td>${escapeHtml(a.result || '—')}</td>
      <td>${escapeHtml((a.observation || '').slice(0, 60)) || '—'}</td>
    </tr>`
  ).join('') || `<tr><td colspan="6" class="portal-empty">Sin registros de auditoría</td></tr>`;

  return `
    <div class="portal-filters">
      <button class="btn-xs secondary" data-action="reload-auditoria">Actualizar</button>
    </div>
    <div class="portal-table-wrap" style="margin-top:.7rem">
      <table class="portal-table">
        <thead><tr>
          <th>Fecha/Hora</th><th>Usuario</th><th>Acción</th>
          <th>Entidad</th><th>Resultado</th><th>Observación</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ─── Render principal ─────────────────────────────────────────────────────────

function renderCurrentView() {
  const body = document.getElementById('portal-body');
  if (!body) return;

  let html = '';
  switch (portalState.view) {
    case 'dashboard':  html = renderDashboardView(); break;
    case 'soportes':   html = renderSoportesView();  break;
    case 'turnos':     html = renderTurnosView();     break;
    case 'tickets':    html = renderTicketsView();    break;
    case 'auditoria':  html = renderAuditoriaView();  break;
  }
  body.innerHTML = html;
  wireBodyEvents(body);
}

function renderPortalShell() {
  const tabs = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'soportes',  label: 'Soportes' },
    { key: 'turnos',    label: 'Turnos externos' },
    { key: 'tickets',   label: 'Solicitudes' },
    ...(canApprove() ? [{ key: 'auditoria', label: 'Auditoría' }] : []),
  ];

  const tabHtml = tabs.map((t) =>
    `<button type="button" class="portal-tab${portalState.view === t.key ? ' active' : ''}"
      data-tab="${t.key}">${escapeHtml(t.label)}</button>`
  ).join('');

  return `
    <div class="portal-wrap">
      <div class="portal-tabs" id="portal-tabs">${tabHtml}</div>
      <div id="portal-body"></div>
    </div>
  `;
}

// ─── Modales ──────────────────────────────────────────────────────────────────

function openModal(html) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'portal-modal-overlay';
  overlay.id = 'portal-modal-overlay';
  overlay.innerHTML = `<div class="portal-modal">${html}</div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.body.appendChild(overlay);
}

function closeModal() {
  document.getElementById('portal-modal-overlay')?.remove();
}

// Modal: nuevo soporte
function openNuevoSoporteModal() {
  openModal(`
    <h3>Nuevo soporte requerido</h3>
    <div class="form-row">
      <label>ID del empleado</label>
      <input type="text" id="sm-emp-id" placeholder="Número de documento o ID">
    </div>
    <div class="form-row">
      <label>Nombre del empleado</label>
      <input type="text" id="sm-emp-name">
    </div>
    <div class="form-row">
      <label>Tipo de documento requerido</label>
      <input type="text" id="sm-doc-type" placeholder="Ej: Hoja de vida, Cédula...">
    </div>
    <div class="form-row">
      <label>Fecha límite</label>
      <input type="date" id="sm-deadline">
    </div>
    <div class="modal-actions">
      <button class="btn-modal cancel" onclick="document.getElementById('portal-modal-overlay')?.remove()">Cancelar</button>
      <button class="btn-modal confirm" id="sm-submit">Crear</button>
    </div>
  `);
  document.getElementById('sm-submit').onclick = async () => {
    const btn = document.getElementById('sm-submit');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      const res = await apiFetch('/portal/soportes', {
        method: 'POST',
        body: JSON.stringify({
          employeeId:   document.getElementById('sm-emp-id').value.trim(),
          employeeName: document.getElementById('sm-emp-name').value.trim(),
          docType:      document.getElementById('sm-doc-type').value.trim(),
          deadline:     document.getElementById('sm-deadline').value || null,
        }),
      });
      if (!res.ok) throw new Error(res.message || 'Error al crear soporte');
      closeModal();
      await loadSoportes();
      renderCurrentView();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Crear';
      alert(err.message);
    }
  };
}

// Modal: subir archivo de soporte
function openSubirArchivoModal(soporteId, reemplazar = false) {
  openModal(`
    <h3>${reemplazar ? 'Reemplazar' : 'Subir'} archivo de soporte</h3>
    <div class="form-row">
      <label>Archivo (PDF, imagen)</label>
      <input type="file" id="sm-file" accept=".pdf,.jpg,.jpeg,.png,.webp">
    </div>
    <div class="modal-actions">
      <button class="btn-modal cancel" onclick="document.getElementById('portal-modal-overlay')?.remove()">Cancelar</button>
      <button class="btn-modal confirm" id="sm-upload">Subir</button>
    </div>
  `);
  document.getElementById('sm-upload').onclick = async () => {
    const fileInput = document.getElementById('sm-file');
    if (!fileInput.files.length) { alert('Selecciona un archivo'); return; }
    const btn = document.getElementById('sm-upload');
    btn.disabled = true; btn.textContent = 'Subiendo...';
    try {
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      const uploadRes = await fetch('/payroll/supports/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${state.token}` },
        body: formData,
      });
      const uploadData = await uploadRes.json();
      if (!uploadData.ok) throw new Error(uploadData.message || 'Error al subir archivo');

      const patchRes = await apiFetch(`/portal/soportes/${soporteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fileUrl: uploadData.data.url, fileName: uploadData.data.fileName }),
      });
      if (!patchRes.ok) throw new Error(patchRes.message || 'Error al guardar soporte');
      closeModal();
      await loadSoportes();
      renderCurrentView();
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Subir';
      alert(err.message);
    }
  };
}

// Modal: aprobar soporte
async function aprobarSoporte(id) {
  if (!confirm('¿Confirmar la aprobación de este soporte?')) return;
  try {
    const res = await apiFetch(`/portal/soportes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'APROBADO' }),
    });
    if (!res.ok) throw new Error(res.message || 'Error');
    await loadSoportes();
    renderCurrentView();
  } catch (err) { alert(err.message); }
}

// Modal: rechazar soporte
function openRechazarSoporteModal(id) {
  openModal(`
    <h3>Rechazar soporte</h3>
    <div class="form-row">
      <label>Motivo del rechazo</label>
      <textarea id="sm-obs" placeholder="Ej: Documento ilegible, Falta firma, Documento incompleto..."></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn-modal cancel" onclick="document.getElementById('portal-modal-overlay')?.remove()">Cancelar</button>
      <button class="btn-modal confirm" style="background:#dc2626" id="sm-rechazar">Rechazar</button>
    </div>
  `);
  document.getElementById('sm-rechazar').onclick = async () => {
    const obs = document.getElementById('sm-obs').value.trim();
    const btn = document.getElementById('sm-rechazar');
    btn.disabled = true;
    try {
      const res = await apiFetch(`/portal/soportes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'RECHAZADO', observation: obs }),
      });
      if (!res.ok) throw new Error(res.message || 'Error');
      closeModal();
      await loadSoportes();
      renderCurrentView();
    } catch (err) {
      btn.disabled = false;
      alert(err.message);
    }
  };
}

// Modal: nueva solicitud (ticket o documento automático)
function openNuevaSolicitudModal() {
  const allTypes = [
    ...AUTO_TYPES.map((k) => ({ key: k, label: docTypeLabels[k], auto: true })),
    { key: 'RECLAMACION_NOMINA',   label: 'Reclamación de nómina',   auto: false },
    { key: 'RECLAMACION_TURNOS',   label: 'Reclamación de turnos',   auto: false },
    { key: 'ACTUALIZACION_DATOS',  label: 'Actualización de datos',  auto: false },
    { key: 'OTRO',                 label: 'Otro',                    auto: false },
  ];

  const typeOptions = allTypes.map((t) =>
    `<option value="${t.key}" data-auto="${t.auto}">${t.label}</option>`
  ).join('');

  openModal(`
    <h3>Nueva solicitud</h3>
    <div class="form-row">
      <label>Tipo de solicitud</label>
      <select id="ns-type">${typeOptions}</select>
    </div>
    <div class="form-row">
      <label>Empleado (nombre o documento)</label>
      <input type="text" id="ns-emp-name" placeholder="Nombre del colaborador">
    </div>
    <div class="form-row">
      <label>Número de documento del empleado</label>
      <input type="text" id="ns-emp-doc">
    </div>
    <!-- Campos para documentos automáticos -->
    <div id="ns-auto-fields">
      <div class="form-row">
        <label>Correo del colaborador</label>
        <input type="email" id="ns-email" placeholder="correo@ejemplo.com">
      </div>
      <div class="form-row">
        <label>Período (si aplica, ej: 2026-01)</label>
        <input type="text" id="ns-period" placeholder="2026-01">
      </div>
    </div>
    <!-- Campos para tickets -->
    <div id="ns-ticket-fields" style="display:none">
      <div id="ns-nomina-fields" style="display:none">
        <div class="form-row"><label>Período</label><input type="text" id="ns-nomina-period" placeholder="2026-01"></div>
        <div class="form-row"><label>Motivo</label><input type="text" id="ns-nomina-motivo"></div>
      </div>
      <div id="ns-turnos-fields" style="display:none">
        <div class="form-row"><label>Fecha del turno</label><input type="date" id="ns-turno-fecha"></div>
        <div class="form-row"><label>Valor esperado</label><input type="number" id="ns-turno-valor" placeholder="0"></div>
        <div class="form-row"><label>Referencia del turno</label><input type="text" id="ns-turno-ref"></div>
      </div>
      <div class="form-row"><label>Descripción / Observación</label><textarea id="ns-desc" placeholder="Describe el motivo de la solicitud..."></textarea></div>
    </div>
    <div class="modal-actions">
      <button class="btn-modal cancel" onclick="document.getElementById('portal-modal-overlay')?.remove()">Cancelar</button>
      <button class="btn-modal confirm" id="ns-submit">Continuar</button>
    </div>
  `);

  const typeSelect    = document.getElementById('ns-type');
  const autoFields    = document.getElementById('ns-auto-fields');
  const ticketFields  = document.getElementById('ns-ticket-fields');
  const nominaFields  = document.getElementById('ns-nomina-fields');
  const turnosFields  = document.getElementById('ns-turnos-fields');
  const submitBtn     = document.getElementById('ns-submit');

  function syncFields() {
    const opt = typeSelect.selectedOptions[0];
    const isAuto = opt?.dataset?.auto === 'true';
    autoFields.style.display   = isAuto ? '' : 'none';
    ticketFields.style.display = isAuto ? 'none' : '';
    nominaFields.style.display = typeSelect.value === 'RECLAMACION_NOMINA' ? '' : 'none';
    turnosFields.style.display = typeSelect.value === 'RECLAMACION_TURNOS' ? '' : 'none';
  }

  typeSelect.addEventListener('change', syncFields);
  syncFields();

  submitBtn.onclick = async () => {
    const opt    = typeSelect.selectedOptions[0];
    const isAuto = opt?.dataset?.auto === 'true';
    const type   = typeSelect.value;
    const empName  = document.getElementById('ns-emp-name').value.trim();
    const empDoc   = document.getElementById('ns-emp-doc').value.trim();

    if (isAuto) {
      // Mostrar confirmación de email
      const email = document.getElementById('ns-email').value.trim();
      if (!email) { alert('Ingresa el correo del colaborador'); return; }
      openEmailConfirmModal(type, empName, empDoc, email, document.getElementById('ns-period')?.value.trim() || '');
    } else {
      // Crear ticket
      if (!document.getElementById('ns-desc')?.value.trim()) {
        alert('La descripción es obligatoria');
        return;
      }
      submitBtn.disabled = true; submitBtn.textContent = 'Creando...';
      try {
        const payload = {
          ticketType:    type,
          employeeName:  empName,
          documentNumber:empDoc,
          descripcion:   document.getElementById('ns-desc').value.trim(),
          period:        document.getElementById('ns-nomina-period')?.value.trim() || '',
          motivo:        document.getElementById('ns-nomina-motivo')?.value.trim() || '',
          fechaTurno:    document.getElementById('ns-turno-fecha')?.value || null,
          valorEsperado: document.getElementById('ns-turno-valor')?.value || null,
          turnoReferencia:document.getElementById('ns-turno-ref')?.value.trim() || '',
        };
        const res = await apiFetch('/portal/tickets', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(res.message || 'Error al crear solicitud');
        alert(`Solicitud radicada exitosamente.\nNúmero: ${res.data?.ticketNumber}`);
        closeModal();
        await loadTickets();
        renderCurrentView();
      } catch (err) {
        submitBtn.disabled = false; submitBtn.textContent = 'Continuar';
        alert(err.message);
      }
    }
  };
}

// Modal: confirmación de email para documento automático
function openEmailConfirmModal(docType, empName, empDoc, email, period) {
  const masked = maskEmail(email);
  const label = docTypeLabels[docType] || docType;

  closeModal();
  openModal(`
    <h3>Confirmar envío de documento</h3>
    <div class="portal-email-confirm">
      El documento <strong>${escapeHtml(label)}</strong> será enviado al correo registrado:<br><br>
      <span class="email-val">${escapeHtml(masked)}</span><br><br>
      Verifique que este correo corresponda al titular de la solicitud.<br>
      Si el correo no es correcto, actualice primero los datos personales o comuníquese con Talento Humano.
    </div>
    <div class="modal-actions">
      <button class="btn-modal cancel" onclick="document.getElementById('portal-modal-overlay')?.remove()">Cancelar</button>
      <button class="btn-modal confirm" id="email-confirm-btn">Enviar documento</button>
    </div>
  `);

  document.getElementById('email-confirm-btn').onclick = async () => {
    const btn = document.getElementById('email-confirm-btn');
    btn.disabled = true; btn.textContent = 'Enviando...';
    try {
      const res = await apiFetch('/portal/documento-automatico', {
        method: 'POST',
        body: JSON.stringify({ docType, employeeName: empName, employeeDoc: empDoc, email, period }),
      });
      if (res.code === 'NO_EMAIL') {
        closeModal();
        alert('No existe un correo electrónico registrado para este colaborador.\n\nActualice primero los datos personales o comuníquese con Talento Humano.');
        return;
      }
      if (!res.ok) throw new Error(res.message || 'Error al enviar documento');
      closeModal();
      alert('El documento fue enviado correctamente al correo registrado.');
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Enviar documento';
      alert(err.message);
    }
  };
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  const masked = local.slice(0, 2) + '*'.repeat(Math.max(0, local.length - 2));
  return `${masked}@${domain}`;
}

// Modal: ver ticket
async function openVerTicketModal(id) {
  try {
    const res = await apiFetch(`/portal/tickets/${id}`);
    if (!res.ok) throw new Error(res.message || 'Error');
    const t = res.data;
    openModal(`
      <h3>Solicitud ${escapeHtml(t.ticketNumber)}</h3>
      <p style="margin:.2rem 0;font-size:.85rem;color:#64748b">
        <strong>Tipo:</strong> ${escapeHtml(docTypeLabels[t.ticketType] || t.ticketType)} &nbsp;|&nbsp;
        ${badge(t.status)} &nbsp;|&nbsp;
        <strong>Fecha:</strong> ${fmtDate(t.createdAt)}
      </p>
      <p><strong>Empleado:</strong> ${escapeHtml(t.employeeName || '—')} (${escapeHtml(t.documentNumber || '—')})</p>
      ${t.period ? `<p><strong>Período:</strong> ${escapeHtml(t.period)}</p>` : ''}
      ${t.motivo ? `<p><strong>Motivo:</strong> ${escapeHtml(t.motivo)}</p>` : ''}
      ${t.fechaTurno ? `<p><strong>Fecha turno:</strong> ${fmtDate(t.fechaTurno)} — Valor esperado: ${fmtCurrency(t.valorEsperado)}</p>` : ''}
      <p><strong>Descripción:</strong><br>${escapeHtml(t.descripcion || '—')}</p>
      ${t.attachmentUrl ? `<p><a href="${escapeAttr(t.attachmentUrl)}" target="_blank">Ver adjunto</a></p>` : ''}
      ${t.responseText ? `<div class="portal-response-box"><strong>Respuesta de Talento Humano:</strong><br>${escapeHtml(t.responseText)}</div>` : ''}
      <div class="modal-actions">
        <button class="btn-modal cancel" onclick="document.getElementById('portal-modal-overlay')?.remove()">Cerrar</button>
      </div>
    `);
  } catch (err) { alert(err.message); }
}

// Modal: responder ticket (TH)
function openResponderTicketModal(id) {
  openModal(`
    <h3>Responder solicitud</h3>
    <div class="form-row">
      <label>Respuesta para el colaborador</label>
      <textarea id="resp-text" placeholder="Escribe la respuesta aquí..." rows="5"></textarea>
    </div>
    <div class="form-row">
      <label>Cambiar estado</label>
      <select id="resp-status">
        <option value="EN_PROCESO">En proceso</option>
        <option value="RESPONDIDA" selected>Respondida</option>
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn-modal cancel" onclick="document.getElementById('portal-modal-overlay')?.remove()">Cancelar</button>
      <button class="btn-modal confirm" id="resp-submit">Guardar respuesta</button>
    </div>
  `);
  document.getElementById('resp-submit').onclick = async () => {
    const btn = document.getElementById('resp-submit');
    btn.disabled = true;
    try {
      const res = await apiFetch(`/portal/tickets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status:       document.getElementById('resp-status').value,
          responseText: document.getElementById('resp-text').value.trim(),
        }),
      });
      if (!res.ok) throw new Error(res.message || 'Error');
      closeModal();
      await loadTickets();
      renderCurrentView();
    } catch (err) {
      btn.disabled = false;
      alert(err.message);
    }
  };
}

async function cerrarTicket(id) {
  if (!confirm('¿Cerrar esta solicitud?')) return;
  try {
    const res = await apiFetch(`/portal/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'CERRADA' }),
    });
    if (!res.ok) throw new Error(res.message || 'Error');
    await loadTickets();
    renderCurrentView();
  } catch (err) { alert(err.message); }
}

// ─── Eventos de la vista ──────────────────────────────────────────────────────

function wireBodyEvents(body) {
  body.addEventListener('change', (e) => {
    if (e.target.id === 'filtro-soporte-status') {
      portalState.soporteStatus = e.target.value;
      loadSoportes().then(renderCurrentView);
    }
    if (e.target.id === 'filtro-turno-status') {
      portalState.turnoStatus = e.target.value;
      loadTurnos().then(renderCurrentView);
    }
    if (e.target.id === 'filtro-ticket-status') {
      portalState.ticketStatus = e.target.value;
      loadTickets().then(renderCurrentView);
    }
    if (e.target.id === 'filtro-ticket-type') {
      portalState.ticketType = e.target.value;
      loadTickets().then(renderCurrentView);
    }
  });

  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id ? Number(btn.dataset.id) : null;

    switch (action) {
      case 'reload-soportes':  await loadSoportes(); renderCurrentView(); break;
      case 'reload-turnos':    await loadTurnos();   renderCurrentView(); break;
      case 'reload-tickets':   await loadTickets();  renderCurrentView(); break;
      case 'reload-auditoria': await loadAuditoria();renderCurrentView(); break;
      case 'nuevo-soporte':    openNuevoSoporteModal(); break;
      case 'subir-soporte':    openSubirArchivoModal(id, !!portalState.soportes.find((s) => s.id === id)?.fileUrl); break;
      case 'aprobar-soporte':  await aprobarSoporte(id); break;
      case 'rechazar-soporte': openRechazarSoporteModal(id); break;
      case 'ver-turno':        // TODO: detalle turno
        alert('Vista detallada del turno próximamente.'); break;
      case 'nueva-solicitud':  openNuevaSolicitudModal(); break;
      case 'ver-ticket':       await openVerTicketModal(id); break;
      case 'responder-ticket': openResponderTicketModal(id); break;
      case 'cerrar-ticket':    await cerrarTicket(id); break;
    }
  });
}

function wireTabs() {
  const tabs = document.getElementById('portal-tabs');
  if (!tabs) return;
  tabs.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    portalState.view = btn.dataset.tab;

    // Actualizar clases
    tabs.querySelectorAll('.portal-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === portalState.view);
    });

    // Cargar datos de la vista
    await refreshView(portalState.view);
    renderCurrentView();
  });
}

async function refreshView(view) {
  switch (view) {
    case 'dashboard':  await loadDashboard(); break;
    case 'soportes':   await loadSoportes();  break;
    case 'turnos':     await loadTurnos();    break;
    case 'tickets':    await loadTickets();   break;
    case 'auditoria':  await loadAuditoria(); break;
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function loadPortalModule() {
  injectPortalStyles();

  portalState.view = 'dashboard';
  portalState.soporteStatus = '';
  portalState.turnoStatus   = '';
  portalState.ticketStatus  = '';
  portalState.ticketType    = '';

  // Carga inicial del dashboard
  await loadDashboard();

  const shell = renderPortalShell();

  // Pequeño delay para que el DOM esté montado antes de conectar eventos
  setTimeout(() => {
    wireTabs();
    renderCurrentView();
  }, 60);

  return shell;
}
