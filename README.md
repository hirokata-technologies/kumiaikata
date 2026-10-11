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

```bash
cp apps/web/.env.example apps/web/.env   # fill in the values
pnpm install
pnpm db:migrate                          # applies apps/api/drizzle to DATABASE_URL
pnpm dev                                 # http://localhost:5173 (pages and /api)
```

Run the production layout (one app container + Postgres) with Docker:

```bash
docker compose -f docker-compose.local.yml up --build   # http://localhost:3000
```

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
- Server-sent events are held open by the request: raise the Cloud Run request timeout
  (up to 60 minutes) — the browser reconnects automatically when it expires.
- Run `node migrate.js` as a Job before each rollout that includes new migrations.
