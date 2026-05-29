import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/private";
import { env as pub } from "$env/dynamic/public";
import { sequence } from "@sveltejs/kit/hooks";
import type { Handle, HandleServerError } from "@sveltejs/kit";

Sentry.init({
	dsn: pub.PUBLIC_SENTRY_DSN,
	environment: pub.PUBLIC_ENV ?? "production",
	tracesSampleRate: 1.0,
});

const sessionHandle: Handle = async ({ event, resolve }) => {
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
	} catch (err) {
		// AbortError is expected when the 3-second timeout fires — don't report it.
		if (!(err instanceof Error && err.name === "AbortError")) {
			Sentry.captureException(err, {
				extra: { url: event.url.pathname },
			});
		}
		event.locals.user = null;
		event.locals.session = null;
	} finally {
		clearTimeout(timeout);
	}
	return resolve(event);
};

export const handle: Handle = sequence(Sentry.sentryHandle(), sessionHandle);

export const handleError: HandleServerError = ({ error, event, status, message }) => {
	// 4xx errors are client mistakes — don't pollute Sentry with them.
	if (status < 500) return { message };
	const eventId = Sentry.captureException(error, {
		extra: { url: event.url.pathname, status, message },
	});
	return { message, eventId };
};
