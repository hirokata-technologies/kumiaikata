import { MongoClient, type Db, type ClientSession } from "mongodb";
import { env } from "../env.js";

export const client = new MongoClient(env.MONGODB_URI);
let connected = false;
let dbInstance: Db | null = null;

export async function connectDB(): Promise<Db> {
	if (connected && dbInstance) return dbInstance;
	await client.connect();
	dbInstance = client.db(); // default db from URI
	connected = true;
	console.log("[mongodb] connected");
	return dbInstance;
}

export function getDb(): Db {
	if (!dbInstance) throw new Error("[mongodb] connectDB() must be awaited before getDb()");
	return dbInstance;
}

// Convenience export for code that runs after startup completes.
// The Proxy defers resolution of the Db instance to first access,
// which only happens on HTTP requests arriving after connectDB() resolves.
export const db: Db = new Proxy({} as Db, {
	get(_t, prop) {
		return Reflect.get(getDb(), prop);
	},
});

export async function withTransaction<T>(
	cb: (session: ClientSession) => Promise<T>,
): Promise<T> {
	const session = client.startSession();
	let callbackError: unknown;
	try {
		return await session.withTransaction(cb);
	} catch (err) {
		callbackError = err;
		throw err;
	} finally {
		try {
			await session.endSession();
		} catch (endErr) {
			if (!callbackError) throw endErr;
			// suppress endSession error — original error already thrown
		}
	}
}

export async function disconnect(): Promise<void> {
	if (!connected) return;
	await client.close();
	connected = false;
	dbInstance = null;
	console.log("[mongodb] disconnected");
}
