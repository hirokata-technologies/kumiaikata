---
id: TASK-007
title: "Plan kanban board backend implementation"
agent: architect
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Read REQ-002, explore the monorepo structure, design the architecture for the `apps/api` Hono + MongoDB backend, and produce a plan with per-task implementation slices.

## Context

- Requirement: .guild/requirements/REQ-002.md — Kanban Board Management API
- Parent task: TASK-006

## Acceptance Criteria

- [x] PLAN-002.md created with architecture overview
- [x] Per-task plan slices created for each developer task
- [x] Developer tasks declared in Follow-up Tasks section
- [x] Key decisions documented: MongoDB driver vs Mongoose, SSE fan-out strategy, position numbering, attachment storage

## Work Log

### 2026-05-23 — architect

- Read REQ-002 (13 user stories) and explored the monorepo: pnpm workspace at root with only `apps/web` (SvelteKit, `@kata/web`) today; `packages/` empty; root `Dockerfile` is web-only; `.npmrc` enforces `engine-strict`; Node pinned to 24.
- Confirmed `.guild/docs/` is empty — no prior research artefacts. Confirmed `PLAN-001.md` is the unrelated dependency-bump plan for REQ-001 (BOARD.md `next-plan: 1` was stale).
- Decided the new plan should be **PLAN-002** to avoid clobbering PLAN-001. Orchestrator should bump BOARD.md `next-plan` to `3` after merging.
- Key architecture decisions:
  - **Mongoose** over the native driver — schema validation, embedded subdocs (comments/checklists), partial unique indexes, transactions all first-class.
  - **In-process EventEmitter** for SSE fan-out, hidden behind a `BoardEventBus` interface so Redis pub/sub or Mongo Change Streams can replace it later without touching routes.
  - **Fractional indexing** (`fractional-indexing` package, opaque string `position`) — single-row writes on reorder, no quadratic re-numbering.
  - **Railway volume** at `/data/attachments` behind a `StorageAdapter` interface; files served only through an authenticated `GET /api/attachments/:id` route (never as static assets) so per-board ACL is enforced on every download. Max 25 MB default, MIME allowlist documented in the attachments slice.
  - **Error envelope**: `{ "error": { "code": "...", "message": "...", "details"? } }` with a `Hono.onError` central handler keyed off an `AppError` class.
  - **Validation** via Zod through `@hono/zod-validator`, with a wrapper that produces our envelope on failure.
  - **Better Auth** with the Mongo adapter and Google plugin. Domain allow-list enforced in `signIn.before`; personal-board + team auto-join run inside `databaseHooks.user.create.after` in a Mongo transaction.
- Wrote `PLAN-002.md` (overview, data model, decisions, risks) and 10 self-contained slices under `.guild/plans/PLAN-002/`:
  - scaffolding, db-models, primitives, auth, boards-teams-routes, columns-routes, cards-routes, card-detail-routes, attachments, sse, railway (11 slices total).
- Declared 11 developer follow-up tasks plus a reviewer task gated on all developer work.

## Follow-up Tasks

- Scaffold apps/api package and Dockerfile | agent: developer | priority: high | plan-slice: .guild/plans/PLAN-002/slice-scaffolding.md
- Implement MongoDB connection and Mongoose models | agent: developer | priority: high | plan-slice: .guild/plans/PLAN-002/slice-db-models.md
- Implement cross-cutting primitives (errors, validation, ordering, event bus, storage) | agent: developer | priority: high | plan-slice: .guild/plans/PLAN-002/slice-primitives.md
- Implement Better Auth + Google SSO + domain allow-list + auto-provisioning | agent: developer | priority: high | plan-slice: .guild/plans/PLAN-002/slice-auth.md
- Implement board and team read routes | agent: developer | priority: medium | plan-slice: .guild/plans/PLAN-002/slice-boards-teams-routes.md
- Implement column CRUD and reorder routes | agent: developer | priority: medium | plan-slice: .guild/plans/PLAN-002/slice-columns-routes.md
- Implement card CRUD, move, and reorder routes | agent: developer | priority: high | plan-slice: .guild/plans/PLAN-002/slice-cards-routes.md
- Implement card detail routes (comments, checklists, assignees, labels) | agent: developer | priority: medium | plan-slice: .guild/plans/PLAN-002/slice-card-detail-routes.md
- Implement card attachments (upload, download, delete) | agent: developer | priority: medium | plan-slice: .guild/plans/PLAN-002/slice-attachments.md
- Implement SSE real-time endpoint | agent: developer | priority: medium | plan-slice: .guild/plans/PLAN-002/slice-sse.md
- Add Railway deployment configuration | agent: developer | priority: low | plan-slice: .guild/plans/PLAN-002/slice-railway.md
- Review kanban board backend implementation | agent: reviewer | priority: high | depends-on: all-developer
