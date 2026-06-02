"use strict";

const { requireAuth }   = require("../auth/auth.helpers");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { readJsonBody }  = require("../../http/request");
const { ROLES }         = require("../../auth/permissions");

const repo = require("./portal.repository");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safe(v) {
  return v === undefined || v === null ? "" : String(v).trim();
}

function getRole(user) {
  return safe(user.role).toLowerCase();
}

function isAdmin(user) {
  return getRole(user) === ROLES.ADMINISTRATOR;
}

function isTalentoHumano(user) {
  return getRole(user) === ROLES.HUMAN_RESOURCES;
}

function isGestor(user) {
  const r = getRole(user);
  return r === ROLES.MANAGERS_AND_ASSISTANTS || r === "gestor";
}

function isAdminOrTH(user) {
  return isAdmin(user) || isTalentoHumano(user);
}

function requirePortalAuth(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return null;

  const role = getRole(auth.user);
  const allowed = [
    ROLES.ADMINISTRATOR,
    ROLES.HUMAN_RESOURCES,
    ROLES.MANAGERS_AND_ASSISTANTS,
    "gestor",
  ];
  if (!allowed.includes(role)) {
    sendJson(res, 403, {
      ok: false,
      message: "No tienes acceso al Portal del Colaborador",
    });
    return null;
  }

  return auth;
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

async function handleDashboard(req, res) {
  if (req.method !== "GET") return sendMethodNotAllowed(res);
  const auth = requirePortalAuth(req, res);
  if (!auth) return;

  try {
    const [kpis, recent] = await Promise.all([
      repo.getDashboardKpis(auth.user),
      repo.getRecentActivity(auth.user, 5),
    ]);
    sendJson(res, 200, { ok: true, data: { kpis, recent } });
  } catch (err) {
    console.error("[portal] dashboard error:", err.message);
    sendJson(res, 500, { ok: false, message: err.message });
  }
}

// ─── SOPORTES ─────────────────────────────────────────────────────────────────

async function handleSoportes(req, res, url) {
  const auth = requirePortalAuth(req, res);
  if (!auth) return;

  if (req.method === "GET") {
    try {
      const filters = {
        status:         url.searchParams.get("status") || "",
        employeeId:     url.searchParams.get("employeeId") || "",
        municipalityId: url.searchParams.get("municipalityId") || "",
      };
      const data = await repo.listSoportes(auth.user, filters);
      sendJson(res, 200, { ok: true, data });
    } catch (err) {
      sendJson(res, 500, { ok: false, message: err.message });
    }
    return;
  }

  if (req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const soporte = await repo.createSoporte(body, auth.user);
      await repo.addAuditLog(
        auth.user.id, auth.user.name || auth.user.username,
        "CREAR_SOPORTE", "soporte", soporte.id, "OK", ""
      );
      // Notificar a TH que hay un nuevo soporte
      const thUsers = []; // Se pueden agregar IDs de usuarios TH si se tiene el listado
      sendJson(res, 201, { ok: true, data: soporte });
    } catch (err) {
      sendJson(res, 400, { ok: false, message: err.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

async function handleSoporteById(req, res, url) {
  const auth = requirePortalAuth(req, res);
  if (!auth) return;

  const id = Number(url.pathname.split("/")[3]);
  if (!id) return sendJson(res, 400, { ok: false, message: "ID inválido" });

  if (req.method === "GET") {
    try {
      const soporte = await repo.getSoporteById(id);
      if (!soporte) return sendJson(res, 404, { ok: false, message: "Soporte no encontrado" });
      sendJson(res, 200, { ok: true, data: soporte });
    } catch (err) {
      sendJson(res, 500, { ok: false, message: err.message });
    }
    return;
  }

  if (req.method === "PATCH") {
    // Gestor puede subir/reemplazar archivo; TH puede aprobar/rechazar
    try {
      const body = await readJsonBody(req);

      // Solo TH/Admin puede cambiar status a APROBADO o RECHAZADO
      if (
        ["APROBADO", "RECHAZADO"].includes(safe(body.status).toUpperCase()) &&
        !isAdminOrTH(auth.user)
      ) {
        return sendJson(res, 403, {
          ok: false,
          message: "Solo Talento Humano puede aprobar o rechazar soportes",
        });
      }

      const updated = await repo.updateSoporte(id, body, auth.user);

      // Notificaciones automáticas
      const notifTitle =
        safe(body.status).toUpperCase() === "APROBADO"
          ? "Soporte aprobado"
          : safe(body.status).toUpperCase() === "RECHAZADO"
            ? "Soporte rechazado"
            : "Soporte actualizado";

      const notifBody =
        safe(body.status).toUpperCase() === "APROBADO"
          ? `El soporte "${updated.docType}" fue aprobado por Talento Humano.`
          : safe(body.status).toUpperCase() === "RECHAZADO"
            ? `El soporte "${updated.docType}" fue rechazado. Motivo: ${body.observation || "Sin observación"}`
            : `El soporte "${updated.docType}" fue actualizado.`;

      // Notificar al gestor que creó el soporte
      if (updated.createdByUserId && isAdminOrTH(auth.user)) {
        await repo.createNotification(
          updated.createdByUserId,
          notifTitle,
          notifBody,
          "soporte",
          "soporte",
          id
        );
      }

      await repo.addAuditLog(
        auth.user.id, auth.user.name || auth.user.username,
        `ACTUALIZAR_SOPORTE:${safe(body.status).toUpperCase() || "ARCHIVO"}`,
        "soporte", id, "OK",
        body.observation || ""
      );

      sendJson(res, 200, { ok: true, data: updated });
    } catch (err) {
      sendJson(res, 400, { ok: false, message: err.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

// ─── TURNOS ───────────────────────────────────────────────────────────────────

async function handleTurnos(req, res, url) {
  if (req.method !== "GET") return sendMethodNotAllowed(res);
  const auth = requirePortalAuth(req, res);
  if (!auth) return;

  try {
    const filters = {
      status:         url.searchParams.get("status") || "",
      municipalityId: url.searchParams.get("municipalityId") || "",
    };
    const data = await repo.listTurnos(auth.user, filters);
    sendJson(res, 200, { ok: true, data });
  } catch (err) {
    console.error("[portal] turnos error:", err.message);
    sendJson(res, 500, { ok: false, message: err.message });
  }
}

// ─── TICKETS ──────────────────────────────────────────────────────────────────

async function handleTickets(req, res, url) {
  const auth = requirePortalAuth(req, res);
  if (!auth) return;

  if (req.method === "GET") {
    try {
      const filters = {
        status:         url.searchParams.get("status") || "",
        ticketType:     url.searchParams.get("type") || "",
        employeeId:     url.searchParams.get("employeeId") || "",
        municipalityId: url.searchParams.get("municipalityId") || "",
        dateFrom:       url.searchParams.get("dateFrom") || "",
        dateTo:         url.searchParams.get("dateTo") || "",
      };
      const data = await repo.listTickets(auth.user, filters);
      sendJson(res, 200, { ok: true, data });
    } catch (err) {
      sendJson(res, 500, { ok: false, message: err.message });
    }
    return;
  }

  if (req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const ticket = await repo.createTicket(body, auth.user);

      // Notificar a TH que hay un nuevo ticket
      await repo.addAuditLog(
        auth.user.id, auth.user.name || auth.user.username,
        "CREAR_TICKET", "ticket", ticket.id, "OK",
        `Tipo: ${ticket.ticketType} | #${ticket.ticketNumber}`
      );

      sendJson(res, 201, {
        ok: true,
        data: ticket,
        message: `Ticket radicado exitosamente. Número: ${ticket.ticketNumber}`,
      });
    } catch (err) {
      sendJson(res, 400, { ok: false, message: err.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

async function handleTicketById(req, res, url) {
  const auth = requirePortalAuth(req, res);
  if (!auth) return;

  const id = Number(url.pathname.split("/")[3]);
  if (!id) return sendJson(res, 400, { ok: false, message: "ID inválido" });

  if (req.method === "GET") {
    try {
      const ticket = await repo.getTicketById(id);
      if (!ticket) return sendJson(res, 404, { ok: false, message: "Ticket no encontrado" });
      sendJson(res, 200, { ok: true, data: ticket });
    } catch (err) {
      sendJson(res, 500, { ok: false, message: err.message });
    }
    return;
  }

  if (req.method === "PATCH") {
    try {
      const body = await readJsonBody(req);

      // Solo TH/Admin puede cambiar status a RESPONDIDA o CERRADA
      const targetStatus = safe(body.status).toUpperCase();
      if (
        ["RESPONDIDA", "CERRADA", "EN_PROCESO"].includes(targetStatus) &&
        !isAdminOrTH(auth.user)
      ) {
        return sendJson(res, 403, {
          ok: false,
          message: "Solo Talento Humano puede responder o cerrar tickets",
        });
      }

      const updated = await repo.updateTicket(id, body, auth.user);

      // Notificación al creador del ticket
      if (updated.createdByUserId && isAdminOrTH(auth.user)) {
        const notifTitle =
          targetStatus === "RESPONDIDA" ? "Solicitud respondida" :
          targetStatus === "CERRADA"    ? "Solicitud cerrada"    :
          "Solicitud actualizada";

        await repo.createNotification(
          updated.createdByUserId,
          notifTitle,
          `Tu solicitud ${updated.ticketNumber} ha sido ${targetStatus.toLowerCase()}.`,
          "ticket",
          "ticket",
          id
        );
      }

      await repo.addAuditLog(
        auth.user.id, auth.user.name || auth.user.username,
        `ACTUALIZAR_TICKET:${targetStatus || "UPDATE"}`,
        "ticket", id, "OK", body.responseText || ""
      );

      sendJson(res, 200, { ok: true, data: updated });
    } catch (err) {
      sendJson(res, 400, { ok: false, message: err.message });
    }
    return;
  }

  sendMethodNotAllowed(res);
}

// ─── DOCUMENTOS AUTOMÁTICOS ───────────────────────────────────────────────────

async function handleDocumentoAutomatico(req, res) {
  if (req.method !== "POST") return sendMethodNotAllowed(res);
  const auth = requirePortalAuth(req, res);
  if (!auth) return;

  try {
    const body = await readJsonBody(req);
    const docType  = safe(body.docType).toUpperCase();
    const email    = safe(body.email);
    const empName  = safe(body.employeeName);
    const empId    = body.employeeId ? String(body.employeeId) : null;
    const period   = safe(body.period);

    if (!repo.AUTO_DOC_TYPES.includes(docType)) {
      return sendJson(res, 400, {
        ok: false,
        message: "Tipo de documento no válido para envío automático",
      });
    }

    if (!email) {
      return sendJson(res, 422, {
        ok: false,
        message: "No existe un correo electrónico registrado para este colaborador.",
        code: "NO_EMAIL",
      });
    }

    // Registrar el envío en la BD (el servidor de email se configura aparte)
    const delivery = await repo.registerDocDelivery(
      {
        employeeId:   empId,
        employeeName: empName,
        email,
        docType,
        period,
        status: "ENVIADO",
      },
      auth.user
    );

    // Log de auditoría
    await repo.addAuditLog(
      auth.user.id, auth.user.name || auth.user.username,
      `ENVIO_DOCUMENTO:${docType}`,
      "doc_delivery", delivery.id, "OK",
      `Destinatario: ${email}`
    );

    // Notificación interna al mismo usuario
    await repo.createNotification(
      auth.user.id,
      "Documento enviado",
      `El documento "${docType}" fue enviado al correo ${email}.`,
      "doc_delivery",
      "doc_delivery",
      delivery.id
    );

    sendJson(res, 200, {
      ok: true,
      message: "El documento fue enviado correctamente al correo registrado.",
      data: {
        deliveryId: delivery.id,
        email,
        docType,
        sentAt: delivery.created_at,
      },
    });
  } catch (err) {
    console.error("[portal] doc automático error:", err.message);
    sendJson(res, 500, { ok: false, message: err.message });
  }
}

// ─── NOTIFICACIONES ───────────────────────────────────────────────────────────

async function handleNotificaciones(req, res, url) {
  if (req.method !== "GET") return sendMethodNotAllowed(res);
  const auth = requirePortalAuth(req, res);
  if (!auth) return;

  try {
    const unreadOnly = url.searchParams.get("unread") === "true";
    const data = await repo.listNotifications(auth.user.id, unreadOnly);
    const unread = await repo.countUnreadNotifications(auth.user.id);
    sendJson(res, 200, { ok: true, data, unread });
  } catch (err) {
    sendJson(res, 500, { ok: false, message: err.message });
  }
}

async function handleNotificacionLeida(req, res, url) {
  if (req.method !== "PATCH") return sendMethodNotAllowed(res);
  const auth = requirePortalAuth(req, res);
  if (!auth) return;

  const parts = url.pathname.split("/");
  const id = parts[3] === "todas" ? null : Number(parts[3]);

  try {
    if (!id) {
      await repo.markAllNotificationsRead(auth.user.id);
    } else {
      await repo.markNotificationRead(id, auth.user.id);
    }
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { ok: false, message: err.message });
  }
}

// ─── AUDITORÍA ────────────────────────────────────────────────────────────────

async function handleAuditLog(req, res, url) {
  if (req.method !== "GET") return sendMethodNotAllowed(res);
  const auth = requirePortalAuth(req, res);
  if (!auth) return;

  // Solo TH y Admin pueden ver el log completo
  if (!isAdminOrTH(auth.user)) {
    return sendJson(res, 403, {
      ok: false,
      message: "Solo Talento Humano o el Administrador pueden ver el registro de auditoría",
    });
  }

  try {
    const filters = {
      userId:     url.searchParams.get("userId") || "",
      entityType: url.searchParams.get("entityType") || "",
      entityId:   url.searchParams.get("entityId") || "",
      dateFrom:   url.searchParams.get("dateFrom") || "",
      dateTo:     url.searchParams.get("dateTo") || "",
    };
    const data = await repo.listAuditLog(filters);
    sendJson(res, 200, { ok: true, data });
  } catch (err) {
    sendJson(res, 500, { ok: false, message: err.message });
  }
}

// ─── TIPOS de documentos (catálogo para el frontend) ─────────────────────────

function handleTiposTicket(req, res) {
  if (req.method !== "GET") return sendMethodNotAllowed(res);
  sendJson(res, 200, {
    ok: true,
    data: {
      automaticos: repo.AUTO_DOC_TYPES,
      tickets: repo.TICKET_TYPES,
      statuses: repo.TICKET_STATUSES,
    },
  });
}

module.exports = {
  handleDashboard,
  handleSoportes,
  handleSoporteById,
  handleTurnos,
  handleTickets,
  handleTicketById,
  handleDocumentoAutomatico,
  handleNotificaciones,
  handleNotificacionLeida,
  handleAuditLog,
  handleTiposTicket,
};
