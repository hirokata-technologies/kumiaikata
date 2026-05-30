# syntax=docker/dockerfile:1.7

# ── base: node + corepack → pnpm ─────────────────────────────────────────────
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable pnpm

# ── build: install all deps and compile @kata/relay-service ──────────────────
FROM base AS build
WORKDIR /app

# 1. Copy workspace manifests — cache layer
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/kata-relay-service/package.json ./apps/kata-relay-service/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/events/package.json ./packages/events/package.json
COPY packages/http/package.json ./packages/http/package.json
COPY packages/queues/package.json ./packages/queues/package.json
COPY packages/redis/package.json ./packages/redis/package.json

# 2. Install all deps (dev + prod) with BuildKit store cache
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --shamefully-hoist

# 3. Copy source and build packages in dependency order, then the app
COPY . .
RUN pnpm --filter @kata/db build && \
    pnpm --filter @kata/redis build && \
    pnpm --filter @kata/http build && \
    pnpm --filter @kata/events build && \
    pnpm --filter @kata/queues build && \
    pnpm --filter @kata/auth build && \
    pnpm --filter @kata/relay-service build

# 4. Deploy: create a standalone production directory with workspace deps resolved.
RUN pnpm --filter @kata/relay-service --prod deploy --legacy /app/deploy

# ── runtime: minimal image ───────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# node_modules from pnpm deploy (workspace packages properly resolved, no symlinks)
COPY --from=build /app/deploy/node_modules ./node_modules
COPY --from=build /app/deploy/package.json ./package.json
# Compiled app output
COPY --from=build /app/apps/kata-relay-service/dist ./dist

# Drop privileges
USER node

EXPOSE 8787
CMD ["node", "--import", "./dist/instrument.js", "dist/index.js"]
