import { apiFetch, ApiError } from './client.js';
import type { PlanningIntent, StreamEvent } from '$lib/kumiai/planning.js';

export interface AgentSessionInfo {
	id: string;
	workspaceId: string;
	lastUpdateTime: string | null;
}

/** Opens an agents session; with `planning` the Project Manager gets the roadmap as context. */
export function createAgentSession(planning?: PlanningIntent): Promise<AgentSessionInfo> {
	return apiFetch<AgentSessionInfo>('/api/agents/sessions', {
		method: 'POST',
		...(planning && { body: JSON.stringify({ planning }) })
	});
}

/** Splits a text/event-stream buffer into complete events, returning the unparsed rest. */
export function parseSseChunk(buffer: string): { events: StreamEvent[]; rest: string } {
	const blocks = buffer.split(/\r?\n\r?\n/);
	const rest = blocks.pop() ?? '';
	const events: StreamEvent[] = [];
	for (const block of blocks) {
		let name = 'message';
		const data: string[] = [];
		for (const line of block.split(/\r?\n/)) {
			if (line.startsWith('event:')) name = line.slice(6).trim();
			else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
		}
		if (name === 'ping' || data.length === 0) continue;
		try {
			events.push({ event: name, data: JSON.parse(data.join('\n')) } as StreamEvent);
		} catch {
			/* a malformed event is skipped, not fatal */
		}
	}
	return { events, rest };
}

/**
 * Sends one user message and yields the reply as stream events until `done` or `error`.
 * Aborting `signal` stops the stream (and the agents' upstream call).
 */
export async function* streamAgentMessage(
	sessionId: string,
	message: string,
	signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
	const res = await fetch(`/api/agents/sessions/${encodeURIComponent(sessionId)}/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
		credentials: 'same-origin',
		body: JSON.stringify({ message }),
		...(signal && { signal })
	});
	if (!res.ok || !res.body) {
		let code = 'UNKNOWN';
		let text = res.statusText || 'Request failed';
		try {
			const body = (await res.json()) as { error?: { code?: string; message?: string } };
			code = body.error?.code ?? code;
			text = body.error?.message ?? text;
		} catch {
			/* keep defaults */
		}
		throw new ApiError(res.status, code, text);
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (value) buffer += decoder.decode(value, { stream: true });
			if (done) buffer += decoder.decode() + '\n\n';
			const parsed = parseSseChunk(buffer);
			buffer = parsed.rest;
			for (const event of parsed.events) {
				yield event;
				if (event.event === 'done' || event.event === 'error') return;
			}
			if (done) return;
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
}
