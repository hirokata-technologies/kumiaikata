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

### Required Railway configuration

| Setting                | Value                                                        |
| ---------------------- | ------------------------------------------------------------ |
| Service root directory | `apps/api`                                                   |
| Dockerfile path        | `apps/api/Dockerfile`                                        |
| Persistent volume      | Mount path `/data/attachments` (5 GB or more recommended)    |
| Health check path      | `/healthz`                                                   |

kata-api's Railway configuration lives in `.railway/railway.ts`, the `kata` partial of the repo's Railway TypeScript IaC. That includes its image source, domain, a `/healthz` healthcheck with a 30-second timeout, and an on-failure restart policy with up to 5 retries. Changes to it are planned on each pull request and applied on merge by the `railway-config.yml` workflow. The start command is the Dockerfile's `CMD` (`node --import ./dist/instrument.js dist/index.js`). The HTTP server binds first so `/healthz` can answer during startup, then migrations run automatically.

### Step-by-step Railway setup

1. In the Railway dashboard, create a new PostgreSQL service. Copy the `DATABASE_URL` reference variable it provides.
2. Create a new service for the API and connect it to this repository.
3. Set the **Root Directory** for the service to `apps/api`.
4. Attach a **persistent volume** to the service. Set the mount path to `/data/attachments`. A minimum of 5 GB is recommended.
5. Set the following **environment variables** in the Railway service settings:

   | Variable               | Source                         | Notes                                                          |
   | ---------------------- | ------------------------------ | -------------------------------------------------------------- |
   | `PORT`                 | Railway-provided               | Do not set manually — Railway injects this automatically.      |
   | `DATABASE_URL`         | Railway PostgreSQL service     | Use the reference variable from the PostgreSQL service.        |
   | `BETTER_AUTH_SECRET`   | Generate locally               | `openssl rand -hex 32`                                         |
   | `BETTER_AUTH_URL`      | Railway public URL             | Public URL of this API service, e.g. `https://api.kata.example.com`. No trailing slash. |
   | `GOOGLE_CLIENT_ID`     | Google Cloud Console           | OAuth 2.0 client ID.                                           |
   | `GOOGLE_CLIENT_SECRET` | Google Cloud Console           | OAuth 2.0 client secret.                                       |
   | `ALLOWED_DOMAINS`      | Operator                       | Comma-separated list, e.g. `example.com,partner.org`.          |
   | `ALLOWED_ORIGINS`      | Operator                       | Origin of the SvelteKit frontend, e.g. `https://kata.example.com`. |
   | `ATTACHMENTS_DIR`      | Default `/data/attachments`    | Must match the volume mount path above.                        |
   | `MAX_ATTACHMENT_BYTES` | Default `26214400`             | Optional — override to change the 25 MB upload limit.          |

6. Trigger a deploy. Railway will build the image from `apps/api/Dockerfile` using the full monorepo context.
7. Verify the deployment by hitting `https://<your-railway-domain>/healthz`. The response should be `{"ok":true,"db":true}`.

### Google OAuth callback URL

In the Google Cloud Console, add the following URI to the list of authorised redirect URIs for your OAuth 2.0 client:

```
${BETTER_AUTH_URL}/api/auth/callback/google
```

For example, if `BETTER_AUTH_URL` is `https://api.kata.example.com`, the redirect URI is:

```
https://api.kata.example.com/api/auth/callback/google
```
