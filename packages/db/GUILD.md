# Guild warehouse in Postgres

This is the guild plugin's SQLite warehouse (`plugins/guild/schema.sql` v9.3) ported to Postgres. The spec is
`docs/guild-contract.md` §2–3. The Drizzle schema in `src/schema/kumiai-*.ts` is the source of truth for tables.
Everything Drizzle cannot express (functions, triggers, views, backfill) is hand-written SQL at the end of
`apps/api/drizzle/0005_guild_warehouse.sql`.

## Attribution: set it once per transaction

The triggers write every `kumiai_event` row. They read these **transaction-local** settings:

| setting               | used for                                                                 | if unset          |
|-----------------------|--------------------------------------------------------------------------|-------------------|
| `kumiai.actor`        | `event.actor` (the guild member: `orchestrator`, `developer-svelte`, …)  | `'orchestrator'`  |
| `kumiai.user_id`      | `event.user_id` (the authenticated `users.id`)                           | `NULL`            |
| `kumiai.workspace_id` | guard: every guild row written in the tx must be in this workspace       | no guard          |
| `kumiai.team_id`      | set for completeness; the row's own `team_id` is checked against its workspace | —           |

Use the helper. It runs one transaction (contract rule 5) and sets the four settings with `set_config(…, true)`.
They are cleared at COMMIT/ROLLBACK, so a pooled connection never carries them into the next request:

```ts
import { db, withGuildTx, allocateKey } from "@kata/db";

await withGuildTx(db, { actor, userId, teamId, workspaceId }, async (tx) => {
  // every insert/update in here is attributed to `actor` and confined to `workspaceId`
});
```

`setGuildContext(tx, ctx)` does the same thing on a transaction you already opened.

Some guild triggers take the actor from the row itself, exactly as `schema.sql` does: a plan approval uses
`approved_by`, a bug uses `found_by`, a finding uses `reviewer`, a work log line uses `agent` (and its `ts`), a doc
uses `source`, and a knowledge edge uses `created_by`. Each one falls back to `kumiai.actor`.

## Keys

- `GOAL / PROJ / REQ / PLAN / TASK / BUG / INSP` keys are allocated per workspace from `kumiai_key_counters`.
  Either leave `key` NULL on insert (a trigger allocates it), or call `allocateKey(tx, workspaceId, "TASK")`
  **inside the same transaction** when you need the key first. A key you supply as `PREFIX-NNN` moves the
  counter past it. Keys never change after insert, because events and knowledge edges name rows by key.
- Graph node ids (`kumiai_graph_node.key`) are composed by the caller: `<REQ key>/<node_key>`, or
  `<REQ key>/<node_key>.<suffix>` for a fanned node. `node_key` stores only the template key (`implement`).
  Coverage uses `key` (`checkout-flow`). Docs use `slug`. All of these are unique per workspace.
- Findings, work log, deviations, knowledge edges, doc revisions and events keep the guild's integer `id`
  (a bigint identity).
- Foreign keys are internal nanoid ids. Views and payloads expose guild keys.

## Workspace scope

Every guild table has `team_id` and `workspace_id`. Trigger `kumiai_a_scope` fills them from the parent row when
they are omitted. It rejects a row whose parent is in another workspace, a team that does not own the workspace,
and (inside `withGuildTx`) a row outside the transaction's workspace. The error codes map like this:

- `23514` (check_violation): VALIDATION
- `23503` (foreign_key_violation): NOT_FOUND
- `42501` (insufficient_privilege): FORBIDDEN
- `23505` (unique_violation): CONFLICT

An unaffiliated requirement (`project_id` NULL) with no `workspace_id` goes to the team's default workspace.
`kumiai_graph_edge.requirement_id` and `kumiai_gate.requirement_id` are filled from the node.

## Views

- `kumiai_v_<name>`: one for every guild `v_<name>`. It has the same columns in the same order after a leading
  `workspace_id`, and it follows the same rule, scoped to one workspace. **Always filter by `workspace_id`.**
- `kumiai_g_<table>`: each table shaped exactly like the guild table. `id` is the key, foreign keys are keys,
  0/1 ints replace booleans, and project status and priority are mapped. These views also add `workspace_id` and
  `kumiai_id`, which suits the `get` and `list` tools.
- Kumiai project `backlog` reads as `todo`. Priority `urgent/high/medium/low` reads as `1/2/3/4`, and guild 5 is
  stored as `low` (`kumiaiPriorityOf`).
- Timestamps are UTC wall-clock `timestamp` values. Serialize them with `toIsoUtc()`. Counts are `int`.
  `v_brief.value` is text.

## Deliberate differences from SQLite

- `task.files` must be a JSON **array**. The guild only CHECKs `json_valid`; G2 asserts the array shape.
- Prefixed keys are CHECKed to `PREFIX-NNN` (G3 shape) at write time.
- `event.ts` uses the wall clock (`clock_timestamp()`), so events inside one transaction still order.
- `v_decision_log` joins its id lists in edge order. SQLite's `group_concat` order is unspecified.
- `v_failed_tasks` matches the waiver with `ILIKE`, because SQLite's `LIKE` is case-insensitive for ASCII.
- Rows that predate the warehouse got a backfilled `created` event (`actor 'user'`, `"backfilled": true`)
  so that G7's no-created-event clause holds. They have no `moved` history.
