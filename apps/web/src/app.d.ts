import type { Session, User } from "better-auth";

declare global {
	namespace App {
		interface Error {
			message: string;
			eventId?: string;
		}
		interface Locals {
			// `isOnboardingDone` is a Better Auth additionalField (see apps/api/src/auth/better-auth.ts).
			user: (User & { isOnboardingDone?: boolean | null }) | null;
			session: Session | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
