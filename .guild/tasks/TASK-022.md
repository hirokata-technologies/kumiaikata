---
id: TASK-022
title: "Fix: Reduce SSE session watchdog interval from 60s to 10s"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

The SSE session watchdog in `apps/api/src/routes/sse.ts` re-validates the session every 60 seconds. A stolen token can receive real-time events for up to 60s after the session expires. Reduce the interval to 10 seconds.

## Context

- Requirement: .guild/requirements/REQ-002.md
- Plan: .guild/plans/PLAN-002.md
- Review: TASK-019 (reviewer-security finding #3)
- File to fix: `apps/api/src/routes/sse.ts` — the `setInterval` for session check

## Acceptance Criteria

- [x] Session watchdog fires every 10 seconds (not 60)
- [x] Behaviour on session expiry is unchanged (emit error event, close stream)
- [ ] `pnpm --filter @kata/api check` passes — pre-existing unrelated error in `src/services/attachments.ts` (cannot find name 'path'); the SSE file itself is type-clean

## Work Log

### 2026-05-23 — developer
- Changed `setInterval` interval for `sessionWatch` from `60_000` to `10_000` in `apps/api/src/routes/sse.ts` (lines 33 and 45)
- Also updated the inline comment from "every 60s" to "every 10s"
- Behaviour on session expiry (emit `error` event, call `stream.close()`) is unchanged
- `pnpm --filter @kata/api check` fails on a pre-existing unrelated TS error in `src/services/attachments.ts` (cannot find name 'path'); no errors in `sse.ts`

## Follow-up Tasks
