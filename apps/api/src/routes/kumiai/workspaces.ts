import { Hono } from "hono";
import { z } from "zod";
import { requireSession } from "../../auth/middleware.js";
import { loadTeamAccess } from "../../auth/team-access.js";
import type { KumiaiVariables } from "../../auth/team-access.js";
import { zValidator } from "../../http/validate.js";
import { ok, created } from "../../http/responders.js";
import { listWorkspaces, createWorkspace } from "../../services/kumiai/workspaces.js";

const createSchema = z.object({
	name: z.string().trim().min(1).max(60),
});

const r = new Hono<{ Variables: KumiaiVariables }>();

r.use("*", requireSession, loadTeamAccess);

// GET /api/kumiai/workspaces — the team's workspaces, default first
r.get("/", async (c) => {
	const teamId = c.get("kumiaiTeamId");
	return ok(c, await listWorkspaces(teamId));
});

// POST /api/kumiai/workspaces
r.post("/", zValidator("json", createSchema), async (c) => {
	const teamId = c.get("kumiaiTeamId");
	const { name } = c.req.valid("json");
	return created(c, await createWorkspace(teamId, name));
});

export default r;
