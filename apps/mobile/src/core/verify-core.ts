// Pure helpers for the automatic selfie check: what to show, and what to say when something goes wrong. Nothing here touches the phone.

export interface MyVerification {
  verified: boolean;
  verifiedAt: string | null;
  latest: { status: 'started' | 'pending' | 'approved' | 'rejected' | 'expired'; reason: string | null; expiresAt: string | null } | null;
}

/** The database answers with snake_case JSON (my_verification). Junk becomes null so a bad answer never breaks the screen. */
export function parseMyVerification(raw: unknown): MyVerification | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const l = r.latest && typeof r.latest === 'object' ? r.latest : null;
  const known = ['started', 'pending', 'approved', 'rejected', 'expired'];
  return {
    verified: r.verified === true, verifiedAt: typeof r.verified_at === 'string' ? r.verified_at : null,
    latest: l && known.includes(l.status) ? { status: l.status, reason: typeof l.reject_reason === 'string' ? l.reject_reason : null, expiresAt: typeof l.expires_at === 'string' ? l.expires_at : null } : null,
  };
}

export type VerifyView = { kind: 'verified' } | { kind: 'waiting' } | { kind: 'failed'; message: string } | { kind: 'idle' };
export function verifyView(v: MyVerification | null, now: Date): VerifyView {
  if (v?.verified) return { kind: 'verified' };
  const l = v?.latest;
  if (l && (l.status === 'started' || l.status === 'pending') && (!l.expiresAt || new Date(l.expiresAt).getTime() > now.getTime())) return { kind: 'waiting' };
  if (l?.status === 'rejected') return { kind: 'failed', message: reasonText(l.reason) };
  return { kind: 'idle' };
}

/** Never blames the person and never says why in a way that helps someone fool the check. */
export function reasonText(code: string | null): string {
  switch (code) {
    case 'liveness_failed': return 'We could not confirm a live selfie. Try again in good light, looking straight at the camera, with nothing covering your face.';
    case 'face_mismatch': case 'low_match': return 'The selfie did not match your profile photo closely enough. Your main photo should be a clear, recent photo of your face. You can change it and try again.';
    case 'not_finished': return 'The check was not finished. You can start it again whenever you like.';
    default: return 'We could not finish the check this time. Please try again in good light.';
  }
}

/** What to say when starting fails. `code` is the API error code. */
export function startErrorText(code: string | undefined): string {
  switch (code) {
    case 'already_verified': return 'You already have a verified badge.';
    case 'too_many_attempts': return 'You have tried a few times already. Please try again tomorrow.';
    case 'no_approved_photo': return 'Add a clear photo of your face and wait for it to be approved, then try again.';
    case 'photo_not_usable': return 'We could not use your profile photo for the check. Add a clear, recent photo of your face and try again.';
    case 'verification_paused': return 'Verification is paused for the moment because it is very busy. Please try again later.';
    case 'provider_unavailable': return 'The verification service is not answering right now. Please try again in a few minutes.';
    case 'in_progress': return 'A check is already starting. Give it a moment.';
    case 'selfie_verification_not_configured': return 'Photo verification is not switched on yet.';
    case 'network_error': return 'Could not reach the server. Check your connection and try again.';
    default: return 'Something went wrong starting the check. Please try again.';
  }
}

/** After the person comes back from the browser we look for the result every few seconds, for about three minutes. */
export const POLL_MS = 4000;
export const POLL_MAX = 45;

export const CONSENT_TEXT = 'We will open a secure page run by Didit, our verification provider. You take a live selfie there. They compare it with your main profile photo and tell us only whether it matched. We never receive your selfie, and we ask them to delete it straight away. This is optional, and you can say no.';
