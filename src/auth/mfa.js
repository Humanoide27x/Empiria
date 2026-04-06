const speakeasy = require("speakeasy");
const QRCode = require("qrcode");

// Generar secreto MFA
function generateMfaSecret(username) {
  const secret = speakeasy.generateSecret({
    name: `Empiria (${username})`,
  });

  return {
    secret: secret.base32,
    otpauth_url: secret.otpauth_url,
  };
}

// Generar QR en base64
async function generateQrCode(otpauthUrl) {
  return await QRCode.toDataURL(otpauthUrl);
}

// Validar código MFA
function verifyMfaToken(secret, token) {
  return speakeasy.totp({
    secret,
    encoding: "base32",
    token,
    window: 1,
  });
}

module.exports = {
  generateMfaSecret,
  generateQrCode,
  verifyMfaToken,
};