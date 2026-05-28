import { apiFetch } from './client.js';
import type { BoardWithColumnsAndCards } from './types.js';

export function getPersonalBoard(): Promise<BoardWithColumnsAndCards> {
	return apiFetch<BoardWithColumnsAndCards>('/api/boards/personal');
}

export function getTeamBoard(): Promise<BoardWithColumnsAndCards> {
	return apiFetch<BoardWithColumnsAndCards>('/api/boards/team');
}
