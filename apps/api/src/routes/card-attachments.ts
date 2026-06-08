import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db } from "@kata/db";
import { attachments } from "@kata/db";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { AppError } from "@kata/http";
import { validateId } from "../http/validate.js";
import { created, noContent } from "../http/responders.js";
import type { AppVariables } from "@kata/http";
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
	const cardId = validateId(c.req.param("cardId"), "cardId");
	const att = await uploadAttachment({
		boardId: board.id,
		cardId,
		file,
		user: c.get("user"),
	});

	return created(c, att);
});

// DELETE /api/boards/:boardId/cards/:cardId/attachments/:attachmentId
r.delete("/:attachmentId", async (c) => {
	const board = c.get("board");
	const user = c.get("user");
	const access = c.get("access");
	const cardId = validateId(c.req.param("cardId"), "cardId");
	const attachmentId = validateId(c.req.param("attachmentId"), "attachmentId");

	// Resolve the attachment to check ownership before deleting.
	const [att] = await db
		.select({ uploadedBy: attachments.uploadedBy })
		.from(attachments)
		.where(
			and(
				eq(attachments.id, attachmentId),
				eq(attachments.boardId, board.id),
				eq(attachments.cardId, cardId),
			),
		)
		.limit(1);
	if (!att) throw new AppError("NOT_FOUND", "Attachment not found.");

	const isUploader = att.uploadedBy === user.id;
	const isAdmin = access.kind === "team-admin" || access.kind === "personal-owner";
	if (!isUploader && !isAdmin) {
		throw new AppError(
			"FORBIDDEN",
			"Only the uploader or a board admin may delete this attachment.",
		);
	}

	await deleteAttachment(board.id, cardId, attachmentId);
	return noContent(c);
});

export default r;
