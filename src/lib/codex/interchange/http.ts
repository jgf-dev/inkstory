import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CodexError } from "@/lib/codex/errors";
import { CARD_LIMITS, LOREBOOK_LIMITS } from "@/lib/codex/interchange/types";

/** Request bodies wrap the file text in JSON, so allow for escaping overhead. */
const MAX_BODY_BYTES = LOREBOOK_LIMITS.maxFileBytes * 3;

/**
 * Card bodies carry either escaped JSON/YAML text or a base64 PNG (4/3 of the
 * PNG size); allow the larger of the two plus room for the other fields.
 */
export const CARD_MAX_BODY_BYTES = Math.max(
  CARD_LIMITS.maxFileBytes * 3,
  Math.ceil((CARD_LIMITS.maxPngBytes * 4) / 3) + 64 * 1024,
);

export async function getUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Reads a bounded JSON object body; SyntaxError maps to 400 via handleCodexApiError. */
export async function readJsonBody(
  request: NextRequest,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw new CodexError("Request body is too large", "VALIDATION_FAILED", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new CodexError("Request body is too large", "VALIDATION_FAILED", 413);
  }
  const body: unknown = JSON.parse(text);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new CodexError("Request body must be a JSON object", "VALIDATION_FAILED", 400);
  }
  return body as Record<string, unknown>;
}
