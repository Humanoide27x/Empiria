const {
  handleCatalogoList,
  handleCatalogoCreate,
  handleCatalogoUpdate,
  handleStockList,
  handleStockUpsert,
  handleStockAdjust,
  handleAsignacionesList,
  handleAsignacionCreate,
  handleAsignacionUpdate,
  handleAsignacionDelete,
  handleAsignacionEvidencia,
  handleRemisionesList,
  handleRemisionGet,
  handleRemisionCreate,
  handleRemisionUpdate,
  handleRemisionDelete,
  handleRemisionFoto,
  handleImportarAsignaciones,
  handleFiltrosMunicipios,
  handleFiltrosInstituciones,
  handleFiltrosSedes,
  handleFiltrosModalidades,
  handleEmpleadasParaRemision,
  handleRemisionMarcar,
} = require("./dotacion.controller");

async function handleDotacionRoutes(req, res, url) {
  const { pathname, method } = { pathname: url.pathname, method: req.method };

  // Catálogo
  if (pathname === "/dotacion/catalogo") {
    if (method === "GET") { await handleCatalogoList(req, res, url); return true; }
    if (method === "POST") { await handleCatalogoCreate(req, res, url); return true; }
  }

  const catalogoIdMatch = pathname.match(/^\/dotacion\/catalogo\/(\d+)$/);
  if (catalogoIdMatch) {
    if (method === "PUT") { await handleCatalogoUpdate(req, res, url, Number(catalogoIdMatch[1])); return true; }
  }

  // Stock
  if (pathname === "/dotacion/stock") {
    if (method === "GET") { await handleStockList(req, res, url); return true; }
    if (method === "POST") { await handleStockUpsert(req, res, url); return true; }
  }

  const stockIdMatch = pathname.match(/^\/dotacion\/stock\/(\d+)\/ajustar$/);
  if (stockIdMatch && method === "PATCH") {
    await handleStockAdjust(req, res, url, Number(stockIdMatch[1]));
    return true;
  }

  // Asignaciones
  if (pathname === "/dotacion/asignaciones") {
    if (method === "GET") { await handleAsignacionesList(req, res, url); return true; }
    if (method === "POST") { await handleAsignacionCreate(req, res, url); return true; }
  }

  const asignacionIdMatch = pathname.match(/^\/dotacion\/asignaciones\/(\d+)$/);
  if (asignacionIdMatch) {
    const id = Number(asignacionIdMatch[1]);
    if (method === "PUT")    { await handleAsignacionUpdate(req, res, url, id); return true; }
    if (method === "DELETE") { await handleAsignacionDelete(req, res, url, id); return true; }
  }

  const evidenciaMatch = pathname.match(/^\/dotacion\/asignaciones\/(\d+)\/evidencia$/);
  if (evidenciaMatch && method === "GET") {
    await handleAsignacionEvidencia(req, res, url, Number(evidenciaMatch[1]));
    return true;
  }

  // Filtros para remisiones (ANTES del match /:id)
  if (pathname === "/dotacion/remisiones/municipios"   && method === "GET") { await handleFiltrosMunicipios(req, res, url);    return true; }
  if (pathname === "/dotacion/remisiones/instituciones" && method === "GET") { await handleFiltrosInstituciones(req, res, url); return true; }
  if (pathname === "/dotacion/remisiones/sedes"        && method === "GET") { await handleFiltrosSedes(req, res, url);         return true; }
  if (pathname === "/dotacion/remisiones/modalidades"  && method === "GET") { await handleFiltrosModalidades(req, res, url);   return true; }
  if (pathname === "/dotacion/remisiones/empleadas"    && method === "GET") { await handleEmpleadasParaRemision(req, res, url);return true; }
  if (pathname === "/dotacion/remisiones/importar"     && method === "GET") { await handleImportarAsignaciones(req, res, url); return true; }

  // Remisiones
  if (pathname === "/dotacion/remisiones") {
    if (method === "GET")  { await handleRemisionesList(req, res, url); return true; }
    if (method === "POST") { await handleRemisionCreate(req, res, url); return true; }
  }

  if (pathname === "/dotacion/remisiones/importar") {
    if (method === "GET") { await handleImportarAsignaciones(req, res, url); return true; }
  }

  const remisionIdMatch = pathname.match(/^\/dotacion\/remisiones\/(\d+)$/);
  if (remisionIdMatch) {
    const id = Number(remisionIdMatch[1]);
    if (method === "GET")    { await handleRemisionGet(req, res, url, id); return true; }
    if (method === "PUT")    { await handleRemisionUpdate(req, res, url, id); return true; }
    if (method === "DELETE") { await handleRemisionDelete(req, res, url, id); return true; }
  }

  const remisionEnvRecMatch = pathname.match(/^\/dotacion\/remisiones\/(\d+)\/(enviado|recibido)$/);
  if (remisionEnvRecMatch) {
    const id   = Number(remisionEnvRecMatch[1]);
    const tipo = remisionEnvRecMatch[2];
    await handleRemisionMarcar(req, res, url, id, tipo);
    return true;
  }

  const remisionFotoMatch = pathname.match(/^\/dotacion\/remisiones\/(\d+)\/foto$/);
  if (remisionFotoMatch && method === "PATCH") {
    await handleRemisionFoto(req, res, url, Number(remisionFotoMatch[1]));
    return true;
  }

  return false;
}

module.exports = { handleDotacionRoutes };
