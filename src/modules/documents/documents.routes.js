/**
 * Las rutas /documents ahora las gestiona el Express Router
 * montado en src/app.js (documents.router.js).
 *
 * Este handler siempre retorna false para que el legacy server.js
 * no intercepte ninguna ruta de documentos.
 */
async function handleDocumentsRoutes() {
  return false;
}

module.exports = { handleDocumentsRoutes };
