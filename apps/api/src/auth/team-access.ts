import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { db, teamMembers } from "@kata/db";
import { AppError } from "@kata/http";
import type { AppVariables } from "@kata/http";

// ── KumiaiVariables ───────────────────────────────────────────────────────────

/**
 * `AppVariables` plus the caller's resolved team workspace id. Kumiaikata's
 * entities are scoped by team, not by board, so this cannot reuse
 * `loadBoardAccess`'s `ContextBoard` — it is its own tenancy context.
 */
export interface KumiaiVariables extends AppVariables {
	kumiaiTeamId: string;
}

// ── loadTeamAccess ────────────────────────────────────────────────────────────

/**
 * Resolve the authenticated user's team workspace and set it on the context as
 * `kumiaiTeamId`. Must be used after `requireSession`. A user who belongs to no
 * team gets FORBIDDEN — per CLAUDE.md, one domain maps to exactly one team
 * workspace, so a user is never a member of more than one.
 */
export const loadTeamAccess = createMiddleware<{ Variables: KumiaiVariables }>(
	async (c, next) => {
		const user = c.get("user");

		const [row] = await db
			.select({ teamId: teamMembers.teamId })
			.from(teamMembers)
			.where(eq(teamMembers.userId, user.id))
			.limit(1);

		if (!row) {
			throw new AppError("FORBIDDEN", "Not a member of any team workspace.");
		}

		c.set("kumiaiTeamId", row.teamId);
		await next();
	},
);
