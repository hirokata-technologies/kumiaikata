import { apiFetch } from './client.js';
import type { CardSummary, CardDetail } from './types.js';

export function createCard(
	boardId: string,
	columnId: string,
	title: string,
): Promise<CardSummary> {
	return apiFetch<CardSummary>(`/api/boards/${boardId}/columns/${columnId}/cards`, {
		method: 'POST',
		body: JSON.stringify({ title }),
	});
}

export function getCard(boardId: string, cardId: string): Promise<CardDetail> {
	return apiFetch<CardDetail>(`/api/boards/${boardId}/cards/${cardId}`);
}

export interface UpdateCardPatch {
	title?: string;
	description?: string | null;
	dueDate?: string | null;
	projectId?: string | null;
}

export function updateCard(
	boardId: string,
	cardId: string,
	patch: UpdateCardPatch,
): Promise<CardSummary> {
	return apiFetch<CardSummary>(`/api/boards/${boardId}/cards/${cardId}`, {
		method: 'PATCH',
		body: JSON.stringify(patch),
	});
}

export function moveCard(
	boardId: string,
	cardId: string,
	targetColumnId: string,
	position: number,
): Promise<CardSummary> {
	return apiFetch<CardSummary>(`/api/boards/${boardId}/cards/${cardId}/move`, {
		method: 'PATCH',
		body: JSON.stringify({ targetColumnId, position }),
	});
}

export function reorderCards(
	boardId: string,
	columnId: string,
	orderedIds: string[],
): Promise<{ orderedIds: string[] }> {
	return apiFetch<{ orderedIds: string[] }>(
		`/api/boards/${boardId}/columns/${columnId}/cards/reorder`,
		{
			method: 'PATCH',
			body: JSON.stringify({ orderedIds }),
		},
	);
}

export function deleteCard(boardId: string, cardId: string): Promise<null> {
	return apiFetch<null>(`/api/boards/${boardId}/cards/${cardId}`, {
		method: 'DELETE',
	});
}
