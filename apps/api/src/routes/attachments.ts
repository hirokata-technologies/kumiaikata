import { Readable } from "node:stream";
import { Hono } from "hono";
import { requireSession } from "../auth/middleware.js";
import { validateObjectId } from "../http/validate.js";
import type { AppVariables } from "../http/types.js";
import { streamAttachment } from "../services/attachments.js";

const r = new Hono<{ Variables: AppVariables }>();

// GET /api/attachments/:attachmentId
// Authenticated download: stream the file with correct Content-Type headers.
r.get("/:attachmentId", requireSession, async (c) => {
	const user = c.get("user");
	const attachmentId = validateObjectId(c.req.param("attachmentId"), "attachmentId");
	const { att, stream } = await streamAttachment(
		attachmentId,
		user,
	);

	c.header("Content-Type", att.mimeType);
	c.header(
		"Content-Disposition",
		`inline; filename="${encodeURIComponent(att.filename)}"`,
	);
	c.header("Content-Length", String(att.sizeBytes));

	// Convert Node.js Readable to a Web ReadableStream, which Hono accepts.
	return c.body(Readable.toWeb(stream) as ReadableStream);
});

export default r;
