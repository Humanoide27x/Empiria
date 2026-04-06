const { readCollection, writeCollection } = require("./store");

const LOGIN_ATTEMPTS_FILE = "login_attempts.json";

const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MINUTES = 10;
const BLOCK_MINUTES = 15;

function getLoginAttempts() {
  const data = readCollection(LOGIN_ATTEMPTS_FILE, []);
  return Array.isArray(data) ? data : [];
}

function saveLoginAttempts(attempts) {
  return writeCollection(LOGIN_ATTEMPTS_FILE, attempts);
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function getAttemptRecord(username) {
  const normalized = normalizeUsername(username);
  const attempts = getLoginAttempts();

  return attempts.find((item) => item.username === normalized) || null;
}

function isUserBlocked(username) {
  const record = getAttemptRecord(username);

  if (!record || !record.blockedUntil) {
    return {
      blocked: false,
      remainingMs: 0,
      blockedUntil: null,
    };
  }

  const blockedUntilTime = new Date(record.blockedUntil).getTime();
  const now = Date.now();

  if (Number.isNaN(blockedUntilTime) || blockedUntilTime <= now) {
    clearFailedAttempts(username);
    return {
      blocked: false,
      remainingMs: 0,
      blockedUntil: null,
    };
  }

  return {
    blocked: true,
    remainingMs: blockedUntilTime - now,
    blockedUntil: record.blockedUntil,
  };
}

function registerFailedAttempt(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) {
    return null;
  }

  const attempts = getLoginAttempts();
  const now = new Date();
  const nowMs = now.getTime();
  const windowMs = WINDOW_MINUTES * 60 * 1000;
  const blockMs = BLOCK_MINUTES * 60 * 1000;

  const index = attempts.findIndex((item) => item.username === normalized);

  if (index === -1) {
    const newRecord = {
      username: normalized,
      failedCount: 1,
      firstFailedAt: now.toISOString(),
      lastFailedAt: now.toISOString(),
      blockedUntil: null,
    };

    attempts.push(newRecord);
    saveLoginAttempts(attempts);
    return newRecord;
  }

  const record = attempts[index];
  const firstFailedTime = new Date(record.firstFailedAt).getTime();

  if (Number.isNaN(firstFailedTime) || nowMs - firstFailedTime > windowMs) {
    record.failedCount = 1;
    record.firstFailedAt = now.toISOString();
    record.lastFailedAt = now.toISOString();
    record.blockedUntil = null;
  } else {
    record.failedCount += 1;
    record.lastFailedAt = now.toISOString();
  }

  if (record.failedCount >= MAX_FAILED_ATTEMPTS) {
    record.blockedUntil = new Date(nowMs + blockMs).toISOString();
  }

  attempts[index] = record;
  saveLoginAttempts(attempts);

  return record;
}

function clearFailedAttempts(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) {
    return;
  }

  const attempts = getLoginAttempts();
  const filtered = attempts.filter((item) => item.username !== normalized);
  saveLoginAttempts(filtered);
}

function getBlockConfig() {
  return {
    maxFailedAttempts: MAX_FAILED_ATTEMPTS,
    windowMinutes: WINDOW_MINUTES,
    blockMinutes: BLOCK_MINUTES,
  };
}

module.exports = {
  clearFailedAttempts,
  getAttemptRecord,
  getBlockConfig,
  getLoginAttempts,
  isUserBlocked,
  registerFailedAttempt,
};