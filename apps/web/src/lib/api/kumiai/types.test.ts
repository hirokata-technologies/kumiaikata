import { describe, expect, it } from 'vitest';
import { qs } from './types.js';

describe('qs', () => {
	it('returns an empty string for undefined params', () => {
		expect(qs(undefined)).toBe('');
	});

	it('returns an empty string when every value is undefined or null', () => {
		expect(qs({ goalId: undefined, status: null })).toBe('');
	});

	it('builds a query string from defined values', () => {
		expect(qs({ goalId: 'abc', status: 'todo' })).toBe('?goalId=abc&status=todo');
	});

	it('skips undefined/null values but keeps the rest', () => {
		expect(qs({ goalId: undefined, status: 'blocked' })).toBe('?status=blocked');
	});

	it('URL-encodes special characters — the search term especially', () => {
		expect(qs({ q: 'a b&c=d' })).toBe('?q=a+b%26c%3Dd');
	});

	it('stringifies non-string values', () => {
		expect(qs({ page: 2, active: true })).toBe('?page=2&active=true');
	});
});
