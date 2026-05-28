import { describe, it, expect } from 'vitest';
import {
	validateEmail,
	validatePassword,
	validateConfirmPassword,
	validateName,
	isSignUpFormValid,
	isResetPasswordFormValid,
	resolveErrorMessage,
	isTokenError,
	LOGIN_ERROR_MESSAGES,
	SIGNUP_ERROR_MESSAGES,
	RESET_PASSWORD_ERROR_MESSAGES,
	GENERIC_ERROR,
	PASSWORD_MIN,
	PASSWORD_MAX,
} from './auth-validation.js';

// ---------------------------------------------------------------------------
// validateEmail
// ---------------------------------------------------------------------------

describe('validateEmail', () => {
	it('returns null for a valid email', () => {
		expect(validateEmail('alice@example.com')).toBeNull();
	});

	it('returns required error for empty string', () => {
		expect(validateEmail('')).toBe('Email is required.');
	});

	it('returns required error for whitespace-only string', () => {
		expect(validateEmail('   ')).toBe('Email is required.');
	});

	it('returns format error for email without @', () => {
		expect(validateEmail('notanemail')).toBe('Please enter a valid email address.');
	});

	it('returns format error for email without TLD (no dot after @)', () => {
		expect(validateEmail('user@nodot')).toBe('Please enter a valid email address.');
	});

	it('returns format error for email with no local part', () => {
		expect(validateEmail('@example.com')).toBe('Please enter a valid email address.');
	});

	it('returns null for a subdomain email', () => {
		expect(validateEmail('user@mail.example.com')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// validatePassword
// ---------------------------------------------------------------------------

describe('validatePassword', () => {
	it('returns null for a valid password of exactly 8 characters', () => {
		expect(validatePassword('12345678')).toBeNull();
	});

	it('returns null for a valid password within the allowed range', () => {
		expect(validatePassword('SecurePass1!')).toBeNull();
	});

	it('returns null for a password of exactly 128 characters', () => {
		expect(validatePassword('a'.repeat(PASSWORD_MAX))).toBeNull();
	});

	it('returns required error for empty string', () => {
		expect(validatePassword('')).toBe('Password is required.');
	});

	it('returns min-length error for a 7-character password', () => {
		expect(validatePassword('1234567')).toBe(
			`Password must be at least ${PASSWORD_MIN} characters.`,
		);
	});

	it('returns max-length error for a 129-character password', () => {
		expect(validatePassword('a'.repeat(PASSWORD_MAX + 1))).toBe(
			`Password must be no longer than ${PASSWORD_MAX} characters.`,
		);
	});

	it('returns min-length error for a 1-character password', () => {
		expect(validatePassword('x')).toBe(
			`Password must be at least ${PASSWORD_MIN} characters.`,
		);
	});
});

// ---------------------------------------------------------------------------
// validateConfirmPassword
// ---------------------------------------------------------------------------

describe('validateConfirmPassword', () => {
	it('returns null when confirm matches the original', () => {
		expect(validateConfirmPassword('password123', 'password123')).toBeNull();
	});

	it('returns required error for empty confirm field', () => {
		expect(validateConfirmPassword('', 'password123')).toBe(
			'Please confirm your password.',
		);
	});

	it('returns mismatch error when passwords differ', () => {
		expect(validateConfirmPassword('different', 'password123')).toBe(
			'Passwords do not match.',
		);
	});

	it('is case-sensitive — different capitalisation is a mismatch', () => {
		expect(validateConfirmPassword('Password123', 'password123')).toBe(
			'Passwords do not match.',
		);
	});
});

// ---------------------------------------------------------------------------
// validateName
// ---------------------------------------------------------------------------

describe('validateName', () => {
	it('returns null for a valid name', () => {
		expect(validateName('Alice Smith')).toBeNull();
	});

	it('returns required error for empty string', () => {
		expect(validateName('')).toBe('Name is required.');
	});

	it('returns required error for whitespace-only string', () => {
		expect(validateName('   ')).toBe('Name is required.');
	});

	it('returns null for a single non-whitespace character', () => {
		expect(validateName('A')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// isSignUpFormValid
// ---------------------------------------------------------------------------

describe('isSignUpFormValid', () => {
	it('returns true when all fields are valid', () => {
		expect(isSignUpFormValid('Alice', 'alice@example.com', 'SecurePass1!')).toBe(true);
	});

	it('returns false when name is empty', () => {
		expect(isSignUpFormValid('', 'alice@example.com', 'SecurePass1!')).toBe(false);
	});

	it('returns false when name is whitespace only', () => {
		expect(isSignUpFormValid('   ', 'alice@example.com', 'SecurePass1!')).toBe(false);
	});

	it('returns false when email is malformed', () => {
		expect(isSignUpFormValid('Alice', 'notanemail', 'SecurePass1!')).toBe(false);
	});

	it('returns false when password is too short', () => {
		expect(isSignUpFormValid('Alice', 'alice@example.com', 'short')).toBe(false);
	});

	it('returns false when password is too long', () => {
		expect(isSignUpFormValid('Alice', 'alice@example.com', 'a'.repeat(129))).toBe(false);
	});

	it('returns false when password is empty', () => {
		expect(isSignUpFormValid('Alice', 'alice@example.com', '')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// isResetPasswordFormValid
// ---------------------------------------------------------------------------

describe('isResetPasswordFormValid', () => {
	it('returns true when new password is valid and confirm matches', () => {
		expect(isResetPasswordFormValid('SecurePass1!', 'SecurePass1!')).toBe(true);
	});

	it('returns false when new password is too short', () => {
		expect(isResetPasswordFormValid('short', 'short')).toBe(false);
	});

	it('returns false when new password is too long', () => {
		const long = 'a'.repeat(129);
		expect(isResetPasswordFormValid(long, long)).toBe(false);
	});

	it('returns false when confirm does not match', () => {
		expect(isResetPasswordFormValid('SecurePass1!', 'DifferentPass1!')).toBe(false);
	});

	it('returns false when confirm is empty', () => {
		expect(isResetPasswordFormValid('SecurePass1!', '')).toBe(false);
	});

	it('returns false when new password is empty', () => {
		expect(isResetPasswordFormValid('', '')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// resolveErrorMessage
// ---------------------------------------------------------------------------

describe('resolveErrorMessage', () => {
	it('returns the mapped message for a known login error code', () => {
		expect(resolveErrorMessage('INVALID_EMAIL_OR_PASSWORD', LOGIN_ERROR_MESSAGES)).toBe(
			'Incorrect email or password.',
		);
	});

	it('returns the DOMAIN_NOT_ALLOWED message for login', () => {
		expect(resolveErrorMessage('DOMAIN_NOT_ALLOWED', LOGIN_ERROR_MESSAGES)).toBe(
			'Sign-ins from this email domain are not permitted.',
		);
	});

	it('returns the EMAIL_NOT_VERIFIED message for login', () => {
		expect(resolveErrorMessage('EMAIL_NOT_VERIFIED', LOGIN_ERROR_MESSAGES)).toBe(
			'Please verify your email before signing in. Check your inbox or request a new verification email.',
		);
	});

	it('returns GENERIC_ERROR for an unknown code in login map', () => {
		expect(resolveErrorMessage('SOME_UNKNOWN_CODE', LOGIN_ERROR_MESSAGES)).toBe(GENERIC_ERROR);
	});

	it('returns USER_ALREADY_EXISTS message for signup', () => {
		expect(resolveErrorMessage('USER_ALREADY_EXISTS', SIGNUP_ERROR_MESSAGES)).toBe(
			'An account with this email already exists.',
		);
	});

	it('returns the DOMAIN_NOT_ALLOWED message for signup', () => {
		expect(resolveErrorMessage('DOMAIN_NOT_ALLOWED', SIGNUP_ERROR_MESSAGES)).toBe(
			'Sign-ups from this email domain are not permitted.',
		);
	});

	it('returns GENERIC_ERROR for an unknown code in signup map', () => {
		expect(resolveErrorMessage('UNKNOWN', SIGNUP_ERROR_MESSAGES)).toBe(GENERIC_ERROR);
	});

	it('returns the INVALID_TOKEN message for reset-password', () => {
		expect(resolveErrorMessage('INVALID_TOKEN', RESET_PASSWORD_ERROR_MESSAGES)).toBe(
			'This reset link is invalid or has already been used.',
		);
	});

	it('returns the TOKEN_EXPIRED message for reset-password', () => {
		expect(resolveErrorMessage('TOKEN_EXPIRED', RESET_PASSWORD_ERROR_MESSAGES)).toBe(
			'This reset link has expired. Please request a new one.',
		);
	});

	it('returns GENERIC_ERROR for an unknown code in reset-password map', () => {
		expect(resolveErrorMessage('UNKNOWN', RESET_PASSWORD_ERROR_MESSAGES)).toBe(GENERIC_ERROR);
	});
});

// ---------------------------------------------------------------------------
// isTokenError
// ---------------------------------------------------------------------------

describe('isTokenError', () => {
	it('returns true for INVALID_TOKEN', () => {
		expect(isTokenError('INVALID_TOKEN')).toBe(true);
	});

	it('returns true for TOKEN_EXPIRED', () => {
		expect(isTokenError('TOKEN_EXPIRED')).toBe(true);
	});

	it('returns false for null (no error set)', () => {
		expect(isTokenError(null)).toBe(false);
	});

	it('returns false for a generic server error code', () => {
		expect(isTokenError('unknown')).toBe(false);
	});

	it('returns false for INVALID_EMAIL_OR_PASSWORD (not a token error)', () => {
		expect(isTokenError('INVALID_EMAIL_OR_PASSWORD')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// LOGIN_ERROR_MESSAGES — verify all required codes are mapped
// ---------------------------------------------------------------------------

describe('LOGIN_ERROR_MESSAGES — required codes from REQ-002', () => {
	it('maps INVALID_EMAIL_OR_PASSWORD', () => {
		expect(LOGIN_ERROR_MESSAGES.INVALID_EMAIL_OR_PASSWORD).toBeDefined();
	});

	it('maps EMAIL_NOT_VERIFIED', () => {
		expect(LOGIN_ERROR_MESSAGES.EMAIL_NOT_VERIFIED).toBeDefined();
	});

	it('maps DOMAIN_NOT_ALLOWED', () => {
		expect(LOGIN_ERROR_MESSAGES.DOMAIN_NOT_ALLOWED).toBeDefined();
	});

	it('maps access_denied (OAuth cancel)', () => {
		expect(LOGIN_ERROR_MESSAGES.access_denied).toBeDefined();
	});

	it('maps state_mismatch (OAuth session expired)', () => {
		expect(LOGIN_ERROR_MESSAGES.state_mismatch).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// SIGNUP_ERROR_MESSAGES — verify all required codes are mapped
// ---------------------------------------------------------------------------

describe('SIGNUP_ERROR_MESSAGES — required codes from REQ-002', () => {
	it('maps USER_ALREADY_EXISTS', () => {
		expect(SIGNUP_ERROR_MESSAGES.USER_ALREADY_EXISTS).toBeDefined();
	});

	it('maps DOMAIN_NOT_ALLOWED', () => {
		expect(SIGNUP_ERROR_MESSAGES.DOMAIN_NOT_ALLOWED).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// RESET_PASSWORD_ERROR_MESSAGES — verify all required codes are mapped
// ---------------------------------------------------------------------------

describe('RESET_PASSWORD_ERROR_MESSAGES — required codes from REQ-002', () => {
	it('maps INVALID_TOKEN', () => {
		expect(RESET_PASSWORD_ERROR_MESSAGES.INVALID_TOKEN).toBeDefined();
	});

	it('maps TOKEN_EXPIRED', () => {
		expect(RESET_PASSWORD_ERROR_MESSAGES.TOKEN_EXPIRED).toBeDefined();
	});
});
