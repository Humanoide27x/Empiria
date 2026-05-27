import { state } from './state.js';

const SESSION_CACHE_TTL = 5 * 60 * 1000;
const sessionGetCache = new Map();

function getAuthToken() {
  return state.token || localStorage.getItem("empiria_token") || "";
}

function isPublicEndpoint(path) {
  return /^\/(?:login|health)(?:\?|$)/.test(String(path || ""));
}

function isSessionCacheable(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  if (method !== "GET" || options.cache === "no-store" || options.skipSessionCache) return false;
  return [
    /^\/roles(?:\?|$)/,
    /^\/companies(?:\?|$)/,
    /^\/contracts(?:\?|$)/,
    /^\/municipalities(?:\?|$)/,
    /^\/config\/municipalities(?:\?|$)/,
    /^\/dashboard\/periods(?:\?|$)/,
    /^\/admin\/contractual\/master\/positions(?:\?|$)/,
    /^\/admin\/contractual\/master\/areas(?:\?|$)/,
  ].some((pattern) => pattern.test(String(path || "")));
}

export async function apiFetch(path, options = {}) {
  const endpoint = String(path || "");
  if (!endpoint.startsWith("/")) {
    const error = new Error(`Endpoint invalido en apiFetch: "${endpoint}"`);
    error.status = 0;
    error.endpoint = endpoint;
    console.error(`[apiFetch] request cancelado por endpoint invalido: ${endpoint}`);
    throw error;
  }
  const token = getAuthToken();
  const requiresAuth = options.auth !== false && !isPublicEndpoint(endpoint);
  if (requiresAuth && !token) {
    const error = new Error("Sesion no disponible para consultar el endpoint");
    error.status = 401;
    error.endpoint = endpoint;
    console.warn(`[apiFetch] sin token: ${endpoint}`);
    throw error;
  }

  const cacheKey = `${token ? token.slice(0, 12) : "anon"}:${endpoint}`;
  if (isSessionCacheable(endpoint, options)) {
    const cached = sessionGetCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < SESSION_CACHE_TTL) {
      return cached.payload;
    }
  }

  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const startedAt = performance.now();
  let response;
  try {
    response = await fetch(endpoint, { ...options, headers });
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.error(`[apiFetch] fallo de red ${endpoint} ${elapsedMs}ms:`, error.message);
    error.endpoint = endpoint;
    throw error;
  }
  const elapsedMs = Math.round(performance.now() - startedAt);
  if (elapsedMs >= 800) {
    console.warn(`[apiFetch] ${response.status} ${endpoint} ${elapsedMs}ms`);
  } else if (localStorage.getItem("empiria_perf") === "1") {
    console.info(`[apiFetch] ${response.status} ${endpoint} ${elapsedMs}ms`);
  }

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
    error.endpoint = endpoint;
    console.warn(`[apiFetch] endpoint fallido ${response.status}: ${endpoint}`);
    throw error;
  }

  if (isSessionCacheable(endpoint, options)) {
    sessionGetCache.set(cacheKey, { ts: Date.now(), payload });
  }

  return payload;
}
