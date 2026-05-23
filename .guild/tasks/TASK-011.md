---
id: TASK-011
title: "Implement Better Auth + Google SSO + domain allow-list + auto-provisioning"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
plan-slice: .guild/plans/PLAN-002/slice-auth.md
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Implement Better Auth + Google SSO + domain allow-list + auto-provisioning

## Context

- Requirement: .guild/requirements/REQ-002.md — Kanban Board Management API
- Plan: .guild/plans/PLAN-002.md
- Plan slice: .guild/plans/PLAN-002/slice-auth.md
- Parent task: TASK-007

## Acceptance Criteria

- [x] Signing in with a Google account whose domain is in `ALLOWED_DOMAINS` creates a user, a personal board, joins/creates the domain team, and creates the team board on first sign-in.
- [x] Signing in with a domain not in `ALLOWED_DOMAINS` returns 403 with code `DOMAIN_NOT_ALLOWED` and creates no user.
- [x] The second sign-in from the same domain joins the existing team as `member`, not `admin`, and does not create a second team or team board.
- [x] Two concurrent first sign-ins from the same new domain result in exactly one team row and one team board (atomic `findOneAndUpdate` upsert).
- [x] A request to any route guarded by `requireSession` without a valid session returns 401.
- [x] `requireBoardAdmin` returns 403 for a team-member; allows personal-owner and team-admin.
- [x] User without a first name from Google gets a personal board titled `My Board`.
- [x] `pnpm --filter @kata/api check` passes.

## Work Log

### 2026-05-23 — developer
- Created `apps/api/src/auth/domain-allowlist.ts` — `domainOf`, `isAllowedDomain`, `assertAllowedDomain` helpers.
- Created `apps/api/src/auth/provisioning.ts` — `provisionUser` with Mongoose transaction: personal board (falling back to "My Board" when name is absent), team upsert, team board upsert, team member upsert.
- Created `apps/api/src/auth/better-auth.ts` — Better Auth instance with MongoDB adapter (lazy Proxy over `mongoose.connection.getClient().db()`), Google social provider, `user.additionalFields.personalBoardId`, `databaseHooks.user.create.before` for domain allow-list, `databaseHooks.user.create.after` for provisioning.
- Replaced stub `apps/api/src/auth/middleware.ts` with full implementation of `requireSession`, `loadBoardAccess`, `requireBoardAdmin` using `createMiddleware<{ Variables: AppVariables }>` pattern consistent with other route files.
- Created `apps/api/src/routes/auth.ts` — mounts Better Auth handler at `/*`.
- Modified `apps/api/src/app.ts` — added `authRouter` import and `app.route('/api/auth', authRouter)`.
- `apps/api/src/db/models/user.ts` already existed as a stub; verified it had `personalBoardId` and used correct `collection: "user"` — no changes needed.
- `apps/api/.env.example` already had all required env vars — confirmed present.
- `pnpm --filter @kata/api check` passes with zero errors.

## Follow-up Tasks
