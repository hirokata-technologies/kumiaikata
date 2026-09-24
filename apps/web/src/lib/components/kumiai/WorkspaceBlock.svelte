<script lang="ts">
	let { teamName }: { teamName: string | null } = $props();
</script>

<div class="workspace-block">
	<img src="/logo-mark.png" alt="" class="workspace-logo" />
	<div class="workspace-text">
		<span class="workspace-name">Kumiaikata</span>
		<span class="workspace-team">{teamName ?? 'Your team'}</span>
	</div>
</div>

<style>
	.workspace-block {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2);
	}

	.workspace-logo {
		width: 28px;
		height: 28px;
		flex-shrink: 0;
		display: block;
	}

	.workspace-text {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		line-height: 1.2;
	}

	.workspace-name {
		font: 700 13px var(--font-sans);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--fg-1);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.workspace-team {
		font: 400 12px var(--font-sans);
		color: var(--fg-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
