// The API is served by the web app (same origin).
export const API = "http://localhost:3000";

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
