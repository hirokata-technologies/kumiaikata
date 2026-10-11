import { GoogleAuth } from "google-auth-library";
import { env } from "../env.js";
import { normalizeEvent } from "./events.js";
import type { AgentEvent } from "./events.js";

/**
 * Client for the AI agents hosted on Vertex AI Agent Runtime (Google ADK).
 *
 *   POST {base}:query                  { class_method, input }   -> { output }
 *   POST {base}:streamQuery?alt=sse    { class_method, input }   -> one ADK event per line
 *
 * where {base} = https://{location}-aiplatform.googleapis.com/v1/{AGENT_RUNTIME_NAME}.
 * Calls are authenticated with Application Default Credentials (on Cloud Run: the
 * service account, which needs roles/aiplatform.user).
 *
 * `userId` here is the ADK user id. Callers derive it server-side
 * (`${workspaceId}:${userId}`, see services/agents.ts); Agent Runtime scopes every
 * session to it.
 */

const RUNTIME_NAME_PATTERN =
	/^projects\/[^/]+\/locations\/([a-z0-9-]+)\/reasoningEngines\/\d+$/;

export interface AgentSession {
	id: string;
	/** Seconds since the epoch, as reported by ADK. */
	lastUpdateTime: number | null;
}

export interface AgentSessionWithEvents extends AgentSession {
	events: AgentEvent[];
}

/** An upstream (Agent Runtime) failure. `status` is the upstream HTTP status. */
export class AgentsUpstreamError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		/** Upstream google.rpc status, e.g. FAILED_PRECONDITION. */
		public readonly upstreamStatus?: string,
	) {
		super(message);
		this.name = "AgentsUpstreamError";
	}
}

export interface AgentsClient {
	createSession(userId: string): Promise<AgentSession>;
	listSessions(userId: string): Promise<AgentSession[]>;
	/** Resolves to null when the session does not exist for this user. */
	getSession(userId: string, sessionId: string): Promise<AgentSessionWithEvents | null>;
	deleteSession(userId: string, sessionId: string): Promise<void>;
	/** Streams the agent's reply to `message` as normalized ADK events. */
	streamQuery(
		userId: string,
		sessionId: string,
		message: string,
		signal?: AbortSignal,
	): AsyncGenerator<AgentEvent>;
}

export interface AgentsClientOptions {
	/** projects/{p}/locations/{l}/reasoningEngines/{id} */
	runtimeName: string;
	getAccessToken: () => Promise<string>;
	fetch?: typeof fetch;
}

export function parseRuntimeName(runtimeName: string): { location: string } {
	const match = RUNTIME_NAME_PATTERN.exec(runtimeName);
	if (!match) {
		throw new Error(
			"AGENT_RUNTIME_NAME must look like projects/{project}/locations/{location}/reasoningEngines/{id}",
		);
	}
	return { location: match[1]! };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read an `{ error: { code, message, status } }` body without trusting its shape. */
function upstreamErrorFrom(body: unknown, httpStatus: number): AgentsUpstreamError {
	const error = isRecord(body) && isRecord(body["error"]) ? body["error"] : undefined;
	const status = typeof error?.["status"] === "string" ? error["status"] : undefined;
	const message =
		typeof error?.["message"] === "string" ? error["message"] : `HTTP ${httpStatus}`;
	return new AgentsUpstreamError(message, httpStatus, status);
}

async function readJson(res: Response): Promise<unknown> {
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** ADK reports epoch seconds as a float; accept both casings. */
function toSession(raw: unknown): AgentSession | null {
	if (!isRecord(raw) || typeof raw["id"] !== "string") return null;
	const time = raw["lastUpdateTime"] ?? raw["last_update_time"];
	return { id: raw["id"], lastUpdateTime: typeof time === "number" ? time : null };
}

export function createAgentsClient(options: AgentsClientOptions): AgentsClient {
	const { location } = parseRuntimeName(options.runtimeName);
	const base = `https://${location}-aiplatform.googleapis.com/v1/${options.runtimeName}`;
	const doFetch = options.fetch ?? fetch;

	async function post(
		url: string,
		body: unknown,
		signal?: AbortSignal,
	): Promise<Response> {
		const token = await options.getAccessToken();
		return doFetch(url, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
			...(signal && { signal }),
		});
	}

	/** `:query` call for one ADK class method; returns the unwrapped `output`. */
	async function query(classMethod: string, input: Record<string, unknown>): Promise<unknown> {
		const res = await post(`${base}:query`, { class_method: classMethod, input });
		const body = await readJson(res);
		if (!res.ok) throw upstreamErrorFrom(body, res.status);
		return isRecord(body) ? body["output"] : undefined;
	}

	// Agent Runtime answers "unknown session" and "session belongs to another user" the
	// same way: 400 FAILED_PRECONDITION.
	const isSessionNotFound = (err: unknown): boolean =>
		err instanceof AgentsUpstreamError &&
		err.status === 400 &&
		err.upstreamStatus === "FAILED_PRECONDITION";

	return {
		async createSession(userId) {
			const session = toSession(await query("async_create_session", { user_id: userId }));
			if (!session) {
				throw new AgentsUpstreamError("create_session returned no session id", 502);
			}
			return session;
		},

		async listSessions(userId) {
			const output = await query("async_list_sessions", { user_id: userId });
			const sessions = isRecord(output) && Array.isArray(output["sessions"]) ? output["sessions"] : [];
			return sessions.flatMap((raw) => {
				const session = toSession(raw);
				return session ? [session] : [];
			});
		},

		async getSession(userId, sessionId) {
			let output: unknown;
			try {
				output = await query("async_get_session", { user_id: userId, session_id: sessionId });
			} catch (err) {
				if (isSessionNotFound(err)) return null;
				throw err;
			}
			const session = toSession(output);
			if (!session || !isRecord(output)) return null;
			// Defence in depth: never hand back a session scoped to a different user id.
			const owner = output["userId"] ?? output["user_id"];
			if (owner !== userId) return null;
			const rawEvents = Array.isArray(output["events"]) ? output["events"] : [];
			const events = rawEvents.flatMap((raw) => {
				const event = normalizeEvent(raw);
				return event ? [event] : [];
			});
			return { ...session, events };
		},

		async deleteSession(userId, sessionId) {
			await query("async_delete_session", { user_id: userId, session_id: sessionId });
		},

		async *streamQuery(userId, sessionId, message, signal) {
			const res = await post(
				`${base}:streamQuery?alt=sse`,
				{
					class_method: "async_stream_query",
					input: { user_id: userId, session_id: sessionId, message },
				},
				signal,
			);
			if (!res.ok) throw upstreamErrorFrom(await readJson(res), res.status);
			if (!res.body) return;

			// Despite `alt=sse` the runtime streams newline-delimited JSON (one ADK event
			// per line). Also accept `data: {...}` framing in case that changes.
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			// fetch already rejects a pending read on abort; cancelling the reader as well
			// makes the generator finish promptly whatever the body implementation.
			const cancelOnAbort = () => void reader.cancel().catch(() => {});
			signal?.addEventListener("abort", cancelOnAbort, { once: true });
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (value) buffer += decoder.decode(value, { stream: true });
					if (done) buffer += decoder.decode();
					const lines = buffer.split("\n");
					buffer = done ? "" : (lines.pop() ?? "");
					for (const line of lines) {
						const event = parseStreamLine(line);
						if (event) yield event;
					}
					if (done) break;
				}
			} finally {
				signal?.removeEventListener("abort", cancelOnAbort);
				// Cancels the upstream request when the consumer stops early (client abort).
				await reader.cancel().catch(() => {});
			}
		},
	};
}

function parseStreamLine(line: string): AgentEvent | null {
	let text = line.trim();
	if (!text || text.startsWith(":")) return null;
	if (/^(event|id|retry):/.test(text)) return null;
	if (text.startsWith("data:")) text = text.slice(5).trim();
	if (!text) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	// A failure part-way through the stream arrives as { error: { code, message, status } }.
	if (isRecord(parsed) && isRecord(parsed["error"]) && !("author" in parsed)) {
		throw upstreamErrorFrom(parsed, 500);
	}
	return normalizeEvent(parsed);
}

// ── Default (environment-configured) client ──────────────────────────────────

let cached: AgentsClient | null | undefined;
let googleAuth: GoogleAuth | undefined;

async function applicationDefaultToken(): Promise<string> {
	googleAuth ??= new GoogleAuth({
		scopes: ["https://www.googleapis.com/auth/cloud-platform"],
	});
	const token = await googleAuth.getAccessToken();
	if (!token) throw new AgentsUpstreamError("No Google access token available", 502);
	return token;
}

/**
 * The agents client for this deployment, or null when AGENT_RUNTIME_NAME is not set
 * (the /api/agents routes then answer 503).
 */
export function getAgentsClient(): AgentsClient | null {
	if (cached === undefined) {
		cached = env.AGENT_RUNTIME_NAME
			? createAgentsClient({
					runtimeName: env.AGENT_RUNTIME_NAME,
					getAccessToken: applicationDefaultToken,
				})
			: null;
	}
	return cached;
}
