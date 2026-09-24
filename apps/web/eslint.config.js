import rootConfig from '../../eslint.config.js';
import tseslint from 'typescript-eslint';
import sveltePlugin from 'eslint-plugin-svelte';
import globals from 'globals';

export default tseslint.config(
	...rootConfig,
	...sveltePlugin.configs['flat/recommended'],
	{
		files: ['src/**/*.ts', 'src/**/*.svelte'],
		languageOptions: {
			globals: globals.browser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.svelte'],
			},
		},
	},
	{
		files: ['src/**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: tseslint.parser,
			},
		},
		rules: {
			// Only needed when using a custom SvelteKit base path
			'svelte/no-navigation-without-resolve': 'off',
		},
	},
	{
		// eslint-plugin-svelte's base config parses *.svelte.ts/*.svelte.js files with
		// svelte-eslint-parser (for the rare case they contain a template), but these are
		// plain TS/JS rune modules with no template. Left as-is, svelte-eslint-parser falls
		// back to espree for the script content and can't parse TS syntax (`export type ...`,
		// `interface ...`), so give them back the TS parser like every other .ts file.
		files: ['src/**/*.svelte.ts', 'src/**/*.svelte.js'],
		languageOptions: {
			parser: tseslint.parser,
		},
	},
	{
		// renderMd/renderDescMd escape HTML entities before applying markdown
		// transforms, so {@html} is safe here
		files: ['src/**/ChatPanel.svelte', 'src/**/CardModal.svelte'],
		rules: {
			'svelte/no-at-html-tags': 'off',
		},
	},
);
