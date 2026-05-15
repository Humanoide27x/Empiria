const { Pool } = require("pg");

// Railway y la mayoría de PaaS entregan DATABASE_URL.
// Si está presente, se usa directamente; si no, se arman las params individuales.
function buildConfig() {
  const dbUrl = process.env.DATABASE_URL;

  if (dbUrl) {
    return {
      connectionString: dbUrl,
      // Railway usa SSL con certificado auto-firmado en su Postgres.
      // rejectUnauthorized: false acepta esos certs sin instalar la CA.
      ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
      max:                     Number(process.env.DB_POOL_MAX              || 10),
      idleTimeoutMillis:       Number(process.env.DB_IDLE_TIMEOUT_MS       || 30_000),
      connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5_000),
    };
  }

  return {
    host:     String(process.env.DB_HOST     || "localhost"),
    port:     Number(process.env.DB_PORT     || 5432),
    user:     String(process.env.DB_USER     || "postgres"),
    password: String(process.env.DB_PASSWORD || ""),
    database: String(process.env.DB_NAME     || "empiria_db"),
    max:                     Number(process.env.DB_POOL_MAX              || 10),
    idleTimeoutMillis:       Number(process.env.DB_IDLE_TIMEOUT_MS       || 30_000),
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5_000),
  };
}

const pool = new Pool(buildConfig());

pool.on("error", (err) => {
  console.error("[pool] Error inesperado en cliente PostgreSQL:", err.message);
});

module.exports = pool;
