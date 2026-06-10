"use strict";

/**
 * Identifica registros en employee_documents cuyo archivo físico no existe
 * en el almacenamiento local (uploads/documents/) y los marca como DELETED.
 *
 * Uso:
 *   node scripts/cleanup-orphan-documents.js          → aplica cambios
 *   node scripts/cleanup-orphan-documents.js --dry-run → solo reporta, sin modificar
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const path = require("path");
const fs   = require("fs");
const { Pool } = require("pg");

const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  database: process.env.DB_NAME     || "empiria_db",
  user:     process.env.DB_USER     || "postgres",
  password: process.env.DB_PASSWORD,
  port:     Number(process.env.DB_PORT || 5432),
});

const UPLOADS_DIR = path.resolve(__dirname, "../uploads/documents");

function getLocalPath(fileKey) {
  if (!fileKey) return null;
  const safeName = path.basename(String(fileKey));
  return safeName ? path.join(UPLOADS_DIR, safeName) : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("[dry-run] Solo reporte — no se modificará la BD.\n");

  // Verificar si la columna deleted_at existe
  const { rows: colRows } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'employee_documents' AND column_name = 'deleted_at'
  `);
  const hasDeletedAt = colRows.length > 0;

  // Traer todos los documentos no eliminados
  const deletedFilter = hasDeletedAt
    ? "deleted_at IS NULL AND UPPER(TRIM(COALESCE(status, ''))) NOT IN ('DELETED')"
    : "UPPER(TRIM(COALESCE(status, ''))) NOT IN ('DELETED')";

  const { rows: docs } = await pool.query(`
    SELECT id, employee_id, status, file_url, file_name,
           stored_file_name, file_key
    FROM employee_documents
    WHERE ${deletedFilter}
    ORDER BY id
  `);

  console.log(`Documentos activos en BD: ${docs.length}`);

  const orphans = [];
  for (const doc of docs) {
    const key = doc.file_key || doc.stored_file_name || doc.file_name
              || (doc.file_url ? path.basename(doc.file_url) : null);

    if (!key) {
      orphans.push({ id: doc.id, key: null, reason: "sin referencia de archivo" });
      continue;
    }

    const localPath = getLocalPath(key);
    if (!localPath || !fs.existsSync(localPath)) {
      orphans.push({ id: doc.id, key, reason: "archivo no encontrado en disco" });
    }
  }

  console.log(`Huérfanos encontrados: ${orphans.length}\n`);
  for (const o of orphans) {
    console.log(`  id=${String(o.id).padEnd(6)} key=${o.key || "(vacío)"}  → ${o.reason}`);
  }

  if (!orphans.length) {
    console.log("\nNo hay documentos huérfanos. Nada que limpiar.");
    await pool.end();
    return;
  }

  if (dryRun) {
    console.log(`\n[dry-run] Se marcarían ${orphans.length} registros como DELETED.`);
    await pool.end();
    return;
  }

  const ids = orphans.map(o => o.id);
  const setClauses = ["status = 'DELETED'"];
  if (hasDeletedAt) setClauses.push("deleted_at = NOW()");

  await pool.query(
    `UPDATE employee_documents SET ${setClauses.join(", ")} WHERE id = ANY($1::int[])`,
    [ids]
  );

  console.log(`\n${ids.length} documentos marcados como DELETED.`);
  await pool.end();
}

main().catch(err => {
  console.error("Error fatal:", err.message);
  process.exit(1);
});
