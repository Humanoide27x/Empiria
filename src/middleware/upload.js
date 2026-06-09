const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const multer = require("multer");
const { s3Client, isR2Configured } = require("../config/storage");

const DEFAULT_ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".xlsx", ".docx"]);
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB

function buildFileFilter(allowedExt = DEFAULT_ALLOWED_EXT) {
  const allowed = new Set((Array.isArray(allowedExt) ? allowedExt : [...allowedExt]).map((value) => String(value || "").toLowerCase()));
  return function fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.has(ext)) {
      const err = new Error(
        `Tipo de archivo no permitido: "${ext}". Permitidos: ${[...allowed].join(", ")}`
      );
      err.status = 400;
      return cb(err, false);
    }
    cb(null, true);
  };
}

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!DEFAULT_ALLOWED_EXT.has(ext)) {
    const err = new Error(
      `Tipo de archivo no permitido: "${ext}". Permitidos: ${[...DEFAULT_ALLOWED_EXT].join(", ")}`
    );
    err.status = 400;
    return cb(err, false);
  }
  cb(null, true);
}

/**
 * Fábrica de middleware multer.
 *
 * @param {string} folder  Prefijo del path en R2 / carpeta local (ej: "documents", "novedades")
 * @returns Express middleware multer (.single("file") o .array(...))
 *
 * Key en R2:   {folder}/{company_id}/{YYYY-MM-DD}/{8-byte-hex}{ext}
 * Ruta local:  uploads/{folder}/{8-byte-hex}{ext}   (fallback sin R2)
 */
function upload(folder, options = {}) {
  const allowedExt = options.allowedExtensions || DEFAULT_ALLOWED_EXT;
  const maxSize = Number(options.maxSize) > 0 ? Number(options.maxSize) : DEFAULT_MAX_SIZE;
  const filter = options.fileFilter || buildFileFilter(allowedExt);
  if (isR2Configured()) {
    const multerS3 = require("multer-s3");

    return multer({
      storage: multerS3({
        s3: s3Client,
        bucket: process.env.R2_BUCKET_NAME,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key(req, file, cb) {
          const companyId = req.user?.companyId || "shared";
          const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
          const ext = path.extname(file.originalname).toLowerCase();
          const hash = crypto.randomBytes(8).toString("hex");
          cb(null, `${folder}/${companyId}/${date}/${hash}${ext}`);
        },
      }),
      limits: { fileSize: maxSize },
      fileFilter: filter,
    });
  }

  // ── Fallback: disco local ──────────────────────────────────────────────────
  const localDir = path.resolve(process.cwd(), "uploads", folder);
  if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

  return multer({
    storage: multer.diskStorage({
      destination(req, file, cb) {
        cb(null, localDir);
      },
      filename(req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const hash = crypto.randomBytes(8).toString("hex");
        cb(null, `${hash}${ext}`);
      },
    }),
    limits: { fileSize: maxSize },
    fileFilter: filter,
  });
}

/**
 * Normaliza req.file (R2 vs disco local) a un objeto uniforme:
 * { key, fileName, fileSize, isLocal }
 *
 * key:      ruta relativa usada para almacenar/recuperar el archivo
 * fileName: nombre original limpio
 * fileSize: bytes
 * isLocal:  true si está en disco local (no en R2)
 */
function normalizeUploadedFile(file) {
  if (!file) return null;

  const isR2 = Boolean(file.key); // multer-s3 pone .key; disco local pone .filename
  const storedFileName = isR2
    ? path.basename(file.key)
    : file.filename;
  return {
    key: isR2 ? file.key : `${path.basename(path.dirname(file.path))}/${file.filename}`,
    fileName: file.originalname,
    storedFileName,
    fileSize: file.size,
    isLocal: !isR2,
  };
}

module.exports = { upload, normalizeUploadedFile };
