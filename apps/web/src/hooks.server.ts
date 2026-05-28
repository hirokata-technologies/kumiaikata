import type { Handle } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";

export const handle: Handle = async ({ event, resolve }) => {
	const cookie = event.request.headers.get("cookie") ?? "";
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 3000);
	try {
		const res = await fetch(`${env.API_URL}/api/auth/get-session`, {
			headers: { cookie },
			signal: controller.signal,
		});
		if (res.ok) {
			const data = await res.json();
			event.locals.user = data?.user ?? null;
			event.locals.session = data?.session ?? null;
		} else {
			event.locals.user = null;
			event.locals.session = null;
		}
	} catch {
		event.locals.user = null;
		event.locals.session = null;
	} finally {
		clearTimeout(timeout);
	}
	return resolve(event);
};
