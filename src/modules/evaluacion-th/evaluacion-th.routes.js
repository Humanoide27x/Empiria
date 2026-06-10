"use strict";

const {
  handleGetCoordinadores,
  handleGetDetalle,
  handleGetMunicipios,
  handleGetDocsFaltantes,
  handleGetChecklistMunicipio,
  handleGetChecklistCompleto,
} = require("./evaluacion-th.controller");

async function handleEvaluacionThRoutes(req, res, url) {
  if (req.method !== "GET") return false;
  if (!url.pathname.startsWith("/evaluacion-th")) return false;

  if (url.pathname === "/evaluacion-th/coordinadores") {
    await handleGetCoordinadores(req, res);
    return true;
  }

  const detalleMatch = url.pathname.match(/^\/evaluacion-th\/coordinadores\/(\d+)\/detalle$/);
  if (detalleMatch) {
    await handleGetDetalle(req, res, detalleMatch[1]);
    return true;
  }

  const munMatch = url.pathname.match(/^\/evaluacion-th\/coordinadores\/(\d+)\/municipios$/);
  if (munMatch) {
    await handleGetMunicipios(req, res, munMatch[1]);
    return true;
  }

  const docsMatch = url.pathname.match(/^\/evaluacion-th\/municipios\/(\d+)\/documentos-faltantes$/);
  if (docsMatch) {
    await handleGetDocsFaltantes(req, res, docsMatch[1]);
    return true;
  }

  const checklistMunMatch = url.pathname.match(/^\/evaluacion-th\/municipios\/(\d+)\/checklist-excel$/);
  if (checklistMunMatch) {
    await handleGetChecklistMunicipio(req, res, checklistMunMatch[1]);
    return true;
  }

  const checklistCoordMatch = url.pathname.match(/^\/evaluacion-th\/coordinadores\/(\d+)\/checklist-excel-completo$/);
  if (checklistCoordMatch) {
    await handleGetChecklistCompleto(req, res, checklistCoordMatch[1]);
    return true;
  }

  return false;
}

module.exports = { handleEvaluacionThRoutes };
