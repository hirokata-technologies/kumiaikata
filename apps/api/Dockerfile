# syntax=docker/dockerfile:1.7

# ── base: node + corepack → pnpm ─────────────────────────────────────────────
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable pnpm

# ── build: install all deps and compile @kata/api ────────────────────────────
FROM base AS build
WORKDIR /app

# 1. Copy workspace manifests — cache layer
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/package.json

# 2. Install all deps (dev + prod) with BuildKit store cache
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --shamefully-hoist

# 3. Copy source and build
COPY . .
RUN pnpm --filter @kata/api build

# ── prod-deps: clean production node_modules (no dev packages) ───────────────
FROM node:24-alpine AS prod-deps
WORKDIR /app
# Copy only the API's package.json and install production deps with npm.
# npm resolves symlink-free node_modules, which are safe to copy into runtime.
COPY apps/api/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

# ── runtime: minimal image ───────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Compiled output from the build stage
COPY --from=build /app/apps/api/dist ./dist
# Migration files — drizzle-kit migrate runs at startup
COPY --from=build /app/apps/api/drizzle ./drizzle
# Clean production node_modules (from prod-deps stage, no dev packages)
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json

# Drop privileges
USER node

EXPOSE 8787
CMD ["node", "dist/index.js"]
