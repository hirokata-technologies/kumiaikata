// The API is served by the web app (same origin). global-setup.ts starts the built app on
// this port (3100 by default, so it never collides with the `pnpm dev` server on 3000).
export const PORT = Number(process.env.KATA_IT_PORT ?? 3100);
export const API = `http://localhost:${PORT}`;

export async function apiGet(
	path: string,
	headers?: Record<string, string>,
): Promise<Response> {
	return fetch(`${API}${path}`, { headers });
}

export async function apiPost(
	path: string,
	body: unknown,
	headers?: Record<string, string>,
): Promise<Response> {
	return fetch(`${API}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}

export async function apiPatch(
	path: string,
	body: unknown,
	headers?: Record<string, string>,
): Promise<Response> {
	return fetch(`${API}${path}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}

export async function apiDelete(
	path: string,
	headers?: Record<string, string>,
): Promise<Response> {
	return fetch(`${API}${path}`, { method: "DELETE", headers });
}
