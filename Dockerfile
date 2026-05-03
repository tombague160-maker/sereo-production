# syntax=docker/dockerfile:1.7
# ============================================================================
# Sereo - image de production
# Base : Node 24 sur Alpine. Node 24+ requis pour le module natif `node:sqlite`
# (DatabaseSync) utilise par storage/sqliteStore.js.
# ============================================================================
FROM node:24-alpine

# Tini : init system minimal qui forwarde proprement SIGTERM/SIGINT a Node.
# Sans lui, "docker stop" attend 10s avant un SIGKILL force.
RUN apk add --no-cache tini

# Metadonnees OCI standard (visibles via `docker inspect`)
LABEL org.opencontainers.image.title="Sereo" \
      org.opencontainers.image.description="Application locale de gestion stock, preparation et livraisons" \
      org.opencontainers.image.source="https://github.com/tombague160-maker/sereo-production" \
      org.opencontainers.image.licenses="UNLICENSED"

WORKDIR /app

# Variables d'environnement par defaut. Surchargeables via docker-compose.
# Toutes les variables documentees dans DEPLOYMENT.md / .env.example.
ENV NODE_ENV=production \
    PORT=3000 \
    SEREO_HOST=0.0.0.0 \
    SEREO_STORAGE=sqlite \
    SEREO_SQLITE_PATH=/app/data/sereo.sqlite \
    SEREO_DB_PATH=/app/data/db.json \
    SEREO_BACKUP_DIR=/app/data/backups \
    SEREO_UPLOAD_DIR=/app/uploads \
    SEREO_ENABLE_DB_EXPORT=0

# Etape 1 : install des dependances (couche cachee tant que package*.json ne change pas)
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# Etape 2 : copie du code applicatif (couche relancee a chaque modif source)
COPY . .

# Etape 3 : creation des dossiers de runtime + permissions pour l'utilisateur "node"
# (uid/gid 1000 dans l'image officielle node:alpine, compatible avec OMV / chown 1000:1000)
RUN mkdir -p /app/data /app/data/backups /app/uploads /app/imports /app/exports \
 && chown -R node:node /app

# Securite : ne pas tourner en root
USER node

EXPOSE 3000

# Healthcheck applicatif. /api/storage/status est un endpoint leger expose par server.js.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/storage/status || exit 1

# Tini en PID 1 pour le bon traitement des signaux
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
