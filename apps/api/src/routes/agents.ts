import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { AppError } from "@kata/http";
import type { AppVariables } from "@kata/http";
import { requireSession } from "../auth/middleware.js";
import { getAgentsClient, AgentsUpstreamError } from "../agents/client.js";
import type { AgentsClient } from "../agents/client.js";
import type { AgentEvent } from "../agents/events.js";
import { zValidator } from "../http/validate.js";
import { ok, created, noContent } from "../http/responders.js";
import { agentUserId, resolveAgentWorkspace } from "../services/agents.js";

interface AgentsVariables extends AppVariables {
	agents: AgentsClient;
	workspaceId: string;
	/** ADK user id: `${workspaceId}:${userId}`. */
	agentUser: string;
}

/** Longest message accepted per turn. */
export const MAX_MESSAGE_LENGTH = 8000;
const HEARTBEAT_MS = 15_000;
// Agent Runtime session ids are numeric strings; accept anything URL-safe and short.
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

const workspaceQuery = z.object({ workspaceId: z.string().min(1).max(128).optional() });
const messageBody = z.object({ message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) });

const r = new Hono<{ Variables: AgentsVariables }>();

r.use("*", requireSession);

// Agents configured? Then pin the workspace and derive the ADK user id.
r.use("*", async (c, next) => {
	const agents = getAgentsClient();
	if (!agents) {
		throw new AppError("SERVICE_UNAVAILABLE", "agents not configured");
	}
	const query = workspaceQuery.safeParse(c.req.query());
	if (!query.success) {
		throw new AppError("VALIDATION_ERROR", "Request did not match schema", z.flattenError(query.error));
	}
	const user = c.get("user");
	const requested = query.data.workspaceId;
	const workspaceId = await resolveAgentWorkspace(user.id, requested);
	c.set("agents", agents);
	c.set("workspaceId", workspaceId);
	c.set("agentUser", agentUserId(workspaceId, user.id));
	await next();
});

function sessionIdParam(raw: string | undefined): string {
	if (!raw || !SESSION_ID.test(raw)) {
		throw new AppError("VALIDATION_ERROR", "sessionId must be a valid id");
	}
	return raw;
}

/** Upstream failures are logged, never echoed to the client. */
function toAppError(err: unknown): AppError {
	if (err instanceof AppError) return err;
	console.error("[agents] upstream failure:", err);
	if (err instanceof AgentsUpstreamError && (err.status === 429 || err.status === 503)) {
		return new AppError("SERVICE_UNAVAILABLE", "The agents are busy. Try again shortly.");
	}
	return new AppError("BAD_GATEWAY", "The agents service failed to respond.");
}

async function upstream<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (err) {
		throw toAppError(err);
	}
}

const isoTime = (seconds: number | null) =>
	seconds === null ? null : new Date(seconds * 1000).toISOString();

function sessionJson(
	workspaceId: string,
	session: { id: string; lastUpdateTime: number | null },
) {
	return {
		id: session.id,
		workspaceId,
		lastUpdateTime: isoTime(session.lastUpdateTime),
	};
}

// POST /api/agents/sessions
r.post("/sessions", async (c) => {
	const session = await upstream(() => c.get("agents").createSession(c.get("agentUser")));
	return created(c, sessionJson(c.get("workspaceId"), session));
});

// GET /api/agents/sessions
r.get("/sessions", async (c) => {
	const sessions = await upstream(() => c.get("agents").listSessions(c.get("agentUser")));
	const workspaceId = c.get("workspaceId");
	return ok(
		c,
		sessions
			.sort((a, b) => (b.lastUpdateTime ?? 0) - (a.lastUpdateTime ?? 0))
			.map((s) => sessionJson(workspaceId, s)),
	);
});

// GET /api/agents/sessions/:sessionId
r.get("/sessions/:sessionId", async (c) => {
	const sessionId = sessionIdParam(c.req.param("sessionId"));
	const session = await upstream(() =>
		c.get("agents").getSession(c.get("agentUser"), sessionId),
	);
	if (!session) throw new AppError("NOT_FOUND", "Session not found.");
	return ok(c, { ...sessionJson(c.get("workspaceId"), session), events: session.events });
});

// DELETE /api/agents/sessions/:sessionId
r.delete("/sessions/:sessionId", async (c) => {
	const sessionId = sessionIdParam(c.req.param("sessionId"));
	const agents = c.get("agents");
	const agentUser = c.get("agentUser");
	// Agent Runtime deletes silently for unknown ids; check ownership first so the
	// caller gets a 404 for sessions that are not theirs.
	const session = await upstream(() => agents.getSession(agentUser, sessionId));
	if (!session) throw new AppError("NOT_FOUND", "Session not found.");
	await upstream(() => agents.deleteSession(agentUser, sessionId));
	return noContent(c);
});

// POST /api/agents/sessions/:sessionId/messages  -> text/event-stream
//
//   event: message      data: { id, author, text, timestamp }
//   event: tool_call    data: { eventId, author, id, name, args }
//   event: tool_result  data: { eventId, author, id, name }
//   event: handoff      data: { from, to }
//   event: ping         data: (empty; keep-alive every 15 s)
//   event: error        data: { code, message }     (terminal)
//   event: done         data: { sessionId, events } (terminal)
r.post("/sessions/:sessionId/messages", zValidator("json", messageBody), async (c) => {
	const sessionId = sessionIdParam(c.req.param("sessionId"));
	const { message } = c.req.valid("json");
	const agents = c.get("agents");
	const agentUser = c.get("agentUser");

	// Agent Runtime answers a stream into someone else's session with an empty 200, so
	// verify ownership up front: the client gets a real 404 instead of a silent stream.
	const session = await upstream(() => agents.getSession(agentUser, sessionId));
	if (!session) throw new AppError("NOT_FOUND", "Session not found.");

	return streamSSE(c, async (stream) => {
		const abort = new AbortController();
		const stop = () => abort.abort();
		stream.onAbort(stop);
		c.req.raw.signal.addEventListener("abort", stop, { once: true });

		const heartbeat = setInterval(() => {
			stream.writeSSE({ event: "ping", data: "" }).catch(() => {});
		}, HEARTBEAT_MS);

		const send = (event: string, data: unknown) =>
			stream.writeSSE({ event, data: JSON.stringify(data) });

		let count = 0;
		let lastAuthor: string | null = null;
		try {
			for await (const event of agents.streamQuery(agentUser, sessionId, message, abort.signal)) {
				count += 1;
				if (event.errorMessage) {
					console.error("[agents] agent reported an error:", event.errorMessage);
					await send("error", { code: "AGENT_ERROR", message: "The agent could not complete the reply." });
					return;
				}
				lastAuthor = await forward(event, lastAuthor, send);
			}
			await send("done", { sessionId, events: count });
		} catch (err) {
			// A client abort is not an error worth reporting (and nobody is listening).
			if (abort.signal.aborted) return;
			const appError = toAppError(err);
			await send("error", { code: appError.code, message: appError.message }).catch(() => {});
		} finally {
			clearInterval(heartbeat);
			c.req.raw.signal.removeEventListener("abort", stop);
			abort.abort(); // releases the upstream connection on every exit path
		}
	});
});

/** Writes one ADK event as SSE events; returns the author to remember for hand-offs. */
async function forward(
	event: AgentEvent,
	lastAuthor: string | null,
	send: (event: string, data: unknown) => Promise<void>,
): Promise<string | null> {
	let author = lastAuthor;

	// "user" is ADK's author for tool responses fed back to an agent, not an agent.
	if (event.author !== "user") {
		if (author && author !== event.author && !event.transferToAgent) {
			await send("handoff", { from: author, to: event.author });
		}
		author = event.author;
	}
	if (event.transferToAgent) {
		await send("handoff", { from: event.author, to: event.transferToAgent });
		author = event.transferToAgent;
	}

	if (event.text) {
		await send("message", {
			id: event.id,
			author: event.author,
			text: event.text,
			timestamp: event.timestamp,
		});
	}
	for (const call of event.toolCalls) {
		await send("tool_call", { eventId: event.id, author: event.author, ...call });
	}
	for (const result of event.toolResults) {
		await send("tool_result", { eventId: event.id, author: event.author, ...result });
	}
	return author;
}

export default r;
