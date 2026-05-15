// CORS restrictivo:
// - Desarrollo: permite cualquier origen localhost/127.0.0.1
// - Producción: solo los orígenes en CORS_ORIGIN (separados por coma)

const IS_PROD = process.env.NODE_ENV === "production";

const ALLOWED = new Set(
  (process.env.CORS_ORIGIN || "")
    .split(",")
    .map(o => o.trim())
    .filter(Boolean)
);

const DEV_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  let allowed = false;
  if (!IS_PROD) {
    // Dev: mismo host o cualquier localhost
    allowed = !origin || DEV_PATTERN.test(origin);
  } else {
    allowed = origin ? ALLOWED.has(origin) : false;
  }

  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400"); // pre-flight cache 24h

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}

module.exports = { corsMiddleware };
