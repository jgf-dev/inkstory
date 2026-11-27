/**
 * Public AI-mode backstory for the character name generator (STO-1313).
 * No auth. Always answers 200 with a backstory for a valid name: AI output
 * when `TOOLS_OPENROUTER_API_KEY` is set and the call succeeds, otherwise the
 * algorithmic template. Provider errors are never shown to the visitor.
 */
import type { NextRequest } from "next/server";
import { readBodyWithLimit } from "@/lib/import/body";
import {
  BACKSTORY_BODY_MAX_LENGTH,
  clientIpFrom,
  createBackstoryLimiters,
  getCharacterBackstory,
  parseBackstoryInput,
} from "@/lib/tools/character-backstory";

export const dynamic = "force-dynamic";

// Per-isolate counters; see rate-limit.ts.
const limiters = createBackstoryLimiters();

function errorResponse(error: string, code: string, status: number): Response {
  return Response.json({ error, code }, { status, headers: { "cache-control": "no-store" } });
}

async function readJson(
  request: NextRequest,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > BACKSTORY_BODY_MAX_LENGTH) {
    return {
      ok: false,
      response: errorResponse("Request is too large.", "PAYLOAD_TOO_LARGE", 413),
    };
  }
  let text: string;
  try {
    text = new TextDecoder().decode(
      await readBodyWithLimit(request.body, BACKSTORY_BODY_MAX_LENGTH),
    );
  } catch {
    return {
      ok: false,
      response: errorResponse("Request is too large.", "PAYLOAD_TOO_LARGE", 413),
    };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: errorResponse("Malformed or invalid JSON body", "INVALID_JSON", 400),
    };
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const read = await readJson(request);
  if (!read.ok) return read.response;

  const parsed = parseBackstoryInput(read.body);
  if (!parsed.ok) return errorResponse(parsed.error, "VALIDATION_FAILED", 400);

  const result = await getCharacterBackstory(parsed.input, clientIpFrom(request.headers), {
    apiKey: process.env.TOOLS_OPENROUTER_API_KEY,
    model: process.env.TOOLS_OPENROUTER_MODEL,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    ...limiters,
    onFallback: (reason) => {
      // An unset key is the expected default; only log real fallbacks.
      if (reason !== "not_configured") {
        console.warn(`[tools/character-backstory] template fallback: ${reason}`);
      }
    },
  });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
