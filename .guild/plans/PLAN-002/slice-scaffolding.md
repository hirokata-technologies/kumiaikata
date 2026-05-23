---
plan: PLAN-002
slice: scaffolding
title: "Package scaffolding and monorepo wiring"
complexity: 2
---

# Package scaffolding and monorepo wiring

## Goal

Create the `apps/api` package as a TypeScript Hono service, wire it into the existing pnpm workspace, and add a dedicated Dockerfile for Railway. After this slice, `pnpm --filter @kata/api dev` must boot an empty Hono app on port 8787 that returns `{ "ok": true }` from `GET /healthz`.

## Files to Create / Modify

- `apps/api/package.json` — create. Name `@kata/api`, type `module`, engines `{ node: ">=24" }`.
- `apps/api/tsconfig.json` — create. `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2023`, `strict: true`, `outDir: dist`, `rootDir: src`, `noEmit: false`.
- `apps/api/src/index.ts` — create. Imports `app` from `./app`, calls `serve({ fetch: app.fetch, port: env.PORT })`.
- `apps/api/src/app.ts` — create. Constructs the Hono app, mounts `hono/logger`, `hono/cors`, a `/healthz` route, and exports it. Mountpoints for routers are stubbed with TODO comments.
- `apps/api/src/env.ts` — create. Zod schema validating `PORT` (default 8787), `MONGODB_URI`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_DOMAINS` (comma-separated → string[]), `ALLOWED_ORIGINS` (comma-separated → string[]), `ATTACHMENTS_DIR` (default `/data/attachments`), `MAX_ATTACHMENT_BYTES` (default 26214400 = 25 MB). Throws on parse failure.
- `apps/api/.env.example` — create. Document every env var with a sample value and a one-line explanation.
- `apps/api/.gitignore` — create. `dist`, `node_modules`, `.env`, `.env.*`.
- `apps/api/Dockerfile` — create. Two-stage build: `build` (install all deps with `pnpm install --frozen-lockfile --shamefully-hoist`, compile `@kata/api`) and `runtime` (copy `apps/api/dist`, install production deps, run `node dist/index.js`). Base image `node:24-alpine`. Mirror the structure of the root `Dockerfile`.
- `apps/api/README.md` — create. Short: how to run locally (`pnpm --filter @kata/api dev`), required env vars, where to find the OpenAPI / route map.
- `package.json` (root) — modify. Add scripts: `"dev:api": "pnpm --filter @kata/api dev"`, `"build:api": "pnpm --filter @kata/api build"`, `"start:api": "pnpm --filter @kata/api start"`, `"check:api": "pnpm --filter @kata/api check"`.
- `.gitignore` (root) — modify. Add `apps/api/dist`.
- `.dockerignore` (root) — verify; no change needed (already excludes `apps/*` build outputs only via `apps/web/build`; the API's dist is added to root gitignore).

## Implementation Steps

1. **Create the package skeleton**. `apps/api/package.json`:
   ```jsonc
   {
     "name": "@kata/api",
     "private": true,
     "version": "0.0.1",
     "type": "module",
     "engines": { "node": ">=24" },
     "scripts": {
       "dev": "tsx watch src/index.ts",
       "build": "tsc -p tsconfig.json",
       "start": "node dist/index.js",
       "check": "tsc -p tsconfig.json --noEmit"
     },
     "dependencies": {
       "hono": "^4.6.0",
       "@hono/node-server": "^1.13.0",
       "@hono/zod-validator": "^0.4.0",
       "zod": "^3.23.0",
       "mongoose": "^8.7.0",
       "better-auth": "^1.0.0",
       "fractional-indexing": "^3.2.0"
     },
     "devDependencies": {
       "tsx": "^4.19.0",
       "typescript": "^6.0.3",
       "@types/node": "^24.0.0"
     }
   }
   ```
   Use tab indentation to match the rest of the repo.

2. **Write `tsconfig.json`**. Standalone (does not extend `@kata/web`'s). Important options: `"verbatimModuleSyntax": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true` (strictness pays off in a backend), `"lib": ["ES2023"]`.

3. **Write `src/env.ts`**. Use a single `z.object({...})` schema; `parse(process.env)` at module load and export a typed `env` object. Comma-separated lists use `z.string().transform(s => s.split(',').map(x => x.trim()).filter(Boolean))`.

4. **Write `src/app.ts`** with `/healthz` returning `c.json({ ok: true })`. Wire `hono/logger` and `hono/cors` with `origin: env.ALLOWED_ORIGINS`. Leave TODO comments where later slices will mount routers.

5. **Write `src/index.ts`** that imports `serve` from `@hono/node-server` and starts the server on `env.PORT`. Log a one-liner with the bound URL.

6. **Write `apps/api/Dockerfile`**. Mirror the root file's three-stage style but for `@kata/api`:
   ```dockerfile
   # syntax=docker/dockerfile:1.7
   FROM node:24-alpine AS base
   ENV PNPM_HOME=/pnpm
   ENV PATH=$PNPM_HOME:$PATH
   RUN corepack enable pnpm

   FROM base AS build
   WORKDIR /app
   COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
   COPY apps/api/package.json ./apps/api/package.json
   RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
       pnpm install --frozen-lockfile --shamefully-hoist
   COPY . .
   RUN pnpm --filter @kata/api build

   FROM node:24-alpine AS prod-deps
   WORKDIR /app
   COPY apps/api/package.json ./package.json
   RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

   FROM node:24-alpine AS runtime
   WORKDIR /app
   ENV NODE_ENV=production
   COPY --from=build /app/apps/api/dist ./dist
   COPY --from=prod-deps /app/node_modules ./node_modules
   COPY --from=prod-deps /app/package.json ./package.json
   USER node
   EXPOSE 8787
   CMD ["node", "dist/index.js"]
   ```

7. **Add root scripts** for `dev:api`, `build:api`, `start:api`, `check:api`. Preserve tab indentation in root `package.json`.

8. **Append `apps/api/dist` to root `.gitignore`** so committed source stays clean.

9. **Smoke test**: `pnpm install` at repo root, then `pnpm --filter @kata/api dev`. `curl http://localhost:8787/healthz` returns `{"ok":true}`.

## Interface Contract

This slice exposes to every later slice:

- `import { env } from './env'` — typed access to validated environment variables.
- `import { app } from './app'` — the Hono instance. Later slices will mount sub-routers via `app.route('/api/boards', boardsRouter)` and similar. The exact convention: each router file exports a `default` Hono sub-app, and `app.ts` mounts them in a clearly-ordered block.
- Path alias: none. All imports are relative.

This slice consumes nothing from sibling slices.

## Acceptance Criteria

- [ ] `apps/api/package.json` exists, is named `@kata/api`, declares Node `>=24`.
- [ ] `pnpm install` at repo root completes without errors.
- [ ] `pnpm --filter @kata/api dev` boots the server and `GET /healthz` returns `{ "ok": true }`.
- [ ] `pnpm --filter @kata/api build` produces `apps/api/dist/index.js` that can be run with `node dist/index.js`.
- [ ] `pnpm --filter @kata/api check` succeeds with no type errors.
- [ ] `docker build -f apps/api/Dockerfile -t kata-api:local .` (run from repo root) completes; running the image with `MONGODB_URI=mongodb://host.docker.internal:27017/kata BETTER_AUTH_SECRET=x BETTER_AUTH_URL=http://localhost:8787 GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=x ALLOWED_DOMAINS=example.com ALLOWED_ORIGINS=http://localhost:3000 PORT=8787` answers `/healthz` (Mongo connection failure is fine — health route does not require DB yet).
- [ ] Missing env vars cause a clear startup error (Zod-derived message).
- [ ] Root `pnpm dev:api` shortcut works.
