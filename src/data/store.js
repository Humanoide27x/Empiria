const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");

function getFilePath(fileName) {
  return path.join(DATA_DIR, fileName);
}

function ensureFile(fileName, fallbackData) {
  const filePath = getFilePath(fileName);

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallbackData, null, 2));
  }

  return filePath;
}

function readCollection(fileName, fallbackData = []) {
  const filePath = ensureFile(fileName, fallbackData);
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
    if (!raw || !raw.trim()) return fallbackData;
    return JSON.parse(raw);
  } catch (err) {
    // JSON corrupto: renombrar y crear uno limpio
    try {
      const corruptPath = filePath + ".corrupt." + Date.now();
      fs.renameSync(filePath, corruptPath);
      console.error(`[store] ${fileName} corrupto — guardado como ${corruptPath}, creando nuevo`);
    } catch (_) { /* no bloquear si el rename falla */ }
    fs.writeFileSync(filePath, JSON.stringify(fallbackData, null, 2));
    return fallbackData;
  }
}

function writeCollection(fileName, data) {
  const filePath = ensureFile(fileName, data);
  // Escritura atómica: escribir a .tmp y luego renombrar para evitar JSON corrupto
  // en caso de fallo durante la escritura (crash, kill, disco lleno)
  const tmpPath = filePath + ".tmp." + process.pid;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { flush: true });
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    throw err;
  }
  return data;
}

module.exports = {
  readCollection,
  writeCollection,
};
