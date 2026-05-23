---
id: TASK-008
title: "Scaffold apps/api package and Dockerfile"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
plan-slice: .guild/plans/PLAN-002/slice-scaffolding.md
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Scaffold apps/api package and Dockerfile

## Context

- Requirement: .guild/requirements/REQ-002.md — Kanban Board Management API
- Plan: .guild/plans/PLAN-002.md
- Plan slice: .guild/plans/PLAN-002/slice-scaffolding.md
- Parent task: TASK-007

## Acceptance Criteria

- [x] `apps/api/package.json` exists, is named `@kata/api`, declares Node `>=24`
- [x] `pnpm install` at repo root completes without errors
- [x] `pnpm --filter @kata/api check` succeeds with no type errors
- [x] `pnpm --filter @kata/api build` produces `apps/api/dist/index.js`
- [x] Missing env vars cause a clear startup error (Zod-derived message)
- [x] Root `pnpm dev:api`, `build:api`, `start:api`, `check:api` shortcuts wired
- [x] `apps/api/Dockerfile` created with multi-stage build mirroring root Dockerfile
- [x] `apps/api/src/env.ts` validates all required env vars with Zod
- [x] `apps/api/src/app.ts` mounts logger, cors, `/healthz`, and stub TODO comments for routers
- [x] `apps/api/src/index.ts` starts the server via `@hono/node-server`
- [x] `apps/api/dist` added to root `.gitignore`

## Work Log

### 2026-05-23 — developer

- Created `apps/api/package.json` named `@kata/api` with all required dependencies (hono, @hono/node-server, zod, mongoose, better-auth, fractional-indexing, tsx, typescript, @types/node)
- Created `apps/api/tsconfig.json` with NodeNext module/resolution, ES2023 target, strict mode, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `"types": ["node"]` (required for `process`/`console` globals)
- Created `apps/api/src/env.ts` — Zod schema validating all required env vars; comma-separated lists via `.transform()`; exits on parse failure with descriptive field errors
- Created `apps/api/src/app.ts` — Hono app with logger, cors (from env.ALLOWED_ORIGINS), `/healthz` route, and TODO comments for future router mounts
- Created `apps/api/src/index.ts` — starts server via `@hono/node-server` on `env.PORT`
- Created `apps/api/.env.example` with all env vars documented
- Created `apps/api/.gitignore` ignoring dist, node_modules, .env
- Created `apps/api/Dockerfile` — 4-stage build: base, build, prod-deps, runtime; mirrors root Dockerfile pattern
- Created `apps/api/README.md` with local dev instructions and env var table
- Modified root `package.json` — added `dev:api`, `build:api`, `start:api`, `check:api` scripts
- Modified root `.gitignore` — added `apps/api/dist`
- Fixed `env.ts` to use a wrapper function so TypeScript correctly infers the returned type as non-undefined
- Fixed `tsconfig.json` to include `"types": ["node"]` so `process` and `console` globals are available
- Verified: `pnpm check:api` passes, `pnpm build:api` produces dist, missing env vars show Zod error messages

## Follow-up Tasks
