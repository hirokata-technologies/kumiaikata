import type { BoardEvent } from './types.js';

export type BoardEventHandler = (event: BoardEvent) => void;

const KNOWN_TYPES = [
	'column.created',
	'column.updated',
	'column.deleted',
	'columns.reordered',
	'card.created',
	'card.updated',
	'card.moved',
	'card.deleted',
	'cards.reordered',
	'card.label.added',
	'card.label.removed',
	'card.assignee.added',
	'card.assignee.removed',
	'card.comment.created',
	'card.comment.updated',
	'card.comment.deleted',
	'card.checklist.created',
	'card.checklist.updated',
	'card.checklist.deleted',
	'card.attachment.added',
	'card.attachment.removed',
	'label.created',
	'label.updated',
	'label.deleted',
];

/**
 * Opens an SSE connection to the board's event stream.
 * Returns a cleanup function that closes the connection.
 *
 * Usage:
 *   const unsubscribe = subscribeBoard(boardId, (event) => { ... });
 *   // On component unmount:
 *   unsubscribe();
 */
export function subscribeBoard(boardId: string, onEvent: BoardEventHandler): () => void {
	const url = `/api/boards/${boardId}/events`;
	const es = new EventSource(url);

	const handler = (e: MessageEvent) => {
		try {
			const data = JSON.parse(e.data as string);
			onEvent({ type: e.type, data });
		} catch (err) {
			console.error('[sse] failed to parse event', e.type, err);
		}
	};

	for (const type of KNOWN_TYPES) {
		es.addEventListener(type, handler as EventListener);
	}

	// Catch-all for event types not in KNOWN_TYPES (e.g. future server events).
	// EventSource.onmessage fires for events with no 'event:' field or for any
	// event not handled by a named listener in some browsers.
	es.onmessage = (ev) => {
		try {
			const parsed = JSON.parse(ev.data);
			if (parsed && typeof parsed === 'object') {
				onEvent(parsed as BoardEvent);
			}
		} catch {
			// ignore malformed data
		}
	};

	// Handle server-sent error events (e.g. UNAUTHENTICATED watchdog).
	es.addEventListener('error', (e) => {
		const me = e as MessageEvent;
		if (typeof me.data === 'string') {
			try {
				const parsed = JSON.parse(me.data) as { code?: string };
				if (parsed?.code === 'UNAUTHENTICATED' && typeof window !== 'undefined') {
					es.close();
					window.location.assign('/login?error=UNAUTHENTICATED');
				}
			} catch {
				// Native network error — EventSource auto-reconnects, no action needed.
			}
		}
	});

	return () => es.close();
}
