import { describe, it, expect, beforeEach } from "vitest";
import { mockBetterAuth, setCurrentUser } from "../../test/helpers/mock-session.js";
import { apiRequest } from "../../test/helpers/request.js";
import {
	seedUser,
	seedTeamWithBoard,
} from "../../test/helpers/seed.js";

mockBetterAuth();

// eslint-disable-next-line import/first
import app from "../app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
});

// ── GET /api/teams/mine ───────────────────────────────────────────────────────

describe("GET /api/teams/mine", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("GET", "/api/teams/mine");
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 200 with team info when user has membership", async () => {
		const user = await seedUser();
		const { team } = await seedTeamWithBoard({
			domain: "mine-test.com",
			members: [{ userId: user.id, role: "admin" }],
			teamName: "Mine Test Team",
		});
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/teams/mine");
		expect(res.status).toBe(200);

		const body = await res.json() as {
			id: string;
			domain: string;
			name: string;
			role: string;
		};
		expect(body.id).toBe(team.id);
		expect(body.domain).toBe("mine-test.com");
		expect(body.name).toBe("Mine Test Team");
		expect(body.role).toBe("admin");
	});

	it("returns 404 when user has no team membership", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/teams/mine");
		expect(res.status).toBe(404);
	});
});

// ── GET /api/teams/:teamId/members ────────────────────────────────────────────

describe("GET /api/teams/:teamId/members", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("GET", "/api/teams/fakeid/members");
		expect(res.status).toBe(401);
	});

	it("returns 200 with members array when user is a member", async () => {
		const admin = await seedUser();
		const member = await seedUser();
		const { team } = await seedTeamWithBoard({
			domain: "members-test.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: member.id, role: "member" },
			],
		});
		setCurrentUser({ id: member.id, email: member.email });

		const res = await apiRequest("GET", `/api/teams/${team.id}/members`);
		expect(res.status).toBe(200);

		const body = await res.json() as Array<{
			userId: string;
			email: string;
			name: string | null;
			imageUrl: string | null;
			role: string;
			joinedAt: string;
		}>;
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBe(2);

		const memberEntry = body.find((m) => m.userId === member.id);
		expect(memberEntry?.role).toBe("member");
		expect(memberEntry?.email).toBe(member.email);
		expect("name" in (memberEntry ?? {})).toBe(true);
		expect("imageUrl" in (memberEntry ?? {})).toBe(true);
	});

	it("returns 403 when user is not a member of the team", async () => {
		const admin = await seedUser();
		const outsider = await seedUser();
		const { team } = await seedTeamWithBoard({
			domain: "outsider-test.com",
			members: [{ userId: admin.id, role: "admin" }],
		});
		setCurrentUser({ id: outsider.id, email: outsider.email });

		const res = await apiRequest("GET", `/api/teams/${team.id}/members`);
		expect(res.status).toBe(403);
	});
});

// ── PATCH /api/teams/:teamId/members/:userId ──────────────────────────────────

describe("PATCH /api/teams/:teamId/members/:userId", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest(
			"PATCH",
			"/api/teams/fakeid/members/fakeuserid",
			{ body: { role: "admin" } },
		);
		expect(res.status).toBe(401);
	});

	it("returns 200 when admin promotes a member to admin", async () => {
		const admin = await seedUser();
		const member = await seedUser();
		const { team } = await seedTeamWithBoard({
			domain: "promote-test.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: member.id, role: "member" },
			],
		});
		setCurrentUser({ id: admin.id, email: admin.email });

		const res = await apiRequest(
			"PATCH",
			`/api/teams/${team.id}/members/${member.id}`,
			{ body: { role: "admin" } },
		);
		expect(res.status).toBe(200);

		const body = await res.json() as { userId: string; role: string };
		expect(body.userId).toBe(member.id);
		expect(body.role).toBe("admin");
	});

	it("returns 409 when last admin tries to demote themselves", async () => {
		const admin = await seedUser();
		const { team } = await seedTeamWithBoard({
			domain: "last-admin.com",
			members: [{ userId: admin.id, role: "admin" }],
		});
		setCurrentUser({ id: admin.id, email: admin.email });

		const res = await apiRequest(
			"PATCH",
			`/api/teams/${team.id}/members/${admin.id}`,
			{ body: { role: "member" } },
		);
		expect(res.status).toBe(409);

		const body = await res.json() as { error: { message: string } };
		expect(body.error.message).toBe("At least one admin must remain on the team.");
	});

	it("returns 403 when non-admin tries to change roles", async () => {
		const admin = await seedUser();
		const member = await seedUser();
		const { team } = await seedTeamWithBoard({
			domain: "nonadmin-patch.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: member.id, role: "member" },
			],
		});
		setCurrentUser({ id: member.id, email: member.email });

		const res = await apiRequest(
			"PATCH",
			`/api/teams/${team.id}/members/${admin.id}`,
			{ body: { role: "member" } },
		);
		expect(res.status).toBe(403);
	});
});
