const crypto = require("crypto");

// Adjunta un ID único a cada request para trazabilidad en logs.
// Si el cliente envía X-Request-ID lo respeta; si no, genera uno nuevo (UUID v4).
function requestId(req, res, next) {
  const id = req.headers["x-request-id"] || crypto.randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-ID", id);
  next();
}

module.exports = { requestId };
