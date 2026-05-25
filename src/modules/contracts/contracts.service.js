const repository = require("./contracts.repository");

const _contractsCache = new Map();
const CONTRACTS_CACHE_TTL_MS = 5 * 60 * 1000;

async function getContracts(tenantId, companyId = null) {
  const key = `${tenantId || ""}|${companyId || ""}`;
  const cached = _contractsCache.get(key);
  if (cached && Date.now() - cached.ts < CONTRACTS_CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await repository.getAllContracts(tenantId, companyId);
  _contractsCache.set(key, { ts: Date.now(), data });
  return data;
}

module.exports = {
  getContracts,
};
