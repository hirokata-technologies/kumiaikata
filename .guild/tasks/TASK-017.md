---
id: TASK-017
title: "Implement SSE real-time endpoint"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
plan-slice: .guild/plans/PLAN-002/slice-sse.md
depends-on: []
priority: medium
created: 2026-05-23
---

## Objective

Implement SSE real-time endpoint

## Context

- Requirement: .guild/requirements/REQ-002.md — Kanban Board Management API
- Plan: .guild/plans/PLAN-002.md
- Plan slice: .guild/plans/PLAN-002/slice-sse.md
- Parent task: TASK-007

## Acceptance Criteria

- [x] Connecting to `/api/boards/:boardId/events` with `Accept: text/event-stream` returns 200 with `Content-Type: text/event-stream`
- [x] Without a valid session, returns 401 before upgrading (via `requireSession`)
- [x] Without board access, returns 403 before upgrading (via `loadBoardAccess`)
- [x] Non-existent board returns 404 before upgrading (via `loadBoardAccess`)
- [x] When another client performs a mutation, the SSE client receives a message with the correct `event:` type and `data:` JSON payload
- [x] Heartbeats are emitted every 15s (well within the 30s window)
- [x] When the client disconnects, the subscription is removed via `stream.onAbort`
- [x] When the session expires, the server emits `event: error` with `{"code":"UNAUTHENTICATED"}` and closes the stream
- [x] Multiple clients on the same board each receive the same event (fan-out via `InProcessEventBus`)
- [x] An event on board A is not delivered to a client subscribed to board B (board-scoped subscriptions)

## Work Log

### 2026-05-23 — developer
- Created `apps/api/src/routes/sse.ts` — SSE endpoint `GET /:boardId/events` using Hono's `streamSSE`, `queue + resolveNext` async bridge pattern, 15s heartbeat, 60s session watchdog, and `onAbort` cleanup
- Modified `apps/api/src/app.ts` — imported `sseRouter` and mounted it at `/api/boards` after all other board-rooted routers
- TypeScript check (`tsc --noEmit`) passed with no errors
- Key decisions: followed queue+resolveNext pattern from slice verbatim; mounted SSE router last per slice guidance; added `.catch(() => {})` on heartbeat/session-watchdog `writeSSE` calls to prevent unhandled rejections if the stream closes mid-interval

## Follow-up Tasks
