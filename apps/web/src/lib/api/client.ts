export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
	) {
		super(message);
		this.name = 'ApiError';
	}
}

export async function apiFetch<T = unknown>(
	path: string,
	init: RequestInit = {},
): Promise<T> {
	// The API is served by this same app, so paths stay relative (same origin).
	const url = path;
	const headers = new Headers(init.headers);
	if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
		headers.set('content-type', 'application/json');
	}
	headers.set('accept', 'application/json');

	const res = await fetch(url, { ...init, headers, credentials: 'same-origin' });

	if (res.status === 401) {
		if (typeof window !== 'undefined') {
			window.location.assign('/login?error=UNAUTHENTICATED');
		}
		throw new ApiError(401, 'UNAUTHENTICATED', 'Session expired.');
	}
	if (res.status === 204) return null as T;
	if (!res.ok) {
		let code = 'UNKNOWN';
		let message = res.statusText || 'Request failed';
		try {
			const body = (await res.json()) as { error?: { code?: string; message?: string } };
			if (body?.error?.code) code = body.error.code;
			if (body?.error?.message) message = body.error.message;
		} catch {
			/* keep defaults */
		}
		throw new ApiError(res.status, code, message);
	}
	return (await res.json()) as T;
}
