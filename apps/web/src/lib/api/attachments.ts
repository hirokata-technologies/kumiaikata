import { env } from '$env/dynamic/public';
import { apiFetch } from './client.js';
import type { AttachmentResponse } from './types.js';

export function uploadAttachment(
	boardId: string,
	cardId: string,
	file: File,
): Promise<AttachmentResponse> {
	const form = new FormData();
	form.append('file', file);
	// Do not set content-type — the browser sets the multipart boundary automatically.
	return apiFetch<AttachmentResponse>(
		`/api/boards/${boardId}/cards/${cardId}/attachments`,
		{
			method: 'POST',
			body: form,
		},
	);
}

export function deleteAttachment(
	boardId: string,
	cardId: string,
	attachmentId: string,
): Promise<null> {
	return apiFetch<null>(
		`/api/boards/${boardId}/cards/${cardId}/attachments/${attachmentId}`,
		{
			method: 'DELETE',
		},
	);
}

/**
 * Returns the URL for downloading an attachment directly.
 * Use in <a href> or <img src> — the server streams the file with correct headers.
 */
export function attachmentDownloadUrl(attachmentId: string): string {
	return `${env.PUBLIC_API_URL}/api/attachments/${attachmentId}`;
}
