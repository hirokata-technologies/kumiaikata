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

## Local development with Docker

This mirrors the production runtime. For fast iteration with HMR, use `npm run dev` on the host instead.

```bash
cp .env.example .env
docker compose up --build
```

> **Note:** `PORT` must be a numeric integer in the range 1–65535. An invalid value (e.g. a string or 0) causes a Node.js startup crash. Railway sets `PORT` automatically in production.

Then open http://localhost:3000.

To verify the API route:

```bash
curl http://localhost:3000/api/hello
# {"message":"Hello World"}
```

## Build and publish the image to ghcr.io

```bash
# 1. Authenticate (one-time). Create a PAT with `write:packages`.
echo "$GHCR_TOKEN" | docker login ghcr.io -u <your-github-username> --password-stdin

# 2. Build for linux/amd64 (Railway's runtime).
docker buildx build --platform linux/amd64 \
  -t ghcr.io/<owner>/<repo>:latest \
  -t ghcr.io/<owner>/<repo>:$(git rev-parse --short HEAD) \
  --push .
```

Replace `<owner>` and `<repo>` with your GitHub org/user and repository name.

## Deploy on Railway

1. Create a new Railway service from a Docker image source.
2. Set the image to `ghcr.io/<owner>/<repo>:latest` (or a specific SHA tag).
3. If the image is private, add a Railway image registry credential pointing at ghcr.io with the same PAT used above.
4. Railway sets `PORT` automatically — the app reads it via `adapter-node`. No further configuration is required.
5. After deploy, hit `https://<your-railway-domain>/` to see Hello World and `https://<your-railway-domain>/api/hello` to verify the API.

## Services

This monorepo contains two deployable services:

- `apps/web` — SvelteKit frontend. Built from the root `Dockerfile`. Default port 3000.
- `apps/api` — Hono backend. Built from `apps/api/Dockerfile`. Default port 8787. See `apps/api/README.md` for env vars and volume requirements.

Each is a separate Railway service.
