"use strict";

import { apiFetch } from './api.js';

let _inited = false;
let _drawerOpen = false;

function _drawer()    { return document.getElementById("docViewerDrawer");  }
function _overlay()   { return document.getElementById("docViewerOverlay"); }
function _frame()     { return document.getElementById("docViewerFrame");   }
function _loading()   { return document.getElementById("docViewerLoading"); }
function _titleEl()   { return document.getElementById("docViewerTitle");   }
function _docsPanel() { return document.getElementById("documents-panel");  }

function _clearActive() {
  document.querySelectorAll(".document-item.active").forEach(el => el.classList.remove("active"));
}

function _markActive(docId) {
  _clearActive();
  document.querySelectorAll(`.document-item[data-doc-id="${CSS.escape(String(docId))}"]`)
    .forEach(el => el.classList.add("active"));
}

function _close() {
  _drawerOpen = false;
  _drawer()?.classList.remove("open");
  _overlay()?.classList.remove("open");
  _drawer()?.setAttribute("aria-hidden", "true");
  _docsPanel()?.classList.remove("drawer-open");
  _clearActive();
  const f = _frame();
  if (f) f.src = "";
}

function _init() {
  if (_inited) return;
  _inited = true;
  document.getElementById("docViewerClose")?.addEventListener("click", _close);
  _overlay()?.addEventListener("click", _close);
  document.addEventListener("keydown", e => { if (e.key === "Escape") _close(); });
}

async function _loadDoc(docId) {
  const l = _loading();
  const f = _frame();
  if (l) l.classList.remove("hidden");
  if (f) { f.onload = null; f.src = ""; }
  try {
    const vt = await apiFetch(`/documents/${encodeURIComponent(docId)}/view-token`, { method: "POST" });
    if (!vt?.token) throw new Error("Sin token");
    if (f) {
      f.onload = () => l?.classList.add("hidden");
      f.src = `/documents/${encodeURIComponent(docId)}/view?vt=${encodeURIComponent(vt.token)}`;
    }
  } catch {
    if (l) l.classList.add("hidden");
    if (f) f.srcdoc = `<html><body style="margin:0;padding:24px;font-family:sans-serif;color:#ef4444">No se pudo cargar el documento. Intenta de nuevo.</body></html>`;
  }
}

export async function openDocViewer(docId, title) {
  _init();

  const d = _drawer();
  if (!d) {
    // Fallback: pestaña nueva
    try {
      const vt = await apiFetch(`/documents/${encodeURIComponent(docId)}/view-token`, { method: "POST" });
      if (vt?.token) window.open(`/documents/${encodeURIComponent(docId)}/view?vt=${encodeURIComponent(vt.token)}`, "_blank", "noopener");
    } catch { /* noop */ }
    return;
  }

  const t = _titleEl();
  if (t) t.textContent = title || "Documento";

  _markActive(docId);

  if (_drawerOpen) {
    // Drawer ya abierto — solo cambia el documento sin cerrar/abrir
    await _loadDoc(docId);
    return;
  }

  _drawerOpen = true;
  d.classList.add("open");
  d.setAttribute("aria-hidden", "false");
  _overlay()?.classList.add("open");
  _docsPanel()?.classList.add("drawer-open");

  await _loadDoc(docId);
}
