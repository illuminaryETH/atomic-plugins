# syntax=docker/dockerfile:1

# --- Build stage: compile TypeScript and native modules ---
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Build deps for better-sqlite3 native bindings
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune to production deps (keeps compiled better-sqlite3 binding)
RUN npm prune --omit=dev


# --- Runtime stage ---
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

# Run as the built-in non-root node user
RUN mkdir -p /app/data && chown -R node:node /app
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

# Mount config here (or set ATOMIC_DISCORD_CONFIG to another path)
ENV ATOMIC_DISCORD_CONFIG=/app/config/atomic-discord.config.yaml
VOLUME ["/app/config", "/app/data"]

CMD ["node", "dist/index.js"]
