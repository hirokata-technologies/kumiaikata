export type Quadrant = 'quick-win' | 'big-bet' | 'fill-in' | 'money-pit';

export const QUADRANT_LABELS: Record<Quadrant, string> = {
	'quick-win': 'Quick win',
	'big-bet': 'Big bet',
	'fill-in': 'Fill-in',
	'money-pit': 'Money pit'
};

/**
 * Derives a Project's impact/effort quadrant. Both boundaries are inclusive: impact >= 50
 * counts as high impact, effort <= 5 counts as low effort — so impact = 50, effort = 5
 * resolves deterministically to `quick-win`.
 *
 * There is no quadrant colour: all four labels render identically, and the scatter dots
 * are coloured by priority, not by quadrant.
 */
export function quadrantOf(impact: number, effort: number): Quadrant {
	const hi = impact >= 50;
	const lo = effort <= 5;
	if (hi && lo) return 'quick-win';
	if (hi) return 'big-bet';
	if (lo) return 'fill-in';
	return 'money-pit';
}
