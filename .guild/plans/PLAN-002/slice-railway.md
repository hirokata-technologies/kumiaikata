---
plan: PLAN-002
slice: railway
title: "Railway deployment configuration"
complexity: 1
---

# Railway deployment configuration

## Goal

Add the per-service Railway config so the API can be deployed alongside (or independently of) the existing SvelteKit service. Document the required env vars and the persistent volume mount for attachments.

## Files to Create / Modify

- `apps/api/railway.json` — create. Tell Railway to build with `apps/api/Dockerfile`, start with the image's `CMD`, and set a healthcheck on `/healthz`.
- `apps/api/.env.example` — modify. Re-document every var with a note on which ones Railway provides automatically (e.g. `PORT`) and which the operator must set.
- `README.md` (root) — modify. Add a short "API service" section pointing operators at `apps/api/README.md` and listing the required Railway env vars and volume mount.
- `apps/api/README.md` — modify (created in scaffolding slice). Expand the deployment section with the exact steps to spin up a Railway service from this Dockerfile and attach a volume.

## Implementation Steps

### `apps/api/railway.json`

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "apps/api/Dockerfile"
  },
  "deploy": {
    "startCommand": "node dist/index.js",
    "healthcheckPath": "/healthz",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
```

Place at `apps/api/railway.json`. Railway picks it up when the service's root directory is set to `apps/api` in the Railway dashboard.

### Volume mount

In the Railway dashboard, attach a volume to this service mounted at `/data/attachments`. Document this requirement explicitly in `apps/api/README.md`:

```
## Required Railway configuration

- Service root directory: apps/api
- Persistent volume: mount path /data/attachments (size >= 5 GB recommended)
- Health check: GET /healthz
- Required env vars: see .env.example
```

### Env vars to set in Railway

| Variable | Source | Notes |
|---|---|---|
| `PORT` | Railway-provided | Do not set manually. |
| `MONGODB_URI` | MongoDB Atlas or Railway add-on | |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` | |
| `BETTER_AUTH_URL` | Public URL of the API service | e.g. `https://api.kata.example.com` |
| `GOOGLE_CLIENT_ID` | Google Cloud Console | |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console | |
| `ALLOWED_DOMAINS` | Operator | Comma-separated. Example: `example.com,acme.test`. |
| `ALLOWED_ORIGINS` | Operator | Comma-separated. Origin of the SvelteKit frontend. |
| `ATTACHMENTS_DIR` | Default `/data/attachments` | Must match the volume mount path. |
| `MAX_ATTACHMENT_BYTES` | Default `26214400` (25 MB) | Optional override. |

### Google OAuth callback

The Google OAuth client must list `${BETTER_AUTH_URL}/api/auth/callback/google` as an authorised redirect URI. Document this in the README.

### Root README change

Append a short section:

```markdown
## Services

This monorepo contains two deployable services:

- `apps/web` — SvelteKit frontend. Built from the root `Dockerfile`. Default port 3000.
- `apps/api` — Hono backend. Built from `apps/api/Dockerfile`. Default port 8787. See `apps/api/README.md` for env vars and volume requirements.

Each is a separate Railway service.
```

## Interface Contract

This slice exposes no code. Other slices have no dependency on it.

Consumes:

- The Dockerfile from the scaffolding slice.
- The `/healthz` route from the scaffolding + db-models slices.

## Acceptance Criteria

- [ ] `apps/api/railway.json` exists and validates against the Railway schema.
- [ ] `apps/api/.env.example` documents every variable consumed by `src/env.ts`.
- [ ] `apps/api/README.md` lists: Railway service root, volume mount path, required env vars, Google OAuth callback URL pattern.
- [ ] Root `README.md` mentions both services.
- [ ] A test deployment to Railway (or a `docker run` simulating Railway's env) successfully boots the API, passes `/healthz`, and accepts a Google sign-in end-to-end.
