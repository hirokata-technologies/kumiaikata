import { apiFetch } from './client.js';
import type { LabelDetail } from './types.js';

export function listLabels(boardId: string): Promise<LabelDetail[]> {
	return apiFetch<LabelDetail[]>(`/api/boards/${boardId}/labels`);
}

export function createLabel(
	boardId: string,
	name: string,
	color: string,
): Promise<LabelDetail> {
	return apiFetch<LabelDetail>(`/api/boards/${boardId}/labels`, {
		method: 'POST',
		body: JSON.stringify({ name, color }),
	});
}

export interface UpdateLabelPatch {
	name?: string;
	color?: string;
}

export function updateLabel(
	boardId: string,
	labelId: string,
	patch: UpdateLabelPatch,
): Promise<LabelDetail> {
	return apiFetch<LabelDetail>(`/api/boards/${boardId}/labels/${labelId}`, {
		method: 'PATCH',
		body: JSON.stringify(patch),
	});
}

export function deleteLabel(boardId: string, labelId: string): Promise<null> {
	return apiFetch<null>(`/api/boards/${boardId}/labels/${labelId}`, {
		method: 'DELETE',
	});
}
