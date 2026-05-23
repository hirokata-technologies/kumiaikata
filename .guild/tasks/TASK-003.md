---
id: TASK-003
title: "Bump npm dependencies and Node version declarations"
agent: developer-svelte
status: done
requirement: REQ-001
plan: PLAN-001
plan-slice: .guild/plans/PLAN-001/slice-npm-and-node-version.md
depends-on: []
priority: high
created: 2026-05-22
---

## Objective

Bump all npm dependencies to their latest versions and update Node version declarations (.nvmrc, package.json engines).

## Context

- Requirement: .guild/requirements/REQ-001.md
- Plan: .guild/plans/PLAN-001.md
- Parent task: TASK-002

## Acceptance Criteria

- [x] All dependencies in package.json updated to latest
- [x] package-lock.json regenerated
- [x] .nvmrc updated to 24
- [x] package.json engines.node updated to >=24
- [x] npm run check passes with 0 errors
- [x] npm run build succeeds

## Work Log

### 2026-05-22 — developer-svelte

- Updated `.nvmrc` from `20` to `24`
- Updated `package.json` `engines.node` from `>=20` to `>=24`
- Ran `npx npm-check-updates -u` — bumped the following packages:
  - `@sveltejs/vite-plugin-svelte`: `^7.0.0` → `^7.1.2`
  - `svelte`: `^5.55.2` → `^5.55.9`
  - `svelte-check`: `^4.4.6` → `^4.4.8`
  - `typescript`: `^6.0.2` → `^6.0.3`
  - `vite`: `^8.0.7` → `^8.0.14`
  - All other packages (`bits-ui`, `clsx`, `lucide-svelte`, `tailwind-merge`, `tailwind-variants`, `tw-animate-css`, `@sveltejs/adapter-node`, `@sveltejs/kit`, `@tailwindcss/vite`, `tailwindcss`) were already at latest — ncu left them unchanged.
- Ran `npm install` — clean install, no ERESOLVE conflicts, 109 packages audited.
- `tailwindcss` and `@tailwindcss/vite` both resolved to `4.3.0` — versions match.
- `npm run check` passed: 0 errors, 1 pre-existing warning (`@types/node` not installed, unrelated to this task).
- `npm run build` exited 0 and produced a non-empty `build/` directory via `@sveltejs/adapter-node`.
- No application source files were modified. Only `package.json`, `package-lock.json`, and `.nvmrc` were changed.

## Follow-up Tasks
