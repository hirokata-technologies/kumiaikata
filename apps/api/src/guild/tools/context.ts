import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, kumiaiGuildState, teams, toIsoUtc, users } from "@kata/db";
import {
	GuildError,
	actorInput,
	assertWorkspace,
	defineTool,
	guildWrite,
	workspaceInput,
	type GuildToolDef,
} from "../registry.js";
import { GUILD_CONTRACT_VERSION } from "../../mcp/resource.js";
import { createWorkspace, listWorkspaces, type WorkspaceDetail } from "../../services/kumiai/workspaces.js";

/** The guild_state key the contract reserves: the per-call `actor` param replaces it (§4.1). */
const RESERVED_STATE_KEY = "actor";

const stateKeyInput = z.string().trim().min(1).max(64).describe("guild_state key, e.g. last-checkin");

function serializeWorkspace(w: WorkspaceDetail): Record<string, unknown> {
	return {
		id: w.id,
		name: w.name,
		isDefault: w.isDefault,
		goalCount: w.goalCount,
		projectCount: w.projectCount,
		createdAt: toIsoUtc(w.createdAt),
		updatedAt: toIsoUtc(w.updatedAt),
	};
}

const whoami = defineTool({
	name: "whoami",
	title: "Who am I",
	description: "Return the authenticated Kumiai user, their team workspace, and the guild contract version.",
	input: z.object({}),
	readOnly: true,
	handler: async ({ caller }) => {
		const [user] = await db
			.select({ id: users.id, email: users.email, name: users.name })
			.from(users)
			.where(eq(users.id, caller.userId))
			.limit(1);
		const [team] = await db
			.select({ id: teams.id, name: teams.name })
			.from(teams)
			.where(eq(teams.id, caller.teamId))
			.limit(1);
		if (!user || !team) throw new GuildError("UNAUTHENTICATED", "The authenticated account no longer exists.");
		return { user, team, contract: GUILD_CONTRACT_VERSION };
	},
});

const listWorkspacesTool = defineTool({
	name: "list_workspaces",
	title: "List workspaces",
	description: "List the workspaces of the caller's team, the default workspace first.",
	input: z.object({}),
	readOnly: true,
	handler: async ({ caller }) => {
		const workspaces = await listWorkspaces(caller.teamId);
		return { workspaces: workspaces.map(serializeWorkspace) };
	},
});

const createWorkspaceTool = defineTool({
	name: "create_workspace",
	title: "Create workspace",
	description: "Create a workspace in the caller's team. Names are unique per team (CONFLICT otherwise).",
	input: z.object({ name: z.string().trim().min(1).max(60).describe("Workspace name") }),
	handler: async ({ caller }, { name }) => serializeWorkspace(await createWorkspace(caller.teamId, name)),
});

const getState = defineTool({
	name: "get_state",
	title: "Get guild state",
	description: "Read the workspace's guild_state rows: all of them, or the one named by `key`.",
	input: z.object({ workspace: workspaceInput, key: stateKeyInput.optional() }),
	readOnly: true,
	handler: async ({ caller }, { workspace, key }) => {
		await assertWorkspace(caller, workspace);
		const rows = await db
			.select({ key: kumiaiGuildState.key, value: kumiaiGuildState.value })
			.from(kumiaiGuildState)
			.where(
				and(
					eq(kumiaiGuildState.workspaceId, workspace),
					key === undefined ? undefined : eq(kumiaiGuildState.key, key),
				),
			)
			.orderBy(asc(kumiaiGuildState.key));
		return { rows };
	},
});

const setState = defineTool({
	name: "set_state",
	title: "Set guild state",
	description:
		"Upsert one guild_state row. The `actor` key is ignored (nothing is written): attribution comes from the `actor` param of each write.",
	input: z.object({ workspace: workspaceInput, actor: actorInput, key: stateKeyInput, value: z.string().max(10_000) }),
	handler: async ({ caller }, { workspace, actor, key, value }) => {
		if (key === RESERVED_STATE_KEY) {
			await assertWorkspace(caller, workspace);
			return { key, value: actor, ignored: true };
		}
		return guildWrite(caller, workspace, actor, async (tx) => {
			const [row] = await tx
				.insert(kumiaiGuildState)
				.values({ teamId: caller.teamId, workspaceId: workspace, key, value })
				.onConflictDoUpdate({
					target: [kumiaiGuildState.workspaceId, kumiaiGuildState.key],
					set: { value: sql`excluded.value` },
				})
				.returning({ key: kumiaiGuildState.key, value: kumiaiGuildState.value });
			if (!row) throw new GuildError("CONFLICT", "The state row could not be written.");
			return row;
		});
	},
});

/** Contract §4.1 — whoami, workspaces, guild_state. */
export const contextTools: GuildToolDef[] = [whoami, listWorkspacesTool, createWorkspaceTool, getState, setState];
