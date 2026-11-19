/**
 * Cloudflare Turnstile server-side verification and configuration helpers.
 *
 * Siteverify is strictly server-side (`POST /api/auth/login`, `POST /api/auth/signup`)
 * and fails closed whenever the token, secret, action, or hostname allowlist fails.
 */

const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const DEFAULT_TURNSTILE_SITE_KEY = "0x4AAAAAAGGPGpjMBFjy08CL";
export const TURNSTILE_TOKEN_FIELD = "cf-turnstile-response";

export type TurnstileAction = "signup" | "login";

interface SiteverifyResponse {
  success?: unknown;
  action?: unknown;
  hostname?: unknown;
  "error-codes"?: unknown;
}

export function getTurnstileSiteKey(): string {
  const configured =
    process.env.NEXT_PUBLIC_TURNSTILE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return configured || DEFAULT_TURNSTILE_SITE_KEY;
}

export function getExpectedTurnstileHostnames(
  raw = process.env.TURNSTILE_HOSTNAMES ?? "",
): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((hostname) => hostname.trim())
      .filter(Boolean),
  );
}

export function getClientIp(request: Request): string | undefined {
  const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || undefined;
}

export async function verifyTurnstileToken({
  token,
  expectedAction,
  remoteIp,
}: {
  token: unknown;
  expectedAction: TurnstileAction;
  remoteIp?: string;
}): Promise<{ ok: true } | { ok: false }> {
  const secret = process.env.TURNSTILE_SECRET?.trim() ?? "";
  const expectedHostnames = getExpectedTurnstileHostnames();

  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 2048 ||
    secret.length === 0 ||
    expectedHostnames.size === 0
  ) {
    return { ok: false };
  }

  const body = new URLSearchParams({
    secret,
    response: token,
  });
  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  let result: SiteverifyResponse;
  try {
    const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body,
    });
    if (!response.ok) {
      return { ok: false };
    }
    result = (await response.json()) as SiteverifyResponse;
  } catch {
    return { ok: false };
  }

  if (
    result.success !== true ||
    result.action !== expectedAction ||
    typeof result.hostname !== "string" ||
    !expectedHostnames.has(result.hostname)
  ) {
    return { ok: false };
  }

  return { ok: true };
}
