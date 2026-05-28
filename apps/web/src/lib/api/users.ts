import { apiFetch } from './client.js';

export async function uploadAvatar(file: File): Promise<{ imageUrl: string }> {
	const form = new FormData();
	form.append('file', file);
	return apiFetch<{ imageUrl: string }>('/api/users/me/avatar', {
		method: 'POST',
		body: form,
	});
}
