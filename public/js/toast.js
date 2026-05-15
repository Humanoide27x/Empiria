// ── Toast notification system ─────────────────────────────────────────────────

const container = document.createElement("div");
container.id = "toast-container";
document.body.appendChild(container);

export function showToast(message, type = "info", title = "", duration = 3800) {
  const icons  = { success: "✔", error: "✘", warning: "⚠", info: "ℹ" };
  const titles = { success: "Listo", error: "Error", warning: "Atención", info: "Información" };

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <div class="toast-body">
      <div class="toast-title">${title || titles[type] || ""}</div>
      ${message ? `<div class="toast-message">${message}</div>` : ""}
    </div>
    <button class="toast-close" onclick="this.closest('.toast').remove()">&#x2715;</button>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("show")));

  const timer = setTimeout(() => {
    toast.classList.add("hide");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, duration);

  toast.querySelector(".toast-close").addEventListener("click", () => clearTimeout(timer));
}

export const showSuccess = (msg, title) => showToast(msg, "success", title);
export const showError   = (msg, title) => showToast(msg, "error",   title);
export const showWarning = (msg, title) => showToast(msg, "warning", title);
export const showInfo    = (msg, title) => showToast(msg, "info",    title);
