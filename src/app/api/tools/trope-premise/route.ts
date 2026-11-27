/**
 * Public AI-mode premise blurb for the story trope generator (STO-1314).
 * No auth. Always answers 200 for a valid combo: an AI premise when
 * `TOOLS_OPENROUTER_API_KEY` is set and the call succeeds, otherwise the
 * algorithmic combo (catalog names and descriptions). Provider errors are
 * never shown to the visitor.
 */
import type { NextRequest } from "next/server";
import { readLimitedJson, toolErrorResponse } from "@/lib/tools/shared/json-request";
import {
  PREMISE_BODY_MAX_LENGTH,
  clientIpFrom,
  createToolAiLimiters,
  getTropePremise,
  parsePremiseInput,
} from "@/lib/tools/trope-premise";

export const dynamic = "force-dynamic";

// Per-isolate counters; see @/lib/tools/shared/rate-limit.
const limiters = createToolAiLimiters();

export async function POST(request: NextRequest): Promise<Response> {
  const read = await readLimitedJson(request, PREMISE_BODY_MAX_LENGTH);
  if (!read.ok) return read.response;

  const parsed = parsePremiseInput(read.body);
  if (!parsed.ok) return toolErrorResponse(parsed.error, "VALIDATION_FAILED", 400);

  const result = await getTropePremise(parsed.input, clientIpFrom(request.headers), {
    apiKey: process.env.TOOLS_OPENROUTER_API_KEY,
    model: process.env.TOOLS_OPENROUTER_MODEL,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    ...limiters,
    onFallback: (reason) => {
      // An unset key is the expected default; only log real fallbacks.
      if (reason !== "not_configured") {
        console.warn(`[tools/trope-premise] combo fallback: ${reason}`);
      }
    },
  });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
