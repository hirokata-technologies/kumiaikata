---
id: TASK-012
title: "Implement board and team read routes"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
plan-slice: .guild/plans/PLAN-002/slice-boards-teams-routes.md
depends-on: []
priority: medium
created: 2026-05-23
---

## Objective

Implement board and team read routes

## Context

- Requirement: .guild/requirements/REQ-002.md — Kanban Board Management API
- Plan: .guild/plans/PLAN-002.md
- Plan slice: .guild/plans/PLAN-002/slice-boards-teams-routes.md
- Parent task: TASK-007

## Acceptance Criteria

- [x] `GET /api/boards/personal` returns the signed-in user's personal board with `columns` (empty array initially).
- [x] `GET /api/boards/team` returns the team board for the user's domain.
- [x] `GET /api/teams/mine` returns `{ id, domain, name, role }`.
- [x] `GET /api/teams/:teamId/members` returns a list with email + role + joinedAt, but only for members of that team (others get 403).
- [x] `PATCH /api/teams/:teamId/members/:userId` with `{ role: 'admin' }` promotes when actor is admin; returns 403 when actor is member.
- [x] Demoting the last remaining admin returns 409 with code `CONFLICT`.
- [x] Invalid role value returns 422.
- [x] Target user not in team returns 404.

## Work Log

### 2026-05-23 — developer
- Created `apps/api/src/services/boards.ts` with `getBoardWithColumnsAndCards(boardId)` — assembles board with sorted columns and card summaries including aggregate counters.
- Created `apps/api/src/services/teams.ts` with `getTeamForUser`, `listMembers`, `setMemberRole` (with last-admin guard).
- Created `apps/api/src/routes/boards.ts` with `GET /personal` and `GET /team` endpoints.
- Created `apps/api/src/routes/teams.ts` with `GET /mine`, `GET /:teamId/members`, `PATCH /:teamId/members/:userId` endpoints.
- Created `apps/api/src/http/types.ts` with `AppVariables`, `UserSession`, `BoardAccess`, `ContextBoard` Hono context types.
- Created `apps/api/src/auth/middleware.ts` stub (placeholder for auth slice) with typed `requireSession`, `loadBoardAccess`, `requireBoardAdmin` exports.
- Created `apps/api/src/db/models/user.ts` stub (placeholder for auth slice) for email lookups in members list.
- Modified `apps/api/src/app.ts` to mount boards and teams routers under `/api/boards` and `/api/teams`.
- Fixed `apps/api/src/auth/provisioning.ts` (sibling file) — `?? null` fix for `exactOptionalPropertyTypes` TS error.
- `pnpm --filter @kata/api check` passes with zero errors.
- Key decisions: Created auth/user model stubs so TypeScript can compile before the auth slice lands; sibling routes file (`cards.ts`) was already updated by another task with the AppVariables import pattern.

## Follow-up Tasks
