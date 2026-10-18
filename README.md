# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@0.15.3 create --template minimal --types ts --install npm sv-scaffold-temp
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Architecture

Kata is **one container**: the SvelteKit app (`apps/web`, adapter-node) also serves the
whole backend. `apps/api` is a library, not a server:

- `apps/api` exports a Hono `app` and the Better Auth instance (`@kata/api`).
- `apps/web/src/routes/api/[...path]/+server.ts` forwards every `/api/*` request to
  `app.fetch`, so Better Auth (`/api/auth/*`), the REST routes and the board event
  stream (`GET /api/boards/:boardId/events`, SSE) all live on the same origin as the pages.
- `apps/web/src/hooks.server.ts` reads the session in-process (`auth.api.getSession`),
  and server `load` functions call `/api/*` with SvelteKit's `fetch` (no network hop).
- Vite bundles `@kata/api`, `@kata/db` and `@kata/http` from TypeScript source into the
  server build; their npm dependencies are installed in the runtime image.
- Realtime events use an in-process event bus, so the app must run as a **single
  instance** (Cloud Run `max-instances: 1`). Email is sent inline through Resend.
- Production uses instance-based CPU billing with one instance always running (see `infra/kumiai.tf`).

`GET /healthz` answers `{"ok":true,"db":true}` (503 when the database is unreachable).

## Local development

Two ways to run it. `pnpm dev` (below) runs the app on the host with hot reload and Postgres as a
single named container (needs Node 24, pnpm and Docker). To run the whole stack in containers
(Postgres, migrations and the app image) use the local compose file:

```bash
docker compose -f docker-compose.local.yml up --build -d   # http://localhost:3000
docker compose -f docker-compose.local.yml down -v         # stop and wipe database + attachments
```

It boots with placeholders; see the header of `docker-compose.local.yml` for the settings that
need real values (Google sign-in, email) and for what is not included (Cloud Storage, AI agents).
The app image is rebuilt on `--build`, so there is no hot reload.

```bash
cp apps/web/.env.example apps/web/.env   # git-ignored; put real secrets here, never in tracked files
pnpm install
pnpm dev                                 # Postgres + migrations + dev server on http://localhost:3000
```

`pnpm dev` starts the `kata-postgres` container (`postgres:18-alpine`, volume
`kata_postgres_data`, user/password/database `kata`, port 5432) when `DATABASE_URL` points at
it, applies the migrations, and runs the SvelteKit dev server (pages and `/api`) on port 3000.
Settings come from `apps/web/.env`; real environment variables win. Missing secrets get
placeholders so the app still starts, but Google sign-in and email need real values.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Everything above |
| `pnpm dev:web` | Only the Vite dev server (port 5173; you manage Postgres and `.env`) |
| `pnpm db:up` | Start (or create) the Postgres container and wait until it is ready; safe to repeat |
| `pnpm db:down` | Stop it; data is kept |
| `pnpm db:reset` | Remove the container and its data volume |
| `pnpm db:migrate` | Apply `apps/api/drizzle` to `DATABASE_URL` (read from `apps/web/.env` if unset) |

`KATA_DB_PORT` changes the published Postgres port. To run the production image locally, build
it (below), use `docker-compose.local.yml` (includes Postgres), or `docker-compose.yml` against an
existing Postgres.

## Tests

```bash
pnpm test               # API and web unit tests (the API tests need Postgres: see apps/api/README.md)
pnpm test:integration   # builds the app, then runs it against a throwaway Postgres container
```

`pnpm test:integration` needs Docker. It starts `kata-it-postgres` on port 55432, applies the
migrations, runs `pnpm --filter @kata/web build` and starts `node build` on port 3100 (set
`KATA_IT_PORT` / `KATA_IT_DB_PORT` to change them), then removes everything afterwards.

## Environment variables

All configuration is read from the environment at runtime (nothing is baked in at build time).

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres URL. Cloud SQL socket: `postgresql://kumiai:PASS@localhost/kumiai?host=/cloudsql/kumiaikata:asia-southeast1:kumiai` |
| `BETTER_AUTH_SECRET` | yes | Long random secret used to sign sessions |
| `BETTER_AUTH_URL` | yes | Public origin of the app, e.g. `https://kumiai.hirokata.dev` (OAuth callback base). Also the OAuth issuer base and the MCP resource `<BETTER_AUTH_URL>/mcp`, so it must be `https` except on localhost |
| `ORIGIN` | yes in production | adapter-node public origin, e.g. `https://kumiai.hirokata.dev`. Needed behind the Google load balancer so SvelteKit sees the right URL and its CSRF check passes |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | yes | Google OAuth client. Authorised redirect URI: `<BETTER_AUTH_URL>/api/auth/callback/google` |
| `RESEND_API_KEY` | yes | Resend API key (verification and password-reset emails, sent inline) |
| `ALLOWED_DOMAINS` | yes | Comma-separated email domains allowed to sign in (production: `hirokata.dev`) |
| `AGENT_RUNTIME_NAME` | no | Vertex AI Agent Runtime instance of the AI agents, `projects/{project}/locations/{location}/reasoningEngines/{id}`. Uses Application Default Credentials (service account needs `roles/aiplatform.user`). When unset, `/api/agents` answers 503. See `apps/api/README.md` |
| `GCS_BUCKET` | no | Cloud Storage bucket for attachments (Application Default Credentials). When unset, files go to `ATTACHMENTS_DIR` on local disk |
| `ATTACHMENTS_DIR` | no | Local-disk attachment directory (default `/data/attachments`) |
| `MAX_ATTACHMENT_BYTES` | no | Upload limit, default `26214400` (25 MiB) |
| `ALLOWED_ORIGINS` | no | Extra origins Better Auth should trust (comma separated); the app origin is always trusted |
| `PUBLIC_SENTRY_DSN` | no | Sentry DSN (browser and server) |
| `PUBLIC_ENV` | no | Sentry environment name (default `production`) |
| `PORT` | no | Listen port; Cloud Run sets it (image default `3000`) |
| `BODY_SIZE_LIMIT` | no | adapter-node request body limit (image default `32M`; keep above `MAX_ATTACHMENT_BYTES`) |
| `DB_POOL_MAX` | no | Postgres pool size (default `10`) |

## MCP server

Kumiai is a remote MCP server at `<BETTER_AUTH_URL>/mcp` (Streamable HTTP, stateless; the guild
contract is [docs/guild-contract.md](docs/guild-contract.md)). Connect Claude Code to a project
(the server name must be `kumiai`):

```bash
claude mcp add --scope project --transport http kumiai http://localhost:3000/mcp
```

Then run `/mcp` in Claude Code and pick **kumiai → Authenticate**. The flow is OAuth 2.1 with
Better Auth as the authorization server (`@better-auth/mcp` + `jwt()`):

1. The first request gets `401` with `WWW-Authenticate: Bearer resource_metadata=…`; the client
   reads `/.well-known/oauth-protected-resource/mcp` and then the authorization-server metadata
   (`/.well-known/oauth-authorization-server/api/auth`).
2. The client registers itself: a Client ID Metadata Document (`@better-auth/cimd`, preferred) or
   Dynamic Client Registration (fallback, `POST /api/auth/oauth2/register`).
3. Your browser opens `/login`. Sign in as usual (email/password or Google; only `hirokata.dev`
   accounts exist). The sign-in carries the signed authorization request, so it continues to
   `/consent`, where you approve or deny the app.
4. The client receives a short-lived JWT access token bound to `<BETTER_AUTH_URL>/mcp` (plus a
   refresh token). `/mcp` verifies it against `/api/auth/jwks` and serves tools as that user.

Try it with the `whoami` tool: it returns your user, your team and the contract version.

### Tools

Every guild tool is defined once in `apps/api/src/guild/` (name, zod input, handler) and served
twice — over MCP and over REST/RPC — by `apps/api/src/mcp/guild-adapter.ts`. Groups (contract §4):

| Group | Tools |
|---|---|
| Context (§4.1) | `whoami`, `list_workspaces`, `create_workspace`, `get_state`, `set_state` |
| Reads (§4.2) | `read_view`, `get`, `list`, `search_docs`, `check_invariants`, `fingerprint` |
| Direction (§4.3) | `create_goal`, `update_goal`, `create_project`, `update_project` |
| Work (§4.4) | requirements, plans, tasks: `create_*` / `update_*`, `set_task_status`, `claim_task`, dependencies, capabilities, `log_work` |
| Graph (§4.5) | `instantiate_graph`, `add_graph_node`, `add_graph_edge`, `add_graph_deviation`, `set_node_status`, `resolve_gate` |
| Quality (§4.6) | findings, bugs, coverage, inspections |
| Library (§4.7–4.8) | `upsert_doc`, `link`, `unlink`, `supersede_doc`, `doc_neighbors`, `record_event` |
| Boards (§4.9, MCP only) | the old `apps/mcp` board/card tools (`get_board`, columns, cards, labels, assignees, comments, checklists); board projects are `*_board_project` |

Every tool except `whoami` / `list_workspaces` / `create_workspace` takes a `workspace` id of your
team, and every write takes an `actor`. Errors are `{"code","message"}` with `code` one of
`NOT_FOUND | FORBIDDEN | VALIDATION | CONFLICT | UNAUTHENTICATED` (MCP: `isError: true`).

### REST/RPC

The same guild tools (not the board tools) answer over HTTP, authenticated by the browser
session cookie **or** the same OAuth Bearer access token `/mcp` accepts:

```bash
# Tool catalog: name, title, description, readOnly and the input JSON Schema of every tool
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/kumiai/guild

# Call a tool: body = the tool's input, response = its JSON result
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"workspace":"<id>"}' http://localhost:3000/api/kumiai/guild/get_state
```

Errors use HTTP 400 (`VALIDATION`, with zod `issues`), 401, 403, 404 (also for an unknown tool) and
409. The old stdio server in `apps/mcp` is deprecated in favour of `/mcp`.

## Database migrations

The app does **not** migrate on startup. The runtime image contains `migrate.js` and the
`drizzle/` migrations folder; run it with the same image and `DATABASE_URL`:

```bash
node migrate.js
```

On Cloud Run that is a Job using the app image with command `node` and args `migrate.js`
(attach the Cloud SQL instance to the Job so the `/cloudsql/...` socket exists). It is
idempotent. Locally: `DATABASE_URL=... pnpm db:migrate`. To create a migration after
changing the schema in `packages/db`: `pnpm --filter @kata/api db:generate`.

## Build the image

```bash
docker build -f Dockerfile -t kata-web .
docker run --rm -p 3000:3000 --env-file my.env kata-web          # the app
docker run --rm --env-file my.env kata-web node migrate.js        # migrations
```

## Deploying on Google Cloud Run

- One service from the image above: `min-instances: 1`, `max-instances: 1`, instance-based CPU (`--no-cpu-throttling`), container
  port from `PORT`, Cloud SQL instance attached, service account with access to the
  `GCS_BUCKET` bucket (Storage Object Admin) — no HMAC keys.
- Set `ORIGIN` and `BETTER_AUTH_URL` to `https://kumiai.hirokata.dev`.
- To enable the AI agents set `AGENT_RUNTIME_NAME` and grant the service account
  `roles/aiplatform.user`.
- Server-sent events are held open by the request: raise the Cloud Run request timeout
  (up to 60 minutes) — the browser reconnects automatically when it expires.
- Run `node migrate.js` as a Job before each rollout that includes new migrations.
