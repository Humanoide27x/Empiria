const crypto = require("crypto");
const { ROLES, normalizeRole } = require("../auth/permissions");
const { readCollection, writeCollection } = require("./store");

const USERS_FILE = "users.json";
const COMPANIES_FILE = "companies.json";
const CONTRACTS_FILE = "contracts.json";

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUsername(value) {
  return safeString(value).toLowerCase();
}

function normalizeMunicipalities(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => safeString(item))
    .filter(Boolean);
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function getUsers() {
  const users = readCollection(USERS_FILE);
  return Array.isArray(users) ? users : [];
}

function saveUsers(users) {
  return writeCollection(USERS_FILE, Array.isArray(users) ? users : []);
}

function getCompanies() {
  const companies = readCollection(COMPANIES_FILE);
  return Array.isArray(companies) ? companies : [];
}

function getContracts() {
  const contracts = readCollection(CONTRACTS_FILE);
  return Array.isArray(contracts) ? contracts : [];
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  const { passwordHash, mfaSecret, ...safeUser } = user;
  return safeUser;
}

function findUserByCredentials(username, password) {
  const normalizedUsername = normalizeUsername(username);
  const passwordHash = hashPassword(password);

  return (
    getUsers().find(
      (user) =>
        normalizeUsername(user.username) === normalizedUsername &&
        user.passwordHash === passwordHash
    ) || null
  );
}

function findUserById(userId) {
  return (
    getUsers().find((user) => Number(user.id) === Number(userId)) || null
  );
}

function findUserByUsername(username) {
  const normalizedUsername = normalizeUsername(username);

  return (
    getUsers().find(
      (user) => normalizeUsername(user.username) === normalizedUsername
    ) || null
  );
}

function getNextUserId(users) {
  const ids = users
    .map((user) => Number(user.id))
    .filter((id) => Number.isFinite(id));

  return ids.length ? Math.max(...ids) + 1 : 1;
}

function validateRole(role) {
  return Object.values(ROLES).includes(normalizeRole(role));
}

function createUser(payload) {
  const users = getUsers();

  const username = normalizeUsername(payload.username);
  const password = String(payload.password || "");
  const name = safeString(payload.name);
  const role = normalizeRole(payload.role);

  if (!username || !password || !name || !role) {
    throw new Error("Faltan datos obligatorios del usuario");
  }

  if (findUserByUsername(username)) {
    throw new Error("El nombre de usuario ya existe");
  }

  if (!validateRole(role)) {
    throw new Error("El rol enviado no existe");
  }

  const newUser = {
    id: getNextUserId(users),
    username,
    passwordHash: hashPassword(password),
    name,
    role,
    companyId:
      payload.companyId === "" || payload.companyId == null
        ? null
        : Number(payload.companyId),
    contractId:
      payload.contractId === "" || payload.contractId == null
        ? null
        : Number(payload.contractId),
    assignedMunicipalities: normalizeMunicipalities(
      payload.assignedMunicipalities
    ),

    mfaEnabled: false,
    mfaSecret: null,
    mfaConfirmedAt: null,
  };

  users.push(newUser);
  saveUsers(users);

  return sanitizeUser(newUser);
}

function updateUser(userId, payload) {
  const users = getUsers();
  const index = users.findIndex((user) => Number(user.id) === Number(userId));

  if (index === -1) {
    throw new Error("Usuario no encontrado");
  }

  const nextUsername = Object.prototype.hasOwnProperty.call(payload, "username")
    ? normalizeUsername(payload.username)
    : users[index].username;

  const nextRole = Object.prototype.hasOwnProperty.call(payload, "role")
    ? normalizeRole(payload.role)
    : users[index].role;

  if (!validateRole(nextRole)) {
    throw new Error("El rol enviado no existe");
  }

  const existingUser = findUserByUsername(nextUsername);

  if (
    nextUsername &&
    existingUser &&
    Number(existingUser.id) !== Number(users[index].id)
  ) {
    throw new Error("El nombre de usuario ya existe");
  }

  const updatedUser = {
    ...users[index],
    ...(Object.prototype.hasOwnProperty.call(payload, "username")
      ? { username: nextUsername }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "name")
      ? { name: safeString(payload.name) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "role")
      ? { role: nextRole }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "companyId")
      ? {
          companyId:
            payload.companyId === "" || payload.companyId == null
              ? null
              : Number(payload.companyId),
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "contractId")
      ? {
          contractId:
            payload.contractId === "" || payload.contractId == null
              ? null
              : Number(payload.contractId),
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "assignedMunicipalities")
      ? {
          assignedMunicipalities: normalizeMunicipalities(
            payload.assignedMunicipalities
          ),
        }
      : {}),
    ...(payload.password
      ? { passwordHash: hashPassword(payload.password) }
      : {}),

    ...(Object.prototype.hasOwnProperty.call(payload, "mfaEnabled")
      ? { mfaEnabled: Boolean(payload.mfaEnabled) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "mfaSecret")
      ? { mfaSecret: payload.mfaSecret || null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "mfaConfirmedAt")
      ? { mfaConfirmedAt: payload.mfaConfirmedAt || null }
      : {}),
  };

  users[index] = updatedUser;
  saveUsers(users);

  return sanitizeUser(updatedUser);
}

function resetMfaForUser(userId) {
  const users = getUsers();
  const index = users.findIndex((user) => Number(user.id) === Number(userId));

  if (index === -1) {
    throw new Error("Usuario no encontrado");
  }

  users[index] = {
    ...users[index],
    mfaEnabled: false,
    mfaSecret: null,
    mfaConfirmedAt: null,
  };

  saveUsers(users);

  return sanitizeUser(users[index]);
}

function saveMfaSecret(userId, secret) {
  const users = getUsers();
  const index = users.findIndex((user) => Number(user.id) === Number(userId));

  if (index === -1) {
    throw new Error("Usuario no encontrado");
  }

  users[index] = {
    ...users[index],
    mfaSecret: secret,
    mfaEnabled: false,
    mfaConfirmedAt: null,
  };

  saveUsers(users);
  return sanitizeUser(users[index]);
}

function enableMfaForUser(userId) {
  const users = getUsers();
  const index = users.findIndex((user) => Number(user.id) === Number(userId));

  if (index === -1) {
    throw new Error("Usuario no encontrado");
  }

  if (!users[index].mfaSecret) {
    throw new Error("Primero debes generar el secreto MFA");
  }

  users[index] = {
    ...users[index],
    mfaEnabled: true,
    mfaConfirmedAt: new Date().toISOString(),
  };

  saveUsers(users);
  return sanitizeUser(users[index]);
}

function disableMfaForUser(userId) {
  const users = getUsers();
  const index = users.findIndex((user) => Number(user.id) === Number(userId));

  if (index === -1) {
    throw new Error("Usuario no encontrado");
  }

  users[index] = {
    ...users[index],
    mfaEnabled: false,
    mfaSecret: null,
    mfaConfirmedAt: null,
  };

  saveUsers(users);
  return sanitizeUser(users[index]);
}

module.exports = {
  createUser,
  disableMfaForUser,
  enableMfaForUser,
  findUserByCredentials,
  findUserById,
  findUserByUsername,
  getCompanies,
  getContracts,
  getUsers,
  sanitizeUser,
  saveMfaSecret,
  updateUser,
  resetMfaForUser,
  hashPassword,
};