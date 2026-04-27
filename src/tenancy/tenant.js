function getTenantIdFromRequest(req) {
  return 1;
}

// Alias para archivos que están llamando este nombre
function getTenantIdForRequest(req) {
  return getTenantIdFromRequest(req);
}

function attachTenantToRequest(req) {
  req.tenantId = getTenantIdFromRequest(req);
  return req.tenantId;
}

module.exports = {
  getTenantIdFromRequest,
  getTenantIdForRequest,
  attachTenantToRequest,
};