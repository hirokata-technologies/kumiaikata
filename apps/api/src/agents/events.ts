/**
 * Normalised view of a Google ADK event.
 *
 * Agent Runtime returns ADK events in two spellings: snake_case on the stream and
 * camelCase (with every unset field present as null) in session history. Parts also
 * carry large opaque `thought_signature` blobs. This reduces both to one small shape
 * that is safe to hand to a browser.
 */

export interface AgentToolCall {
	id: string | null;
	name: string;
	args: unknown;
}

export interface AgentToolResult {
	id: string | null;
	name: string;
}

export interface AgentEvent {
	id: string;
	/** Agent name (project_manager, strategist, ...) or "user". */
	author: string;
	/** ISO-8601, or null when ADK sent no timestamp. */
	timestamp: string | null;
	/** Visible text of the event (model "thoughts" are dropped), or null. */
	text: string | null;
	toolCalls: AgentToolCall[];
	toolResults: AgentToolResult[];
	/** Set when the agent transferred control to another agent. */
	transferToAgent: string | null;
	/** Set when ADK reports an error for this event. */
	errorMessage: string | null;
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** First present value among a snake_case key and its camelCase twin. */
function field(obj: Dict, snake: string, camel: string): unknown {
	return obj[snake] ?? obj[camel];
}

function str(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Returns null for events that carry nothing a client can show (pure state or
 * bookkeeping deltas).
 */
export function normalizeEvent(raw: unknown): AgentEvent | null {
	if (!isDict(raw)) return null;

	const content = isDict(raw["content"]) ? raw["content"] : {};
	const parts = Array.isArray(content["parts"]) ? content["parts"] : [];

	let text = "";
	const toolCalls: AgentToolCall[] = [];
	const toolResults: AgentToolResult[] = [];

	for (const part of parts) {
		if (!isDict(part)) continue;
		if (part["thought"] === true) continue;

		if (typeof part["text"] === "string") text += part["text"];

		const call = field(part, "function_call", "functionCall");
		if (isDict(call)) {
			const name = str(call["name"]);
			if (name) toolCalls.push({ id: str(call["id"]), name, args: call["args"] ?? {} });
		}

		const result = field(part, "function_response", "functionResponse");
		if (isDict(result)) {
			const name = str(result["name"]);
			if (name) toolResults.push({ id: str(result["id"]), name });
		}
	}

	const actions = isDict(raw["actions"]) ? raw["actions"] : {};
	const transferToAgent = str(field(actions, "transfer_to_agent", "transferToAgent"));
	const errorMessage = str(field(raw, "error_message", "errorMessage"));
	const trimmed = text.trim();

	if (!trimmed && !toolCalls.length && !toolResults.length && !transferToAgent && !errorMessage) {
		return null;
	}

	const seconds = raw["timestamp"];
	return {
		id: str(raw["id"]) ?? "",
		author: str(raw["author"]) ?? "unknown",
		timestamp: typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null,
		text: trimmed ? text : null,
		toolCalls,
		toolResults,
		transferToAgent,
		errorMessage,
	};
}
