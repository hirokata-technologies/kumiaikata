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
pnpm dev            # Postgres container + migrations + http://localhost:3000 (pages and /api/*)
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
| * | `/api/agents/...` | AI agents (below) |

## AI agents

`/api/agents` connects the app to the Project Manager / Strategist agents (Google ADK) hosted
on Vertex AI Agent Runtime. It is configured by `AGENT_RUNTIME_NAME`
(`projects/{project}/locations/{location}/reasoningEngines/{id}`); when it is unset every
route answers `503 agents not configured`. Calls use Application Default Credentials (on
Cloud Run the service account needs `roles/aiplatform.user`; locally
`gcloud auth application-default login`). The client is `src/agents/client.ts`.

All routes need a session and take an optional `?workspaceId=`: a team id the caller belongs
to, or `personal`. Without it the caller's team workspace is used (personal if they have no
team); any other value is `403`. The ADK user id is always `<workspaceId>:<userId>`, built on
the server, so a user can only reach their own sessions in a workspace they belong to. A
session that does not exist, or belongs to someone else, is `404`.

| Method | Path | Result |
| --- | --- | --- |
| POST | `/api/agents/sessions` | `201 { id, workspaceId, lastUpdateTime }` |
| GET | `/api/agents/sessions` | `200` array of the same, newest first |
| GET | `/api/agents/sessions/:sessionId` | `200 { id, workspaceId, lastUpdateTime, events }` (history) |
| DELETE | `/api/agents/sessions/:sessionId` | `204` |
| POST | `/api/agents/sessions/:sessionId/messages` | body `{ message }` (1-8000 chars); `text/event-stream` |

History `events` are `{ id, author, timestamp, text, toolCalls, toolResults, transferToAgent,
errorMessage }` (thoughts and raw payloads are dropped). Upstream failures are `502`
(`503` for quota errors) with a generic message.

The message stream is server-sent events. Each ADK event is turned into:

| Event | Data |
| --- | --- |
| `message` | `{ id, author, text, timestamp }` (agent text; `author` is `project_manager`, `strategist`, ...) |
| `tool_call` | `{ eventId, author, id, name, args }` (a call to the strategist is the hand-off to it) |
| `tool_result` | `{ eventId, author, id, name }` |
| `handoff` | `{ from, to }` when control moves between agents |
| `ping` | empty, every 15 s while waiting |
| `done` | `{ sessionId, events }` (last event on success) |
| `error` | `{ code, message }` (last event on failure) |

Replies arrive as whole messages, not token deltas. Closing the request cancels the
upstream call. Cloud Run's request timeout must cover a whole agent turn.

## Realtime and email

- Board events are published on an in-process event bus (`src/events/bus.ts`) and streamed by
  the SSE route. There is no Redis: run a single instance.
- Verification and password-reset emails are sent inline through Resend
  (`src/services/email.ts`) before the response is returned; there is no queue.

## Attachment storage

`GCS_BUCKET` set: Google Cloud Storage using Application Default Credentials
(`src/storage/gcs.ts`). Otherwise files are written to `ATTACHMENTS_DIR` (local development).
