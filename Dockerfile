# syntax=docker/dockerfile:1.7
#
# Single image for the whole Kata app: SvelteKit (adapter-node) + the Hono API mounted
# at /api, run on Google Cloud Run. The same image also carries the migration entry
# point, so a Cloud Run Job can run it:
#
#   web:       node build            (default CMD)
#   migration: node migrate.js       (Cloud Run Job command override)

# ── base: node + corepack → pnpm ─────────────────────────────────────────────
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable pnpm

# ── build: install all deps, compile the app, assemble production node_modules ─
FROM base AS build
WORKDIR /app

# 1. Copy workspace manifests — cache layer. apps/web consumes @kata/api, @kata/db and
#    @kata/http as TypeScript source (Vite bundles them), so all four are needed.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/http/package.json ./packages/http/package.json

# 2. Install all deps (dev + prod) with BuildKit store cache
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# 3. Copy source and build. No build-time configuration is needed: every setting is
#    read from the environment at runtime.
COPY . .
RUN pnpm --filter @kata/web build

# 4. Production node_modules for the externals the server bundle imports at runtime
#    (hono, better-auth, drizzle-orm, pg, …). Versions come from pnpm-lock.yaml;
#    --prod drops devDependencies (which includes the bundled workspace packages).
RUN pnpm --filter @kata/web --prod deploy --legacy /app/deploy

# ── runtime: minimal image ───────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Cloud Run injects PORT; 3000 is the default for local runs.
ENV PORT=3000
# adapter-node refuses request bodies over 512K by default. Attachments are uploaded
# through the app (MAX_ATTACHMENT_BYTES, 25 MiB by default), so allow a little more.
# Cloud Run itself caps HTTP/1 requests at 32 MiB.
ENV BODY_SIZE_LIMIT=32M
# Cloud Run sends SIGTERM and kills the container 10 s later; don't wait on open
# SSE streams longer than that.
ENV SHUTDOWN_TIMEOUT=8

# Production node_modules (workspace packages resolved, no dev packages)
COPY --from=build /app/deploy/node_modules ./node_modules
COPY --from=build /app/apps/web/package.json ./package.json
# adapter-node build output
COPY --from=build /app/apps/web/build ./build
# Migration entry point + migrations (run with: node migrate.js)
COPY --from=build /app/apps/api/migrate.js ./migrate.js
COPY --from=build /app/apps/api/drizzle ./drizzle

# Local-disk attachments (used only when GCS_BUCKET is unset). Owned by `node` so a
# named volume mounted here inherits writable permissions.
RUN mkdir -p /data/attachments && chown node:node /data/attachments

# Drop privileges
USER node

EXPOSE 3000
CMD ["node", "build"]
