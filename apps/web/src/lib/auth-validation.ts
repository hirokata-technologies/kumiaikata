/**
 * Pure form-validation helpers shared across the auth pages.
 * Extracting these from Svelte reactive state makes them unit-testable.
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 256;

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export function validateEmail(value: string): string | null {
	if (!value.trim()) return 'Email is required.';
	if (!EMAIL_RE.test(value)) return 'Please enter a valid email address.';
	return null;
}

// ---------------------------------------------------------------------------
// Password (sign-up / reset)
// ---------------------------------------------------------------------------

export function validatePassword(value: string): string | null {
	if (!value) return 'Password is required.';
	if (value.length < PASSWORD_MIN)
		return `Password must be at least ${PASSWORD_MIN} characters.`;
	if (value.length > PASSWORD_MAX)
		return `Password must be no longer than ${PASSWORD_MAX} characters.`;
	return null;
}

// ---------------------------------------------------------------------------
// Confirm password
// ---------------------------------------------------------------------------

export function validateConfirmPassword(
	value: string,
	original: string,
): string | null {
	if (!value) return 'Please confirm your password.';
	if (value !== original) return 'Passwords do not match.';
	return null;
}

// ---------------------------------------------------------------------------
// Name (sign-up only)
// ---------------------------------------------------------------------------

export function validateName(value: string): string | null {
	if (!value.trim()) return 'Name is required.';
	return null;
}

// ---------------------------------------------------------------------------
// Sign-up form validity (all fields must be individually valid)
// ---------------------------------------------------------------------------

export function isSignUpFormValid(
	name: string,
	email: string,
	password: string,
): boolean {
	return (
		validateName(name) === null &&
		validateEmail(email) === null &&
		validatePassword(password) === null
	);
}

// ---------------------------------------------------------------------------
// Reset-password form validity
// ---------------------------------------------------------------------------

export function isResetPasswordFormValid(
	newPassword: string,
	confirmPassword: string,
): boolean {
	return (
		validatePassword(newPassword) === null &&
		validateConfirmPassword(confirmPassword, newPassword) === null
	);
}

// ---------------------------------------------------------------------------
// Error-code to user-facing message maps (login page)
// ---------------------------------------------------------------------------

export const LOGIN_ERROR_MESSAGES: Record<string, string> = {
	access_denied: 'Sign-in was cancelled. Click below to try again.',
	state_mismatch: 'Your sign-in session expired. Please try again.',
	DOMAIN_NOT_ALLOWED: 'Sign-ins from this email domain are not permitted.',
	UNAUTHENTICATED: 'You need to sign in to continue.',
	INVALID_EMAIL_OR_PASSWORD: 'Incorrect email or password.',
	EMAIL_NOT_VERIFIED:
		'Please verify your email before signing in. Check your inbox or request a new verification email.',
};

export const SIGNUP_ERROR_MESSAGES: Record<string, string> = {
	USER_ALREADY_EXISTS: 'An account with this email already exists.',
	DOMAIN_NOT_ALLOWED: 'Sign-ups from this email domain are not permitted.',
};

export const RESET_PASSWORD_ERROR_MESSAGES: Record<string, string> = {
	INVALID_TOKEN: 'This reset link is invalid or has already been used.',
	TOKEN_EXPIRED: 'This reset link has expired. Please request a new one.',
};

export const GENERIC_ERROR = 'Something went wrong. Please try again.';

export function resolveErrorMessage(
	code: string,
	map: Record<string, string>,
): string {
	return map[code] ?? GENERIC_ERROR;
}

// ---------------------------------------------------------------------------
// Token error detection (reset-password page)
// ---------------------------------------------------------------------------

export function isTokenError(code: string | null): boolean {
	return code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED';
}
