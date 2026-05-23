import { Readable } from "node:stream";
import { ObjectId } from "mongodb";
import { withTransaction } from "../db/connection.js";
import {
	attachments as attachmentsColl,
	cards as cardsColl,
} from "../db/schemas/index.js";
import { AppError } from "../http/error.js";
import { storage } from "../storage/index.js";
import { eventBus } from "../events/bus.js";
import {
	fetchBoardWithMembership,
	deriveAccess,
} from "../auth/middleware.js";
import type { UserSession } from "../http/types.js";

// ── MIME allowlist ─────────────────────────────────────────────────────────────

export const ALLOWED_MIMES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/svg+xml",
	"application/pdf",
	"text/plain",
	"text/markdown",
	"application/zip",
	"application/json",
	"application/octet-stream",
]);

// ── MIME-to-extension map ──────────────────────────────────────────────────────
// Maps each allowed MIME type to a canonical file extension for storage keys.
// Using this instead of path.extname(file.name) prevents path traversal and
// ensures the stored extension matches the validated MIME type, not the
// user-supplied filename.

const MIME_TO_EXT: Record<string, string> = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"image/svg+xml": ".svg",
	"application/pdf": ".pdf",
	"text/plain": ".txt",
	"text/markdown": ".md",
	"application/zip": ".zip",
	"application/json": ".json",
	"application/octet-stream": ".bin",
};

// ── Response shape ─────────────────────────────────────────────────────────────

export interface AttachmentResponse {
	id: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
	url: string;
	uploadedBy: string;
	createdAt: Date;
}

// ── uploadAttachment ───────────────────────────────────────────────────────────

export async function uploadAttachment({
	boardId,
	cardId,
	file,
	user,
}: {
	boardId: ObjectId;
	cardId: string;
	file: File;
	user: UserSession;
}): Promise<AttachmentResponse> {
	// Verify the card exists and belongs to the board.
	const cardObjId = new ObjectId(cardId);
	const card = await cardsColl().findOne({ _id: cardObjId, boardId });
	if (!card) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	const attachmentId = new ObjectId();
	const ext = MIME_TO_EXT[file.type] ?? ".bin";
	const storageKey = `${String(boardId)}/${String(attachmentId)}${ext}`;

	// Write to storage first. If this fails, we do NOT create the DB row.
	const nodeStream = Readable.fromWeb(
		file.stream() as Parameters<typeof Readable.fromWeb>[0],
	);
	await storage.put(storageKey, nodeStream, file.size, file.type);

	// Storage write succeeded — persist the DB record inside a transaction.
	await withTransaction(async (session) => {
		await attachmentsColl().insertOne(
			{
				_id: attachmentId,
				cardId: card._id,
				boardId,
				filename: file.name,
				mimeType: file.type,
				sizeBytes: file.size,
				storageKey,
				uploadedBy: user.id as unknown as ObjectId,
				createdAt: new Date(),
			},
			{ session },
		);
		await cardsColl().updateOne(
			{ _id: card._id },
			{ $push: { attachmentIds: attachmentId } },
			{ session },
		);
	});

	const response: AttachmentResponse = {
		id: String(attachmentId),
		filename: file.name,
		mimeType: file.type,
		sizeBytes: file.size,
		url: `/api/attachments/${String(attachmentId)}`,
		uploadedBy: String(user.id),
		createdAt: new Date(),
	};

	eventBus.emit({
		type: "card.attachment.added",
		boardId: String(boardId),
		payload: response,
	});

	return response;
}

// ── deleteAttachment ───────────────────────────────────────────────────────────

export async function deleteAttachment(
	boardId: ObjectId,
	cardId: string,
	attachmentId: string,
): Promise<void> {
	// Find attachment scoped to boardId.
	const attObjId = new ObjectId(attachmentId);
	const att = await attachmentsColl().findOne({ _id: attObjId, boardId });
	if (!att) {
		throw new AppError("NOT_FOUND", "Attachment not found.");
	}

	const storageKey = att.storageKey;

	// Atomically remove the attachment row and pull its ID from the card.
	await withTransaction(async (session) => {
		await cardsColl().updateOne(
			{ _id: new ObjectId(cardId), boardId },
			{ $pull: { attachmentIds: att._id } },
			{ session },
		);
		await attachmentsColl().deleteOne({ _id: att._id }, { session });
	});

	// Delete the stored file after the transaction commits.
	// Log failures but do not error the response — DB is the source of truth.
	try {
		await storage.delete(storageKey);
	} catch (err) {
		console.error(
			`[deleteAttachment] Failed to delete storage file for attachment ${attachmentId}:`,
			err,
		);
	}

	eventBus.emit({
		type: "card.attachment.removed",
		boardId: String(boardId),
		payload: { id: attachmentId, cardId },
	});
}

// ── streamAttachment ───────────────────────────────────────────────────────────

export async function streamAttachment(
	attachmentId: string,
	user: UserSession,
): Promise<{
	att: {
		filename: string;
		mimeType: string;
		sizeBytes: number;
		storageKey: string;
	};
	stream: Readable;
}> {
	const att = await attachmentsColl().findOne({ _id: new ObjectId(attachmentId) });
	if (!att) {
		throw new AppError("NOT_FOUND", "Attachment not found.");
	}

	// Verify the user has access to the board this attachment belongs to.
	// fetchBoardWithMembership resolves board existence and team membership in
	// a single aggregation pipeline, preventing a race where membership is
	// revoked between two separate queries.
	const board = await fetchBoardWithMembership(String(att.boardId), user.id);
	if (!board) {
		throw new AppError("NOT_FOUND", "Attachment's board not found.");
	}

	const access = deriveAccess(board, user);
	if (!access) {
		throw new AppError(
			"FORBIDDEN",
			"You do not have access to this attachment.",
		);
	}

	const stream = await storage.get(att.storageKey);

	return {
		att: {
			filename: att.filename,
			mimeType: att.mimeType,
			sizeBytes: att.sizeBytes,
			storageKey: att.storageKey,
		},
		stream,
	};
}
