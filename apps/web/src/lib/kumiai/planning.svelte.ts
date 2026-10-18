import { ApiError } from '$lib/api/client.js';
import { createAgentSession, streamAgentMessage } from '$lib/api/agents.js';
import {
	applyStreamEvent,
	createDraft,
	createDraftItem,
	emptyTranscript,
	toDraft,
	type Draft,
	type DraftTarget,
	type DraftWriter,
	type PlanningIntent,
	type StreamEvent,
	type Transcript
} from './planning.js';

export interface PlanningDeps {
	createSession: (intent: PlanningIntent) => Promise<{ id: string }>;
	stream: (sessionId: string, message: string, signal: AbortSignal) => AsyncIterable<StreamEvent>;
}

const defaultDeps: PlanningDeps = {
	createSession: (intent) => createAgentSession(intent),
	stream: (sessionId, message, signal) => streamAgentMessage(sessionId, message, signal)
};

/**
 * One planning conversation, from the first message to the created goal. The session is
 * opened lazily on the first message, so opening the panel costs nothing.
 */
export class PlanningConversation {
	transcript = $state<Transcript>(emptyTranscript());
	/** The editable copy of the latest proposal. */
	draft = $state<Draft | null>(null);
	/** idle → thinking while the agents reply; unavailable when agents are not configured. */
	phase = $state<'idle' | 'thinking' | 'unavailable'>('idle');
	creating = $state(false);
	createError = $state<string | null>(null);
	/** The card being added right now, or null. */
	adding = $state<DraftTarget | null>(null);
	addError = $state<string | null>(null);

	#sessionId: string | null = null;
	#abort: AbortController | null = null;

	constructor(
		readonly intent: PlanningIntent,
		private readonly deps: PlanningDeps = defaultDeps
	) {}

	get busy(): boolean {
		return this.phase === 'thinking';
	}

	async send(raw: string): Promise<void> {
		const message = raw.trim();
		if (!message || this.busy || this.phase === 'unavailable') return;

		const t = this.transcript;
		this.transcript = {
			...t,
			entries: [...t.entries, { kind: 'user', id: `u${t.entries.length}`, text: message }],
			speaker: 'project_manager'
		};
		this.phase = 'thinking';
		const abort = new AbortController();
		this.#abort = abort;

		try {
			this.#sessionId ??= (await this.deps.createSession(this.intent)).id;
			for await (const event of this.deps.stream(this.#sessionId, message, abort.signal)) {
				this.#apply(event);
			}
		} catch (e) {
			if (abort.signal.aborted) return;
			if (e instanceof ApiError && e.status === 503 && !this.#sessionId) {
				this.phase = 'unavailable';
				return;
			}
			this.#apply({
				event: 'error',
				data: { code: 'CLIENT', message: e instanceof Error ? e.message : 'The agents did not respond.' }
			});
		} finally {
			if (this.#abort === abort) this.#abort = null;
			if (this.phase === 'thinking') this.phase = 'idle';
			this.transcript = { ...this.transcript, speaker: null };
		}
	}

	/** Stops the reply in progress (the panel closing, or the user pressing Stop). */
	stop(): void {
		this.#abort?.abort();
	}

	/** Creates the reviewed draft. Returns the goal id, or null when it failed. */
	async create(writer: DraftWriter): Promise<string | null> {
		if (!this.draft || this.creating) return null;
		this.creating = true;
		this.createError = null;
		try {
			return await createDraft(this.draft, writer);
		} catch (e) {
			this.createError = e instanceof Error ? e.message : 'Something went wrong.';
			return null;
		} finally {
			this.creating = false;
		}
	}

	/** Adds one card of the draft to the roadmap. Returns whether it was created. */
	async add(writer: DraftWriter, target: DraftTarget): Promise<boolean> {
		if (!this.draft || this.adding !== null || this.creating) return false;
		this.adding = target;
		this.addError = null;
		try {
			await createDraftItem(this.draft, writer, target);
			return true;
		} catch (e) {
			this.addError = e instanceof Error ? e.message : 'Something went wrong.';
			return false;
		} finally {
			this.adding = null;
		}
	}

	#apply(event: StreamEvent): void {
		const before = this.transcript.proposalVersion;
		this.transcript = applyStreamEvent(this.transcript, event);
		const { proposal, proposalVersion } = this.transcript;
		// A new proposal replaces the draft wholesale: the agents send the full plan each time.
		if (proposal && proposalVersion !== before) {
			const next = toDraft(proposal);
			// If the goal was already created, a revised proposal adds to it rather than
			// making it a second time.
			const createdGoalId = this.draft?.goal?.createdId;
			if (createdGoalId) {
				next.goal = null;
				next.goalId = createdGoalId;
			}
			this.draft = next;
			this.createError = null;
			this.addError = null;
		}
	}
}
