import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the storage module before importing the service so the service
// receives the in-memory adapter instead of the real DiskStorage/S3Storage.
vi.mock("../storage/index.js", async () => ({
	storage: (await import("../../test/helpers/mock-storage.js")).mockStorage,
}));

import { mockBetterAuth, setCurrentUser } from "../../test/helpers/mock-session.js";
import { apiRequest, apiRequestRaw } from "../../test/helpers/request.js";
import { clearMockStorage, mockStorage } from "../../test/helpers/mock-storage.js";
import { seedUser } from "../../test/helpers/seed.js";
import { AppError } from "../http/error.js";

mockBetterAuth();

// eslint-disable-next-line import/first
import app from "../app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
	clearMockStorage();
	vi.clearAllMocks();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeImageForm(
	content = "fake-image-bytes",
	filename = "photo.jpg",
	mimeType = "image/jpeg",
): FormData {
	const form = new FormData();
	form.append("file", new Blob([content], { type: mimeType }), filename);
	return form;
}

async function uploadAvatarViaRoute(
	userId: string,
	content = "fake-image-bytes",
	mimeType = "image/jpeg",
): Promise<{ imageUrl: string }> {
	const form = makeImageForm(content, "photo.jpg", mimeType);
	const res = await apiRequestRaw(
		new Request("http://localhost/api/users/me/avatar", {
			method: "POST",
			body: form,
		}),
	);
	if (res.status !== 200) {
		throw new Error(`Upload failed with status ${res.status}`);
	}
	return res.json() as Promise<{ imageUrl: string }>;
}

// ── POST /api/users/me/avatar ─────────────────────────────────────────────────

describe("POST /api/users/me/avatar", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("POST", "/api/users/me/avatar");
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 422 when form has no file field", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		const form = new FormData();
		form.append("other", "not-a-file");

		const res = await apiRequestRaw(
			new Request("http://localhost/api/users/me/avatar", {
				method: "POST",
				body: form,
			}),
		);
		expect(res.status).toBe(422);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});

	it("returns 413 when file exceeds 5 MB", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		// 6 MB, above the 5 MB avatar limit
		const oversizedContent = "x".repeat(6 * 1024 * 1024);
		const form = makeImageForm(oversizedContent, "big.jpg", "image/jpeg");

		const res = await apiRequestRaw(
			new Request("http://localhost/api/users/me/avatar", {
				method: "POST",
				body: form,
			}),
		);
		expect(res.status).toBe(413);
		const body = await res.json() as { error: { code: string; message: string } };
		expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
		expect(body.error.message).toBe("Photo must be 5 MB or smaller.");
	});

	it("returns 415 when MIME type is not in the allowlist", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		const form = makeImageForm("data", "file.pdf", "application/pdf");

		const res = await apiRequestRaw(
			new Request("http://localhost/api/users/me/avatar", {
				method: "POST",
				body: form,
			}),
		);
		expect(res.status).toBe(415);
		const body = await res.json() as { error: { code: string; message: string } };
		expect(body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
		expect(body.error.message).toBe(
			"Please choose a JPEG, PNG, GIF, or WebP image.",
		);
	});

	it("returns 200 with imageUrl containing /api/users/<id>/avatar?v= on success", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		const body = await uploadAvatarViaRoute(user.id);

		expect(typeof body.imageUrl).toBe("string");
		expect(body.imageUrl).toContain(`/api/users/${user.id}/avatar?v=`);
		expect(body.imageUrl).toContain("&t=image%2Fjpeg");
	});

	it("overwrites the prior avatar on second upload (fixed storage key per user)", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		await uploadAvatarViaRoute(user.id, "first-image");
		await uploadAvatarViaRoute(user.id, "second-image");

		// The storage key is fixed per user: avatars/<userId>
		const stored = mockStorage.getStored(`avatars/${user.id}`);
		expect(stored).toBeDefined();
		expect(stored?.toString()).toBe("second-image");
		// put should have been called twice, both times with the same key
		expect(mockStorage.put).toHaveBeenCalledTimes(2);
		const [call1, call2] = [
			(mockStorage.put as ReturnType<typeof vi.fn>).mock.calls[0],
			(mockStorage.put as ReturnType<typeof vi.fn>).mock.calls[1],
		];
		expect(call1?.[0]).toBe(`avatars/${user.id}`);
		expect(call2?.[0]).toBe(`avatars/${user.id}`);
	});
});

// ── GET /api/users/:userId/avatar ─────────────────────────────────────────────

describe("GET /api/users/:userId/avatar", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("GET", "/api/users/someuserid/avatar");
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 404 when user has no avatar in storage", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		// Simulate storage throwing NOT_FOUND for a missing avatar
		mockStorage.get.mockRejectedValueOnce(
			new AppError("NOT_FOUND", "Avatar not found."),
		);

		const res = await apiRequest("GET", `/api/users/${user.id}/avatar`);
		expect(res.status).toBe(404);
	});

	it("streams the avatar with the correct Content-Type from the t query param", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		const imageContent = "fake-png-bytes";
		await uploadAvatarViaRoute(user.id, imageContent, "image/png");

		// GET with the MIME type encoded as the t param
		const res = await apiRequest(
			"GET",
			`/api/users/${user.id}/avatar?t=${encodeURIComponent("image/png")}`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/png");
		expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");

		const body = await res.text();
		expect(body).toBe(imageContent);
	});

	it("defaults Content-Type to application/octet-stream when t param is absent", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		await uploadAvatarViaRoute(user.id, "bytes", "image/jpeg");

		const res = await apiRequest("GET", `/api/users/${user.id}/avatar`);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
	});
});
