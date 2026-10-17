/** Content and pure helpers for the onboarding guide (`/onboarding`). */

export interface OnboardingTask {
	title: string;
	agent: string;
}

export interface OnboardingExample {
	goal: string;
	refined: string;
	project: string;
	projectWhy: string;
	impact: number;
	effort: number;
	reqs: string[];
	plan: { title: string; note: string; tasks: OnboardingTask[] };
}

export interface OnboardingTip {
	title: string;
	body: string;
}

export const STEPS = [
	'About you',
	'How work is structured',
	'Your team',
	'Goal',
	'Project',
	'Requirements',
	'Plan',
	'Ready',
] as const;

export const LAST_STEP = STEPS.length - 1;

/** Seconds the user has to spend on "How work is structured" before Continue unlocks. */
export const STRUCTURE_READ_SECONDS = 10;

export const TITLES = [
	'Set up your workspace',
	'How work is structured',
	'Your team',
	'Set your first goal',
	'Shape the project',
	'Review requirements',
	'Approve the plan',
	'Your workspace is ready',
] as const;

export const LEVELS = [
	{ name: 'Goal', q: 'why', discussed: true, by: 'Project Manager and Strategist', desc: 'The outcome you want. Measurable, with a date.', eg: 'Cut first response to 2 hours by Q4' },
	{ name: 'Project', q: 'what', discussed: true, by: 'Project Manager and Strategist', desc: 'A body of work that moves a goal.', eg: 'Automated ticket triage' },
	{ name: 'Requirement', q: 'what exactly', discussed: false, by: 'Project Manager', desc: 'One thing the project must deliver. Testable.', eg: 'Classify tickets by topic and urgency' },
	{ name: 'Plan', q: 'how', discussed: false, by: 'Strategist', desc: 'The approach to one requirement. Needs your approval.', eg: 'Classifier trained on past tickets' },
	{ name: 'Task', q: 'who', discussed: false, by: 'Strategist', desc: 'A unit of work an agent picks up.', eg: 'Train and serve the classifier' },
] as const;

/** Goal and project: talked through with the user first, then written up by the Project Manager and Strategist. */
export const DISCUSSED_LEVELS = LEVELS.filter((l) => l.discussed);

/** Requirement, plan and task: created by the Project Manager and Strategist without a discussion. */
export const AUTOMATIC_LEVELS = LEVELS.filter((l) => !l.discussed);

/** The user's part in getting work started: they never write a goal or project themselves. */
export const ROLE = [
	{ title: 'Discuss', body: 'Tell the Project Manager and Strategist what you want to achieve. They ask questions until it is clear.' },
	{ title: 'Review', body: 'They write up the goal and project for you. Read them and ask for as many revisions as you need.' },
	{ title: 'Approve', body: 'Approve when it is right. Nothing is built until you do.' },
] as const;

export const TEAM = [
	{ ini: 'You', name: 'You', role: 'Owner', does: 'Set goals and priorities. Approve every plan.', bg: 'var(--paper-2)', fg: 'var(--fg-1)' },
	{ ini: 'PM', name: 'AI Project Manager', role: 'Defines the work', does: 'Helps you shape goals, projects, and requirements.', bg: 'var(--ink-0)', fg: 'var(--paper-0)' },
	{ ini: 'ST', name: 'AI Project Strategist', role: 'Plans the approach', does: 'Proposes how to meet each requirement and splits it into tasks.', bg: 'var(--accent)', fg: 'var(--paper-0)' },
	{ ini: 'AG', name: 'Agents', role: 'Do the tasks', does: 'developer, researcher, test-planner, reviewer, librarian, and others.', bg: 'var(--ink-3)', fg: 'var(--paper-0)' },
] as const;

export const SPLIT = [
	{ title: 'Hand off to the AI', items: ['Drafting requirements', 'Breaking work into tasks', 'Research and first drafts', 'Status updates'] },
	{ title: 'Keep for yourself', items: ['What the goal is', 'Priorities and trade-offs', 'Approving plans', 'Final say on what ships'] },
] as const;

export const PM_LABELS = ['New to it', "I've managed projects"] as const;
export const AI_LABELS = ['Not yet', 'I already delegate to AI'] as const;
export const PM_DESCS = ['Each concept explained as it comes up.', 'Basics skipped. Kumiaikata specifics noted.'] as const;
export const AI_DESCS = ['We show what to hand off and how to review it.', 'Short notes only where Kumiaikata differs.'] as const;

export const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'] as const;
export const TARGETS = ['This week', 'This month', 'This quarter'] as const;

const task = (title: string, agent: string): OnboardingTask => ({ title, agent });

export const EXAMPLES: OnboardingExample[] = [
	{
		goal: 'Reduce support wait times',
		refined: 'Cut first response on support tickets from 9 hours to 2 by the end of Q4',
		project: 'Automated ticket triage',
		projectWhy: 'Most of the wait is tickets sitting in the wrong queue.',
		impact: 80,
		effort: 6,
		reqs: ['Classify incoming tickets by topic and urgency', 'Route each ticket to the right queue', 'Weekly report on first-response time'],
		plan: {
			title: 'Classifier trained on 12 months of tickets',
			note: 'Start read-only: suggest a queue and let support staff confirm. Switch to automatic routing once accuracy passes 90%.',
			tasks: [
				task('Audit existing ticket labels', 'researcher'),
				task('Train and serve the classifier', 'developer'),
				task('Accuracy check on held-out tickets', 'test-planner'),
				task('Check handling of customer data', 'reviewer-security'),
			],
		},
	},
	{
		goal: 'Move invoicing off spreadsheets',
		refined: 'Issue every invoice from one system, with no manual re-keying, by the end of November',
		project: 'Invoicing pipeline',
		projectWhy: 'Re-keying between three sheets causes most billing errors.',
		impact: 72,
		effort: 5,
		reqs: ['Import open invoices from the current sheets', 'Generate invoices from signed orders', 'Send payment reminders automatically'],
		plan: {
			title: 'One-time import, then generate from orders',
			note: 'Import and reconcile first so nothing is lost. Generation goes live one customer group at a time.',
			tasks: [
				task('Map the three sheet formats', 'researcher'),
				task('Import and reconcile script', 'developer'),
				task('Totals match the sheets to the cent', 'qa-tester'),
				task('Write the import runbook', 'librarian'),
			],
		},
	},
	{
		goal: 'Launch a customer help centre',
		refined: 'Publish a help centre that answers the top 30 questions, live within six weeks',
		project: 'Help centre v1',
		projectWhy: 'Thirty questions make up most of the inbox.',
		impact: 64,
		effort: 4,
		reqs: ['Find the top 30 questions in the inbox', 'Draft and review an article for each', 'Publish with search'],
		plan: {
			title: 'Mine the inbox, then write in batches of ten',
			note: 'Each batch goes to a person for review before it is published.',
			tasks: [
				task('Cluster six months of inbox questions', 'researcher'),
				task('Draft the first ten articles', 'librarian'),
				task('Fact-check against the product', 'reviewer'),
				task('Search across articles', 'developer'),
			],
		},
	},
];

const tip = (title: string, body: string): OnboardingTip => ({ title, body });

/** Contextual notes shown under a step, adjusted to what the user said about themselves. */
export function tipsFor(step: number, novicePM: boolean, noviceAI: boolean): OnboardingTip[] {
	switch (step) {
		case 1:
			return novicePM
				? [tip('Start with the outcome', 'Describe what you want to change, not how to build it. The Project Manager and Strategist turn that into a goal and a project.')]
				: [tip('What differs here', 'You do not write goals or projects. They are drafted from your discussion; you revise and approve. Agents only pick up tasks from approved plans.')];
		case 2:
			return noviceAI ? [tip("Review, don't redo", 'The AI drafts, you correct. Editing a draft is faster than writing from scratch.')] : [];
		case 3:
			return novicePM ? [tip('Outcome, not activity', '"Cut wait times to 2 hours" is a goal. "Build a chatbot" is a project.')] : [];
		case 4:
			return novicePM
				? [
						tip('Priority', 'How soon this matters relative to other work.'),
						tip('Impact and effort', 'Impact (1–100) is how much it moves the goal. Effort (1–10) is how much work it takes. High impact, low effort goes first.'),
						tip('Target', 'The window you aim to finish in: a week, a month, or a quarter.'),
					]
				: [tip('Estimates', "Impact and effort are the PM's estimates. Adjust them on the board any time.")];
		case 5: {
			const tips: OnboardingTip[] = [];
			if (novicePM) tips.push(tip('Requirements are the finish line', 'The project is done when every requirement is met.'));
			if (noviceAI) tips.push(tip('How to review AI output', 'Check that each item is testable, in scope, and does not overlap another. Remove anything you would not pay for.'));
			return tips;
		}
		case 6:
			return novicePM || noviceAI
				? [
						tip('The approval gate', 'Nothing is built until you approve a plan. Ask for changes as often as you need.'),
						tip('Blocked work', 'If no agent has the skill a task needs, it is marked blocked and comes back to you to reassign or drop.'),
					]
				: [tip('Gate and blocked', 'Approving releases tasks to agents. Blocked means no agent covers the capability.')];
		default:
			return [];
	}
}

/** Whether the user may move on from `step` given their answers so far. */
export function canAdvance(
	step: number,
	s: {
		pm: number | null;
		ai: number | null;
		goal: string;
		hasExample: boolean;
		keptCount: number;
		approved: boolean;
		structureRead: boolean;
	},
): boolean {
	switch (step) {
		case 0:
			return s.pm != null && s.ai != null;
		case 1:
			return s.structureRead;
		case 3:
			return s.hasExample && !!s.goal;
		case 5:
			return s.keptCount > 0;
		case 6:
			return s.approved;
		default:
			return true;
	}
}
