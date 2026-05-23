---
id: TASK-023
title: "Fix: Validate cardId in attachment routes; reject empty/missing with 422"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

`apps/api/src/routes/card-attachments.ts` uses `c.req.param("cardId") ?? ""` — an empty fallback silently passes invalid state to the service. Replace with an explicit validation that throws VALIDATION_ERROR (422) if cardId is missing or empty.

## Context

- Requirement: .guild/requirements/REQ-002.md
- Plan: .guild/plans/PLAN-002.md
- Review: TASK-019 (reviewer-edge-case finding #1)
- File to fix: `apps/api/src/routes/card-attachments.ts` line ~47

## Acceptance Criteria

- [x] Missing or empty `cardId` param returns 422 (not 404 or a silent wrong-card operation)
- [x] Valid `cardId` continues to work normally
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Replaced `c.req.param("cardId") ?? ""` with an explicit null check in both the POST and DELETE handlers in `apps/api/src/routes/card-attachments.ts`
- Missing or empty `cardId` now throws `new AppError("VALIDATION_ERROR", "cardId is required")`, returning 422
- `pnpm --filter @kata/api check` passes with no errors

## Follow-up Tasks
