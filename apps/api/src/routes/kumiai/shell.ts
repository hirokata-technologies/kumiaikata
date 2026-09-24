import { Hono } from "hono";
import { z } from "zod";
import { requireSession } from "../../auth/middleware.js";
import { loadTeamAccess } from "../../auth/team-access.js";
import type { KumiaiVariables } from "../../auth/team-access.js";
import { zValidator } from "../../http/validate.js";
import { ok, noContent } from "../../http/responders.js";
import { getStats, searchWorkspace, listRecentProjects, touchRecentProject } from "../../services/kumiai/shell.js";

const r = new Hono<{ Variables: KumiaiVariables }>();

r.use("*", requireSession, loadTeamAccess);

// GET /api/kumiai/stats
r.get("/stats", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	return ok(c, await getStats(teamId));
});

// GET /api/kumiai/search?q=
r.get("/search", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const q = c.req.query("q") ?? "";
	return ok(c, await searchWorkspace(teamId, q));
});

// GET /api/kumiai/recent-projects
r.get("/recent-projects", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const user = c.get("user");
	return ok(c, await listRecentProjects(teamId, user.id));
});

// POST /api/kumiai/recent-projects
r.post(
	"/recent-projects",
	zValidator("json", z.object({ projectId: z.string().min(1) })),
	async (c) => {
		const teamId = c.get("kumiaiTeamId");
		const user = c.get("user");
		const { projectId } = c.req.valid("json");
		await touchRecentProject(teamId, user.id, projectId);
		return noContent(c);
	},
);

export default r;
