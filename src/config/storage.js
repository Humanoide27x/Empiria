const { S3Client, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
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
async function getPrivateUrl(key, expiresIn = 3600) {
  if (!s3Client || !key) return null;

  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
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

module.exports = {
  s3Client,
  isR2Configured,
  getPublicUrl,
  getPrivateUrl,
  deleteFile,
};
