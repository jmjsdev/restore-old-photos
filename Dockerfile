# ── Stage 1 : Build frontend ──────────────────────────────────────────
FROM node:22-slim AS frontend-builder

WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/desktop/package.json packages/desktop/package.json
RUN npm install

COPY packages/frontend/ packages/frontend/
RUN npm run build -w @oldphotos/frontend

# ── Stage 2 : Image finale (légère, sans dépendances Python) ─────────
FROM python:3.12-slim

# Dépendances système + Node.js 22
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dépendances Node.js (production uniquement)
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/desktop/package.json packages/desktop/package.json
RUN npm install --omit=dev

# Code source
COPY packages/core/ packages/core/
COPY ai/ ai/
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Frontend pré-compilé
COPY --from=frontend-builder /app/packages/frontend/dist/ packages/frontend/dist/

# Les dépendances Python (torch, basicsr, etc.) sont installées
# au premier démarrage dans /data/venv par l'entrypoint
ENV OLDPHOTOS_ROOT=/app \
    UPLOADS_DIR=/data/uploads \
    RESULTS_DIR=/data/results \
    DIST_DIR=/app/packages/frontend/dist \
    TORCH_HOME=/data/models/torch \
    HF_HOME=/data/models/huggingface \
    GFPGAN_MODEL_DIR=/data/models/gfpgan

RUN mkdir -p /data/uploads /data/results /data/models

EXPOSE 3001

ENTRYPOINT ["/docker-entrypoint.sh"]
