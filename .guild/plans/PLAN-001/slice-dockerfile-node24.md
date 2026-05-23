---
plan: PLAN-001
title: "Update Dockerfile base image to node:24-alpine and verify build"
complexity: 1
---

# Update Dockerfile base image to node:24-alpine and verify build

## Objective

Change all three `FROM node:20-alpine` directives in the Dockerfile to `node:24-alpine`, then verify that `docker build` succeeds end-to-end and the runtime container starts and serves HTTP requests on port 3000.

This slice does not touch `package.json`, `package-lock.json`, `.nvmrc`, or any application source. It consumes the regenerated `package-lock.json` produced by the sibling npm slice.

## Files to Touch

- `Dockerfile` — modify — change the image tag on all three `FROM` lines from `node:20-alpine` to `node:24-alpine`. The stage labels (`AS deps`, `AS build`, `AS runtime`), `WORKDIR`, `COPY`, `RUN`, `ENV`, `USER`, `EXPOSE`, and `CMD` directives are unchanged.

Do NOT touch:
- `package.json`, `package-lock.json`, `.nvmrc` (owned by the npm slice).
- `docker-compose.yml` (out of scope per REQ-001).
- Anything under `src/`, `static/`, `build/`.

## Approach

1. **Confirm the npm slice has landed**: `git log` should show a commit updating `package.json`, `package-lock.json`, and `.nvmrc`. `engines.node` in `package.json` must read `>=24`. If not, stop and surface that the prerequisite is missing.

2. **Edit `Dockerfile`**: change the three `FROM` lines (currently at lines 4, 10, and 18 of the existing file) from `FROM node:20-alpine AS <stage>` to `FROM node:24-alpine AS <stage>`. Leave the `# syntax=docker/dockerfile:1.7` directive and all other content alone.

3. **Build the full image**:
   ```
   docker build -t kata:node24-test .
   ```
   This exercises all three stages: `deps` (runs `npm ci` against the committed lockfile), `build` (runs `npm run build` and `npm prune --omit=dev`), and `runtime` (assembles the minimal image). Watch for:
   - `EBADENGINE` warnings — should be absent now that `engines.node` is `>=24`.
   - Missing alpine package errors during native module builds — see Edge cases below.

4. **Verify the Node version inside the image**:
   ```
   docker run --rm kata:node24-test node --version
   ```
   Output must start with `v24.`.

5. **Smoke test the runtime container**:
   ```
   docker run --rm -d -p 3000:3000 --name kata-smoke kata:node24-test
   ```
   Then `curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:3000/` — expect a 2xx or 3xx status. Stop the container with `docker stop kata-smoke`.

6. **Commit** the `Dockerfile` change as a separate commit from the npm slice's commit so that the two changes are bisectable.

### Edge cases

- **`node:24-alpine` is missing an OS package needed for a native build (e.g., `python3`, `make`, `g++` for node-gyp)**: the build will fail in the `deps` or `build` stage with a clear "command not found" or compilation error. Add a minimal `RUN apk add --no-cache <packages>` to the affected stage only — do not add tooling to the `runtime` stage. Keep the change as small as possible.
- **`docker build` fails inside `npm ci` with a lockfile mismatch**: the npm slice's `package-lock.json` was not committed or was generated against a different `package.json`. Surface this to the npm-slice owner rather than papering over it.
- **Container starts but `curl` gets connection refused**: confirm the container is actually running (`docker ps`), confirm `EXPOSE 3000` and `PORT=3000` are still present in the Dockerfile (they should be; this slice does not touch them), and check `docker logs kata-smoke` for adapter-node startup errors. A Node 24 incompatibility in `@sveltejs/adapter-node` would manifest here — if so, surface as a blocker; do not attempt to patch runtime code.

## Interface Contract

This slice consumes:

- A committed `package-lock.json` consistent with `package.json` (produced by the npm slice). `npm ci` in the `deps` stage requires this.
- `engines.node` set to `>=24` so the `npm ci` step does not warn about engine mismatch under `node:24-alpine`.

This slice produces:

- A Dockerfile whose three stages all build on `node:24-alpine`.
- A verified container image that starts and responds on port 3000.

No new files, no new environment variables, no new ports.

## Acceptance Criteria

- [ ] All three `FROM` directives in `Dockerfile` reference `node:24-alpine`.
- [ ] No other lines in `Dockerfile` have changed.
- [ ] `docker build -t kata:node24-test .` completes successfully with no errors in any of the three stages.
- [ ] `docker run --rm kata:node24-test node --version` reports a `v24.x` version.
- [ ] A container started from the image responds to `curl http://localhost:3000/` with a 2xx or 3xx HTTP status.
- [ ] No `EBADENGINE` warning appears during `npm ci` in the `deps` stage.
- [ ] No files outside `Dockerfile` have been modified by this slice.
