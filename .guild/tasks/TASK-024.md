---
id: TASK-024
title: "Fix: Guard comment edit against concurrent card deletion"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

`apps/api/src/routes/card-comments.ts` PATCH handler fetches the card, then calls `.comments.id(commentId)` on the in-memory object. A concurrent card delete between those two operations leaves a stale object. Use `Card.findOneAndUpdate` with an atomic `$set` on the matching subdoc to perform the edit in a single round-trip.

## Context

- Requirement: .guild/requirements/REQ-002.md
- Plan: .guild/plans/PLAN-002.md
- Review: TASK-019 (reviewer-edge-case finding #2)
- File to fix: `apps/api/src/routes/card-comments.ts` PATCH handler (~line 65–95)

## Acceptance Criteria

- [x] Comment edit is a single atomic DB operation (no two-step fetch-then-save pattern)
- [x] 404 returned if card or comment not found
- [x] 403 returned if requester is not the comment author
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Replaced two-step fetch-then-save PATCH handler in `apps/api/src/routes/card-comments.ts` with an atomic `Card.findOneAndUpdate()` using the positional `$` operator.
- Added a lightweight `Card.exists()` pre-check (card + comment _id only) to distinguish 404 (card/comment missing) from 403 (comment exists but wrong author), since a single `findOneAndUpdate` with the author filter cannot make that distinction alone.
- The edit itself is now a single atomic write round-trip; the existence check is read-only and does not carry the TOCTOU risk of the old fetch-then-save pattern.
- `pnpm --filter @kata/api check` passes with no errors.

## Follow-up Tasks
