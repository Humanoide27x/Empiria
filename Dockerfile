# ─── Stage: production ────────────────────────────────────────────────────────
FROM node:20-alpine

LABEL maintainer="EMPIRIA PAE" \
      description="EMPIRIA — SaaS de Gestión de Talento Humano PAE"

WORKDIR /app

# Crear usuario no-root antes de instalar dependencias
RUN addgroup -S empiria && adduser -S empiria -G empiria

# Instalar dependencias del SO necesarias para paquetes nativos
RUN apk add --no-cache \
      postgresql-client \
      dumb-init

# Copiar manifiestos e instalar SOLO dependencias de producción
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Copiar el código fuente
COPY . .

# Pre-crear directorios de uploads (los módulos los esperan al arrancar)
# En producción los archivos van a R2, pero el código crea los dirs en startup
RUN mkdir -p uploads/documents uploads/novedades backups

# Transferir ownership al usuario no-root
RUN chown -R empiria:empiria /app

USER empiria

EXPOSE 3000

# dumb-init maneja señales correctamente (evita el PID 1 problem de Node)
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "app.js"]
