const pool = require("./pool");

// Auto-migrations: nuevas columnas de seguimiento
[
  `ALTER TABLE dotacion_remisiones ADD COLUMN IF NOT EXISTS fecha_enviado   DATE`,
  `ALTER TABLE dotacion_remisiones ADD COLUMN IF NOT EXISTS fecha_recibido  DATE`,
  `ALTER TABLE dotacion_remisiones ADD COLUMN IF NOT EXISTS comprobante_enviado  TEXT`,
  `ALTER TABLE dotacion_remisiones ADD COLUMN IF NOT EXISTS comprobante_recibido TEXT`,
].forEach(q => pool.query(q).catch(err => console.warn("[dotacion migration]", err.message)));

// ── Catálogo ──────────────────────────────────────────────────────────────────

async function getCatalogo(filters = {}) {
  let query = `
    SELECT id, nombre, categoria, descripcion, requiere_talla,
           periodicidad_meses, activo, company_id, contract_id,
           created_at, updated_at
    FROM dotacion_catalogo
    WHERE 1=1
  `;
  const params = [];

  if (filters.companyId) {
    params.push(filters.companyId);
    query += ` AND company_id = $${params.length}`;
  }
  if (filters.contractId) {
    params.push(filters.contractId);
    query += ` AND contract_id = $${params.length}`;
  }
  if (!filters.includeInactive) {
    query += ` AND activo = true`;
  }

  query += ` ORDER BY categoria, nombre`;

  const result = await pool.query(query, params);
  return result.rows;
}

async function createCatalogoItem(data) {
  const query = `
    INSERT INTO dotacion_catalogo
      (nombre, categoria, descripcion, requiere_talla, periodicidad_meses, company_id, contract_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;
  const result = await pool.query(query, [
    data.nombre,
    data.categoria || null,
    data.descripcion || null,
    data.requiere_talla ?? false,
    data.periodicidad_meses || null,
    data.company_id,
    data.contract_id,
  ]);
  return result.rows[0];
}

async function updateCatalogoItem(id, data) {
  const fields = [];
  const params = [];

  const allowed = ["nombre", "categoria", "descripcion", "requiere_talla", "periodicidad_meses", "activo"];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      params.push(data[key]);
      fields.push(`${key} = $${params.length}`);
    }
  }

  if (!fields.length) return null;

  params.push(id);
  const query = `
    UPDATE dotacion_catalogo
    SET ${fields.join(", ")}, updated_at = NOW()
    WHERE id = $${params.length}
    RETURNING *
  `;
  const result = await pool.query(query, params);
  return result.rows[0] || null;
}

// ── Stock ─────────────────────────────────────────────────────────────────────

async function getStock(filters = {}) {
  let query = `
    SELECT s.id, s.catalogo_id, s.talla, s.cantidad_disponible,
           s.company_id, s.contract_id, s.updated_at,
           c.nombre AS item_nombre, c.categoria, c.requiere_talla
    FROM dotacion_stock s
    JOIN dotacion_catalogo c ON s.catalogo_id = c.id
    WHERE c.activo = true
  `;
  const params = [];

  if (filters.companyId) {
    params.push(filters.companyId);
    query += ` AND s.company_id = $${params.length}`;
  }
  if (filters.contractId) {
    params.push(filters.contractId);
    query += ` AND s.contract_id = $${params.length}`;
  }
  if (filters.catalogoId) {
    params.push(filters.catalogoId);
    query += ` AND s.catalogo_id = $${params.length}`;
  }

  query += ` ORDER BY c.categoria, c.nombre, s.talla`;

  const result = await pool.query(query, params);
  return result.rows;
}

async function upsertStock(data) {
  const talla = data.talla || null;
  const existing = talla === null
    ? await pool.query(`SELECT id FROM dotacion_stock WHERE catalogo_id = $1 AND talla IS NULL`, [data.catalogo_id])
    : await pool.query(`SELECT id FROM dotacion_stock WHERE catalogo_id = $1 AND talla = $2`, [data.catalogo_id, talla]);

  if (existing.rows.length > 0) {
    const result = await pool.query(
      `UPDATE dotacion_stock SET cantidad_disponible = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [data.cantidad_disponible, existing.rows[0].id]
    );
    return result.rows[0];
  }

  const result = await pool.query(
    `INSERT INTO dotacion_stock (catalogo_id, talla, cantidad_disponible, company_id, contract_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [data.catalogo_id, talla, data.cantidad_disponible, data.company_id, data.contract_id]
  );
  return result.rows[0];
}

async function adjustStock(id, delta) {
  const query = `
    UPDATE dotacion_stock
    SET cantidad_disponible = GREATEST(0, cantidad_disponible + $1),
        updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `;
  const result = await pool.query(query, [delta, id]);
  return result.rows[0] || null;
}

// ── Asignaciones ──────────────────────────────────────────────────────────────

async function getAsignaciones(filters = {}) {
  let query = `
    SELECT a.id, a.employee_id, a.catalogo_id, a.talla, a.cantidad,
           a.fecha_entrega, a.fecha_recibido, a.fecha_vencimiento,
           a.condicion, a.estado, a.observaciones,
           a.evidencia IS NOT NULL AS tiene_evidencia,
           a.company_id, a.contract_id, a.created_at, a.updated_at,
           e.full_name AS empleado_nombre, e.document_number AS empleado_documento,
           c.nombre AS item_nombre, c.categoria
    FROM dotacion_asignaciones a
    JOIN employees e ON a.employee_id = e.id
    JOIN dotacion_catalogo c ON a.catalogo_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (filters.companyId) {
    params.push(filters.companyId);
    query += ` AND a.company_id = $${params.length}`;
  }
  if (filters.contractId) {
    params.push(filters.contractId);
    query += ` AND a.contract_id = $${params.length}`;
  }
  if (filters.employeeId) {
    params.push(filters.employeeId);
    query += ` AND a.employee_id = $${params.length}`;
  }
  if (filters.estado) {
    params.push(filters.estado);
    query += ` AND a.estado = $${params.length}`;
  }
  if (filters.catalogoId) {
    params.push(filters.catalogoId);
    query += ` AND a.catalogo_id = $${params.length}`;
  }

  query += ` ORDER BY a.created_at DESC`;

  const result = await pool.query(query, params);
  return result.rows;
}

async function getAsignacionById(id) {
  const query = `
    SELECT a.*, e.full_name AS empleado_nombre, c.nombre AS item_nombre
    FROM dotacion_asignaciones a
    JOIN employees e ON a.employee_id = e.id
    JOIN dotacion_catalogo c ON a.catalogo_id = c.id
    WHERE a.id = $1
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

async function createAsignacion(data) {
  const query = `
    INSERT INTO dotacion_asignaciones
      (employee_id, catalogo_id, talla, cantidad, fecha_entrega, fecha_recibido,
       fecha_vencimiento, condicion, estado, evidencia, observaciones,
       company_id, contract_id, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *
  `;
  const result = await pool.query(query, [
    data.employee_id,
    data.catalogo_id,
    data.talla || null,
    data.cantidad || 1,
    data.fecha_entrega || null,
    data.fecha_recibido || null,
    data.fecha_vencimiento || null,
    data.condicion || "NUEVA",
    data.estado || "ASIGNADA",
    data.evidencia || null,
    data.observaciones || null,
    data.company_id,
    data.contract_id,
    data.created_by || null,
  ]);
  return result.rows[0];
}

async function updateAsignacion(id, data) {
  const fields = [];
  const params = [];

  const allowed = [
    "talla", "cantidad", "fecha_entrega", "fecha_recibido", "fecha_vencimiento",
    "condicion", "estado", "evidencia", "observaciones",
  ];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      params.push(data[key]);
      fields.push(`${key} = $${params.length}`);
    }
  }

  if (!fields.length) return null;

  params.push(id);
  const query = `
    UPDATE dotacion_asignaciones
    SET ${fields.join(", ")}, updated_at = NOW()
    WHERE id = $${params.length}
    RETURNING *
  `;
  const result = await pool.query(query, params);
  return result.rows[0] || null;
}

async function deleteAsignacion(id) {
  const result = await pool.query(
    `DELETE FROM dotacion_asignaciones WHERE id = $1 RETURNING id`,
    [id]
  );
  return result.rows[0] || null;
}

// ── Remisiones ────────────────────────────────────────────────────────────────

async function getRemisiones(filters = {}) {
  let query = `
    SELECT r.id, r.numero, r.fecha_envio, r.sede_nombre, r.modalidad,
           r.responsable, r.estado, r.observaciones,
           r.foto_remision         IS NOT NULL AS tiene_foto,
           r.fecha_enviado,
           r.fecha_recibido,
           r.comprobante_enviado   IS NOT NULL AS tiene_comp_env,
           r.comprobante_recibido  IS NOT NULL AS tiene_comp_rec,
           r.company_id, r.contract_id, r.created_at,
           COUNT(i.id)::int AS total_items
    FROM dotacion_remisiones r
    LEFT JOIN dotacion_remisiones_items i ON i.remision_id = r.id
    WHERE 1=1
  `;
  const params = [];

  if (filters.companyId) {
    params.push(filters.companyId);
    query += ` AND r.company_id = $${params.length}`;
  }
  if (filters.contractId) {
    params.push(filters.contractId);
    query += ` AND r.contract_id = $${params.length}`;
  }
  if (filters.estado) {
    params.push(filters.estado);
    query += ` AND r.estado = $${params.length}`;
  }

  query += ` GROUP BY r.id ORDER BY r.created_at DESC`;

  const result = await pool.query(query, params);
  return result.rows;
}

async function getRemisionById(id) {
  const header = await pool.query(
    `SELECT * FROM dotacion_remisiones WHERE id = $1`,
    [id]
  );
  if (!header.rows[0]) return null;

  const items = await pool.query(
    `SELECT * FROM dotacion_remisiones_items WHERE remision_id = $1 ORDER BY orden, id`,
    [id]
  );

  return { ...header.rows[0], items: items.rows };
}

async function createRemision(data, items = []) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const rRes = await client.query(
      `INSERT INTO dotacion_remisiones
         (numero, fecha_envio, sede_nombre, modalidad, responsable, observaciones,
          estado, company_id, contract_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        data.numero,
        data.fecha_envio,
        data.sede_nombre || null,
        data.modalidad || null,
        data.responsable || null,
        data.observaciones || null,
        data.estado || "BORRADOR",
        data.company_id,
        data.contract_id,
        data.created_by || null,
      ]
    );

    const remision = rRes.rows[0];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await client.query(
        `INSERT INTO dotacion_remisiones_items
           (remision_id, employee_nombre, employee_documento, item_nombre,
            categoria, talla, cantidad, condicion, observaciones, orden)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          remision.id,
          it.employee_nombre || null,
          it.employee_documento || null,
          it.item_nombre,
          it.categoria || null,
          it.talla || null,
          it.cantidad || 1,
          it.condicion || null,
          it.observaciones || null,
          i,
        ]
      );
    }

    await client.query("COMMIT");
    return await getRemisionById(remision.id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function updateRemision(id, data, items) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const fields = [];
    const params = [];
    const allowed = ["numero", "fecha_envio", "sede_nombre", "modalidad", "responsable", "observaciones", "estado", "foto_remision"];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        params.push(data[key]);
        fields.push(`${key} = $${params.length}`);
      }
    }

    if (fields.length) {
      params.push(id);
      await client.query(
        `UPDATE dotacion_remisiones SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $${params.length}`,
        params
      );
    }

    if (Array.isArray(items)) {
      await client.query(`DELETE FROM dotacion_remisiones_items WHERE remision_id = $1`, [id]);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query(
          `INSERT INTO dotacion_remisiones_items
             (remision_id, employee_nombre, employee_documento, item_nombre,
              categoria, talla, cantidad, condicion, observaciones, orden)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [id, it.employee_nombre || null, it.employee_documento || null, it.item_nombre,
           it.categoria || null, it.talla || null, it.cantidad || 1, it.condicion || null,
           it.observaciones || null, i]
        );
      }
    }

    await client.query("COMMIT");
    return await getRemisionById(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function deleteRemision(id) {
  const result = await pool.query(
    `DELETE FROM dotacion_remisiones WHERE id = $1 RETURNING id`,
    [id]
  );
  return result.rows[0] || null;
}

async function getMunicipiosConEmpleados(filters = {}) {
  const extra = [];
  const params = [];
  if (filters.companyId)  { params.push(filters.companyId);  extra.push(`e.company_id  = $${params.length}`); }
  if (filters.contractId) { params.push(filters.contractId); extra.push(`e.contract_id = $${params.length}`); }
  const where = extra.length ? ` AND ${extra.join(" AND ")}` : "";

  // Rama 1: municipio directo en el empleado
  // Rama 2: municipio via institución del empleado (cuando municipality_id no está en el empleado)
  const q = `
    SELECT DISTINCT m.id, m.name
    FROM employees e
    JOIN municipalities m ON e.municipality_id = m.id
    WHERE e.status = 'ACTIVO'${where}
    UNION
    SELECT DISTINCT m.id, m.name
    FROM employees e
    JOIN institutions   i ON e.institution_id   = i.id
    JOIN municipalities m ON i.municipality_id  = m.id
    WHERE e.status = 'ACTIVO'${where}
    ORDER BY name
  `;
  return (await pool.query(q, params)).rows;
}

async function getInstitucionesByMunicipio(municipioId, filters = {}) {
  // Primary: institutions with their own municipality_id
  // Fallback union: institutions linked via active employees in that municipality
  let q = `
    SELECT DISTINCT i.id, i.name FROM institutions i
    WHERE i.municipality_id = $1
    UNION
    SELECT DISTINCT i.id, i.name FROM employees e
    JOIN institutions i ON e.institution_id = i.id
    WHERE e.status = 'ACTIVO' AND e.municipality_id = $1
  `;
  const params = [municipioId];

  // Apply company/contract filter only on the employee side via wrapping
  if (filters.companyId || filters.contractId) {
    const extra = [];
    const p2 = [municipioId];
    if (filters.companyId)  { p2.push(filters.companyId);  extra.push(`e.company_id  = $${p2.length}`); }
    if (filters.contractId) { p2.push(filters.contractId); extra.push(`e.contract_id = $${p2.length}`); }
    const where = extra.join(" AND ");
    q = `
      SELECT DISTINCT i.id, i.name FROM institutions i
      WHERE i.municipality_id = $1
      UNION
      SELECT DISTINCT i.id, i.name FROM employees e
      JOIN institutions i ON e.institution_id = i.id
      WHERE e.status = 'ACTIVO' AND e.municipality_id = $1 AND ${where}
    `;
    const result = await pool.query(q + ` ORDER BY name`, p2);
    return result.rows;
  }

  q += ` ORDER BY name`;
  return (await pool.query(q, params)).rows;
}

async function getSedesByInstitucion(institucionId, filters = {}) {
  // Primary: educational_sites with their own institution_id
  // Fallback union: sites linked via active employees in that institution
  let q = `
    SELECT DISTINCT es.id, es.name FROM educational_sites es
    WHERE es.institution_id = $1
    UNION
    SELECT DISTINCT es.id, es.name FROM employees e
    JOIN educational_sites es ON e.site_id = es.id
    WHERE e.status = 'ACTIVO' AND e.institution_id = $1
  `;
  const params = [institucionId];

  if (filters.companyId || filters.contractId) {
    const extra = [];
    const p2 = [institucionId];
    if (filters.companyId)  { p2.push(filters.companyId);  extra.push(`e.company_id  = $${p2.length}`); }
    if (filters.contractId) { p2.push(filters.contractId); extra.push(`e.contract_id = $${p2.length}`); }
    const where = extra.join(" AND ");
    q = `
      SELECT DISTINCT es.id, es.name FROM educational_sites es
      WHERE es.institution_id = $1
      UNION
      SELECT DISTINCT es.id, es.name FROM employees e
      JOIN educational_sites es ON e.site_id = es.id
      WHERE e.status = 'ACTIVO' AND e.institution_id = $1 AND ${where}
    `;
    const result = await pool.query(q + ` ORDER BY name`, p2);
    return result.rows;
  }

  q += ` ORDER BY name`;
  return (await pool.query(q, params)).rows;
}

async function getModalidadesDisponibles(filters = {}) {
  let q = `
    SELECT DISTINCT e.modality
    FROM employees e
    WHERE e.status = 'ACTIVO' AND e.modality IS NOT NULL AND e.modality <> ''
  `;
  const params = [];
  if (filters.companyId)    { params.push(filters.companyId);    q += ` AND e.company_id      = $${params.length}`; }
  if (filters.contractId)   { params.push(filters.contractId);   q += ` AND e.contract_id     = $${params.length}`; }
  if (filters.municipioId)  { params.push(filters.municipioId);  q += ` AND e.municipality_id = $${params.length}`; }
  if (filters.institucionId){ params.push(filters.institucionId);q += ` AND e.institution_id  = $${params.length}`; }
  if (filters.sedeId)       { params.push(filters.sedeId);       q += ` AND e.site_id         = $${params.length}`; }
  q += ` ORDER BY e.modality`;
  const rows = (await pool.query(q, params)).rows;
  return rows.map(r => r.modality);
}

async function getEmpleadasParaRemision(filters = {}) {
  let q = `
    SELECT e.id, e.full_name, e.document_number, e.modality,
           e.shirt_size, e.pants_size, e.shoe_size,
           e.real_position AS cargo,
           m.name  AS municipio_nombre,
           i.name  AS institucion_nombre,
           es.name AS sede_nombre
    FROM employees e
    LEFT JOIN municipalities    m  ON e.municipality_id = m.id
    LEFT JOIN institutions      i  ON e.institution_id  = i.id
    LEFT JOIN educational_sites es ON e.site_id         = es.id
    WHERE e.status = 'ACTIVO'
  `;
  const params = [];
  if (filters.companyId)   { params.push(filters.companyId);   q += ` AND e.company_id  = $${params.length}`; }
  if (filters.contractId)  { params.push(filters.contractId);  q += ` AND e.contract_id = $${params.length}`; }
  // Filtrar por municipio solo cuando NO hay institución seleccionada
  if (filters.municipioId && !filters.institucionId) {
    params.push(filters.municipioId);
    q += ` AND e.municipality_id = $${params.length}`;
  }
  if (filters.institucionId) {
    params.push(filters.institucionId);
    q += ` AND e.institution_id = $${params.length}`;
  }
  if (filters.sedeId) {
    params.push(filters.sedeId);
    q += ` AND (e.site_id = $${params.length} OR e.site_id IS NULL)`;
  }
  q += ` ORDER BY e.full_name`;
  return (await pool.query(q, params)).rows;
}

async function getAsignacionesParaImportar(filters = {}) {
  let query = `
    SELECT a.id, a.talla, a.cantidad, a.condicion, a.estado,
           e.full_name AS employee_nombre, e.document_number AS employee_documento,
           e.modality,
           c.nombre AS item_nombre, c.categoria
    FROM dotacion_asignaciones a
    JOIN employees e ON a.employee_id = e.id
    JOIN dotacion_catalogo c ON a.catalogo_id = c.id
    WHERE a.estado = 'ASIGNADA'
  `;
  const params = [];

  if (filters.companyId) {
    params.push(filters.companyId);
    query += ` AND a.company_id = $${params.length}`;
  }
  if (filters.contractId) {
    params.push(filters.contractId);
    query += ` AND a.contract_id = $${params.length}`;
  }
  if (filters.modalidad) {
    params.push(filters.modalidad);
    query += ` AND UPPER(e.modality) = UPPER($${params.length})`;
  }

  query += ` ORDER BY e.full_name, c.nombre`;
  const result = await pool.query(query, params);
  return result.rows;
}

async function marcarEnviadoRecibido(id, tipo, { fecha, comprobante }) {
  const campoFecha = tipo === "enviado" ? "fecha_enviado" : "fecha_recibido";
  const campoComp  = tipo === "enviado" ? "comprobante_enviado" : "comprobante_recibido";
  const fields = [`${campoFecha} = $1`, `updated_at = NOW()`];
  const params = [fecha];
  if (comprobante !== undefined) {
    params.push(comprobante);
    fields.push(`${campoComp} = $${params.length}`);
  }
  params.push(id);
  const result = await pool.query(
    `UPDATE dotacion_remisiones SET ${fields.join(", ")} WHERE id = $${params.length}
     RETURNING id, fecha_enviado, fecha_recibido,
               comprobante_enviado  IS NOT NULL AS tiene_comp_env,
               comprobante_recibido IS NOT NULL AS tiene_comp_rec`,
    params
  );
  return result.rows[0] || null;
}

async function getComprobante(id, tipo) {
  const col = tipo === "enviado" ? "comprobante_enviado" : "comprobante_recibido";
  const result = await pool.query(
    `SELECT ${col} AS comprobante FROM dotacion_remisiones WHERE id = $1`,
    [id]
  );
  return result.rows[0]?.comprobante || null;
}

module.exports = {
  getCatalogo,
  createCatalogoItem,
  updateCatalogoItem,
  getStock,
  upsertStock,
  adjustStock,
  getAsignaciones,
  getAsignacionById,
  createAsignacion,
  updateAsignacion,
  deleteAsignacion,
  getRemisiones,
  getRemisionById,
  createRemision,
  updateRemision,
  deleteRemision,
  getAsignacionesParaImportar,
  getMunicipiosConEmpleados,
  getInstitucionesByMunicipio,
  getSedesByInstitucion,
  getModalidadesDisponibles,
  getEmpleadasParaRemision,
  marcarEnviadoRecibido,
  getComprobante,
};
