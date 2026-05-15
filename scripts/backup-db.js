/**
 * scripts/backup-db.js
 *
 * Genera un pg_dump de la base de datos y guarda el .sql en /backups.
 * Conserva solo los últimos 10 backups (auto-limpieza).
 *
 * Uso: node scripts/backup-db.js
 * Requiere pg_dump en el PATH del sistema.
 */

"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { execSync } = require("child_process");
const path = require("path");
const fs   = require("fs");

const BACKUPS_DIR  = path.join(__dirname, "../backups");
const MAX_BACKUPS  = 10;

// ── Extraer parámetros de conexión ────────────────────────────────────────────
function getDbParams() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const u = new URL(url);
    return {
      host:     u.hostname,
      port:     u.port || "5432",
      user:     u.username,
      password: decodeURIComponent(u.password || ""),
      database: u.pathname.replace(/^\//, ""),
    };
  }
  return {
    host:     process.env.DB_HOST     || "localhost",
    port:     process.env.DB_PORT     || "5432",
    user:     process.env.DB_USER     || "postgres",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME     || "empiria_db",
  };
}

function run() {
  // Asegurar directorio de backups
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  const p = getDbParams();
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `empiria_${p.database}_${ts}.sql`;
  const outPath  = path.join(BACKUPS_DIR, filename);

  const cmd = [
    "pg_dump",
    `--host=${p.host}`,
    `--port=${p.port}`,
    `--username=${p.user}`,
    `--dbname=${p.database}`,
    "--no-owner",
    "--no-acl",
    "--verbose",
    `--file="${outPath}"`,
  ].join(" ");

  console.log(`[backup] Iniciando backup de '${p.database}' → ${filename}`);
  console.log(`[backup] Host: ${p.host}:${p.port}`);

  const env = { ...process.env, PGPASSWORD: p.password };

  try {
    execSync(cmd, { env, stdio: ["ignore", "pipe", "inherit"] });
  } catch (err) {
    console.error("[backup] ❌ pg_dump falló:", err.message);
    process.exit(1);
  }

  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`[backup] ✅ Backup completado: ${filename} (${sizeKb} KB)`);

  // Auto-limpieza: conservar solo los últimos MAX_BACKUPS
  const all = fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.endsWith(".sql"))
    .sort();

  while (all.length > MAX_BACKUPS) {
    const oldest = all.shift();
    fs.unlinkSync(path.join(BACKUPS_DIR, oldest));
    console.log(`[backup] 🗑️  Eliminado backup antiguo: ${oldest}`);
  }

  console.log(`[backup] Backups disponibles: ${Math.min(all.length + 1, MAX_BACKUPS)}`);
}

run();
