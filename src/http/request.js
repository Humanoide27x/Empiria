function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("El cuerpo de la solicitud no es JSON valido"));
      }
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.slice("Bearer ".length).trim();
}

/**
 * Extrae los parámetros de alcance desde la URL
 * (empresa, contrato, municipio)
 */
function parseResourceFromRequest(url) {
  if (!url || !url.searchParams) {
    return {
      companyId: null,
      contractId: null,
      municipality: null,
    };
  }

  const companyId = url.searchParams.get("companyId");
  const contractId = url.searchParams.get("contractId");
  const municipality = url.searchParams.get("municipality");

  return {
    companyId: companyId ? Number(companyId) : null,
    contractId: contractId ? Number(contractId) : null,
    municipality: municipality || null,
  };
}

module.exports = {
  readJsonBody,
  getBearerToken,
  parseResourceFromRequest,
};