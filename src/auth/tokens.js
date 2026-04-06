const crypto = require("crypto");

const activeSessions = new Map();

function createToken() {
  return crypto.randomBytes(24).toString("hex");
}

function createSession(user) {
  const token = createToken();

  activeSessions.set(token, {
    userId: user.id,
    createdAt: new Date().toISOString(),
  });

  return token;
}

function getSession(token) {
  return activeSessions.get(token) || null;
}

function removeSession(token) {
  activeSessions.delete(token);
}

module.exports = {
  createSession,
  getSession,
  removeSession,
};
