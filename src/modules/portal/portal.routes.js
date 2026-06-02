"use strict";

const {
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
} = require("./portal.controller");

async function handlePortalRoutes(req, res, url) {
  const { pathname } = url;

  if (!pathname.startsWith("/portal")) return false;

  // GET /portal/dashboard
  if (pathname === "/portal/dashboard") {
    await handleDashboard(req, res, url);
    return true;
  }

  // GET /portal/tipos
  if (pathname === "/portal/tipos") {
    handleTiposTicket(req, res);
    return true;
  }

  // GET|POST /portal/soportes
  if (pathname === "/portal/soportes") {
    await handleSoportes(req, res, url);
    return true;
  }

  // GET|PATCH /portal/soportes/:id
  if (/^\/portal\/soportes\/\d+$/.test(pathname)) {
    await handleSoporteById(req, res, url);
    return true;
  }

  // GET /portal/turnos
  if (pathname === "/portal/turnos") {
    await handleTurnos(req, res, url);
    return true;
  }

  // GET|POST /portal/tickets
  if (pathname === "/portal/tickets") {
    await handleTickets(req, res, url);
    return true;
  }

  // GET|PATCH /portal/tickets/:id
  if (/^\/portal\/tickets\/\d+$/.test(pathname)) {
    await handleTicketById(req, res, url);
    return true;
  }

  // POST /portal/documento-automatico
  if (pathname === "/portal/documento-automatico") {
    await handleDocumentoAutomatico(req, res);
    return true;
  }

  // GET /portal/notificaciones
  if (pathname === "/portal/notificaciones") {
    await handleNotificaciones(req, res, url);
    return true;
  }

  // PATCH /portal/notificaciones/:id/leida
  // PATCH /portal/notificaciones/todas/leida
  if (/^\/portal\/notificaciones\/[^/]+\/leida$/.test(pathname)) {
    await handleNotificacionLeida(req, res, url);
    return true;
  }

  // GET /portal/auditoria
  if (pathname === "/portal/auditoria") {
    await handleAuditLog(req, res, url);
    return true;
  }

  return false;
}

module.exports = { handlePortalRoutes };
