import { ObjectId } from "mongodb";
import { withTransaction } from "../db/connection.js";
import { cards as cardsColl, labels as labelsColl } from "../db/schemas/index.js";
import { AppError } from "../http/error.js";
import { eventBus } from "../events/bus.js";

// ── Serialisation shape ───────────────────────────────────────────────────────

export interface LabelDetail {
	id: string;
	boardId: string;
	name: string;
	color: string;
}

function toDetail(label: {
	_id: unknown;
	boardId: unknown;
	name: string;
	color: string;
}): LabelDetail {
	return {
		id: String(label._id),
		boardId: String(label.boardId),
		name: label.name,
		color: label.color,
	};
}

// ── createLabel ───────────────────────────────────────────────────────────────

export async function createLabel(
	boardId: ObjectId,
	input: { name: string; color: string },
): Promise<LabelDetail> {
	const insert = await labelsColl().insertOne({
		_id: new ObjectId(),
		boardId,
		name: input.name,
		color: input.color,
	});

	const doc = await labelsColl().findOne({ _id: insert.insertedId });
	const detail = toDetail(doc!);

	eventBus.emit({
		type: "label.created",
		boardId: String(boardId),
		payload: detail,
	});

	return detail;
}

// ── updateLabel ───────────────────────────────────────────────────────────────

export async function updateLabel(
	boardId: ObjectId,
	labelId: string,
	input: { name?: string; color?: string },
): Promise<LabelDetail> {
	const patch: Record<string, unknown> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.color !== undefined) patch.color = input.color;

	const label = await labelsColl().findOneAndUpdate(
		{ _id: new ObjectId(labelId), boardId },
		{ $set: patch },
		{ returnDocument: "after" },
	);

	if (!label) {
		throw new AppError("NOT_FOUND", "Label not found.");
	}

	const detail = toDetail(label);

	eventBus.emit({
		type: "label.updated",
		boardId: String(boardId),
		payload: detail,
	});

	return detail;
}

// ── deleteLabel ───────────────────────────────────────────────────────────────

export async function deleteLabel(
	boardId: ObjectId,
	labelId: string,
): Promise<void> {
	const labelObjId = new ObjectId(labelId);
	const label = await labelsColl().findOne({ _id: labelObjId, boardId });
	if (!label) {
		throw new AppError("NOT_FOUND", "Label not found.");
	}

	await withTransaction(async (session) => {
		// Remove this label from all cards on the board.
		await cardsColl().updateMany(
			{ boardId, labelIds: labelObjId },
			{ $pull: { labelIds: labelObjId } },
			{ session },
		);
		// Delete the label.
		await labelsColl().deleteOne({ _id: labelObjId }, { session });
	});

	eventBus.emit({
		type: "label.deleted",
		boardId: String(boardId),
		payload: { id: labelId, boardId: String(boardId) },
	});
}
