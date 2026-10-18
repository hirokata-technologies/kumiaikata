import { describe, expect, it } from 'vitest';
import { parseSseChunk } from './agents.js';

describe('parseSseChunk', () => {
	it('parses complete events and keeps the partial tail', () => {
		const { events, rest } = parseSseChunk(
			'event: message\ndata: {"id":"1","author":"project_manager","text":"Hi"}\n\nevent: ping\ndata: \n\nevent: done\ndata: {"ses'
		);
		expect(events).toEqual([
			{ event: 'message', data: { id: '1', author: 'project_manager', text: 'Hi' } }
		]);
		expect(rest).toBe('event: done\ndata: {"ses');
	});

	it('skips malformed events', () => {
		const { events } = parseSseChunk('event: message\ndata: {not json\n\nevent: done\ndata: {}\n\n');
		expect(events).toEqual([{ event: 'done', data: {} }]);
	});

	it('accepts CRLF framing', () => {
		const { events } = parseSseChunk('event: done\r\ndata: {}\r\n\r\n');
		expect(events).toEqual([{ event: 'done', data: {} }]);
	});
});
