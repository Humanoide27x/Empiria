const IS_PROD   = process.env.NODE_ENV === "production";
const PERF_DEBUG = process.env.PERFORMANCE_DEBUG === "1";
// Umbral de advertencia de rendimiento (ms). Configurable con SLOW_REQUEST_MS=N
const SLOW_MS    = Number(process.env.SLOW_REQUEST_MS) || 800;

// Rutas estáticas que no vale la pena logear (reducen ruido)
const STATIC_EXT = /\.(js|css|png|jpg|jpeg|svg|ico|woff|woff2|ttf|map|webp)$/i;

function emit(level, data) {
  if (IS_PROD) {
    process.stdout.write(JSON.stringify({ level, ts: new Date().toISOString(), ...data }) + "\n");
  } else {
    const icons = { info: "ℹ️", warn: "⚠️", error: "❌", debug: "🔍", perf: "⏱️" };
    const icon  = icons[level] || "•";
    const { msg, ...rest } = data;
    const extra = Object.keys(rest).length ? " " + JSON.stringify(rest) : "";
    console.log(`${icon}  ${msg || level}${extra}`);
  }
}

// Mide la duración de cualquier función async y emite [PERF] si supera el umbral
async function measurePerf(label, fn, thresholdMs = 300) {
  const t0 = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (PERF_DEBUG || ms >= thresholdMs) {
      const marker = ms >= thresholdMs * 3 ? "🔴" : ms >= thresholdMs ? "🟡" : "🟢";
      console.log(`${marker} [PERF] ${label} ${ms.toFixed(1)}ms`);
    }
  }
}

function requestLogger(req, res, next) {
  // Ignorar assets estáticos en los logs
  if (STATIC_EXT.test(req.path)) { next(); return; }

  const started = Date.now();

  res.on("finish", () => {
    const ms     = Date.now() - started;
    const status = res.statusCode;
    const level  = status >= 500 ? "error" : status >= 400 ? "warn" : "info";

    emit(level, {
      msg:       "request",
      method:    req.method,
      path:      req.path,
      status,
      ms,
      requestId: req.requestId,
      ip:        req.ip || req.socket?.remoteAddress,
      ua:        req.headers["user-agent"]?.slice(0, 100),
    });

    // Advertencia de petición lenta
    if (ms >= SLOW_MS && !STATIC_EXT.test(req.path)) {
      console.warn(`🔴 [PERF SLOW] ${req.method} ${req.path} ${ms}ms (umbral: ${SLOW_MS}ms)`);
    }
  });

  next();
}

module.exports = { requestLogger, emit, measurePerf };
