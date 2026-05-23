---
plan: PLAN-003
title: "Cleanup + dependency removal"
complexity: 1
---

# Cleanup + dependency removal

## Objective

Final pass: remove `mongoose` (and any `@types/mongoose`) from
`apps/api/package.json`, add `mongodb` as a direct dependency pinned to
the same major version Better Auth uses, refresh the lockfile, and verify
zero `mongoose` imports remain anywhere under `apps/api/src/`. Run
typecheck and build to prove no regressions.

## Files to Touch

- `apps/api/package.json` — **modify** (drop `mongoose`, add `mongodb`)
- `pnpm-lock.yaml` (monorepo root) — **modify** (auto-updated by
  `pnpm install`)

## Approach

1. **Determine the target `mongodb` version**:

   ```bash
   pnpm --filter @kata/api why mongodb
   ```

   Pin to the same major (and ideally minor) range as the version pulled
   in transitively by `better-auth`. Concretely, write
   `"mongodb": "^6.x.y"` matching whatever shows up.

2. **Edit `apps/api/package.json`**:

   ```json
   {
       "dependencies": {
           "hono": "^4.6.0",
           "@hono/node-server": "^1.13.0",
           "@hono/zod-validator": "^0.4.0",
           "zod": "^3.23.0",
           "mongodb": "^6.x.x",
           "better-auth": "^1.0.0",
           "fractional-indexing": "^3.2.0"
       },
       "devDependencies": {
           "tsx": "^4.19.0",
           "typescript": "^6.0.3",
           "@types/node": "^24.0.0"
       }
   }
   ```

   Removed: `"mongoose": "^8.7.0"`. Check `devDependencies` for
   `@types/mongoose` — remove if present (it is not currently present).

3. **Refresh the lockfile**:

   ```bash
   pnpm install
   ```

   Verify the output contains no `mongoose`-related peer warnings.

4. **Grep verification — zero remaining mongoose imports**:

   ```bash
   grep -rn "from \"mongoose\"\|from 'mongoose'" apps/api/src/ && exit 1 || echo OK
   grep -rn "mongoose\." apps/api/src/ && exit 1 || echo OK
   grep -rn "Mongoose\|mongoose\b" apps/api/src/ && exit 1 || echo OK
   ```

   All three must return empty (the script's `&& exit 1` is a guardrail).

5. **Type-check**:

   ```bash
   pnpm --filter @kata/api check
   ```

   Must exit 0 with no errors.

6. **Build**:

   ```bash
   pnpm --filter @kata/api build
   ```

   Must exit 0 and produce a valid `dist/` directory.

7. **Smoke check the health endpoint** (manual or scripted):

   ```bash
   pnpm --filter @kata/api dev &
   sleep 3
   curl -s http://localhost:8787/healthz | jq .
   # expect: { "ok": true, "db": true }
   ```

8. **Verify monorepo siblings are unaffected** — the only mongoose
   dependency in the repo lives under `apps/api`; confirm `apps/web` and
   any shared packages do not import from internal `apps/api` modules.

   ```bash
   grep -rn "mongoose" apps/web/ packages/ 2>/dev/null || echo OK
   ```

## Interface Contract

This slice produces no code interfaces; it is a cleanup pass. The
deliverable is a clean dependency manifest and a passing typecheck / build.

## Acceptance Criteria

- [ ] `apps/api/package.json` no longer lists `mongoose` in
      `dependencies` or `devDependencies`.
- [ ] `apps/api/package.json` lists `mongodb` in `dependencies` with an
      explicit version compatible with Better Auth's transitive requirement.
- [ ] `pnpm install` (from the monorepo root) completes without
      `mongoose`-related peer warnings.
- [ ] `pnpm-lock.yaml` is committed alongside the `package.json` change.
- [ ] `grep -rn "mongoose" apps/api/src/` returns no matches.
- [ ] `pnpm --filter @kata/api check` exits 0.
- [ ] `pnpm --filter @kata/api build` exits 0 and produces a valid
      `apps/api/dist/` artefact.
- [ ] `GET /healthz` returns `{ ok: true, db: true }` against a running
      MongoDB instance (smoke check, not automated).
- [ ] No file outside `apps/api/` references `mongoose`.
