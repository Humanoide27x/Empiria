const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("railway")
      ? { rejectUnauthorized: false }
      : false,
  });

  try {
    const migrationPath = path.join(
      __dirname,
      "src",
      "db",
      "migrations",
      "030_municipality_normalization.sql"
    );

    const sql = fs.readFileSync(migrationPath, "utf8");

    console.log("🚀 Ejecutando migración...");

    await pool.query(sql);

    console.log("✅ Migración ejecutada correctamente");
  } catch (error) {
    console.error("❌ Error ejecutando migración:");
    console.error(error);
  } finally {
    await pool.end();
  }
}

runMigration();