import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import type { BoardContext } from '$lib/ai/board-context.js';
import { countCards } from '$lib/ai/board-context.js';

const SYSTEM_PROMPT = `You are a project management assistant that analyzes kanban boards.
Given a board state with columns and cards, provide:
1. Key insights about the work distribution, bottlenecks, and progress
2. Notable patterns or concerns (e.g., overloaded columns, stale work, label clusters)
3. A brief summary of the overall state of the board

Be concise and actionable. Focus on what matters most to the team.`;

export const POST: RequestHandler = async ({ request }) => {
	// Guard: API key must be configured
	if (!env.MINIMAX_API_KEY) {
		return new Response(JSON.stringify({ error: 'AI is not configured.' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Parse and validate the request body
	let board: BoardContext;
	try {
		const body: { board: BoardContext } = await request.json();
		board = body.board;
		if (!board || typeof board !== 'object') {
			return new Response(JSON.stringify({ error: 'Invalid board payload.' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Guard: board.columns must be an array
	if (!Array.isArray(board.columns)) {
		return new Response(JSON.stringify({ error: 'Invalid board payload.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Guard: board must not exceed the card limit
	const cardCount = countCards(board);
	if (cardCount > 500) {
		return new Response(JSON.stringify({ error: 'Board is too large to analyze.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Guard: board must have at least one card
	if (cardCount === 0) {
		return new Response(JSON.stringify({ error: 'There is nothing to analyze yet.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let stream: AsyncIterable<Anthropic.MessageStreamEvent>;
	try {
		const client = new Anthropic({
			apiKey: env.MINIMAX_API_KEY,
			baseURL: 'https://api.minimax.io/anthropic'
		});

		stream = await client.messages.create({
			model: 'minimax-m3',
			max_tokens: 1024,
			thinking: { type: 'disabled' },
			system: SYSTEM_PROMPT,
			messages: [
				{
					role: 'user',
					content: `Analyze this board and give insights plus a brief summary.\n\n${JSON.stringify(board, null, 2)}`
				}
			],
			stream: true
		});
	} catch {
		return new Response(JSON.stringify({ error: 'Analysis failed. Please try again.' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const encoder = new TextEncoder();
	return new Response(
		new ReadableStream({
			async start(controller) {
				try {
					for await (const event of stream) {
						if (
							event.type === 'content_block_delta' &&
							event.delta?.type === 'text_delta'
						) {
							controller.enqueue(
								encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
							);
						}
					}
					controller.enqueue(encoder.encode('data: [DONE]\n\n'));
				} catch {
					// Stream interrupted: surface a user-friendly error without leaking details.
					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({ error: 'Analysis was interrupted.' })}\n\n`
						)
					);
					controller.enqueue(encoder.encode('data: [DONE]\n\n'));
				} finally {
					controller.close();
				}
			}
		}),
		{
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive'
			}
		}
	);
};
