import { apiFetch } from './client.js';
import type { TeamInfo, TeamMemberRow } from './types.js';

export function getMyTeam(): Promise<TeamInfo> {
	return apiFetch<TeamInfo>('/api/teams/mine');
}

export function listTeamMembers(teamId: string): Promise<TeamMemberRow[]> {
	return apiFetch<TeamMemberRow[]>(`/api/teams/${teamId}/members`);
}

export function setTeamMemberRole(
	teamId: string,
	userId: string,
	role: 'admin' | 'member',
): Promise<{ userId: string; role: string }> {
	return apiFetch<{ userId: string; role: string }>(
		`/api/teams/${teamId}/members/${userId}`,
		{
			method: 'PATCH',
			body: JSON.stringify({ role }),
		},
	);
}
