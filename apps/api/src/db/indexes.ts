import {
	boards,
	cards,
	columns,
	labels,
	attachments,
	teams,
	teamMembers,
} from "./schemas/index.js";

export async function ensureIndexes(): Promise<void> {
	try {
		// teams.domain — unique
		await teams().createIndex({ domain: 1 }, { unique: true });
	} catch (err) {
		throw new Error(
			`[ensureIndexes] Failed to create index on "teams": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		// teamMembers — composite unique (teamId, userId) + single-field indexes
		await teamMembers().createIndex({ teamId: 1, userId: 1 }, { unique: true });
	} catch (err) {
		throw new Error(
			`[ensureIndexes] Failed to create index on "teamMembers": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		await teamMembers().createIndex({ teamId: 1 });
	} catch (err) {
		throw new Error(
			`[ensureIndexes] Failed to create index on "teamMembers": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		await teamMembers().createIndex({ userId: 1 });
	} catch (err) {
		throw new Error(
			`[ensureIndexes] Failed to create index on "teamMembers": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		// boards — two partial unique indexes
		await boards().createIndex(
			{ ownerId: 1 },
			{ unique: true, partialFilterExpression: { kind: "personal" } },
		);
	} catch (err) {
		throw new Error(
			`[ensureIndexes] Failed to create index on "boards": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		await boards().createIndex(
			{ teamId: 1 },
			{ unique: true, partialFilterExpression: { kind: "team" } },
		);
	} catch (err) {
		throw new Error(
			`[ensureIndexes] Failed to create index on "boards": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		// columns — boardId index + compound (boardId, position)
		await columns().createIndex({ boardId: 1 });
	} catch (err) {
		throw new Error(
			`[ensureIndexes] Failed to create index on "columns": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		await columns().createIndex({ boardId: 1, position: 1 });
	} catch (err) {
		throw new Error(
			`[ensureIndexes] Failed to create index on "columns": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		// cards — boardId, columnId, compound (columnId, position)
		await cards().createIndex({ boardId: 1 });
	} catch (err) {
		throw new Error(
			`[ensureIndexes] Failed to create index on "cards": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		await cards().createIndex({ columnId: 1 });
	} catch (err) {
		throw new Error(
			`[ensureIndexes] Failed to create index on "cards": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		await cards().createIndex({ columnId: 1, position: 1 });
	} catch (err) {
		throw new Error(
			`[ensureIndexes] Failed to create index on "cards": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		// labels — boardId
		await labels().createIndex({ boardId: 1 });
	} catch (err) {
		throw new Error(
			`[ensureIndexes] Failed to create index on "labels": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		// attachments — cardId + boardId
		await attachments().createIndex({ cardId: 1 });
	} catch (err) {
		throw new Error(
			`[ensureIndexes] Failed to create index on "attachments": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		await attachments().createIndex({ boardId: 1 });
	} catch (err) {
		throw new Error(
			`[ensureIndexes] Failed to create index on "attachments": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	console.log("[mongodb] ensureIndexes complete");
}
