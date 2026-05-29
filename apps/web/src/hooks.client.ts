import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/public";
import type { HandleClientError } from "@sveltejs/kit";

Sentry.init({
	dsn: env.PUBLIC_SENTRY_DSN,
	environment: env.PUBLIC_ENV ?? "production",
	tracesSampleRate: 1.0,
	integrations: [
		Sentry.browserTracingIntegration(),
		// Session replay on errors only — no continuous recording
		Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
	],
	replaysSessionSampleRate: 0,
	replaysOnErrorSampleRate: 1.0,
});

export const handleError: HandleClientError = ({ error, event, status, message }) => {
	const eventId = Sentry.captureException(error, {
		extra: { url: event.url.pathname, status, message },
	});
	return { message, eventId };
};
