import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * Error codes of docs/guild-contract.md §2 rule 10, plus `INTERNAL` for an unexpected
 * failure (answered with a generic message; REST status 500).
 */
export type McpToolErrorCode =
	| "NOT_FOUND"
	| "FORBIDDEN"
	| "VALIDATION"
	| "CONFLICT"
	| "UNAUTHENTICATED"
	| "INTERNAL";

/** A successful tool result: the value as JSON text plus `structuredContent`. */
export function toolResult(value: Record<string, unknown>): CallToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(value) }],
		structuredContent: value,
	};
}

/** A tool error (`isError: true`) whose text is `{"code","message"}` JSON. */
export function toolError(code: McpToolErrorCode, message: string): CallToolResult {
	return {
		isError: true,
		content: [{ type: "text", text: JSON.stringify({ code, message }) }],
	};
}
