/**
 * Thin HTTP wrapper around the Kata REST API.
 *
 * Auth: passes KATA_SESSION_COOKIE as a Cookie header on every request so the
 * API's Better Auth session middleware can identify the caller. Set this env
 * var to the full cookie string, e.g.:
 *   KATA_SESSION_COOKIE=better-auth.session_token=<token>
 */

const API_URL = (process.env["KATA_API_URL"] ?? "http://localhost:3000").replace(/\/$/, "");
const SESSION_COOKIE = process.env["KATA_SESSION_COOKIE"] ?? "";

if (!SESSION_COOKIE) {
	console.error("[kata-mcp] KATA_SESSION_COOKIE is not set — all requests will be unauthenticated.");
}

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly body: unknown,
	) {
		const msg = typeof body === "object" && body !== null && "message" in body
			? String((body as { message: unknown }).message)
			: `HTTP ${status.toString()}`;
		super(msg);
	}
}

export async function apiRequest<T = unknown>(
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const url = `${API_URL}${path}`;
	const headers: Record<string, string> = {
		"Cookie": SESSION_COOKIE,
		"Content-Type": "application/json",
	};

	const res = await fetch(url, {
		method,
		headers,
		...(body !== undefined && { body: JSON.stringify(body) }),
	});

	let json: unknown;
	const contentType = res.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		json = await res.json();
	} else {
		json = null;
	}

	if (!res.ok) {
		throw new ApiError(res.status, json);
	}

	return json as T;
}

export const get = <T = unknown>(path: string) => apiRequest<T>("GET", path);
export const post = <T = unknown>(path: string, body: unknown) => apiRequest<T>("POST", path, body);
export const patch = <T = unknown>(path: string, body: unknown) => apiRequest<T>("PATCH", path, body);
export const del = (path: string) => apiRequest("DELETE", path);
