import { Marked } from 'marked';
import type { PriorityLevel, ProjectPriority } from './types.js';

/**
 * Roadmap planning conversations: the user talks to the Project Manager, who brings in
 * the Strategist, and ends by proposing a goal and its projects (the `propose_roadmap`
 * tool call, see apps/agents/src/kata_agents/roadmap.py). The proposal is a draft: the
 * user edits it and creates the items themselves.
 */

export type PlanningIntent =
	| { kind: 'goal'; workspaceId?: string }
	| { kind: 'project'; goalId: string };

export const PROPOSE_ROADMAP = 'propose_roadmap';

export const AGENT_LABEL: Record<string, string> = {
	project_manager: 'Project Manager',
	strategist: 'Strategist'
};

export function agentLabel(author: string): string {
	return AGENT_LABEL[author] ?? author.replace(/_/g, ' ');
}

// ── Transcript ────────────────────────────────────────────────────────────────

export type Entry =
	| { kind: 'user'; id: string; text: string }
	| { kind: 'agent'; id: string; author: string; text: string }
	| { kind: 'handoff'; id: string; from: string; to: string }
	| { kind: 'proposal'; id: string; version: number }
	| { kind: 'error'; id: string; message: string };

/** One event of the /api/agents/sessions/:id/messages stream. */
export type StreamEvent =
	| { event: 'message'; data: { id: string; author: string; text: string } }
	| { event: 'tool_call'; data: { eventId: string; author: string; name: string; args: unknown } }
	| { event: 'tool_result'; data: { eventId: string; author: string; name: string } }
	| { event: 'handoff'; data: { from: string; to: string } }
	| { event: 'error'; data: { code: string; message: string } }
	| { event: 'done'; data: unknown };

export interface Transcript {
	entries: Entry[];
	/** The agent currently speaking, or null between turns. */
	speaker: string | null;
	proposal: Proposal | null;
	/** Bumped on every proposal so the card can tell a revised draft from the last one. */
	proposalVersion: number;
}

export const emptyTranscript = (): Transcript => ({
	entries: [],
	speaker: null,
	proposal: null,
	proposalVersion: 0
});

/** Folds one stream event into the transcript. Pure, so the whole flow is unit-testable. */
export function applyStreamEvent(t: Transcript, e: StreamEvent): Transcript {
	switch (e.event) {
		case 'message': {
			if (e.data.author === 'user') return t;
			const entries = [...t.entries];
			const last = entries.at(-1);
			// A repeated event id is the same message arriving again (or growing): replace it.
			if (last?.kind === 'agent' && last.id === e.data.id) {
				entries[entries.length - 1] = { ...last, text: e.data.text };
			} else {
				entries.push({ kind: 'agent', id: e.data.id, author: e.data.author, text: e.data.text });
			}
			return { ...t, entries, speaker: e.data.author };
		}
		case 'handoff': {
			// The Project Manager hands to the Strategist via a tool, and the Strategist's
			// `finish_task` hands back; only show the turns between named agents.
			if (!(e.data.to in AGENT_LABEL) || e.data.from === e.data.to) return { ...t, speaker: e.data.to };
			return {
				...t,
				speaker: e.data.to,
				entries: [
					...t.entries,
					{ kind: 'handoff', id: `h${t.entries.length}`, from: e.data.from, to: e.data.to }
				]
			};
		}
		case 'tool_call': {
			if (e.data.name !== PROPOSE_ROADMAP) return t;
			const proposal = parseProposal(e.data.args);
			if (!proposal) return t;
			const version = t.proposalVersion + 1;
			return {
				...t,
				proposal,
				proposalVersion: version,
				entries: [...t.entries, { kind: 'proposal', id: `p${version}`, version }]
			};
		}
		case 'error':
			return {
				...t,
				speaker: null,
				entries: [...t.entries, { kind: 'error', id: `e${t.entries.length}`, message: e.data.message }]
			};
		case 'done':
			return { ...t, speaker: null };
		default:
			return t;
	}
}

// ── Proposal ──────────────────────────────────────────────────────────────────

export interface ProposedGoal {
	title: string;
	body: string;
	priority: PriorityLevel;
}

export interface ProposedProject {
	title: string;
	body: string;
	priority: ProjectPriority;
	impact: number;
	effort: number;
}

export interface Proposal {
	/** A new goal, or null when adding projects to `goalId`. */
	goal: ProposedGoal | null;
	goalId: string | null;
	projects: ProposedProject[];
}

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function int(v: unknown, min: number, max: number, fallback: number): number {
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

const PRIORITIES: ProjectPriority[] = ['urgent', 'high', 'medium', 'low'];

/**
 * Reads `propose_roadmap` arguments defensively: model output is untrusted, so anything
 * out of range is clamped to what the app accepts and nameless items are dropped.
 */
export function parseProposal(args: unknown): Proposal | null {
	if (!isDict(args)) return null;

	const rawGoal = isDict(args['goal']) ? args['goal'] : null;
	const goalTitle = rawGoal ? text(rawGoal['title'], 200) : '';
	const goal: ProposedGoal | null =
		rawGoal && goalTitle
			? {
					title: goalTitle,
					body: text(rawGoal['body'], 4000),
					priority: int(rawGoal['priority'], 1, 5, 3) as PriorityLevel
				}
			: null;
	const goalId = text(args['goal_id'], 128) || null;

	const projects = (Array.isArray(args['projects']) ? args['projects'] : []).flatMap(
		(raw): ProposedProject[] => {
			if (!isDict(raw)) return [];
			const title = text(raw['title'], 200);
			if (!title) return [];
			const priority = PRIORITIES.find((p) => p === raw['priority']) ?? 'medium';
			return [
				{
					title,
					body: text(raw['body'], 4000),
					priority,
					impact: int(raw['impact'], 1, 100, 50),
					effort: int(raw['effort'], 1, 10, 5)
				}
			];
		}
	);

	if (!goal && !goalId) return null;
	if (!goal && projects.length === 0) return null;
	return { goal, goalId: goal ? null : goalId, projects };
}

/** A proposal the user is reviewing: each item can be edited or left out. */
export interface DraftItem<T> {
	value: T;
	include: boolean;
	/** Set once the item exists, so a retry after a partial failure skips it. */
	createdId: string | null;
}

export interface Draft {
	goal: DraftItem<ProposedGoal> | null;
	goalId: string | null;
	projects: DraftItem<ProposedProject>[];
}

export function toDraft(p: Proposal): Draft {
	return {
		goal: p.goal ? { value: { ...p.goal }, include: true, createdId: null } : null,
		goalId: p.goalId,
		projects: p.projects.map((value) => ({ value: { ...value }, include: true, createdId: null }))
	};
}

/** What pressing Create would make, for the button label. */
export function draftCounts(d: Draft): { goal: boolean; projects: number } {
	return {
		goal: !!d.goal && !d.goal.createdId,
		projects: d.projects.filter((p) => p.include && !p.createdId && p.value.title.trim()).length
	};
}

export function createLabel(d: Draft): string {
	const { goal, projects } = draftCounts(d);
	const noun = projects === 1 ? 'project' : 'projects';
	if (goal && projects) return `Create goal and ${projects} ${noun}`;
	if (goal) return 'Create goal';
	return projects ? `Create ${projects} ${noun}` : 'Nothing to create';
}

export interface DraftWriter {
	createGoal(goal: ProposedGoal): Promise<{ id: string }>;
	createProject(goalId: string, project: ProposedProject): Promise<{ id: string }>;
}

/**
 * Creates the draft's items in order: the goal first, then each included project. Stops
 * at the first failure and records what was made, so pressing Create again only makes
 * the rest. Returns the goal id the projects hang off.
 */
export async function createDraft(d: Draft, writer: DraftWriter): Promise<string> {
	let goalId = d.goalId;
	if (d.goal) {
		if (!d.goal.value.title.trim()) throw new Error('Give the goal a name.');
		d.goal.createdId ??= (await writer.createGoal({ ...d.goal.value, title: d.goal.value.title.trim() })).id;
		goalId = d.goal.createdId;
	}
	if (!goalId) throw new Error('There is no goal to add these projects to.');
	for (const item of d.projects) {
		if (!item.include || item.createdId || !item.value.title.trim()) continue;
		item.createdId = (
			await writer.createProject(goalId, { ...item.value, title: item.value.title.trim() })
		).id;
	}
	return goalId;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/**
 * Agent text is model output, so it is never turned into an HTML string. Markdown is
 * lexed into this small tree and rendered as Svelte elements: anything outside it
 * (raw HTML, images, tables) comes through as plain text.
 */
export type MdInline =
	| { type: 'text'; text: string }
	| { type: 'strong' | 'em' | 'del'; children: MdInline[] }
	| { type: 'code'; text: string }
	| { type: 'link'; href: string; children: MdInline[] }
	| { type: 'br' };

export type MdBlock =
	| { type: 'paragraph' | 'heading'; children: MdInline[] }
	| { type: 'list'; ordered: boolean; items: MdBlock[][] }
	| { type: 'code'; text: string }
	| { type: 'quote'; blocks: MdBlock[] }
	| { type: 'hr' };

/** Only plain web and mail links survive. */
const SAFE_HREF = /^(https?:|mailto:)/i;

const lexer = new Marked({ gfm: true, breaks: true });

type Token = { type: string; raw?: string; text?: string; href?: string; tokens?: Token[] } & Dict;

function inlines(tokens: Token[] | undefined): MdInline[] {
	return (tokens ?? []).flatMap((t): MdInline[] => {
		switch (t.type) {
			case 'strong':
			case 'em':
			case 'del':
				return [{ type: t.type, children: inlines(t.tokens) }];
			case 'codespan':
				return [{ type: 'code', text: t.text ?? '' }];
			case 'br':
				return [{ type: 'br' }];
			case 'link':
				return SAFE_HREF.test(t.href ?? '')
					? [{ type: 'link', href: t.href ?? '', children: inlines(t.tokens) }]
					: inlines(t.tokens);
			case 'text':
				return t.tokens ? inlines(t.tokens) : [{ type: 'text', text: t.text ?? '' }];
			case 'escape':
				return [{ type: 'text', text: t.text ?? '' }];
			default:
				// html, image and anything new: show the source, never interpret it
				return [{ type: 'text', text: t.raw ?? t.text ?? '' }];
		}
	});
}

function blocks(tokens: Token[]): MdBlock[] {
	return tokens.flatMap((t): MdBlock[] => {
		switch (t.type) {
			case 'paragraph':
			case 'heading':
				return [{ type: t.type, children: inlines(t.tokens) }];
			case 'text':
				return [{ type: 'paragraph', children: t.tokens ? inlines(t.tokens) : [{ type: 'text', text: t.text ?? '' }] }];
			case 'list': {
				const items = Array.isArray(t['items']) ? (t['items'] as Token[]) : [];
				return [{ type: 'list', ordered: t['ordered'] === true, items: items.map((i) => blocks(i.tokens ?? [])) }];
			}
			case 'code':
				return [{ type: 'code', text: t.text ?? '' }];
			case 'blockquote':
				return [{ type: 'quote', blocks: blocks(t.tokens ?? []) }];
			case 'hr':
				return [{ type: 'hr' }];
			case 'space':
				return [];
			default:
				return t.raw?.trim() ? [{ type: 'paragraph', children: [{ type: 'text', text: t.raw.trim() }] }] : [];
		}
	});
}

/** Agent markdown as a safe tree for `AgentMarkdown.svelte`. */
export function parseAgentMarkdown(source: string): MdBlock[] {
	return blocks(lexer.lexer(source) as unknown as Token[]);
}
