import { state } from './state.js';

export async function apiFetch(path, options = {}) {
  const token = state.token || localStorage.getItem("empiria_token") || "";
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { ok: false, message: "Respuesta inválida del servidor" };
  }
  if (!response.ok) throw new Error(payload.message || "Ocurrió un error");
  return payload;
}
