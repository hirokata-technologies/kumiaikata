import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockBetterAuth, setCurrentUser } from "../../test/helpers/mock-session.js";
import { apiRequest } from "../../test/helpers/request.js";
import {
	seedUser,
	seedTeamWithBoard,
	seedKumiaiGoal,
	seedKumiaiProject,
	seedKumiaiWorkspace,
} from "../../test/helpers/seed.js";

mockBetterAuth();

// Real client, fake network: only getAgentsClient() is replaced so each test can pick
// the upstream `fetch` (and "not configured").
vi.mock("../agents/client.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../agents/client.js")>()),
	getAgentsClient: vi.fn(),
}));

import app from "../app.js";
import { createAgentsClient, getAgentsClient } from "../agents/client.js";

void app;

const RUNTIME = "projects/p/locations/asia-southeast1/reasoningEngines/1";

interface UpstreamCall {
	url: string;
	classMethod: string;
	input: Record<string, unknown>;
}

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const failedPrecondition = () =>
	jsonResponse({ error: { code: 400, message: "internal detail", status: "FAILED_PRECONDITION" } }, 400);

/**
 * In-memory stand-in for Agent Runtime that, like the real thing, scopes sessions to
 * the ADK `user_id` it is called with.
 */
function fakeAgentRuntime(options?: { streamLines?: string[] | (() => Response) }) {
	const sessions = new Map<string, string>(); // session id -> owning user_id
	const calls: UpstreamCall[] = [];
	let counter = 0;

	const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body)) as {
			class_method: string;
			input: Record<string, unknown>;
		};
		const input = body.input;
		calls.push({ url: String(url), classMethod: body.class_method, input });
		const userId = input["user_id"] as string;
		const sessionId = input["session_id"] as string | undefined;
		const owned = sessionId !== undefined && sessions.get(sessionId) === userId;

		switch (body.class_method) {
			case "async_create_session": {
				const id = String(++counter);
				sessions.set(id, userId);
				return jsonResponse({ output: { id, user_id: userId, last_update_time: 100 + counter, events: [] } });
			}
			case "async_list_sessions":
				return jsonResponse({
					output: {
						sessions: [...sessions.entries()]
							.filter(([, owner]) => owner === userId)
							.map(([id]) => ({ id, userId, lastUpdateTime: 100 + Number(id), events: [] })),
					},
				});
			case "async_get_session":
				if (!owned) return failedPrecondition();
				return jsonResponse({
					output: {
						id: sessionId,
						userId,
						lastUpdateTime: 200,
						events: [
							{ id: "h1", author: "user", timestamp: 1, content: { parts: [{ text: "hello" }] } },
							{ id: "h2", author: "project_manager", timestamp: 2, content: { parts: [{ text: "hi there" }] } },
						],
					},
				});
			case "async_delete_session":
				if (sessionId && sessions.has(sessionId) && !owned) return failedPrecondition();
				if (sessionId) sessions.delete(sessionId);
				return jsonResponse({ output: null });
			case "async_stream_query": {
				const stream = options?.streamLines;
				if (typeof stream === "function") return stream();
				const lines = stream ?? [];
				return new Response(lines.map((l) => `${l}\n`).join(""), { status: 200 });
			}
			default:
				return jsonResponse({ error: { code: 400, status: "INVALID_ARGUMENT" } }, 400);
		}
	});

	const client = createAgentsClient({
		runtimeName: RUNTIME,
		getAccessToken: async () => "tok",
		fetch: fetchMock as unknown as typeof fetch,
	});
	return { client, fetchMock, calls, sessions };
}

function useRuntime(runtime: ReturnType<typeof fakeAgentRuntime> | null) {
	vi.mocked(getAgentsClient).mockReturnValue(runtime ? runtime.client : null);
}

async function signedInTeamMember(domain = "agents-test.com") {
	const user = await seedUser();
	const { team } = await seedTeamWithBoard({
		domain,
		members: [{ userId: user.id, role: "member" }],
	});
	setCurrentUser({ id: user.id, email: user.email });
	return { user, team };
}

/** Parse a text/event-stream body into [event, data] pairs. */
function parseSse(text: string): Array<{ event: string; data: unknown }> {
	return text
		.split("\n\n")
		.map((block) => block.trim())
		.filter(Boolean)
		.map((block) => {
			const event = /^event: (.*)$/m.exec(block)?.[1] ?? "message";
			const data = /^data: (.*)$/m.exec(block)?.[1] ?? "";
			return { event, data: data ? JSON.parse(data) : null };
		})
		.filter((e) => e.event !== "ping");
}

const adkEvent = (event: Record<string, unknown>) => JSON.stringify(event);

beforeEach(() => {
	setCurrentUser(null);
	vi.mocked(getAgentsClient).mockReset();
});

// ── authentication and configuration ─────────────────────────────────────────

describe("/api/agents access", () => {
	const routes: Array<[string, string]> = [
		["POST", "/api/agents/sessions"],
		["GET", "/api/agents/sessions"],
		["GET", "/api/agents/sessions/1"],
		["DELETE", "/api/agents/sessions/1"],
		["POST", "/api/agents/sessions/1/messages"],
	];

	it.each(routes)("%s %s returns 401 without a session", async (method, path) => {
		useRuntime(fakeAgentRuntime());
		const res = await apiRequest(method, path, method === "POST" ? { body: { message: "hi" } } : undefined);
		expect(res.status).toBe(401);
	});

	it.each(routes)("%s %s returns 503 when agents are not configured", async (method, path) => {
		await signedInTeamMember();
		useRuntime(null);
		const res = await apiRequest(method, path, method === "POST" ? { body: { message: "hi" } } : undefined);
		expect(res.status).toBe(503);
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
		expect(body.error.message).toBe("agents not configured");
	});
});

// ── workspace resolution and user_id scoping ─────────────────────────────────

describe("workspace scoping", () => {
	it("derives the ADK user_id as <teamId>:<userId> by default", async () => {
		const { user, team } = await signedInTeamMember();
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);

		const res = await apiRequest("POST", "/api/agents/sessions");
		expect(res.status).toBe(201);
		const body = (await res.json()) as { id: string; workspaceId: string; lastUpdateTime: string };
		expect(body.workspaceId).toBe(team.id);
		expect(body.lastUpdateTime).toBe(new Date(101_000).toISOString());
		expect(runtime.calls[0]).toMatchObject({
			classMethod: "async_create_session",
			input: { user_id: `${team.id}:${user.id}` },
		});
	});

	it("uses the personal workspace when asked, and by default for a user with no team", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);

		const res = await apiRequest("POST", "/api/agents/sessions");
		expect(((await res.json()) as { workspaceId: string }).workspaceId).toBe("personal");
		expect(runtime.calls[0]?.input["user_id"]).toBe(`personal:${user.id}`);

		await signedInTeamMember("personal-explicit.com");
		const explicit = await apiRequest("POST", "/api/agents/sessions?workspaceId=personal");
		expect(((await explicit.json()) as { workspaceId: string }).workspaceId).toBe("personal");
	});

	it("rejects a workspace the user is not a member of with 403 and never calls upstream", async () => {
		await signedInTeamMember("mine.com");
		const other = await seedUser();
		const { team: otherTeam } = await seedTeamWithBoard({
			domain: "not-mine.com",
			members: [{ userId: other.id, role: "admin" }],
		});
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);

		const res = await apiRequest("POST", `/api/agents/sessions?workspaceId=${otherTeam.id}`);
		expect(res.status).toBe(403);
		expect(runtime.fetchMock).not.toHaveBeenCalled();
	});

	it("rejects an unknown workspace id with 403", async () => {
		await signedInTeamMember();
		useRuntime(fakeAgentRuntime());
		const res = await apiRequest("GET", "/api/agents/sessions?workspaceId=does-not-exist");
		expect(res.status).toBe(403);
	});

	it("ignores any user_id the client sends", async () => {
		const { user, team } = await signedInTeamMember();
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);

		await apiRequest("POST", "/api/agents/sessions?user_id=victim&userId=victim", {
			body: { user_id: "victim", userId: "victim" },
		});
		expect(runtime.calls[0]?.input["user_id"]).toBe(`${team.id}:${user.id}`);
	});

	it("rejects an over-long workspaceId with 422", async () => {
		await signedInTeamMember();
		useRuntime(fakeAgentRuntime());
		const res = await apiRequest("GET", `/api/agents/sessions?workspaceId=${"x".repeat(200)}`);
		expect(res.status).toBe(422);
	});

	it("never exposes another user's sessions, even in the same workspace", async () => {
		const alice = await seedUser();
		const bob = await seedUser();
		const { team } = await seedTeamWithBoard({
			domain: "shared.com",
			members: [
				{ userId: alice.id, role: "admin" },
				{ userId: bob.id, role: "member" },
			],
		});
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);

		setCurrentUser({ id: alice.id, email: alice.email });
		const created = (await (await apiRequest("POST", "/api/agents/sessions")).json()) as { id: string };

		setCurrentUser({ id: bob.id, email: bob.email });
		const list = (await (await apiRequest("GET", "/api/agents/sessions")).json()) as unknown[];
		expect(list).toEqual([]);
		expect((await apiRequest("GET", `/api/agents/sessions/${created.id}`)).status).toBe(404);
		expect((await apiRequest("DELETE", `/api/agents/sessions/${created.id}`)).status).toBe(404);
		const stream = await apiRequest("POST", `/api/agents/sessions/${created.id}/messages`, {
			body: { message: "let me in" },
		});
		expect(stream.status).toBe(404);

		// Alice's session survived Bob's delete attempt and nothing was streamed.
		expect(runtime.sessions.get(created.id)).toBe(`${team.id}:${alice.id}`);
		expect(runtime.calls.some((c) => c.classMethod === "async_stream_query")).toBe(false);
	});

	it("keeps one user's sessions in different workspaces apart", async () => {
		const { user, team } = await signedInTeamMember("two-ws.com");
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);

		const teamSession = (await (await apiRequest("POST", "/api/agents/sessions")).json()) as { id: string };
		await apiRequest("POST", "/api/agents/sessions?workspaceId=personal");

		const teamList = (await (await apiRequest("GET", "/api/agents/sessions")).json()) as Array<{ id: string }>;
		expect(teamList.map((s) => s.id)).toEqual([teamSession.id]);
		expect(runtime.sessions.get(teamSession.id)).toBe(`${team.id}:${user.id}`);
		const res = await apiRequest("GET", `/api/agents/sessions/${teamSession.id}?workspaceId=personal`);
		expect(res.status).toBe(404);
	});
});

// ── session CRUD ─────────────────────────────────────────────────────────────

describe("session endpoints", () => {
	it("lists the caller's sessions, newest first", async () => {
		await signedInTeamMember();
		useRuntime(fakeAgentRuntime());
		const first = (await (await apiRequest("POST", "/api/agents/sessions")).json()) as { id: string };
		const second = (await (await apiRequest("POST", "/api/agents/sessions")).json()) as { id: string };

		const res = await apiRequest("GET", "/api/agents/sessions");
		expect(res.status).toBe(200);
		const list = (await res.json()) as Array<{ id: string; workspaceId: string }>;
		expect(list.map((s) => s.id)).toEqual([second.id, first.id]);
		expect(list[0]).not.toHaveProperty("events");
	});

	it("returns a session with its normalised history", async () => {
		const { team } = await signedInTeamMember();
		useRuntime(fakeAgentRuntime());
		const created = (await (await apiRequest("POST", "/api/agents/sessions")).json()) as { id: string };

		const res = await apiRequest("GET", `/api/agents/sessions/${created.id}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			id: string;
			workspaceId: string;
			events: Array<{ author: string; text: string }>;
		};
		expect(body.id).toBe(created.id);
		expect(body.workspaceId).toBe(team.id);
		expect(body.events.map((e) => [e.author, e.text])).toEqual([
			["user", "hello"],
			["project_manager", "hi there"],
		]);
		expect(JSON.stringify(body)).not.toContain("user_id");
	});

	it("returns 404 for an unknown session", async () => {
		await signedInTeamMember();
		useRuntime(fakeAgentRuntime());
		expect((await apiRequest("GET", "/api/agents/sessions/999")).status).toBe(404);
	});

	it("deletes an owned session with 204", async () => {
		await signedInTeamMember();
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);
		const created = (await (await apiRequest("POST", "/api/agents/sessions")).json()) as { id: string };

		const res = await apiRequest("DELETE", `/api/agents/sessions/${created.id}`);
		expect(res.status).toBe(204);
		expect(runtime.sessions.has(created.id)).toBe(false);
	});

	it("rejects a malformed session id with 422 before calling upstream", async () => {
		await signedInTeamMember();
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);
		const res = await apiRequest("GET", "/api/agents/sessions/bad%20id%3Bdrop");
		expect(res.status).toBe(422);
		expect(runtime.fetchMock).not.toHaveBeenCalled();
	});

	it("maps an upstream failure to 502 without leaking its message", async () => {
		await signedInTeamMember();
		const fetchMock = vi.fn(async () => jsonResponse({ error: { code: 500, message: "secret internals", status: "INTERNAL" } }, 500));
		vi.mocked(getAgentsClient).mockReturnValue(
			createAgentsClient({ runtimeName: RUNTIME, getAccessToken: async () => "t", fetch: fetchMock as unknown as typeof fetch }),
		);
		vi.spyOn(console, "error").mockImplementation(() => {});

		const res = await apiRequest("POST", "/api/agents/sessions");
		expect(res.status).toBe(502);
		const text = await res.text();
		expect(text).toContain("BAD_GATEWAY");
		expect(text).not.toContain("secret internals");
	});

	it("maps upstream quota errors to 503", async () => {
		await signedInTeamMember();
		const fetchMock = vi.fn(async () => jsonResponse({ error: { code: 429, status: "RESOURCE_EXHAUSTED" } }, 429));
		vi.mocked(getAgentsClient).mockReturnValue(
			createAgentsClient({ runtimeName: RUNTIME, getAccessToken: async () => "t", fetch: fetchMock as unknown as typeof fetch }),
		);
		vi.spyOn(console, "error").mockImplementation(() => {});

		expect((await apiRequest("GET", "/api/agents/sessions")).status).toBe(503);
	});

	it("maps a credentials failure to 502", async () => {
		await signedInTeamMember();
		vi.mocked(getAgentsClient).mockReturnValue(
			createAgentsClient({
				runtimeName: RUNTIME,
				getAccessToken: async () => {
					throw new Error("Could not load the default credentials");
				},
				fetch: vi.fn() as unknown as typeof fetch,
			}),
		);
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect((await apiRequest("POST", "/api/agents/sessions")).status).toBe(502);
	});
});

// ── streaming messages ───────────────────────────────────────────────────────

describe("POST /api/agents/sessions/:sessionId/messages", () => {
	async function openSession(runtime: ReturnType<typeof fakeAgentRuntime>) {
		useRuntime(runtime);
		const res = await apiRequest("POST", "/api/agents/sessions");
		return ((await res.json()) as { id: string }).id;
	}

	it("streams ADK events as SSE with hand-off markers and a done event", async () => {
		const { user, team } = await signedInTeamMember();
		const runtime = fakeAgentRuntime({
			streamLines: [
				adkEvent({
					id: "e1",
					author: "project_manager",
					timestamp: 1,
					content: { parts: [{ text: "Let me ask the strategist." }, { function_call: { id: "c1", name: "strategist", args: { request: "plan" } } }] },
				}),
				adkEvent({
					id: "e2",
					author: "strategist",
					timestamp: 2,
					content: { parts: [{ function_call: { id: "c2", name: "finish_task", args: { result: "done" } } }] },
				}),
				adkEvent({
					id: "e3",
					author: "user",
					content: { parts: [{ function_response: { id: "c1", name: "strategist", response: { result: "long" } } }] },
				}),
				adkEvent({ id: "e4", author: "project_manager", timestamp: 4, content: { parts: [{ text: "Recommendation ready." }, { text: "secret", thought: true }] } }),
			],
		});
		const sessionId = await openSession(runtime);

		const res = await apiRequest("POST", `/api/agents/sessions/${sessionId}/messages`, {
			body: { message: "  What should we build?  " },
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/event-stream");

		const events = parseSse(await res.text());
		expect(events.map((e) => e.event)).toEqual([
			"message", // PM text
			"tool_call", // PM -> strategist call
			"handoff", // PM -> strategist
			"tool_call", // strategist finish_task
			"tool_result", // strategist answer fed back
			"handoff", // strategist -> PM
			"message", // PM final
			"done",
		]);
		expect(events[0]?.data).toMatchObject({ id: "e1", author: "project_manager", text: "Let me ask the strategist." });
		expect(events[1]?.data).toMatchObject({ author: "project_manager", name: "strategist", id: "c1", args: { request: "plan" } });
		expect(events[2]?.data).toEqual({ from: "project_manager", to: "strategist" });
		expect(events[4]?.data).toEqual({ eventId: "e3", author: "user", id: "c1", name: "strategist" });
		expect(events[5]?.data).toEqual({ from: "strategist", to: "project_manager" });
		expect(events[6]?.data).toMatchObject({ text: "Recommendation ready." });
		expect(events[7]?.data).toEqual({ sessionId, events: 4 });
		expect(JSON.stringify(events)).not.toContain("secret");
		expect(JSON.stringify(events)).not.toContain("long");

		const streamCall = runtime.calls.find((c) => c.classMethod === "async_stream_query");
		expect(streamCall?.url).toContain(":streamQuery?alt=sse");
		expect(streamCall?.input).toEqual({
			user_id: `${team.id}:${user.id}`,
			session_id: sessionId,
			message: "What should we build?",
		});
	});

	it("emits an explicit handoff when ADK reports transfer_to_agent", async () => {
		await signedInTeamMember();
		const runtime = fakeAgentRuntime({
			streamLines: [
				adkEvent({ id: "t1", author: "project_manager", actions: { transfer_to_agent: "strategist" } }),
				adkEvent({ id: "t2", author: "strategist", content: { parts: [{ text: "On it." }] } }),
			],
		});
		const sessionId = await openSession(runtime);
		const res = await apiRequest("POST", `/api/agents/sessions/${sessionId}/messages`, { body: { message: "go" } });
		const events = parseSse(await res.text());
		expect(events.map((e) => e.event)).toEqual(["handoff", "message", "done"]);
		expect(events[0]?.data).toEqual({ from: "project_manager", to: "strategist" });
	});

	it("sends done with zero events when the agent says nothing", async () => {
		await signedInTeamMember();
		const sessionId = await openSession(fakeAgentRuntime({ streamLines: [] }));
		const res = await apiRequest("POST", `/api/agents/sessions/${sessionId}/messages`, { body: { message: "hi" } });
		expect(parseSse(await res.text())).toEqual([{ event: "done", data: { sessionId, events: 0 } }]);
	});

	it("sends an error event (and no done) when the upstream stream fails", async () => {
		await signedInTeamMember();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const runtime = fakeAgentRuntime({
			streamLines: () => jsonResponse({ error: { code: 500, message: "internal secret", status: "INTERNAL" } }, 500),
		});
		const sessionId = await openSession(runtime);

		const res = await apiRequest("POST", `/api/agents/sessions/${sessionId}/messages`, { body: { message: "hi" } });
		expect(res.status).toBe(200);
		const text = await res.text();
		const events = parseSse(text);
		expect(events.map((e) => e.event)).toEqual(["error"]);
		expect(events[0]?.data).toEqual({ code: "BAD_GATEWAY", message: "The agents service failed to respond." });
		expect(text).not.toContain("internal secret");
	});

	it("sends an error event when an event carries an ADK error", async () => {
		await signedInTeamMember();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const sessionId = await openSession(
			fakeAgentRuntime({
				streamLines: [adkEvent({ id: "x", author: "project_manager", error_code: "SAFETY", error_message: "blocked by policy" })],
			}),
		);
		const res = await apiRequest("POST", `/api/agents/sessions/${sessionId}/messages`, { body: { message: "hi" } });
		const events = parseSse(await res.text());
		expect(events).toEqual([{ event: "error", data: { code: "AGENT_ERROR", message: "The agent could not complete the reply." } }]);
	});

	it("cancels the upstream request when the client aborts", async () => {
		await signedInTeamMember();
		let upstreamSignal: AbortSignal | undefined;
		let upstreamCancelled = false;
		const runtime = fakeAgentRuntime({
			streamLines: () => {
				const encoder = new TextEncoder();
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(encoder.encode(`${adkEvent({ id: "a", author: "project_manager", content: { parts: [{ text: "partial" }] } })}\n`));
							// ...and then never finish, like a long-running agent turn.
						},
						cancel() {
							upstreamCancelled = true;
						},
					}),
					{ status: 200 },
				);
			},
		});
		const sessionId = await openSession(runtime);
		const originalImpl = runtime.fetchMock.getMockImplementation()!;
		runtime.fetchMock.mockImplementation(async (url, init) => {
			if (String(url).includes(":streamQuery")) upstreamSignal = init?.signal ?? undefined;
			return originalImpl(url, init);
		});

		const controller = new AbortController();
		const res = await app.request(
			new Request(`http://localhost/api/agents/sessions/${sessionId}/messages`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ message: "hi" }),
				signal: controller.signal,
			}),
		);
		const reader = res.body!.getReader();
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toContain("event: message");

		controller.abort();
		await reader.cancel().catch(() => {});

		await vi.waitFor(() => {
			expect(upstreamSignal?.aborted).toBe(true);
			expect(upstreamCancelled).toBe(true);
		});
	});

	it("validates the body: missing, blank and over-long messages return 422", async () => {
		await signedInTeamMember();
		const sessionId = await openSession(fakeAgentRuntime());
		const path = `/api/agents/sessions/${sessionId}/messages`;

		expect((await apiRequest("POST", path, { body: {} })).status).toBe(422);
		expect((await apiRequest("POST", path, { body: { message: "   " } })).status).toBe(422);
		expect((await apiRequest("POST", path, { body: { message: 42 } })).status).toBe(422);
		expect((await apiRequest("POST", path, { body: { message: "x".repeat(8001) } })).status).toBe(422);
	});

	it("accepts a message of exactly the maximum length", async () => {
		await signedInTeamMember();
		const sessionId = await openSession(fakeAgentRuntime({ streamLines: [] }));
		const res = await apiRequest("POST", `/api/agents/sessions/${sessionId}/messages`, {
			body: { message: "x".repeat(8000) },
		});
		expect(res.status).toBe(200);
		await res.text();
	});

	it("returns 404 (not a stream) for a session that is not the caller's", async () => {
		await signedInTeamMember();
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);
		const res = await apiRequest("POST", "/api/agents/sessions/12345/messages", { body: { message: "hi" } });
		expect(res.status).toBe(404);
	});
});

// ── roadmap planning sessions ────────────────────────────────────────────────

describe("roadmap planning sessions", () => {
	const planningContext = (runtime: ReturnType<typeof fakeAgentRuntime>) =>
		(runtime.calls[0]?.input["state"] as Record<string, string> | undefined)?.["planning_context"];

	it("creates a plain session without state when there is no body", async () => {
		await signedInTeamMember("planning-plain.com");
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);

		const res = await apiRequest("POST", "/api/agents/sessions");
		expect(res.status).toBe(201);
		expect(runtime.calls[0]?.input).not.toHaveProperty("state");
	});

	it("seeds a new-goal session with the workspace's goals and projects", async () => {
		const { team } = await signedInTeamMember("planning-goal.com");
		const goal = await seedKumiaiGoal(team.id, { title: "Faster onboarding", priority: 2 });
		await seedKumiaiProject(team.id, goal.id, { title: "Self-serve signup", status: "in-progress" });
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);

		const res = await apiRequest("POST", "/api/agents/sessions", { body: { planning: { kind: "goal" } } });

		expect(res.status).toBe(201);
		const context = planningContext(runtime);
		expect(context).toContain("plan a new goal");
		expect(context).toContain('Goal "Faster onboarding", priority 2: "Self-serve signup" (in-progress)');
		expect(context).toContain("pass a new goal and no goal_id");
	});

	it("only lists goals of the chosen workspace", async () => {
		const { team } = await signedInTeamMember("planning-ws.com");
		const other = await seedKumiaiWorkspace(team.id, { name: "Side bets", isDefault: false });
		await seedKumiaiGoal(team.id, { title: "In default" });
		await seedKumiaiGoal(team.id, { title: "In side bets", workspaceId: other.id });
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);

		await apiRequest("POST", "/api/agents/sessions", {
			body: { planning: { kind: "goal", workspaceId: other.id } },
		});

		const context = planningContext(runtime);
		expect(context).toContain('workspace "Side bets"');
		expect(context).toContain("In side bets");
		expect(context).not.toContain("In default");
	});

	it("seeds an add-project session with the goal and the projects it already has", async () => {
		const { team } = await signedInTeamMember("planning-project.com");
		const goal = await seedKumiaiGoal(team.id, { title: "Notes without typing", body: "Clinicians dictate." });
		await seedKumiaiProject(team.id, goal.id, { title: "Dictation pilot" });
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);

		const res = await apiRequest("POST", "/api/agents/sessions", {
			body: { planning: { kind: "project", goalId: goal.id } },
		});

		expect(res.status).toBe(201);
		const context = planningContext(runtime);
		expect(context).toContain(`Goal id: ${goal.id}`);
		expect(context).toContain("Clinicians dictate.");
		expect(context).toContain('Projects it already has: "Dictation pilot" (backlog).');
		expect(context).toContain(`pass goal_id "${goal.id}"`);
	});

	it("returns 404 for a goal in another team, without calling the runtime", async () => {
		await signedInTeamMember("planning-mine.com");
		const stranger = await seedUser();
		const { team: otherTeam } = await seedTeamWithBoard({
			domain: "planning-theirs.com",
			members: [{ userId: stranger.id, role: "member" }],
		});
		const theirs = await seedKumiaiGoal(otherTeam.id);
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);

		const res = await apiRequest("POST", "/api/agents/sessions", {
			body: { planning: { kind: "project", goalId: theirs.id } },
		});

		expect(res.status).toBe(404);
		expect(runtime.calls).toHaveLength(0);
	});

	it("refuses planning in the personal workspace", async () => {
		await signedInTeamMember("planning-personal.com");
		const runtime = fakeAgentRuntime();
		useRuntime(runtime);

		const res = await apiRequest("POST", "/api/agents/sessions?workspaceId=personal", {
			body: { planning: { kind: "goal" } },
		});

		expect(res.status).toBe(403);
		expect(runtime.calls).toHaveLength(0);
	});

	it.each([{ planning: { kind: "milestone" } }, { planning: { kind: "project" } }])(
		"rejects a malformed planning intent %j",
		async (body) => {
			await signedInTeamMember("planning-bad.com");
			useRuntime(fakeAgentRuntime());

			const res = await apiRequest("POST", "/api/agents/sessions", { body });
			expect(res.status).toBe(422);
		},
	);
});
