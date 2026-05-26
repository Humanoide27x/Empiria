const pool = require("../../db/pool");

let _usersTableExists = null;
let _warnedMissingUsersTable = false;

function isMissingUsersRelationError(err) {
  return /relation\s+"?users"?\s+does\s+not\s+exist/i.test(String(err?.message || ""));
}

async function usersTableExists() {
  if (_usersTableExists !== null) return _usersTableExists;
  try {
    const result = await pool.query(`SELECT to_regclass('public.users') AS reg`);
    _usersTableExists = Boolean(result.rows[0]?.reg);
  } catch (err) {
    if (isMissingUsersRelationError(err)) {
      _usersTableExists = false;
    } else {
      throw err;
    }
  }
  if (!_usersTableExists && !_warnedMissingUsersTable) {
    console.warn("[employee_drafts] Tabla users no disponible; created_by/updated_by se guardarán en null.");
    _warnedMissingUsersTable = true;
  }
  return _usersTableExists;
}

async function resolveDraftUserId(userId) {
  const safeUserId = Number(userId) || null;
  if (!safeUserId) return null;
  if (!(await usersTableExists())) return null;
  const result = await pool.query(`SELECT id FROM users WHERE id = $1 LIMIT 1`, [safeUserId]);
  return result.rows[0]?.id || null;
}

async function saveDraft({
  employeeId,
  draftKey,
  sectionKey,
  data,
  progress,
  userId,
}) {
  const safeUserId = await resolveDraftUserId(userId);

  const result = await pool.query(
    `
    INSERT INTO employee_drafts (
      employee_id,
      draft_key,
      section_key,
      data,
      progress,
      status,
      created_by,
      updated_by,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4::jsonb,
      $5,
      'borrador',
      $6,
      $6,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (draft_key, section_key)
    DO UPDATE SET
      employee_id = EXCLUDED.employee_id,
      data = EXCLUDED.data,
      progress = EXCLUDED.progress,
      updated_by = $6,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *;
    `,
    [
      employeeId || null,
      draftKey,
      sectionKey,
      JSON.stringify(data || {}),
      Number(progress || 0),
      safeUserId,
    ]
  );

  return result.rows[0];
}

async function getDraftsByEmployee(employeeId) {
  const result = await pool.query(
    `
    SELECT section_key, data
    FROM employee_drafts
    WHERE employee_id = $1
    `,
    [employeeId]
  );

  const merged = {};

  for (const row of result.rows) {
    Object.assign(merged, row.data);
  }

  return merged;
}

module.exports = {
  saveDraft,
  getDraftsByEmployee,
};
