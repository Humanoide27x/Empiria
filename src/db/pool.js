const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "Empiria2026*",
  database: "empiria_db",
});

pool.on("error", (err) => {
  console.error("Error inesperado en PostgreSQL:", err);
});

async function testConnection() {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT NOW() AS server_time");
    console.log("PostgreSQL conectado:", result.rows[0].server_time);
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  testConnection,
};