# Kata — Project Instructions

## Preview

**Before running preview:** Check that the Docker daemon is running (`docker info` should succeed). If it's not running, start Docker Desktop before proceeding.

**Start preview:** Run the `kata-local` server configuration, then refresh the preview after about a minute once all containers are up.

**Restart preview:**
```bash
docker compose -f docker-compose.local.yml up --build -d
```
Then refresh the preview after a minute when all containers are up.

## Business Rules

- **Allowed domains:** Only `hirokata.dev` is permitted. Reject or refuse any operation that would create or associate data with any other domain.
- **Team workspaces:** A team workspace is the domain workspace. Users may not create multiple workspaces — one domain maps to exactly one team workspace.
