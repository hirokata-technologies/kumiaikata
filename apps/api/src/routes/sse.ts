import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { requireSession, loadBoardAccess } from "../auth/middleware.js";
import { eventBus } from "../events/bus.js";
import { auth } from "../auth/better-auth.js";
import type { AppVariables } from "../http/types.js";

const r = new Hono<{ Variables: AppVariables }>();

r.get(
	"/:boardId/events",
	requireSession,
	loadBoardAccess,
	async (c) => {
		const boardId = String(c.get("board")._id);
		return streamSSE(c, async (stream) => {
			const queue: string[] = [];
			let resolveNext: (() => void) | null = null;

			const unsubscribe = eventBus.subscribe(boardId, (event) => {
				try {
					queue.push(JSON.stringify(event.payload));
					// tag the message with the event type
					queue.push(event.type);
					resolveNext?.();
					resolveNext = null;
				} catch (err) {
					console.error("[SSE] Failed to enqueue event:", err);
				}
			});

			// Heartbeat every 15s so proxies don't drop the connection.
			const heartbeat = setInterval(() => {
				stream.writeSSE({ event: "ping", data: "" }).catch(() => {});
			}, 15_000);

			// Session expiry watchdog: re-check session every 10s.
			const sessionWatch = setInterval(async () => {
				const s = await auth.api.getSession({ headers: c.req.raw.headers });
				if (!s) {
					await stream
						.writeSSE({
							event: "error",
							data: JSON.stringify({ code: "UNAUTHENTICATED" }),
						})
						.catch(() => {});
					stream.close();
				}
			}, 10_000);

			stream.onAbort(() => {
				unsubscribe();
				clearInterval(heartbeat);
				clearInterval(sessionWatch);
			});

			try {
				while (true) {
					while (queue.length >= 2) {
						const data = queue.shift()!;
						const type = queue.shift()!;
						await stream.writeSSE({ event: type, data });
					}
					await new Promise<void>((resolve) => {
						resolveNext = resolve;
					});
				}
			} finally {
				unsubscribe();
				clearInterval(heartbeat);
				clearInterval(sessionWatch);
			}
		});
	},
);

export default r;
