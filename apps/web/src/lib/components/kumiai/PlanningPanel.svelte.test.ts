import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "@testing-library/svelte";
import PlanningPanel from "./PlanningPanel.svelte";
import { ApiError } from "$lib/api/client.js";
import type { PlanningDeps } from "$lib/kumiai/planning.svelte.js";
import type { PlanningIntent, StreamEvent } from "$lib/kumiai/planning.js";

const CONVERSATION: StreamEvent[][] = [
	[
		{ event: "message", data: { id: "1", author: "project_manager", text: "Why does it matter **now**?" } },
		{ event: "done", data: {} },
	],
	[
		{ event: "handoff", data: { from: "project_manager", to: "strategist" } },
		{ event: "message", data: { id: "2", author: "strategist", text: "Start with a pilot, then roll out." } },
		{ event: "handoff", data: { from: "strategist", to: "project_manager" } },
		{ event: "message", data: { id: "3", author: "project_manager", text: "Here is the draft." } },
		{
			event: "tool_call",
			data: {
				eventId: "3",
				author: "project_manager",
				name: "propose_roadmap",
				args: {
					goal: { title: "Notes without typing", priority: 2 },
					projects: [
						{ title: "Dictation pilot", priority: "high", impact: 70, effort: 4 },
						{ title: "Ward rollout", impact: 40, effort: 8 },
					],
				},
			},
		},
		{ event: "done", data: {} },
	],
];

function scripted(createSession?: PlanningDeps["createSession"]): PlanningDeps {
	let turn = 0;
	return {
		createSession: createSession ?? vi.fn(async () => ({ id: "s1" })),
		stream: async function* () {
			for (const event of CONVERSATION[turn++] ?? []) yield event;
		},
	};
}

function setup(over: { intent?: PlanningIntent; goalTitle?: string; deps?: PlanningDeps } = {}) {
	const writer = {
		createGoal: vi.fn(async () => ({ id: "g1" })),
		createProject: vi.fn(async () => ({ id: "p1" })),
	};
	const props = {
		intent: over.intent ?? ({ kind: "goal", workspaceId: "w1" } as PlanningIntent),
		goalTitle: over.goalTitle ?? "",
		writer,
		deps: over.deps ?? scripted(),
		onclose: vi.fn(),
		oncreated: vi.fn(),
		onuseform: vi.fn(),
	};
	render(PlanningPanel, { props });
	return props;
}

async function say(text: string) {
	await userEvent.fill(page.getByRole("textbox", { name: "Message" }), text);
	await userEvent.keyboard("{Enter}");
}

describe("PlanningPanel.svelte", () => {
	it("introduces the three participants before anyone speaks", async () => {
		setup();
		await expect.element(page.getByRole("heading", { name: "Plan a new goal" })).toBeVisible();
		const cast = page.getByRole("list", { name: "Participants" });
		await expect.element(cast.getByText("Project Manager")).toBeVisible();
		await expect.element(cast.getByText("Strategist")).toBeVisible();
		await expect.element(page.getByText("Start by describing what you want to achieve.")).toBeVisible();
	});

	it("runs the conversation through to a draft and creates it", async () => {
		const props = setup();

		await say("Clinicians spend hours typing notes.");
		await expect.element(page.getByText("Clinicians spend hours typing notes.")).toBeVisible();
		await expect.element(page.getByText("now")).toBeVisible();

		await say("Burnout is rising.");
		await expect.element(page.getByText("Project Manager brought in the Strategist")).toBeVisible();
		await expect.element(page.getByText("Start with a pilot, then roll out.")).toBeVisible();
		await expect.element(page.getByText("Strategist handed back to the Project Manager")).toBeVisible();

		await expect.element(page.getByRole("textbox", { name: "Goal name" })).toHaveValue("Notes without typing");
		await userEvent.click(page.getByRole("checkbox", { name: "Include Ward rollout" }));
		await userEvent.fill(page.getByRole("textbox", { name: "Project 1 name" }), "Dictation pilot on one ward");

		await userEvent.click(page.getByRole("button", { name: "Create goal and 1 project" }));

		await vi.waitFor(() => expect(props.oncreated).toHaveBeenCalledWith("g1"));
		expect(props.writer.createGoal).toHaveBeenCalledWith(expect.objectContaining({ title: "Notes without typing", priority: 2 }));
		expect(props.writer.createProject).toHaveBeenCalledTimes(1);
		expect(props.writer.createProject).toHaveBeenCalledWith(
			"g1",
			expect.objectContaining({ title: "Dictation pilot on one ward", priority: "high", impact: 70, effort: 4 }),
		);
	});

	it("names the goal when planning projects for it", async () => {
		setup({ intent: { kind: "project", goalId: "g9" }, goalTitle: "Faster onboarding" });
		await expect.element(page.getByRole("heading", { name: "New projects for Faster onboarding" })).toBeVisible();
	});

	it("offers the form when the agents are not configured", async () => {
		const props = setup({
			deps: scripted(async () => {
				throw new ApiError(503, "SERVICE_UNAVAILABLE", "agents not configured");
			}),
		});

		await say("Hello");
		await expect.element(page.getByText(/planning agents are not set up/)).toBeVisible();
		await userEvent.click(page.getByRole("button", { name: "Use the form instead" }));
		expect(props.onuseform).toHaveBeenCalled();
	});

	it("closes on Escape", async () => {
		const props = setup();
		await userEvent.keyboard("{Escape}");
		expect(props.onclose).toHaveBeenCalled();
	});
});
