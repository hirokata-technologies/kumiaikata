---
id: TASK-025
title: "Fix: Wrap SSE event bus subscription callback in try-catch"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

The `eventBus.subscribe()` callback in `apps/api/src/routes/sse.ts` pushes events onto a queue. If this callback throws (e.g., from a malformed event payload), the error propagates into the EventEmitter and can crash the process. Wrap the callback in a try-catch that logs the error and optionally emits an error event down the SSE stream.

## Context

- Requirement: .guild/requirements/REQ-002.md
- Plan: .guild/plans/PLAN-002.md
- Review: TASK-019 (reviewer-edge-case finding #7)
- File to fix: `apps/api/src/routes/sse.ts` subscription callback (~lines 16–26)

## Acceptance Criteria

- [x] Subscription callback is wrapped in try-catch
- [x] On error, the exception is logged but does not crash the process or corrupt the event bus
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Wrapped `eventBus.subscribe()` callback body in try-catch in `apps/api/src/routes/sse.ts` (lines 20-29)
- On error, logs `[SSE] Failed to enqueue event:` without propagating into the EventEmitter
- `pnpm --filter @kata/api check` passes with no errors

## Follow-up Tasks
