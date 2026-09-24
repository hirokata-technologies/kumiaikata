import { describe, it, expect } from 'vitest';
import * as kumiai from './index.js';

describe('kumiai barrel', () => {
	it('re-exports every public symbol', () => {
		expect(typeof kumiai.statusPill).toBe('function');
		expect(typeof kumiai.projectPriorityPill).toBe('function');
		expect(typeof kumiai.priorityLevelPill).toBe('function');
		expect(typeof kumiai.quadrantOf).toBe('function');
		expect(kumiai.QUADRANT_LABELS).toBeDefined();
		expect(typeof kumiai.notchBar).toBe('function');
		expect(kumiai.NOTCH_SEGMENTS).toBe(10);
		expect(typeof kumiai.NOTCH_ON).toBe('string');
		expect(typeof kumiai.NOTCH_OFF).toBe('string');
		expect(typeof kumiai.approvalPill).toBe('function');
		expect(typeof kumiai.deriveTargetWindowLabel).toBe('function');
		expect(typeof kumiai.formatTargetWindow).toBe('function');
		expect(typeof kumiai.formatTargetWindowLong).toBe('function');
	});
});
