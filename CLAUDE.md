# Kata — Project Instructions

## Preview

**Before running preview:** Check that the Docker daemon is running (`docker info` should succeed). It is only needed for the local Postgres container (`kata-postgres`); if it is not running, start Docker Desktop first. Dependencies must be installed (`pnpm install`).

**Start preview:** Run the `kata-local` server configuration (it runs `pnpm dev`). That starts the Postgres container if needed, applies migrations, and serves the SvelteKit dev server (pages and `/api`) on http://localhost:3000. Wait for `Local: http://localhost:3000/`, then refresh the preview. Settings come from the git-ignored `apps/web/.env` (copy `apps/web/.env.example`); real secrets belong only there.

**Restart preview:** Stop the `kata-local` server and start it again. Code changes hot-reload, so a restart is only needed after changing `.env` or the dev scripts. Migrations are re-applied on every start.

**Database only:** `pnpm db:up` starts Postgres, `pnpm db:down` stops it (data is kept), `pnpm db:reset` deletes the container and its data, and `pnpm db:migrate` applies migrations.

## Business Rules

- **Allowed domains:** Sign-up is public: production sets `ALLOWED_DOMAINS=*`, which allows every email domain. A list of domains still restricts sign-up to those domains (local and CI use lists).
- **Team workspaces:** A team workspace is the domain workspace. Users may not create multiple workspaces — one domain maps to exactly one team workspace.
- **Free-mail domains:** Public mailbox providers (`gmail.com`, `outlook.com`, …, see `apps/api/src/auth/free-mail-domains.ts`) never share a team. Each such user gets a private team keyed by their full email address, and is its only member.
