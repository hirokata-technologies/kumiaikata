import { apiFetch } from './client.js';

export function addLabelToCard(
	boardId: string,
	cardId: string,
	labelId: string,
): Promise<{ cardId: string; labelId: string }> {
	return apiFetch<{ cardId: string; labelId: string }>(
		`/api/boards/${boardId}/cards/${cardId}/labels`,
		{
			method: 'POST',
			body: JSON.stringify({ labelId }),
		},
	);
}

export function removeLabelFromCard(
	boardId: string,
	cardId: string,
	labelId: string,
): Promise<null> {
	return apiFetch<null>(`/api/boards/${boardId}/cards/${cardId}/labels/${labelId}`, {
		method: 'DELETE',
	});
}
