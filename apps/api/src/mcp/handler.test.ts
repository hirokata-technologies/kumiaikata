import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { auth } from "../auth/better-auth.js";
import { seedTeamWithBoard, seedUser } from "../../test/helpers/seed.js";
import { buildAuthInfo, resolveMcpUser } from "./context.js";
import { wellKnownHandler } from "./discovery.js";
import { mcpHandler } from "./handler.js";
import { GUILD_CONTRACT_VERSION, MCP_RESOURCE } from "./resource.js";
import { createKumiaiMcpServer } from "./server.js";

// better-auth is mocked in test/setup-mocks.ts; `auth.handler` is a vi.fn.
const handlerMock = vi.mocked(auth.handler);

const ORIGIN = new URL(MCP_RESOURCE).origin;

function rpc(body: unknown, headers: Record<string, string> = {}): Request {
	return new Request(MCP_RESOURCE, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...headers,
		},
		body: JSON.stringify(body),
	});
}

const initialize = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "test", version: "0.0.0" },
	},
};

// ── POST /mcp authentication ──────────────────────────────────────────────────

describe("mcpHandler", () => {
	it("answers an unauthenticated request with 401 and an RFC 9728 challenge", async () => {
		const res = await mcpHandler(rpc(initialize));

		expect(res.status).toBe(401);
		const challenge = res.headers.get("www-authenticate") ?? "";
		expect(challenge).toMatch(/^Bearer /);
		expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);

		const body = (await res.json()) as { jsonrpc: string; error: { code: number } };
		expect(body.jsonrpc).toBe("2.0");
		expect(body.error.code).toBe(-32000);
	});

	it("rejects a bearer token that is not a valid JWT with 401", async () => {
		const res = await mcpHandler(rpc(initialize, { authorization: "Bearer not-a-jwt" }));

		expect(res.status).toBe(401);
		expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /);
	});
});

// ── Discovery routes ──────────────────────────────────────────────────────────

describe("wellKnownHandler", () => {
	beforeEach(() => {
		handlerMock.mockReset();
		handlerMock.mockImplementation(async () => Response.json({ ok: true }));
	});

	const forwarded = (): string => new URL((handlerMock.mock.calls[0]![0] as Request).url).pathname;

	it.each([
		["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource"],
		["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource/mcp"],
		["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/api/auth"],
		["/.well-known/oauth-authorization-server/api/auth", "/.well-known/oauth-authorization-server/api/auth"],
		["/.well-known/openid-configuration", "/api/auth/.well-known/openid-configuration"],
		["/.well-known/openid-configuration/api/auth", "/api/auth/.well-known/openid-configuration"],
	])("forwards %s to Better Auth as %s", async (path, target) => {
		const res = await wellKnownHandler(new Request(`${ORIGIN}${path}`));

		expect(res.status).toBe(200);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(forwarded()).toBe(target);
	});

	it("answers 404 for other well-known paths without calling Better Auth", async () => {
		const res = await wellKnownHandler(new Request(`${ORIGIN}/.well-known/security.txt`));

		expect(res.status).toBe(404);
		expect(handlerMock).not.toHaveBeenCalled();
	});
});

// ── Protected-resource metadata (real Better Auth instance) ───────────────────

describe("protected-resource metadata", () => {
	it("advertises the MCP resource and this server as its authorization server", async () => {
		const actual = await vi.importActual<typeof import("../auth/better-auth.js")>("../auth/better-auth.js");

		for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
			const res = await actual.auth.handler(new Request(`${ORIGIN}${path}`));
			expect(res.status).toBe(200);

			const metadata = (await res.json()) as Record<string, unknown>;
			expect(metadata).toMatchObject({
				resource: MCP_RESOURCE,
				authorization_servers: [`${ORIGIN}/api/auth`],
				bearer_methods_supported: ["header"],
			});
		}
	});
});

// ── User resolution and whoami ────────────────────────────────────────────────

describe("resolveMcpUser", () => {
	it("resolves the user and their team", async () => {
		const user = await seedUser({ email: "ana@test.com", name: "Ana" });
		const { team } = await seedTeamWithBoard({ domain: "test.com", members: [{ userId: user.id, role: "admin" }] });

		const resolved = await resolveMcpUser(user.id);

		expect(resolved).toEqual({
			user: { id: user.id, email: "ana@test.com", name: "Ana", team: { id: team.id, name: team.name } },
		});
	});

	it("rejects an unknown user, a disallowed domain, and a user with no team", async () => {
		const outsider = await seedUser({ email: "eve@evil.example" });
		const loner = await seedUser({ email: "lone@test.com" });

		expect(await resolveMcpUser("missing")).toEqual({ rejection: "UNKNOWN_USER" });
		expect(await resolveMcpUser(outsider.id)).toEqual({ rejection: "DOMAIN_NOT_ALLOWED" });
		expect(await resolveMcpUser(loner.id)).toEqual({ rejection: "NO_TEAM" });
	});
});

describe("whoami tool", () => {
	it("returns the authenticated user, team and contract version", async () => {
		const user = await seedUser({ email: "ana@test.com", name: "Ana" });
		const { team } = await seedTeamWithBoard({ domain: "test.com", members: [{ userId: user.id, role: "admin" }] });
		const resolved = await resolveMcpUser(user.id);
		if (!("user" in resolved)) throw new Error("expected a user");

		const authInfo = buildAuthInfo({
			token: "t",
			clientId: "c",
			scopes: [],
			expiresAt: undefined,
			resource: MCP_RESOURCE,
			user: resolved.user,
		});
		const server = createMcpHandler(() => createKumiaiMcpServer());
		const res = await server.fetch(
			rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whoami", arguments: {} } }),
			{ authInfo },
		);

		expect(res.status).toBe(200);
		const text = await res.text();
		// The stateless transport may answer as JSON or as a single SSE event.
		const json = text.startsWith("{") ? text : (text.match(/^data: (.*)$/m)?.[1] ?? "");
		const body = JSON.parse(json) as { result: { structuredContent: unknown } };
		expect(body.result.structuredContent).toEqual({
			user: { id: user.id, email: "ana@test.com", name: "Ana" },
			team: { id: team.id, name: team.name },
			contract: GUILD_CONTRACT_VERSION,
		});
	});
});
