const {
  findUserById,
  getUsers,
  resetMfaForUser,
  sanitizeUser,
  updateUser,
} = require("../../data/users");

const { getAccessLogs } = require("../../data/accessLogin");
const { readJsonBody } = require("../../http/request");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const {
  getClientIp,
  createSafeAccessLog,
  requireAdministrator,
} = require("../auth/auth.helpers");
const pool = require("../../db/pool");

function handleAdminResetMfa(req, res) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAdministrator(req, res);

  if (!auth) {
    return;
  }

  readJsonBody(req)
    .then((body) => {
      const userId = Number(body.userId);

      if (!userId) {
        sendJson(res, 400, {
          ok: false,
          message: "Debes enviar el userId",
        });
        return;
      }

      const targetUser = findUserById(userId);

      if (!targetUser) {
        sendJson(res, 404, {
          ok: false,
          message: "Usuario no encontrado",
        });
        return;
      }

      const updatedUser = resetMfaForUser(userId);

      createSafeAccessLog({
        username: auth.user.username,
        userId: auth.user.id,
        role: auth.user.role,
        success: true,
        status: "success",
        reason: `admin_reset_mfa_for_user_${userId}`,
        ip: getClientIp(req),
        userAgent: req.headers["user-agent"] || "",
      });

      sendJson(res, 200, {
        ok: true,
        message: `MFA restablecido correctamente para ${targetUser.username}`,
        user: updatedUser,
      });
    })
    .catch((error) => {
      sendJson(res, 400, {
        ok: false,
        message: error.message,
      });
    });
}

function handleUsers(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAdministrator(req, res);

  if (!auth) {
    return;
  }

  const users = getUsers().map((user) => sanitizeUser(user));

  sendJson(res, 200, {
    ok: true,
    users,
  });
}

function handleUserUpdate(req, res, url) {
  if (req.method !== "PUT" && req.method !== "PATCH") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAdministrator(req, res);

  if (!auth) {
    return;
  }

  const userId =
    Number(url.searchParams.get("id")) ||
    Number(url.pathname.split("/").filter(Boolean).pop());

  if (!userId) {
    sendJson(res, 400, {
      ok: false,
      message: "Debes indicar el id del usuario",
    });
    return;
  }

  readJsonBody(req)
    .then((body) => {
      const targetUser = findUserById(userId);

      if (!targetUser) {
        sendJson(res, 404, {
          ok: false,
          message: "Usuario no encontrado",
        });
        return;
      }

      const updatedUser = updateUser(userId, body);

      createSafeAccessLog({
        username: auth.user.username,
        userId: auth.user.id,
        role: auth.user.role,
        success: true,
        status: "success",
        reason: `admin_updated_user_${userId}`,
        ip: getClientIp(req),
        userAgent: req.headers["user-agent"] || "",
      });

      sendJson(res, 200, {
        ok: true,
        message: "Usuario actualizado correctamente",
        user: sanitizeUser(updatedUser),
      });
    })
    .catch((error) => {
      sendJson(res, 400, {
        ok: false,
        message: error.message,
      });
    });
}

function handleAccessLogs(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAdministrator(req, res);

  if (!auth) {
    return;
  }

  try {
    const logs = getAccessLogs();

    sendJson(res, 200, {
      ok: true,
      logs,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message: "No fue posible consultar los access logs",
      detail: error.message,
    });
  }
}

async function handleMunicipalityIntegrity(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res);
    return;
  }

  const auth = requireAdministrator(req, res);
  if (!auth) return;

  try {
    const [
      duplicateMunicipalities,
      employeesNoMunicipality,
      employeesInvalidMunicipality,
      institutionsNoMunicipality,
      orphanSites,
      coverageRowsNoMunicipality,
      payrollGroupsNoMunicipality,
      coverageRowsInvalidMunicipality,
      payrollGroupsInvalidMunicipality,
    ] = await Promise.all([
      pool.query(`
        SELECT normalized_name, ARRAY_AGG(id ORDER BY id) AS municipality_ids, ARRAY_AGG(name ORDER BY id) AS municipality_names
        FROM municipalities
        WHERE NULLIF(TRIM(COALESCE(normalized_name, '')), '') IS NOT NULL
        GROUP BY normalized_name
        HAVING COUNT(*) > 1
        ORDER BY normalized_name
        LIMIT 100
      `),
      // Empleados activos sin municipality_id
      pool.query(`
        SELECT id, full_name, document_number, real_position, status, contract_id, company_id
        FROM employees
        WHERE municipality_id IS NULL
          AND UPPER(TRIM(COALESCE(status, ''))) NOT IN ('RETIRADO','RETIRADA','INACTIVO','INACTIVA')
        ORDER BY full_name
        LIMIT 200
      `),
      // Empleados con municipality_id que no existe en el catálogo
      pool.query(`
        SELECT e.id, e.full_name, e.municipality_id
        FROM employees e
        WHERE e.municipality_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM municipalities m WHERE m.id = e.municipality_id)
        ORDER BY e.full_name
        LIMIT 200
      `),
      // Instituciones sin municipality_id
      pool.query(`
        SELECT id, name FROM institutions WHERE municipality_id IS NULL ORDER BY name LIMIT 200
      `),
      // Sedes educativas sin institución válida
      pool.query(`
        SELECT s.id, s.name, s.institution_id
        FROM educational_sites s
        WHERE s.institution_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM institutions i WHERE i.id = s.institution_id)
        ORDER BY s.name
        LIMIT 200
      `),
      // Filas de cobertura sin municipality_id
      pool.query(`
        SELECT DISTINCT municipality, COUNT(*) AS rows
        FROM coverage_upload_rows
        WHERE municipality_id IS NULL
          AND municipality IS NOT NULL
          AND TRIM(municipality) <> ''
        GROUP BY municipality
        ORDER BY rows DESC
        LIMIT 100
      `),
      // Grupos de nómina sin municipality_id (si la tabla existe)
      pool.query(`
        SELECT id, operational_position AS group_name, municipality_id FROM payroll_groups
        WHERE municipality_id IS NULL
        ORDER BY operational_position
        LIMIT 100
      `).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT id, upload_id, municipality, municipality_id
        FROM coverage_upload_rows cur
        WHERE municipality_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM municipalities m WHERE m.id = cur.municipality_id)
        ORDER BY upload_id DESC, id DESC
        LIMIT 100
      `),
      pool.query(`
        SELECT id, operational_position AS group_name, municipality_id
        FROM payroll_groups pg
        WHERE municipality_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM municipalities m WHERE m.id = pg.municipality_id)
        ORDER BY operational_position
        LIMIT 100
      `).catch(() => ({ rows: [] })),
    ]);

    sendJson(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      report: {
        duplicateMunicipalities: {
          count: duplicateMunicipalities.rows.length,
          rows: duplicateMunicipalities.rows,
        },
        employeesWithoutMunicipality: {
          count: employeesNoMunicipality.rows.length,
          rows: employeesNoMunicipality.rows,
        },
        employeesWithInvalidMunicipalityId: {
          count: employeesInvalidMunicipality.rows.length,
          rows: employeesInvalidMunicipality.rows,
        },
        institutionsWithoutMunicipality: {
          count: institutionsNoMunicipality.rows.length,
          rows: institutionsNoMunicipality.rows,
        },
        orphanEducationalSites: {
          count: orphanSites.rows.length,
          rows: orphanSites.rows,
        },
        coverageRowsWithoutMunicipalityId: {
          count: coverageRowsNoMunicipality.rows.length,
          rows: coverageRowsNoMunicipality.rows,
        },
        coverageRowsWithInvalidMunicipalityId: {
          count: coverageRowsInvalidMunicipality.rows.length,
          rows: coverageRowsInvalidMunicipality.rows,
        },
        payrollGroupsWithoutMunicipality: {
          count: payrollGroupsNoMunicipality.rows.length,
          rows: payrollGroupsNoMunicipality.rows,
        },
        payrollGroupsWithInvalidMunicipalityId: {
          count: payrollGroupsInvalidMunicipality.rows.length,
          rows: payrollGroupsInvalidMunicipality.rows,
        },
      },
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message: "Error al generar reporte de integridad",
      detail: error.message,
    });
  }
}

module.exports = {
  handleAdminResetMfa,
  handleUsers,
  handleUserUpdate,
  handleAccessLogs,
  handleMunicipalityIntegrity,
};
