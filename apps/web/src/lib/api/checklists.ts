import { apiFetch } from './client.js';
import type { ChecklistDetail, ChecklistItemDetail } from './types.js';

export function addChecklist(
	boardId: string,
	cardId: string,
	title: string,
): Promise<ChecklistDetail> {
	return apiFetch<ChecklistDetail>(`/api/boards/${boardId}/cards/${cardId}/checklists`, {
		method: 'POST',
		body: JSON.stringify({ title }),
	});
}

export function deleteChecklist(
	boardId: string,
	cardId: string,
	checklistId: string,
): Promise<null> {
	return apiFetch<null>(`/api/boards/${boardId}/cards/${cardId}/checklists/${checklistId}`, {
		method: 'DELETE',
	});
}

export function addChecklistItem(
	boardId: string,
	cardId: string,
	checklistId: string,
	text: string,
): Promise<ChecklistItemDetail> {
	return apiFetch<ChecklistItemDetail>(
		`/api/boards/${boardId}/cards/${cardId}/checklists/${checklistId}/items`,
		{
			method: 'POST',
			body: JSON.stringify({ text }),
		},
	);
}

export interface UpdateChecklistItemPatch {
	text?: string;
	checked?: boolean;
}

export function updateChecklistItem(
	boardId: string,
	cardId: string,
	checklistId: string,
	itemId: string,
	patch: UpdateChecklistItemPatch,
): Promise<ChecklistItemDetail> {
	return apiFetch<ChecklistItemDetail>(
		`/api/boards/${boardId}/cards/${cardId}/checklists/${checklistId}/items/${itemId}`,
		{
			method: 'PATCH',
			body: JSON.stringify(patch),
		},
	);
}

export function deleteChecklistItem(
	boardId: string,
	cardId: string,
	checklistId: string,
	itemId: string,
): Promise<null> {
	return apiFetch<null>(
		`/api/boards/${boardId}/cards/${cardId}/checklists/${checklistId}/items/${itemId}`,
		{
			method: 'DELETE',
		},
	);
}
