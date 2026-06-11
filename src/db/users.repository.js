/**
 * Repositorio de usuarios — lee y escribe en PostgreSQL.
 * Reemplaza progresivamente las funciones de src/data/users.js.
 * Mantiene la misma firma de funciones para compatibilidad con auth.controller.js
 */

const crypto = require("crypto");
const pool   = require("./pool");

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, mfa_secret, ...safe } = user;
  const municipalityNames = Array.isArray(safe.municipality_names) ? safe.municipality_names : [];
  const municipalityIds   = Array.isArray(safe.municipality_ids)
    ? safe.municipality_ids.map(Number).filter(n => n > 0)
    : [];
  return {
    ...safe,
    role:                   safe.role_code || safe.role || null,
    companyId:              safe.company_id   ?? null,
    contractId:             safe.contract_id  ?? null,
    mfaEnabled:             safe.mfa_enabled  || false,
    mfaSecret:              undefined,
    municipality_names:     municipalityNames,
    municipality_ids:       municipalityIds,
    assignedMunicipalities: municipalityNames,
  };
}

async function findUserByCredentials(username, password) {
  const passwordHash = hashPassword(password);
  const { rows } = await pool.query(
    `SELECT u.*, r.code as role_from_table,
            COALESCE((
              SELECT ARRAY_AGG(m.name ORDER BY m.name)
              FROM municipalities m
              WHERE m.id = ANY(u.municipality_ids)
            ), ARRAY[]::TEXT[]) AS municipality_names
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE LOWER(u.username) = LOWER($1) AND u.password_hash = $2 AND u.active = true
     LIMIT 1`,
    [username.trim(), passwordHash]
  );
  if (!rows.length) return null;

  const u = rows[0];
  u.role = u.role_code || (u.role_from_table ? u.role_from_table.toLowerCase() : null);
  u.municipality_names = u.municipality_names || [];
  return u;
}

async function findUserById(userId) {
  const { rows } = await pool.query(
    `SELECT u.*, r.code as role_from_table,
            COALESCE((
              SELECT ARRAY_AGG(m.name ORDER BY m.name)
              FROM municipalities m
              WHERE m.id = ANY(u.municipality_ids)
            ), ARRAY[]::TEXT[]) AS municipality_names
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.active = true
     LIMIT 1`,
    [Number(userId)]
  );
  if (!rows.length) return null;

  const u = rows[0];
  u.role = u.role_code || (u.role_from_table ? u.role_from_table.toLowerCase() : null);
  u.municipality_names = u.municipality_names || [];
  return u;
}

async function findUserByUsername(username) {
  const { rows } = await pool.query(
    `SELECT u.*, r.code as role_from_table,
            COALESCE((
              SELECT ARRAY_AGG(m.name ORDER BY m.name)
              FROM municipalities m
              WHERE m.id = ANY(u.municipality_ids)
            ), ARRAY[]::TEXT[]) AS municipality_names
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE LOWER(u.username) = LOWER($1) AND u.active = true
     LIMIT 1`,
    [username.trim()]
  );
  if (!rows.length) return null;

  const u = rows[0];
  u.role = u.role_code || (u.role_from_table ? u.role_from_table.toLowerCase() : null);
  u.municipality_names = u.municipality_names || [];
  return u;
}

async function getUsers() {
  const { rows } = await pool.query(
    `SELECT u.*,
            r.code as role_from_table,
            COALESCE((
              SELECT ARRAY_AGG(m.name ORDER BY m.name)
              FROM municipalities m
              WHERE m.id = ANY(u.municipality_ids)
            ), ARRAY[]::TEXT[]) AS municipality_names
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     ORDER BY u.id`
  );
  return rows.map((u) => {
    u.role             = u.role_code || (u.role_from_table ? u.role_from_table.toLowerCase() : null);
    u.companyId        = u.company_id  ?? null;
    u.contractId       = u.contract_id ?? null;
    u.mfaEnabled       = u.mfa_enabled || false;
    u.name             = u.full_name   || u.name || null;
    u.municipality_names = u.municipality_names || [];
    return u;
  });
}

async function saveMfaSecret(userId, secret) {
  const { rows } = await pool.query(
    `UPDATE users SET mfa_secret = $1, mfa_enabled = false, mfa_confirmed_at = NULL, updated_at = NOW()
     WHERE id = $2 RETURNING id`,
    [secret, Number(userId)]
  );
  if (!rows.length) throw new Error("Usuario no encontrado");
}

async function enableMfaForUser(userId) {
  const { rows } = await pool.query(
    `UPDATE users SET mfa_enabled = true, mfa_confirmed_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND mfa_secret IS NOT NULL RETURNING id`,
    [Number(userId)]
  );
  if (!rows.length) throw new Error("Usuario no encontrado o sin secreto MFA");
}

async function disableMfaForUser(userId) {
  await pool.query(
    `UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_confirmed_at = NULL, updated_at = NOW()
     WHERE id = $1`,
    [Number(userId)]
  );
}

async function resetMfaForUser(userId) {
  await disableMfaForUser(userId);
}

async function createUser(payload) {
  const username = String(payload.username || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const name     = String(payload.name || "").trim();
  const role     = String(payload.role || "").trim().toLowerCase();

  if (!username || !password || !name || !role) {
    throw new Error("Faltan datos obligatorios del usuario");
  }

  const existing = await findUserByUsername(username);
  if (existing) throw new Error("El nombre de usuario ya existe");

  // Obtener role_id por code
  const roleRow = await pool.query(
    "SELECT id FROM roles WHERE LOWER(code) = LOWER($1) LIMIT 1",
    [role]
  );
  const roleId = roleRow.rows[0]?.id || null;

  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, full_name, role_id, role_code, company_id, contract_id, tenant_id, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,true) RETURNING *`,
    [
      username,
      hashPassword(password),
      name,
      roleId,
      role,
      payload.companyId ? Number(payload.companyId) : null,
      payload.contractId ? Number(payload.contractId) : null,
    ]
  );

  rows[0].role = role;
  return sanitizeUser(rows[0]);
}

async function updateUser(userId, payload) {
  const user = await findUserById(userId);
  if (!user) throw new Error("Usuario no encontrado");

  const updates = [];
  const values  = [];
  let   idx     = 1;

  if (payload.username) {
    updates.push(`username = $${idx++}`);
    values.push(payload.username.trim().toLowerCase());
  }
  if (payload.name) {
    updates.push(`full_name = $${idx++}`);
    values.push(payload.name.trim());
  }
  if (payload.password) {
    updates.push(`password_hash = $${idx++}`);
    values.push(hashPassword(payload.password));
  }
  if (payload.role) {
    const roleRow = await pool.query("SELECT id FROM roles WHERE LOWER(code) = LOWER($1) LIMIT 1", [payload.role]);
    if (roleRow.rows[0]) {
      updates.push(`role_id = $${idx++}`);
      values.push(roleRow.rows[0].id);
      updates.push(`role_code = $${idx++}`);
      values.push(payload.role.toLowerCase());
    }
  }
  if (payload.companyId !== undefined) {
    updates.push(`company_id = $${idx++}`);
    values.push(payload.companyId ? Number(payload.companyId) : null);
  }
  if (payload.contractId !== undefined) {
    updates.push(`contract_id = $${idx++}`);
    values.push(payload.contractId ? Number(payload.contractId) : null);
  }
  if (payload.mfaEnabled !== undefined) {
    updates.push(`mfa_enabled = $${idx++}`);
    values.push(Boolean(payload.mfaEnabled));
  }

  if (!updates.length) return sanitizeUser(user);

  updates.push(`updated_at = NOW()`);
  values.push(Number(userId));

  const { rows } = await pool.query(
    `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );

  rows[0].role = rows[0].role_code || user.role;
  return sanitizeUser(rows[0]);
}

module.exports = {
  createUser,
  disableMfaForUser,
  enableMfaForUser,
  findUserByCredentials,
  findUserById,
  findUserByUsername,
  getUsers,
  hashPassword,
  resetMfaForUser,
  sanitizeUser,
  saveMfaSecret,
  updateUser,
};
