import { Hono } from "hono";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { zValidator, validateObjectId } from "../http/validate.js";
import { ok, created, noContent } from "../http/responders.js";
import type { AppVariables } from "../http/types.js";
import { cards } from "../db/schemas/index.js";
import { AppError } from "../http/error.js";
import { eventBus } from "../events/bus.js";

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession, loadBoardAccess);

// POST /api/boards/:boardId/cards/:cardId/checklists
r.post(
	"/",
	zValidator("json", z.object({ title: z.string().min(1).max(200) })),
	async (c) => {
		const board = c.get("board");
		const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));

		const checklist = {
			_id: new ObjectId(),
			title: c.req.valid("json").title,
			items: [] as [],
		};

		const result = await cards().updateOne(
			{ _id: cardId, boardId: board._id },
			{ $push: { checklists: checklist } },
		);

		if (result.matchedCount === 0) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		const payload = {
			id: String(checklist._id),
			title: checklist.title,
			items: [],
		};

		eventBus.emit({
			type: "card.checklist.created",
			boardId: String(board._id),
			payload: { cardId: String(cardId), checklist: payload },
		});

		return created(c, payload);
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/checklists/:checklistId
r.delete("/:checklistId", async (c) => {
	const board = c.get("board");
	const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));
	const checklistObjId = new ObjectId(validateObjectId(c.req.param("checklistId"), "checklistId"));

	const card = await cards().findOne(
		{ _id: cardId, boardId: board._id },
		{ projection: { checklists: { $elemMatch: { _id: checklistObjId } } } },
	);
	if (!card) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	if (!card.checklists || card.checklists.length === 0) {
		throw new AppError("NOT_FOUND", "Checklist not found.");
	}

	await cards().updateOne(
		{ _id: cardId },
		{ $pull: { checklists: { _id: checklistObjId } } },
	);

	eventBus.emit({
		type: "card.checklist.deleted",
		boardId: String(board._id),
		payload: { cardId: String(cardId), checklistId: String(checklistObjId) },
	});

	return noContent(c);
});

// POST /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items
r.post(
	"/:checklistId/items",
	zValidator("json", z.object({ text: z.string().min(1).max(1000) })),
	async (c) => {
		const board = c.get("board");
		const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));
		const checklistObjId = new ObjectId(validateObjectId(c.req.param("checklistId"), "checklistId"));

		const { text } = c.req.valid("json");
		const newItemId = new ObjectId();

		const updated = await cards().findOneAndUpdate(
			{ _id: cardId, boardId: board._id, "checklists._id": checklistObjId },
			{
				$push: {
					"checklists.$.items": {
						_id: newItemId,
						text,
						checked: false,
					},
				},
			},
			{
				returnDocument: "after",
				projection: { checklists: { $elemMatch: { _id: checklistObjId } } },
			},
		);

		if (!updated) {
			throw new AppError("NOT_FOUND", "Card or checklist not found.");
		}

		const checklist = updated.checklists?.[0];
		const item = checklist?.items.find((i) => String(i._id) === String(newItemId));

		if (!item) {
			throw new AppError("NOT_FOUND", "Checklist item not found.");
		}

		const payload = {
			id: String(item._id),
			text: item.text,
			checked: item.checked,
		};

		eventBus.emit({
			type: "card.checklist.updated",
			boardId: String(board._id),
			payload: { cardId: String(cardId), checklistId: String(checklistObjId), item: payload },
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
		const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));
		const checklistObjId = new ObjectId(validateObjectId(c.req.param("checklistId"), "checklistId"));
		const itemObjId = new ObjectId(validateObjectId(c.req.param("itemId"), "itemId"));

		const input = c.req.valid("json");

		const updated = await cards().findOneAndUpdate(
			{ _id: cardId, boardId: board._id },
			{
				$set: {
					...(input.text !== undefined && { "checklists.$[c].items.$[i].text": input.text }),
					...(input.checked !== undefined && { "checklists.$[c].items.$[i].checked": input.checked }),
				},
			},
			{
				arrayFilters: [{ "c._id": checklistObjId }, { "i._id": itemObjId }],
				returnDocument: "after",
				projection: { checklists: { $elemMatch: { _id: checklistObjId } } },
			},
		);

		if (!updated) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		const checklist = updated.checklists?.[0];
		if (!checklist) {
			throw new AppError("NOT_FOUND", "Checklist not found.");
		}

		const item = checklist.items.find((i) => String(i._id) === String(itemObjId));
		if (!item) {
			throw new AppError("NOT_FOUND", "Checklist item not found.");
		}

		const payload = {
			id: String(item._id),
			text: item.text,
			checked: item.checked,
		};

		eventBus.emit({
			type: "card.checklist.updated",
			boardId: String(board._id),
			payload: { cardId: String(cardId), checklistId: String(checklistObjId), item: payload },
		});

		return ok(c, payload);
	},
);

// DELETE /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId
r.delete("/:checklistId/items/:itemId", async (c) => {
	const board = c.get("board");
	const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));
	const checklistObjId = new ObjectId(validateObjectId(c.req.param("checklistId"), "checklistId"));
	const itemObjId = new ObjectId(validateObjectId(c.req.param("itemId"), "itemId"));

	// Two-step: check existence with distinct 404 messages, then pull.
	const exists = await cards().findOne(
		{
			_id: cardId,
			boardId: board._id,
			"checklists._id": checklistObjId,
			"checklists.items._id": itemObjId,
		},
		{ projection: { _id: 1 } },
	);

	if (!exists) {
		// Distinguish between card-not-found, checklist-not-found, item-not-found.
		const card = await cards().findOne(
			{ _id: cardId, boardId: board._id },
			{ projection: { _id: 1 } },
		);
		if (!card) {
			throw new AppError("NOT_FOUND", "Card not found.");
		}

		const checklistExists = await cards().findOne(
			{ _id: cardId, "checklists._id": checklistObjId },
			{ projection: { _id: 1 } },
		);
		if (!checklistExists) {
			throw new AppError("NOT_FOUND", "Checklist not found.");
		}

		throw new AppError("NOT_FOUND", "Checklist item not found.");
	}

	await cards().updateOne(
		{ _id: cardId, "checklists._id": checklistObjId },
		{ $pull: { "checklists.$.items": { _id: itemObjId } } },
	);

	eventBus.emit({
		type: "card.checklist.updated",
		boardId: String(board._id),
		payload: { cardId: String(cardId), checklistId: String(checklistObjId), itemId: String(itemObjId) },
	});

	return noContent(c);
});

export default r;
