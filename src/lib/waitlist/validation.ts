/**
 * Pure input handling for the public waitlist signup (no DB access), so it runs
 * under `bun run test:no-db`.
 */

/** Longest address accepted (the practical SMTP limit). */
export const WAITLIST_EMAIL_MAX_LENGTH = 254;
/** Longest local part (before `@`) accepted. */
export const WAITLIST_EMAIL_LOCAL_MAX_LENGTH = 64;
/** Longest `source` tag kept; longer or non-slug values are dropped. */
export const WAITLIST_SOURCE_MAX_LENGTH = 64;
/** Longest referrer kept; longer values are truncated. */
export const WAITLIST_REFERRER_MAX_LENGTH = 512;
/** Largest request body the handler will read, in characters. */
export const WAITLIST_BODY_MAX_LENGTH = 4096;
/** Hidden form field that real visitors leave empty (bots tend to fill it). */
export const WAITLIST_HONEYPOT_FIELD = "website";

export const WAITLIST_SUCCESS_MESSAGE = "Thanks! You're on the list.";
export const WAITLIST_INVALID_EMAIL_MESSAGE = "Please enter a valid email address.";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const SOURCE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** A signup ready to store. */
export interface WaitlistSignupInput {
  email: string;
  source: string | null;
  referrer: string | null;
}

export type WaitlistParseResult =
  | { kind: "signup"; signup: WaitlistSignupInput }
  /** The honeypot was filled: answer as if it worked, store nothing. */
  | { kind: "honeypot" }
  | { kind: "invalid"; error: string };

/** Trims and lowercases an email address. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** True for a normalized address of a plausible shape and length. */
export function isValidEmail(email: string): boolean {
  if (email.length === 0 || email.length > WAITLIST_EMAIL_MAX_LENGTH) return false;
  if (!EMAIL_PATTERN.test(email)) return false;
  const localPart = email.slice(0, email.lastIndexOf("@"));
  return localPart.length <= WAITLIST_EMAIL_LOCAL_MAX_LENGTH;
}

/** Keeps a short lowercase slug (e.g. `x`, `newsletter`), otherwise null. */
export function normalizeSource(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const source = raw.trim().toLowerCase();
  if (source.length === 0 || source.length > WAITLIST_SOURCE_MAX_LENGTH) return null;
  return SOURCE_PATTERN.test(source) ? source : null;
}

/** Keeps a trimmed referrer, truncated to the column limit, otherwise null. */
export function normalizeReferrer(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const referrer = raw.trim();
  if (referrer.length === 0) return null;
  return referrer.slice(0, WAITLIST_REFERRER_MAX_LENGTH);
}

/**
 * Validates a parsed request body. `referrer` comes from the request (the
 * Referer header), not the body.
 */
export function parseWaitlistSubmission(
  body: unknown,
  referrer: string | null = null,
): WaitlistParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "invalid", error: WAITLIST_INVALID_EMAIL_MESSAGE };
  }
  const fields = body as Record<string, unknown>;

  const honeypot = fields[WAITLIST_HONEYPOT_FIELD];
  if (typeof honeypot === "string" && honeypot.trim().length > 0) {
    return { kind: "honeypot" };
  }

  const rawEmail = fields.email;
  if (typeof rawEmail !== "string" || rawEmail.length > WAITLIST_EMAIL_MAX_LENGTH * 2) {
    return { kind: "invalid", error: WAITLIST_INVALID_EMAIL_MESSAGE };
  }
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    return { kind: "invalid", error: WAITLIST_INVALID_EMAIL_MESSAGE };
  }

  return {
    kind: "signup",
    signup: {
      email,
      source: normalizeSource(fields.source),
      referrer: normalizeReferrer(referrer),
    },
  };
}
