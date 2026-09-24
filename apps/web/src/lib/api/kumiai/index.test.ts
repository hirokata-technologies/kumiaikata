import { describe, expect, it, vi } from 'vitest';

// Only needs the module graph to resolve, not a real API call — the $env virtual
// module still has to be mocked for `../client.js` to import cleanly under vitest.
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_API_URL: 'https://api.test' } }));

describe('kumiai barrel', () => {
	it('re-exports the project functions under Kumiai-qualified names, identical to the module', async () => {
		const projectsModule = await import('./projects.js');
		const barrel = await import('./index.js');

		expect(barrel.listKumiaiProjects).toBe(projectsModule.listProjects);
		expect(barrel.getKumiaiProject).toBe(projectsModule.getProject);
		expect(barrel.createKumiaiProject).toBe(projectsModule.createProject);
		expect(barrel.updateKumiaiProject).toBe(projectsModule.updateProject);
		expect(barrel.deleteKumiaiProject).toBe(projectsModule.deleteProject);
	});

	it('does not shadow the board product\'s listProjects/createProject/updateProject/deleteProject when spread into $lib/api', async () => {
		// apps/web/src/lib/api/index.ts does `export * from './kumiai/index.js'` alongside
		// its existing `export { listProjects, createProject, updateProject, deleteProject }
		// from './projects.js'` (board colour-tag projects). Export-star semantics let the
		// explicit local export win silently on a name collision, which is exactly why the
		// Kumiaikata versions are re-exported under the `Kumiai`-qualified names asserted
		// above rather than the plain ones.
		const api = await import('../index.js');
		const board = await import('../projects.js');

		expect(api.listProjects).toBe(board.listProjects);
		expect(api.createProject).toBe(board.createProject);
		expect(api.updateProject).toBe(board.updateProject);
		expect(api.deleteProject).toBe(board.deleteProject);
	});
});
