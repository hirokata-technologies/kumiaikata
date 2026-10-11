import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig(({ mode }) => {
	// The Hono backend (@kata/api) validates `process.env` directly. In production
	// the platform provides it; in `vite dev` / `vite preview` expose apps/web/.env
	// (and .env.local) there too, without overriding real environment variables.
	for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
		process.env[key] ??= value;
	}

	return {
		build: {
			sourcemap: true,
		},
		ssr: {
			// Keep the backend's heavy runtime libraries out of the server bundle: they
			// are installed in the runtime image (see the root Dockerfile) and Better
			// Auth must resolve its own dependencies from node_modules.
			external: ['better-auth'],
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
	};
});
