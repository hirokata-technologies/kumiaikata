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
		// renderMd escapes HTML entities before applying transforms, so {@html} is safe here
		files: ['src/**/ChatPanel.svelte'],
		rules: {
			'svelte/no-at-html-tags': 'off',
		},
	},
);
