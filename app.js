const { createServer } = require("./src/server");
const { testConnection } = require("./src/db/pool");

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await testConnection();

    const server = createServer();

    server.listen(PORT, () => {
      console.log(`EMPIRIA backend activo en http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("No fue posible iniciar EMPIRIA:", error);
    process.exit(1);
  }
}

start();