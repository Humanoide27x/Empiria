"use strict";

const pool = require("../../db/pool");

// ─── Utilidades ───────────────────────────────────────────────────────────────

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function safe(v) {
  return v === undefined || v === null ? "" : String(v).trim();
}

// ─── Scope helper ─────────────────────────────────────────────────────────────
// Devuelve condiciones SQL + valores para filtrar por scope del usuario.
// Gestores solo ven su municipio; TH y Admin ven todo (o filtran por query).
function buildScopeFilter(user, tableAlias = "") {
  const col = (c) => (tableAlias ? `${tableAlias}.${c}` : c);
  const role = safe(user.role).toLowerCase();
  const conditions = [];
  const values = [];

  if (role === "gestores_auxiliares" || role === "gestor") {
    const munIds =
      Array.isArray(user.municipality_ids) && user.municipality_ids.length
        ? user.municipality_ids.map(Number).filter((n) => n > 0)
        : Array.isArray(user.assignedMunicipalities) && user.assignedMunicipalities.length
          ? [] // nombres, no IDs — se resuelven abajo
          : [];

    if (munIds.length) {
      conditions.push(`${col("municipality_id")} = ANY($${values.length + 1}::int[])`);
      values.push(munIds);
    } else if (
      Array.isArray(user.assignedMunicipalities) &&
      user.assignedMunicipalities.length
    ) {
      conditions.push(`${col("municipality_name")} ILIKE ANY($${values.length + 1}::text[])`);
      values.push(user.assignedMunicipalities.map((m) => `%${m}%`));
    }

    if (user.company_id || user.companyId) {
      values.push(toNum(user.company_id || user.companyId));
      conditions.push(`${col("company_id")} = $${values.length}`);
    }
    if (user.contract_id || user.contractId) {
      values.push(toNum(user.contract_id || user.contractId));
      conditions.push(`${col("contract_id")} = $${values.length}`);
    }
  }

  return { conditions, values };
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

async function getDashboardKpis(user) {
  const scope = buildScopeFilter(user, "s");
  const ticketScope = buildScopeFilter(user, "t");

  const sWhere = scope.conditions.length
    ? "WHERE " + scope.conditions.join(" AND ")
    : "";
  const tWhere = ticketScope.conditions.length
    ? "WHERE " + ticketScope.conditions.join(" AND ")
    : "";

  const [soportesRes, ticketsRes, docsRes] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE s.status = 'PENDIENTE')   AS soportes_pendientes,
         COUNT(*) FILTER (WHERE s.status = 'EN_REVISION') AS soportes_revision,
         COUNT(*) FILTER (WHERE s.status = 'APROBADO')    AS soportes_aprobados,
         COUNT(*) FILTER (WHERE s.status = 'RECHAZADO')   AS soportes_rechazados
       FROM portal_soportes s ${sWhere}`,
      scope.values
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE t.status = 'RADICADA')   AS tickets_radicados,
         COUNT(*) FILTER (WHERE t.status = 'EN_PROCESO') AS tickets_en_proceso,
         COUNT(*) FILTER (WHERE t.status = 'RESPONDIDA') AS tickets_respondidos,
         COUNT(*) FILTER (WHERE t.status = 'CERRADA')    AS tickets_cerrados
       FROM portal_tickets t ${tWhere}`,
      ticketScope.values
    ),
    pool.query(
      `SELECT COUNT(*) AS docs_generados FROM portal_doc_delivery
       WHERE status = 'ENVIADO'`,
      []
    ),
  ]);

  const s = soportesRes.rows[0];
  const tk = ticketsRes.rows[0];
  const d = docsRes.rows[0];

  return {
    soportes_pendientes:  Number(s.soportes_pendientes),
    soportes_revision:    Number(s.soportes_revision),
    soportes_aprobados:   Number(s.soportes_aprobados),
    soportes_rechazados:  Number(s.soportes_rechazados),
    solicitudes_abiertas: Number(tk.tickets_radicados) + Number(tk.tickets_en_proceso),
    solicitudes_resueltas:Number(tk.tickets_respondidos) + Number(tk.tickets_cerrados),
    tickets_en_proceso:   Number(tk.tickets_en_proceso),
    docs_generados:       Number(d.docs_generados),
  };
}

async function getRecentActivity(user, limit = 5) {
  const scope = buildScopeFilter(user, "s");
  const tScope = buildScopeFilter(user, "t");

  const sWhere = scope.conditions.length
    ? "WHERE " + scope.conditions.join(" AND ")
    : "";
  const tWhere = tScope.conditions.length
    ? "WHERE " + tScope.conditions.join(" AND ")
    : "";

  const [soportes, tickets] = await Promise.all([
    pool.query(
      `SELECT id, employee_name, doc_type, status, created_at
         FROM portal_soportes s ${sWhere}
         ORDER BY s.created_at DESC LIMIT $${scope.values.length + 1}`,
      [...scope.values, limit]
    ),
    pool.query(
      `SELECT id, ticket_number, employee_name, ticket_type, status, created_at
         FROM portal_tickets t ${tWhere}
         ORDER BY t.created_at DESC LIMIT $${tScope.values.length + 1}`,
      [...tScope.values, limit]
    ),
  ]);

  return {
    soportes: soportes.rows,
    tickets:  tickets.rows,
  };
}

// ─── SOPORTES ─────────────────────────────────────────────────────────────────

function mapSoporte(row) {
  return {
    id:               row.id,
    employeeId:       row.employee_id,
    employeeName:     row.employee_name || "",
    documentNumber:   row.document_number || "",
    municipalityId:   row.municipality_id,
    municipalityName: row.municipality_name || "",
    companyId:        row.company_id,
    contractId:       row.contract_id,
    docType:          row.doc_type || "",
    deadline:         row.deadline,
    fileUrl:          row.file_url || "",
    fileName:         row.file_name || "",
    status:           row.status,
    observation:      row.observation || "",
    createdByUserId:  row.created_by_user_id,
    createdByName:    row.created_by_name || "",
    updatedByUserId:  row.updated_by_user_id,
    updatedByName:    row.updated_by_name || "",
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
  };
}

async function listSoportes(user, filters = {}) {
  const scope = buildScopeFilter(user, "ps");
  const values = [...scope.values];
  const conditions = [...scope.conditions];

  if (filters.status) {
    values.push(safe(filters.status).toUpperCase());
    conditions.push(`ps.status = $${values.length}`);
  }
  if (filters.employeeId) {
    values.push(String(filters.employeeId));
    conditions.push(`ps.employee_id = $${values.length}`);
  }
  if (filters.municipalityId) {
    values.push(toNum(filters.municipalityId));
    conditions.push(`ps.municipality_id = $${values.length}`);
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const result = await pool.query(
    `SELECT * FROM portal_soportes ps
     ${where}
     ORDER BY
       CASE ps.status WHEN 'PENDIENTE' THEN 1 WHEN 'EN_REVISION' THEN 2
                      WHEN 'RECHAZADO' THEN 3 ELSE 4 END,
       ps.created_at DESC`,
    values
  );

  return result.rows.map(mapSoporte);
}

async function getSoporteById(id) {
  const result = await pool.query(
    `SELECT * FROM portal_soportes WHERE id = $1`,
    [Number(id)]
  );
  return result.rows[0] ? mapSoporte(result.rows[0]) : null;
}

async function createSoporte(data, user) {
  const result = await pool.query(
    `INSERT INTO portal_soportes
       (employee_id, employee_name, document_number,
        municipality_id, municipality_name, company_id, contract_id,
        doc_type, deadline, created_by_user_id, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      data.employeeId ? String(data.employeeId) : null,
      safe(data.employeeName),
      safe(data.documentNumber),
      toNum(data.municipalityId),
      safe(data.municipalityName),
      toNum(data.companyId),
      toNum(data.contractId),
      safe(data.docType),
      data.deadline || null,
      toNum(user.id),
      safe(user.name || user.username),
    ]
  );
  return getSoporteById(result.rows[0].id);
}

async function updateSoporte(id, data, user) {
  const fields = [];
  const values = [Number(id)];

  if (data.fileUrl !== undefined) {
    values.push(safe(data.fileUrl));
    fields.push(`file_url = $${values.length}`);
    values.push(safe(data.fileName || ""));
    fields.push(`file_name = $${values.length}`);
    if (data.status === undefined) {
      values.push("EN_REVISION");
      fields.push(`status = $${values.length}`);
    }
  }

  if (data.status !== undefined) {
    const allowed = ["PENDIENTE", "EN_REVISION", "APROBADO", "RECHAZADO"];
    const st = safe(data.status).toUpperCase();
    if (!allowed.includes(st)) throw new Error("Estado de soporte inválido");
    values.push(st);
    fields.push(`status = $${values.length}`);
  }

  if (data.observation !== undefined) {
    values.push(safe(data.observation));
    fields.push(`observation = $${values.length}`);
  }

  if (!fields.length) throw new Error("No se enviaron campos para actualizar");

  values.push(toNum(user.id));
  fields.push(`updated_by_user_id = $${values.length}`);
  values.push(safe(user.name || user.username));
  fields.push(`updated_by_name = $${values.length}`);
  fields.push(`updated_at = NOW()`);

  await pool.query(
    `UPDATE portal_soportes SET ${fields.join(", ")} WHERE id = $1`,
    values
  );

  return getSoporteById(id);
}

// ─── TURNOS (vista read-only de payroll_turn_covers) ─────────────────────────

async function listTurnos(user, filters = {}) {
  const role = safe(user.role).toLowerCase();
  const conditions = [];
  const values = [];

  const isGestor = role === "gestores_auxiliares" || role === "gestor";

  if (isGestor) {
    const munIds =
      Array.isArray(user.municipality_ids) && user.municipality_ids.length
        ? user.municipality_ids.map(Number).filter((n) => n > 0)
        : [];

    if (munIds.length) {
      conditions.push(`tc.municipality_id = ANY($${values.length + 1}::int[])`);
      values.push(munIds);
    } else if (user.company_id || user.companyId) {
      values.push(toNum(user.company_id || user.companyId));
      conditions.push(`tc.company_id = $${values.length}`);
    }
    if (user.contract_id || user.contractId) {
      values.push(toNum(user.contract_id || user.contractId));
      conditions.push(`tc.contract_id = $${values.length}`);
    }
  }

  if (filters.status) {
    values.push(safe(filters.status).toUpperCase());
    conditions.push(`tc.status = $${values.length}`);
  }
  if (filters.municipalityId) {
    values.push(toNum(filters.municipalityId));
    conditions.push(`tc.municipality_id = $${values.length}`);
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  try {
    const result = await pool.query(
      `SELECT
         tc.id,
         tc.employee_id,
         tc.employee_name,
         tc.municipality_id,
         tc.municipality_name,
         tc.company_id,
         tc.contract_id,
         tc.turn_date,
         tc.modality,
         tc.institution_name,
         tc.site_name,
         tc.total_value,
         tc.status,
         tc.support_url,
         tc.created_at,
         tc.updated_at
       FROM payroll_turn_covers tc
       ${where}
       ORDER BY tc.turn_date DESC, tc.employee_name
       LIMIT 200`,
      values
    );
    return result.rows.map((r) => ({
      id:              r.id,
      employeeId:      r.employee_id,
      employeeName:    r.employee_name || "",
      municipalityId:  r.municipality_id,
      municipalityName:r.municipality_name || "",
      companyId:       r.company_id,
      contractId:      r.contract_id,
      turnDate:        r.turn_date,
      modality:        r.modality || "",
      institutionName: r.institution_name || "",
      siteName:        r.site_name || "",
      totalValue:      r.total_value ? Number(r.total_value) : null,
      status:          r.status || "PENDIENTE",
      supportUrl:      r.support_url || "",
      createdAt:       r.created_at,
      updatedAt:       r.updated_at,
    }));
  } catch (err) {
    if (/does not exist/i.test(err.message)) return [];
    throw err;
  }
}

// ─── TICKETS ──────────────────────────────────────────────────────────────────

const TICKET_TYPES = Object.freeze([
  "RECLAMACION_NOMINA",
  "RECLAMACION_TURNOS",
  "ACTUALIZACION_DATOS",
  "OTRO",
]);

const TICKET_STATUSES = Object.freeze([
  "RADICADA",
  "EN_PROCESO",
  "RESPONDIDA",
  "CERRADA",
]);

function mapTicket(row) {
  return {
    id:                row.id,
    ticketNumber:      row.ticket_number,
    employeeId:        row.employee_id,
    employeeName:      row.employee_name || "",
    documentNumber:    row.document_number || "",
    municipalityId:    row.municipality_id,
    municipalityName:  row.municipality_name || "",
    companyId:         row.company_id,
    contractId:        row.contract_id,
    ticketType:        row.ticket_type,
    period:            row.period || "",
    motivo:            row.motivo || "",
    fechaTurno:        row.fecha_turno,
    turnoReferencia:   row.turno_referencia || "",
    valorEsperado:     row.valor_esperado ? Number(row.valor_esperado) : null,
    descripcion:       row.descripcion || "",
    attachmentUrl:     row.attachment_url || "",
    status:            row.status,
    responseText:      row.response_text || "",
    createdByUserId:   row.created_by_user_id,
    createdByName:     row.created_by_name || "",
    assignedToUserId:  row.assigned_to_user_id,
    assignedToName:    row.assigned_to_name || "",
    createdAt:         row.created_at,
    updatedAt:         row.updated_at,
    resolvedAt:        row.resolved_at,
  };
}

async function listTickets(user, filters = {}) {
  const scope = buildScopeFilter(user, "t");
  const values = [...scope.values];
  const conditions = [...scope.conditions];

  if (filters.status) {
    values.push(safe(filters.status).toUpperCase());
    conditions.push(`t.status = $${values.length}`);
  }
  if (filters.ticketType) {
    values.push(safe(filters.ticketType).toUpperCase());
    conditions.push(`t.ticket_type = $${values.length}`);
  }
  if (filters.employeeId) {
    values.push(String(filters.employeeId));
    conditions.push(`t.employee_id = $${values.length}`);
  }
  if (filters.municipalityId) {
    values.push(toNum(filters.municipalityId));
    conditions.push(`t.municipality_id = $${values.length}`);
  }
  if (filters.dateFrom) {
    values.push(filters.dateFrom);
    conditions.push(`t.created_at >= $${values.length}`);
  }
  if (filters.dateTo) {
    values.push(filters.dateTo);
    conditions.push(`t.created_at <= $${values.length}`);
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const result = await pool.query(
    `SELECT * FROM portal_tickets t
     ${where}
     ORDER BY
       CASE t.status
         WHEN 'RADICADA'   THEN 1
         WHEN 'EN_PROCESO' THEN 2
         WHEN 'RESPONDIDA' THEN 3
         ELSE 4
       END,
       t.created_at DESC`,
    values
  );

  return result.rows.map(mapTicket);
}

async function getTicketById(id) {
  const result = await pool.query(
    `SELECT * FROM portal_tickets WHERE id = $1`,
    [Number(id)]
  );
  return result.rows[0] ? mapTicket(result.rows[0]) : null;
}

async function createTicket(data, user) {
  const ticketType = safe(data.ticketType || data.ticket_type).toUpperCase();
  if (!TICKET_TYPES.includes(ticketType)) {
    throw new Error(`Tipo de ticket inválido. Permitidos: ${TICKET_TYPES.join(", ")}`);
  }
  if (!safe(data.descripcion || data.description)) {
    throw new Error("La descripción del ticket es obligatoria");
  }

  const result = await pool.query(
    `INSERT INTO portal_tickets
       (employee_id, employee_name, document_number,
        municipality_id, municipality_name, company_id, contract_id,
        ticket_type, period, motivo,
        fecha_turno, turno_referencia, valor_esperado,
        descripcion, attachment_url,
        created_by_user_id, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id`,
    [
      data.employeeId ? String(data.employeeId) : null,
      safe(data.employeeName),
      safe(data.documentNumber),
      toNum(data.municipalityId),
      safe(data.municipalityName),
      toNum(data.companyId),
      toNum(data.contractId),
      ticketType,
      safe(data.period),
      safe(data.motivo),
      data.fechaTurno || data.fecha_turno || null,
      safe(data.turnoReferencia || data.turno_referencia),
      data.valorEsperado != null ? Number(data.valorEsperado) : null,
      safe(data.descripcion || data.description),
      safe(data.attachmentUrl || data.attachment_url),
      toNum(user.id),
      safe(user.name || user.username),
    ]
  );

  return getTicketById(result.rows[0].id);
}

async function updateTicket(id, data, user) {
  const current = await pool.query(
    `SELECT status FROM portal_tickets WHERE id = $1`,
    [Number(id)]
  );
  if (!current.rows[0]) throw new Error("Ticket no encontrado");
  if (current.rows[0].status === "CERRADA") {
    throw new Error("Un ticket cerrado no puede modificarse");
  }

  const fields = [];
  const values = [Number(id)];

  if (data.status !== undefined) {
    const st = safe(data.status).toUpperCase();
    if (!TICKET_STATUSES.includes(st)) {
      throw new Error(`Estado inválido. Permitidos: ${TICKET_STATUSES.join(", ")}`);
    }
    values.push(st);
    fields.push(`status = $${values.length}`);
    if (st === "RESPONDIDA" || st === "CERRADA") {
      fields.push(`resolved_at = NOW()`);
    }
  }

  if (data.responseText !== undefined) {
    values.push(safe(data.responseText));
    fields.push(`response_text = $${values.length}`);
  }

  if (data.attachmentUrl !== undefined) {
    values.push(safe(data.attachmentUrl));
    fields.push(`attachment_url = $${values.length}`);
  }

  if (data.assignedToUserId !== undefined) {
    values.push(toNum(data.assignedToUserId));
    fields.push(`assigned_to_user_id = $${values.length}`);
    values.push(safe(data.assignedToName));
    fields.push(`assigned_to_name = $${values.length}`);
  }

  if (!fields.length) throw new Error("No se enviaron campos para actualizar");

  fields.push(`updated_at = NOW()`);

  await pool.query(
    `UPDATE portal_tickets SET ${fields.join(", ")} WHERE id = $1`,
    values
  );

  return getTicketById(id);
}

// ─── DOCUMENTOS AUTOMÁTICOS ───────────────────────────────────────────────────

const AUTO_DOC_TYPES = Object.freeze([
  "CERTIFICADO_LABORAL",
  "DESPRENDIBLE_PAGO",
  "CUENTA_COBRO",
  "CERTIFICACION_INGRESOS",
  "CERTIFICACION_PAGOS",
]);

async function registerDocDelivery(data, user) {
  const docType = safe(data.docType).toUpperCase();
  if (!AUTO_DOC_TYPES.includes(docType)) {
    throw new Error("Tipo de documento automático inválido");
  }

  const result = await pool.query(
    `INSERT INTO portal_doc_delivery
       (employee_id, employee_name, email, doc_type, doc_period,
        status, error_message, created_by_user_id, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      data.employeeId ? String(data.employeeId) : null,
      safe(data.employeeName),
      safe(data.email),
      docType,
      safe(data.period),
      safe(data.status || "ENVIADO").toUpperCase(),
      safe(data.errorMessage),
      toNum(user.id),
      safe(user.name || user.username),
    ]
  );

  const row = await pool.query(
    `SELECT * FROM portal_doc_delivery WHERE id = $1`,
    [result.rows[0].id]
  );
  return row.rows[0];
}

async function listDocDeliveries(user, filters = {}) {
  const conditions = [];
  const values = [];

  if (filters.employeeId) {
    values.push(String(filters.employeeId));
    conditions.push(`employee_id = $${values.length}`);
  }
  if (filters.docType) {
    values.push(safe(filters.docType).toUpperCase());
    conditions.push(`doc_type = $${values.length}`);
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const result = await pool.query(
    `SELECT * FROM portal_doc_delivery ${where}
     ORDER BY created_at DESC LIMIT 100`,
    values
  );
  return result.rows;
}

// ─── NOTIFICACIONES ───────────────────────────────────────────────────────────

async function createNotification(userId, title, body, type, refType, refId) {
  try {
    await pool.query(
      `INSERT INTO portal_notifications
         (user_id, title, body, notification_type, reference_type, reference_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [toNum(userId), safe(title), safe(body), safe(type), safe(refType), refId ? Number(refId) : null]
    );
  } catch (err) {
    console.warn("[portal.repository] No se pudo crear notificación:", err.message);
  }
}

async function listNotifications(userId, unreadOnly = false) {
  const conditions = [`user_id = $1`];
  const values = [Number(userId)];

  if (unreadOnly) {
    conditions.push(`read = FALSE`);
  }

  const result = await pool.query(
    `SELECT * FROM portal_notifications WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC LIMIT 50`,
    values
  );
  return result.rows.map((r) => ({
    id:               r.id,
    userId:           r.user_id,
    title:            r.title,
    body:             r.body || "",
    notificationType: r.notification_type || "",
    referenceType:    r.reference_type || "",
    referenceId:      r.reference_id,
    read:             r.read,
    createdAt:        r.created_at,
  }));
}

async function countUnreadNotifications(userId) {
  const result = await pool.query(
    `SELECT COUNT(*) AS cnt FROM portal_notifications
     WHERE user_id = $1 AND read = FALSE`,
    [Number(userId)]
  );
  return Number(result.rows[0].cnt);
}

async function markNotificationRead(id, userId) {
  await pool.query(
    `UPDATE portal_notifications SET read = TRUE
     WHERE id = $1 AND user_id = $2`,
    [Number(id), Number(userId)]
  );
}

async function markAllNotificationsRead(userId) {
  await pool.query(
    `UPDATE portal_notifications SET read = TRUE WHERE user_id = $1`,
    [Number(userId)]
  );
}

// ─── AUDITORÍA ────────────────────────────────────────────────────────────────

async function addAuditLog(userId, userName, action, entityType, entityId, result, observation) {
  try {
    await pool.query(
      `INSERT INTO portal_audit_log
         (user_id, user_name, action, entity_type, entity_id, result, observation)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        toNum(userId),
        safe(userName),
        safe(action),
        safe(entityType),
        entityId ? Number(entityId) : null,
        safe(result),
        safe(observation),
      ]
    );
  } catch (err) {
    console.warn("[portal.repository] No se pudo guardar audit log:", err.message);
  }
}

async function listAuditLog(filters = {}) {
  const conditions = [];
  const values = [];

  if (filters.userId) {
    values.push(toNum(filters.userId));
    conditions.push(`user_id = $${values.length}`);
  }
  if (filters.entityType) {
    values.push(safe(filters.entityType));
    conditions.push(`entity_type = $${values.length}`);
  }
  if (filters.entityId) {
    values.push(Number(filters.entityId));
    conditions.push(`entity_id = $${values.length}`);
  }
  if (filters.dateFrom) {
    values.push(filters.dateFrom);
    conditions.push(`created_at >= $${values.length}`);
  }
  if (filters.dateTo) {
    values.push(filters.dateTo);
    conditions.push(`created_at <= $${values.length}`);
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const result = await pool.query(
    `SELECT * FROM portal_audit_log ${where}
     ORDER BY created_at DESC LIMIT 200`,
    values
  );
  return result.rows.map((r) => ({
    id:          r.id,
    userId:      r.user_id,
    userName:    r.user_name || "",
    action:      r.action,
    entityType:  r.entity_type || "",
    entityId:    r.entity_id,
    result:      r.result || "",
    observation: r.observation || "",
    createdAt:   r.created_at,
  }));
}

module.exports = {
  // Dashboard
  getDashboardKpis,
  getRecentActivity,
  // Soportes
  listSoportes,
  getSoporteById,
  createSoporte,
  updateSoporte,
  // Turnos
  listTurnos,
  // Tickets
  listTickets,
  getTicketById,
  createTicket,
  updateTicket,
  TICKET_TYPES,
  TICKET_STATUSES,
  // Documentos automáticos
  registerDocDelivery,
  listDocDeliveries,
  AUTO_DOC_TYPES,
  // Notificaciones
  createNotification,
  listNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  // Auditoría
  addAuditLog,
  listAuditLog,
};
