# @kata/api

Hono REST API for the Kata kanban application. Runs on Node.js, backed by PostgreSQL (via Drizzle ORM), deployed to Railway.

## Prerequisites

- Node.js >= 24
- PostgreSQL 15+
- pnpm

## Running locally

Copy the example env file and fill in your values:

```sh
cp apps/api/.env.example apps/api/.env
```

Set up the database schema (first time or after schema changes):

```sh
# Generate migration files from the schema
pnpm --filter @kata/api db:generate

# Apply migrations to the database
pnpm --filter @kata/api db:migrate
```

Start the dev server with live reload:

```sh
pnpm --filter @kata/api dev
# or from the repo root:
pnpm dev:api
```

The server starts on `http://localhost:8787`. Verify with:

```sh
curl http://localhost:8787/healthz
# → {"ok":true,"db":true}
```

## Required environment variables

| Variable               | Description                                              | Default             |
| ---------------------- | -------------------------------------------------------- | ------------------- |
| `PORT`                 | HTTP port the server binds to                            | `8787`              |
| `DATABASE_URL`         | PostgreSQL connection string                             | —                   |
| `BETTER_AUTH_SECRET`   | Long random secret used by Better Auth to sign sessions  | —                   |
| `BETTER_AUTH_URL`      | Public base URL of the API (used for OAuth callbacks)    | —                   |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID                                   | —                   |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret                               | —                   |
| `ALLOWED_DOMAINS`      | Comma-separated email domains allowed to sign in         | —                   |
| `ALLOWED_ORIGINS`      | Comma-separated origins allowed for CORS                 | —                   |
| `ATTACHMENTS_DIR`      | Directory where uploaded attachments are stored          | `/data/attachments` |
| `MAX_ATTACHMENT_BYTES` | Maximum upload size in bytes (25 MB default)             | `26214400`          |

See `.env.example` for sample values and explanations.

## Building

```sh
pnpm --filter @kata/api build
# produces apps/api/dist/
```

## Routes

| Method | Path       | Description                     |
| ------ | ---------- | ------------------------------- |
| GET    | `/healthz` | Health check — no auth required |

## Deploying to Railway

In production kata-api runs from the GHCR image `ghcr.io/hirogakatageri/kata-api:latest`, built from `apps/api/Dockerfile`. Its Railway configuration is not set up by hand in the dashboard. It lives in `.railway/railway.ts` (the `kata` partial of the repo's Railway TypeScript IaC) and declares:

- the image source, `ghcr.io/hirogakatageri/kata-api:latest`
- a `/healthz` healthcheck with a 30-second timeout
- an on-failure restart policy with up to 5 retries
- the environment variable names the service reads (see below)

Changes to it are planned on each pull request and applied on merge by the `railway-config.yml` workflow. See `.railway/README.md` for how that configuration is managed.

The start command is the Dockerfile `CMD`, `node --import ./dist/instrument.js dist/index.js`. `.railway/railway.ts` sets no start command or build settings.

### Startup order

1. The HTTP server binds its port first, so `GET /healthz` answers while the service is still starting. This keeps a slow first-deploy migration inside Railway's 30-second healthcheck window.
2. Database migrations then run automatically.
3. Until migrations complete, every route other than `/healthz` returns `503` with the error code `SERVICE_UNAVAILABLE` and a `Retry-After: 5` header. The 503 response still carries the normal CORS headers.
4. When migrations complete, the service is marked ready and serves all routes normally.

If a migration fails, the error is reported to Sentry and the process exits with a non-zero code, so Railway applies the on-failure restart policy.

### Environment variables

The variables kata-api needs are listed in the "Required environment variables" table earlier in this README. The names are declared in the `env` block of the `kata-api` service in `.railway/railway.ts`. Values are never written to the repo: variables that come from another Railway resource, such as `DATABASE_URL` and `REDIS_URL`, are typed references, and every other variable is declared with `preserve()`, which keeps the value already set on the service. `PORT` is also declared with `preserve()`.

### Attachment storage

`.railway/railway.ts` declares no volume for kata-api. The `ATTACHMENTS_DIR` default (`/data/attachments`) is therefore not backed by a persistent volume in this configuration. Uploaded files are written to that directory only when the S3 variables (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) are not all set. When all four are set, attachments are stored in S3-compatible storage instead.

### Custom domain and verification

Railway configuration cannot register custom domains, so the domain for kata-api (`kata-api.hirokata.dev`, port 8787) is added in the Railway dashboard and is not declared in `.railway/railway.ts`.

To verify a deployment:

1. Request `https://kata-api.hirokata.dev/healthz`. The response should be `{"ok":true,"db":true}`. `/healthz` is answered as soon as the server has bound, even while migrations are still running, and reports `200` only when the database is reachable. If the database cannot be reached it returns `503` with `{"ok":false,"db":false}`.
2. To confirm migrations have finished, request any other route. A `503` with `SERVICE_UNAVAILABLE` means migrations are still running. The service log line `[db] migrations up to date` marks completion.

### Google OAuth callback URL

In the Google Cloud Console, add the following URI to the list of authorised redirect URIs for your OAuth 2.0 client:

```
${BETTER_AUTH_URL}/api/auth/callback/google
```

For example, if `BETTER_AUTH_URL` is `https://kata-api.hirokata.dev`, the redirect URI is:

```
https://kata-api.hirokata.dev/api/auth/callback/google
```
