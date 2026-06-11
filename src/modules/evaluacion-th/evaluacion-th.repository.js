"use strict";

const pool = require("../../db/pool");

// ── Helper: obtener IDs de municipio para un coordinador ──────────────────────
// Fuente primaria: columna municipality_ids de la tabla users (misma fuente que
// usa withModuleProtection en el resto del sistema).
// Fuente secundaria: tabla user_municipalities (compatibilidad legacy).
// Fallback final: todos los municipios con operarios activos (solo si no hay asignación).
async function _resolveMunicipalityIds(coordinadorId, companyId) {
  // 1. Columna municipality_ids en users (fuente canónica del sistema)
  const { rows: userRows } = await pool.query(
    `SELECT municipality_ids FROM users WHERE id = $1 AND active = true LIMIT 1`,
    [Number(coordinadorId)]
  );
  if (userRows.length) {
    const ids = Array.isArray(userRows[0].municipality_ids)
      ? userRows[0].municipality_ids.map(Number).filter(n => n > 0)
      : [];
    if (ids.length) return ids;
  }

  // 2. Tabla user_municipalities (compatibilidad con asignaciones legacy)
  const { rows: umRows } = await pool.query(
    `SELECT municipality_id FROM user_municipalities WHERE user_id = $1`,
    [Number(coordinadorId)]
  );
  if (umRows.length) {
    return umRows.map((r) => r.municipality_id);
  }

  // 3. Fallback: todos los municipios con operarios activos en la empresa
  const { rows: allMuns } = await pool.query(
    `SELECT DISTINCT municipality_id
     FROM employees
     WHERE real_position ILIKE '%OPERARIO MANIPULADOR DE ALIMENTOS%'
       AND status = 'ACTIVO'
       AND municipality_id IS NOT NULL
       AND ($1::int IS NULL OR company_id = $1)`,
    [companyId ?? null]
  );

  return allMuns.map((r) => r.municipality_id);
}

/**
 * Devuelve todos los usuarios con role_code = 'talento_humano' activos,
 * con sus municipality_ids desde la tabla user_municipalities.
 */
async function getCoordinadoresTH(companyId) {
  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.full_name                                                                AS name,
       COALESCE(u.email, '')                                                      AS email,
       COALESCE(u.username, '')                                                   AS username,
       -- Fuente canónica: columna municipality_ids en users (misma que usa el resto del sistema)
       COALESCE(u.municipality_ids, ARRAY[]::INTEGER[])                           AS municipality_ids,
       COALESCE((
         SELECT ARRAY_AGG(m.name ORDER BY m.name)
         FROM municipalities m
         WHERE m.id = ANY(u.municipality_ids)
       ), ARRAY[]::TEXT[])                                                        AS municipality_names
     FROM users u
     WHERE u.role_code = 'talento_humano'
       AND u.active = true
       AND ($1::int IS NULL OR u.company_id = $1)
     ORDER BY u.full_name`,
    [companyId ?? null]
  );
  return rows;
}

/**
 * Métricas agregadas para un coordinador.
 * Si municipality_ids está vacío, usa todos los municipios con operarios activos
 * en la empresa (fallback para coordinadores sin asignación explícita).
 */
async function getMetricasCoordinador(municipalityIds, companyId) {
  let mids = Array.isArray(municipalityIds) && municipalityIds.length
    ? municipalityIds
    : null;

  if (!mids) {
    const { rows: allMuns } = await pool.query(
      `SELECT DISTINCT municipality_id FROM employees
       WHERE real_position ILIKE '%OPERARIO MANIPULADOR DE ALIMENTOS%'
         AND status = 'ACTIVO'
         AND municipality_id IS NOT NULL
         AND ($1::int IS NULL OR company_id = $1)`,
      [companyId ?? null]
    );
    mids = allMuns.map((r) => r.municipality_id);
  }

  if (!mids.length) {
    return {
      empleados_cargo: 0,
      docs_completados: 0,
      docs_requeridos: 0,
      datos_actualizados: 0,
      periodos_total: 0,
      periodos_procesados: 0,
    };
  }

  const { rows } = await pool.query(
    `WITH
      emp AS (
        SELECT id, updated_at
        FROM employees
        WHERE municipality_id = ANY($1::int[])
          AND status = 'ACTIVO'
          AND real_position ILIKE '%OPERARIO MANIPULADOR DE ALIMENTOS%'
          AND ($2::int IS NULL OR company_id = $2)
      ),
      emp_count AS (SELECT COUNT(*)::int AS total FROM emp),
      docs_completados AS (
        SELECT COUNT(*)::int AS count
        FROM employee_documents ed
        WHERE ed.employee_id IN (SELECT id FROM emp)
          AND ed.deleted_at IS NULL
          AND UPPER(TRIM(COALESCE(ed.status, ''))) NOT IN ('DELETED')
      ),
      req_types AS (
        SELECT COUNT(*)::int AS count FROM document_types WHERE active = true
      ),
      actualizados AS (
        SELECT COUNT(*)::int AS count FROM emp
        WHERE updated_at >= NOW() - INTERVAL '30 days'
      ),
      periodos AS (
        SELECT
          COUNT(*)::int                                                          AS total,
          COUNT(CASE WHEN pp.status IN ('CALCULADO','CERRADO') THEN 1 END)::int AS procesados
        FROM payroll_periods pp
        WHERE ($2::int IS NULL OR pp.company_id = $2)
          AND pp.period_start >= (NOW() - INTERVAL '6 months')::date
      )
    SELECT
      ec.total                         AS empleados_cargo,
      dc.count                         AS docs_completados,
      GREATEST(ec.total * rt.count, 0) AS docs_requeridos,
      a.count                          AS datos_actualizados,
      p.total                          AS periodos_total,
      p.procesados                     AS periodos_procesados
    FROM emp_count ec, docs_completados dc, req_types rt, actualizados a, periodos p`,
    [mids, companyId ?? null]
  );

  return rows[0] ?? {
    empleados_cargo: 0,
    docs_completados: 0,
    docs_requeridos: 0,
    datos_actualizados: 0,
    periodos_total: 0,
    periodos_procesados: 0,
  };
}

/**
 * Detalle por municipio de un coordinador dado su user_id.
 */
async function getDetalleMunicipios(coordinadorId, companyId) {
  const ids = await _resolveMunicipalityIds(coordinadorId, companyId);
  if (!ids.length) return [];

  const { rows } = await pool.query(
    `SELECT
       m.id                                                               AS municipio_id,
       m.name                                                             AS municipio,
       COUNT(e.id)::int                                                   AS empleados,
       COALESCE(
         (SELECT COUNT(*)::int
          FROM employee_documents ed
          WHERE ed.employee_id IN (
            SELECT id FROM employees
            WHERE municipality_id = m.id
              AND status = 'ACTIVO'
              AND real_position ILIKE '%OPERARIO MANIPULADOR DE ALIMENTOS%'
              AND ($2::int IS NULL OR company_id = $2)
          )
            AND ed.deleted_at IS NULL
            AND UPPER(TRIM(COALESCE(ed.status,''))) NOT IN ('DELETED')
         ), 0
       )                                                                  AS docs_completados,
       COALESCE(
         (SELECT COUNT(*)::int FROM document_types WHERE active = true)
         * COUNT(e.id)::int, 0
       )                                                                  AS docs_requeridos,
       MAX(e.updated_at)                                                  AS ultima_actualizacion
     FROM municipalities m
     LEFT JOIN employees e
       ON e.municipality_id = m.id
       AND e.status = 'ACTIVO'
       AND e.real_position ILIKE '%OPERARIO MANIPULADOR DE ALIMENTOS%'
       AND ($2::int IS NULL OR e.company_id = $2)
     WHERE m.id = ANY($1::int[])
     GROUP BY m.id, m.name
     ORDER BY COUNT(e.id) DESC, m.name`,
    [ids, companyId ?? null]
  );

  return rows.map((r) => {
    const pct = r.docs_requeridos > 0
      ? Math.min(100, Math.round((r.docs_completados / r.docs_requeridos) * 100))
      : 0;
    const estado = r.empleados === 0 ? "Sin empleados"
      : pct >= 90 ? "Óptimo"
      : pct >= 60 ? "En progreso"
      : "Atención";
    return { ...r, porcentaje_docs: pct, estado };
  });
}

/**
 * Municipios con docs_faltantes calculados.
 */
async function getMunicipiosByCoordinador(coordinadorId, companyId) {
  const detalle = await getDetalleMunicipios(coordinadorId, companyId);
  return detalle.map((r) => ({
    ...r,
    docs_faltantes: Math.max(0, (r.docs_requeridos || 0) - (r.docs_completados || 0)),
    estado: r.empleados === 0 ? "Sin empleados"
          : r.porcentaje_docs >= 90 ? "Completo"
          : r.porcentaje_docs >= 60 ? "En progreso"
          : "Crítico",
  }));
}

/**
 * Empleados de un municipio con sus documentos faltantes.
 */
async function getDocumentosFaltantesByMunicipio(municipioId, companyId) {
  const { rows } = await pool.query(
    `SELECT
       e.id                                                                    AS employee_id,
       e.full_name                                                             AS empleado,
       COUNT(dt.id) FILTER (
         WHERE NOT EXISTS (
           SELECT 1 FROM employee_documents ed
           WHERE ed.employee_id = e.id
             AND ed.document_type_id = dt.id
             AND ed.deleted_at IS NULL
             AND UPPER(TRIM(COALESCE(ed.status,''))) NOT IN ('DELETED')
         )
       )::int                                                                  AS total_faltantes,
       COALESCE(
         ARRAY_AGG(dt.name ORDER BY dt.name) FILTER (
           WHERE NOT EXISTS (
             SELECT 1 FROM employee_documents ed
             WHERE ed.employee_id = e.id
               AND ed.document_type_id = dt.id
               AND ed.deleted_at IS NULL
               AND UPPER(TRIM(COALESCE(ed.status,''))) NOT IN ('DELETED')
           )
         ), ARRAY[]::TEXT[]
       )                                                                       AS documentos_faltantes
     FROM employees e
     CROSS JOIN document_types dt
     WHERE e.municipality_id = $1
       AND e.status = 'ACTIVO'
       AND e.real_position ILIKE '%OPERARIO MANIPULADOR DE ALIMENTOS%'
       AND ($2::int IS NULL OR e.company_id = $2)
       AND dt.active = true
     GROUP BY e.id, e.full_name
     ORDER BY total_faltantes DESC, e.full_name`,
    [Number(municipioId), companyId ?? null]
  );
  return rows;
}

module.exports = {
  getCoordinadoresTH,
  getMetricasCoordinador,
  getDetalleMunicipios,
  getMunicipiosByCoordinador,
  getDocumentosFaltantesByMunicipio,
};
