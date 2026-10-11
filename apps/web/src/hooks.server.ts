import * as Sentry from "@sentry/sveltekit";
import { env as pub } from "$env/dynamic/public";
import { sequence } from "@sveltejs/kit/hooks";
import type { Handle, HandleServerError } from "@sveltejs/kit";

Sentry.init({
	dsn: pub.PUBLIC_SENTRY_DSN,
	environment: pub.PUBLIC_ENV ?? "production",
	tracesSampleRate: 1.0,
});

/**
 * Paths served entirely by the Hono app (it authenticates each request itself), so
 * the session lookup here would only be a redundant database round trip.
 */
function skipsSession(pathname: string): boolean {
	return pathname === "/healthz" || pathname === "/api" || pathname.startsWith("/api/");
}

const sessionHandle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.session = null;
	if (skipsSession(event.url.pathname)) return resolve(event);

	try {
		// In-process lookup: the auth instance lives in this same server, so there is
		// no network hop (and no cookie forwarding) between the page and Better Auth.
		const { auth } = await import("@kata/api");
		const data = await auth.api.getSession({ headers: event.request.headers });
		event.locals.user = data?.user ?? null;
		event.locals.session = data?.session ?? null;
	} catch (err) {
		Sentry.captureException(err, {
			extra: { url: event.url.pathname },
		});
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
