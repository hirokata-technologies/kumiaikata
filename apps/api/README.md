# @kata/api

Hono REST API and Better Auth for Kata, backed by PostgreSQL (Drizzle ORM).

This package is a **library**: it exports the Hono `app` and the Better Auth `auth` instance
and never binds a port. `apps/web` mounts it under SvelteKit
(`apps/web/src/routes/api/[...path]/+server.ts` forwards every `/api/*` request to
`app.fetch`) and bundles it from TypeScript source, so the pages and the API share one
origin and one container. See the root README for the architecture, the full runtime
environment variable list and deployment notes.

```ts
import { app, auth } from "@kata/api";
```

## Development

The API runs inside the web dev server:

```sh
cp apps/web/.env.example apps/web/.env
pnpm dev            # http://localhost:5173 — pages and /api/*
```

## Tests

Tests need a Postgres database. They read `apps/api/.env.test` (without overriding variables
already set in your shell) and create/migrate the `kata_test` database themselves:

```sh
DATABASE_URL=postgresql://kata:kata@localhost:5432/kata_test pnpm --filter @kata/api test
```

## Migrations

`migrate.js` applies the migrations in `drizzle/` to `DATABASE_URL` and exits (idempotent). It
ships in the runtime image next to the `drizzle/` folder:

```sh
DATABASE_URL=... node apps/api/migrate.js      # from a checkout
node migrate.js                                # inside the image (Cloud Run Job command)
```

Generate a migration after editing the schema in `packages/db`:

```sh
pnpm --filter @kata/api db:generate
```

## Routes

| Method | Path | Description |
| --- | --- | --- |
| GET | `/healthz` | Health check (served by `apps/web/src/routes/healthz`); 503 when the database is unreachable |
| ALL | `/api/auth/*` | Better Auth (email/password, Google OAuth) |
| GET | `/api/boards/:boardId/events` | Server-sent events for a board (session + board access required; 15 s heartbeat, session re-checked every 10 s) |
| * | `/api/boards`, `/api/teams`, `/api/users`, `/api/attachments`, `/api/kumiai`, … | REST routes |

## Realtime and email

- Board events are published on an in-process event bus (`src/events/bus.ts`) and streamed by
  the SSE route. There is no Redis: run a single instance.
- Verification and password-reset emails are sent inline through Resend
  (`src/services/email.ts`) before the response is returned; there is no queue.

## Attachment storage

`GCS_BUCKET` set: Google Cloud Storage using Application Default Credentials
(`src/storage/gcs.ts`). Otherwise files are written to `ATTACHMENTS_DIR` (local development).
