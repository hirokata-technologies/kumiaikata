import { apiFetch } from './client.js';

export function assignUser(
	boardId: string,
	cardId: string,
	userId: string,
): Promise<{ cardId: string; userId: string }> {
	return apiFetch<{ cardId: string; userId: string }>(
		`/api/boards/${boardId}/cards/${cardId}/assignees`,
		{
			method: 'POST',
			body: JSON.stringify({ userId }),
		},
	);
}

export function unassignUser(boardId: string, cardId: string, userId: string): Promise<null> {
	return apiFetch<null>(`/api/boards/${boardId}/cards/${cardId}/assignees/${userId}`, {
		method: 'DELETE',
	});
}
