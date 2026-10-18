import rootConfig from '../../eslint.config.js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(...rootConfig, {
	files: ['src/**/*.ts'],
	languageOptions: {
		globals: globals.node,
		parserOptions: {
			projectService: {
				// tsconfig.json excludes *.test.ts (kept out of the build), so the project
				// service can't place them in the real project. Fall back to a single-file
				// default program for those instead of failing to parse them at all.
				allowDefaultProject: [
					'src/*.test.ts',
					'src/agents/*.test.ts',
					'src/auth/*.test.ts',
					'src/events/*.test.ts',
					'src/http/*.test.ts',
					'src/mcp/*.test.ts',
					'src/ordering/*.test.ts',
					'src/routes/*.test.ts',
					'src/routes/kumiai/*.test.ts',
					'src/services/*.test.ts',
					'src/storage/*.test.ts',
				],
				maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 30,
			},
			tsconfigRootDir: import.meta.dirname,
		},
	},
});
