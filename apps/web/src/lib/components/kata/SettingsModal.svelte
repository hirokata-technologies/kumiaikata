<script lang="ts">
	import {
		settings,
		setTheme,
		setDensity,
		setColumnStyle,
		setMist,
		setAccent,
		setChatPlacement,
		setNotificationsInApp,
	} from '$lib/settings.svelte.js';
	import { ACCENT_PRESETS } from '$lib/accent-presets.js';
	import ThemeToggle from './ThemeToggle.svelte';

	let { onClose }: { onClose: () => void } = $props();

	let panelRef: HTMLElement | null = $state(null);

	// Focus the panel on mount so Escape handling and focus trap work
	$effect(() => {
		if (panelRef) {
			const focusable = getFocusable(panelRef);
			if (focusable.length > 0) {
				focusable[0].focus();
			} else {
				panelRef.focus();
			}
		}
	});

	// Document-level Escape listener for robustness
	$effect(() => {
		function onKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				onClose();
			}
		}
		document.addEventListener('keydown', onKeydown);
		return () => document.removeEventListener('keydown', onKeydown);
	});

	function getFocusable(panel: HTMLElement): HTMLElement[] {
		return Array.from(
			panel.querySelectorAll<HTMLElement>(
				'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
			)
		);
	}

	function onPanelKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		if (!panelRef) return;
		const focusable = getFocusable(panelRef);
		if (!focusable.length) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (e.shiftKey) {
			if (document.activeElement === first) {
				e.preventDefault();
				last?.focus();
			}
		} else {
			if (document.activeElement === last) {
				e.preventDefault();
				first?.focus();
			}
		}
	}
</script>

<div
	class="sm-scrim"
	onclick={onClose}
	onkeydown={() => {}}
	role="dialog"
	aria-modal="true"
	aria-label="Settings"
	tabindex="-1"
>
	<div
		class="sm-panel"
		bind:this={panelRef}
		onclick={(e) => e.stopPropagation()}
		onkeydown={onPanelKeydown}
		role="presentation"
	>
		<!-- Header -->
		<header class="sm-header">
			<h2 class="sm-title">Settings</h2>
			<button class="sm-close" onclick={onClose} aria-label="Close settings">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<line x1="18" y1="6" x2="6" y2="18"/>
					<line x1="6" y1="6" x2="18" y2="18"/>
				</svg>
			</button>
		</header>

		<div class="sm-body">
			<!-- ─── Appearance ─── -->
			<section class="sm-section">
				<h3 class="sm-section-heading">Appearance</h3>

				<!-- Theme -->
				<div class="sm-row">
					<span class="sm-row-label">Theme</span>
					<ThemeToggle
						isDark={settings.theme === 'dark'}
						ontoggle={() => setTheme(settings.theme === 'dark' ? 'light' : 'dark')}
					/>
				</div>

				<!-- Density -->
				<div class="sm-field">
					<span class="sm-field-label">Card density</span>
					<div class="hkbg" role="group" aria-label="Card density">
						{#each [{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }, { value: 'spacious', label: 'Spacious' }] as option (option.value)}
							<button
								class="hkbg-item"
								class:is-active={settings.density === option.value}
								aria-pressed={settings.density === option.value}
								onclick={() => setDensity(option.value as 'compact' | 'comfortable' | 'spacious')}
							>
								{option.label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Column style -->
				<div class="sm-field">
					<span class="sm-field-label">Column style</span>
					<div class="hkbg" role="group" aria-label="Column style">
						{#each [{ value: 'tray', label: 'Tray' }, { value: 'minimal', label: 'Minimal' }] as option (option.value)}
							<button
								class="hkbg-item"
								class:is-active={settings.columnStyle === option.value}
								aria-pressed={settings.columnStyle === option.value}
								onclick={() => setColumnStyle(option.value as 'tray' | 'minimal')}
							>
								{option.label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Mist -->
				<div class="sm-row">
					<label class="sm-row-label" for="sm-mist-toggle">Mist effect</label>
					<button
						id="sm-mist-toggle"
						class="sm-switch"
						role="switch"
						aria-checked={settings.mist}
						aria-label="Mist effect"
						onclick={() => setMist(!settings.mist)}
					>
						<span class="sm-switch-thumb" class:is-on={settings.mist}></span>
					</button>
				</div>
			</section>

			<div class="sm-sep" role="separator"></div>

			<!-- ─── Accent color ─── -->
			<section class="sm-section">
				<h3 class="sm-section-heading">Accent color</h3>
				<div class="swatch-row" role="group" aria-label="Accent color">
					{#each ACCENT_PRESETS as preset (preset.value)}
						<button
							type="button"
							class="swatch"
							class:is-selected={settings.accent.toLowerCase() === preset.value.toLowerCase()}
							style="--swatch: {preset.value}"
							aria-label={preset.label}
							aria-pressed={settings.accent.toLowerCase() === preset.value.toLowerCase()}
							onclick={() => setAccent(preset.value)}
						>
							{#if settings.accent.toLowerCase() === preset.value.toLowerCase()}
								<svg class="swatch-check" viewBox="0 0 12 12" fill="none" aria-hidden="true">
									<polyline points="2,6 5,9 10,3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
								</svg>
							{/if}
						</button>
					{/each}
				</div>
			</section>

			<div class="sm-sep" role="separator"></div>

			<!-- ─── Chat ─── -->
			<section class="sm-section">
				<h3 class="sm-section-heading">Chat</h3>
				<div class="sm-field">
					<span class="sm-field-label">Default placement</span>
					<div class="hkbg" role="group" aria-label="Chat placement">
						{#each [{ value: 'floating', label: 'Floating' }, { value: 'side', label: 'Side panel' }, { value: 'overlay', label: 'Overlay' }] as option (option.value)}
							<button
								class="hkbg-item"
								class:is-active={settings.chatPlacement === option.value}
								aria-pressed={settings.chatPlacement === option.value}
								onclick={() => setChatPlacement(option.value as 'floating' | 'side' | 'overlay')}
							>
								{option.label}
							</button>
						{/each}
					</div>
					<p class="sm-hint">Takes effect when chat next opens</p>
				</div>
			</section>

			<div class="sm-sep" role="separator"></div>

			<!-- ─── Notifications ─── -->
			<section class="sm-section">
				<h3 class="sm-section-heading">Notifications</h3>
				<div class="sm-row">
					<label class="sm-row-label" for="sm-notif-toggle">In-app notifications</label>
					<button
						id="sm-notif-toggle"
						class="sm-switch"
						role="switch"
						aria-checked={settings.notificationsInApp}
						aria-label="In-app notifications"
						onclick={() => setNotificationsInApp(!settings.notificationsInApp)}
					>
						<span class="sm-switch-thumb" class:is-on={settings.notificationsInApp}></span>
					</button>
				</div>
			</section>
		</div>
	</div>
</div>

<style>
	.sm-scrim {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
	}

	.sm-panel {
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		width: 100%;
		max-width: 460px;
		max-height: calc(100vh - 32px);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: sm-in 160ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
	}

	@keyframes sm-in {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Header */
	.sm-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px 14px;
		border-bottom: 1px solid var(--line-1);
		flex-shrink: 0;
	}

	.sm-title {
		font: 600 15px var(--font-sans);
		color: var(--fg-1);
		margin: 0;
	}

	.sm-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: 0;
		background: transparent;
		color: var(--fg-3);
		border-radius: var(--radius-sm, 4px);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.sm-close:hover {
		background: var(--paper-2);
		color: var(--fg-1);
	}

	.sm-close:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.sm-close svg {
		width: 16px;
		height: 16px;
	}

	/* Body */
	.sm-body {
		flex: 1;
		overflow-y: auto;
	}

	/* Sections */
	.sm-section {
		padding: 16px 20px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.sm-section-heading {
		font: 600 12px var(--font-sans);
		color: var(--fg-3);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		margin: 0 0 2px;
	}

	.sm-sep {
		height: 1px;
		background: var(--line-1);
	}

	/* Row: label + control side by side */
	.sm-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.sm-row-label {
		font: 500 13px var(--font-sans);
		color: var(--fg-2);
	}

	/* Field: label stacked above control */
	.sm-field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.sm-field-label {
		font: 500 12px var(--font-sans);
		color: var(--fg-2);
	}

	.sm-hint {
		font: 400 12px var(--font-sans);
		color: var(--fg-4);
		margin: 0;
	}

	/* Segmented control — mirrors TopBar .hkbg / .hkbg-item */
	.hkbg {
		display: inline-flex;
		padding: 3px;
		background: var(--paper-1);
		border: 1px solid var(--line-1);
		border-radius: 8px;
		width: 100%;
	}

	.hkbg-item {
		flex: 1;
		font: 500 13px/1 var(--font-sans);
		padding: 7px 10px;
		border-radius: 5px;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--fg-3);
		transition: background var(--dur-fast, 140ms), color var(--dur-fast, 140ms), box-shadow var(--dur-fast, 140ms);
		white-space: nowrap;
		text-align: center;
	}

	.hkbg-item:hover:not(.is-active) {
		color: var(--fg-1);
	}

	.hkbg-item.is-active {
		background: var(--paper-0);
		color: var(--ink-0);
		box-shadow: 0 1px 2px rgba(20, 19, 15, 0.06), 0 0 0 1px var(--line-1);
	}

	.hkbg-item:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	/* Switch toggle */
	.sm-switch {
		position: relative;
		display: inline-flex;
		align-items: center;
		width: 40px;
		height: 22px;
		padding: 0;
		border: 1px solid var(--line-2);
		border-radius: 999px;
		background: var(--paper-2);
		cursor: pointer;
		transition: background var(--dur-fast), border-color var(--dur-fast);
		flex-shrink: 0;
	}

	.sm-switch[aria-checked="true"] {
		background: var(--accent);
		border-color: var(--accent);
	}

	.sm-switch:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	.sm-switch-thumb {
		position: absolute;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 999px;
		background: var(--paper-0);
		box-shadow: 0 1px 2px rgba(20, 19, 15, 0.12), 0 0 0 1px var(--line-1);
		transition: left var(--dur-base, 200ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.sm-switch-thumb.is-on {
		left: calc(100% - 18px);
	}

	/* Accent swatches */
	.swatch-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.swatch {
		position: relative;
		width: 32px;
		height: 32px;
		border-radius: 999px;
		background: var(--swatch);
		border: 2px solid transparent;
		cursor: pointer;
		padding: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: transform var(--dur-fast, 140ms), box-shadow var(--dur-fast, 140ms), border-color var(--dur-fast, 140ms);
		flex-shrink: 0;
	}

	.swatch:hover {
		transform: scale(1.1);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--swatch) 35%, transparent);
	}

	.swatch.is-selected {
		border-color: var(--swatch);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--swatch) 35%, transparent);
	}

	.swatch:focus-visible {
		outline: 2px solid var(--swatch);
		outline-offset: 3px;
	}

	.swatch-check {
		width: 12px;
		height: 12px;
		color: #fff;
		filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.25));
	}
</style>
