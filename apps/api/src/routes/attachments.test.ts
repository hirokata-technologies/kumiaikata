import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the storage module before importing the service so the service
// receives the in-memory adapter instead of the real DiskStorage/S3Storage.
vi.mock("../storage/index.js", async () => ({
	storage: (await import("../../test/helpers/mock-storage.js")).mockStorage,
}));

// Mock eventBus so tests don't depend on bus internals.
vi.mock("../events/bus.js", () => ({
	eventBus: { emit: vi.fn(), subscribe: vi.fn(() => vi.fn()) },
}));

import { mockBetterAuth, setCurrentUser } from "../../test/helpers/mock-session.js";
import { apiRequest, apiRequestRaw } from "../../test/helpers/request.js";
import { clearMockStorage } from "../../test/helpers/mock-storage.js";
import {
	seedUser,
	seedPersonalBoard,
	seedColumn,
	seedCard,
} from "../../test/helpers/seed.js";

mockBetterAuth();

// eslint-disable-next-line import/first
import app from "../app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
	clearMockStorage();
	vi.clearAllMocks();
});

// ── helper: upload an attachment through the real route ───────────────────────

async function uploadAttachmentViaRoute(
	boardId: string,
	cardId: string,
	content = "hello",
	filename = "hello.txt",
	mimeType = "text/plain",
): Promise<{ id: string; mimeType: string }> {
	const form = new FormData();
	form.append("file", new Blob([content], { type: mimeType }), filename);
	const res = await apiRequestRaw(
		new Request(
			`http://localhost/api/boards/${boardId}/cards/${cardId}/attachments`,
			{ method: "POST", body: form },
		),
	);
	if (res.status !== 201) {
		throw new Error(`Upload failed with status ${res.status}`);
	}
	return res.json() as Promise<{ id: string; mimeType: string }>;
}

// ── GET /api/attachments/:attachmentId ────────────────────────────────────────

describe("GET /api/attachments/:attachmentId", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("GET", "/api/attachments/fakeattachmentid");
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 404 when attachment does not exist", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/attachments/nonexistent-id");
		expect(res.status).toBe(404);
	});

	it("returns 403 when a non-member tries to access an attachment", async () => {
		const owner = await seedUser({ email: "owner@test.com" });
		const stranger = await seedUser({ email: "stranger@test.com" });
		const board = await seedPersonalBoard(owner.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		// Upload as owner
		setCurrentUser({ id: owner.id, email: owner.email });
		const att = await uploadAttachmentViaRoute(board.id, card.id);

		// Attempt to stream as stranger
		setCurrentUser({ id: stranger.id, email: stranger.email });
		const res = await apiRequest("GET", `/api/attachments/${att.id}`);
		expect(res.status).toBe(403);
	});

	it("returns 200 with correct Content-Type header and file body", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const content = "stream test content";
		const att = await uploadAttachmentViaRoute(
			board.id,
			card.id,
			content,
			"notes.txt",
			"text/plain",
		);

		const res = await apiRequest("GET", `/api/attachments/${att.id}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/plain");

		const body = await res.text();
		expect(body).toBe(content);
	});
});
