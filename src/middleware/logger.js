const IS_PROD = process.env.NODE_ENV === "production";

// Rutas estáticas que no vale la pena logear (reducen ruido)
const STATIC_EXT = /\.(js|css|png|jpg|jpeg|svg|ico|woff|woff2|ttf|map|webp)$/i;

function emit(level, data) {
  if (IS_PROD) {
    process.stdout.write(JSON.stringify({ level, ts: new Date().toISOString(), ...data }) + "\n");
  } else {
    const icons = { info: "ℹ️", warn: "⚠️", error: "❌", debug: "🔍" };
    const icon  = icons[level] || "•";
    const { msg, ...rest } = data;
    const extra = Object.keys(rest).length ? " " + JSON.stringify(rest) : "";
    console.log(`${icon}  ${msg || level}${extra}`);
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
  });

  next();
}

module.exports = { requestLogger, emit };
