import { describe, it, expect, vi, afterEach } from "vitest";
import { eventBus } from "../../src/events/bus.js";
import { dataOf, errorOf, mcpCall, seedMcpUser } from "../helpers/mcp.js";
import { seedCard, seedColumn, seedLabel } from "../helpers/seed.js";

/** Board tools (contract §4.9) over POST /mcp, served in-process from the board services. */

afterEach(() => {
	vi.restoreAllMocks();
});

describe("board tools", () => {
	it("get_board returns the caller's personal and team boards", async () => {
		const { user, personalBoardId, teamBoardId } = await seedMcpUser("boards-get.com");
		await seedColumn(personalBoardId, { title: "Todo" });

		const personal = dataOf<{ id: string; columns: Array<{ title: string }> }>(
			await mcpCall(user, "get_board", { boardType: "personal" }),
		);
		expect(personal.id).toBe(personalBoardId);
		expect(personal.columns.map((c) => c.title)).toEqual(["Todo"]);

		const team = dataOf<{ id: string }>(await mcpCall(user, "get_board", { boardType: "team" }));
		expect(team.id).toBe(teamBoardId);
	});

	it("creates a column and a card and publishes the SSE events", async () => {
		const { user, teamBoardId } = await seedMcpUser("boards-write.com");
		const emit = vi.spyOn(eventBus, "emit");

		const column = dataOf<{ id: string; title: string }>(
			await mcpCall(user, "create_column", { boardId: teamBoardId, title: "Doing" }),
		);
		expect(column.title).toBe("Doing");

		const card = dataOf<{ id: string; title: string; createdAt: string }>(
			await mcpCall(user, "create_card", { boardId: teamBoardId, columnId: column.id, title: "Ship it" }),
		);
		expect(card.title).toBe("Ship it");
		expect(typeof card.createdAt).toBe("string");

		expect(emit.mock.calls.map(([e]) => e.type)).toEqual(["column.created", "card.created"]);
		expect(emit.mock.calls.every(([e]) => e.boardId === teamBoardId)).toBe(true);
	});

	it("manages labels, comments and checklists on a card", async () => {
		const { user, teamBoardId } = await seedMcpUser("boards-parts.com");
		const column = await seedColumn(teamBoardId);
		const card = await seedCard(teamBoardId, column.id);
		const label = await seedLabel(teamBoardId);

		expect(dataOf(await mcpCall(user, "add_card_label", { boardId: teamBoardId, cardId: card.id, labelId: label.id }))).toEqual({
			cardId: card.id,
			labelId: label.id,
		});
		const labels = dataOf<{ labels: Array<{ id: string }> }>(await mcpCall(user, "list_labels", { boardId: teamBoardId }));
		expect(labels.labels.map((l) => l.id)).toEqual([label.id]);

		const comment = dataOf<{ id: string; authorId: string }>(
			await mcpCall(user, "add_card_comment", { boardId: teamBoardId, cardId: card.id, body: "hello" }),
		);
		expect(comment.authorId).toBe(user.id);

		const checklist = dataOf<{ id: string }>(
			await mcpCall(user, "add_checklist", { boardId: teamBoardId, cardId: card.id, title: "Steps" }),
		);
		const item = dataOf<{ id: string; checked: boolean }>(
			await mcpCall(user, "add_checklist_item", { boardId: teamBoardId, cardId: card.id, checklistId: checklist.id, text: "one" }),
		);
		const checked = dataOf<{ checked: boolean }>(
			await mcpCall(user, "update_checklist_item", {
				boardId: teamBoardId,
				cardId: card.id,
				checklistId: checklist.id,
				itemId: item.id,
				checked: true,
			}),
		);
		expect(checked.checked).toBe(true);

		const detail = dataOf<{ labelIds: string[]; comments: unknown[]; checklists: Array<{ items: unknown[] }> }>(
			await mcpCall(user, "get_card", { boardId: teamBoardId, cardId: card.id }),
		);
		expect(detail.labelIds).toEqual([label.id]);
		expect(detail.comments).toHaveLength(1);
		expect(detail.checklists[0]?.items).toHaveLength(1);

		expect(dataOf(await mcpCall(user, "delete_card", { boardId: teamBoardId, cardId: card.id }))).toEqual({ ok: true });
	});

	it("names board projects *_board_project and keeps them off the guild project tools", async () => {
		const { user, teamBoardId } = await seedMcpUser("boards-projects.com");

		const project = dataOf<{ id: string; name: string }>(
			await mcpCall(user, "create_board_project", { boardId: teamBoardId, name: "Web", color: "#3b82f6" }),
		);
		const listed = dataOf<{ projects: Array<{ id: string }> }>(await mcpCall(user, "list_board_projects", { boardId: teamBoardId }));
		expect(listed.projects.map((p) => p.id)).toEqual([project.id]);

		const bad = errorOf(await mcpCall(user, "create_board_project", { boardId: teamBoardId, name: "Web", color: "blue" }));
		expect(bad.code).toBe("VALIDATION");
	});

	it("denies access to another team's board and another user's personal board", async () => {
		const { user } = await seedMcpUser("boards-me.com");
		const other = await seedMcpUser("boards-them.com");
		const theirColumn = await seedColumn(other.teamBoardId);
		const emit = vi.spyOn(eventBus, "emit");

		for (const boardId of [other.teamBoardId, other.personalBoardId]) {
			expect(errorOf(await mcpCall(user, "list_labels", { boardId }))).toEqual({
				code: "FORBIDDEN",
				message: "You do not have access to this board.",
			});
		}
		expect(errorOf(await mcpCall(user, "create_card", { boardId: other.teamBoardId, columnId: theirColumn.id, title: "x" })).code).toBe(
			"FORBIDDEN",
		);
		expect(emit).not.toHaveBeenCalled();

		expect(errorOf(await mcpCall(user, "get_card", { boardId: "missing", cardId: "missing" }))).toEqual({
			code: "NOT_FOUND",
			message: "Board not found.",
		});
	});

	it("lets only the author edit a comment", async () => {
		const author = await seedMcpUser("boards-comment.com");
		const column = await seedColumn(author.personalBoardId);
		const card = await seedCard(author.personalBoardId, column.id);
		const comment = dataOf<{ id: string }>(
			await mcpCall(author.user, "add_card_comment", { boardId: author.personalBoardId, cardId: card.id, body: "mine" }),
		);

		const edited = dataOf<{ body: string; updatedAt: string }>(
			await mcpCall(author.user, "update_card_comment", {
				boardId: author.personalBoardId,
				cardId: card.id,
				commentId: comment.id,
				body: "edited",
			}),
		);
		expect(edited.body).toBe("edited");
		expect(edited.updatedAt).toBeTruthy();

		// A personal board's owner is the only one who can reach it, so access is the guard.
		const other = await seedMcpUser("boards-comment-other.com");
		const denied = errorOf(
			await mcpCall(other.user, "update_card_comment", {
				boardId: author.personalBoardId,
				cardId: card.id,
				commentId: comment.id,
				body: "hijack",
			}),
		);
		expect(denied.code).toBe("FORBIDDEN");
	});
});
