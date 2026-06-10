"use strict";

class TTLCache {
  constructor(defaultTtlMs = 60_000) {
    this._store = new Map();
    this._defaultTtl = defaultTtlMs;
  }

  set(key, value, ttlMs) {
    this._store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this._defaultTtl),
    });
  }

  get(key) {
    const entry = this._store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key) { return this.get(key) !== undefined; }

  invalidate(key) { this._store.delete(key); }

  invalidateAll() { this._store.clear(); }

  async getOrSet(key, fn, ttlMs) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await fn();
    this.set(key, value, ttlMs);
    return value;
  }

  purgeExpired() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (now > entry.expiresAt) this._store.delete(key);
    }
  }
}

const personnelCache    = new TTLCache(2 * 60 * 1000);   // 2 min
const dashboardCache    = new TTLCache(5 * 60 * 1000);   // 5 min
const queryCache        = new TTLCache(30 * 1000);         // 30 s
const municipalityCache = new TTLCache(60 * 60 * 1000);  // 1 hora

setInterval(() => {
  personnelCache.purgeExpired();
  dashboardCache.purgeExpired();
  queryCache.purgeExpired();
  municipalityCache.purgeExpired();
}, 5 * 60 * 1000).unref();

module.exports = { TTLCache, personnelCache, dashboardCache, queryCache, municipalityCache };
