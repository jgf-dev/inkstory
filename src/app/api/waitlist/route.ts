/**
 * Public waitlist signup (no auth). Validates and normalizes the email, stores
 * it once, and answers the same way for new and repeat signups so the
 * response never reveals whether an address is already on the list.
 */
import type { NextRequest } from "next/server";
import { readBodyWithLimit } from "@/lib/import/body";
import { ImportError } from "@/lib/import/types";
import {
  addWaitlistSignup,
  isWaitlistSelfReferrer,
  parseWaitlistSubmission,
  WAITLIST_BODY_MAX_LENGTH,
  WAITLIST_SUCCESS_MESSAGE,
} from "@/lib/waitlist";

export const dynamic = "force-dynamic";

type ReadBodyResult = { ok: true; text: string } | { ok: false; kind: "too_large" | "read_error" };

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
async function readBoundedText(request: NextRequest): Promise<ReadBodyResult> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > WAITLIST_BODY_MAX_LENGTH) {
    return { ok: false, kind: "too_large" };
  }
  try {
    const bytes = await readBodyWithLimit(request.body, WAITLIST_BODY_MAX_LENGTH);
    return { ok: true, text: new TextDecoder().decode(bytes) };
  } catch (error) {
    if (error instanceof ImportError && error.status === 413) {
      return { ok: false, kind: "too_large" };
    }
    return { ok: false, kind: "read_error" };
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const read = await readBoundedText(request);
  if (!read.ok) {
    return read.kind === "too_large"
      ? tooLarge()
      : errorResponse("Could not read request body.", "INVALID_REQUEST", 400);
  }

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return errorResponse("Malformed or invalid JSON body", "INVALID_JSON", 400);
  }

  const headerReferrer = request.headers.get("referer");
  const fallbackReferrer =
    headerReferrer && !isWaitlistSelfReferrer(headerReferrer, request.url) ? headerReferrer : null;
  const result = parseWaitlistSubmission(body, fallbackReferrer);
  if (result.kind === "invalid") {
    return errorResponse(result.error, "VALIDATION_FAILED", 400);
  }

  if (result.kind === "signup") {
    const referrer =
      result.signup.referrer && !isWaitlistSelfReferrer(result.signup.referrer, request.url)
        ? result.signup.referrer
        : null;
    try {
      await addWaitlistSignup({ ...result.signup, referrer });
    } catch (error) {
      console.error("[waitlist] could not store signup:", error);
      return errorResponse("Something went wrong. Please try again.", "INTERNAL_ERROR", 500);
    }
  }

  return Response.json({ ok: true, message: WAITLIST_SUCCESS_MESSAGE });
}
