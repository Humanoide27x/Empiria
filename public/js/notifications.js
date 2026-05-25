import { apiFetch } from './api.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';

// ── Estado acumulado ──────────────────────────────────────────────────────────
const _alertLog   = [];   // { id, message, severity, ts }
const _actLog     = [];   // { id, description, type, timestamp }

let _unreadAlerts = 0;
let _unreadAct    = 0;
let _notifTimer   = null;
let _inFlight     = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
function alertId(a)    { return a.message; }
function actId(a)      { return a.timestamp + '|' + a.description; }

function relTime(ts) {
  const m = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (m < 1)  return 'Ahora';
  if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h} h`;
  return `Hace ${Math.floor(h / 24)} día(s)`;
}

function activityIcon(type) {
  if (!type) return '📌';
  if (type === 'INGRESO')        return '👤';
  if (type === 'ACTUALIZACION')  return '✏️';
  if (type.includes('RETIRO'))   return '🚪';
  if (type.includes('INCAPACI')) return '🏥';
  if (type.includes('VACACION')) return '🏖️';
  if (type.includes('NOVEDAD'))  return '📋';
  return '📌';
}

function severityColor(s) {
  return s === 'critical' ? '#dc2626' : s === 'warning' ? '#d97706' : s === 'ok' ? '#16a34a' : '#3b82f6';
}

// ── Render alertas acumuladas ─────────────────────────────────────────────────
function paintAlerts() {
  const list  = document.getElementById('tb-alerts-list');
  const count = document.getElementById('tb-alert-count');
  const badge = document.getElementById('notifBadge');
  if (!list) return;

  if (count) {
    const crit = _alertLog.filter(a => a.severity === 'critical').length;
    const warn = _alertLog.filter(a => a.severity === 'warning').length;
    count.textContent = crit > 0 ? `${crit} críticas` : warn > 0 ? `${warn} alertas` : _alertLog.length ? `${_alertLog.length} alertas` : 'Todo OK';
    count.className   = 'ck-panel-badge ' + (crit > 0 ? 'ck-badge-red' : warn > 0 ? 'ck-badge-yellow' : _alertLog.length ? 'ck-badge-gray' : 'ck-badge-green');
  }
  if (badge) {
    badge.textContent = _unreadAlerts > 0 ? String(_unreadAlerts > 99 ? '99+' : _unreadAlerts) : '';
    badge.classList.toggle('hidden', _unreadAlerts === 0);
  }

  if (!_alertLog.length) {
    list.innerHTML = `<div class="tb-dd-empty"><p>Sin alertas activas</p></div>`;
    return;
  }

  list.innerHTML = `
    <div class="tb-notif-toolbar">
      <span class="tb-notif-total">${_alertLog.length} alerta(s)</span>
      <button class="tb-notif-clear" id="clearAlerts">Limpiar</button>
    </div>
    ${_alertLog.map(a => `
      <div class="tb-notif-item" style="border-left:3px solid ${severityColor(a.severity)}">
        <div class="tb-notif-row">
          <span class="tb-notif-dot" style="background:${severityColor(a.severity)}"></span>
          <div class="tb-act-body">
            <span class="tb-notif-msg">${escapeHtml(a.message)}</span>
            <span class="tb-act-time">${relTime(a.ts)}</span>
          </div>
        </div>
      </div>`).join('')}`;

  document.getElementById('clearAlerts')?.addEventListener('click', e => {
    e.stopPropagation();
    _alertLog.length = 0;
    _unreadAlerts    = 0;
    paintAlerts();
  });
}

// ── Render actividad acumulada ────────────────────────────────────────────────
function paintActivity() {
  const list  = document.getElementById('tb-activity-list');
  const badge = document.getElementById('activityBadge');
  if (!list) return;

  if (badge) {
    badge.textContent = _unreadAct > 0 ? String(_unreadAct > 99 ? '99+' : _unreadAct) : '';
    badge.classList.toggle('hidden', _unreadAct === 0);
  }

  if (!_actLog.length) {
    list.innerHTML = `<div class="tb-dd-empty"><p>Sin actividad reciente</p></div>`;
    return;
  }

  list.innerHTML = `
    <div class="tb-notif-toolbar">
      <span class="tb-notif-total">${_actLog.length} evento(s)</span>
      <button class="tb-notif-clear" id="clearActivity">Limpiar</button>
    </div>
    ${_actLog.map(a => `
      <div class="tb-notif-item">
        <div class="tb-notif-row">
          <span class="tb-act-icon">${activityIcon(a.type)}</span>
          <div class="tb-act-body">
            <span class="tb-notif-msg">${escapeHtml(a.description)}</span>
            <span class="tb-act-time">${relTime(a.timestamp)}</span>
          </div>
        </div>
      </div>`).join('')}`;

  document.getElementById('clearActivity')?.addEventListener('click', e => {
    e.stopPropagation();
    _actLog.length = 0;
    _unreadAct     = 0;
    paintActivity();
  });
}

// ── Marcar leídas al abrir dropdown ──────────────────────────────────────────
document.getElementById('notifBtn')?.addEventListener('click', () => {
  _unreadAlerts = 0;
  paintAlerts();
});
document.getElementById('activityBtn')?.addEventListener('click', () => {
  _unreadAct = 0;
  paintActivity();
});

// ── Cargar y acumular ─────────────────────────────────────────────────────────
export async function loadTopbarNotifications() {
  if (_inFlight) return;

  const hasToken = Boolean(state.token || localStorage.getItem("empiria_token"));
  const hasDashboardAccess = Array.isArray(state.access?.modules)
    ? state.access.modules.some((item) => item?.module === "dashboard")
    : false;

  if (!hasToken || !hasDashboardAccess) {
    return;
  }

  _inFlight = true;
  try {
    const [alertsResult, activityResult] = await Promise.allSettled([
      apiFetch('/dashboard/alerts'),
      apiFetch('/dashboard/recent-activity?limit=15'),
    ]);

    if (alertsResult.status === "rejected") {
      console.warn("[notifications] Fallo /dashboard/alerts:", alertsResult.reason?.message || alertsResult.reason);
      if (alertsResult.reason?.status === 401 || alertsResult.reason?.status === 403) stopNotificationLoop();
    }

    if (activityResult.status === "rejected") {
      console.warn("[notifications] Fallo /dashboard/recent-activity:", activityResult.reason?.message || activityResult.reason);
      if (activityResult.reason?.status === 401 || activityResult.reason?.status === 403) stopNotificationLoop();
    }

    const alertsRes = alertsResult.status === "fulfilled" ? alertsResult.value : { data: [] };
    const actRes = activityResult.status === "fulfilled" ? activityResult.value : { data: [] };

    // Acumular alertas nuevas (por mensaje único)
    const existingAlertIds = new Set(_alertLog.map(a => alertId(a)));
    let newAlerts = 0;
    for (const a of (alertsRes?.data || [])) {
      if (!existingAlertIds.has(alertId(a))) {
        _alertLog.unshift({ ...a, ts: new Date().toISOString() });
        newAlerts++;
      }
    }
    _unreadAlerts += newAlerts;
    if (_alertLog.length > 50) _alertLog.splice(50);

    // Acumular actividad nueva (por timestamp+descripción)
    const existingActIds = new Set(_actLog.map(a => actId(a)));
    let newAct = 0;
    for (const a of (actRes?.data || [])) {
      if (!existingActIds.has(actId(a))) {
        _actLog.unshift(a);
        newAct++;
      }
    }
    _unreadAct += newAct;
    if (_actLog.length > 60) _actLog.splice(60);

    paintAlerts();
    paintActivity();
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) {
      stopNotificationLoop();
      return;
    }
  } finally {
    _inFlight = false;
  }
}

export function startNotificationLoop() {
  loadTopbarNotifications();
  if (_notifTimer) clearInterval(_notifTimer);
  _notifTimer = setInterval(loadTopbarNotifications, 120_000);
}

export function stopNotificationLoop() {
  if (_notifTimer) { clearInterval(_notifTimer); _notifTimer = null; }
  _alertLog.length = 0;
  _actLog.length   = 0;
  _unreadAlerts    = 0;
  _unreadAct       = 0;
}
