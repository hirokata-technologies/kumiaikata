import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig({
	build: {
		sourcemap: true,
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		sentryVitePlugin({
			org: 'hirokata',
			project: 'kata-web',
			// SENTRY_AUTH_TOKEN must be set in the build environment.
			// Plugin is a no-op when the token is absent (e.g. local dev without upload).
			authToken: process.env.SENTRY_AUTH_TOKEN,
			telemetry: false,
		}),
	],
});
