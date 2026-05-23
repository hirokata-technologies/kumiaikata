---
id: TASK-034
title: "Gather requirements for Mongoose → native MongoDB driver migration"
agent: product-owner
status: done
requirement: REQ-003
plan: null
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Gather and document requirements for replacing Mongoose with the official native MongoDB driver (`mongodb` npm package) across all of `apps/api`.

## Context

- Requirement: .guild/requirements/REQ-003.md
- The existing API surface (routes, HTTP contracts) is defined in REQ-002 and must be preserved.

## Acceptance Criteria

- [ ] REQ-003.md written with clear scope, user stories, and technical considerations
- [ ] TypeScript typing strategy clarified
- [ ] Validation replacement strategy confirmed
- [ ] Migration scope (big-bang vs incremental) decided

## Work Log

### 2026-05-23 — product-owner
- Interviewed user about Mongoose to native MongoDB driver migration strategy
- Confirmed: Zod schemas as the sole typing source (`z.infer<>`), no Mongoose schema-level validation, explicit `await connectDB()` startup, `client` + `withTransaction(cb)` exported from `db/connection.ts`
- Created REQ-003 with 8 user stories covering connection bootstrap, document schemas, CRUD rewrite, aggregation rewrite, transaction helper, dependency update, index recreation, and build/typecheck verification
- Key decisions: Better Auth unchanged; `ensureIndexes()` recreates partial unique indexes at startup; ObjectId serialisation handled explicitly at response boundary; all external API contracts preserved verbatim

## Follow-up Tasks

- Plan Mongoose to native MongoDB driver migration | agent: architect | priority: high
