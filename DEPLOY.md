# EMPIRIA — Guía de Deploy en Railway

## Requisitos previos
- Cuenta en [Railway.app](https://railway.app)
- Repositorio en GitHub con el código de EMPIRIA
- `pg_dump` instalado localmente (para backups)

---

## PASO 1 — Crear proyecto en Railway

1. Ir a **railway.app → New Project → Deploy from GitHub repo**
2. Seleccionar el repositorio `empiria-backend`
3. Railway detectará automáticamente el `Dockerfile` y lo usará como builder

---

## PASO 2 — Agregar PostgreSQL

1. En el proyecto Railway → **+ New → Database → PostgreSQL**
2. Railway crea la DB y expone automáticamente `DATABASE_URL` como variable de entorno
3. Copiar los datos de conexión desde la pestaña **Connect** de la DB

---

## PASO 3 — Variables de entorno en Railway

En **Settings → Variables**, agregar las siguientes:

```
NODE_ENV=production
JWT_SECRET=<generar con: openssl rand -base64 64>
JWT_EXPIRES_IN=8h
CORS_ORIGIN=https://<tu-proyecto>.up.railway.app
R2_ACCOUNT_ID=<tu-account-id>
R2_ACCESS_KEY_ID=<tu-access-key>
R2_SECRET_ACCESS_KEY=<tu-secret-key>
R2_BUCKET_NAME=empiria-documents
R2_PUBLIC_URL=https://pub-xxxx.r2.dev
DISABLE_DEMO_ENDPOINTS=true
```

> `DATABASE_URL` ya viene configurada automáticamente por el plugin de PostgreSQL.
> NO es necesario agregar DB_HOST/DB_USER/etc. si usas DATABASE_URL.

---

## PASO 4 — Importar esquema base (solo primer deploy)

Si es un deploy desde cero, el schema base debe importarse antes de que la app inicie:

```bash
# Obtener DATABASE_URL desde Railway (Settings > Variables)
export DATABASE_URL="postgresql://..."

# Opción A: importar dump local
psql $DATABASE_URL < empiria_db.sql

# Opción B: usar Railway CLI
railway run psql $DATABASE_URL < empiria_db.sql
```

Las migraciones incrementales (`src/db/migrations/*.sql`) se ejecutan **automáticamente** al arrancar la app.

---

## PASO 5 — Primer deploy

Railway hace deploy automático al hacer push a la rama configurada.

Para deploy manual:
```bash
# Instalar Railway CLI
npm install -g @railway/cli

# Login
railway login

# Deploy desde la carpeta del proyecto
railway up
```

---

## PASO 6 — Verificar que está corriendo

```bash
# Health check
curl https://<tu-proyecto>.up.railway.app/status

# Respuesta esperada:
# {"ok":true,"message":"EMPIRIA backend activo"}
```

---

## PASO 7 — Dominio personalizado (opcional)

1. Railway → Settings → Networking → **Custom Domain**
2. Agregar `app.tu-dominio.com`
3. Crear registro CNAME en tu DNS apuntando a `<proyecto>.up.railway.app`
4. Actualizar `CORS_ORIGIN` con el dominio personalizado

---

## Checklist de seguridad antes de producción

- [ ] `JWT_SECRET` generado con `openssl rand -base64 64` (nuevo, no el de dev)
- [ ] `NODE_ENV=production` configurado
- [ ] `CORS_ORIGIN` apunta solo al dominio de producción
- [ ] `DISABLE_DEMO_ENDPOINTS=true`
- [ ] Passwords de usuarios demo cambiados (admin, talento1, operacion1, etc.)
- [ ] `DATABASE_URL` usa la DB de Railway (no la local)
- [ ] R2 configurado y testeado
- [ ] Backup inicial tomado antes del primer deploy productivo

---

## Comandos de mantenimiento

```bash
# Ejecutar migraciones manualmente
npm run db:migrate

# Hacer backup de la DB
npm run db:backup

# Ver logs en Railway
railway logs --tail

# Conectar a la DB de Railway directamente
railway run psql $DATABASE_URL
```

---

## Estructura de archivos para Railway

```
empiria-backend/
├── Dockerfile          ← Railway usa este para build
├── railway.json        ← Configuración de Railway
├── .dockerignore       ← Qué excluir del build
├── .env.example        ← Template de variables (subir a Git)
├── app.js              ← Entrypoint (node app.js)
├── package.json        ← engines.node >= 20
└── src/
    └── db/
        └── migrations/ ← Se ejecutan automáticamente al arrancar
```

---

## Escalado

Railway permite escalar horizontalmente cambiando `numReplicas` en `railway.json`.
Para múltiples réplicas, asegurarse de:
- Mover sesiones/caché a Redis (actualmente en memoria — solo 1 réplica)
- `uploads/` apuntando 100% a R2 (ya implementado en Fase 3)
