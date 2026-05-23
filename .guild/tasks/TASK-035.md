---
id: TASK-035
title: "Plan Mongoose to native MongoDB driver migration"
agent: architect
status: done
requirement: REQ-003
plan: PLAN-003
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Read REQ-003, audit the current Mongoose codebase in apps/api, and produce PLAN-003 with self-contained developer slices covering the full migration.

## Context

- Requirement: .guild/requirements/REQ-003.md — Migrate apps/api from Mongoose to Native MongoDB Driver
- Parent task: TASK-034
- Prior codebase: apps/api built under REQ-002; all Mongoose files in apps/api/src/db/

## Acceptance Criteria

- [x] PLAN-003.md created with architecture overview
- [x] Per-developer plan slices created
- [x] All Mongoose touch-points identified and assigned to slices
- [x] Developer follow-up tasks declared

## Work Log

### 2026-05-23 — architect
- Read REQ-003 in full; confirmed scope is a pure internal refactor with the HTTP contract frozen.
- Audited every Mongoose touch-point in `apps/api/src/`:
  - `db/connection.ts`, `db/models/*.ts` (8 files including the Better-Auth user stub), `db/types.ts`
  - `auth/better-auth.ts` (proxy that reaches into `mongoose.connection.getClient().db()`), `auth/middleware.ts` (aggregation), `auth/provisioning.ts` (transaction)
  - `http/types.ts` (ContextBoard ObjectId types), `http/validate.ts` (isValidObjectId)
  - All six service files
  - Four card-detail route files with inline Mongoose calls (card-comments, card-checklists, card-assignees, card-labels) plus the type-only Mongoose imports in `routes/cards.ts` and `routes/card-attachments.ts`
  - `app.ts` health check; `index.ts` startup sequence
- Confirmed collection names in MongoDB are the Mongoose-pluralised defaults (`teams`, `teammembers`, `boards`, `columns`, `cards`, `labels`, `attachments`) plus the Better-Auth `user`. These must be preserved verbatim.
- Identified the user-ID-vs-ObjectId question (Better Auth stores `_id` as string; the Mongoose schemas declare `ownerId`/`userId` as `Schema.Types.ObjectId`) as the only research-grade unknown — but it is empirically resolvable by inspecting a single existing document, so flagged it as a per-slice verification step rather than a research gate.
- Created PLAN-003.md (overview, codebase analysis, decisions, risks) and eight slice files at `.guild/plans/PLAN-003/`:
  - slice-connection (MongoClient, connectDB, withTransaction, app.ts healthz, better-auth proxy)
  - slice-schemas (Zod schemas, COLLECTIONS constant, typed accessors, http/validate, http/types)
  - slice-indexes (ensureIndexes with partial-unique board indexes)
  - slice-services-boards-teams (boards service, teams service, provisioning, middleware aggregation, routes/boards, routes/teams)
  - slice-services-columns-cards (columns service, cards service incl. transactional deleteCard, routes/columns + routes/cards import swaps)
  - slice-services-labels-attachments (labels + attachments services, routes wiring)
  - slice-routes-card-detail (the four inline-Mongoose route files)
  - slice-cleanup (package.json, lockfile, grep verification, build)
- Declared follow-up developer tasks plus a reviewer task that depends on all developer slices.

## Follow-up Tasks

- Implement connection module + startup wiring | agent: developer | priority: high | plan-slice: .guild/plans/PLAN-003/slice-connection.md
- Implement Zod schemas + ObjectId helper | agent: developer | priority: high | plan-slice: .guild/plans/PLAN-003/slice-schemas.md
- Implement index bootstrap | agent: developer | priority: high | plan-slice: .guild/plans/PLAN-003/slice-indexes.md
- Implement boards + teams + auth services | agent: developer | priority: high | plan-slice: .guild/plans/PLAN-003/slice-services-boards-teams.md
- Implement columns + cards services | agent: developer | priority: high | plan-slice: .guild/plans/PLAN-003/slice-services-columns-cards.md
- Implement labels + attachments services | agent: developer | priority: high | plan-slice: .guild/plans/PLAN-003/slice-services-labels-attachments.md
- Implement card-detail route rewrites | agent: developer | priority: high | plan-slice: .guild/plans/PLAN-003/slice-routes-card-detail.md
- Cleanup + dependency removal | agent: developer | priority: medium | plan-slice: .guild/plans/PLAN-003/slice-cleanup.md
- Review Mongoose to native MongoDB driver migration | agent: reviewer | priority: high | depends-on: all-developer
