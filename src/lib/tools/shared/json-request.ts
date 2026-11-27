/**
 * Small JSON body helpers for the public tool API routes: a hard byte cap
 * (enforced even without Content-Length) and uniform no-store error bodies.
 */
import { readBodyWithLimit } from "@/lib/import/body";

export function toolErrorResponse(error: string, code: string, status: number): Response {
  return Response.json({ error, code }, { status, headers: { "cache-control": "no-store" } });
}

export type ReadJsonResult = { ok: true; body: unknown } | { ok: false; response: Response };

function tooLarge(): ReadJsonResult {
  return {
    ok: false,
    response: toolErrorResponse("Request is too large.", "PAYLOAD_TOO_LARGE", 413),
  };
}

export async function readLimitedJson(request: Request, maxBytes: number): Promise<ReadJsonResult> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  let text: string;
  try {
    text = new TextDecoder().decode(await readBodyWithLimit(request.body, maxBytes));
  } catch {
    return tooLarge();
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: toolErrorResponse("Malformed or invalid JSON body", "INVALID_JSON", 400),
    };
  }
}
