import { EventEmitter } from "node:events";
import type { BoardEvent } from "./types.js";

export interface BoardEventBus {
	emit(event: BoardEvent): void;
	/** Returns an unsubscribe function. The listener fires only for matching boardId. */
	subscribe(
		boardId: string,
		listener: (event: BoardEvent) => void,
	): () => void;
}

class InProcessEventBus implements BoardEventBus {
	private readonly emitter = new EventEmitter();

	constructor() {
		// Remove the default listener limit — boards act as independent channels.
		this.emitter.setMaxListeners(0);
	}

	emit(event: BoardEvent): void {
		this.emitter.emit(event.boardId, event);
	}

	subscribe(
		boardId: string,
		listener: (event: BoardEvent) => void,
	): () => void {
		this.emitter.on(boardId, listener);
		return () => {
			this.emitter.off(boardId, listener);
		};
	}
}

export const eventBus: BoardEventBus = new InProcessEventBus();
