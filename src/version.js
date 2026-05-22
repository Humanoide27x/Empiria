"use strict";

const { execSync } = require("child_process");

function resolveVersion() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;

  try {
    const hash = execSync("git rev-parse --short=8 HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
    if (/^[0-9a-f]{6,12}$/i.test(hash)) return hash;
  } catch { /* git no disponible en este entorno */ }

  // Fallback: timestamp compacto (cambia en cada reinicio/deploy)
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
  ].join("");
}

const APP_VERSION = resolveVersion();

module.exports = { APP_VERSION };
