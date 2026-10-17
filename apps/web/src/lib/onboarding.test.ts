import { describe, expect, it } from 'vitest';
import { DEFINED_LEVELS, EXAMPLES, GENERATED_LEVELS, canAdvance, tipsFor } from './onboarding';

const base = { pm: null, ai: null, goal: '', hasExample: false, keptCount: 3, approved: false, structureRead: true };

describe('canAdvance', () => {
	it('needs both profile answers on step 0', () => {
		expect(canAdvance(0, base)).toBe(false);
		expect(canAdvance(0, { ...base, pm: 0 })).toBe(false);
		expect(canAdvance(0, { ...base, pm: 0, ai: 1 })).toBe(true);
	});

	it('holds step 1 until the reading timer has run out', () => {
		expect(canAdvance(1, { ...base, structureRead: false })).toBe(false);
		expect(canAdvance(1, base)).toBe(true);
	});

	it('needs a non-empty goal on step 3', () => {
		expect(canAdvance(3, { ...base, hasExample: true, goal: '' })).toBe(false);
		expect(canAdvance(3, { ...base, hasExample: true, goal: 'Ship it' })).toBe(true);
	});

	it('needs at least one kept requirement on step 5', () => {
		expect(canAdvance(5, { ...base, keptCount: 0 })).toBe(false);
		expect(canAdvance(5, base)).toBe(true);
	});

	it('needs the plan approved on step 6', () => {
		expect(canAdvance(6, base)).toBe(false);
		expect(canAdvance(6, { ...base, approved: true })).toBe(true);
	});

	it('never blocks the informational steps', () => {
		for (const step of [2, 4, 7]) expect(canAdvance(step, base)).toBe(true);
	});
});

describe('tipsFor', () => {
	it('adapts the step 1 tip to PM experience', () => {
		expect(tipsFor(1, true, false)[0].title).toBe('Start with the goal');
		expect(tipsFor(1, false, false)[0].title).toBe('What differs here');
	});

	it('returns no tips for the first step and the last', () => {
		expect(tipsFor(0, true, true)).toEqual([]);
		expect(tipsFor(7, true, true)).toEqual([]);
	});

	it('stacks both requirement tips for a total beginner', () => {
		expect(tipsFor(5, true, true)).toHaveLength(2);
		expect(tipsFor(5, false, false)).toEqual([]);
	});
});

describe('LEVELS', () => {
	it('has the user define only the goal and project, in that order', () => {
		expect(DEFINED_LEVELS.map((l) => l.name)).toEqual(['Goal', 'Project']);
	});

	it('leaves requirements, plans and tasks to the PM and Strategist', () => {
		expect(GENERATED_LEVELS.map((l) => [l.name, l.by])).toEqual([
			['Requirement', 'Project Manager'],
			['Plan', 'Strategist'],
			['Task', 'Strategist'],
		]);
	});
});

describe('EXAMPLES', () => {
	it('each has three requirements and a plan with tasks', () => {
		for (const e of EXAMPLES) {
			expect(e.reqs).toHaveLength(3);
			expect(e.plan.tasks.length).toBeGreaterThan(0);
		}
	});
});
