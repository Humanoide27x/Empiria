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
  const raw = fs.readFileSync(filePath, "utf8");

  return JSON.parse(raw);
}

function writeCollection(fileName, data) {
  const filePath = ensureFile(fileName, data);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return data;
}

module.exports = {
  readCollection,
  writeCollection,
};
