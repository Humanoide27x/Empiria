function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });

  res.end(JSON.stringify(payload, null, 2));
}

function sendNotFound(res) {
  sendJson(res, 404, {
    ok: false,
    message: "Ruta no encontrada",
  });
}

function sendMethodNotAllowed(res) {
  sendJson(res, 405, {
    ok: false,
    message: "Metodo no permitido",
  });
}

module.exports = {
  sendJson,
  sendNotFound,
  sendMethodNotAllowed,
};
