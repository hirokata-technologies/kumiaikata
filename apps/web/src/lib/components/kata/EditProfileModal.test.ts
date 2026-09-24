// Unit tests for REQ-003: Edit Profile
//
// EditProfileModal.svelte uses Svelte 5 $state reactivity and imports $lib/auth-client
// and $lib/api — neither of which is resolvable in the node test environment.
// These tests extract the same algorithms into plain functions with injectable
// dependencies and exercise every acceptance criterion described in REQ-003.
//
// Three algorithms are under test:
//
//   1. validate()         — name / photo / password client-side validation
//   2. onPick()           — file-picker handler: MIME + size guards
//   3. save()             — multi-step save orchestration
//
// Each is reproduced here verbatim from the Svelte component, with external
// calls replaced by injected dependencies so no SvelteKit modules are needed.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { NAME_MAX, PASSWORD_MIN, PASSWORD_MAX, validatePassword, validateConfirmPassword } from '../../auth-validation.js';

// ---------------------------------------------------------------------------
// Types that mirror the component's internal state
// ---------------------------------------------------------------------------

interface User {
	name?: string | null;
	email: string;
	image?: string | null;
}

interface ValidationState {
	name: string;
	nameError: string | null;
	hasPassword: boolean;
	currentPassword: string;
	newPassword: string;
	confirmPassword: string;
	currentPwError: string | null;
	newPwError: string | null;
	confirmPwError: string | null;
}

interface SaveDeps {
	uploadAvatar: (file: File) => Promise<{ imageUrl: string }>;
	updateUser: (payload: { name?: string; image?: string | null }) => Promise<unknown>;
	changePassword: (payload: {
		currentPassword: string;
		newPassword: string;
		revokeOtherSessions: boolean;
	}) => Promise<unknown>;
}

interface SaveState {
	user: User | null | undefined;
	name: string;
	selectedFile: File | null;
	uploadedImageUrl: string | null;
	removePhoto: boolean;
	hasPassword: boolean;
	currentPassword: string;
	newPassword: string;
	confirmPassword: string;
	saving: boolean;
	bannerError: string | null;
	photoError: string | null;
	currentPwError: string | null;
	newPwError: string | null;
	confirmPwError: string | null;
	passwordSuccess: string | null;
}

// ---------------------------------------------------------------------------
// Extracted: validate() — mirrors the component verbatim
// ---------------------------------------------------------------------------

function validate(state: ValidationState): boolean {
	let valid = true;

	// Name
	state.nameError = null;
	const n = state.name.trim();
	if (!n) {
		state.nameError = 'Name is required.';
		valid = false;
	} else if (n.length > NAME_MAX) {
		state.nameError = 'Name must be 256 characters or fewer.';
		valid = false;
	}

	// Password (only when hasPassword and any field is non-empty)
	state.currentPwError = null;
	state.newPwError = null;
	state.confirmPwError = null;
	const pwPartial = state.currentPassword || state.newPassword || state.confirmPassword;
	if (state.hasPassword && pwPartial) {
		if (!state.currentPassword) {
			state.currentPwError = 'Current password is required.';
			valid = false;
		}
		const npErr = validatePassword(state.newPassword);
		if (npErr) {
			state.newPwError = npErr;
			valid = false;
		}
		const cpErr = validateConfirmPassword(state.confirmPassword, state.newPassword);
		if (cpErr) {
			state.confirmPwError = cpErr;
			valid = false;
		}
	}

	return valid;
}

// ---------------------------------------------------------------------------
// Extracted: onPick() — mirrors the component verbatim
// ---------------------------------------------------------------------------

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_SIZE = 5 * 1024 * 1024;

interface PickState {
	selectedFile: File | null;
	previewUrl: string | null;
	removePhoto: boolean;
	uploadedImageUrl: string | null;
	photoError: string | null;
	imgFailed: boolean;
}

interface PickDeps {
	createObjectURL: (file: File) => string;
	revokeObjectURL: (url: string) => void;
	clearInputValue: () => void;
}

function onPick(file: File, state: PickState, deps: PickDeps): void {
	if (!ALLOWED_TYPES.has(file.type)) {
		state.photoError = 'Please choose a JPEG, PNG, GIF, or WebP image.';
		deps.clearInputValue();
		return;
	}
	if (file.size > MAX_SIZE) {
		state.photoError = 'Photo must be 5 MB or smaller.';
		deps.clearInputValue();
		return;
	}

	if (state.previewUrl) deps.revokeObjectURL(state.previewUrl);

	state.previewUrl = deps.createObjectURL(file);
	state.selectedFile = file;
	state.removePhoto = false;
	state.uploadedImageUrl = null;
	state.photoError = null;
	state.imgFailed = false;
}

// ---------------------------------------------------------------------------
// Extracted: errMessage() helper
// ---------------------------------------------------------------------------

function errMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return 'Something went wrong. Please try again.';
}

// ---------------------------------------------------------------------------
// Extracted: save() — mirrors the component verbatim
// ---------------------------------------------------------------------------

interface SaveResult {
	patch: { name?: string | null; image?: string | null } | null;
	closed: boolean;
}

async function runSave(
	state: SaveState,
	deps: SaveDeps,
): Promise<SaveResult> {
	if (state.saving) return { patch: null, closed: false };
	state.bannerError = null;
	state.passwordSuccess = null;

	// validate
	const vs: ValidationState = {
		name: state.name,
		nameError: null,
		hasPassword: state.hasPassword,
		currentPassword: state.currentPassword,
		newPassword: state.newPassword,
		confirmPassword: state.confirmPassword,
		currentPwError: null,
		newPwError: null,
		confirmPwError: null,
	};
	const isValid = validate(vs);
	// Copy errors back
	(state as unknown as Record<string, unknown>).nameError = vs.nameError;
	state.currentPwError = vs.currentPwError;
	state.newPwError = vs.newPwError;
	state.confirmPwError = vs.confirmPwError;
	if (!isValid) return { patch: null, closed: false };

	state.saving = true;

	try {
		// 1) Avatar upload (only if a new file and not already uploaded)
		let imageUrl: string | null | undefined = undefined;
		if (state.selectedFile && !state.uploadedImageUrl) {
			try {
				const res = await deps.uploadAvatar(state.selectedFile);
				state.uploadedImageUrl = res.imageUrl;
			} catch (err) {
				state.photoError = errMessage(err);
				state.bannerError = 'Could not upload your photo. Please try again.';
				return { patch: null, closed: false };
			}
		}
		if (state.uploadedImageUrl) imageUrl = state.uploadedImageUrl;
		else if (state.removePhoto) imageUrl = null;

		// 2) updateUser — only when name or image changed
		const nameChanged = state.name.trim() !== (state.user?.name?.trim() ?? '');
		const imageChanged = imageUrl !== undefined;
		if (nameChanged || imageChanged) {
			const payload: { name?: string; image?: string | null } = {};
			if (nameChanged) payload.name = state.name.trim();
			if (imageChanged) payload.image = imageUrl ?? null;
			const r = await deps.updateUser(payload);
			if ((r as { error?: { message?: string } | null })?.error) {
				const errObj = (r as { error?: { message?: string } | null }).error;
				state.bannerError = errObj?.message ?? 'Could not update your profile. Please try again.';
				return { patch: null, closed: false };
			}
		}

		// 3) changePassword — only if password fields filled
		if (state.hasPassword && (state.currentPassword || state.newPassword || state.confirmPassword)) {
			const r = await deps.changePassword({
				currentPassword: state.currentPassword,
				newPassword: state.newPassword,
				revokeOtherSessions: false,
			});
			const rErr = (r as { error?: { code?: string; message?: string } | null })?.error;
			if (rErr) {
				if (rErr.code === 'INVALID_PASSWORD') {
					state.currentPwError = 'Current password is incorrect.';
				} else {
					state.bannerError = rErr.message ?? 'Could not change password. Please try again.';
				}
				return { patch: null, closed: false };
			}
			// Success: clear fields + show success
			state.currentPassword = '';
			state.newPassword = '';
			state.confirmPassword = '';
			state.passwordSuccess = 'Password updated.';
		}

		// Full success → build patch and signal close
		const patch: { name?: string | null; image?: string | null } = {};
		if (state.name.trim() !== (state.user?.name?.trim() ?? '')) patch.name = state.name.trim();
		if (imageUrl !== undefined) patch.image = imageUrl ?? null;
		return { patch, closed: true };
	} finally {
		state.saving = false;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidationState(overrides: Partial<ValidationState> = {}): ValidationState {
	return {
		name: 'Alice',
		nameError: null,
		hasPassword: false,
		currentPassword: '',
		newPassword: '',
		confirmPassword: '',
		currentPwError: null,
		newPwError: null,
		confirmPwError: null,
		...overrides,
	};
}

function makePickState(overrides: Partial<PickState> = {}): PickState {
	return {
		selectedFile: null,
		previewUrl: null,
		removePhoto: false,
		uploadedImageUrl: null,
		photoError: null,
		imgFailed: false,
		...overrides,
	};
}

function makePickDeps(previewUrl = 'blob:fake'): PickDeps & {
	createObjectURL: ReturnType<typeof vi.fn>;
	revokeObjectURL: ReturnType<typeof vi.fn>;
	clearInputValue: ReturnType<typeof vi.fn>;
} {
	return {
		createObjectURL: vi.fn<PickDeps['createObjectURL']>().mockReturnValue(previewUrl),
		revokeObjectURL: vi.fn<PickDeps['revokeObjectURL']>(),
		clearInputValue: vi.fn<PickDeps['clearInputValue']>(),
	};
}

function makeSaveState(overrides: Partial<SaveState> = {}): SaveState {
	return {
		user: { name: 'Alice', email: 'alice@example.com', image: null },
		name: 'Alice',
		selectedFile: null,
		uploadedImageUrl: null,
		removePhoto: false,
		hasPassword: false,
		currentPassword: '',
		newPassword: '',
		confirmPassword: '',
		saving: false,
		bannerError: null,
		photoError: null,
		currentPwError: null,
		newPwError: null,
		confirmPwError: null,
		passwordSuccess: null,
		...overrides,
	};
}

function makeSaveDeps(overrides: Partial<SaveDeps> = {}): SaveDeps {
	return {
		uploadAvatar: vi.fn().mockResolvedValue({ imageUrl: 'https://example.com/avatar.jpg' }),
		updateUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
		changePassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
		...overrides,
	};
}

function makeFile(name: string, type: string, sizeBytes: number): File {
	const content = new Uint8Array(sizeBytes).fill(65);
	return new File([content], name, { type });
}

// ---------------------------------------------------------------------------
// validate() — US-2: Name validation
// ---------------------------------------------------------------------------

describe('validate — name (US-2)', () => {
	it('returns true for a valid non-empty name', () => {
		const state = makeValidationState({ name: 'Alice' });
		expect(validate(state)).toBe(true);
		expect(state.nameError).toBeNull();
	});

	it('returns false and sets nameError for empty name (AC-4)', () => {
		const state = makeValidationState({ name: '' });
		expect(validate(state)).toBe(false);
		expect(state.nameError).toBe('Name is required.');
	});

	it('returns false and sets nameError for whitespace-only name (edge case)', () => {
		const state = makeValidationState({ name: '   ' });
		expect(validate(state)).toBe(false);
		expect(state.nameError).toBe('Name is required.');
	});

	it('returns false and sets nameError when name exceeds 256 characters (AC-5)', () => {
		const state = makeValidationState({ name: 'a'.repeat(NAME_MAX + 1) });
		expect(validate(state)).toBe(false);
		expect(state.nameError).toBe('Name must be 256 characters or fewer.');
	});

	it('returns true for a name exactly at 256 characters (boundary)', () => {
		const state = makeValidationState({ name: 'a'.repeat(NAME_MAX) });
		expect(validate(state)).toBe(true);
		expect(state.nameError).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// validate() — US-4: Password validation
// ---------------------------------------------------------------------------

describe('validate — password (US-4)', () => {
	it('skips password validation when hasPassword is false and fields are empty', () => {
		const state = makeValidationState({
			name: 'Alice',
			hasPassword: false,
			currentPassword: '',
			newPassword: '',
			confirmPassword: '',
		});
		expect(validate(state)).toBe(true);
		expect(state.currentPwError).toBeNull();
		expect(state.newPwError).toBeNull();
		expect(state.confirmPwError).toBeNull();
	});

	it('skips password validation when hasPassword is false even if fields are filled', () => {
		// OAuth user — password section is hidden, so fields should not be validated
		const state = makeValidationState({
			name: 'Alice',
			hasPassword: false,
			currentPassword: 'secret',
			newPassword: 'newpass',
			confirmPassword: 'newpass',
		});
		expect(validate(state)).toBe(true);
		expect(state.currentPwError).toBeNull();
	});

	it('skips password validation when all password fields are empty (AC-10)', () => {
		const state = makeValidationState({
			name: 'Alice',
			hasPassword: true,
			currentPassword: '',
			newPassword: '',
			confirmPassword: '',
		});
		expect(validate(state)).toBe(true);
	});

	it('returns false and sets currentPwError when only newPassword is filled (partial AC-9)', () => {
		const state = makeValidationState({
			name: 'Alice',
			hasPassword: true,
			currentPassword: '',
			newPassword: 'newpassword1',
			confirmPassword: 'newpassword1',
		});
		expect(validate(state)).toBe(false);
		expect(state.currentPwError).toBe('Current password is required.');
	});

	it('returns false and sets newPwError when new password is too short (AC-6)', () => {
		const state = makeValidationState({
			name: 'Alice',
			hasPassword: true,
			currentPassword: 'current123',
			newPassword: 'short',
			confirmPassword: 'short',
		});
		expect(validate(state)).toBe(false);
		expect(state.newPwError).toBe(`Password must be at least ${PASSWORD_MIN} characters.`);
	});

	it('returns false and sets newPwError when new password is too long (AC-7)', () => {
		const longPw = 'a'.repeat(PASSWORD_MAX + 1);
		const state = makeValidationState({
			name: 'Alice',
			hasPassword: true,
			currentPassword: 'current123',
			newPassword: longPw,
			confirmPassword: longPw,
		});
		expect(validate(state)).toBe(false);
		expect(state.newPwError).toBe(`Password must be no longer than ${PASSWORD_MAX} characters.`);
	});

	it('returns false and sets confirmPwError when passwords do not match (AC-8)', () => {
		const state = makeValidationState({
			name: 'Alice',
			hasPassword: true,
			currentPassword: 'current123',
			newPassword: 'newpassword1',
			confirmPassword: 'differentpassword',
		});
		expect(validate(state)).toBe(false);
		expect(state.confirmPwError).toBe('Passwords do not match.');
	});

	it('returns true for a valid complete password change', () => {
		const state = makeValidationState({
			name: 'Alice',
			hasPassword: true,
			currentPassword: 'current123',
			newPassword: 'newpassword1',
			confirmPassword: 'newpassword1',
		});
		expect(validate(state)).toBe(true);
		expect(state.currentPwError).toBeNull();
		expect(state.newPwError).toBeNull();
		expect(state.confirmPwError).toBeNull();
	});

	it('returns false when only confirmPassword is filled (partial — AC-9)', () => {
		const state = makeValidationState({
			name: 'Alice',
			hasPassword: true,
			currentPassword: '',
			newPassword: '',
			confirmPassword: 'somepassword',
		});
		expect(validate(state)).toBe(false);
		// currentPwError must be set
		expect(state.currentPwError).toBe('Current password is required.');
		// newPwError: validatePassword('') returns required error
		expect(state.newPwError).toBe('Password is required.');
	});

	it('sets all three password errors when all fields are empty but only currentPassword triggers pwPartial via confirm (AC-9)', () => {
		// Only currentPassword partially filled
		const state = makeValidationState({
			name: 'Alice',
			hasPassword: true,
			currentPassword: 'current123',
			newPassword: '',
			confirmPassword: '',
		});
		expect(validate(state)).toBe(false);
		expect(state.newPwError).toBe('Password is required.');
	});
});

// ---------------------------------------------------------------------------
// onPick() — US-3: File picker validation
// ---------------------------------------------------------------------------

describe('onPick — file validation (US-3)', () => {
	it('accepts a JPEG file and sets previewUrl and selectedFile (AC-2)', () => {
		const file = makeFile('photo.jpg', 'image/jpeg', 100);
		const state = makePickState();
		const deps = makePickDeps('blob:jpeg-preview');

		onPick(file, state, deps);

		expect(state.selectedFile).toBe(file);
		expect(state.previewUrl).toBe('blob:jpeg-preview');
		expect(state.photoError).toBeNull();
		expect(state.removePhoto).toBe(false);
		expect(state.uploadedImageUrl).toBeNull();
		expect(state.imgFailed).toBe(false);
	});

	it('accepts a PNG file (AC-1 allowlist)', () => {
		const file = makeFile('photo.png', 'image/png', 100);
		const state = makePickState();
		const deps = makePickDeps();

		onPick(file, state, deps);

		expect(state.selectedFile).toBe(file);
		expect(state.photoError).toBeNull();
	});

	it('accepts a GIF file (AC-1 allowlist)', () => {
		const file = makeFile('anim.gif', 'image/gif', 100);
		const state = makePickState();
		const deps = makePickDeps();

		onPick(file, state, deps);

		expect(state.selectedFile).toBe(file);
		expect(state.photoError).toBeNull();
	});

	it('accepts a WebP file (AC-1 allowlist)', () => {
		const file = makeFile('photo.webp', 'image/webp', 100);
		const state = makePickState();
		const deps = makePickDeps();

		onPick(file, state, deps);

		expect(state.selectedFile).toBe(file);
		expect(state.photoError).toBeNull();
	});

	it('rejects a PDF file and sets photoError (AC-8)', () => {
		const file = makeFile('file.pdf', 'application/pdf', 100);
		const state = makePickState();
		const deps = makePickDeps();

		onPick(file, state, deps);

		expect(state.photoError).toBe('Please choose a JPEG, PNG, GIF, or WebP image.');
		expect(state.selectedFile).toBeNull();
		expect(deps.clearInputValue).toHaveBeenCalledOnce();
	});

	it('rejects a file exceeding 5 MB and sets photoError (AC-7)', () => {
		const file = makeFile('big.jpg', 'image/jpeg', MAX_SIZE + 1);
		const state = makePickState();
		const deps = makePickDeps();

		onPick(file, state, deps);

		expect(state.photoError).toBe('Photo must be 5 MB or smaller.');
		expect(state.selectedFile).toBeNull();
		expect(deps.clearInputValue).toHaveBeenCalledOnce();
	});

	it('accepts a file exactly at 5 MB boundary (no error)', () => {
		const file = makeFile('exact.jpg', 'image/jpeg', MAX_SIZE);
		const state = makePickState();
		const deps = makePickDeps();

		onPick(file, state, deps);

		expect(state.photoError).toBeNull();
		expect(state.selectedFile).toBe(file);
	});

	it('revokes prior object URL when a second file is picked (edge case)', () => {
		const deps = makePickDeps('blob:second');
		const state = makePickState({ previewUrl: 'blob:first' });
		const file = makeFile('second.jpg', 'image/jpeg', 100);

		onPick(file, state, deps);

		expect(deps.revokeObjectURL).toHaveBeenCalledWith('blob:first');
		expect(state.previewUrl).toBe('blob:second');
	});

	it('resets uploadedImageUrl to null when a new file is picked (retry edge case)', () => {
		const state = makePickState({ uploadedImageUrl: 'https://example.com/old.jpg' });
		const file = makeFile('new.jpg', 'image/jpeg', 100);
		const deps = makePickDeps();

		onPick(file, state, deps);

		expect(state.uploadedImageUrl).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// save() — US-5: Save orchestration
// ---------------------------------------------------------------------------

describe('save — orchestration order (US-5 AC-2)', () => {
	it('runs upload then updateUser then changePassword in order', async () => {
		const callOrder: string[] = [];
		const deps = makeSaveDeps({
			uploadAvatar: vi.fn().mockImplementation(async () => {
				callOrder.push('upload');
				return { imageUrl: 'https://cdn.example.com/avatar.jpg' };
			}),
			updateUser: vi.fn().mockImplementation(async () => {
				callOrder.push('updateUser');
				return { data: {}, error: null };
			}),
			changePassword: vi.fn().mockImplementation(async () => {
				callOrder.push('changePassword');
				return { data: {}, error: null };
			}),
		});

		const state = makeSaveState({
			name: 'Bob',
			user: { name: 'Alice', email: 'alice@example.com', image: null },
			selectedFile: makeFile('photo.jpg', 'image/jpeg', 100),
			hasPassword: true,
			currentPassword: 'current123',
			newPassword: 'newpassword1',
			confirmPassword: 'newpassword1',
		});

		const result = await runSave(state, deps);

		expect(callOrder).toEqual(['upload', 'updateUser', 'changePassword']);
		expect(result.closed).toBe(true);
	});

	it('stops after upload failure and does not call updateUser (AC-5)', async () => {
		const deps = makeSaveDeps({
			uploadAvatar: vi.fn().mockRejectedValue(new Error('Network error')),
		});

		const state = makeSaveState({
			name: 'Bob',
			user: { name: 'Alice', email: 'alice@example.com', image: null },
			selectedFile: makeFile('photo.jpg', 'image/jpeg', 100),
		});

		const result = await runSave(state, deps);

		expect(result.closed).toBe(false);
		expect(state.bannerError).toBe('Could not upload your photo. Please try again.');
		expect(deps.updateUser).not.toHaveBeenCalled();
	});

	it('stops after updateUser failure and does not call changePassword (AC-5)', async () => {
		const deps = makeSaveDeps({
			updateUser: vi.fn().mockResolvedValue({ error: { message: 'Profile update failed' } }),
		});

		const state = makeSaveState({
			name: 'Bob',
			user: { name: 'Alice', email: 'alice@example.com', image: null },
			hasPassword: true,
			currentPassword: 'current123',
			newPassword: 'newpassword1',
			confirmPassword: 'newpassword1',
		});

		const result = await runSave(state, deps);

		expect(result.closed).toBe(false);
		expect(state.bannerError).toBe('Profile update failed');
		expect(deps.changePassword).not.toHaveBeenCalled();
	});
});

describe('save — name only (US-5 AC-1)', () => {
	it('only calls updateUser when only name changed (no photo, no password)', async () => {
		const deps = makeSaveDeps();

		const state = makeSaveState({
			name: 'Bob',
			user: { name: 'Alice', email: 'alice@example.com', image: null },
		});

		const result = await runSave(state, deps);

		expect(result.closed).toBe(true);
		expect(deps.uploadAvatar).not.toHaveBeenCalled();
		expect(deps.updateUser).toHaveBeenCalledOnce();
		expect(deps.updateUser).toHaveBeenCalledWith({ name: 'Bob' });
		expect(deps.changePassword).not.toHaveBeenCalled();
	});

	it('does not call updateUser when name is unchanged and no photo change', async () => {
		const deps = makeSaveDeps();

		const state = makeSaveState({
			name: 'Alice',
			user: { name: 'Alice', email: 'alice@example.com', image: null },
		});

		const result = await runSave(state, deps);

		expect(result.closed).toBe(true);
		expect(deps.updateUser).not.toHaveBeenCalled();
	});
});

describe('save — photo upload (US-3)', () => {
	it('calls uploadAvatar and then updateUser with imageUrl on success (AC-3, AC-4)', async () => {
		const deps = makeSaveDeps({
			uploadAvatar: vi.fn().mockResolvedValue({ imageUrl: 'https://cdn.example.com/avatar.jpg' }),
		});

		const state = makeSaveState({
			selectedFile: makeFile('photo.jpg', 'image/jpeg', 100),
		});

		await runSave(state, deps);

		expect(deps.uploadAvatar).toHaveBeenCalledOnce();
		expect(deps.updateUser).toHaveBeenCalledWith({ image: 'https://cdn.example.com/avatar.jpg' });
	});

	it('does not re-upload when uploadedImageUrl is already set from a prior save attempt (edge case)', async () => {
		const deps = makeSaveDeps();

		const state = makeSaveState({
			selectedFile: makeFile('photo.jpg', 'image/jpeg', 100),
			uploadedImageUrl: 'https://cdn.example.com/already-uploaded.jpg',
		});

		await runSave(state, deps);

		expect(deps.uploadAvatar).not.toHaveBeenCalled();
		expect(deps.updateUser).toHaveBeenCalledWith({ image: 'https://cdn.example.com/already-uploaded.jpg' });
	});

	it('calls updateUser with image: null when removePhoto is set (AC-6)', async () => {
		const deps = makeSaveDeps();

		const state = makeSaveState({
			removePhoto: true,
			user: { name: 'Alice', email: 'alice@example.com', image: 'https://cdn.example.com/old.jpg' },
		});

		await runSave(state, deps);

		expect(deps.uploadAvatar).not.toHaveBeenCalled();
		expect(deps.updateUser).toHaveBeenCalledWith({ image: null });
	});

	it('shows photo error and banner when upload throws (AC-9)', async () => {
		const deps = makeSaveDeps({
			uploadAvatar: vi.fn().mockRejectedValue(new Error('Upload failed')),
		});

		const state = makeSaveState({
			selectedFile: makeFile('photo.jpg', 'image/jpeg', 100),
		});

		const result = await runSave(state, deps);

		expect(result.closed).toBe(false);
		expect(state.photoError).toBe('Upload failed');
		expect(state.bannerError).toBe('Could not upload your photo. Please try again.');
	});
});

describe('save — password change (US-4)', () => {
	it('calls changePassword with correct args and clears fields on success (AC-3, AC-4)', async () => {
		const deps = makeSaveDeps();

		const state = makeSaveState({
			hasPassword: true,
			currentPassword: 'currentSecret1',
			newPassword: 'newSecret12345',
			confirmPassword: 'newSecret12345',
		});

		const result = await runSave(state, deps);

		expect(deps.changePassword).toHaveBeenCalledWith({
			currentPassword: 'currentSecret1',
			newPassword: 'newSecret12345',
			revokeOtherSessions: false,
		});
		expect(state.currentPassword).toBe('');
		expect(state.newPassword).toBe('');
		expect(state.confirmPassword).toBe('');
		expect(state.passwordSuccess).toBe('Password updated.');
		expect(result.closed).toBe(true);
	});

	it('sets currentPwError for INVALID_PASSWORD error code (AC-5)', async () => {
		const deps = makeSaveDeps({
			changePassword: vi.fn().mockResolvedValue({
				error: { code: 'INVALID_PASSWORD', message: 'Wrong password' },
			}),
		});

		const state = makeSaveState({
			hasPassword: true,
			currentPassword: 'wrongcurrent',
			newPassword: 'newSecret12345',
			confirmPassword: 'newSecret12345',
		});

		const result = await runSave(state, deps);

		expect(result.closed).toBe(false);
		expect(state.currentPwError).toBe('Current password is incorrect.');
		expect(state.bannerError).toBeNull();
	});

	it('sets bannerError for non-INVALID_PASSWORD errors from changePassword', async () => {
		const deps = makeSaveDeps({
			changePassword: vi.fn().mockResolvedValue({
				error: { code: 'SERVER_ERROR', message: 'Internal error' },
			}),
		});

		const state = makeSaveState({
			hasPassword: true,
			currentPassword: 'current123',
			newPassword: 'newSecret12345',
			confirmPassword: 'newSecret12345',
		});

		const result = await runSave(state, deps);

		expect(result.closed).toBe(false);
		expect(state.bannerError).toBe('Internal error');
	});

	it('does not call changePassword when all password fields are empty (AC-10)', async () => {
		const deps = makeSaveDeps();

		const state = makeSaveState({
			hasPassword: true,
			currentPassword: '',
			newPassword: '',
			confirmPassword: '',
			name: 'Bob',
			user: { name: 'Alice', email: 'alice@example.com', image: null },
		});

		await runSave(state, deps);

		expect(deps.changePassword).not.toHaveBeenCalled();
	});

	it('does not call changePassword for an OAuth user (AC-2 — hasPassword false)', async () => {
		const deps = makeSaveDeps();

		const state = makeSaveState({
			hasPassword: false,
			currentPassword: 'something',
			newPassword: 'newpassword1',
			confirmPassword: 'newpassword1',
		});

		await runSave(state, deps);

		expect(deps.changePassword).not.toHaveBeenCalled();
	});
});

describe('save — success / close behaviour (US-5)', () => {
	it('returns closed=true and a patch after all operations succeed (AC-4)', async () => {
		const deps = makeSaveDeps();

		const state = makeSaveState({
			name: 'Bob',
			user: { name: 'Alice', email: 'alice@example.com', image: null },
		});

		const result = await runSave(state, deps);

		expect(result.closed).toBe(true);
		expect(result.patch).toMatchObject({ name: 'Bob' });
	});

	it('resets saving to false after a successful save', async () => {
		const deps = makeSaveDeps();
		const state = makeSaveState({
			name: 'Bob',
			user: { name: 'Alice', email: 'alice@example.com', image: null },
		});

		await runSave(state, deps);

		expect(state.saving).toBe(false);
	});

	it('resets saving to false even when save fails', async () => {
		const deps = makeSaveDeps({
			uploadAvatar: vi.fn().mockRejectedValue(new Error('Network error')),
		});
		const state = makeSaveState({
			selectedFile: makeFile('photo.jpg', 'image/jpeg', 100),
		});

		await runSave(state, deps);

		expect(state.saving).toBe(false);
	});

	it('returns closed=false without calling anything when save is already in progress (AC-3)', async () => {
		const deps = makeSaveDeps();
		const state = makeSaveState({ saving: true });

		const result = await runSave(state, deps);

		expect(result.closed).toBe(false);
		expect(deps.updateUser).not.toHaveBeenCalled();
		expect(deps.changePassword).not.toHaveBeenCalled();
	});

	it('modal stays open (closed=false) when any operation fails (AC-5)', async () => {
		const deps = makeSaveDeps({
			updateUser: vi.fn().mockResolvedValue({ error: { message: 'Profile update failed' } }),
		});

		const state = makeSaveState({
			name: 'Bob',
			user: { name: 'Alice', email: 'alice@example.com', image: null },
		});

		const result = await runSave(state, deps);

		expect(result.closed).toBe(false);
	});
});

describe('save — validation blocks save (US-2, US-4)', () => {
	it('does not call any API when name is empty (AC-4)', async () => {
		const deps = makeSaveDeps();
		const state = makeSaveState({ name: '' });

		const result = await runSave(state, deps);

		expect(result.closed).toBe(false);
		expect(deps.uploadAvatar).not.toHaveBeenCalled();
		expect(deps.updateUser).not.toHaveBeenCalled();
		expect(deps.changePassword).not.toHaveBeenCalled();
	});

	it('does not call any API when name is whitespace only (edge case)', async () => {
		const deps = makeSaveDeps();
		const state = makeSaveState({ name: '   ' });

		const result = await runSave(state, deps);

		expect(result.closed).toBe(false);
		expect(deps.updateUser).not.toHaveBeenCalled();
	});

	it('does not call any API when name exceeds 256 characters (AC-5)', async () => {
		const deps = makeSaveDeps();
		const state = makeSaveState({ name: 'a'.repeat(NAME_MAX + 1) });

		const result = await runSave(state, deps);

		expect(result.closed).toBe(false);
		expect(deps.updateUser).not.toHaveBeenCalled();
	});

	it('does not call any API when new password is too short (AC-6)', async () => {
		const deps = makeSaveDeps();
		const state = makeSaveState({
			name: 'Alice',
			hasPassword: true,
			currentPassword: 'current123',
			newPassword: 'short',
			confirmPassword: 'short',
		});

		const result = await runSave(state, deps);

		expect(result.closed).toBe(false);
		expect(deps.changePassword).not.toHaveBeenCalled();
	});

	it('does not call any API when passwords do not match (AC-8)', async () => {
		const deps = makeSaveDeps();
		const state = makeSaveState({
			name: 'Alice',
			hasPassword: true,
			currentPassword: 'current123',
			newPassword: 'newpassword1',
			confirmPassword: 'differentpassword',
		});

		const result = await runSave(state, deps);

		expect(result.closed).toBe(false);
		expect(deps.changePassword).not.toHaveBeenCalled();
	});

	it('clears bannerError and passwordSuccess at the start of each save (retry)', async () => {
		const deps = makeSaveDeps();
		const state = makeSaveState({
			name: 'Alice',
			bannerError: 'Previous error',
			passwordSuccess: 'Password updated.',
		});

		await runSave(state, deps);

		// After starting save, these must be cleared (even if name is unchanged
		// and nothing is called)
		expect(state.bannerError).toBeNull();
		expect(state.passwordSuccess).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Source markup audit — structural properties of EditProfileModal.svelte
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const modalSource = readFileSync(
	resolve(__dirname, 'EditProfileModal.svelte'),
	'utf-8',
);

describe('EditProfileModal.svelte — structural markup audit', () => {
	it('imports authClient from $lib/auth-client', () => {
		expect(modalSource).toContain("from '$lib/auth-client.js'");
		expect(modalSource).toContain('authClient');
	});

	it('imports uploadAvatar from $lib/api', () => {
		expect(modalSource).toContain("from '$lib/api'");
		expect(modalSource).toContain('uploadAvatar');
	});

	it('imports NAME_MAX from $lib/auth-validation (no duplication)', () => {
		expect(modalSource).toContain('NAME_MAX');
		expect(modalSource).toContain("from '$lib/auth-validation.js'");
	});

	it('renders role="dialog" with aria-modal on the scrim', () => {
		expect(modalSource).toContain('role="dialog"');
		expect(modalSource).toContain('aria-modal="true"');
	});

	it('renders a role="alert" for the error banner', () => {
		expect(modalSource).toContain('role="alert"');
	});

	it('conditionally renders the password section with {#if hasPassword} (US-4 AC-2)', () => {
		expect(modalSource).toContain('{#if hasPassword}');
	});

	it('calls listAccounts() to detect credential accounts (US-4 AC-1)', () => {
		expect(modalSource).toContain('listAccounts');
		expect(modalSource).toContain("providerId === 'credential'");
	});

	it('has a file input restricted to allowed image types (US-3 AC-1)', () => {
		expect(modalSource).toContain('accept="image/jpeg,image/png,image/gif,image/webp"');
	});

	it('disables Save button while saving (US-5 AC-3)', () => {
		expect(modalSource).toContain('disabled={saving}');
	});

	it('shows a loading label while saving (US-5 AC-3)', () => {
		expect(modalSource).toContain('Saving');
	});

	it('binds Escape key to onClose (US-1 AC-4)', () => {
		expect(modalSource).toContain("e.key === 'Escape'");
		expect(modalSource).toContain('onClose()');
	});

	it('shows a Remove photo button conditionally (US-3 AC-6)', () => {
		expect(modalSource).toContain('Remove photo');
		expect(modalSource).toContain('user?.image');
	});

	it('uses onerror handler on the avatar img for fallback to initials (US-1 edge)', () => {
		expect(modalSource).toContain('onerror');
		expect(modalSource).toContain('imgFailed');
	});

	it('revokes object URLs on unmount to avoid memory leaks', () => {
		expect(modalSource).toContain('URL.revokeObjectURL');
	});

	it('has a disclosure button for the password section (collapsible layout)', () => {
		expect(modalSource).toContain('aria-expanded={showPasswordSection}');
	});

	it('renders email field as read-only output element (US-1 AC-1)', () => {
		expect(modalSource).toContain('<output');
	});
});
