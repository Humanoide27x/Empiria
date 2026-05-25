"use strict";

const {
  handleContractualMeta,
  handleMasterCatalog,
  handleMasterCatalogById,
  handleContractSummary,
  handleContractPositionRules,
  handleContractPositionRuleById,
  handleContractDocumentRules,
  handleContractDocumentRuleById,
  handleContractExperienceRules,
  handleContractExperienceRuleById,
  handleContractCoverageRules,
  handleContractCoverageRuleById,
  handleContractMunicipalities,
  handleContractModalities,
  handleEmployeeAssignments,
  handleEmployeeAssignmentHistory,
  handleEmployeeDocumentCompliance,
  handleEmployeeExperienceSummary,
  handleEmployeeExperienceEvaluation,
  handleEmployeeCoverageContext,
  handleEmploymentCertificates,
} = require("./contractual.controller");

async function handleContractualRoutes(req, res, url) {
  const path = url.pathname;

  if (path === "/admin/contractual/meta") {
    await handleContractualMeta(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/master\/[a-z-]+\/\d+$/.test(path)) {
    await handleMasterCatalogById(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/master\/[a-z-]+$/.test(path)) {
    await handleMasterCatalog(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/contracts\/\d+\/summary$/.test(path)) {
    await handleContractSummary(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/contracts\/\d+\/position-rules$/.test(path)) {
    await handleContractPositionRules(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/position-rules\/\d+$/.test(path)) {
    await handleContractPositionRuleById(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/contracts\/\d+\/document-rules$/.test(path)) {
    await handleContractDocumentRules(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/document-rules\/\d+$/.test(path)) {
    await handleContractDocumentRuleById(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/contracts\/\d+\/experience-rules$/.test(path)) {
    await handleContractExperienceRules(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/experience-rules\/\d+$/.test(path)) {
    await handleContractExperienceRuleById(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/contracts\/\d+\/coverage-rules$/.test(path)) {
    await handleContractCoverageRules(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/coverage-rules\/\d+$/.test(path)) {
    await handleContractCoverageRuleById(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/contracts\/\d+\/municipalities$/.test(path)) {
    await handleContractMunicipalities(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/contracts\/\d+\/modalities$/.test(path)) {
    await handleContractModalities(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/employees\/\d+\/assignments$/.test(path)) {
    await handleEmployeeAssignments(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/employees\/\d+\/history$/.test(path)) {
    await handleEmployeeAssignmentHistory(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/employees\/\d+\/document-compliance$/.test(path)) {
    await handleEmployeeDocumentCompliance(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/employees\/\d+\/experience-summary$/.test(path)) {
    await handleEmployeeExperienceSummary(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/employees\/\d+\/experience-evaluation$/.test(path)) {
    await handleEmployeeExperienceEvaluation(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/employees\/\d+\/coverage-context$/.test(path)) {
    await handleEmployeeCoverageContext(req, res, url);
    return true;
  }

  if (/^\/admin\/contractual\/employees\/\d+\/certificates$/.test(path)) {
    await handleEmploymentCertificates(req, res, url);
    return true;
  }

  return false;
}

module.exports = { handleContractualRoutes };
