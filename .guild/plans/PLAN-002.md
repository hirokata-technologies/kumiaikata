---
id: PLAN-002
title: "Kanban Board Management API Implementation Plan"
requirement: REQ-002
task: TASK-007
created: 2026-05-23
---

# Kanban Board Management API Implementation Plan

> Note on numbering: PLAN-001 was issued to REQ-001 (dependency bumps). The BOARD.md `next-plan` cursor was stale; this plan is PLAN-002. Update BOARD.md `next-plan` to `3` after merging.

## Architecture Overview

The `apps/api` package is a standalone Hono + Node.js service that owns all kanban data and business logic. It runs as a separate Railway service from the SvelteKit frontend (`apps/web`) and communicates only via HTTP (REST + SSE).

### High-level component map

```
apps/api
├── src/
│   ├── index.ts                 # entrypoint — serve(app, { port: PORT })
│   ├── app.ts                   # Hono app composition, route mounting, error handler
│   ├── env.ts                   # validated env loader (zod)
│   ├── db/
│   │   ├── connection.ts        # mongoose.connect singleton + graceful shutdown
│   │   └── models/              # one file per collection
│   │       ├── user.ts          # owned by better-auth schema, re-exported
│   │       ├── team.ts
│   │       ├── board.ts
│   │       ├── column.ts
│   │       ├── card.ts
│   │       ├── label.ts
│   │       └── attachment.ts
│   ├── auth/
│   │   ├── better-auth.ts       # Better Auth instance + Google plugin
│   │   ├── domain-allowlist.ts  # signIn.before hook
│   │   ├── provisioning.ts      # user.create.after hook (personal board + team join)
│   │   └── middleware.ts        # Hono middleware: requireSession, loadBoardAccess
│   ├── events/
│   │   ├── bus.ts               # BoardEventBus interface + InProcessEventBus impl
│   │   └── types.ts             # discriminated union of all event payloads
│   ├── storage/
│   │   ├── adapter.ts           # StorageAdapter interface
│   │   └── disk.ts              # RailwayVolumeStorage impl
│   ├── ordering/
│   │   └── fractional.ts        # wrap fractional-indexing helpers
│   ├── http/
│   │   ├── error.ts             # AppError class + envelope serialiser
│   │   ├── validate.ts          # zValidator wrapper that produces the envelope on failure
│   │   └── responders.ts        # ok/created/noContent helpers
│   ├── routes/
│   │   ├── auth.ts              # mount better-auth handler at /api/auth/*
│   │   ├── boards.ts            # GET /api/boards/personal | /team
│   │   ├── teams.ts             # GET /api/teams/mine | members | PATCH role
│   │   ├── columns.ts           # POST/PATCH/DELETE + reorder
│   │   ├── cards.ts             # CRUD + move + reorder
│   │   ├── card-comments.ts
│   │   ├── card-checklists.ts
│   │   ├── card-labels.ts
│   │   ├── card-assignees.ts
│   │   ├── card-attachments.ts
│   │   ├── labels.ts            # board-scoped CRUD
│   │   └── sse.ts               # GET /api/boards/:boardId/events
│   └── services/                # domain logic shared between routes
│       ├── boards.ts
│       ├── columns.ts
│       ├── cards.ts
│       ├── labels.ts
│       └── teams.ts
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

### Request lifecycle

1. Hono receives a request → CORS + logger middleware run.
2. For protected routes, `requireSession` middleware calls Better Auth's `getSession` and sets `c.var.user` / `c.var.session`. 401 if absent.
3. `loadBoardAccess(boardId)` middleware fetches the board, derives the user's role on it (personal owner / team admin / team member / none), and sets `c.var.board` and `c.var.access`. 403/404 if not authorised.
4. The route handler validates the body via Zod, calls into a service, and returns the JSON response.
5. On any mutation, the service emits a `BoardEvent` to the bus. The SSE route subscribes to events for its board and pushes them to the client.

### SSE fan-out

In-process `EventEmitter`-based `BoardEventBus` keyed by `boardId`. This assumes a single API instance — sufficient for the Railway free / starter tier and for the user's expected scale. The bus is hidden behind an interface so the implementation can be swapped for Redis pub/sub or MongoDB Change Streams if horizontal scaling becomes required, without touching route code.

### Position management

Fractional indexing using the [`fractional-indexing`](https://www.npmjs.com/package/fractional-indexing) package. `position` is a short opaque string (`"a0"`, `"a1"`, `"a0V"`, etc.). Inserting between two siblings only writes the moved row — never a bulk re-numbering. Periodic rebalancing is not needed for human-scale board sizes.

### Storage

Railway volume mounted at `/data/attachments`. The API writes files under `/data/attachments/<boardId>/<attachmentId><ext>` and serves them through an authenticated `GET /api/attachments/:attachmentId` route (NOT via static file serving) so that team-scoped access control is enforced on every download. The `StorageAdapter` interface (`put`, `get`, `delete`) keeps the door open for an S3-compatible backend.

### Error envelope

```jsonc
{
  "error": {
    "code": "FORBIDDEN",                  // SCREAMING_SNAKE, stable
    "message": "Only team admins may rename columns.",
    "details": { "field": "title" }       // optional
  }
}
```

Codes used: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `DOMAIN_NOT_ALLOWED`, `INTERNAL_ERROR`.

## Codebase Analysis

### Monorepo state

- pnpm workspace at root with `packages: ['apps/*', 'packages/*']` (see `pnpm-workspace.yaml`).
- Single app today: `apps/web` named `@kata/web` (SvelteKit + Svelte 5 + Tailwind v4 + bits-ui).
- Root `package.json` engines: `node: >=24`, `pnpm: >=10`. Root scripts only proxy to `@kata/web` via `pnpm --filter`. New API-specific scripts must be added.
- `packages/` directory exists but is empty. No shared internal package today.
- `.npmrc` sets `engine-strict=true` — the new package must declare matching engines or pnpm will refuse to install.
- `.nvmrc` pins Node 24.

### Tooling conventions

- TypeScript across the repo (`@kata/web` uses TS, root has none of its own).
- Tab indentation in `package.json`.
- No ESLint/Prettier configs at root — each package configures its own (or none — `@kata/web` has none).
- No CI workflows present.

### Build / runtime

- Root `Dockerfile` is SvelteKit-specific (three stages: `prod-deps`, `build`, `runtime`). It builds `@kata/web` and ships only `apps/web/build` + a clean prod `node_modules`. **It cannot be reused as-is for the API.** A second Dockerfile (`apps/api/Dockerfile`) is the cleanest approach because Railway services map 1:1 to Dockerfiles, and the existing one's `npm install --omit=dev` step at `apps/web/package.json` makes it tightly coupled to the web app.
- `docker-compose.yml` exposes only the SvelteKit app on port 3000. The API will run on a different port (default 8787) locally; compose can grow a second service in a later iteration but is not on the critical path.

### Frontend interaction (informational only)

The Svelte app currently has no API client. The API is being built in isolation; cross-package wiring is out of scope. The frontend will be expected to call `https://<api-host>/api/*` and pass session cookies; CORS will be configured to allow the web origin.

### Guild prior work

- `.guild/docs/` is empty — no prior research artefacts to consume.
- `.guild/plans/PLAN-001.md` is the unrelated dependency-bump plan (REQ-001). No reusable design.

## Data Model

All collections live in a single MongoDB database. Mongoose `_id` is the canonical `id` (returned as a string).

### `users` (managed by Better Auth)
Better Auth's MongoDB adapter creates and owns `user`, `session`, `account`, `verification` collections. We extend `user` with `additionalFields`:

| Field | Type | Notes |
|-------|------|-------|
| `_id` | ObjectId | Better Auth-generated |
| `name`, `email`, `image`, `emailVerified` | as Better Auth defaults | |
| `personalBoardId` | ObjectId | Set by provisioning hook; nullable. |

### `teams`
| Field | Type | Notes |
|-------|------|-------|
| `_id` | ObjectId | |
| `domain` | string, unique | lowercased email domain |
| `name` | string | defaults to `domain` at creation |
| `teamBoardId` | ObjectId | set by provisioning hook |
| `createdAt` / `updatedAt` | Date | Mongoose timestamps |

### `teamMembers`
| Field | Type | Notes |
|-------|------|-------|
| `_id` | ObjectId | |
| `teamId` | ObjectId, indexed | |
| `userId` | ObjectId, indexed | |
| `role` | `"admin" | "member"` | |
| `joinedAt` | Date | |

Composite unique index on `(teamId, userId)`.

### `boards`
| Field | Type | Notes |
|-------|------|-------|
| `_id` | ObjectId | |
| `kind` | `"personal" | "team"` | |
| `title` | string | |
| `ownerId` | ObjectId? | set when `kind === "personal"` |
| `teamId` | ObjectId? | set when `kind === "team"` |
| `createdAt` / `updatedAt` | Date | |

Partial unique indexes:
- `{ ownerId: 1 }` where `kind === "personal"` → at most one personal board per user.
- `{ teamId: 1 }` where `kind === "team"` → at most one team board per team.

### `columns`
| Field | Type | Notes |
|-------|------|-------|
| `_id` | ObjectId | |
| `boardId` | ObjectId, indexed | |
| `title` | string | |
| `position` | string | fractional index |
| `createdAt` / `updatedAt` | Date | |

Compound index `{ boardId: 1, position: 1 }`.

### `cards`
| Field | Type | Notes |
|-------|------|-------|
| `_id` | ObjectId | |
| `boardId` | ObjectId, indexed | denormalised for board-wide auth + queries |
| `columnId` | ObjectId, indexed | |
| `title` | string | |
| `description` | string? | markdown, up to 10k chars |
| `position` | string | fractional index within `columnId` |
| `dueDate` | Date? | UTC |
| `labelIds` | ObjectId[] | references `labels` |
| `assigneeIds` | ObjectId[] | references `users` |
| `comments` | embedded array | `{ id, authorId, body, createdAt, updatedAt }` |
| `checklists` | embedded array | `{ id, title, items: [{ id, text, checked }] }` |
| `attachmentIds` | ObjectId[] | references `attachments` |
| `createdAt` / `updatedAt` | Date | |

Compound index `{ columnId: 1, position: 1 }`. Comments and checklists are embedded because they are always loaded with the card and have no cross-card queries; attachments are a separate collection because deletion needs cascaded file removal and we want to query by uploader for housekeeping.

### `labels`
| Field | Type | Notes |
|-------|------|-------|
| `_id` | ObjectId | |
| `boardId` | ObjectId, indexed | |
| `name` | string, ≤50 chars | |
| `color` | string | `#RGB` or `#RRGGBB` |

### `attachments`
| Field | Type | Notes |
|-------|------|-------|
| `_id` | ObjectId | |
| `cardId` | ObjectId, indexed | |
| `boardId` | ObjectId, indexed | for auth + cascade |
| `filename` | string | original |
| `mimeType` | string | |
| `sizeBytes` | number | |
| `storageKey` | string | adapter-specific path |
| `uploadedBy` | ObjectId | user id |
| `createdAt` | Date | |

## Implementation Tasks

### 1. Package scaffolding and monorepo wiring (complexity: 2)
- **Slice**: `.guild/plans/PLAN-002/slice-scaffolding.md`
- **Summary**: Create `apps/api` with `package.json`, `tsconfig.json`, `.env.example`, dev script via `tsx`, build script via `tsc`, root scripts proxied, and an `apps/api/Dockerfile` for Railway.
- **Depends on**: nothing.

### 2. MongoDB connection and Mongoose models (complexity: 2)
- **Slice**: `.guild/plans/PLAN-002/slice-db-models.md`
- **Summary**: Implement `db/connection.ts` and one Mongoose schema per collection (boards, columns, cards, labels, attachments, teams, teamMembers). Set indexes per the data model.
- **Depends on**: Task 1.

### 3. Cross-cutting primitives — error envelope, validation, ordering, event bus, storage adapter (complexity: 2)
- **Slice**: `.guild/plans/PLAN-002/slice-primitives.md`
- **Summary**: Implement `http/error.ts`, `http/validate.ts`, `http/responders.ts`, `ordering/fractional.ts`, `events/bus.ts` + `events/types.ts`, and `storage/adapter.ts` + `storage/disk.ts`. These are consumed by every later slice.
- **Depends on**: Task 1.

### 4. Better Auth setup, Google SSO, domain allow-list, auto-provisioning, session middleware (complexity: 3)
- **Slice**: `.guild/plans/PLAN-002/slice-auth.md`
- **Summary**: Configure Better Auth with Mongo adapter and Google plugin, enforce `ALLOWED_DOMAINS` in `signIn.before`, run personal-board + team-join in `databaseHooks.user.create.after`, mount the handler at `/api/auth/*`, and expose `requireSession` and `loadBoardAccess` middleware.
- **Depends on**: Tasks 2, 3.

### 5. Board and team read routes (complexity: 1)
- **Slice**: `.guild/plans/PLAN-002/slice-boards-teams-routes.md`
- **Summary**: Implement `GET /api/boards/personal`, `GET /api/boards/team`, `GET /api/teams/mine`, `GET /api/teams/:teamId/members`, `PATCH /api/teams/:teamId/members/:userId`. Includes the "last admin" guard.
- **Depends on**: Task 4.

### 6. Column CRUD + reorder (complexity: 2)
- **Slice**: `.guild/plans/PLAN-002/slice-columns-routes.md`
- **Summary**: `POST/PATCH/DELETE /api/boards/:boardId/columns/...` plus `PATCH .../columns/reorder`. Admin/owner gate, empty-column-on-delete guard, fractional position assignment, event emission.
- **Depends on**: Tasks 3, 4.

### 7. Card CRUD + move + reorder (complexity: 3)
- **Slice**: `.guild/plans/PLAN-002/slice-cards-routes.md`
- **Summary**: `POST/PATCH/DELETE /api/boards/:boardId/...` for cards, plus `PATCH .../cards/:cardId/move` and `PATCH .../columns/:columnId/cards/reorder`. Cascade deletes (attachments + storage), event emission.
- **Depends on**: Tasks 3, 4, 6.

### 8. Card detail routes — comments, checklists, assignees, labels (complexity: 2)
- **Slice**: `.guild/plans/PLAN-002/slice-card-detail-routes.md`
- **Summary**: All sub-resource endpoints on `/api/boards/:boardId/cards/:cardId/{comments,checklists,assignees,labels}` plus board-level `/api/boards/:boardId/labels` CRUD. Comment author / admin authorisation, team-membership validation for assignees.
- **Depends on**: Tasks 3, 4, 7.

### 9. Card attachments (upload, download, delete) (complexity: 2)
- **Slice**: `.guild/plans/PLAN-002/slice-attachments.md`
- **Summary**: Multipart upload to disk storage, authenticated download endpoint, delete that removes both DB row and file. Size + MIME enforcement.
- **Depends on**: Tasks 3, 4, 7.

### 10. SSE real-time endpoint (complexity: 2)
- **Slice**: `.guild/plans/PLAN-002/slice-sse.md`
- **Summary**: `GET /api/boards/:boardId/events` using Hono's `streamSSE`. Subscribes to the in-process bus for that board, cleans up on disconnect, closes on session expiry.
- **Depends on**: Tasks 3, 4. (Other slices emit events that this slice forwards; no direct code dependency on them.)

### 11. Railway deployment configuration (complexity: 1)
- **Slice**: `.guild/plans/PLAN-002/slice-railway.md`
- **Summary**: Add `apps/api/railway.json` (or `railway.toml`), document required env vars, document volume mount path. Update root README briefly.
- **Depends on**: Tasks 1, 9 (volume requirement is finalised by the attachments slice).

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Mongo driver | **Mongoose** | Schema validation, hooks (used for cascade deletes), embedded subdocs (comments/checklists), and partial unique indexes are all first-class. The official driver would require us to roll all of this by hand. |
| Position numbering | **Fractional indexing** (`fractional-indexing` package) | Single-row writes for inserts/moves; no quadratic rebalancing. Reorder endpoints become "compute key between neighbours, update one row" — but we still support a bulk `reorder` endpoint for full-list submissions, which writes only the rows whose computed position changed. |
| SSE fan-out | **In-process `EventEmitter`** via `BoardEventBus` interface | Single Railway instance is sufficient for current scale. The interface boundary means swapping to Redis pub/sub or MongoDB Change Streams later is a one-file change. Change Streams add operational complexity (requires replica set) we do not need on day one. |
| Attachment storage | **Railway volume** mounted at `/data/attachments`, behind a `StorageAdapter` | Cheaper than S3 for a small team tool; no extra cloud account; Railway provides 5GB+ on the starter tier. Adapter interface preserves the S3 escape hatch. Files are served through an authenticated route — never as static assets — to enforce per-board ACL. |
| Auth library | **Better Auth + Google plugin + Mongo adapter** | Specified by the requirement. Mongo adapter ships in `better-auth/adapters/mongodb`. |
| Domain allow-list enforcement | **`signIn.before` hook** | Runs after Google validates the user but before Better Auth creates the session, so we can throw a `403` cleanly. |
| Auto-provisioning (personal board + team join) | **`databaseHooks.user.create.after`** | Fires exactly once on first sign-in, after the user row exists. Wrapped in a transaction so partial state cannot leak. |
| Request validation | **Zod via `@hono/zod-validator`** | First-party Hono helper. Failure callback formats into our error envelope. |
| File serving | **Authenticated route, not static** | Per-board ACL must be enforced on every download. |
| Per-package Dockerfile | **`apps/api/Dockerfile` separate from root `Dockerfile`** | Railway services map to a Dockerfile each. The root file is web-specific and would need to fork anyway. Cleaner to keep them separate. |
| Default API port | **8787** | Avoids the SvelteKit dev server on 3000 and the common 5173. Overridden by `PORT` in production (Railway sets this). |
| Plan numbering | **PLAN-002** | PLAN-001 is taken by REQ-001's dependency-bump plan. BOARD.md's `next-plan: 1` was stale. |

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Better Auth's MongoDB adapter expects certain field names that clash with our `additionalFields.personalBoardId` extension. | Auth flow breaks, hard to diagnose. | The slice-auth slice spells out the `additionalFields` config explicitly and includes an acceptance check that the auth handler can complete a sign-in end-to-end against a local MongoDB. |
| Concurrent first-logins from the same new domain create two teams. | Duplicate team rows, broken auto-join thereafter. | Use `findOneAndUpdate({ domain }, { $setOnInsert: { ... } }, { upsert: true })` for team creation. The unique index on `domain` is a belt-and-braces backstop. |
| In-process event bus loses events if the API restarts mid-flight. | Clients miss updates between disconnect and reconnect. | Acceptable for v1 — SSE clients re-fetch board state on reconnect. Documented in the SSE slice. |
| Fractional positions can drift to long strings under adversarial repeated insertion at the same midpoint. | Performance degrades very slowly. | Not a practical issue for human-driven kanban use; the `fractional-indexing` README documents this. A future rebalance script is straightforward if it ever matters. |
| File uploads exceed multipart parser memory if streamed naively. | Process OOM on large uploads. | The attachments slice uses Hono's body limit middleware (e.g., 25 MB cap) and streams directly to disk via `fs.createWriteStream` rather than buffering. |
| Mongoose connection drops during a hot path. | 500s until reconnection. | `connection.ts` registers connection error logging; Mongoose auto-reconnects by default. Health-check endpoint (`GET /healthz`) returns 503 if `mongoose.connection.readyState !== 1`. |
| Disk attachments are lost if the Railway volume is reset. | User data loss. | Documented in the Railway slice. Out-of-scope to mitigate further (no backup service in v1); the storage adapter abstraction means a switch to S3 is a small project. |
| CORS misconfiguration blocks the SvelteKit frontend in production. | Frontend cannot reach API. | Auth and SSE slices use `hono/cors` with an `ALLOWED_ORIGINS` env var (comma-separated). Documented in `.env.example`. |
| `engine-strict=true` rejects the new package if engines mismatch. | `pnpm install` fails. | Scaffolding slice sets `engines: { node: ">=24" }` in `apps/api/package.json`, matching the root. |
