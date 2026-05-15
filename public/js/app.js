import './shell.js';
import { state, elements } from './state.js';
import { apiFetch } from './api.js';
import {
  showLoginMessage, ensureMfaField, showMfaField, resetMfaState,
} from './utils.js';
import {
  renderDashboard, resetDashboard,
  loadModulesCatalog, tryRestoreSession,
  handleCreateUser, loadAdminData,
} from './auth.js';
import { startNotificationLoop, stopNotificationLoop } from './notifications.js';

// ── Login ─────────────────────────────────────────────────────────────────────

if (elements.loginForm) {
  ensureMfaField();

  elements.loginForm.onsubmit = async (event) => {
    event.preventDefault();

    let username = String(document.getElementById("username")?.value || "").trim();
    let password = String(document.getElementById("password")?.value || "");

    if (state.requiresMfa) {
      username = state.tempUsername;
      password = state.tempPassword;
    }

    const mfaCode = String(elements.mfaCode?.value || "").trim();

    try {
      const response = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          mfaCode: state.requiresMfa ? mfaCode : undefined,
        }),
      });

      let payload;
      try { payload = await response.json(); }
      catch { payload = { ok: false, message: "Respuesta inválida del servidor" }; }

      if (payload.requiresMfa) {
        state.requiresMfa  = true;
        state.tempUsername = username;
        state.tempPassword = password;
        showMfaField(true);
        showLoginMessage(payload.message || "Debes ingresar el código MFA", true);
        return;
      }

      if (!response.ok || !payload.ok) {
        showLoginMessage(payload.message || "No fue posible iniciar sesión", true);
        return;
      }

      state.token = payload.token || "";
      localStorage.setItem("empiria_token", state.token);
      localStorage.setItem("empiria_user",   JSON.stringify(payload.user   || {}));
      localStorage.setItem("empiria_access",  JSON.stringify(payload.access || {}));

      resetMfaState();
      showLoginMessage("Inicio de sesión correcto", false);
      await renderDashboard(payload.user, payload.access);
      startNotificationLoop();
    } catch (error) {
      showLoginMessage(error.message, true);
    }
  };
}

// ── Logout ────────────────────────────────────────────────────────────────────

elements.logoutButton?.addEventListener("click", async () => {
  try { await apiFetch("/logout", { method: "POST" }); } catch { /* cierre local */ }
  stopNotificationLoop();
  resetDashboard();
});

// ── Panel de acceso (solo admin) ──────────────────────────────────────────────

elements.accessForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!state.currentUser || state.currentUser.role !== "administrador") {
    elements.accessResult?.classList.remove("hidden");
    elements.accessResult?.classList.add("denied");
    if (elements.accessResult) {
      elements.accessResult.innerHTML = `
        <strong>Acceso restringido</strong>
        <p>Solo el administrador puede usar esta validación.</p>
      `;
    }
    return;
  }

  const resource = {
    companyId:    elements.companyInput?.value  ? Number(elements.companyInput.value)  : null,
    contractId:   elements.contractInput?.value ? Number(elements.contractInput.value) : null,
    municipality: elements.municipalityInput?.value || null,
  };

  try {
    const payload = await apiFetch("/access-check", {
      method: "POST",
      body: JSON.stringify({
        module: elements.moduleSelect?.value,
        action: elements.actionSelect?.value,
        resource,
      }),
    });

    elements.accessResult?.classList.remove("hidden", "denied");
    if (elements.accessResult) {
      elements.accessResult.innerHTML = `
        <strong>${payload.result.allowed ? "Acceso permitido" : "Acceso negado"}</strong>
        <p>${payload.result.reason}</p>
      `;
      if (!payload.result.allowed) elements.accessResult.classList.add("denied");
    }
  } catch (error) {
    elements.accessResult?.classList.remove("hidden");
    elements.accessResult?.classList.add("denied");
    if (elements.accessResult) {
      elements.accessResult.innerHTML = `
        <strong>No se pudo validar</strong>
        <p>${error.message}</p>
      `;
    }
  }
});

// ── Administración de usuarios ────────────────────────────────────────────────

elements.createUserForm?.addEventListener("submit", handleCreateUser);

elements.refreshUsersButton?.addEventListener("click", async () => {
  try {
    await loadAdminData();
  } catch (error) {
    console.error("Error actualizando usuarios:", error);
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

Promise.all([loadModulesCatalog(), tryRestoreSession()]).catch(() => {
  showLoginMessage("No fue posible cargar la pantalla", true);
});
