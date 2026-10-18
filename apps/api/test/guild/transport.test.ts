import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { auth } from "../../src/auth/better-auth.js";
import { guildTools } from "../../src/guild/tools/index.js";
import { GUILD_CONTRACT_VERSION, MCP_RESOURCE } from "../../src/mcp/resource.js";
import { setCurrentUser } from "../helpers/mock-session.js";
import { apiRequest, apiRequestRaw } from "../helpers/request.js";
import { seedKumiaiWorkspace, seedTeamWithBoard, seedUser } from "../helpers/seed.js";

/** POST /api/kumiai/guild/:tool and GET /api/kumiai/guild (contract §1 REST/RPC). */

const call = (tool: string, body?: unknown, headers?: Record<string, string>) =>
	apiRequest("POST", `/api/kumiai/guild/${tool}`, { body, ...(headers && { headers }) });

let memberCounter = 0;

async function seedMember(domain: string) {
	memberCounter += 1;
	const user = await seedUser({ email: `rest-${memberCounter}@test.com`, name: `Rest ${memberCounter}` });
	const { team } = await seedTeamWithBoard({ domain, members: [{ userId: user.id, role: "member" }] });
	return { user, team };
}

async function signIn(domain: string) {
	const member = await seedMember(domain);
	setCurrentUser({ id: member.user.id, email: member.user.email });
	return member;
}

beforeEach(() => {
	setCurrentUser(null);
});

// ── Session path ──────────────────────────────────────────────────────────────

describe("guild REST with a session", () => {
	it("requires authentication", async () => {
		const res = await call("whoami");
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Sign-in required." });
		expect((await apiRequest("GET", "/api/kumiai/guild")).status).toBe(401);
	});

	it("answers FORBIDDEN for a signed-in user with no team", async () => {
		const loner = await seedUser({ email: "rest-loner@test.com" });
		setCurrentUser({ id: loner.id, email: loner.email });

		const res = await call("whoami");

		expect(res.status).toBe(403);
		expect(((await res.json()) as { code: string }).code).toBe("FORBIDDEN");
	});

	it("calls whoami and returns the JSON result", async () => {
		const { user, team } = await signIn("rest-whoami.com");

		const res = await call("whoami");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			user: { id: user.id, email: user.email, name: user.name },
			team: { id: team.id, name: team.name },
			contract: GUILD_CONTRACT_VERSION,
		});
	});

	it("lists and creates workspaces (default first; duplicate name → 409)", async () => {
		await signIn("rest-ws.com");

		const created = await call("create_workspace", { name: "  guild  " });
		expect(created.status).toBe(200);
		const ws = (await created.json()) as { id: string; name: string; isDefault: boolean; createdAt: string };
		expect(ws).toMatchObject({ name: "guild", isDefault: false });
		expect(ws.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);

		const listed = (await (await call("list_workspaces", {})).json()) as { workspaces: Array<{ name: string }> };
		expect(listed.workspaces.map((w) => w.name)).toEqual(["default", "guild"]);

		const dup = await call("create_workspace", { name: "guild" });
		expect(dup.status).toBe(409);
		expect(((await dup.json()) as { code: string }).code).toBe("CONFLICT");
	});

	it("reads and upserts guild_state; the 'actor' key is ignored", async () => {
		const { team } = await signIn("rest-state.com");
		const ws = await seedKumiaiWorkspace(team.id);

		const seeded = (await (await call("get_state", { workspace: ws.id })).json()) as {
			rows: Array<{ key: string; value: string }>;
		};
		expect(seeded.rows.map((r) => r.key)).toEqual(["actor", "last-checkin"]);

		const set = await call("set_state", { workspace: ws.id, actor: "orchestrator", key: "last-checkin", value: "2026-10-18T09:00:00Z" });
		expect(set.status).toBe(200);
		expect(await set.json()).toEqual({ key: "last-checkin", value: "2026-10-18T09:00:00Z" });

		const again = await call("set_state", { workspace: ws.id, actor: "orchestrator", key: "last-checkin", value: "later" });
		expect(await again.json()).toEqual({ key: "last-checkin", value: "later" });

		const added = await call("set_state", { workspace: ws.id, actor: "user", key: "note", value: "hi" });
		expect(await added.json()).toEqual({ key: "note", value: "hi" });

		const actor = await call("set_state", { workspace: ws.id, actor: "strategist", key: "actor", value: "evil" });
		expect(actor.status).toBe(200);
		expect(await actor.json()).toEqual({ key: "actor", value: "strategist", ignored: true });

		const one = (await (await call("get_state", { workspace: ws.id, key: "actor" })).json()) as {
			rows: Array<{ key: string; value: string }>;
		};
		expect(one.rows).toHaveLength(1);
		expect(one.rows[0]?.value).not.toBe("evil");
	});

	it("answers 404 for an unknown tool", async () => {
		await signIn("rest-unknown.com");

		const res = await call("drop_database", {});

		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ code: "NOT_FOUND", message: "Unknown guild tool: drop_database" });
	});

	it("answers 400 VALIDATION with zod issues for bad input, and for a body that is not JSON", async () => {
		await signIn("rest-bad.com");

		const res = await call("create_workspace", { name: "" });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code: string; issues: Array<{ path: string[] }> };
		expect(body.code).toBe("VALIDATION");
		expect(body.issues[0]?.path).toEqual(["name"]);

		const missing = await call("get_state", {});
		expect(missing.status).toBe(400);

		const notJson = await apiRequestRaw(
			new Request("http://localhost/api/kumiai/guild/whoami", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{nope",
			}),
		);
		expect(notJson.status).toBe(400);
		expect(((await notJson.json()) as { code: string }).code).toBe("VALIDATION");
	});

	it("refuses an unknown argument instead of dropping it (a misspelled guard is not an overwrite)", async () => {
		const { team } = await signIn("rest-strict.com");
		const ws = await seedKumiaiWorkspace(team.id);

		const res = await call("set_state", {
			workspace: ws.id,
			actor: "orchestrator",
			key: "last-checkin",
			value: "2026-10-18T09:00:00Z",
			expected_status: "todo",
		});

		expect(res.status).toBe(400);
		const body = (await res.json()) as { code: string; issues: Array<{ code: string; keys?: string[] }> };
		expect(body.code).toBe("VALIDATION");
		expect(body.issues[0]).toMatchObject({ code: "unrecognized_keys", keys: ["expected_status"] });
		const state = (await (await call("get_state", { workspace: ws.id, key: "last-checkin" })).json()) as {
			rows: Array<{ value: string }>;
		};
		expect(state.rows[0]?.value).toBe("null"); // nothing was written
	});

	it("answers 403 FORBIDDEN for another team's workspace", async () => {
		await signIn("rest-mine.com");
		const other = await seedMember("rest-theirs.com");
		const theirs = await seedKumiaiWorkspace(other.team.id);

		for (const res of [
			await call("get_state", { workspace: theirs.id }),
			await call("set_state", { workspace: theirs.id, actor: "user", key: "k", value: "v" }),
		]) {
			expect(res.status).toBe(403);
			expect(await res.json()).toEqual({ code: "FORBIDDEN", message: "Workspace not found in your team." });
		}
	});

	it("serves the tool catalog with JSON schemas", async () => {
		await signIn("rest-catalog.com");

		const res = await apiRequest("GET", "/api/kumiai/guild");

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			contract: string;
			tools: Array<{ name: string; title: string; readOnly: boolean; inputSchema: { type: string; properties: object } }>;
		};
		expect(body.contract).toBe(GUILD_CONTRACT_VERSION);
		expect(body.tools.map((t) => t.name)).toEqual(guildTools.map((t) => t.name));
		const setState = body.tools.find((t) => t.name === "set_state");
		expect(setState?.readOnly).toBe(false);
		expect(Object.keys(setState?.inputSchema.properties ?? {})).toEqual(["workspace", "actor", "key", "value"]);
		expect(setState?.inputSchema).toMatchObject({ additionalProperties: false });
		expect(body.tools.find((t) => t.name === "whoami")?.readOnly).toBe(true);
		// Board tools are MCP-only.
		expect(body.tools.some((t) => t.name === "get_board")).toBe(false);
	});
});

// ── Bearer path ───────────────────────────────────────────────────────────────

/**
 * A real EdDSA access token, verified by the same `requireMcpAuth` as POST /mcp. The
 * authorization server's JWKS endpoint is answered by a stubbed `fetch`.
 */
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const KID = "guild-transport-test";
let issuer = "";
let jwksUrl = "";

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function accessToken(claims: Record<string, unknown>): string {
	const now = Math.floor(Date.now() / 1000);
	const header = b64url({ alg: "EdDSA", typ: "JWT", kid: KID });
	const payload = b64url({ iss: issuer, aud: MCP_RESOURCE, iat: now, exp: now + 300, scope: "openid", azp: "client", ...claims });
	const signature = sign(null, Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
	return `${header}.${payload}.${signature}`;
}

describe("guild REST with an OAuth bearer token", () => {
	beforeAll(async () => {
		issuer = (await auth.$context).baseURL;
		jwksUrl = `${issuer}/jwks`;
	});

	beforeEach(() => {
		const realFetch = globalThis.fetch;
		const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "EdDSA", use: "sig" };
		vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url === jwksUrl) return Promise.resolve(Response.json({ keys: [jwk] }));
			return realFetch(input, init);
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("authenticates with a valid token and no session", async () => {
		const { user, team } = await seedMember("rest-bearer.com");

		const res = await call("whoami", undefined, { authorization: `Bearer ${accessToken({ sub: user.id })}` });

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ user: { id: user.id }, team: { id: team.id } });

		const ws = await seedKumiaiWorkspace(team.id);
		const state = await call("get_state", { workspace: ws.id }, { authorization: `Bearer ${accessToken({ sub: user.id })}` });
		expect(state.status).toBe(200);
	});

	it("rejects an invalid or wrong-audience token with 401 and a WWW-Authenticate challenge", async () => {
		const { user } = await seedMember("rest-bearer-bad.com");

		for (const token of ["not-a-jwt", accessToken({ sub: user.id, aud: "https://elsewhere.example/mcp" })]) {
			const res = await call("whoami", undefined, { authorization: `Bearer ${token}` });
			expect(res.status).toBe(401);
			expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /);
			expect(((await res.json()) as { code: string }).code).toBe("UNAUTHENTICATED");
		}
	});

	it("answers 403 when the token's user has no team or a disallowed domain", async () => {
		const loner = await seedUser({ email: "rest-bearer-loner@test.com" });
		const outsider = await seedUser({ email: "eve@evil.example" });

		const noTeam = await call("whoami", undefined, { authorization: `Bearer ${accessToken({ sub: loner.id })}` });
		expect(noTeam.status).toBe(403);
		expect(await noTeam.json()).toEqual({ code: "FORBIDDEN", message: "Not a member of any team workspace." });

		const evil = await call("whoami", undefined, { authorization: `Bearer ${accessToken({ sub: outsider.id })}` });
		expect(evil.status).toBe(403);
	});

	it("does not fall back to the session when a bad token is sent", async () => {
		await signIn("rest-bearer-session.com");

		const res = await call("whoami", undefined, { authorization: "Bearer not-a-jwt" });

		expect(res.status).toBe(401);
	});
});
