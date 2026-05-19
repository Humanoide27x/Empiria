import { state, elements } from './state.js';
import { apiFetch } from './api.js';
import {
  prettyLabel, fillSelect, fillOptionSelect, toMunicipalityArray,
  formatCompany, formatContract, showLoginMessage, showAdminCreateMessage,
  resetMfaState,
} from './utils.js';
import {
  renderModuleNav, renderEmptyWorkspace, syncAdminPanelsVisibility,
  toggleAdminPanel, toggleAccessPanel,
} from './nav.js';
import { openModule } from './nav.js';
import { dashboardCleaner } from './nav.js';

// ── Admin user list ───────────────────────────────────────────────────────────

export function renderAdminUsers() {
  if (!elements.adminUsersList || !elements.adminCount) return;

  elements.adminCount.textContent = `${state.users.length} usuarios`;
  elements.adminUsersList.innerHTML = state.users.map((user) => `
    <article class="admin-user-card">
      <div class="admin-user-head">
        <div>
          <strong>${user.name}</strong>
          <p class="soft tiny">Usuario: ${user.username} | Rol: ${prettyLabel(user.role)}</p>
        </div>
        <span class="pill">ID ${user.id}</span>
      </div>
      <form class="admin-user-form" data-user-id="${user.id}">
        <label>Nombre completo<input name="name" type="text" value="${user.name}" required /></label>
        <label>Usuario<input name="username" type="text" value="${user.username}" required /></label>
        <label>Rol
          <select name="role">
            ${state.availableRoles.map((role) =>
              `<option value="${role}" ${role === user.role ? "selected" : ""}>${prettyLabel(role)}</option>`
            ).join("")}
          </select>
        </label>
        <label>Empresa
          <select name="companyId">
            <option value="">Sin asignar</option>
            ${state.companies.map((company) =>
              `<option value="${company.id}" ${company.id === user.companyId ? "selected" : ""}>${company.name} (${company.id})</option>`
            ).join("")}
          </select>
        </label>
        <label>Contrato
          <select name="contractId">
            <option value="">Sin asignar</option>
            ${state.contracts.map((contract) =>
              `<option value="${contract.id}" ${contract.id === user.contractId ? "selected" : ""}>${contract.name}</option>`
            ).join("")}
          </select>
        </label>
        <label>Nueva clave<input name="password" type="password" placeholder="Solo si la quieres cambiar" /></label>
        <label class="wide">Municipios asignados
          <input name="assignedMunicipalities" type="text"
            value="${(user.assignedMunicipalities || []).join(", ")}"
            placeholder="Ejemplo: Bogotá, Soacha" />
        </label>
        <div class="admin-actions wide">
          <button type="submit" class="btn btn-primary">Guardar cambios</button>
        </div>
      </form>
    </article>
  `).join("");

  elements.adminUsersList
    .querySelectorAll(".admin-user-form")
    .forEach((form) => form.addEventListener("submit", handleUpdateUser));
}

// ── Data loaders ──────────────────────────────────────────────────────────────

export async function loadAdminData() {
  const [rolesPayload, usersPayload] = await Promise.all([
    apiFetch("/roles"),
    apiFetch("/users"),
  ]);
  state.availableRoles = rolesPayload.roles;
  state.users          = usersPayload.users;
  fillSelect(elements.createRole, state.availableRoles);
  renderAdminUsers();
}

export async function loadReferenceData() {
  const [companiesPayload, contractsPayload] = await Promise.all([
    apiFetch("/companies"),
    apiFetch("/contracts"),
  ]);
  state.companies = (companiesPayload.companies || []).filter(
    (company) => company.active === true || company.active === "true" || company.active === "t"
  );
  state.contracts = contractsPayload.contracts || [];

  fillOptionSelect(elements.createCompanyId, state.companies, {
    valueKey: "id",
    labelBuilder: (company) => company.name,
    includeEmpty: true,
  });
  fillOptionSelect(elements.createContractId, state.contracts, {
    valueKey: "id",
    labelBuilder: (contract) => contract.name,
    includeEmpty: true,
  });
}

// ── Dashboard / session ───────────────────────────────────────────────────────

export async function renderDashboard(user, access) {
  state.currentUser = user;
  state.access      = access;
  await loadReferenceData();

  // For contract-scoped users, restrict the company/contract lists to their own assignment.
  // This prevents the create-employee form from showing companies they can't access.
  if (user.companyId) {
    state.companies = state.companies.filter((c) => c.id === Number(user.companyId));
    state.contracts = state.contracts.filter(
      (c) => c.id === Number(user.contractId) || Number(c.companyId || c.company_id) === Number(user.companyId)
    );
  }

  elements.loginWrap?.classList.add("hidden");
  elements.dashboard?.classList.remove("hidden");

  if (elements.welcomeName)  elements.welcomeName.textContent  = user.name || "Usuario";
  if (elements.welcomeRole)  elements.welcomeRole.textContent  = prettyLabel(user.role);
  if (elements.companyValue) elements.companyValue.textContent = formatCompany(user.companyId);
  if (elements.contractValue)elements.contractValue.textContent= formatContract(user.contractId);

  if (elements.municipalityValue) {
    elements.municipalityValue.textContent =
      user.assignedMunicipalities?.length ? user.assignedMunicipalities.join(", ") : "Sin restricción";
  }
  if (elements.topUser) {
    elements.topUser.textContent = user.name || "Usuario";
    elements.topUser.title = `${user.name || "Usuario"} · ${prettyLabel(user.role)}`;
  }
  if (elements.sbCompany)      elements.sbCompany.textContent      = formatCompany(user.companyId);
  if (elements.sbContract)     elements.sbContract.textContent     = formatContract(user.contractId);
  if (elements.sbMunicipality) {
    const muns = user.assignedMunicipalities || [];
    if (muns.length) {
      elements.sbMunicipality.innerHTML = muns.map(m => `<span class="sb-mun-chip">${m}</span>`).join("");
      elements.sbMunicipality.title = muns.join(", ");
    } else {
      elements.sbMunicipality.innerHTML = `<span class="sb-mun-chip sb-mun-free">Sin restricción</span>`;
      elements.sbMunicipality.title = "Sin restricción";
    }
  }

  // Avatar initials + user dropdown
  const initials = (user.name || "U").split(" ").slice(0, 2).map(n => n[0]).join("").toUpperCase();
  const roleLabel = prettyLabel(user.role);
  ["userAvatar", "userAvatarLg", "sidebarAvatar"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = initials;
  });
  const dropName = document.getElementById("userDropName");
  const dropRole = document.getElementById("userDropRole");
  if (dropName) dropName.textContent = user.name || "Usuario";
  if (dropRole) dropRole.textContent = roleLabel;

  state.activeModule    = null;
  state.expandedModule  = null;
  state.activeSubmodule = null;

  renderModuleNav(access.modules || []);
  fillSelect(elements.moduleSelect, (access.modules || []).map((item) => item.module));

  if (user.role === "administrador") await loadAdminData();

  renderEmptyWorkspace();
  syncAdminPanelsVisibility();
}

export function resetDashboard() {
  dashboardCleaner.fn();
  state.currentUser    = null;
  state.access         = null;
  state.activeModule   = null;
  state.expandedModule = null;
  state.activeSubmodule= null;
  state.token          = "";
  state.users          = [];
  state.personnelCreateTab = "identificacion";
  state.personnelDraft = {};

  localStorage.removeItem("empiria_token");
  localStorage.removeItem("empiria_user");
  localStorage.removeItem("empiria_access");

  resetMfaState();

  elements.dashboard?.classList.add("hidden");
  elements.loginWrap?.classList.remove("hidden");
  elements.accessResult?.classList.add("hidden");

  toggleAdminPanel(false);
  toggleAccessPanel(false);

  if (elements.adminUsersList) elements.adminUsersList.innerHTML = "";
  if (elements.adminCount)     elements.adminCount.textContent = "0 usuarios";
  if (elements.moduleNav)      elements.moduleNav.innerHTML = "";

  renderEmptyWorkspace();

  if (elements.topUser)         elements.topUser.textContent = "-";
  if (elements.topModuleName)   elements.topModuleName.textContent = "Dashboard";
  if (elements.topModuleName)   elements.topModuleName.title = "Dashboard";
  if (elements.topModuleBreadcrumb) elements.topModuleBreadcrumb.textContent = "Dashboard";
  if (elements.topModuleBreadcrumb) elements.topModuleBreadcrumb.title = "Dashboard";
  if (elements.sbCompany)       elements.sbCompany.textContent = "-";
  if (elements.sbContract)      elements.sbContract.textContent = "-";
  if (elements.sbMunicipality) { elements.sbMunicipality.innerHTML = `<span class="sb-mun-chip sb-mun-free">Sin restricción</span>`; elements.sbMunicipality.title = "Sin restricción"; }
  ["userAvatar", "userAvatarLg", "sidebarAvatar"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = "U";
  });

  showAdminCreateMessage("", false);
  showLoginMessage("", false);
}

export async function loadModulesCatalog() {
  const payload = await apiFetch("/modules");
  state.availableModules = payload.modules || [];
  state.availableActions = payload.actions || [];
  fillSelect(elements.actionSelect, state.availableActions);
}

export async function tryRestoreSession() {
  if (!state.token) {
    elements.bootScreen?.classList.add("hidden");
    elements.loginWrap?.classList.remove("hidden");
    elements.dashboard?.classList.add("hidden");
    return;
  }
  try {
    const payload = await apiFetch("/me");
    await renderDashboard(payload.user, payload.access);
    // Arrancar notificaciones al restaurar sesión (import dinámico para evitar ciclo)
    import('./notifications.js').then(m => m.startNotificationLoop()).catch(() => {});
  } catch (error) {
    console.error("Error restaurando sesión:", error);
    resetDashboard();
  } finally {
    elements.bootScreen?.classList.add("hidden");
  }
}

// ── User CRUD ─────────────────────────────────────────────────────────────────

export async function handleCreateUser(event) {
  event.preventDefault();
  const formData = new FormData(elements.createUserForm);
  const payload = {
    name:     formData.get("name"),
    username: formData.get("username"),
    password: formData.get("password"),
    role:     formData.get("role"),
    companyId:  formData.get("companyId")  ? Number(formData.get("companyId"))  : null,
    contractId: formData.get("contractId") ? Number(formData.get("contractId")) : null,
    assignedMunicipalities: toMunicipalityArray(formData.get("assignedMunicipalities")),
  };
  try {
    await apiFetch("/users", { method: "POST", body: JSON.stringify(payload) });
    elements.createUserForm.reset();
    showAdminCreateMessage("Usuario creado correctamente", false);
    await loadAdminData();
  } catch (error) {
    showAdminCreateMessage(error.message, true);
  }
}

export async function handleUpdateUser(event) {
  event.preventDefault();
  const form   = event.currentTarget;
  const userId = Number(form.dataset.userId);
  const formData = new FormData(form);
  const payload = {
    name:     formData.get("name"),
    username: formData.get("username"),
    role:     formData.get("role"),
    companyId:  formData.get("companyId")  ? Number(formData.get("companyId"))  : null,
    contractId: formData.get("contractId") ? Number(formData.get("contractId")) : null,
    assignedMunicipalities: toMunicipalityArray(formData.get("assignedMunicipalities")),
  };
  if (formData.get("password")) payload.password = formData.get("password");
  try {
    await apiFetch(`/users/${userId}`, { method: "PATCH", body: JSON.stringify(payload) });
    showAdminCreateMessage("Cambios guardados correctamente", false);
    await loadAdminData();
  } catch (error) {
    showAdminCreateMessage(error.message, true);
  }
}
