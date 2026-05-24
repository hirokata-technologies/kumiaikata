import type { Handle } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";

export const handle: Handle = async ({ event, resolve }) => {
	const cookie = event.request.headers.get("cookie") ?? "";
	try {
		const res = await fetch(`${env.API_URL}/api/auth/get-session`, {
			headers: { cookie },
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
	}
	return resolve(event);
};
