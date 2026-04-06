const crypto = require("crypto");
const { ROLES } = require("../auth/permissions");
const { readCollection, writeCollection } = require("./store");

const USERS_FILE = "users.json";
const COMPANIES_FILE = "companies.json";
const CONTRACTS_FILE = "contracts.json";

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function getUsers() {
  return readCollection(USERS_FILE);
}

function saveUsers(users) {
  return writeCollection(USERS_FILE, users);
}

function getCompanies() {
  return readCollection(COMPANIES_FILE);
}

function getContracts() {
  return readCollection(CONTRACTS_FILE);
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  const { passwordHash, mfaSecret, ...safeUser } = user;
  return safeUser;
}

function findUserByCredentials(username, password) {
  const passwordHash = hashPassword(password);

  return (
    getUsers().find(
      (user) => user.username === username && user.passwordHash === passwordHash,
    ) || null
  );
}

function findUserById(userId) {
  return getUsers().find((user) => user.id === userId) || null;
}

function findUserByUsername(username) {
  return getUsers().find((user) => user.username === username) || null;
}

function getNextUserId(users) {
  const ids = users.map((user) => user.id);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function validateRole(role) {
  return Object.values(ROLES).includes(role);
}

function createUser(payload) {
  const users = getUsers();

  if (!payload.username || !payload.password || !payload.name || !payload.role) {
    throw new Error("Faltan datos obligatorios del usuario");
  }

  if (findUserByUsername(payload.username)) {
    throw new Error("El nombre de usuario ya existe");
  }

  if (!validateRole(payload.role)) {
    throw new Error("El rol enviado no existe");
  }

  const newUser = {
    id: getNextUserId(users),
    username: payload.username,
    passwordHash: hashPassword(payload.password),
    name: payload.name,
    role: payload.role,
    companyId: payload.companyId ?? null,
    contractId: payload.contractId ?? null,
    assignedMunicipalities: payload.assignedMunicipalities || [],

    // MFA local
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
  const index = users.findIndex((user) => user.id === userId);

  if (index === -1) {
    throw new Error("Usuario no encontrado");
  }

  if (payload.role && !validateRole(payload.role)) {
    throw new Error("El rol enviado no existe");
  }

  if (
    payload.username &&
    payload.username !== users[index].username &&
    findUserByUsername(payload.username)
  ) {
    throw new Error("El nombre de usuario ya existe");
  }

  const updatedUser = {
    ...users[index],
    ...(payload.username ? { username: payload.username } : {}),
    ...(payload.name ? { name: payload.name } : {}),
    ...(payload.role ? { role: payload.role } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "companyId")
      ? { companyId: payload.companyId }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "contractId")
      ? { contractId: payload.contractId }
      : {}),
    ...(payload.assignedMunicipalities
      ? { assignedMunicipalities: payload.assignedMunicipalities }
      : {}),
    ...(payload.password ? { passwordHash: hashPassword(payload.password) } : {}),

    // MFA
    ...(Object.prototype.hasOwnProperty.call(payload, "mfaEnabled")
      ? { mfaEnabled: payload.mfaEnabled }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "mfaSecret")
      ? { mfaSecret: payload.mfaSecret }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "mfaConfirmedAt")
      ? { mfaConfirmedAt: payload.mfaConfirmedAt }
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
  };

  saveUsers(users);

  return sanitizeUser(users[index]);
}

function saveMfaSecret(userId, secret) {
  const users = getUsers();
  const index = users.findIndex((user) => user.id === userId);

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
  const index = users.findIndex((user) => user.id === userId);

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
  const index = users.findIndex((user) => user.id === userId);

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
};