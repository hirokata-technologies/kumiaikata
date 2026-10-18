<script lang="ts">
	import type { PageProps } from './$types';
	import { goto, invalidateAll } from '$app/navigation';
	import PlanningPanel from '$lib/components/kumiai/PlanningPanel.svelte';
	import { addProject } from '$lib/kumiai/actions.js';
	import { createGoal } from '$lib/api/kumiai/goals.js';
	import type { DraftWriter } from '$lib/kumiai/planning.js';

	let { data }: PageProps = $props();

	const writer: DraftWriter = {
		createGoal: (goal) =>
			createGoal({
				title: goal.title,
				body: goal.body,
				status: 'todo',
				priority: goal.priority,
				...(data.activeWorkspaceId ? { workspaceId: data.activeWorkspaceId } : {})
			}),
		createProject: (goalId, project) => addProject({ goalId, status: 'backlog', ...project })
	};

	const intent = $derived({
		kind: 'goal' as const,
		...(data.activeWorkspaceId ? { workspaceId: data.activeWorkspaceId } : {})
	});

	async function created() {
		await invalidateAll();
		await goto('/roadmap');
	}
</script>

<svelte:head>
	<title>Discuss Goals and Projects — Kata</title>
</svelte:head>

<PlanningPanel
	page
	{intent}
	{writer}
	onclose={() => goto('/roadmap')}
	oncreated={created}
	onadded={() => invalidateAll()}
/>
