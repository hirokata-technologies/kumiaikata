---
plan: PLAN-002
slice: auth
title: "Better Auth setup, Google SSO, domain allow-list, auto-provisioning, middleware"
complexity: 3
---

# Better Auth setup, Google SSO, domain allow-list, auto-provisioning, middleware

## Goal

Stand up authentication end-to-end. After this slice:

- `GET/POST /api/auth/*` is handled by Better Auth with the Google social provider.
- Sign-ins from email domains not in `ALLOWED_DOMAINS` are rejected with `403 DOMAIN_NOT_ALLOWED`.
- A first-time successful sign-in atomically creates the user's personal board and joins them to (or creates) their email-domain team and its team board.
- Route handlers can use `requireSession` to gate access and `loadBoardAccess(boardId)` to derive the user's role on a given board.

## Files to Create / Modify

- `apps/api/src/auth/better-auth.ts` — create. Build the Better Auth instance with the Mongo adapter, Google plugin, `additionalFields.personalBoardId`, `signIn.before` hook, and `databaseHooks.user.create.after` hook.
- `apps/api/src/auth/domain-allowlist.ts` — create. Helper `isAllowedDomain(email): boolean` and `assertAllowedDomain(email)` that throws `AppError('DOMAIN_NOT_ALLOWED', ...)`.
- `apps/api/src/auth/provisioning.ts` — create. `provisionUser(userDoc)` — runs the team-find-or-create, team-board-find-or-create, personal-board creation, and team-member upsert in a Mongo transaction.
- `apps/api/src/auth/middleware.ts` — create. `requireSession`, `loadBoardAccess(boardId)`, `requireBoardAdmin`, helpers.
- `apps/api/src/routes/auth.ts` — create. Mounts the Better Auth handler under `/api/auth/*`.
- `apps/api/src/app.ts` — modify. Register the auth routes; do NOT put `requireSession` globally (auth routes themselves are public).
- `apps/api/src/db/models/user.ts` — create. A thin Mongoose model pointed at the `user` collection that Better Auth's Mongo adapter manages, with the same `additionalFields`. Used only for read queries (we never write to `user` outside Better Auth).
- `apps/api/.env.example` — verify entries for `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_DOMAINS` are present (already added in scaffolding slice — confirm).

## Implementation Steps

### 1. Domain allow-list helper (`auth/domain-allowlist.ts`)

```ts
import { env } from '../env';
import { AppError } from '../http/error';

const allowed = new Set(env.ALLOWED_DOMAINS.map(d => d.toLowerCase()));

export const domainOf = (email: string) => email.toLowerCase().split('@')[1] ?? '';
export const isAllowedDomain = (email: string) => allowed.has(domainOf(email));
export function assertAllowedDomain(email: string) {
  if (!isAllowedDomain(email)) {
    throw new AppError('DOMAIN_NOT_ALLOWED', `Sign-in from domain "${domainOf(email)}" is not permitted.`);
  }
}
```

### 2. Better Auth instance (`auth/better-auth.ts`)

```ts
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import mongoose from 'mongoose';
import { env } from '../env';
import { assertAllowedDomain } from './domain-allowlist';
import { provisionUser } from './provisioning';

export const auth = betterAuth({
  database: mongodbAdapter(mongoose.connection.getClient().db()),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET
    }
  },
  user: {
    additionalFields: {
      personalBoardId: { type: 'string', required: false }
    }
  },
  hooks: {
    before: async (ctx) => {
      // Runs for every auth request; we only care about sign-in attempts.
      if (ctx.path?.startsWith('/sign-in') || ctx.path?.includes('/callback/google')) {
        const email = ctx.context?.user?.email ?? ctx.body?.email;
        if (email) assertAllowedDomain(email);
      }
    }
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await provisionUser(user);
        }
      }
    }
  }
});
```

Notes:
- Mongo adapter requires the raw `MongoClient`. Because we already use Mongoose, expose `mongoose.connection.getClient()` after the connection is open. The auth module imports `./db/connection` for its side effect first.
- `hooks.before` semantics per Better Auth docs: throwing an `APIError` (or our `AppError`, surfaced through the Hono onError) aborts the flow. Verify the exact hook name/path-shape against the installed `better-auth` version at implementation time; adjust if the API has shifted.

### 3. Auto-provisioning (`auth/provisioning.ts`)

```ts
import mongoose from 'mongoose';
import { Board, Team, TeamMember } from '../db/models';
import { User } from '../db/models/user';
import { domainOf } from './domain-allowlist';

export async function provisionUser(user: { id: string; email: string; name?: string }) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // 1. Personal board
      const personalBoard = await Board.create([{
        kind: 'personal',
        title: `${(user.name ?? '').split(' ')[0] || 'My'}'s Board`,
        ownerId: user.id
      }], { session });
      await User.updateOne({ _id: user.id }, { $set: { personalBoardId: personalBoard[0]._id } }, { session });

      // 2. Team find-or-create
      const domain = domainOf(user.email);
      const team = await Team.findOneAndUpdate(
        { domain },
        { $setOnInsert: { domain, name: domain } },
        { upsert: true, new: true, session }
      );

      // 3. Team board find-or-create (only if team didn't already have one)
      if (!team.teamBoardId) {
        const teamBoard = await Board.create([{
          kind: 'team',
          title: `${domain} Board`,
          teamId: team._id
        }], { session });
        team.teamBoardId = teamBoard[0]._id;
        await team.save({ session });
      }

      // 4. Team membership — first member becomes admin
      const existingCount = await TeamMember.countDocuments({ teamId: team._id }).session(session);
      const role = existingCount === 0 ? 'admin' : 'member';
      await TeamMember.updateOne(
        { teamId: team._id, userId: user.id },
        { $setOnInsert: { teamId: team._id, userId: user.id, role, joinedAt: new Date() } },
        { upsert: true, session }
      );
    });
  } finally {
    await session.endSession();
  }
}
```

If the transaction fails the user row still exists (Better Auth has already created it). Log the failure with full context. Per US-2 / US-4 edge cases this is acceptable; remediation is manual.

### 4. Middleware (`auth/middleware.ts`)

```ts
type Access =
  | { kind: 'personal-owner'; boardId: string }
  | { kind: 'team-admin';  boardId: string; teamId: string }
  | { kind: 'team-member'; boardId: string; teamId: string };

export const requireSession = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new AppError('UNAUTHENTICATED', 'Sign-in required.');
  c.set('user', session.user);
  c.set('session', session.session);
  await next();
});

export const loadBoardAccess = createMiddleware(async (c, next) => {
  const boardId = c.req.param('boardId');
  const user = c.get('user');
  const board = await Board.findById(boardId);
  if (!board) throw new AppError('NOT_FOUND', 'Board not found.');

  let access: Access | null = null;
  if (board.kind === 'personal' && String(board.ownerId) === String(user.id)) {
    access = { kind: 'personal-owner', boardId: String(board._id) };
  } else if (board.kind === 'team') {
    const m = await TeamMember.findOne({ teamId: board.teamId, userId: user.id });
    if (m) access = { kind: m.role === 'admin' ? 'team-admin' : 'team-member', boardId: String(board._id), teamId: String(board.teamId) };
  }
  if (!access) throw new AppError('FORBIDDEN', 'You do not have access to this board.');

  c.set('board', board);
  c.set('access', access);
  await next();
});

export const requireBoardAdmin = createMiddleware(async (c, next) => {
  const a = c.get('access');
  if (a.kind === 'team-member') throw new AppError('FORBIDDEN', 'Admins or owners only.');
  await next();
});
```

`requireBoardAdmin` allows `personal-owner` and `team-admin`, rejects `team-member`. This is the gate for column CRUD and label CRUD (US-5, US-11).

### 5. Auth routes (`routes/auth.ts`)

```ts
import { Hono } from 'hono';
import { auth } from '../auth/better-auth';
const r = new Hono();
r.all('/*', (c) => auth.handler(c.req.raw));
export default r;
```

Mount in `app.ts`: `app.route('/api/auth', authRouter)`.

### 6. Sign-out behaviour

Better Auth handles `POST /api/auth/sign-out` natively — no extra code needed. US-1 #3 / #4 are satisfied by the middleware: invalid or missing session → `requireSession` throws 401.

## Interface Contract

Exposed to later slices:

- `import { requireSession, loadBoardAccess, requireBoardAdmin } from '../auth/middleware'`.
- `c.get('user')`, `c.get('session')`, `c.get('board')`, `c.get('access')` typed via Hono's `Variables` declaration (add to `app.ts`).
- `import { auth } from '../auth/better-auth'` for any slice that needs to call `auth.api.getSession(...)` directly (e.g., the SSE slice, to validate session inside the streaming handler).

Consumes from sibling slices:

- All db models from db-models slice.
- `AppError` and `env` from primitives + scaffolding slices.

Routes contract for callers:

- `POST /api/auth/sign-in/social` with `{ provider: "google" }` returns Better Auth's standard payload.
- `POST /api/auth/sign-out` invalidates the session.
- Domain-rejected sign-ins return `{ "error": { "code": "DOMAIN_NOT_ALLOWED", ... } }` with status 403.

## Acceptance Criteria

- [ ] Signing in with a Google account whose domain is in `ALLOWED_DOMAINS` creates a user, a personal board, joins/creates the domain team, and creates the team board on first sign-in.
- [ ] Signing in with a domain not in `ALLOWED_DOMAINS` returns 403 with code `DOMAIN_NOT_ALLOWED` and creates no user.
- [ ] The second sign-in from the same domain joins the existing team as `member`, not `admin`, and does not create a second team or team board.
- [ ] Two concurrent first sign-ins from the same new domain result in exactly one team row and one team board (verified by hammering the endpoint locally or reading the unique-index logic).
- [ ] A request to any route guarded by `requireSession` without a valid session returns 401.
- [ ] `requireBoardAdmin` returns 403 for a team-member attempting column CRUD; allows it for team-admin and personal-owner.
- [ ] User without a first name from Google gets a personal board titled `My's Board` — wait, the requirement says fall back to `"My Board"`; the implementation must produce that exact title when `name` is empty. Adjust the title formula accordingly.
- [ ] `pnpm --filter @kata/api check` passes.
