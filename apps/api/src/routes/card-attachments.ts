import { Hono } from "hono";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { AppError } from "../http/error.js";
import { validateObjectId } from "../http/validate.js";
import { created, noContent } from "../http/responders.js";
import type { AppVariables } from "../http/types.js";
import { env } from "../env.js";
import {
	ALLOWED_MIMES,
	uploadAttachment,
	deleteAttachment,
} from "../services/attachments.js";

const r = new Hono<{ Variables: AppVariables }>();

r.use("*", requireSession, loadBoardAccess);

// POST /api/boards/:boardId/cards/:cardId/attachments
r.post("/", async (c) => {
	const form = await c.req.parseBody({ all: false });
	const file = form["file"];

	if (!(file instanceof File)) {
		throw new AppError("VALIDATION_ERROR", 'Field "file" is required.');
	}

	if (file.size > env.MAX_ATTACHMENT_BYTES) {
		throw new AppError(
			"PAYLOAD_TOO_LARGE",
			`File exceeds ${env.MAX_ATTACHMENT_BYTES} bytes.`,
		);
	}

	if (!ALLOWED_MIMES.has(file.type)) {
		throw new AppError(
			"UNSUPPORTED_MEDIA_TYPE",
			`MIME type "${file.type}" is not permitted.`,
		);
	}

	const board = c.get("board");
	// cardId comes from the parent mount path (/api/boards/:boardId/cards/:cardId/attachments)
	const cardId = validateObjectId(c.req.param("cardId"), "cardId");
	const att = await uploadAttachment({
		boardId: board._id,
		cardId,
		file,
		user: c.get("user"),
	});

	return created(c, att);
});

// DELETE /api/boards/:boardId/cards/:cardId/attachments/:attachmentId
r.delete("/:attachmentId", async (c) => {
	const board = c.get("board");
	const cardId = validateObjectId(c.req.param("cardId"), "cardId");
	const attachmentId = validateObjectId(c.req.param("attachmentId"), "attachmentId");
	await deleteAttachment(board._id, cardId, attachmentId);
	return noContent(c);
});

export default r;
