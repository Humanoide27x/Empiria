const pool = require("../../db/pool");

function mapCorrection(row) {
  return {
    id:              row.id,
    periodId:        row.period_id,
    periodLabel:     row.period_label || null,
    employeeId:      row.employee_id,
    employeeName:    row.employee_name,
    tipo:            row.tipo,
    concepto:        row.concepto,
    valorCalculado:  Number(row.valor_calculado),
    valorCorrecto:   Number(row.valor_correcto),
    diferencia:      Number(row.diferencia),
    impacto:         row.impacto,
    estado:          row.estado,
    observaciones:   row.observaciones || null,
    comoSeResolvio:  row.como_se_resolvio || null,
    createdBy:       row.created_by,
    createdByName:   row.created_by_name || null,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
    updatedByName:   row.updated_by_name || null,
  };
}

async function listCorrections({ periodId, estado, employeeId } = {}) {
  const conditions = [];
  const values = [];

  if (periodId) {
    values.push(Number(periodId));
    conditions.push(`pc.period_id = $${values.length}`);
  }
  if (estado) {
    values.push(estado);
    conditions.push(`pc.estado = $${values.length}`);
  }
  if (employeeId) {
    values.push(String(employeeId));
    conditions.push(`pc.employee_id = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT pc.*, pp.label AS period_label
       FROM payroll_corrections pc
       LEFT JOIN payroll_periods pp ON pp.id = pc.period_id
     ${where}
     ORDER BY pc.created_at DESC, pc.id DESC`,
    values
  );
  return result.rows.map(mapCorrection);
}

async function getCorrectionById(id) {
  const result = await pool.query(
    `SELECT pc.*, pp.label AS period_label
       FROM payroll_corrections pc
       LEFT JOIN payroll_periods pp ON pp.id = pc.period_id
      WHERE pc.id = $1`,
    [Number(id)]
  );
  return result.rows[0] ? mapCorrection(result.rows[0]) : null;
}

async function createCorrection({ periodId, employeeId, employeeName, tipo, concepto, valorCalculado, valorCorrecto, impacto, observaciones, createdBy, createdByName }) {
  const result = await pool.query(
    `INSERT INTO payroll_corrections
       (period_id, employee_id, employee_name, tipo, concepto,
        valor_calculado, valor_correcto, impacto, observaciones,
        created_by, created_by_name, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     RETURNING id`,
    [
      periodId ? Number(periodId) : null,
      String(employeeId),
      String(employeeName),
      String(tipo),
      String(concepto),
      Number(valorCalculado) || 0,
      Number(valorCorrecto)  || 0,
      String(impacto || "sin_impacto"),
      observaciones || null,
      createdBy  ? Number(createdBy)  : null,
      createdByName || null,
    ]
  );
  return getCorrectionById(result.rows[0].id);
}

async function updateCorrectionStatus(id, estado, { userId, userName, comoSeResolvio, observaciones } = {}) {
  const VALID = ["pendiente", "en_revision", "aprobada", "aplicada", "rechazada"];
  if (!VALID.includes(estado)) throw new Error(`Estado inválido: "${estado}"`);
  if (estado === "aplicada" && !comoSeResolvio?.trim()) {
    throw new Error("El campo '¿Cómo se resolvió?' es obligatorio al marcar como Aplicada.");
  }

  const sets = [
    "estado = $2",
    "updated_at = NOW()",
    "updated_by = $3",
    "updated_by_name = $4",
  ];
  const values = [Number(id), estado, userId ? Number(userId) : null, userName || null];

  if (comoSeResolvio !== undefined) {
    values.push(comoSeResolvio || null);
    sets.push(`como_se_resolvio = $${values.length}`);
  }
  if (observaciones !== undefined) {
    values.push(observaciones || null);
    sets.push(`observaciones = $${values.length}`);
  }

  const result = await pool.query(
    `UPDATE payroll_corrections SET ${sets.join(", ")} WHERE id = $1 RETURNING id`,
    values
  );
  if (!result.rows[0]) return null;
  return getCorrectionById(id);
}

async function updateCorrectionObservaciones(id, observaciones, { userId, userName } = {}) {
  const result = await pool.query(
    `UPDATE payroll_corrections
        SET observaciones   = $2,
            updated_at      = NOW(),
            updated_by      = $3,
            updated_by_name = $4
      WHERE id = $1
      RETURNING id`,
    [Number(id), observaciones || null, userId ? Number(userId) : null, userName || null]
  );
  return result.rows[0] ? getCorrectionById(id) : null;
}

async function getSummary({ periodId } = {}) {
  const cond = periodId ? "WHERE period_id = $1" : "";
  const vals = periodId ? [Number(periodId)] : [];
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE estado = 'pendiente')::int AS pendientes,
       COUNT(*) FILTER (WHERE estado = 'en_revision')::int AS en_revision,
       COUNT(*) FILTER (WHERE estado = 'aplicada')::int AS aplicadas,
       COUNT(*) FILTER (WHERE estado = 'rechazada')::int AS rechazadas,
       COALESCE(SUM(diferencia) FILTER (WHERE estado NOT IN ('rechazada')), 0) AS diferencia_total
     FROM payroll_corrections ${cond}`,
    vals
  );
  return result.rows[0] || {};
}

module.exports = {
  listCorrections,
  getCorrectionById,
  createCorrection,
  updateCorrectionStatus,
  updateCorrectionObservaciones,
  getSummary,
};
