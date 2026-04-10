const {
  listEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee,
} = require("./employees.service");

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

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
        reject(new Error("JSON inválido"));
      }
    });

    req.on("error", reject);
  });
}

function normalizePathname(req) {
  const baseUrl = `http://${req.headers.host || "localhost"}`;
  const url = new URL(req.url, baseUrl);
  return url.pathname.replace(/\/+$/, "") || "/";
}

function getEmployeeIdFromPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  if (parts[0] !== "personnel" && parts[0] !== "employees") {
    return null;
  }

  return parts[1] || null;
}

function getCurrentUser(req) {
  return req.user || req.authUser || req.currentUser || null;
}

function isAdministrator(user) {
  if (!user) {
    return false;
  }

  const role = String(user.role || "").toLowerCase();
  return role === "administrador" || role === "admin";
}

function sameValue(a, b) {
  if (a === undefined || a === null || a === "") {
    return true;
  }

  if (b === undefined || b === null || b === "") {
    return true;
  }

  return String(a) === String(b);
}

function normalizeMunicipalities(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function employeeBelongsToScope(employee, user) {
  if (!user || isAdministrator(user)) {
    return true;
  }

  const userCompanyId = user.companyId ?? user.company ?? null;
  const userContractId = user.contractId ?? user.contract ?? null;
  const userMunicipalities = normalizeMunicipalities(
    user.assignedMunicipalities || user.municipalities
  );

  const employeeCompanyId = employee.companyId ?? employee.company ?? null;
  const employeeContractId = employee.contractId ?? employee.contract ?? null;
  const employeeMunicipality =
    employee.municipality ||
    employee.municipio ||
    employee.assignedMunicipality ||
    null;

  const companyOk = sameValue(userCompanyId, employeeCompanyId);
  const contractOk = sameValue(userContractId, employeeContractId);

  let municipalityOk = true;

  if (userMunicipalities.length > 0) {
    municipalityOk = userMunicipalities.some(
      (item) =>
        String(item).toLowerCase() ===
        String(employeeMunicipality || "").toLowerCase()
    );
  }

  return companyOk && contractOk && municipalityOk;
}

function applyScope(employees, user) {
  if (!Array.isArray(employees)) {
    return [];
  }

  return employees.filter((employee) => employeeBelongsToScope(employee, user));
}

async function handlePersonnel(req, res) {
  const pathname = normalizePathname(req);
  const method = String(req.method || "GET").toUpperCase();
  const currentUser = getCurrentUser(req);
  const employeeId = getEmployeeIdFromPath(pathname);

  try {
    if (
      method === "GET" &&
      (pathname === "/personnel" || pathname === "/employees")
    ) {
      const employees = listEmployees();
      const scopedEmployees = applyScope(employees, currentUser);

      return sendJson(res, 200, {
        ok: true,
        data: scopedEmployees,
      });
    }

    if (
      method === "GET" &&
      employeeId &&
      (pathname.startsWith("/personnel/") || pathname.startsWith("/employees/"))
    ) {
      const employee = getEmployeeById(employeeId);

      if (!employee) {
        return sendJson(res, 404, {
          ok: false,
          message: "Empleado no encontrado",
        });
      }

      if (!employeeBelongsToScope(employee, currentUser)) {
        return sendJson(res, 403, {
          ok: false,
          message: "No tienes permiso para ver este empleado",
        });
      }

      return sendJson(res, 200, {
        ok: true,
        data: employee,
      });
    }

    if (
      method === "POST" &&
      (pathname === "/personnel" || pathname === "/employees")
    ) {
      const payload = await readJsonBody(req);

      if (!isAdministrator(currentUser)) {
        if (currentUser?.companyId && !payload.companyId && !payload.company) {
          payload.companyId = currentUser.companyId;
        }

        if (currentUser?.contractId && !payload.contractId && !payload.contract) {
          payload.contractId = currentUser.contractId;
        }

        if (
          currentUser?.assignedMunicipalities &&
          currentUser.assignedMunicipalities.length === 1 &&
          !payload.municipality &&
          !payload.municipio
        ) {
          payload.municipality = currentUser.assignedMunicipalities[0];
        }
      }

      const createdEmployee = createEmployee(payload);

      return sendJson(res, 201, {
        ok: true,
        message: "Empleado creado correctamente",
        data: createdEmployee,
      });
    }

    if (
      (method === "PUT" || method === "PATCH") &&
      employeeId &&
      (pathname.startsWith("/personnel/") || pathname.startsWith("/employees/"))
    ) {
      const existingEmployee = getEmployeeById(employeeId);

      if (!existingEmployee) {
        return sendJson(res, 404, {
          ok: false,
          message: "Empleado no encontrado",
        });
      }

      if (!employeeBelongsToScope(existingEmployee, currentUser)) {
        return sendJson(res, 403, {
          ok: false,
          message: "No tienes permiso para editar este empleado",
        });
      }

      const payload = await readJsonBody(req);
      const updatedEmployee = updateEmployee(employeeId, payload);

      return sendJson(res, 200, {
        ok: true,
        message: "Empleado actualizado correctamente",
        data: updatedEmployee,
      });
    }

    if (
      method === "DELETE" &&
      employeeId &&
      (pathname.startsWith("/personnel/") || pathname.startsWith("/employees/"))
    ) {
      const existingEmployee = getEmployeeById(employeeId);

      if (!existingEmployee) {
        return sendJson(res, 404, {
          ok: false,
          message: "Empleado no encontrado",
        });
      }

      if (!employeeBelongsToScope(existingEmployee, currentUser)) {
        return sendJson(res, 403, {
          ok: false,
          message: "No tienes permiso para eliminar este empleado",
        });
      }

      const deleted = deleteEmployee(employeeId);

      return sendJson(res, 200, {
        ok: true,
        message: deleted
          ? "Empleado eliminado correctamente"
          : "No fue posible eliminar el empleado",
      });
    }

    return sendJson(res, 404, {
      ok: false,
      message: "Ruta de empleados no encontrada",
    });
  } catch (error) {
    console.error("Error en módulo employees:", error);

    return sendJson(res, 500, {
      ok: false,
      message: error.message || "Error interno en módulo employees",
    });
  }
}

async function handleEmployees(req, res) {
  return handlePersonnel(req, res);
}

module.exports = {
  handlePersonnel,
  handleEmployees,
};