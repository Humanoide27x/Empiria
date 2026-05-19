const { Pool, types } = require("pg");

types.setTypeParser(1082, v => v);
types.setTypeParser(1114, v => v);
types.setTypeParser(1184, v => v);

function buildConfig() {
  const dbUrl = process.env.DATABASE_URL;

  console.log("[db] DATABASE_URL EXISTS:", !!dbUrl);
  console.log("[db] DATABASE_URL PREFIX:", dbUrl ? dbUrl.slice(0, 55) : "NO_DATABASE_URL");

  if (dbUrl) {
    return {
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000),
      connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5_000),
    };
  }

  console.log("[db] USING LOCAL FALLBACK:", {
    host: process.env.DB_HOST || "localhost",
    database: process.env.DB_NAME || "empiria_db",
  });

  return {
    host: String(process.env.DB_HOST || "localhost"),
    port: Number(process.env.DB_PORT || 5432),
    user: String(process.env.DB_USER || "postgres"),
    password: String(process.env.DB_PASSWORD || ""),
    database: String(process.env.DB_NAME || "empiria_db"),
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000),
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5_000),
  };
}

const pool = new Pool(buildConfig());

pool.on("error", (err) => {
  console.error("[pool] Error inesperado en cliente PostgreSQL:", err.message);
});

module.exports = pool;