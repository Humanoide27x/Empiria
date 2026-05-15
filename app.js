// Cargar variables de entorno lo primero
require("dotenv").config();

const app               = require("./src/app");
const pool              = require("./src/db/pool");
const { runMigrations } = require("./scripts/run-migrations");

const PORT    = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === "production";

// ── Logger de arranque ────────────────────────────────────────────────────────
function log(level, data) {
  if (IS_PROD) {
    process.stdout.write(JSON.stringify({ level, ts: new Date().toISOString(), ...data }) + "\n");
  } else {
    const icons = { info: "✅", warn: "⚠️", error: "❌" };
    const msg   = typeof data === "string" ? data : JSON.stringify(data);
    console.log(`${icons[level] || "•"}  ${msg}`);
  }
}

// ── Señales de proceso ────────────────────────────────────────────────────────
async function shutdown(signal) {
  log("info", { msg: `Señal ${signal} recibida, cerrando servidor…` });
  try {
    await pool.end();
    log("info", { msg: "Pool de PostgreSQL cerrado." });
  } catch { /* silent */ }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  log("error", { msg: "UnhandledRejection", reason: String(reason) });
});
process.on("uncaughtException", (err) => {
  log("error", { msg: "UncaughtException", error: err.message });
  process.exit(1);
});

// ── Arranque ──────────────────────────────────────────────────────────────────
async function start() {
  // 1. Verificar conexión a la base de datos
  log("info", { msg: "Conectando a PostgreSQL…" });
  const { rows } = await pool.query("SELECT NOW() AS ts, version() AS pg_version");
  log("info", {
    msg:        "PostgreSQL conectado",
    server_time: rows[0].ts,
    pg_version:  rows[0].pg_version.split(" ").slice(0, 2).join(" "),
  });

  // 2. Correr migraciones pendientes
  log("info", { msg: "Verificando migraciones…" });
  await runMigrations();

  // 3. Iniciar servidor HTTP
  const server = app.listen(PORT, () => {
    const { name, version } = require("./package.json");
    log("info", {
      msg:     `${name} v${version} iniciado`,
      env:     process.env.NODE_ENV || "development",
      port:    PORT,
      url:     `http://localhost:${PORT}`,
      cors:    process.env.CORS_ORIGIN || "(sin restricción — dev)",
      storage: process.env.R2_BUCKET_NAME ? "R2" : "local",
    });
  });

  server.on("error", (err) => {
    log("error", { msg: "Error en servidor HTTP", error: err.message });
    process.exit(1);
  });
}

start().catch((err) => {
  log("error", { msg: "Error fatal al arrancar EMPIRIA", error: err.message });
  process.exit(1);
});
