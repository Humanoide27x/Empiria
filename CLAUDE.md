# EMPIRIA — Instrucciones para Claude Code

Este archivo guía a Claude Code en la optimización de velocidad del proyecto EMPIRIA.
Lee todo antes de ejecutar cualquier cambio.

---

## Estructura del proyecto

```
empiria-backend/
├── app.js                  ← Entrada principal (Express)
├── src/
│   ├── app.js              ← Configuración Express (compression, helmet, etc.)
│   ├── server.js           ← Router principal legacy (http.createServer)
│   ├── db/
│   │   ├── pool.js         ← Pool de PostgreSQL (pg)
│   │   └── migrations/     ← Migraciones SQL (se ejecutan al arrancar)
│   ├── data/
│   │   ├── personnel.js    ← Datos de personal (lee JSON del disco)
│   │   └── payroll_config.js ← Config de nómina (lee JSON del disco)
│   ├── modules/            ← Módulos de negocio (employees, dashboard, etc.)
│   ├── middleware/         ← logger, cors, upload, request-id
│   └── utils/              ← Utilidades compartidas
└── public/                 ← Frontend (HTML + JS módulos nativos ES)
    ├── index.html
    ├── styles.css
    └── js/
        ├── api.js          ← Capa de fetch con caché de sesión y deduplicación
        ├── app.js          ← Entrada del frontend
        └── modules/        ← Módulos UI (personnel.js, dashboard.js, etc.)
```

---

## Objetivo

Optimizar la velocidad en **todos los procesos** del sistema:
- Eliminar lecturas de disco repetitivas en cada request
- Cachear consultas frecuentes a PostgreSQL
- Añadir índices en las columnas más consultadas
- Mejorar el pool de conexiones a la BD
- Reducir requests redundantes desde el frontend

---

## TAREA 1 — Crear módulo de caché en memoria

**Archivo a crear:** `src/utils/cache.js`

Crea un módulo con una clase `TTLCache` y exporta instancias preconfiguradas:

```js
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

const personnelCache   = new TTLCache(2 * 60 * 1000);   // 2 min
const dashboardCache   = new TTLCache(5 * 60 * 1000);   // 5 min
const queryCache       = new TTLCache(30 * 1000);         // 30 s
const municipalityCache = new TTLCache(60 * 60 * 1000);  // 1 hora

setInterval(() => {
  personnelCache.purgeExpired();
  dashboardCache.purgeExpired();
  queryCache.purgeExpired();
  municipalityCache.purgeExpired();
}, 5 * 60 * 1000).unref();

module.exports = { TTLCache, personnelCache, dashboardCache, queryCache, municipalityCache };
```

---

## TAREA 2 — Cachear lecturas de personal

**Archivo:** `src/data/personnel.js`

**Problema:** `readPersonnel()` hace `fs.readFileSync` + `JSON.parse` en **cada request**. Con cientos de empleados puede ser 50–200ms de overhead por petición.

**Cambios a aplicar:**

1. Al inicio del archivo, agregar el import:
```js
const { personnelCache } = require("../utils/cache");
const CACHE_KEY = "personnel_data";
```

2. Reemplazar la función `readPersonnel()` con:
```js
function readPersonnel() {
  const cached = personnelCache.get(CACHE_KEY);
  if (cached !== undefined) return cached;
  if (!fs.existsSync(filePath)) {
    personnelCache.set(CACHE_KEY, []);
    return [];
  }
  const data = fs.readFileSync(filePath, "utf-8");
  const parsed = data ? JSON.parse(data) : [];
  personnelCache.set(CACHE_KEY, parsed);
  return parsed;
}
```

3. Reemplazar la función `writePersonnel()` con:
```js
function writePersonnel(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  personnelCache.invalidate(CACHE_KEY); // invalida caché al escribir
}
```

---

## TAREA 3 — Cachear configuración de nómina

**Archivo:** `src/data/payroll_config.js`

**Problema:** `getPayrollConfig()` hace `fs.readFileSync` en cada llamada desde el dashboard y la calculadora.

**Cambios a aplicar:**

Justo antes de la función `getPayrollConfig()`, agregar las variables de caché:
```js
let _payrollConfigCache = null;
let _payrollConfigCacheAt = 0;
const PAYROLL_CONFIG_TTL_MS = 5 * 60 * 1000;
```

Reemplazar `getPayrollConfig()` con:
```js
function getPayrollConfig() {
  const now = Date.now();
  if (_payrollConfigCache && (now - _payrollConfigCacheAt) < PAYROLL_CONFIG_TTL_MS) {
    return _payrollConfigCache;
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    _payrollConfigCache = { ...DEFAULT_CONFIG };
    _payrollConfigCacheAt = now;
    return _payrollConfigCache;
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const saved = JSON.parse(raw);
    _payrollConfigCache = {
      ...DEFAULT_CONFIG,
      ...saved,
      modalitySalaries: { ...DEFAULT_CONFIG.modalitySalaries, ...(saved.modalitySalaries || {}) },
    };
    _payrollConfigCacheAt = now;
    return _payrollConfigCache;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
```

En `updatePayrollConfig()`, después de `fs.writeFileSync(...)`, agregar:
```js
_payrollConfigCache = updated;
_payrollConfigCacheAt = Date.now();
```

---

## TAREA 4 — Cachear resolución de municipios

**Archivo:** `src/modules/employees/repository.js`

**Problema:** La función `resolveMunicipalityId(name)` hace un `SELECT` a PostgreSQL por cada municipio procesado. En importaciones masivas (50–200 filas), genera docenas de queries innecesarias a datos que casi nunca cambian.

**Cambios a aplicar:**

1. En la primera línea del archivo, agregar:
```js
const { municipalityCache } = require("../../utils/cache");
```

2. Dentro de `resolveMunicipalityId()`, reemplazar el bloque del `pool.query(...)` para que use caché antes de consultar la BD:
```js
// Al inicio de la función, después de validar que `name` no está vacío:
const cacheKey = `mun_name:${name.toUpperCase()}`;
const cached = municipalityCache.get(cacheKey);
if (cached !== undefined) return cached;

const result = await pool.query(
  `SELECT id FROM municipalities WHERE UPPER(TRIM(name)) = UPPER(TRIM($1)) LIMIT 1`,
  [name]
);
const id = result.rows[0]?.id || null;
municipalityCache.set(cacheKey, id);
return id;
```

Aplica el mismo patrón a cualquier otra función en ese archivo que consulte municipios por nombre.

---

## TAREA 5 — Optimizar el pool de PostgreSQL

**Archivo:** `src/db/pool.js`

**Cambios en ambas configuraciones** (la de `DATABASE_URL` y la local):

| Parámetro | Valor anterior | Valor nuevo |
|-----------|---------------|-------------|
| `max` | `10` | `20` |
| `min` | (no existía) | `2` |
| `allowExitOnIdle` | (no existía) | `false` |

Agrega `min: Number(process.env.DB_POOL_MIN \|\| 2)` y `allowExitOnIdle: false` en ambos bloques del `return` dentro de `buildConfig()`.

---

## TAREA 6 — Migración SQL: índices de rendimiento

**Archivo a crear:** `src/db/migrations/065_performance_indexes.sql`

Busca el número del último archivo en `src/db/migrations/` (actualmente termina en `064_...`) y crea el siguiente en orden. El sistema de migraciones lo ejecutará automáticamente al arrancar.

```sql
-- Migración 065: Índices de rendimiento para EMPIRIA
-- Usa CONCURRENTLY para no bloquear la BD durante la creación

-- Activar extensión trigram si no está activa (para búsqueda por nombre)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- employees: columnas más filtradas
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_status
  ON employees(status) WHERE status IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_contract_id
  ON employees(contract_id) WHERE contract_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_company_id
  ON employees(company_id) WHERE company_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_status_contract
  ON employees(status, contract_id) WHERE status IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_full_name_trgm
  ON employees USING gin(full_name gin_trgm_ops) WHERE full_name IS NOT NULL;

-- municipalities: búsqueda por nombre insensible a mayúsculas
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_municipalities_name_upper
  ON municipalities(UPPER(TRIM(name)));

-- contracts: filtro por empresa activa (query más frecuente)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contracts_company_active
  ON contracts(company_id, active) WHERE active = true;

-- employee_documents: filtro por empleado excluyendo eliminados
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employee_documents_employee_id
  ON employee_documents(employee_id) WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employee_documents_type_employee
  ON employee_documents(document_type_id, employee_id) WHERE deleted_at IS NULL;

-- coverage_uploads: ordenamiento por fecha en dashboard
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_coverage_uploads_created_at
  ON coverage_uploads(created_at DESC);

-- training_attendance: joins por empleado
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_training_attendance_employee
  ON training_attendance(employee_id);
```

> **Nota:** `CREATE INDEX CONCURRENTLY` no puede ejecutarse dentro de una transacción. Si el sistema de migraciones usa transacciones, ejecuta este archivo manualmente con: `psql $DATABASE_URL -f src/db/migrations/065_performance_indexes.sql`

---

## TAREA 7 — Verificar y mejorar caché del frontend

**Archivo:** `public/js/api.js`

El frontend ya tiene un buen sistema de caché (`sessionGetCache`, deduplicación `_inFlight`). Verificar que los siguientes endpoints estén incluidos en `isSessionCacheable()`:

```js
/^\\/employees\\/lookup(?:\\?|$)/,     // listado ligero para dropdowns
/^\\/config\\/positions(?:\\?|$)/,     // cargos (raramente cambian)
/^\\/config\\/areas(?:\\?|$)/,         // áreas
```

Si no están, agregarlos al array de patrones en `isSessionCacheable()`.

---

## TAREA 8 — Optimizar carga inicial del dashboard

**Archivo:** `public/js/modules/dashboard.js`

Busca cualquier llamada a `apiFetch` que se haga **secuencialmente** (una tras otra con `await`) cuando podrían hacerse en paralelo con `Promise.all`. Por ejemplo:

```js
// Malo — secuencial:
const kpis = await apiFetch("/dashboard/kpis");
const alerts = await apiFetch("/dashboard/alerts");
const activity = await apiFetch("/dashboard/recent-activity");

// Bueno — paralelo:
const [kpis, alerts, activity] = await Promise.all([
  apiFetch("/dashboard/kpis"),
  apiFetch("/dashboard/alerts"),
  apiFetch("/dashboard/recent-activity"),
]);
```

Aplica `Promise.all` donde haya 2 o más `apiFetch` secuenciales que no dependan entre sí.

---

## TAREA 9 — Named queries en PostgreSQL

**Archivos:** Todos los `*.repository.js` y `*.controller.js` en `src/modules/`

Para las queries que se ejecutan muy frecuentemente (listado de empleados, dashboard summary, etc.), usa **named prepared statements** para que PostgreSQL reutilice el query plan:

```js
// Antes:
const result = await pool.query(
  "SELECT id, full_name FROM employees WHERE status = $1",
  ["ACTIVO"]
);

// Después (PostgreSQL cachea el plan de ejecución):
const result = await pool.query({
  name: "get_active_employees",
  text: "SELECT id, full_name FROM employees WHERE status = $1",
  values: ["ACTIVO"],
});
```

Prioriza las queries más frecuentes:
- Listado de empleados activos
- Lookup de empleado por ID
- Conteo de empleados por contrato
- Listado de contratos activos

---

## TAREA 10 — Limpieza de console.log en producción

**Archivos:** `src/db/pool.js` y cualquier archivo con `console.log` en rutas críticas

En `src/db/pool.js` hay dos `console.log` que se ejecutan en cada inicio del servidor con información de diagnóstico. Envuélvelos en una condición:

```js
if (process.env.NODE_ENV !== "production") {
  console.log("[db] DATABASE_URL EXISTS:", !!dbUrl);
  console.log("[db] DATABASE_URL PREFIX:", ...);
}
```

Busca otros `console.log` en módulos de negocio (`src/modules/`) que se ejecuten en el hot path (dentro de funciones llamadas en cada request) y condicionarlos igual.

---

## Orden de ejecución recomendado

1. `src/utils/cache.js` — crear primero (otros lo importan)
2. `src/data/personnel.js` — modificar
3. `src/data/payroll_config.js` — modificar
4. `src/modules/employees/repository.js` — modificar
5. `src/db/pool.js` — modificar
6. `src/db/migrations/065_performance_indexes.sql` — crear
7. `public/js/api.js` — verificar y ampliar caché frontend
8. `public/js/modules/dashboard.js` — paralelizar fetches
9. Named queries en repositories — aplicar a los más frecuentes
10. Limpiar console.log en producción

---

## Verificación

Después de aplicar los cambios, verifica que el servidor arranca sin errores:

```bash
node app.js
```

Y que la migración de índices se aplicó correctamente:

```bash
node scripts/run-migrations.js
```

Si la migración de índices falla por transacciones, ejecutar manualmente:

```bash
psql $DATABASE_URL -f src/db/migrations/065_performance_indexes.sql
```
