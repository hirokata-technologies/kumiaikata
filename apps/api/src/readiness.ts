import type { MiddlewareHandler } from "hono";

// Process-local readiness. Starts NOT ready: only index.ts calls markReady(),
// after migrate() resolves. Nothing here may default to ready, or production
// would serve requests against a half-migrated schema.
let ready = false;

export function isReady(): boolean {
	return ready;
}

export function markReady(): void {
	ready = true;
}

export function markNotReady(): void {
	ready = false;
}

const RETRY_AFTER_SECONDS = "5";

// Answers 503 for every request except exactly GET /healthz until ready. Must
// be registered after logger and CORS so the 503 still carries CORS headers.
export const readinessGate: MiddlewareHandler = async (c, next) => {
	if (ready || c.req.path === "/healthz") {
		await next();
		return;
	}
	c.header("Retry-After", RETRY_AFTER_SECONDS);
	return c.json(
		{
			error: {
				code: "SERVICE_UNAVAILABLE",
				message: "Service is starting up. Try again shortly.",
			},
		},
		503,
	);
};
