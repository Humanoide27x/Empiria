function getAuthToken() {
  return window.EmpiriaAuth?.getStoredToken?.() || "";
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-CO");
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getVisualStatus(item) {
  const reason = String(item.reason || "").toLowerCase();

  if (reason.includes("blocked")) {
    return {
      label: "blocked",
      className: "status-blocked",
    };
  }

  if (item.status === "success") {
    return {
      label: "success",
      className: "status-success",
    };
  }

  if (item.status === "pending_mfa") {
    return {
      label: "pending_mfa",
      className: "status-pending_mfa",
    };
  }

  return {
    label: item.status || "failed",
    className: "status-failed",
  };
}

function getReasonBadge(reason) {
  const value = String(reason || "-");
  const normalized = value.toLowerCase();

  let extraClass = "";

  if (normalized.includes("blocked")) {
    extraClass = "blocked";
  } else if (normalized.includes("mfa")) {
    extraClass = "mfa";
  } else if (normalized.includes("success")) {
    extraClass = "success";
  }

  return `<span class="reason-badge ${extraClass}">${escapeHtml(value)}</span>`;
}

function renderSummary(summary = {}) {
  document.getElementById("totalLogs").textContent = summary.total || 0;
  document.getElementById("totalSuccess").textContent = summary.success || 0;
  document.getElementById("totalFailed").textContent = summary.failed || 0;
  document.getElementById("totalPendingMfa").textContent = summary.pendingMfa || 0;
  document.getElementById("totalBlocked").textContent = summary.blocked || 0;
}

function renderLogs(logs = []) {
  const tbody = document.getElementById("logsTableBody");
  const tableCount = document.getElementById("tableCount");

  tableCount.textContent = `${logs.length} registros`;

  if (!logs.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty">No se encontraron registros.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = logs.map((item) => {
    const visualStatus = getVisualStatus(item);

    return `
      <tr>
        <td>${item.id}</td>
        <td>${escapeHtml(item.username)}</td>
        <td>${escapeHtml(item.role || "-")}</td>
        <td>
          <span class="status ${visualStatus.className}">
            ${escapeHtml(visualStatus.label)}
          </span>
        </td>
        <td>${getReasonBadge(item.reason)}</td>
        <td>${escapeHtml(item.ip || "-")}</td>
        <td>${escapeHtml(formatDate(item.createdAt))}</td>
        <td>${escapeHtml(item.userAgent || "-")}</td>
      </tr>
    `;
  }).join("");
}

function buildQueryString() {
  const params = new URLSearchParams();

  const username = document.getElementById("filterUsername").value.trim();
  const status = document.getElementById("filterStatus").value.trim();
  const reason = document.getElementById("filterReason").value.trim();
  const ip = document.getElementById("filterIp").value.trim();
  const from = document.getElementById("filterFrom").value.trim();
  const to = document.getElementById("filterTo").value.trim();
  const limit = document.getElementById("filterLimit").value.trim();

  if (username) params.set("username", username);
  if (status) params.set("status", status);
  if (reason) params.set("reason", reason);
  if (ip) params.set("ip", ip);
  if (from) params.set("from", new Date(from).toISOString());
  if (to) params.set("to", new Date(to).toISOString());
  if (limit) params.set("limit", limit);

  return params.toString();
}

async function loadLogs() {
  const token = getAuthToken();
  const tbody = document.getElementById("logsTableBody");

  if (!token) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty">No se encontró token de sesión.</td>
      </tr>
    `;
    return;
  }

  try {
    const query = buildQueryString();
    const response = await fetch(`/access-logs${query ? `?${query}` : ""}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="empty">${escapeHtml(data.message || "No fue posible cargar los logs.")}</td>
        </tr>
      `;
      return;
    }

    renderSummary(data.summary || {});
    renderLogs(data.logs || []);
  } catch (error) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty">Error cargando auditoría: ${escapeHtml(error.message)}</td>
      </tr>
    `;
  }
}

function clearFilters() {
  document.getElementById("filterUsername").value = "";
  document.getElementById("filterStatus").value = "";
  document.getElementById("filterReason").value = "";
  document.getElementById("filterIp").value = "";
  document.getElementById("filterFrom").value = "";
  document.getElementById("filterTo").value = "";
  document.getElementById("filterLimit").value = "100";
}

async function bootstrapAuditPage() {
  const result = await window.EmpiriaAuth.validateSession({
    redirectTo: "/",
    requiredRole: "administrador",
    requireAuth: true,
  });

  if (!result.ok) {
    return;
  }

  loadLogs();
}

document.getElementById("reloadBtn").addEventListener("click", loadLogs);
document.getElementById("applyFiltersBtn").addEventListener("click", loadLogs);
document.getElementById("clearFiltersBtn").addEventListener("click", () => {
  clearFilters();
  loadLogs();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await window.EmpiriaAuth.logout();
});

bootstrapAuditPage();