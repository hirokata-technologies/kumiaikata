import { apiFetch } from './client.js';

export interface ColumnResponse {
	id: string;
	boardId: string;
	title: string;
	position: string;
}

export function createColumn(boardId: string, title: string): Promise<ColumnResponse> {
	return apiFetch<ColumnResponse>(`/api/boards/${boardId}/columns`, {
		method: 'POST',
		body: JSON.stringify({ title }),
	});
}

export function renameColumn(
	boardId: string,
	columnId: string,
	title: string,
): Promise<ColumnResponse> {
	return apiFetch<ColumnResponse>(`/api/boards/${boardId}/columns/${columnId}`, {
		method: 'PATCH',
		body: JSON.stringify({ title }),
	});
}

export function deleteColumn(boardId: string, columnId: string): Promise<null> {
	return apiFetch<null>(`/api/boards/${boardId}/columns/${columnId}`, {
		method: 'DELETE',
	});
}

export function reorderColumns(
	boardId: string,
	orderedIds: string[],
): Promise<{ orderedIds: string[] }> {
	return apiFetch<{ orderedIds: string[] }>(`/api/boards/${boardId}/columns/reorder`, {
		method: 'PATCH',
		body: JSON.stringify({ orderedIds }),
	});
}
