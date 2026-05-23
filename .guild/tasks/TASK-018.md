---
id: TASK-018
title: "Add Railway deployment configuration"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
plan-slice: .guild/plans/PLAN-002/slice-railway.md
depends-on: []
priority: low
created: 2026-05-23
---

## Objective

Add Railway deployment configuration

## Context

- Requirement: .guild/requirements/REQ-002.md — Kanban Board Management API
- Plan: .guild/plans/PLAN-002.md
- Plan slice: .guild/plans/PLAN-002/slice-railway.md
- Parent task: TASK-007

## Acceptance Criteria

- [x] `apps/api/railway.json` exists and validates against the Railway schema.
- [x] `apps/api/.env.example` documents every variable consumed by `src/env.ts`.
- [x] `apps/api/README.md` lists: Railway service root, volume mount path, required env vars, Google OAuth callback URL pattern.
- [x] Root `README.md` mentions both services.
- [ ] A test deployment to Railway (or a `docker run` simulating Railway's env) successfully boots the API, passes `/healthz`, and accepts a Google sign-in end-to-end. (runtime verification — out of scope for this task)

## Work Log

### 2026-05-23 — developer

- Created `apps/api/railway.json` with DOCKERFILE builder, `node dist/index.js` start command, `/healthz` healthcheck, ON_FAILURE restart policy (max 5 retries), matching the plan slice spec exactly.
- Updated `apps/api/.env.example` — added inline Railway deployment notes for every variable: PORT (Railway-provided, do not set), MONGODB_URI, BETTER_AUTH_SECRET (with openssl command), BETTER_AUTH_URL (Railway public URL note + OAuth callback note), GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_DOMAINS, ALLOWED_ORIGINS, ATTACHMENTS_DIR (must match volume mount), MAX_ATTACHMENT_BYTES. All 10 variables from `src/env.ts` are covered.
- Updated `apps/api/README.md` — expanded with a full "Deploying to Railway" section covering: service root directory, Dockerfile path, persistent volume mount at `/data/attachments`, health check path, step-by-step Railway setup instructions, env vars table with source and notes, and Google OAuth callback URL pattern (`${BETTER_AUTH_URL}/api/auth/callback/google`).
- Updated root `README.md` — appended a "Services" section listing both `apps/web` (SvelteKit, root Dockerfile, port 3000) and `apps/api` (Hono, `apps/api/Dockerfile`, port 8787) as separate Railway services, pointing operators to `apps/api/README.md`.

## Follow-up Tasks
