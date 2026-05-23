---
id: TASK-020
title: "Fix: Derive attachment storage key extension from MIME type, not user filename"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Sanitize attachment storage key construction to remove path traversal risk and misleading extensions. Currently `path.extname(file.name)` trusts user-supplied filename. Replace with a MIME-to-extension map so the stored extension reflects the validated MIME type.

## Context

- Requirement: .guild/requirements/REQ-002.md
- Plan: .guild/plans/PLAN-002.md
- Review: TASK-019 (reviewer-security finding #1, reviewer-edge-case finding #6)
- File to fix: `apps/api/src/services/attachments.ts` line ~61

## Acceptance Criteria

- [x] `path.extname(file.name)` is no longer used to build the storage key
- [x] A MIME-to-extension map (e.g. `image/jpeg` → `.jpg`) is used instead
- [x] Filenames like `evil.jpg.exe` with MIME `image/jpeg` produce a `.jpg` storage key extension
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Removed `import path from "node:path"` (was the only usage)
- Added `MIME_TO_EXT` constant map in `apps/api/src/services/attachments.ts` covering all 11 MIME types in `ALLOWED_MIMES`
- Replaced `path.extname(file.name)` with `MIME_TO_EXT[file.type] ?? ".bin"` on line ~80
- `file.name` is still stored in the `filename` field for Content-Disposition on download
- `pnpm --filter @kata/api check` passes with no errors

## Follow-up Tasks
