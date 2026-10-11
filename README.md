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
- Request-based CPU billing is fine: nothing runs after a response is sent.

`GET /healthz` answers `{"ok":true,"db":true}` (503 when the database is unreachable).

## Local development

Needs Node 24, pnpm and Docker (only for the Postgres container). There is no compose file for
development: the app runs on the host and Postgres runs as a single named container.

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
it (below) or use `docker-compose.yml` against an existing Postgres.

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
| `BETTER_AUTH_URL` | yes | Public origin of the app, e.g. `https://kumiai.hirokata.dev` (OAuth callback base) |
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

- One service from the image above: `max-instances: 1`, request-based CPU, container
  port from `PORT`, Cloud SQL instance attached, service account with access to the
  `GCS_BUCKET` bucket (Storage Object Admin) — no HMAC keys.
- Set `ORIGIN` and `BETTER_AUTH_URL` to `https://kumiai.hirokata.dev`.
- To enable the AI agents set `AGENT_RUNTIME_NAME` and grant the service account
  `roles/aiplatform.user`.
- Server-sent events are held open by the request: raise the Cloud Run request timeout
  (up to 60 minutes) — the browser reconnects automatically when it expires.
- Run `node migrate.js` as a Job before each rollout that includes new migrations.
