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

module.exports = {
  handleAdminResetMfa,
  handleUsers,
  handleUserUpdate,
  handleAccessLogs,
};