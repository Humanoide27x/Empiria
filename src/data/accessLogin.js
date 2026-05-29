const { readCollection, writeCollection } = require("./store");

const ACCESS_LOGS_FILE = "access_logs.json";

function getAccessLogs() {
  const logs = readCollection(ACCESS_LOGS_FILE, []);
  return Array.isArray(logs) ? logs : [];
}

function saveAccessLogs(logs) {
  return writeCollection(ACCESS_LOGS_FILE, logs);
}

function createAccessLog(payload) {
  try {
    const logs = getAccessLogs();

    const nextId = logs.length
      ? Math.max(...logs.map((item) => item.id || 0)) + 1
      : 1;

    const log = {
      id: nextId,
      username: payload.username || "",
      userId: payload.userId ?? null,
      role: payload.role || null,
      success: typeof payload.success === "boolean" ? payload.success : false,
      status: payload.status || "failed",
      reason: payload.reason || "",
      ip: payload.ip || "",
      userAgent: payload.userAgent || "",
      createdAt: new Date().toISOString(),
    };

    logs.push(log);
    saveAccessLogs(logs);
    return log;
  } catch (err) {
    // El log de acceso es secundario — nunca debe tumbar la operación principal
    console.error("[access-log] no se pudo guardar:", err.message);
    return null;
  }
}

module.exports = {
  createAccessLog,
  getAccessLogs,
};