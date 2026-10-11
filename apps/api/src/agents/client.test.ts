import { describe, it, expect, vi } from "vitest";
import {
	AgentsUpstreamError,
	createAgentsClient,
	parseRuntimeName,
} from "./client.js";

const RUNTIME =
	"projects/kumiaikata/locations/asia-southeast1/reasoningEngines/4644732939911823360";
const BASE = `https://asia-southeast1-aiplatform.googleapis.com/v1/${RUNTIME}`;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

const notFound = () =>
	json(
		{
			error: {
				code: 400,
				message: "Reasoning Engine Execution failed.",
				status: "FAILED_PRECONDITION",
			},
		},
		400,
	);

function makeClient(fetchMock: ReturnType<typeof vi.fn>) {
	return createAgentsClient({
		runtimeName: RUNTIME,
		getAccessToken: async () => "test-token",
		fetch: fetchMock as unknown as typeof fetch,
	});
}

/** A streaming Response whose body arrives in the given chunks. */
function streamOf(chunks: string[], status = 200) {
	const encoder = new TextEncoder();
	return new Response(
		new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
				controller.close();
			},
		}),
		{ status },
	);
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const item of iterable) out.push(item);
	return out;
}

describe("parseRuntimeName", () => {
	it("extracts the location", () => {
		expect(parseRuntimeName(RUNTIME)).toEqual({ location: "asia-southeast1" });
	});

	it.each(["", "reasoningEngines/1", "projects/p/locations/l/reasoningEngines/abc"])(
		"rejects %j",
		(name) => {
			expect(() => parseRuntimeName(name)).toThrow(/AGENT_RUNTIME_NAME/);
		},
	);
});

describe("createAgentsClient :query methods", () => {
	it("creates a session with the regional endpoint, bearer token and ADK class method", async () => {
		const fetchMock = vi.fn(async () =>
			json({ output: { id: "123", user_id: "ws:u1", last_update_time: 1700000000.5, events: [] } }),
		);
		const session = await makeClient(fetchMock).createSession("ws:u1");

		expect(session).toEqual({ id: "123", lastUpdateTime: 1700000000.5 });
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(`${BASE}:query`);
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer test-token");
		expect(JSON.parse(init.body as string)).toEqual({
			class_method: "async_create_session",
			input: { user_id: "ws:u1" },
		});
	});

	it("fails when create returns no session id", async () => {
		const fetchMock = vi.fn(async () => json({ output: {} }));
		await expect(makeClient(fetchMock).createSession("ws:u1")).rejects.toBeInstanceOf(
			AgentsUpstreamError,
		);
	});

	it("lists camelCase sessions and tolerates an empty output", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				json({ output: { sessions: [{ id: "1", lastUpdateTime: 5 }, { nope: true }] } }),
			)
			.mockResolvedValueOnce(json({ output: null }));
		const client = makeClient(fetchMock);

		expect(await client.listSessions("ws:u1")).toEqual([{ id: "1", lastUpdateTime: 5 }]);
		expect(await client.listSessions("ws:u1")).toEqual([]);
		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(JSON.parse(init.body as string)).toEqual({
			class_method: "async_list_sessions",
			input: { user_id: "ws:u1" },
		});
	});

	it("returns a session with normalised history events", async () => {
		const fetchMock = vi.fn(async () =>
			json({
				output: {
					id: "1",
					userId: "ws:u1",
					lastUpdateTime: 9,
					events: [
						{ id: "e1", author: "user", content: { parts: [{ text: "hi", functionCall: null }] } },
						{ id: "e2", author: "project_manager", actions: {}, content: { parts: [{ text: "hello" }] } },
						{ id: "e3", author: "project_manager", actions: { stateDelta: {} } },
					],
				},
			}),
		);
		const session = await makeClient(fetchMock).getSession("ws:u1", "1");
		expect(session?.events.map((e) => [e.author, e.text])).toEqual([
			["user", "hi"],
			["project_manager", "hello"],
		]);
		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(JSON.parse(init.body as string)).toEqual({
			class_method: "async_get_session",
			input: { user_id: "ws:u1", session_id: "1" },
		});
	});

	it("maps FAILED_PRECONDITION on get to null (unknown or foreign session)", async () => {
		const client = makeClient(vi.fn(async () => notFound()));
		expect(await client.getSession("ws:u1", "nope")).toBeNull();
	});

	it("never returns a session whose owner differs from the requested user", async () => {
		const client = makeClient(
			vi.fn(async () => json({ output: { id: "1", userId: "other:u2", events: [] } })),
		);
		expect(await client.getSession("ws:u1", "1")).toBeNull();
	});

	it("rethrows other upstream failures with the upstream status", async () => {
		const client = makeClient(
			vi.fn(async () =>
				json({ error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED" } }, 429),
			),
		);
		await expect(client.listSessions("ws:u1")).rejects.toMatchObject({
			name: "AgentsUpstreamError",
			status: 429,
			upstreamStatus: "RESOURCE_EXHAUSTED",
		});
	});

	it("survives a non-JSON error body", async () => {
		const client = makeClient(vi.fn(async () => new Response("<html>bad</html>", { status: 500 })));
		await expect(client.createSession("ws:u1")).rejects.toMatchObject({ status: 500 });
	});

	it("deletes a session", async () => {
		const fetchMock = vi.fn(async () => json({ output: null }));
		await makeClient(fetchMock).deleteSession("ws:u1", "1");
		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(JSON.parse(init.body as string)).toEqual({
			class_method: "async_delete_session",
			input: { user_id: "ws:u1", session_id: "1" },
		});
	});
});

describe("createAgentsClient streamQuery", () => {
	const eventA = { id: "a", author: "project_manager", content: { parts: [{ text: "Hel" }] } };
	const eventB = { id: "b", author: "strategist", content: { parts: [{ text: "lo" }] } };

	it("posts to :streamQuery?alt=sse and parses newline-delimited JSON split across chunks", async () => {
		const wire = `${JSON.stringify(eventA)}\n${JSON.stringify(eventB)}\n`;
		const cut = 30;
		const fetchMock = vi.fn(async () => streamOf([wire.slice(0, cut), wire.slice(cut)]));
		const events = await collect(makeClient(fetchMock).streamQuery("ws:u1", "1", "hi"));

		expect(events.map((e) => [e.author, e.text])).toEqual([
			["project_manager", "Hel"],
			["strategist", "lo"],
		]);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(`${BASE}:streamQuery?alt=sse`);
		expect(JSON.parse(init.body as string)).toEqual({
			class_method: "async_stream_query",
			input: { user_id: "ws:u1", session_id: "1", message: "hi" },
		});
	});

	it("parses a final line with no trailing newline", async () => {
		const events = await collect(
			makeClient(vi.fn(async () => streamOf([JSON.stringify(eventA)]))).streamQuery("ws:u1", "1", "hi"),
		);
		expect(events).toHaveLength(1);
	});

	it("also accepts SSE framing and ignores comments, other fields and junk", async () => {
		const wire = [
			": keep-alive",
			"event: message",
			`data: ${JSON.stringify(eventA)}`,
			"",
			"not json",
			`data:${JSON.stringify(eventB)}`,
			"data:",
			"",
		].join("\n");
		const events = await collect(
			makeClient(vi.fn(async () => streamOf([wire]))).streamQuery("ws:u1", "1", "hi"),
		);
		expect(events.map((e) => e.id)).toEqual(["a", "b"]);
	});

	it("throws on a non-2xx response", async () => {
		const client = makeClient(vi.fn(async () => notFound()));
		await expect(collect(client.streamQuery("ws:u1", "1", "hi"))).rejects.toMatchObject({
			status: 400,
			upstreamStatus: "FAILED_PRECONDITION",
		});
	});

	it("throws when the stream carries an error object", async () => {
		const wire = `${JSON.stringify(eventA)}\n${JSON.stringify({ error: { code: 500, message: "boom", status: "INTERNAL" } })}\n`;
		const gen = makeClient(vi.fn(async () => streamOf([wire]))).streamQuery("ws:u1", "1", "hi");
		const seen: string[] = [];
		await expect(
			(async () => {
				for await (const e of gen) seen.push(e.id);
			})(),
		).rejects.toBeInstanceOf(AgentsUpstreamError);
		expect(seen).toEqual(["a"]);
	});

	it("passes the abort signal upstream and cancels the body when the consumer stops early", async () => {
		const cancel = vi.fn();
		const encoder = new TextEncoder();
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(`${JSON.stringify(eventA)}\n`));
			},
			cancel,
		});
		const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
		const controller = new AbortController();

		for await (const _event of makeClient(fetchMock).streamQuery("ws:u1", "1", "hi", controller.signal)) {
			break;
		}

		expect(cancel).toHaveBeenCalled();
		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(init.signal).toBe(controller.signal);
	});

	it("yields nothing for an empty 200 response", async () => {
		const client = makeClient(vi.fn(async () => streamOf([])));
		expect(await collect(client.streamQuery("ws:u1", "1", "hi"))).toEqual([]);
	});
});
