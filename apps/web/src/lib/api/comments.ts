import { apiFetch } from './client.js';
import type { CommentDetail } from './types.js';

export function addComment(
	boardId: string,
	cardId: string,
	body: string,
): Promise<CommentDetail> {
	return apiFetch<CommentDetail>(`/api/boards/${boardId}/cards/${cardId}/comments`, {
		method: 'POST',
		body: JSON.stringify({ body }),
	});
}

export function updateComment(
	boardId: string,
	cardId: string,
	commentId: string,
	body: string,
): Promise<CommentDetail> {
	return apiFetch<CommentDetail>(
		`/api/boards/${boardId}/cards/${cardId}/comments/${commentId}`,
		{
			method: 'PATCH',
			body: JSON.stringify({ body }),
		},
	);
}

export function deleteComment(
	boardId: string,
	cardId: string,
	commentId: string,
): Promise<null> {
	return apiFetch<null>(`/api/boards/${boardId}/cards/${cardId}/comments/${commentId}`, {
		method: 'DELETE',
	});
}
