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
| `pnpm guild:import` | Import a local guild board (`.guild/guild.db`) into a workspace; see [Importing a local guild](#importing-a-local-guild) |

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
| `ALLOWED_DOMAINS` | yes | Comma-separated email domains allowed to sign in. `*` allows every domain (production). Free-mail users (gmail.com and similar) get a private team instead of a shared domain team |
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
| Context (§4.1) | `whoami`, `list_workspaces`, `create_workspace`, `rename_workspace`, `get_state`, `set_state` |
| Reads (§4.2) | `read_view`, `get`, `list`, `search_docs`, `check_invariants`, `fingerprint` |
| Direction (§4.3) | `create_goal`, `update_goal`, `create_project`, `update_project` |
| Work (§4.4) | requirements, plans, tasks: `create_*` / `update_*`, `set_task_status`, `claim_task`, dependencies, capabilities, `log_work` |
| Graph (§4.5) | `instantiate_graph`, `add_graph_node`, `add_graph_edge`, `add_graph_deviation`, `set_node_status`, `resolve_gate` |
| Quality (§4.6) | findings, bugs, coverage, inspections |
| Library (§4.7–4.8) | `upsert_doc`, `link`, `unlink`, `supersede_doc`, `doc_neighbors`, `record_event` |
| Import (§4.10) | `import_guild`: load a local `.guild/guild.db` (sent as JSON) into an empty workspace |
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

## Importing a local guild

A project whose guild still runs on `backend: local` keeps its board in `.guild/guild.db`
(tursodb, a SQLite file). `pnpm guild:import` copies that board into a Kumiai workspace, straight
into `DATABASE_URL` (from `apps/web/.env` if unset), so the guild can switch to `backend: kumiai`
without losing its history:

```bash
pnpm guild:import ~/Projects/some-project --workspace some-project --team <team id> --create --dry-run
pnpm guild:import ~/Projects/some-project --workspace some-project --team <team id> --create
```

Through a running Kumiai instead, with the `import_guild` tool (§4.10): the file is on your machine,
so export it as JSON and send it. The REST route takes the same input as the MCP tool:

```bash
pnpm guild:import ~/Projects/some-project --export /tmp/board.json
jq -n --arg ws "<workspace id>" --slurpfile source /tmp/board.json \
  '{workspace: $ws, actor: "user", source: $source[0], dry_run: true}' |
  curl -X POST -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
    -d @- https://<kumiai-host>/api/kumiai/guild/import_guild
```

Drop `dry_run` to import. An agent can also call `import_guild` over MCP with the same `source`.

The first argument is a `guild.db` file or a project directory containing `.guild/guild.db`.
`--workspace` is an existing workspace's id or name; with `--create` (and `--team`) it is created.
The workspace must hold no guild data yet. `--dry-run` runs the whole import and rolls it back.

Every table comes across (goals through tasks, the execution graph and gates, work log, findings,
bugs, coverage, inspections, the library and its knowledge edges, `guild_state`) and the event
feed keeps its original times and actors. Guild keys (`TASK-044`, `REQ-004/implement.TASK-011`,
doc slugs) are kept as they are; integer ids (findings, log lines, events) are renumbered because
Kumiai's are unique across workspaces. The import is one transaction and checks its row counts
before committing. Known differences: a project of priority 5 is stored as 4 (contract §3); rows
whose time the guild never filled in (a literal `%Y-%m-%dT%H:%M:%SZ`) take the time of the row
before and are reported. The importer is `apps/api/src/guild/tursodb-import.ts`; it reads the
file with Node's built-in `node:sqlite`, so Node 24 is all it needs.

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
