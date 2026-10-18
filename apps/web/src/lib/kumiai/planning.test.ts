import { describe, expect, it, vi } from 'vitest';
import {
	applyStreamEvent,
	createDraft,
	createLabel,
	emptyTranscript,
	parseAgentMarkdown,
	parseProposal,
	toDraft,
	type StreamEvent,
	type Transcript
} from './planning.js';

const fold = (events: StreamEvent[], start: Transcript = emptyTranscript()) =>
	events.reduce(applyStreamEvent, start);

const msg = (id: string, author: string, text: string): StreamEvent => ({
	event: 'message',
	data: { id, author, text }
});

const proposeCall = (args: unknown): StreamEvent => ({
	event: 'tool_call',
	data: { eventId: 'x', author: 'project_manager', name: 'propose_roadmap', args }
});

const GOAL_ARGS = {
	goal: { title: 'Notes without typing', body: 'Clinicians dictate.', priority: 2 },
	projects: [
		{ title: 'Dictation pilot', priority: 'high', impact: 70, effort: 4 },
		{ title: 'Ward rollout', impact: 40, effort: 8 }
	]
};

describe('applyStreamEvent', () => {
	it('records the conversation between the Project Manager and the Strategist', () => {
		const t = fold([
			msg('1', 'project_manager', 'What outcome do you want?'),
			{ event: 'handoff', data: { from: 'project_manager', to: 'strategist' } },
			msg('2', 'strategist', 'Two options.'),
			{ event: 'handoff', data: { from: 'strategist', to: 'project_manager' } },
			msg('3', 'project_manager', 'Here is the plan.'),
			{ event: 'done', data: {} }
		]);

		expect(t.entries.map((e) => e.kind)).toEqual(['agent', 'handoff', 'agent', 'handoff', 'agent']);
		expect(t.entries[2]).toMatchObject({ author: 'strategist', text: 'Two options.' });
		expect(t.speaker).toBeNull();
	});

	it('tracks who is speaking while a reply streams', () => {
		const t = fold([{ event: 'handoff', data: { from: 'project_manager', to: 'strategist' } }]);
		expect(t.speaker).toBe('strategist');
	});

	it('replaces a message whose event id arrives again', () => {
		const t = fold([msg('1', 'project_manager', 'Hel'), msg('1', 'project_manager', 'Hello')]);
		expect(t.entries).toEqual([{ kind: 'agent', id: '1', author: 'project_manager', text: 'Hello' }]);
	});

	it('ignores hand-offs to anything that is not a named agent', () => {
		const t = fold([{ event: 'handoff', data: { from: 'project_manager', to: 'finish_task' } }]);
		expect(t.entries).toEqual([]);
	});

	it('turns a propose_roadmap call into a proposal and marks where it arrived', () => {
		const t = fold([msg('1', 'project_manager', 'Summary.'), proposeCall(GOAL_ARGS)]);

		expect(t.proposal?.goal?.title).toBe('Notes without typing');
		expect(t.proposal?.projects).toHaveLength(2);
		expect(t.entries.at(-1)).toEqual({ kind: 'proposal', id: 'p1', version: 1 });
	});

	it('bumps the version when the proposal is revised', () => {
		const t = fold([proposeCall(GOAL_ARGS), proposeCall({ ...GOAL_ARGS, projects: [] })]);
		expect(t.proposalVersion).toBe(2);
		expect(t.proposal?.projects).toEqual([]);
	});

	it('ignores other tool calls and unusable proposals', () => {
		const t = fold([
			{ event: 'tool_call', data: { eventId: 'x', author: 'project_manager', name: 'strategist', args: {} } },
			proposeCall({ projects: [] })
		]);
		expect(t.proposal).toBeNull();
		expect(t.entries).toEqual([]);
	});

	it('shows errors in the transcript and ends the turn', () => {
		const t = fold([
			msg('1', 'project_manager', 'Hmm'),
			{ event: 'error', data: { code: 'AGENT_ERROR', message: 'The agent could not complete the reply.' } }
		]);
		expect(t.entries.at(-1)).toMatchObject({ kind: 'error', message: 'The agent could not complete the reply.' });
		expect(t.speaker).toBeNull();
	});
});

describe('parseProposal', () => {
	it('clamps estimates and priorities to what the app accepts', () => {
		const p = parseProposal({
			goal: { title: '  Big goal ', priority: 9 },
			projects: [{ title: 'P', priority: 'asap', impact: 500, effort: -2 }]
		});
		expect(p).toEqual({
			goal: { title: 'Big goal', body: '', priority: 5 },
			goalId: null,
			projects: [{ title: 'P', body: '', priority: 'medium', impact: 100, effort: 1 }]
		});
	});

	it('drops nameless projects', () => {
		const p = parseProposal({ goal: { title: 'G' }, projects: [{ title: '' }, 'junk', { title: 'Real' }] });
		expect(p?.projects.map((x) => x.title)).toEqual(['Real']);
	});

	it('accepts projects for an existing goal', () => {
		const p = parseProposal({ goal_id: 'g1', projects: [{ title: 'P' }] });
		expect(p).toMatchObject({ goal: null, goalId: 'g1' });
	});

	it.each([
		['no goal at all', { projects: [{ title: 'P' }] }],
		['an existing goal with no projects', { goal_id: 'g1', projects: [] }],
		['not an object', 'propose']
	])('rejects %s', (_, args) => {
		expect(parseProposal(args)).toBeNull();
	});

	it('prefers the new goal when both are given', () => {
		expect(parseProposal({ goal: { title: 'G' }, goal_id: 'g1', projects: [] })?.goalId).toBeNull();
	});
});

describe('drafts', () => {
	const draft = () => toDraft(parseProposal(GOAL_ARGS)!);

	it('labels the create button with what it will make', () => {
		const d = draft();
		expect(createLabel(d)).toBe('Create goal and 2 projects');
		d.projects[1]!.include = false;
		expect(createLabel(d)).toBe('Create goal and 1 project');
		d.projects[0]!.include = false;
		expect(createLabel(d)).toBe('Create goal');
	});

	it('creates the goal first, then each included project under it', async () => {
		const d = draft();
		d.projects[1]!.include = false;
		const writer = {
			createGoal: vi.fn(async () => ({ id: 'g1' })),
			createProject: vi.fn(async () => ({ id: 'p1' }))
		};

		await expect(createDraft(d, writer)).resolves.toBe('g1');
		expect(writer.createGoal).toHaveBeenCalledWith(expect.objectContaining({ title: 'Notes without typing' }));
		expect(writer.createProject).toHaveBeenCalledTimes(1);
		expect(writer.createProject).toHaveBeenCalledWith('g1', expect.objectContaining({ title: 'Dictation pilot' }));
	});

	it('only makes what is left when retried after a failure', async () => {
		const d = draft();
		const createProject = vi
			.fn()
			.mockResolvedValueOnce({ id: 'p1' })
			.mockRejectedValueOnce(new Error('network'))
			.mockResolvedValueOnce({ id: 'p2' });
		const writer = { createGoal: vi.fn(async () => ({ id: 'g1' })), createProject };

		await expect(createDraft(d, writer)).rejects.toThrow('network');
		expect(createLabel(d)).toBe('Create 1 project');
		await createDraft(d, writer);

		expect(writer.createGoal).toHaveBeenCalledTimes(1);
		expect(createProject.mock.calls.map((c) => c[1].title)).toEqual([
			'Dictation pilot',
			'Ward rollout',
			'Ward rollout'
		]);
	});

	it('refuses a goal whose name was cleared', async () => {
		const d = draft();
		d.goal!.value.title = '  ';
		const writer = { createGoal: vi.fn(), createProject: vi.fn() };
		await expect(createDraft(d, writer)).rejects.toThrow('Give the goal a name.');
		expect(writer.createGoal).not.toHaveBeenCalled();
	});
});

describe('parseAgentMarkdown', () => {
	it('reads paragraphs, emphasis and lists', () => {
		expect(parseAgentMarkdown('**Goal**: notes\n\n1. Pilot\n2. Rollout')).toEqual([
			{
				type: 'paragraph',
				children: [{ type: 'strong', children: [{ type: 'text', text: 'Goal' }] }, { type: 'text', text: ': notes' }]
			},
			{
				type: 'list',
				ordered: true,
				items: [
					[{ type: 'paragraph', children: [{ type: 'text', text: 'Pilot' }] }],
					[{ type: 'paragraph', children: [{ type: 'text', text: 'Rollout' }] }]
				]
			}
		]);
	});

	it('keeps raw HTML as plain text', () => {
		const tree = JSON.stringify(parseAgentMarkdown('Hi <img src=x onerror=alert(1)>'));
		expect(tree).toContain('"type":"text"');
		expect(tree).toContain('<img src=x onerror=alert(1)>');
		expect(tree).not.toContain('"type":"html"');
	});

	it('keeps web links and drops script links to their label', () => {
		expect(parseAgentMarkdown('[docs](https://example.com)')).toEqual([
			{ type: 'paragraph', children: [{ type: 'link', href: 'https://example.com', children: [{ type: 'text', text: 'docs' }] }] }
		]);
		expect(parseAgentMarkdown('[click](javascript:alert(1))')).toEqual([
			{ type: 'paragraph', children: [{ type: 'text', text: 'click' }] }
		]);
	});
});
