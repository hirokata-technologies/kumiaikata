---
id: TASK-043
title: "Cleanup + dependency removal"
agent: developer
status: done
requirement: REQ-003
plan: PLAN-003
plan-slice: .guild/plans/PLAN-003/slice-cleanup.md
depends-on: []
priority: medium
created: 2026-05-23
---

## Objective

Remove mongoose dep, add mongodb as direct dep, update package.json, refresh lockfile, grep for any remaining Mongoose references, run tsc --noEmit and build.

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Plan slice: .guild/plans/PLAN-003/slice-cleanup.md
- Parent task: TASK-035

## Acceptance Criteria

- [x] `apps/api/package.json` no longer lists `mongoose` — already removed by TASK-036 before this task ran
- [x] `apps/api/package.json` lists `mongodb: ^6.0.0` in dependencies — already present
- [x] `pnpm install` completes without mongoose-related peer warnings — confirmed: "Lockfile is up to date, Already up to date"
- [x] All files outside TASK-042's scope are clean of mongoose imports — confirmed by grep
- [x] No file in `apps/web/` or `packages/` references mongoose — confirmed
- [ ] `pnpm --filter @kata/api check` exits 0 — blocked on TASK-042 (3 files still have old imports)
- [ ] `pnpm --filter @kata/api build` exits 0 — blocked on TASK-042

## Work Log

### 2026-05-23 — developer
- Ran `pnpm install` from monorepo root — lockfile already up to date, no mongoose peer warnings
- Verified `apps/api/package.json` already has mongoose removed and `mongodb: ^6.0.0` added (done by TASK-036)
- Ran `grep -rn "mongoose" apps/api/src/` — only 3 files have remaining references, all within TASK-042's scope: `routes/card-checklists.ts` (mongoose import + `mongoose.Types.ObjectId` usages), `routes/card-assignees.ts` (old `../db/models/index.js` import), `routes/card-labels.ts` (old `../db/models/index.js` import)
- Note: `routes/card-comments.ts` had already been migrated (uses `ObjectId` from `mongodb`)
- Ran `pnpm --filter @kata/api check` — fails with 3 errors, all from TASK-042's files: `card-assignees.ts(7,34)`, `card-checklists.ts(3,22)` and `(8,22)`, `card-labels.ts(7,29)` — all referencing missing `../db/models/index.js` or `mongoose`
- Ran `pnpm --filter @kata/api build` — fails with same 3 errors from TASK-042's files
- Everything outside TASK-042's scope (all services, auth, db, http, events, ordering, storage, routes/boards, routes/cards, routes/columns, routes/labels, routes/teams, routes/attachments, routes/card-attachments, routes/card-comments) is clean
- No mongoose references in `apps/web/` or `packages/` — confirmed
- Build and typecheck will pass once TASK-042 finishes migrating `card-checklists.ts`, `card-assignees.ts`, and `card-labels.ts`

## Follow-up Tasks
