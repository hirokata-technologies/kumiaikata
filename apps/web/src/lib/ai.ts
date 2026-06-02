import type { KataCard, KataColumn, MessagePart, Proposal, BoardState } from './types.js';
import { LABELS, newCardId, formatDue, parseDueFromText, pickLabels } from './data.js';

function findCardByMention(state: BoardState, mention: string): { card: KataCard; col: KataColumn } | null {
	const needle = mention.replace(/^@/, '').toLowerCase();
	for (const col of state.columns) {
		for (const card of col.cards) {
			if (card.title.toLowerCase().includes(needle)) return { card, col };
		}
	}
	return null;
}

function findColumnByName(state: BoardState, name: string): KataColumn | null {
	const n = name.toLowerCase().replace(/[^a-z]/g, '');
	for (const col of state.columns) {
		const cn = col.title.toLowerCase().replace(/[^a-z]/g, '');
		if (cn === n || cn.includes(n) || n.includes(cn)) return col;
	}
	return null;
}

export function scriptAI(
	message: string,
	state: BoardState,
	ctx: { selectedCard?: KataCard | null } = {}
): MessagePart[] {
	const raw = message.trim();
	const m = raw.toLowerCase();
	const mentions = (raw.match(/@[\w-]+/g) || []);

	// /summarize
	if (/^\/summarize\b/.test(m) || /\b(summarize|summary|recap)\b/.test(m)) {
		const cols = state.columns;
		const totals = cols.map(c => `${c.cards.length} in **${c.title}**`).join(', ');
		const inprog = cols.find(c => c.id === 'doing');
		const blocked = inprog?.cards.find(c => /stuck|wait|blocked|need/i.test(c.desc || c.title));
		let body = `Here's where the board stands right now — ${totals}.\n\n`;
		body += `**Active focus** is ${inprog?.cards.length || 0} card${inprog?.cards.length === 1 ? '' : 's'} in progress. `;
		if (inprog?.cards[0]) body += `The one with the most weight is *${inprog.cards[0].title}*. `;
		if (blocked) body += `Looks like *${blocked.title}* is waiting on something — worth a glance.\n\n`;
		else body += `\n\n`;
		const todo = cols.find(c => c.id === 'todo');
		if (todo?.cards.length) body += `**Up next** in To do you've got ${todo.cards.length} items, mostly short errands and one with a hard deadline.`;
		return [{ kind: 'text', text: body, streamed: false }];
	}

	// /prioritize
	if (/^\/prioritize\b/.test(m) || /\b(priorit|what should i do|first|next)\b/.test(m)) {
		return [{
			kind: 'text', streamed: false,
			text: `Based on deadlines and what's already moving, here's the order I'd take this week:\n\n**1.** *Renew passport before May 14* — hard deadline, blocks the Kyoto trip downstream.\n**2.** *Tax docs — gather 1099s* — already in progress, finish it before context switches.\n**3.** *Reply to Maya about dinner Saturday* — five-minute task, social cost of delay.\n**4.** *Schedule dental cleaning* — easy phone call, clears mental space.\n\nEverything else can wait until next week without anything breaking.`
		}];
	}

	// /add or natural language add
	if (/^\/add\b/.test(m) || /\b(add|create|new) (?:a )?(?:card|task|todo)\b/.test(m) || (/\b(add|remind me|i need to|don't forget)\b/.test(m) && !/where|what|which|how/.test(m))) {
		let title = raw
			.replace(/^\/add\s*/i, '')
			.replace(/\b(add|create|new)\s+(a\s+)?(card|task|todo)(\s+to|\s+for)?\s*/i, '')
			.replace(/^(remind me to|i need to|don't forget to|please)\s*/i, '')
			.replace(/\bto (the )?(backlog|to ?do|in progress|doing|done)\b/i, '')
			.trim()
			.replace(/^["']|["']$/g, '');

		const due = parseDueFromText(title);
		if (due) {
			title = title
				.replace(/\b(by|on|due|before)?\s*(today|tomorrow|next week|this weekend)\b/gi, '')
				.replace(/\b(by|on|due|before)?\s*(sun|mon|tue|wed|thu|fri|sat)(?:day|nesday|sday|urday|tuesday)?\b/gi, '')
				.replace(/\b(by|on|due|before)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\b/gi, '')
				.replace(/\bin \d+ days?\b/gi, '')
				.replace(/\s+/g, ' ').replace(/[\s,]+$/g, '').trim();
		}
		title = title ? title[0].toUpperCase() + title.slice(1) : 'New task';

		let colId = 'todo';
		if (/backlog/i.test(raw)) colId = 'backlog';
		else if (/in progress|doing/i.test(raw)) colId = 'doing';
		else if (/done|finished/i.test(raw)) colId = 'done';

		const labels = pickLabels(title);
		const card: KataCard = { id: newCardId(), title, desc: '', labels, assignees: [] };
		if (due) card.due = due;
		const col = state.columns.find(c => c.id === colId);
		const proposal: Proposal = {
			type: 'create', card, columnId: colId,
			summary: `Add **${title}** to *${col?.title ?? colId}*${due ? ` · due ${formatDue(due)?.label}` : ''}`,
		};
		return [
			{ kind: 'text', streamed: false, text: due ? `Got it — I picked up the date too. Tweak anything before accepting.` : `Got it. Here's a draft — you can accept it as-is or tweak the labels first.` },
			{ kind: 'proposal', proposal },
		];
	}

	// /move
	if (/^\/move\b/.test(m) || /\bmove\b/.test(m)) {
		let card: KataCard | null = null;
		if (mentions.length) {
			const found = findCardByMention(state, mentions[0]!);
			if (found) card = found.card;
		}
		if (!card) {
			const phrase = raw.replace(/^\/move\s*/i, '').replace(/\bmove\b/i, '').replace(/\bto\b.*$/i, '').trim();
			if (phrase) {
				outer: for (const col of state.columns) {
					for (const c of col.cards) {
						if (c.title.toLowerCase().includes(phrase.toLowerCase().slice(0, 12))) { card = c; break outer; }
					}
				}
			}
		}
		const targetColName = (raw.match(/\bto\s+([\w\s]+)$/i) || [])[1] || 'In progress';
		const col = findColumnByName(state, targetColName) || state.columns.find(c => c.id === 'doing');
		if (card && col) {
			const proposal: Proposal = { type: 'move', cardId: card.id, toColumnId: col.id, summary: `Move **${card.title}** → *${col.title}*` };
			return [
				{ kind: 'text', streamed: false, text: `Sure — moving *${card.title}* into ${col.title}. Want to confirm?` },
				{ kind: 'proposal', proposal },
			];
		}
		return [{ kind: 'text', streamed: false, text: `I couldn't tell which card you meant. Try @-mentioning it, e.g. "move @passport to In progress".` }];
	}

	// /break
	if (/^\/break\b/.test(m) || /\bbreak (it |this |that |.* )?down\b/.test(m) || /\b(sub ?tasks?|steps)\b/.test(m)) {
		const target = mentions[0]
			? findCardByMention(state, mentions[0])?.card
			: (ctx.selectedCard || state.columns.find(c => c.id === 'doing')?.cards[0]);
		if (!target) return [{ kind: 'text', streamed: false, text: `Tell me which card to break down — @-mention it or open one first.` }];
		const t = target.title.toLowerCase();
		let steps: string[];
		if (t.includes('passport')) {
			steps = ['Print form DS-82 and read the photo requirements.','Get two new passport photos at the CVS on 9th.','Write the check for $130, payable to "U.S. Department of State."','Mail the old passport + form + photos + check via USPS tracked.','Save the tracking number to the Travel folder.'];
		} else if (t.includes('kyoto') || t.includes('trip')) {
			steps = ['Pick travel dates (target 9 nights in late October).','Compare flight prices on two booking tools — block off a Sunday morning.','Draft a rough day-by-day, leaving two unscheduled days.','Book one ryokan in Higashiyama before October fills up.','List tea houses that take walk-ins, then prune to three.'];
		} else if (t.includes('tax')) {
			steps = ['Download 1099s from Fidelity and Wealthfront.','Request the freelance 1099-NEC by email if it didn\'t arrive.','Reconcile against bank statements for Q3 and Q4.','Tag everything in the spreadsheet — expenses, charity, deductions.','Hand the folder to the accountant by April 7.'];
		} else {
			steps = [`Define what "done" looks like for "${target.title}" in one sentence.`,'List the parts that don\'t depend on anything else.','Order the rest by what unblocks the most.','Pick the first 30-minute slice and do it today.','Update the card description with what you actually did.'];
		}
		const proposal: Proposal = { type: 'description', cardId: target.id, text: steps.map((s, i) => `${i+1}. ${s}`).join('\n'), summary: `Add a 5-step checklist to **${target.title}**` };
		return [
			{ kind: 'text', streamed: false, text: `Here's how I'd break *${target.title}* into smaller moves:\n\n${steps.map((s, i) => `**${i+1}.** ${s}`).join('\n')}\n\nWant me to put these in the card description?` },
			{ kind: 'proposal', proposal },
		];
	}

	// /draft
	if (/^\/draft\b/.test(m) || /\b(draft|write).*(description|notes|acceptance|criteria)\b/.test(m)) {
		const target = mentions[0] ? findCardByMention(state, mentions[0])?.card : ctx.selectedCard;
		if (!target) return [{ kind: 'text', streamed: false, text: `Open a card or @-mention one and I'll draft a description for it.` }];
		const text = `**Why this matters:** keeps the next step from sitting in your head.\n\n**What "done" looks like:** ${target.title.replace(/^[^a-zA-Z]+/, '').toLowerCase()} is fully wrapped up, no follow-ups owed.\n\n**Notes / context:**\n- ${target.desc || 'No prior notes yet — add anything that future-you will thank present-you for.'}\n- Anything time-bound? Surface it on the title.`;
		const proposal: Proposal = { type: 'description', cardId: target.id, text, summary: `Replace description on **${target.title}**` };
		return [
			{ kind: 'text', streamed: false, text: `Drafted a short description for *${target.title}*:` },
			{ kind: 'proposal', proposal },
		];
	}

	// blocked
	if (/blocked|stuck|waiting|stalled/.test(m)) {
		const inprog = state.columns.find(c => c.id === 'doing');
		const candidates = inprog?.cards.filter(c => /wait|stuck|need|pending|order|arriv/i.test(c.desc || c.title)) ?? [];
		if (candidates.length) {
			return [{ kind: 'text', streamed: false, text: `Two things look like they're waiting on something:\n\n${candidates.map(c => `• *${c.title}* — ${/wait|order|arriv/i.test(c.desc) ? c.desc : 'see card notes'}`).join('\n')}\n\nNothing else looks blocked — most of In progress is just waiting on you.` }];
		}
		return [{ kind: 'text', streamed: false, text: `Nothing looks externally blocked. The only thing slowing you down is context-switching.` }];
	}

	// @mention without verb
	if (mentions.length) {
		const found = findCardByMention(state, mentions[0]!);
		if (found) {
			const { card, col } = found;
			const labelText = card.labels.map(l => LABELS[l]?.name).filter(Boolean).join(', ');
			return [{ kind: 'text', streamed: false, text: `*${card.title}* is in **${col.title}**${labelText ? ` and tagged ${labelText}` : ''}.${card.desc ? `\n\n> ${card.desc}` : '\n\nNo description yet.'}` }];
		}
	}

	if (/^(hi|hey|hello|yo)\b/.test(m)) return [{ kind: 'text', streamed: false, text: `Morning. What are we tackling first?` }];
	if (/thank/.test(m)) return [{ kind: 'text', streamed: false, text: `Anytime. I'll be here.` }];

	return [{ kind: 'text', streamed: false, text: `I can help with a few things — try:\n\n• **/summarize** to get a read on the board\n• **/prioritize** for what to do first\n• **/add buy bread** to create a card\n• **/move** with an @mention to shift one\n• **/break down** an open card into steps\n\nOr just ask in plain English.` }];
}
