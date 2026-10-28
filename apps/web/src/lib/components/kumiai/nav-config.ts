/**
 * Lucide icon names, kept as strings rather than component references — `nav-config.ts`
 * is a plain `.ts` module with no svelte plugin in `vitest.config.ts`, so it must not
 * import any `.svelte` file (lucide icons included) or it becomes unimportable from a
 * test. The NavItem component maps these names to actual icon components.
 */
export type NavIconName = 'ScatterChart' | 'Map';

export interface NavEntry {
	label: string;
	href: string;
	icon: NavIconName;
}

/** "Planning" group — the sidebar's project-management views. */
export const NAV_PLANNING: NavEntry[] = [
	{ label: 'Goals & Projects', href: '/roadmap', icon: 'Map' },
	{ label: 'Impact & effort', href: '/matrix', icon: 'ScatterChart' }
];

/**
 * Exact match, or nested under `href` — `/projects/abc123` marks `/projects` active,
 * but `/roadmaps` must NOT mark `/roadmap` active. Root `/` is excluded from the prefix
 * check so every route wouldn't otherwise match it.
 */
export function isActive(pathname: string, href: string): boolean {
	if (href === '/') return pathname === '/';
	return pathname === href || pathname.startsWith(`${href}/`);
}
