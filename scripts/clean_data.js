/**
 * Limpieza de datos operativos.
 * Borra: employees, cobertura Excel, nómina/novedades, JSON de datos, archivos físicos.
 * NO toca: companies, contracts, contract_settings, users, roles, municipalities, positions.
 */

require("dotenv").config();
const pool = require("../src/db/pool");
const fs   = require("fs");
const path = require("path");

async function run() {
  console.log("Iniciando limpieza de datos...\n");

  // ── 1. Tablas PostgreSQL ────────────────────────────────────────────────────
  const steps = [
    { label: "coverage_upload_rows",        sql: "TRUNCATE coverage_upload_rows RESTART IDENTITY CASCADE" },
    { label: "coverage_uploads",            sql: "TRUNCATE coverage_uploads RESTART IDENTITY CASCADE" },
    { label: "payroll_municipality_status", sql: "TRUNCATE payroll_municipality_status RESTART IDENTITY CASCADE" },
    { label: "payroll_results",             sql: "TRUNCATE payroll_results RESTART IDENTITY CASCADE" },
    { label: "payroll_periods",             sql: "TRUNCATE payroll_periods RESTART IDENTITY CASCADE" },
    { label: "payroll_novelties",           sql: "TRUNCATE payroll_novelties RESTART IDENTITY CASCADE" },
    { label: "calculator_audit",            sql: "TRUNCATE calculator_audit RESTART IDENTITY CASCADE" },
    { label: "employees",                   sql: "TRUNCATE employees RESTART IDENTITY CASCADE" },
  ];

  for (const step of steps) {
    try {
      await pool.query(step.sql);
      console.log(`  ✓ ${step.label} vaciado`);
    } catch (err) {
      console.error(`  ✗ ${step.label}: ${err.message}`);
    }
  }

  // ── 2. Archivos JSON de datos ───────────────────────────────────────────────
  const jsonFiles = [
    path.join(__dirname, "../src/data/personnel.json"),
    path.join(__dirname, "../src/data/documents.json"),
    path.join(__dirname, "../src/data/personnel.backup.json"),
  ];

  for (const filePath of jsonFiles) {
    try {
      fs.writeFileSync(filePath, "[]", "utf8");
      console.log(`  ✓ ${path.basename(filePath)} limpiado`);
    } catch (err) {
      console.error(`  ✗ ${path.basename(filePath)}: ${err.message}`);
    }
  }

  // ── 3. Archivos físicos de cobertura ────────────────────────────────────────
  const uploadsDir = path.join(__dirname, "../uploads/coverage");
  if (fs.existsSync(uploadsDir)) {
    const files = fs.readdirSync(uploadsDir);
    let deleted = 0;
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(uploadsDir, file));
        deleted++;
      } catch (err) {
        console.error(`  ✗ ${file}: ${err.message}`);
      }
    }
    console.log(`  ✓ ${deleted} archivo(s) de cobertura eliminados de uploads/coverage/`);
  } else {
    console.log("  - Directorio uploads/coverage/ no existe, nada que borrar");
  }

  console.log("\nLimpieza completa.");
  await pool.end();
}

run().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
