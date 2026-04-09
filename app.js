require("dotenv").config();

const { createServer } = require("./src/server");
const pool = require("./src/db/pool");

async function start() {
  try {
    const result = await pool.query("SELECT NOW() AS current_time");
    console.log("PostgreSQL conectado:", result.rows[0].current_time);

    const PORT = process.env.PORT || 3000;
    const server = createServer();

    server.listen(PORT, () => {
      console.log(`EMPIRIA ejecutándose en http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("No fue posible iniciar EMPIRIA:", error);
    process.exit(1);
  }
}

start();