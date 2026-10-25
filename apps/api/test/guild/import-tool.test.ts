import { beforeEach, describe, expect, it } from "vitest";
import { sourceToJson } from "../../src/guild/tursodb-import.js";
import { setCurrentUser } from "../helpers/mock-session.js";
import { apiRequest } from "../helpers/request.js";
import { all } from "../helpers/guild.js";
import { buildSource } from "../helpers/guild-source.js";
import { seedKumiaiWorkspace, seedTeamWithBoard, seedUser } from "../helpers/seed.js";

/** The import_guild tool (contract §4.10), over REST like the other guild tools. */

const call = (body: unknown) => apiRequest("POST", "/api/kumiai/guild/import_guild", { body });

let counter = 0;

async function signIn() {
	counter += 1;
	const user = await seedUser({ email: `import-tool-${counter}@test.com` });
	const { team } = await seedTeamWithBoard({
		domain: `import-tool-${counter}.com`,
		members: [{ userId: user.id, role: "member" }],
	});
	setCurrentUser({ id: user.id, email: user.email });
	return { team, workspace: await seedKumiaiWorkspace(team.id) };
}

beforeEach(() => {
	setCurrentUser(null);
});

describe("import_guild", () => {
	it("imports the rows it is given and reports what it wrote", async () => {
		const { workspace } = await signIn();

		const res = await call({ workspace: workspace.id, actor: "user", source: sourceToJson(buildSource()) });

		expect(res.status).toBe(200);
		const body = (await res.json()) as { workspace: string; dry_run: boolean; counts: Record<string, number>; warnings: string[] };
		expect(body).toMatchObject({ workspace: workspace.id, dry_run: false });
		expect(body.counts).toMatchObject({ goal: 1, requirement: 2, task: 3, event: 3 });
		expect(body.warnings.length).toBeGreaterThan(0);

		const keys = await all<{ key: string }>(
			"SELECT key FROM kumiai_tasks WHERE workspace_id = $1 ORDER BY key",
			[workspace.id],
		);
		expect(keys.map((k) => k.key)).toEqual(["TASK-001", "TASK-002", "TASK-003"]);
	});

	it("writes nothing on a dry run", async () => {
		const { workspace } = await signIn();

		const res = await call({ workspace: workspace.id, actor: "user", source: sourceToJson(buildSource()), dry_run: true });

		expect(res.status).toBe(200);
		expect(((await res.json()) as { dry_run: boolean }).dry_run).toBe(true);
		expect(await all("SELECT 1 FROM kumiai_goals WHERE workspace_id = $1", [workspace.id])).toHaveLength(0);
	});

	it("answers CONFLICT for a workspace that already has guild data", async () => {
		const { workspace } = await signIn();
		const input = { workspace: workspace.id, actor: "user", source: sourceToJson(buildSource()) };
		expect((await call(input)).status).toBe(200);

		const again = await call(input);

		expect(again.status).toBe(409);
		expect(((await again.json()) as { code: string }).code).toBe("CONFLICT");
	});

	it("answers FORBIDDEN for another team's workspace", async () => {
		await signIn();
		const { team: other } = await seedTeamWithBoard({ domain: "import-tool-other.com", members: [] });
		const foreign = await seedKumiaiWorkspace(other.id);

		const res = await call({ workspace: foreign.id, actor: "user", source: sourceToJson(buildSource()) });

		expect(res.status).toBe(403);
		expect(await all("SELECT 1 FROM kumiai_goals WHERE workspace_id = $1", [foreign.id])).toHaveLength(0);
	});

	it("answers VALIDATION for a wrong schema version, an unknown table and a row pointing at nothing", async () => {
		const { workspace } = await signIn();
		const source = sourceToJson(buildSource());

		const version = await call({ workspace: workspace.id, actor: "user", source: { ...source, schema_version: 8 } });
		expect(version.status).toBe(400);

		const table = await call({ workspace: workspace.id, actor: "user", source: { ...source, nonsense: [] } });
		expect(table.status).toBe(400);

		const dangling = await call({
			workspace: workspace.id,
			actor: "user",
			source: { ...source, task_dependency: [{ task_id: "TASK-002", depends_on: "TASK-404" }] },
		});
		expect(dangling.status).toBe(400);
		expect(((await dangling.json()) as { message: string }).message).toMatch(/TASK-404/);
		expect(await all("SELECT 1 FROM kumiai_goals WHERE workspace_id = $1", [workspace.id])).toHaveLength(0);
	});
});
