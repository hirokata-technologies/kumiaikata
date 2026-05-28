import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

// Mock the storage module before importing the service so the service
// receives the in-memory adapter instead of the real DiskStorage/S3Storage.
vi.mock("../storage/index.js", async () => ({
	storage: (await import("../../test/helpers/mock-storage.js")).mockStorage,
}));

// Mock eventBus so tests don't depend on bus internals.
vi.mock("../events/bus.js", () => ({
	eventBus: { emit: vi.fn(), subscribe: vi.fn(() => vi.fn()) },
}));

import { db } from "../db/client.js";
import { attachments, cards } from "../db/schema/index.js";
import {
	uploadAttachment,
	deleteAttachment,
	streamAttachment,
} from "./attachments.js";
import {
	mockStorage,
	clearMockStorage,
} from "../../test/helpers/mock-storage.js";
import {
	seedUser,
	seedPersonalBoard,
	seedTeamWithBoard,
	seedColumn,
	seedCard,
} from "../../test/helpers/seed.js";
import type { UserSession } from "../http/types.js";

// ── helpers ────────────────────────────────────────────────────────────────────

function makeFile(
	content: string | Uint8Array,
	name: string,
	type: string,
): File {
	const bytes =
		typeof content === "string"
			? new TextEncoder().encode(content)
			: content;
	return new File([bytes], name, { type });
}

function userSession(
	u: { id: string; email: string; name?: string | null },
): UserSession {
	return { id: u.id, email: u.email, name: u.name ?? undefined };
}

// ── setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
	clearMockStorage();
	vi.clearAllMocks();
});

// ── uploadAttachment ───────────────────────────────────────────────────────────

describe("uploadAttachment", () => {
	it("creates an attachment row and updates card.attachmentIds", async () => {
		const user = await seedUser({ email: "alice@test.com" });
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		const file = makeFile("fake png bytes", "photo.png", "image/png");
		const response = await uploadAttachment({
			boardId: board.id,
			cardId: card.id,
			file,
			user: userSession(user),
		});

		// Response shape
		expect(response).toMatchObject({
			id: expect.any(String),
			filename: "photo.png",
			mimeType: "image/png",
			sizeBytes: file.size,
			url: expect.stringContaining("/api/attachments/"),
			uploadedBy: user.id,
			createdAt: expect.any(Date),
		});

		// Storage was called with the correct key pattern
		expect(mockStorage.put).toHaveBeenCalledOnce();
		const [calledKey] = mockStorage.put.mock.calls[0]!;
		expect(calledKey).toMatch(
			new RegExp(`^${board.id}/${response.id}\\.png$`),
		);

		// DB row exists
		const [row] = await db
			.select()
			.from(attachments)
			.where(eq(attachments.id, response.id));
		expect(row).toBeDefined();
		expect(row!.storageKey).toBe(calledKey);
		expect(row!.cardId).toBe(card.id);

		// Card.attachmentIds updated
		const [updatedCard] = await db
			.select()
			.from(cards)
			.where(eq(cards.id, card.id));
		expect(updatedCard!.attachmentIds).toContain(response.id);
	});

	it("throws NOT_FOUND when the card does not exist", async () => {
		const user = await seedUser({ email: "bob@test.com" });
		const board = await seedPersonalBoard(user.id);
		const file = makeFile("data", "file.txt", "text/plain");

		await expect(
			uploadAttachment({
				boardId: board.id,
				cardId: "nonexistent-card-id",
				file,
				user: userSession(user),
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		expect(mockStorage.put).not.toHaveBeenCalled();
	});

	it("throws NOT_FOUND when cardId belongs to a different board", async () => {
		const user = await seedUser({ email: "carol@test.com" });
		const boardA = await seedPersonalBoard(user.id);
		const userB = await seedUser({ email: "dave@test.com" });
		const boardB = await seedPersonalBoard(userB.id);
		const colB = await seedColumn(boardB.id);
		const cardB = await seedCard(boardB.id, colB.id);

		const file = makeFile("data", "file.txt", "text/plain");

		// Supplying boardA.id but a card that belongs to boardB — must be NOT_FOUND
		await expect(
			uploadAttachment({
				boardId: boardA.id,
				cardId: cardB.id,
				file,
				user: userSession(user),
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// ── deleteAttachment ───────────────────────────────────────────────────────────

describe("deleteAttachment", () => {
	async function uploadOne(
		boardId: string,
		cardId: string,
		user: { id: string; email: string; name?: string | null },
	) {
		const file = makeFile("bytes", "img.png", "image/png");
		return uploadAttachment({
			boardId,
			cardId,
			file,
			user: userSession(user),
		});
	}

	it("BUG-004 regression: deletes with correct cardId — row gone and storage deleted", async () => {
		const user = await seedUser({ email: "alice@test.com" });
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		const att = await uploadOne(board.id, card.id, user);

		// Should succeed
		await expect(
			deleteAttachment(board.id, card.id, att.id),
		).resolves.toBeUndefined();

		// DB row is gone
		const rows = await db
			.select()
			.from(attachments)
			.where(eq(attachments.id, att.id));
		expect(rows).toHaveLength(0);

		// attachmentIds no longer contains the id
		const [updatedCard] = await db
			.select()
			.from(cards)
			.where(eq(cards.id, card.id));
		expect(updatedCard!.attachmentIds).not.toContain(att.id);

		// Storage.delete called
		expect(mockStorage.delete).toHaveBeenCalledOnce();
	});

	it("BUG-004 regression: deleteAttachment with wrong cardId returns NOT_FOUND", async () => {
		const user = await seedUser({ email: "alice@test.com" });
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const cardA = await seedCard(board.id, col.id, { title: "Card A" });
		const cardB = await seedCard(board.id, col.id, { title: "Card B" });

		// Upload to cardA
		const att = await uploadOne(board.id, cardA.id, user);

		// Attempt delete scoped to cardB (wrong cardId) — must be NOT_FOUND
		await expect(
			deleteAttachment(board.id, cardB.id, att.id),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		// Attachment row must still exist
		const rows = await db
			.select()
			.from(attachments)
			.where(eq(attachments.id, att.id));
		expect(rows).toHaveLength(1);

		// Storage.delete must NOT have been called
		expect(mockStorage.delete).not.toHaveBeenCalled();
	});

	it("BUG-004 regression: correct boardId but wrong cardId is rejected", async () => {
		const user = await seedUser({ email: "alice@test.com" });
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const cardA = await seedCard(board.id, col.id, { title: "Card A" });

		const att = await uploadOne(board.id, cardA.id, user);

		// Use a made-up cardId that doesn't exist on this board
		await expect(
			deleteAttachment(board.id, "wrong-card-id", att.id),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("throws NOT_FOUND when attachment does not exist", async () => {
		const user = await seedUser({ email: "alice@test.com" });
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		await expect(
			deleteAttachment(board.id, card.id, "nonexistent-attachment-id"),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// ── streamAttachment ───────────────────────────────────────────────────────────

describe("streamAttachment", () => {
	it("returns att metadata and a readable stream containing the original bytes", async () => {
		const user = await seedUser({ email: "alice@test.com" });
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		const content = "stream test content";
		const file = makeFile(content, "notes.txt", "text/plain");
		const att = await uploadAttachment({
			boardId: board.id,
			cardId: card.id,
			file,
			user: userSession(user),
		});

		const result = await streamAttachment(att.id, userSession(user));

		expect(result.att.filename).toBe("notes.txt");
		expect(result.att.mimeType).toBe("text/plain");
		expect(result.att.sizeBytes).toBe(file.size);

		// Drain the stream and compare bytes
		const chunks: Buffer[] = [];
		for await (const chunk of result.stream) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
		}
		const body = Buffer.concat(chunks).toString("utf8");
		expect(body).toBe(content);
	});

	it("throws FORBIDDEN when the user has no access to the board", async () => {
		const owner = await seedUser({ email: "owner@test.com" });
		const board = await seedPersonalBoard(owner.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		const file = makeFile("secret", "secret.txt", "text/plain");
		const att = await uploadAttachment({
			boardId: board.id,
			cardId: card.id,
			file,
			user: userSession(owner),
		});

		// A second user who is not a member of this personal board
		const stranger = await seedUser({ email: "stranger@test.com" });

		await expect(
			streamAttachment(att.id, userSession(stranger)),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("throws NOT_FOUND for a non-existent attachment id", async () => {
		const user = await seedUser({ email: "alice@test.com" });

		await expect(
			streamAttachment("nonexistent-id", userSession(user)),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
