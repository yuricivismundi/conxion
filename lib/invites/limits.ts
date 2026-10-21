/** Invite limits and helpers shared by the invite modal (client) and /api/invites (server). */
export const INVITES_PER_REQUEST = 5;
export const INVITES_PER_DAY = 20;
export const INVITE_SAME_ADDRESS_COOLDOWN_DAYS = 30;
export const INVITE_NOTE_MAX_CHARS = 280;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeInviteEmail(raw: string) {
  return raw.trim().toLowerCase();
}

export function isValidInviteEmail(email: string) {
  return email.length <= 254 && EMAIL_RE.test(email);
}

/** Splits "a@x.com, b@y.com; c@z.com" (or new lines) into unique normalized addresses. */
export function parseInviteEmails(input: string | string[]) {
  const parts = (Array.isArray(input) ? input : [input])
    .flatMap((chunk) => chunk.split(/[\s,;]+/))
    .map(normalizeInviteEmail)
    .filter(Boolean);
  return Array.from(new Set(parts));
}
