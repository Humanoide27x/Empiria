// EMPIRIA V1 PRO — Shell interactions (sidebar, search, dropdowns)
import { state } from './state.js';
import { openModule } from './nav.js';

// ── Sidebar toggle ────────────────────────────────────────────────────────────

const MINI_KEY = "empiria_sidebar_v2";
const dashboard = document.getElementById("dashboard");

function setSidebarMini(mini) {
  dashboard?.classList.toggle("sidebar-mini", mini);
  localStorage.setItem(MINI_KEY, mini ? "1" : "0");
}

// Default: expanded. Solo colapsa si el usuario lo activó explícitamente.
if (dashboard && localStorage.getItem(MINI_KEY) === "1") {
  dashboard.classList.add("sidebar-mini");
}

document.getElementById("sidebarToggle")?.addEventListener("click", () => {
  setSidebarMini(!dashboard?.classList.contains("sidebar-mini"));
});

// ── Dropdown helpers ──────────────────────────────────────────────────────────

function closeAllDropdowns() {
  document.querySelectorAll(".tb-dropdown.open").forEach(d => d.classList.remove("open"));
}

function bindDropdown(dropId, btnId) {
  const drop = document.getElementById(dropId);
  const btn  = document.getElementById(btnId);
  if (!drop || !btn) return;
  btn.addEventListener("click", e => {
    e.stopPropagation();
    const wasOpen = drop.classList.contains("open");
    closeAllDropdowns();
    if (!wasOpen) drop.classList.add("open");
  });
}

document.addEventListener("click", closeAllDropdowns);

bindDropdown("notifDropdown",    "notifBtn");
bindDropdown("activityDropdown", "activityBtn");
bindDropdown("qaDropdown",       "quickActionsBtn");
bindDropdown("userDropdown",     "userProfileBtn");

// ── Quick actions ─────────────────────────────────────────────────────────────

document.getElementById("qaNuevoEmpleado")?.addEventListener("click", () => {
  closeAllDropdowns();
  state.personnelViewMode = "create";
  openModule("gestion_personal");
});

document.getElementById("qaRegistrarNovedad")?.addEventListener("click", () => {
  closeAllDropdowns();
  openModule("nomina_novedades");
});

// ── Topbar logout proxy ───────────────────────────────────────────────────────

document.getElementById("tbLogoutBtn")?.addEventListener("click", () => {
  closeAllDropdowns();
  document.getElementById("logoutButton")?.click();
});

// ── Global search ─────────────────────────────────────────────────────────────

const gsOverlay  = document.getElementById("globalSearch");
const gsBackdrop = document.getElementById("gsBackdrop");
const gsInput    = document.getElementById("gsInput");
const gsResults  = document.getElementById("gsResults");

function openSearch() {
  gsOverlay?.classList.remove("hidden");
  requestAnimationFrame(() => gsInput?.focus());
}

function closeSearch() {
  gsOverlay?.classList.add("hidden");
  if (gsInput) gsInput.value = "";
  renderHint();
}

document.getElementById("globalSearchTrigger")?.addEventListener("click", openSearch);
gsBackdrop?.addEventListener("click", closeSearch);

document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); openSearch(); }
  if (e.key === "Escape" && !gsOverlay?.classList.contains("hidden")) closeSearch();
});

const MODULE_LINKS = [
  { key: "dashboard_hr",                   label: "Dashboard",                   icon: "📊" },
  { key: "gestion_personal",               label: "Gestión del Personal",        icon: "👥" },
  { key: "calculadora_personal",           label: "Calculadora",                 icon: "🔢" },
  { key: "cobertura_calculadora",          label: "Verificación de Cobertura",   icon: "📍" },
  { key: "nomina_novedades",               label: "Nómina y Liquidación",        icon: "💰" },
  { key: "administracion_configuraciones", label: "Administración",              icon: "⚙️" },
];

function renderHint() {
  if (!gsResults) return;
  gsResults.innerHTML = `
    <div class="gs-empty-state">
      <p class="gs-hint">Busca módulos del sistema, empleados por nombre o cédula...</p>
      <div class="gs-shortcuts">
        <span><kbd>↑</kbd><kbd>↓</kbd> Navegar</span>
        <span><kbd>↵</kbd> Abrir</span>
        <span><kbd>ESC</kbd> Cerrar</span>
      </div>
    </div>`;
}

function renderSearchResults(q) {
  if (!gsResults) return;
  if (!q) { renderHint(); return; }

  const qLow = q.toLowerCase();
  const moduleMatches = MODULE_LINKS.filter(m =>
    m.label.toLowerCase().includes(qLow) || m.key.toLowerCase().includes(qLow)
  );

  let html = "";

  if (moduleMatches.length) {
    html += `<div class="gs-section-title">Módulos del sistema</div>`;
    html += moduleMatches.map(m => `
      <button class="gs-result-item" data-module="${m.key}" type="button">
        <span class="gs-result-ico">${m.icon}</span>
        <div>
          <div class="gs-result-main">${m.label}</div>
          <div class="gs-result-sub">Ir al módulo</div>
        </div>
      </button>`).join("");
  }

  if (!html) {
    html = `<div class="gs-empty-state"><p class="gs-hint">Sin resultados para "${q}"</p></div>`;
  }

  gsResults.innerHTML = html;

  gsResults.querySelectorAll("[data-module]").forEach(btn => {
    btn.addEventListener("click", () => {
      closeSearch();
      openModule(btn.dataset.module);
    });
  });
}

gsInput?.addEventListener("input", e => renderSearchResults(e.target.value));

// ── Tooltip global para botones de icono ─────────────────────────────────────

const _tip = document.createElement("div");
_tip.id = "pnl-tooltip";
document.body.appendChild(_tip);

document.body.addEventListener("mouseover", (e) => {
  const btn = e.target.closest(".personnel-icon-btn[title]");
  if (!btn) return;
  const text = btn.getAttribute("title");
  if (!text) return;
  _tip.textContent = text;
  _tip.style.display = "block";
  const r = btn.getBoundingClientRect();
  _tip.style.left = (r.left + r.width / 2) + "px";
  _tip.style.top  = r.top + "px";
});

document.body.addEventListener("mouseout", (e) => {
  if (!e.target.closest(".personnel-icon-btn")) return;
  _tip.style.display = "none";
});

document.addEventListener("click", () => { _tip.style.display = "none"; });
