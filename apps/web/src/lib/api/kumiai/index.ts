export type {
	KumiaiStats,
	KumiaiSearchResults,
	RecentProject,
	CreateGoalInput,
	UpdateGoalInput,
	CreateProjectInput,
	UpdateProjectInput,
	CreateRequirementInput,
	UpdateRequirementInput,
	CreatePlanInput,
	UpdatePlanInput,
	CreateTaskInput,
	UpdateTaskInput,
} from './types.js';

export { listGoals, getGoal, createGoal, updateGoal, deleteGoal } from './goals.js';
// Re-exported under a `Kumiai`-qualified name: the board product's own
// `apps/web/src/lib/api/index.ts` already exports `listProjects`/`createProject`/
// `updateProject`/`deleteProject` (board "projects" = colour tags, an unrelated
// entity). `export *` re-export semantics let an explicit local export silently win
// over a star-exported name of the same identifier — no build error, the Kumiaikata
// functions just become unreachable through `$lib/api`. Renaming here, at the barrel
// seam, keeps `kumiai/projects.ts` itself matching the plain `listProjects` naming
// used by every sibling module.
export {
	listProjects as listKumiaiProjects,
	getProject as getKumiaiProject,
	createProject as createKumiaiProject,
	updateProject as updateKumiaiProject,
	deleteProject as deleteKumiaiProject,
} from './projects.js';
export type { ListProjectsParams } from './projects.js';
export {
	listRequirements,
	getRequirement,
	createRequirement,
	updateRequirement,
	deleteRequirement,
} from './requirements.js';
export { listPlans, getPlan, createPlan, updatePlan, deletePlan } from './plans.js';
export { listTasks, getTask, createTask, updateTask, deleteTask } from './tasks.js';
export { getStats, searchWorkspace, listRecentProjects, touchRecentProject } from './shell.js';
