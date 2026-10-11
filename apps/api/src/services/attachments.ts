import { Readable } from "node:stream";
import { eq, and, sql } from "drizzle-orm";
import { db, newId } from "@kata/db";
import { attachments, cards } from "@kata/db";
import { AppError } from "@kata/http";
import { storage } from "../storage/index.js";
import { eventBus } from "../events/bus.js";
import {
	fetchBoardWithMembership,
	deriveAccess,
} from "../auth/middleware.js";
import type { UserSession } from "@kata/http";

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
	boardId: string;
	cardId: string;
	file: File;
	user: UserSession;
}): Promise<AttachmentResponse> {
	// Verify the card exists and belongs to the board.
	const [card] = await db
		.select()
		.from(cards)
		.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
		.limit(1);
	if (!card) {
		throw new AppError("NOT_FOUND", "Card not found.");
	}

	const attachmentId = newId();
	const ext = MIME_TO_EXT[file.type] ?? ".bin";
	const storageKey = `${boardId}/${attachmentId}${ext}`;
	const now = new Date();

	// Write to storage first. If this fails, we do NOT create the DB row.
	const nodeStream = Readable.fromWeb(
		file.stream() as Parameters<typeof Readable.fromWeb>[0],
	);
	await storage.put(storageKey, nodeStream, file.size, file.type);

	// Storage write succeeded — persist the DB record inside a transaction.
	// If the transaction fails the storage object would be permanently orphaned,
	// so we compensate with a best-effort delete before re-throwing.
	try {
		await db.transaction(async (tx) => {
			await tx.insert(attachments).values({
				id: attachmentId,
				cardId: card.id,
				boardId,
				filename: file.name,
				mimeType: file.type,
				sizeBytes: file.size,
				storageKey,
				uploadedBy: user.id,
				createdAt: now,
			});
			await tx
				.update(cards)
				.set({
					attachmentIds: sql`array_append(${cards.attachmentIds}, ${attachmentId})`,
				})
				.where(eq(cards.id, card.id));
		});
	} catch (err) {
		await storage.delete(storageKey).catch(() => {});
		throw err;
	}

	const response: AttachmentResponse = {
		id: attachmentId,
		filename: file.name,
		mimeType: file.type,
		sizeBytes: file.size,
		url: `/api/attachments/${attachmentId}`,
		uploadedBy: user.id,
		createdAt: now,
	};

	eventBus.emit({
		type: "card.attachment.added",
		boardId,
		payload: response,
	});

	return response;
}

// ── deleteAttachment ───────────────────────────────────────────────────────────

export async function deleteAttachment(
	boardId: string,
	cardId: string,
	attachmentId: string,
): Promise<void> {
	// Find attachment scoped to boardId and cardId.
	const [att] = await db
		.select()
		.from(attachments)
		.where(and(
			eq(attachments.id, attachmentId),
			eq(attachments.boardId, boardId),
			eq(attachments.cardId, cardId),
		))
		.limit(1);
	if (!att) {
		throw new AppError("NOT_FOUND", "Attachment not found.");
	}

	const storageKey = att.storageKey;

	// Atomically remove the attachment row and pull its ID from the card.
	await db.transaction(async (tx) => {
		await tx
			.update(cards)
			.set({
				attachmentIds: sql`array_remove(${cards.attachmentIds}, ${attachmentId})`,
			})
			.where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)));
		await tx.delete(attachments).where(eq(attachments.id, att.id));
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
		boardId,
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
	const [att] = await db
		.select()
		.from(attachments)
		.where(eq(attachments.id, attachmentId))
		.limit(1);
	if (!att) {
		throw new AppError("NOT_FOUND", "Attachment not found.");
	}

	// Verify the user has access to the board this attachment belongs to.
	// fetchBoardWithMembership resolves board existence and team membership in
	// a single round-trip, preventing a race where membership is revoked
	// between two separate queries.
	const board = await fetchBoardWithMembership(att.boardId, user.id);
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
