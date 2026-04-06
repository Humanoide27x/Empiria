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
    status: payload.status || "failed", // success | failed | pending_mfa
    reason: payload.reason || "",
    ip: payload.ip || "",
    userAgent: payload.userAgent || "",
    createdAt: new Date().toISOString(),
  };

  logs.push(log);
  saveAccessLogs(logs);

  return log;
}

module.exports = {
  createAccessLog,
  getAccessLogs,
};