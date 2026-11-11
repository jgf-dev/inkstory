import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CodexError } from "@/lib/codex/errors";
import { LOREBOOK_LIMITS } from "@/lib/codex/interchange/types";

/** Request bodies wrap the file text in JSON, so allow for escaping overhead. */
const MAX_BODY_BYTES = LOREBOOK_LIMITS.maxFileBytes * 3;

export async function getUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Reads a bounded JSON object body; SyntaxError maps to 400 via handleCodexApiError. */
export async function readJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    throw new CodexError("Request body is too large", "VALIDATION_FAILED", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new CodexError("Request body is too large", "VALIDATION_FAILED", 413);
  }
  const body: unknown = JSON.parse(text);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new CodexError("Request body must be a JSON object", "VALIDATION_FAILED", 400);
  }
  return body as Record<string, unknown>;
}
