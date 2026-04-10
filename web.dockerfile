# syntax=docker/dockerfile:1
# =============================================================================
# Stage 1: Frontend builder
# =============================================================================
FROM node:24-bookworm-slim AS frontend-builder
WORKDIR /app

# Install dependencies (cached layer)
# --ignore-scripts skips better-sqlite3's native compile (it's a dev-only dep
# used by local db scripts, not needed for `vite build`). Without this we'd
# need python3/make/g++ in this stage.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy frontend source
COPY index.html tsconfig.json tsconfig.node.json vite.config.ts ./
COPY src/ src/
COPY public/ public/

# Build web target
RUN VITE_BUILD_TARGET=web npm run build:web

# =============================================================================
# Runtime — static file server
# =============================================================================
FROM nginx:1.28-bookworm

COPY docker/nginx-web.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-builder /app/dist-web/ /usr/share/nginx/html/

EXPOSE 80
