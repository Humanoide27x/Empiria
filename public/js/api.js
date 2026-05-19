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
    payload = { ok: false, message: "Respuesta invalida del servidor" };
  }

  if (!response.ok) {
    const error = new Error(payload.message || "Ocurrio un error");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}
