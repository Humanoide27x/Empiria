const {
  handleRequests,
  handleRequestById,
  handleRequestsSummary,
  handleRequestTypes,
} = require("./requests.controller");

async function handleEmployeeRequestsRoutes(req, res, url) {
  const { pathname } = url;

  if (pathname === "/employee-requests/summary") {
    await handleRequestsSummary(req, res, url);
    return true;
  }

  if (pathname === "/employee-requests/types") {
    handleRequestTypes(req, res);
    return true;
  }

  // /employee-requests/:id
  if (/^\/employee-requests\/\d+$/.test(pathname)) {
    await handleRequestById(req, res, url);
    return true;
  }

  // /employee-requests
  if (pathname === "/employee-requests") {
    await handleRequests(req, res, url);
    return true;
  }

  return false;
}

module.exports = { handleEmployeeRequestsRoutes };
