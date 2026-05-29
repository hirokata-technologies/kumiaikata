import type { Session, User } from "better-auth";

declare global {
	namespace App {
		interface Error {
			message: string;
			eventId?: string;
		}
		interface Locals {
			user: User | null;
			session: Session | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
