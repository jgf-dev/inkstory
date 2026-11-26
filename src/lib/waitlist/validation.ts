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
/** Largest request body the handler will read, in bytes. */
export const WAITLIST_BODY_MAX_LENGTH = 4096;
/** Hidden form field that real visitors leave empty (bots tend to fill it). */
export const WAITLIST_HONEYPOT_FIELD = "website";

export const WAITLIST_SUCCESS_MESSAGE = "Thanks! You're on the list.";
export const WAITLIST_INVALID_EMAIL_MESSAGE = "Please enter a valid email address.";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const SOURCE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function stripControlChars(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code > 0x1f && code !== 0x7f) out += value[i];
  }
  return out;
}

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
  if (hasControlChar(email)) return false;
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

/** Keeps a trimmed referrer without control characters, truncated to the column limit. */
export function normalizeReferrer(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const referrer = stripControlChars(raw).trim();
  if (referrer.length === 0) return null;
  return referrer.slice(0, WAITLIST_REFERRER_MAX_LENGTH);
}

/**
 * True when `referrer` points back to `/waitlist` on the same origin as the
 * API request (what browsers send as the `Referer` header on `fetch()`).
 */
export function isWaitlistSelfReferrer(referrer: string, requestUrl: string): boolean {
  try {
    const refUrl = new URL(referrer);
    const reqUrl = new URL(requestUrl);
    return (
      refUrl.origin === reqUrl.origin &&
      (refUrl.pathname === "/waitlist" || refUrl.pathname === "/waitlist/")
    );
  } catch {
    return false;
  }
}

/**
 * Validates a parsed request body. Prefers an explicit `referrer` from the
 * client (i.e. `document.referrer` captured on `/waitlist`) and falls back to
 * the request's `Referer` header when present.
 */
export function parseWaitlistSubmission(
  body: unknown,
  fallbackReferrer: string | null = null,
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
      referrer: normalizeReferrer(fields.referrer) ?? normalizeReferrer(fallbackReferrer),
    },
  };
}
