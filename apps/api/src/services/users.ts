import { Readable } from "node:stream";
import { AppError } from "../http/error.js";
import { storage } from "../storage/index.js";
import { env } from "../env.js";
import type { UserSession } from "../http/types.js";

// ── MIME allowlist ─────────────────────────────────────────────────────────────

export const AVATAR_ALLOWED_MIMES = new Set([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
]);

// ── Size cap ───────────────────────────────────────────────────────────────────

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB

// ── Storage keys ──────────────────────────────────────────────────────────────

// Single fixed key per user — uploading a new avatar overwrites the prior one.
const avatarKey = (userId: string) => `avatars/${userId}`;

// Companion key storing the server-validated MIME type for the avatar.
const avatarMimeKey = (userId: string) => `avatars/${userId}.mime`;

// ── uploadUserAvatar ───────────────────────────────────────────────────────────

export async function uploadUserAvatar({
	user,
	file,
}: {
	user: UserSession;
	file: File;
}): Promise<{ imageUrl: string }> {
	// Defensive MIME re-assertion (route validates first).
	if (!AVATAR_ALLOWED_MIMES.has(file.type)) {
		throw new AppError(
			"UNSUPPORTED_MEDIA_TYPE",
			"Please choose a JPEG, PNG, GIF, or WebP image.",
		);
	}

	const storageKey = avatarKey(user.id);
	const mimeKey = avatarMimeKey(user.id);

	// Convert the Web ReadableStream to a Node.js Readable for the storage adapter.
	const nodeStream = Readable.fromWeb(
		file.stream() as Parameters<typeof Readable.fromWeb>[0],
	);
	await storage.put(storageKey, nodeStream, file.size, file.type);

	// Store the server-validated MIME type as a companion key so the GET handler
	// can read it without trusting any client-supplied query parameter.
	const mimeBytes = Buffer.byteLength(file.type);
	await storage.put(mimeKey, Readable.from([file.type]), mimeBytes, "text/plain");

	// The ?v= cache-buster ensures browsers re-fetch after an avatar update.
	// No MIME type is embedded in the URL — it is read from server-side storage.
	const imageUrl = `${env.BETTER_AUTH_URL}/api/users/${user.id}/avatar?v=${Date.now()}`;

	return { imageUrl };
}

// ── streamUserAvatar ───────────────────────────────────────────────────────────

/**
 * Read the stored MIME type for a user's avatar from the companion key.
 * Falls back to "application/octet-stream" if the companion key is missing
 * (e.g. avatars uploaded before this fix was deployed).
 */
async function readAvatarMime(userId: string): Promise<string> {
	try {
		const mimeStream = await storage.get(avatarMimeKey(userId));
		const chunks: Buffer[] = [];
		for await (const chunk of mimeStream) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
		}
		const mime = Buffer.concat(chunks).toString("utf8").trim();
		// Only return the value if it is a recognised avatar MIME type.
		return AVATAR_ALLOWED_MIMES.has(mime) ? mime : "application/octet-stream";
	} catch {
		return "application/octet-stream";
	}
}

export async function streamUserAvatar(
	userId: string,
): Promise<{ stream: Readable; mimeType: string }> {
	const storageKey = avatarKey(userId);

	let stream: Readable;
	try {
		stream = await storage.get(storageKey);
	} catch (err) {
		if (err instanceof AppError && err.code === "NOT_FOUND") {
			throw err;
		}
		// Re-throw NOT_FOUND for storage misses; surface others as-is.
		throw err;
	}

	const mimeType = await readAvatarMime(userId);

	return { stream, mimeType };
}
