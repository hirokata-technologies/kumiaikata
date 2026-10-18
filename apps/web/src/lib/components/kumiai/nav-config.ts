import type { KumiaiStats } from '$lib/api/kumiai/types.js';

export type ProjectCounts = KumiaiStats['projectCounts'];

/**
 * Lucide icon names, kept as strings rather than component references — `nav-config.ts`
 * is a plain `.ts` module with no svelte plugin in `vitest.config.ts`, so it must not
 * import any `.svelte` file (lucide icons included) or it becomes unimportable from a
 * test. The Sidebar component maps these names to actual icon components.
 */
export type NavIconName =
	| 'CalendarDays'
	| 'Inbox'
	| 'ListChecks'
	| 'Columns3'
	| 'ScatterChart'
	| 'Map'
	| 'Folder';

export interface NavEntry {
	label: string;
	href: string;
	icon: NavIconName;
	badge?: keyof ProjectCounts;
}

/** "Views" group — the top nav section. */
export const NAV_VIEWS: NavEntry[] = [
	{ label: 'This week', href: '/week', icon: 'CalendarDays' },
	{ label: 'Backlog', href: '/backlog', icon: 'Inbox', badge: 'backlog' },
	{ label: 'To do', href: '/todo', icon: 'ListChecks', badge: 'todo' },
	{ label: 'In progress', href: '/board', icon: 'Columns3', badge: 'inProgress' }
];

/**
 * "Planning" group. `Projects` has no static `href` — its destination is the most
 * recently opened project, resolved by the caller from `recentProjects` — so it is
 * modeled separately as `NAV_PROJECTS_ENTRY` rather than carrying a fixed `href` here.
 */
export const NAV_PLANNING: NavEntry[] = [
	{ label: 'Roadmap', href: '/roadmap', icon: 'Map' },
	{ label: 'Impact & effort', href: '/matrix', icon: 'ScatterChart' }
];

export const NAV_PROJECTS_ENTRY: { label: string; icon: NavIconName } = {
	label: 'Projects',
	icon: 'Folder'
};

/**
 * Exact match, or nested under `href` — `/projects/abc123` marks `/projects` active,
 * but `/weekly` must NOT mark `/week` active. Root `/` is excluded from the prefix
 * check so every route wouldn't otherwise match it.
 */
export function isActive(pathname: string, href: string): boolean {
	if (href === '/') return pathname === '/';
	return pathname === href || pathname.startsWith(`${href}/`);
}
