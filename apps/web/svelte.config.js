import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter(),
		// MCP clients are not browsers: their form-encoded OAuth POSTs (/api/auth/oauth2/*)
		// carry no Origin header, so SvelteKit's origin check would answer 403. Better Auth
		// and Hono run their own origin checks on the routes they serve.
		csrf: { trustedOrigins: ['*'] }
	}
};

export default config;
