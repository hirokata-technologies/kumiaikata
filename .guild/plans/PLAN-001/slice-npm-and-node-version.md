---
plan: PLAN-001
title: "Bump npm dependencies and Node version declarations"
complexity: 2
---

# Bump npm dependencies and Node version declarations

## Objective

Update every package in `package.json` to its latest published version, regenerate `package-lock.json` under Node 24, and bump the Node version declarations in `.nvmrc` and `package.json` `engines.node`. Verify that `npm run build` and `npm run check` both pass with the new versions.

This slice does not touch the Dockerfile and does not modify application source code under `src/`.

## Files to Touch

- `package.json` — modify — bump every entry in `dependencies` and `devDependencies` to its latest version (via `ncu -u`); change `engines.node` from `>=20` to `>=24`. Preserve tab indentation.
- `package-lock.json` — modify (regenerated) — produced automatically by `npm install` after `package.json` is updated. Must be committed.
- `.nvmrc` — modify — replace the single token `20` with `24`. No trailing whitespace changes beyond the existing newline convention.

Do NOT touch:
- Anything under `src/`, `static/`, or `build/`.
- `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `components.json`, `docker-compose.yml`, or the `Dockerfile`.

## Approach

1. **Switch to Node 24 locally**: `nvm install 24 && nvm use 24`. Verify with `node --version`. If the developer has no nvm setup, install Node 24 by whatever mechanism they normally use; the rest of the steps run identically.

2. **Update `.nvmrc`** to contain exactly `24` (with the existing trailing newline). Doing this first means subsequent `nvm use` calls in this repo pick up Node 24 automatically.

3. **Bump `engines.node`** in `package.json` from `>=20` to `>=24`. Preserve the existing tab indentation and key ordering.

4. **Run `npx npm-check-updates -u`** from the repo root. This rewrites every dependency range in `package.json` to its latest published version. Review the diff — `ncu` prints a summary of what it changed.

5. **Run `npm install`**. This regenerates `package-lock.json` to match the new ranges. Watch the output for:
   - Peer dependency warnings — note any unresolvable ones.
   - `ERESOLVE` errors — these block install and must be addressed (see Edge cases below).

6. **Run `npm run check`**. This invokes `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json`. Zero type errors required.

7. **Run `npm run build`**. This invokes `vite build`. The command must exit 0 and produce a non-empty `build/` directory.

8. **Verify version coherence**: Confirm `tailwindcss` and `@tailwindcss/vite` end up on matching major/minor versions (REQ-001 Technical Considerations flags this as tightly coupled). If they diverged, hand-align them in `package.json` and re-run `npm install`.

9. **Commit** `package.json`, `package-lock.json`, and `.nvmrc` together in one logical change.

### Edge cases

- **A package introduces a breaking bump that fails `npm run check` or `npm run build`**: identify the offending package from the error output. Pin it back in `package.json` to the previous compatible major (e.g., change `^7.0.0` back to `^6.x.x` of `vite` if its major bump breaks). Re-run `npm install` and the verification steps. Note the pin and reason in the work log. Do not modify application source — that is out of scope per REQ-001.
- **`npm install` fails with `ERESOLVE`**: read the conflict, identify the two packages whose peer ranges disagree. Prefer pinning back the dependency that is less central to the stack. If the conflict is between `bits-ui` and `svelte`, pin `bits-ui` back; the application surface is more sensitive to Svelte changes.
- **Stale lockfile artefacts cause weird resolution**: as a last resort, `rm package-lock.json && rm -rf node_modules && npm install`. Do this only if a normal `npm install` produces inconsistent results.

## Interface Contract

This slice produces a working `package.json` + `package-lock.json` pair that the Docker slice will consume via `npm ci` inside the `deps` stage. The contract:

- `package-lock.json` is in sync with `package.json` (i.e., `npm ci --dry-run` succeeds with no errors).
- `engines.node` is `>=24` so that `npm ci` under `node:24-alpine` does not emit an `EBADENGINE` warning.
- No application source has been modified, so the Docker `build` stage will see the same code it does on `main` aside from the version files.

The Docker slice does not need to know which specific packages were bumped — only that the lockfile is committed and the engines field allows Node 24.

## Acceptance Criteria

- [ ] `nvm use` (or equivalent) selects Node 24.x successfully in the project root.
- [ ] `.nvmrc` contains exactly `24`.
- [ ] `package.json` `engines.node` is `>=24`.
- [ ] Every entry in `package.json` `dependencies` and `devDependencies` is at its latest published version, OR is explicitly pinned back to an older version with the reason documented in the work log.
- [ ] `package-lock.json` has been regenerated and committed alongside `package.json`.
- [ ] `npm run check` exits with no Svelte or TypeScript errors.
- [ ] `npm run build` exits 0 and produces a non-empty `build/` directory.
- [ ] `tailwindcss` and `@tailwindcss/vite` are on matching major/minor versions.
- [ ] No files outside `package.json`, `package-lock.json`, and `.nvmrc` have been modified by this slice.
