import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client.js';
import { PlanningConversation, type PlanningDeps } from './planning.svelte.js';
import type { StreamEvent } from './planning.js';

function deps(replies: StreamEvent[][], createSession?: PlanningDeps['createSession']): PlanningDeps {
	let turn = 0;
	return {
		createSession: createSession ?? vi.fn(async () => ({ id: 's1' })),
		stream: vi.fn(async function* () {
			for (const event of replies[turn++] ?? []) yield event;
		})
	};
}

const proposal: StreamEvent = {
	event: 'tool_call',
	data: {
		eventId: 'x',
		author: 'project_manager',
		name: 'propose_roadmap',
		args: { goal: { title: 'Notes without typing' }, projects: [{ title: 'Dictation pilot' }] }
	}
};

describe('PlanningConversation', () => {
	it('opens one session on the first message and reuses it', async () => {
		const d = deps([
			[{ event: 'message', data: { id: '1', author: 'project_manager', text: 'Why now?' } }],
			[{ event: 'done', data: {} }]
		]);
		const chat = new PlanningConversation({ kind: 'goal', workspaceId: 'w1' }, d);

		await chat.send('Clinicians spend hours typing notes.');
		await chat.send('Burnout.');

		expect(d.createSession).toHaveBeenCalledTimes(1);
		expect(d.createSession).toHaveBeenCalledWith({ kind: 'goal', workspaceId: 'w1' });
		expect(chat.transcript.entries.map((e) => e.kind)).toEqual(['user', 'agent', 'user']);
		expect(chat.phase).toBe('idle');
	});

	it('ignores blank messages and messages sent while a reply is streaming', async () => {
		const d = deps([[]]);
		const chat = new PlanningConversation({ kind: 'goal' }, d);
		await chat.send('   ');
		expect(d.createSession).not.toHaveBeenCalled();
	});

	it('turns a proposal into an editable draft', async () => {
		const chat = new PlanningConversation({ kind: 'goal' }, deps([[proposal]]));
		await chat.send('Go');
		expect(chat.draft?.goal?.value.title).toBe('Notes without typing');
		expect(chat.draft?.projects[0]?.include).toBe(true);
	});

	it('adds a revised proposal to a goal that was already created', async () => {
		const chat = new PlanningConversation({ kind: 'goal' }, deps([[proposal], [proposal]]));
		await chat.send('Go');
		const writer = {
			createGoal: vi.fn(async () => ({ id: 'g1' })),
			createProject: vi.fn().mockRejectedValueOnce(new Error('offline'))
		};
		expect(await chat.create(writer)).toBeNull();
		expect(chat.createError).toBe('offline');

		await chat.send('Add one more');

		expect(chat.draft?.goal).toBeNull();
		expect(chat.draft?.goalId).toBe('g1');
	});

	it('reports that the agents are unavailable when the session cannot be opened', async () => {
		const chat = new PlanningConversation(
			{ kind: 'goal' },
			deps([], async () => {
				throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'agents not configured');
			})
		);
		await chat.send('Hello');
		expect(chat.phase).toBe('unavailable');
	});

	it('shows other failures in the transcript', async () => {
		const d: PlanningDeps = {
			createSession: async () => ({ id: 's1' }),
			stream: () => {
				throw new ApiError(502, 'BAD_GATEWAY', 'The agents service failed to respond.');
			}
		};
		const chat = new PlanningConversation({ kind: 'goal' }, d);
		await chat.send('Hello');
		expect(chat.transcript.entries.at(-1)).toMatchObject({
			kind: 'error',
			message: 'The agents service failed to respond.'
		});
		expect(chat.phase).toBe('idle');
	});
});
