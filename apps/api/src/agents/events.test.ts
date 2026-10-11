import { describe, it, expect } from "vitest";
import { normalizeEvent } from "./events.js";

describe("normalizeEvent", () => {
	it("returns null for non-objects and events with nothing to show", () => {
		expect(normalizeEvent(null)).toBeNull();
		expect(normalizeEvent("x")).toBeNull();
		expect(normalizeEvent([])).toBeNull();
		expect(normalizeEvent({ author: "a", id: "1", actions: { state_delta: {} } })).toBeNull();
		expect(normalizeEvent({ author: "a", content: { parts: [{ text: "   " }] } })).toBeNull();
	});

	it("reads a snake_case stream event with text and drops the thought signature", () => {
		const event = normalizeEvent({
			id: "e1",
			author: "project_manager",
			timestamp: 1791715080.5,
			content: {
				role: "model",
				parts: [{ text: "Hello", thought_signature: "AAAA" }],
			},
		});
		expect(event).toEqual({
			id: "e1",
			author: "project_manager",
			timestamp: new Date(1791715080500).toISOString(),
			text: "Hello",
			toolCalls: [],
			toolResults: [],
			transferToAgent: null,
			errorMessage: null,
		});
	});

	it("skips model thoughts and concatenates visible text parts", () => {
		const event = normalizeEvent({
			author: "strategist",
			content: {
				parts: [
					{ text: "internal reasoning", thought: true },
					{ text: "Part one. " },
					{ text: "Part two." },
				],
			},
		});
		expect(event?.text).toBe("Part one. Part two.");
	});

	it("reads camelCase history events where unset fields are null", () => {
		const event = normalizeEvent({
			id: "e2",
			author: "project_manager",
			timestamp: 10,
			errorMessage: null,
			actions: { transferToAgent: null },
			content: {
				parts: [
					{
						text: null,
						thought: null,
						functionResponse: null,
						functionCall: { id: "call_1", name: "strategist", args: { request: "Plan it" } },
					},
				],
			},
		});
		expect(event?.text).toBeNull();
		expect(event?.toolCalls).toEqual([
			{ id: "call_1", name: "strategist", args: { request: "Plan it" } },
		]);
	});

	it("reports tool results by name without their payload", () => {
		const event = normalizeEvent({
			author: "user",
			content: {
				parts: [
					{
						function_response: {
							id: "call_1",
							name: "strategist",
							response: { result: "a very long answer" },
						},
					},
				],
			},
		});
		expect(event?.toolResults).toEqual([{ id: "call_1", name: "strategist" }]);
		expect(JSON.stringify(event)).not.toContain("very long answer");
	});

	it("surfaces transfer_to_agent and error messages", () => {
		expect(
			normalizeEvent({ author: "a", actions: { transfer_to_agent: "strategist" } })
				?.transferToAgent,
		).toBe("strategist");
		expect(
			normalizeEvent({ author: "a", error_code: "SAFETY", error_message: "blocked" })
				?.errorMessage,
		).toBe("blocked");
	});

	it("defaults a missing author and a missing timestamp", () => {
		const event = normalizeEvent({ content: { parts: [{ text: "hi" }] } });
		expect(event?.author).toBe("unknown");
		expect(event?.timestamp).toBeNull();
		expect(event?.id).toBe("");
	});
});
