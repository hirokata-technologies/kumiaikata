import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db, newId } from "@kata/db";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { zValidator, validateId } from "../http/validate.js";
import { ok, created, noContent } from "../http/responders.js";
import type { AppVariables } from "@kata/http";
import { cards } from "@kata/db";
import type { Checklist, ChecklistItem } from "@kata/db";
import { AppError } from "@kata/http";
import { eventBus } from "../events/bus.js";

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession, loadBoardAccess);

// POST /api/boards/:boardId/cards/:cardId/checklists
r.post(
	"/",
	zValidator("json", z.object({ title: z.string().min(1).max(200) })),
	async (c) => {
		const board = c.get("board");
		const cardId = validateId(c.req.param("cardId"), "cardId");

		const checklist: Checklist = {
			id: newId(),
			title: c.req.valid("json").title,
			items: [],
		};

		await db.transaction(async (tx) => {
			const [card] = await tx
				.select({ checklists: cards.checklists })
				.from(cards)
				.where(and(eq(cards.id, cardId), eq(cards.boardId, board.id)))
				.limit(1)
				.for("update");
			if (!card) {
				throw new AppError("NOT_FOUND", "Card not found.");
			}

			if ((card.checklists ?? []).length >= 50) {
				throw new AppError("CONFLICT", "Checklist limit reached.");
			}
			const next = [...(card.checklists ?? []), checklist];
			const rows = await tx
				.update(cards)
				.set({ checklists: next })
				.where(eq(cards.id, cardId))
				.returning({ id: cards.id });
			if (rows.length === 0) {
				throw new AppError("NOT_FOUND", "Card not found.");
			}
		});

		const payload = {
			id: checklist.id,
			title: checklist.title,
			items: [],
		};

		eventBus.emit({
			type: "card.checklist.created",
			boardId: board.id,
			payload: { cardId, checklist: payload },
		});

		return created(c, payload);
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/checklists/:checklistId
r.delete("/:checklistId", async (c) => {
	const board = c.get("board");
	const cardId = validateId(c.req.param("cardId"), "cardId");
	const checklistId = validateId(c.req.param("checklistId"), "checklistId");

	await db.transaction(async (tx) => {
		const [card] = await tx
			.select({ checklists: cards.checklists })
			.from(cards)
			.where(and(eq(cards.id, cardId), eq(cards.boardId, board.id)))
			.limit(1)
			.for("update");
		if (!card) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		const exists = (card.checklists ?? []).some((cl) => cl.id === checklistId);
		if (!exists) {
			throw new AppError("NOT_FOUND", "Checklist not found.");
		}

		const next = (card.checklists ?? []).filter((cl) => cl.id !== checklistId);
		const rows = await tx
			.update(cards)
			.set({ checklists: next })
			.where(eq(cards.id, cardId))
			.returning({ id: cards.id });
		if (rows.length === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}
	});

	eventBus.emit({
		type: "card.checklist.deleted",
		boardId: board.id,
		payload: { cardId, checklistId },
	});

	return noContent(c);
});

// POST /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items
r.post(
	"/:checklistId/items",
	zValidator("json", z.object({ text: z.string().min(1).max(1000) })),
	async (c) => {
		const board = c.get("board");
		const cardId = validateId(c.req.param("cardId"), "cardId");
		const checklistId = validateId(c.req.param("checklistId"), "checklistId");
		const { text } = c.req.valid("json");

		const newItem: ChecklistItem = {
			id: newId(),
			text,
			checked: false,
		};

		await db.transaction(async (tx) => {
			const [card] = await tx
				.select({ checklists: cards.checklists })
				.from(cards)
				.where(and(eq(cards.id, cardId), eq(cards.boardId, board.id)))
				.limit(1)
				.for("update");
			if (!card) {
				throw new AppError("NOT_FOUND", "Card or checklist not found.");
			}

			const clIdx = (card.checklists ?? []).findIndex((cl) => cl.id === checklistId);
			if (clIdx === -1) {
				throw new AppError("NOT_FOUND", "Card or checklist not found.");
			}

			if ((card.checklists![clIdx]!.items ?? []).length >= 200) {
				throw new AppError("CONFLICT", "Checklist item limit reached.");
			}
			const targetItems = [...(card.checklists![clIdx]!.items ?? []), newItem];
			const next: Checklist[] = card.checklists!.map((cl, i) =>
				i === clIdx ? { ...cl, items: targetItems } : cl,
			);
			const rows = await tx
				.update(cards)
				.set({ checklists: next })
				.where(eq(cards.id, cardId))
				.returning({ id: cards.id });
			if (rows.length === 0) {
				throw new AppError("NOT_FOUND", "Card not found.");
			}
		});

		const payload = {
			id: newItem.id,
			text: newItem.text,
			checked: newItem.checked,
		};

		eventBus.emit({
			type: "card.checklist.updated",
			boardId: board.id,
			payload: { cardId, checklistId, item: payload },
		});

		return created(c, payload);
	},
);

// PATCH /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId
r.patch(
	"/:checklistId/items/:itemId",
	zValidator(
		"json",
		z.object({
			text: z.string().min(1).max(1000).optional(),
			checked: z.boolean().optional(),
		}),
	),
	async (c) => {
		const board = c.get("board");
		const cardId = validateId(c.req.param("cardId"), "cardId");
		const checklistId = validateId(c.req.param("checklistId"), "checklistId");
		const itemId = validateId(c.req.param("itemId"), "itemId");
		const input = c.req.valid("json");

		let updatedItem: ChecklistItem | undefined;

		await db.transaction(async (tx) => {
			const [card] = await tx
				.select({ checklists: cards.checklists })
				.from(cards)
				.where(and(eq(cards.id, cardId), eq(cards.boardId, board.id)))
				.limit(1)
				.for("update");
			if (!card) {
				throw new AppError("NOT_FOUND", "Card not found.");
			}

			const clIdx = (card.checklists ?? []).findIndex((cl) => cl.id === checklistId);
			if (clIdx === -1) {
				throw new AppError("NOT_FOUND", "Checklist not found.");
			}

			const checklist = card.checklists![clIdx];
			if (!checklist) {
				throw new AppError("NOT_FOUND", "Checklist not found.");
			}
			const items = checklist.items ?? [];
			const itemIdx = items.findIndex((i) => i.id === itemId);
			if (itemIdx === -1) {
				throw new AppError("NOT_FOUND", "Checklist item not found.");
			}

			const item = items[itemIdx];
			if (!item) {
				throw new AppError("NOT_FOUND", "Checklist item not found.");
			}
			const patched: ChecklistItem = {
				id: item.id,
				text: input.text !== undefined ? input.text : item.text,
				checked: input.checked !== undefined ? input.checked : item.checked,
			};
			updatedItem = patched;

			const newItems = [...items];
			newItems[itemIdx] = patched;
			const next: Checklist[] = card.checklists!.map((cl, i) =>
				i === clIdx ? { ...cl, items: newItems } : cl,
			);
			const rows = await tx
				.update(cards)
				.set({ checklists: next })
				.where(eq(cards.id, cardId))
				.returning({ id: cards.id });
			if (rows.length === 0) {
				throw new AppError("NOT_FOUND", "Card not found.");
			}
		});

		const payload = {
			id: updatedItem!.id,
			text: updatedItem!.text,
			checked: updatedItem!.checked,
		};

		eventBus.emit({
			type: "card.checklist.updated",
			boardId: board.id,
			payload: { cardId, checklistId, item: payload },
		});

		return ok(c, payload);
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId
r.delete("/:checklistId/items/:itemId", async (c) => {
	const board = c.get("board");
	const cardId = validateId(c.req.param("cardId"), "cardId");
	const checklistId = validateId(c.req.param("checklistId"), "checklistId");
	const itemId = validateId(c.req.param("itemId"), "itemId");

	await db.transaction(async (tx) => {
		const [card] = await tx
			.select({ checklists: cards.checklists })
			.from(cards)
			.where(and(eq(cards.id, cardId), eq(cards.boardId, board.id)))
			.limit(1)
			.for("update");

		if (!card) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		const clIdx = (card.checklists ?? []).findIndex((cl) => cl.id === checklistId);
		if (clIdx === -1) {
			throw new AppError("NOT_FOUND", "Checklist not found.");
		}

		const checklist = card.checklists![clIdx];
		if (!checklist) {
			throw new AppError("NOT_FOUND", "Checklist not found.");
		}
		const items = checklist.items ?? [];
		const itemIdx = items.findIndex((i) => i.id === itemId);
		if (itemIdx === -1) {
			throw new AppError("NOT_FOUND", "Checklist item not found.");
		}

		const newItems = items.filter((i) => i.id !== itemId);
		const next: Checklist[] = card.checklists!.map((cl, i) =>
			i === clIdx ? { ...cl, items: newItems } : cl,
		);
		const rows = await tx
			.update(cards)
			.set({ checklists: next })
			.where(eq(cards.id, cardId))
			.returning({ id: cards.id });
		if (rows.length === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}
	});

	eventBus.emit({
		type: "card.checklist.updated",
		boardId: board.id,
		payload: { cardId, checklistId, itemId },
	});

	return noContent(c);
});

export default r;
