const { Pool } = require("pg");

const pool = new Pool({
  host: String(process.env.DB_HOST || "localhost"),
  port: Number(process.env.DB_PORT || 5432),
  user: String(process.env.DB_USER || "postgres"),
  password: String(process.env.DB_PASSWORD || ""),
  database: String(process.env.DB_NAME || "empiria_db"),
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
});

pool.on("error", (error) => {
  console.error("Error inesperado en PostgreSQL:", error);
});

module.exports = pool;