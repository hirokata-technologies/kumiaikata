import type { LabelId, AvatarId, LabelDef, AvatarDef, KataCard, KataColumn } from './types.js';

export const LABELS: Record<LabelId, LabelDef> = {
	home:     { name: 'Home',     fg: '#3F6B4A', bg: 'rgba(63,107,74,0.10)' },
	health:   { name: 'Health',   fg: '#3F6B4A', bg: 'rgba(63,107,74,0.10)' },
	errand:   { name: 'Errand',   fg: '#B07A2A', bg: 'rgba(176,122,42,0.12)' },
	finance:  { name: 'Finance',  fg: '#4A463E', bg: 'rgba(74,70,62,0.10)' },
	work:     { name: 'Work',     fg: '#2E3A6B', bg: 'rgba(46,58,107,0.10)' },
	learning: { name: 'Learning', fg: '#2E3A6B', bg: 'rgba(46,58,107,0.10)' },
	social:   { name: 'Social',   fg: '#9B3B2E', bg: 'rgba(155,59,46,0.10)' },
	creative: { name: 'Creative', fg: '#76716A', bg: 'rgba(118,113,106,0.14)' },
};

export const AVATARS: Record<AvatarId, AvatarDef> = {
	me: { name: 'You',  init: 'Y', tone: '#2E3A6B' },
	m:  { name: 'Maya', init: 'M', tone: '#9B3B2E' },
	d:  { name: 'Dad',  init: 'D', tone: '#3F6B4A' },
	r:  { name: 'Ren',  init: 'R', tone: '#B07A2A' },
};

let _id = 100;
export function newCardId(): string { return `c${++_id}`; }

export function todayISO(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function parseISO(iso: string): Date {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(y, m - 1, d);
}

export function daysBetween(a: Date, b: Date): number {
	const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
	const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
	return Math.round((db.getTime() - da.getTime()) / 86400000);
}

export interface DueInfo { label: string; tone: 'overdue' | 'today' | 'soon' | 'later'; diff: number }

export function formatDue(iso: string | undefined): DueInfo | null {
	if (!iso) return null;
	const due = parseISO(iso);
	const today = new Date();
	const diff = daysBetween(today, due);
	let label: string;
	let tone: DueInfo['tone'];
	if (diff < 0) {
		const n = Math.abs(diff);
		label = n === 1 ? 'Yesterday' : `${n}d overdue`;
		tone = 'overdue';
	} else if (diff === 0) {
		label = 'Today'; tone = 'today';
	} else if (diff === 1) {
		label = 'Tomorrow'; tone = 'soon';
	} else if (diff < 7) {
		const wkdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
		label = wkdays[due.getDay()]; tone = 'soon';
	} else {
		const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		label = `${months[due.getMonth()]} ${due.getDate()}`;
		if (due.getFullYear() !== today.getFullYear()) label += `, ${due.getFullYear()}`;
		tone = 'later';
	}
	return { label, tone, diff };
}

export function parseDueFromText(text: string): string | null {
	const t = text.toLowerCase();
	const today = new Date();
	const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
	const addDays = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
	const wkmap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
	if (/\btoday\b/.test(t)) return iso(today);
	if (/\btomorrow\b/.test(t)) return iso(addDays(1));
	if (/\bnext week\b/.test(t)) return iso(addDays(7));
	if (/\bthis weekend\b/.test(t)) { const dow = today.getDay(); return iso(addDays((6 - dow + 7) % 7 || 6)); }
	const wkMatch = t.match(/\b(?:by |on |this |next )?(sun|mon|tue|wed|thu|fri|sat)(?:day|nesday|sday|urday|tuesday)?\b/);
	if (wkMatch) {
		const target = wkmap[wkMatch[1]]; const dow = today.getDay();
		let add = (target - dow + 7) % 7; if (add === 0) add = 7;
		return iso(addDays(add));
	}
	const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
	const mMatch = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(?:[a-z]*)?\s+(\d{1,2})\b/);
	if (mMatch) {
		const m = months.indexOf(mMatch[1].slice(0,3));
		const d = parseInt(mMatch[2], 10);
		const yr = today.getFullYear() + (m < today.getMonth() ? 1 : 0);
		return iso(new Date(yr, m, d));
	}
	const inDays = t.match(/\bin (\d+) days?\b/);
	if (inDays) return iso(addDays(parseInt(inDays[1], 10)));
	return null;
}

export const SEED_COLUMNS: KataColumn[] = [
	{
		id: 'backlog', title: 'Backlog',
		cards: [
			{ id: 'c1', title: 'Plan Kyoto trip itinerary for autumn', desc: 'Three nights minimum. Want to hit Ginkaku-ji and at least one tea house off the tourist track.', labels: ['social','learning'], assignee: 'me', due: '2026-09-15' },
			{ id: 'c2', title: 'Replace bathroom faucet', desc: '', labels: ['home'], assignee: 'me' },
			{ id: 'c3', title: 'Start sourdough starter again', desc: 'The last one died in March. Try keeping it in the cooler corner this time.', labels: ['home','creative'], assignee: 'me' },
			{ id: 'c4', title: "Read 'The Mountain in the Sea'", desc: '', labels: ['learning'], assignee: 'me' },
			{ id: 'c5', title: 'Look into bike tune-up shops in the East End', desc: '', labels: ['errand'], assignee: 'me' },
		],
	},
	{
		id: 'todo', title: 'To do',
		cards: [
			{ id: 'c10', title: 'Renew passport before May 14', desc: 'Need new photos. Form DS-82 (renewal by mail eligible).', labels: ['errand','finance'], assignee: 'me', due: '2026-05-14' },
			{ id: 'c11', title: 'Schedule dental cleaning', desc: '', labels: ['health'], assignee: 'me', due: '2026-05-29' },
			{ id: 'c12', title: 'Reply to Maya about dinner Saturday', desc: 'She suggested the new izakaya on Main. Confirm 7pm or push to 8.', labels: ['social'], assignee: 'm', due: '2026-05-23' },
			{ id: 'c13', title: 'Order replacement HVAC filter (MERV 11, 16×25×1)', desc: '', labels: ['home'], assignee: 'me', due: '2026-06-05' },
		],
	},
	{
		id: 'doing', title: 'In progress',
		cards: [
			{ id: 'c20', title: 'Tax docs — gather 1099s and brokerage statements', desc: 'Have Fidelity, still need Wealthfront and the freelance 1099-NEC from Q3 contract.', labels: ['finance'], assignee: 'me', due: '2026-05-22' },
			{ id: 'c21', title: 'Sketchbook study #14 — kettle on the stove', desc: 'Stuck on the reflection on the copper. Try a softer pencil pass tomorrow morning.', labels: ['creative','learning'], assignee: 'me' },
			{ id: 'c22', title: 'Fix leaky kitchen sink', desc: 'New supply line ordered. Arriving Thursday.', labels: ['home'], assignee: 'd', due: '2026-05-28' },
		],
	},
	{
		id: 'done', title: 'Done',
		cards: [
			{ id: 'c30', title: 'Pay quarterly estimated taxes (Q1)', desc: '', labels: ['finance'], assignee: 'me', due: '2026-04-15' },
			{ id: 'c31', title: 'Pick up dry cleaning', desc: '', labels: ['errand'], assignee: 'me' },
			{ id: 'c32', title: 'Submit reimbursement for the Tokyo books', desc: '', labels: ['finance','learning'], assignee: 'me' },
			{ id: 'c33', title: 'Call landlord about radiator', desc: '', labels: ['home'], assignee: 'me' },
		],
	},
];

export const QUICK_REPLIES = [
	{ label: 'Summarize today', value: '/summarize' },
	{ label: "What's blocked?", value: "What's blocked right now?" },
	{ label: 'Prioritize this week', value: '/prioritize' },
	{ label: 'Add a task…', value: '/add ' },
];

export const SLASH_COMMANDS = [
	{ cmd: '/summarize',  hint: 'Summarize the board state' },
	{ cmd: '/prioritize', hint: 'Suggest what to do first' },
	{ cmd: '/add',        hint: 'Create a new card from a description' },
	{ cmd: '/move',       hint: 'Move a card to another column' },
	{ cmd: '/break',      hint: 'Break a card into steps' },
	{ cmd: '/draft',      hint: 'Draft a card description' },
];

export function pickLabels(text: string): LabelId[] {
	const t = text.toLowerCase();
	const guesses: LabelId[] = [];
	if (/\b(call|email|reply|message|dinner|coffee|meet|friend|family|maya|dad|mom|ren)\b/.test(t)) guesses.push('social');
	if (/\b(dentist|doctor|appointment|gym|run|yoga|sleep|workout)\b/.test(t)) guesses.push('health');
	if (/\b(faucet|sink|hvac|laundry|kitchen|bathroom|apartment|landlord|filter|clean)\b/.test(t)) guesses.push('home');
	if (/\b(buy|order|pickup|pick up|drop off|return|errand|store|shop)\b/.test(t)) guesses.push('errand');
	if (/\b(tax|invoice|reimburse|venmo|bill|pay|bank|brokerage|1099)\b/.test(t)) guesses.push('finance');
	if (/\b(read|book|paper|course|study|learn|practice|sketch|draw)\b/.test(t)) guesses.push('learning');
	if (/\b(deck|client|launch|spec|prd|standup|pr)\b/.test(t)) guesses.push('work');
	return guesses.length ? [...new Set(guesses)].slice(0, 2) as LabelId[] : ['errand'];
}

export function deepCloneColumns(columns: KataColumn[]): KataColumn[] {
	return columns.map(c => ({ ...c, cards: c.cards.map(card => ({ ...card, labels: [...card.labels] })) }));
}
