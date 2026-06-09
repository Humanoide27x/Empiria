const {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

function isR2Configured() {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

// El cliente se construye una sola vez al cargar el módulo.
// Si R2 no está configurado, s3Client = null y las funciones degradan
// silenciosamente al almacenamiento local.
const s3Client = isR2Configured()
  ? new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

/**
 * URL pública directa (solo para archivos no sensibles, e.g. avatares o logos).
 * No usar para documentos de empleados — usa getPrivateUrl para esos.
 */
function getPublicUrl(key) {
  if (!key) return null;
  const base = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
  return `${base}/${key}`;
}

/**
 * URL pre-firmada con expiración. Usar siempre para documentos de empleados.
 * Devuelve null si R2 no está configurado o la key es vacía.
 */
async function getPrivateUrl(key, expiresIn = 3600, options = {}) {
  if (!s3Client || !key) return null;

  const normalizedOptions = typeof expiresIn === "object" && expiresIn !== null
    ? expiresIn
    : options;
  const ttl = typeof expiresIn === "object" && expiresIn !== null
    ? Number(normalizedOptions.expiresIn) || 3600
    : Number(expiresIn) || 3600;

  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ResponseContentDisposition: normalizedOptions.responseContentDisposition || undefined,
    ResponseContentType: normalizedOptions.responseContentType || undefined,
  });

  return getSignedUrl(s3Client, command, { expiresIn: ttl });
}

/**
 * Elimina un objeto de R2.
 * Devuelve false si R2 no está disponible (no lanza).
 */
async function deleteFile(key) {
  if (!s3Client || !key) return false;

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    })
  );
  return true;
}

async function putFile(key, body, contentType = "application/octet-stream") {
  if (!s3Client || !key) return false;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return true;
}

async function fileExists(key) {
  if (!key) return false;
  if (!s3Client) return false;

  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
      })
    );
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  s3Client,
  isR2Configured,
  getPublicUrl,
  getPrivateUrl,
  deleteFile,
  putFile,
  fileExists,
};
