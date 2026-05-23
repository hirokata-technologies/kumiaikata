---
id: TASK-029
title: "Fix: Log and clean orphaned attachment IDs in getCard()"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: []
priority: medium
created: 2026-05-23
---

## Objective

`apps/api/src/services/cards.ts` `getCard()` fetches attachment documents for the IDs in `card.attachmentIds`. If an attachment was deleted externally, fewer docs are returned than expected and the response silently omits them. Detect the mismatch, log a warning, and pull the stale IDs from the card document.

## Context

- Requirement: .guild/requirements/REQ-002.md
- Plan: .guild/plans/PLAN-002.md
- Review: TASK-019 (reviewer-edge-case finding #10)
- File to fix: `apps/api/src/services/cards.ts` `getCard()` function

## Acceptance Criteria

- [x] If `attachments.length < card.attachmentIds.length`, a warning is logged and stale IDs are removed from the card via `$pull`
- [x] The response includes only the resolved attachment documents
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Added stale attachment ID detection in `getCard()` in `apps/api/src/services/cards.ts`
- After fetching attachment docs, computes `missingIds` as the set difference between `card.attachmentIds` and resolved IDs
- Logs a `console.warn` with the `[getCard]` prefix (matching existing `[deleteCard]`/`[deleteAttachment]` convention) then calls `Card.updateOne` with `$pull` to remove stale IDs
- Only resolved attachment documents are returned; `pnpm --filter @kata/api check` passes with no errors

## Follow-up Tasks
