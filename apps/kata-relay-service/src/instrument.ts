import * as Sentry from "@sentry/node";

// Sentry must be initialized before any other imports when loaded via
// `node --import ./dist/instrument.js` so that OpenTelemetry can patch
// built-in modules (http, pg, etc.) before they are first required.
Sentry.init({
	dsn: process.env.SENTRY_DSN,
	environment: process.env.NODE_ENV ?? "development",
	tracesSampleRate: 1.0,
	// Capture console.error calls as breadcrumbs
	integrations: [Sentry.captureConsoleIntegration({ levels: ["error", "warn"] })],
});
