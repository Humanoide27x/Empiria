const pool = require("../../db/pool");

async function saveDraft({
  employeeId,
  draftKey,
  sectionKey,
  data,
  progress,
  userId,
}) {
  const safeUserId = Number(userId) || null;

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
      (SELECT id FROM users WHERE id = $6 LIMIT 1),
      (SELECT id FROM users WHERE id = $6 LIMIT 1),
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (draft_key, section_key)
    DO UPDATE SET
      employee_id = EXCLUDED.employee_id,
      data = EXCLUDED.data,
      progress = EXCLUDED.progress,
      updated_by = (SELECT id FROM users WHERE id = $6 LIMIT 1),
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