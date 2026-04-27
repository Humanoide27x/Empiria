const pool = require("../../db/pool");

// MUNICIPIOS
async function getMunicipalities(req, res) {
  try {
    const result = await pool.query(`
      SELECT id, name 
      FROM municipalities 
      ORDER BY name
    `);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.rows));
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Error municipios" }));
  }
}

// INSTITUCIONES
async function getInstitutions(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const municipalityId = url.searchParams.get("municipalityId");

    const result = await pool.query(
      `
      SELECT 
        MIN(id) AS id,
        name,
        MIN(code) AS code
      FROM institutions
      WHERE municipality_id = $1
      GROUP BY name
      ORDER BY name
      `,
      [municipalityId]
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.rows));
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Error instituciones" }));
  }
}

// SEDES
async function getSites(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const institutionId = url.searchParams.get("institutionId");

    const result = await pool.query(
      `
      WITH selected_institution AS (
        SELECT municipality_id, name
        FROM institutions
        WHERE id = $1
      )
      SELECT DISTINCT
        s.id,
        s.name
      FROM educational_sites s
      JOIN institutions i ON i.id = s.institution_id
      JOIN selected_institution si
        ON si.municipality_id = i.municipality_id
       AND si.name = i.name
      ORDER BY s.name
      `,
      [institutionId]
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.rows));
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Error sedes" }));
  }
}

// MODALIDADES
async function getModalities(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const siteId = url.searchParams.get("siteId");

    const result = await pool.query(
      `SELECT id, modality
       FROM site_modalities
       WHERE site_id = $1
       ORDER BY modality`,
      [siteId]
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.rows));
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Error modalidades" }));
  }
}

// ROUTER
function handleEducationRoutes(req, res, url) {
  if (req.method === "GET" && url.pathname === "/education/municipalities") {
    getMunicipalities(req, res);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/education/institutions") {
    getInstitutions(req, res);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/education/sites") {
    getSites(req, res);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/education/modalities") {
    getModalities(req, res);
    return true;
  }

  return false;
}

module.exports = {
  handleEducationRoutes,
};