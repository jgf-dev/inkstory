/**
 * Public AI-mode backstory for the character name generator (STO-1313).
 * No auth. Always answers 200 with a backstory for a valid name: AI output
 * when `TOOLS_OPENROUTER_API_KEY` is set and the call succeeds, otherwise the
 * algorithmic template. Provider errors are never shown to the visitor.
 */
import type { NextRequest } from "next/server";
import {
  BACKSTORY_BODY_MAX_LENGTH,
  clientIpFrom,
  createBackstoryLimiters,
  getCharacterBackstory,
  parseBackstoryInput,
} from "@/lib/tools/character-backstory";
import { readLimitedJson, toolErrorResponse } from "@/lib/tools/shared/json-request";

export const dynamic = "force-dynamic";

// Per-isolate counters; see @/lib/tools/shared/rate-limit.
const limiters = createBackstoryLimiters();

export async function POST(request: NextRequest): Promise<Response> {
  const read = await readLimitedJson(request, BACKSTORY_BODY_MAX_LENGTH);
  if (!read.ok) return read.response;

  const parsed = parseBackstoryInput(read.body);
  if (!parsed.ok) return toolErrorResponse(parsed.error, "VALIDATION_FAILED", 400);

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
