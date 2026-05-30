import { Readable } from "node:stream";
import { Hono } from "hono";
import { requireSession } from "../auth/middleware.js";
import { validateId } from "../http/validate.js";
import { ok } from "../http/responders.js";
import { AppError } from "@kata/http";
import type { AppVariables } from "@kata/http";
import {
	uploadUserAvatar,
	streamUserAvatar,
	MAX_AVATAR_BYTES,
	AVATAR_ALLOWED_MIMES,
} from "../services/users.js";

const r = new Hono<{ Variables: AppVariables }>();

// POST /api/users/me/avatar
// Authenticated multipart upload: store the avatar and return its served URL.
r.post("/me/avatar", requireSession, async (c) => {
	const form = await c.req.parseBody({ all: false });
	const file = form["file"];
	if (!(file instanceof File)) {
		throw new AppError("VALIDATION_ERROR", 'Field "file" is required.');
	}
	if (file.size > MAX_AVATAR_BYTES) {
		throw new AppError("PAYLOAD_TOO_LARGE", "Photo must be 5 MB or smaller.");
	}
	if (!AVATAR_ALLOWED_MIMES.has(file.type)) {
		throw new AppError(
			"UNSUPPORTED_MEDIA_TYPE",
			"Please choose a JPEG, PNG, GIF, or WebP image.",
		);
	}

	const { imageUrl } = await uploadUserAvatar({ user: c.get("user"), file });
	return ok(c, { imageUrl });
});

// GET /api/users/:userId/avatar
// Authenticated streaming endpoint: read avatar from storage and stream back.
r.get("/:userId/avatar", requireSession, async (c) => {
	const userId = validateId(c.req.param("userId"), "userId");
	const { stream, mimeType } = await streamUserAvatar(userId);
	c.header("Content-Type", mimeType);
	c.header("Cache-Control", "private, max-age=300");
	return c.body(Readable.toWeb(stream) as ReadableStream);
});

export default r;
