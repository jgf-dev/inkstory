/**
 * Public waitlist signup (no auth). Validates and normalizes the email, stores
 * it once, and answers the same way for new and repeat signups so the
 * response never reveals whether an address is already on the list.
 */
import type { NextRequest } from "next/server";
import { readBodyWithLimit } from "@/lib/import/body";
import {
  addWaitlistSignup,
  parseWaitlistSubmission,
  WAITLIST_BODY_MAX_LENGTH,
  WAITLIST_SUCCESS_MESSAGE,
} from "@/lib/waitlist";

export const dynamic = "force-dynamic";

function errorResponse(error: string, code: string, status: number): Response {
  return Response.json({ error, code }, { status });
}

function tooLarge(): Response {
  return errorResponse("Request is too large.", "PAYLOAD_TOO_LARGE", 413);
}

/**
 * Reads at most WAITLIST_BODY_MAX_LENGTH bytes. A too-large Content-Length is
 * rejected before reading, and the stream is cancelled once it passes the cap
 * (chunked or mislabelled bodies), so an oversized body is never buffered.
 */
async function readBoundedText(request: NextRequest): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > WAITLIST_BODY_MAX_LENGTH) return null;
  try {
    const bytes = await readBodyWithLimit(request.body, WAITLIST_BODY_MAX_LENGTH);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const raw = await readBoundedText(request);
  if (raw === null) return tooLarge();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return errorResponse("Malformed or invalid JSON body", "INVALID_JSON", 400);
  }

  const result = parseWaitlistSubmission(body, request.headers.get("referer"));
  if (result.kind === "invalid") {
    return errorResponse(result.error, "VALIDATION_FAILED", 400);
  }

  if (result.kind === "signup") {
    try {
      await addWaitlistSignup(result.signup);
    } catch (error) {
      console.error("[waitlist] could not store signup:", error);
      return errorResponse("Something went wrong. Please try again.", "INTERNAL_ERROR", 500);
    }
  }

  return Response.json({ ok: true, message: WAITLIST_SUCCESS_MESSAGE });
}
