"use strict";

const {
  handlePositions,
  handlePositionById,
  handlePositionStatus,
  handlePositionProfile,
  handlePositionPayrollValues,
  handlePayrollValueById,
  handleDocumentRequirements,
  handleDeleteDocumentRequirement,
  handleDocumentTypes,
  handlePositionsMeta,
} = require("./positions.controller");

async function handlePositionRoutes(req, res, url) {
  const p = url.pathname;

  // Catálogos
  if (p === "/admin/positions/meta") {
    handlePositionsMeta(req, res); return true;
  }
  if (p === "/admin/document-types") {
    await handleDocumentTypes(req, res); return true;
  }

  // Valores de nómina independientes
  if (/^\/admin\/position-payroll-values\/\d+\/status$/.test(p)) {
    await handlePayrollValueById(req, res, url); return true;
  }
  if (/^\/admin\/position-payroll-values\/\d+$/.test(p)) {
    await handlePayrollValueById(req, res, url); return true;
  }

  // Requisitos documentales independientes
  if (/^\/admin\/position-document-requirements\/\d+$/.test(p)) {
    await handleDeleteDocumentRequirement(req, res, url); return true;
  }

  // Recursos anidados bajo /admin/positions/:id
  if (/^\/admin\/positions\/\d+\/status$/.test(p)) {
    await handlePositionStatus(req, res, url); return true;
  }
  if (/^\/admin\/positions\/\d+\/profile$/.test(p)) {
    await handlePositionProfile(req, res, url); return true;
  }
  if (/^\/admin\/positions\/\d+\/payroll-values$/.test(p)) {
    await handlePositionPayrollValues(req, res, url); return true;
  }
  if (/^\/admin\/positions\/\d+\/document-requirements$/.test(p)) {
    await handleDocumentRequirements(req, res, url); return true;
  }
  if (/^\/admin\/positions\/\d+$/.test(p)) {
    await handlePositionById(req, res, url); return true;
  }
  if (p === "/admin/positions") {
    await handlePositions(req, res, url); return true;
  }

  return false;
}

module.exports = { handlePositionRoutes };
