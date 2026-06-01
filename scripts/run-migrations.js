/**
 * scripts/run-migrations.js
 *
 * Ejecuta archivos .sql de src/db/migrations/ en orden alfabético.
 * Lleva tracking en la tabla schema_migrations para no re-ejecutar.
 *
 * Uso directo:  node scripts/run-migrations.js
 * Desde código: const { runMigrations } = require('./scripts/run-migrations')
 */

"use strict";

// ── CRÍTICO: cargar .env ANTES de requerir pool.js
// pool.js llama buildConfig() en tiempo de módulo; si dotenv no ha corrido,
// process.env.DB_PASSWORD es undefined → pg recibe password="" (falsy) →
// pg lo descarta internamente → SASL recibe undefined → error de tipo.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const fs   = require("fs");
const pool = require("../src/db/pool");

const MIGRATIONS_DIR = path.join(__dirname, "../src/db/migrations");

// ── Tabla de tracking ─────────────────────────────────────────────────────────
const CREATE_TRACKING = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id         SERIAL      PRIMARY KEY,
    filename   TEXT        NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

async function ensureTrackingTable(client) {
  await client.query(CREATE_TRACKING);
}

async function isApplied(client, filename) {
  const { rows } = await client.query(
    "SELECT 1 FROM schema_migrations WHERE filename = $1",
    [filename]
  );
  return rows.length > 0;
}

async function markApplied(client, filename) {
  await client.query(
    "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
    [filename]
  );
}

// ── Runner principal ──────────────────────────────────────────────────────────
async function runMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log("[migrations] Directorio de migraciones no encontrado, omitiendo.");
    return;
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith(".sql"))
    .sort(); // 001_, 002_, etc. — orden garantizado

  if (files.length === 0) {
    console.log("[migrations] Sin archivos .sql encontrados.");
    return;
  }

  const client = await pool.connect();
  try {
    await ensureTrackingTable(client);

    let applied = 0;
    let skipped = 0;

    for (const filename of files) {
      if (await isApplied(client, filename)) {
        skipped++;
        continue;
      }

      const sqlPath = path.join(MIGRATIONS_DIR, filename);
      const sql     = fs.readFileSync(sqlPath, "utf8").trim();

      if (!sql) {
        console.log(`[migrations] Omitiendo ${filename} (vacío)`);
        skipped++;
        continue;
      }

      console.log(`[migrations] Aplicando ${filename}…`);

      try {
        await client.query("BEGIN");
        await client.query(sql);
        await markApplied(client, filename);
        await client.query("COMMIT");
        console.log(`[migrations] ✅ ${filename} aplicado`);
        applied++;
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`[migrations] ❌ ${filename} falló: ${err.message}`);
        throw err;
      }
    }

    console.log(`[migrations] Completo — ${applied} aplicadas, ${skipped} ya existentes.`);
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };

// Ejecución directa: node scripts/run-migrations.js
if (require.main === module) {
  // dotenv ya fue cargado al inicio del módulo — no repetir aquí.
  runMigrations()
    .then(() => {
      console.log("[migrations] Proceso finalizado.");
      process.exit(0);
    })
    .catch(err => {
      console.error("[migrations] Error fatal:", err.message);
      process.exit(1);
    });
}
