const { handleResumeView } = require("./documents.controller");

async function handleDocumentsRoutes(req, res, url) {
  if (url.pathname === "/resume-view") {
    await handleResumeView(req, res, url);
    return true;
  }

  return false;
}

module.exports = { handleDocumentsRoutes };