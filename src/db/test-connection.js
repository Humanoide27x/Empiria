const pool = require("./pool");

async function testConnection() {
  try {
    const result = await pool.query("SELECT NOW() AS current_time");
    console.log("Conexion PostgreSQL OK");
    console.log(result.rows[0]);
    process.exit(0);
  } catch (error) {
    console.error("Error conectando a PostgreSQL:");
    console.error(error.message);
    process.exit(1);
  }
}

testConnection();