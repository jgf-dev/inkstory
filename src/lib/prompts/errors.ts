/**
 * Shared prompt error type + API error mapping (STO-1158, extended by STO-1275).
 * Lives outside service.ts so pure modules (contracts/portable) can raise the
 * same error shape without importing the DB-backed service.
 */

export type PromptErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "READ_ONLY"
  | "UNRESOLVED_VARS"
  /** Prompt Component contract failed validation (STO-1275). */
  | "INVALID_CONTRACT"
  /** Unknown contract schemaVersion or portable formatVersion (STO-1275). */
  | "UNSUPPORTED_VERSION"
  /** Contract or portable payload exceeds the size/depth caps (STO-1275). */
  | "PAYLOAD_TOO_LARGE"
  /** Portable import file is not a valid inkstory.prompt-component envelope. */
  | "INVALID_PORTABLE"
  /** A required craft input is missing or empty (STO-1275). */
  | "MISSING_INPUT";

export class PromptError extends Error {
  constructor(
    message: string,
    public readonly code: PromptErrorCode,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "PromptError";
  }
}

export function handlePromptApiError(err: unknown): Response {
  if (err instanceof SyntaxError) {
    return Response.json(
      { error: "Malformed or invalid JSON body", code: "INVALID_JSON" },
      { status: 400 },
    );
  }
  if (err instanceof PromptError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
