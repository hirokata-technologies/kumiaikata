import rootConfig from '../../eslint.config.js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(...rootConfig, {
	files: ['src/**/*.ts'],
	languageOptions: {
		globals: globals.node,
		parserOptions: {
			projectService: true,
			tsconfigRootDir: import.meta.dirname,
		},
	},
});
