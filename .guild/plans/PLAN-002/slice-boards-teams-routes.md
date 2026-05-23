---
plan: PLAN-002
slice: boards-teams-routes
title: "Board and team read routes; team-member role mutation"
complexity: 1
---

# Board and team read routes; team-member role mutation

## Goal

Implement read endpoints that return the current user's boards and team, plus team-admin endpoints for member roster and role changes.

## Files to Create / Modify

- `apps/api/src/routes/boards.ts` — create. `GET /personal`, `GET /team`.
- `apps/api/src/routes/teams.ts` — create. `GET /mine`, `GET /:teamId/members`, `PATCH /:teamId/members/:userId`.
- `apps/api/src/services/boards.ts` — create. `getBoardWithColumnsAndCards(boardId)` — assembles `{ id, title, kind, createdAt, columns: [{ id, title, position, cards: [...] }] }` sorted by `position`. Used by both board endpoints and (later) the SSE bootstrap.
- `apps/api/src/services/teams.ts` — create. `getTeamForUser(userId)`, `listMembers(teamId)`, `setMemberRole(teamId, userId, role, actorId)` with the last-admin guard.
- `apps/api/src/app.ts` — modify. Mount the two routers under `/api/boards` and `/api/teams`.

## Implementation Steps

### Boards routes

```ts
const r = new Hono();

r.use('*', requireSession);

r.get('/personal', async (c) => {
  const user = c.get('user');
  const board = await Board.findOne({ kind: 'personal', ownerId: user.id });
  if (!board) throw new AppError('NOT_FOUND', 'Personal board missing — provisioning may have failed.');
  return ok(c, await getBoardWithColumnsAndCards(String(board._id)));
});

r.get('/team', async (c) => {
  const user = c.get('user');
  const membership = await TeamMember.findOne({ userId: user.id });
  if (!membership) throw new AppError('NOT_FOUND', 'No team membership found.');
  const board = await Board.findOne({ kind: 'team', teamId: membership.teamId });
  if (!board) throw new AppError('NOT_FOUND', 'Team board missing.');
  return ok(c, await getBoardWithColumnsAndCards(String(board._id)));
});
```

### Teams routes

```ts
const r = new Hono();
r.use('*', requireSession);

r.get('/mine', async (c) => {
  const user = c.get('user');
  const m = await TeamMember.findOne({ userId: user.id });
  if (!m) throw new AppError('NOT_FOUND', 'No team membership.');
  const team = await Team.findById(m.teamId);
  return ok(c, { id: String(team!._id), domain: team!.domain, name: team!.name, role: m.role });
});

r.get('/:teamId/members', async (c) => {
  const user = c.get('user');
  const { teamId } = c.req.param();
  const self = await TeamMember.findOne({ teamId, userId: user.id });
  if (!self) throw new AppError('FORBIDDEN', 'Not a member of this team.');
  const rows = await TeamMember.find({ teamId }).lean();
  const users = await User.find({ _id: { $in: rows.map(r => r.userId) } }, { email: 1 }).lean();
  const emailById = new Map(users.map(u => [String(u._id), u.email]));
  return ok(c, rows.map(r => ({
    userId: String(r.userId), email: emailById.get(String(r.userId)) ?? '', role: r.role, joinedAt: r.joinedAt
  })));
});

r.patch('/:teamId/members/:userId',
  zValidator('json', z.object({ role: z.enum(['admin', 'member']) })),
  async (c) => {
    const actor = c.get('user');
    const { teamId, userId } = c.req.param();
    const { role } = c.req.valid('json');
    return ok(c, await setMemberRole(teamId, userId, role, actor.id));
  });
```

### `setMemberRole` service

```ts
export async function setMemberRole(teamId, targetUserId, newRole, actorId) {
  const actorMembership = await TeamMember.findOne({ teamId, userId: actorId });
  if (!actorMembership || actorMembership.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only team admins may change roles.');
  }
  const target = await TeamMember.findOne({ teamId, userId: targetUserId });
  if (!target) throw new AppError('NOT_FOUND', 'User is not a member of this team.');

  if (target.role === 'admin' && newRole === 'member') {
    const adminCount = await TeamMember.countDocuments({ teamId, role: 'admin' });
    if (adminCount <= 1) throw new AppError('CONFLICT', 'At least one admin must remain on the team.');
  }
  target.role = newRole;
  await target.save();
  return { userId: targetUserId, role: target.role };
}
```

### `getBoardWithColumnsAndCards`

Pulls all columns where `boardId === ...` sorted by `position`, all cards sorted by `position` within `columnId`, groups them. Returns `{ id, kind, title, teamId?, ownerId?, createdAt, columns: [{ id, title, position, cards: [{...summary fields}] }] }`. Cards include `id, title, position, dueDate, labelIds, assigneeIds, attachmentIds`, plus aggregate counters `commentsCount`, `checklistsCount`. Full card detail (comments, checklists, attachments metadata) is fetched per-card via `GET /api/boards/:boardId/cards/:cardId` (defined in the card-detail slice).

## Interface Contract

Exposed:

- `getBoardWithColumnsAndCards(boardId)` — used by SSE bootstrap and any future "refetch" hook.
- `setMemberRole(teamId, userId, role, actorId)` — used in tests / admin scripts.

Consumes:

- `requireSession` middleware from the auth slice.
- All db models from db-models slice.
- `AppError`, `zValidator`, `ok` from primitives slice.

## Acceptance Criteria

- [ ] `GET /api/boards/personal` returns the signed-in user's personal board with `columns` (empty array initially).
- [ ] `GET /api/boards/team` returns the team board for the user's domain.
- [ ] `GET /api/teams/mine` returns `{ id, domain, name, role }`.
- [ ] `GET /api/teams/:teamId/members` returns a list with email + role + joinedAt, but only for members of that team (others get 403).
- [ ] `PATCH /api/teams/:teamId/members/:userId` with `{ role: 'admin' }` promotes when actor is admin; returns 403 when actor is member.
- [ ] Demoting the last remaining admin returns 409 with code `CONFLICT`.
- [ ] Invalid role value returns 422.
- [ ] Target user not in team returns 404.
