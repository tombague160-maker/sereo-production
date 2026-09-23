# ============================================================================
# Sereo - image de production
# Base : Node 24 sur Debian 13 « trixie » (slim). Node 24+ requis pour le
# module natif `node:sqlite` (DatabaseSync) utilise par storage/sqliteStore.js.
#
# Calcul routier OSRM integre (23/09) : les binaires OSRM officiels sont
# compiles pour glibc (Debian) ; l'ancienne base Alpine (musl) ne pouvait pas
# les executer. La base Debian est la MEME que celle de l'image OSRM (trixie) :
# les binaires n'y dependent que de libstdc++, libgcc et libc, deja presentes
# dans node:24-trixie-slim (verifie par ldd, voir DESIGN.md). La carte n'est
# PAS dans l'image : lib/osrm-local.js la telecharge et la prepare dans le
# volume de donnees (/app/data/osrm), en arriere-plan.
#
# Compatible avec le builder legacy ET BuildKit. Pas de directive `# syntax=`
# ni de `--mount=type=cache` car le service sereo-updater (alpine + docker-cli)
# utilise le builder legacy qui ne supporte pas ces fonctionnalites. Le
# multi-etapes (FROM ... AS / COPY --from=) est supporte par le builder legacy.
# ============================================================================

# Version EPINGLEE d'OSRM (depot officiel, registre GitHub : l'image Docker Hub
# osrm/osrm-backend n'est plus publiee depuis 2021). Changer ce tag peut changer
# le format des cartes : le nouvel osrm-routed refuse alors la carte en place,
# osrm-local.js la note refusee (erreur dans Parametres, serveur public en
# attendant) et la refait la nuit suivante, a 3 h.
FROM ghcr.io/project-osrm/osrm-backend:v26.9.0-debian AS osrm

FROM node:24-trixie-slim

# Tini : init system minimal qui forwarde proprement SIGTERM/SIGINT a Node.
# Sans lui, "docker stop" attend 10s avant un SIGKILL force.
# osmium-tool : fusion des extraits Geofabrik de plusieurs regions en une
# seule carte (osrm-extract ne lit qu'un fichier). ca-certificates : HTTPS
# vers download.geofabrik.de. Debian installe tini dans /usr/bin : le lien
# /sbin/tini garde le chemin de l'ancienne image (ENTRYPOINT inchange).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini osmium-tool ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && { [ -e /sbin/tini ] || ln -s /usr/bin/tini /usr/sbin/tini; } \
 && /sbin/tini --version

# Binaires OSRM et profil voiture (car.lua a besoin de son dossier lib/).
COPY --from=osrm /usr/local/bin/osrm-extract /usr/local/bin/osrm-partition /usr/local/bin/osrm-customize /usr/local/bin/osrm-routed /usr/local/bin/
COPY --from=osrm /opt/car.lua /opt/osrm/profiles/car.lua
COPY --from=osrm /opt/lib /opt/osrm/profiles/lib

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
RUN npm ci --omit=dev --no-audit --no-fund

# Etape 2 : copie du code applicatif (couche relancee a chaque modif source)
COPY . .

# Etape 3 : creation des dossiers de runtime + permissions pour l'utilisateur "node"
# (uid/gid 1000 dans l'image officielle node, compatible avec OMV / chown 1000:1000)
RUN mkdir -p /app/data /app/data/backups /app/uploads /app/imports /app/exports \
 && chown -R node:node /app

# Securite : ne pas tourner en root
USER node

EXPOSE 3000

# Healthcheck applicatif public. /healthz ne revele aucune donnee metier.
# start-period a 45s (v1.16.0) : laisse le temps au boot incluant PRAGMA
# quick_check (scan integrite, cout lineaire avec la taille de base en cache
# froid) + syncWorkflow initial, sans declencher un restart premature qui
# relancerait un scan froid en boucle sur une grosse base.
# wget n'existe pas sur l'image slim : le healthcheck passe par node (fetch).
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Tini en PID 1 pour le bon traitement des signaux
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
