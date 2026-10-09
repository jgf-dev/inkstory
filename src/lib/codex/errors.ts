/**
 * Codex API error contract, extracted so billing/entitlement guards can throw
 * the same error type without importing the (large) codex service module.
 */

/**
 * Custom error class for Codex domain validation, authorization, and quota
 * failures.
 */
export class CodexError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "VALIDATION_FAILED"
      | "SCOPING_ERROR"
      | "CONFLICT"
      // Billing tier quota exceeded (STO-1180); HTTP 402 signals an upgrade trigger.
      | "QUOTA_EXCEEDED",
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "CodexError";
  }
}

/**
 * Standardized API error handler for Codex REST routes.
 * Ensures malformed JSON (SyntaxError) returns 400 instead of 500.
 */
export function handleCodexApiError(err: unknown): Response {
  if (err instanceof SyntaxError) {
    return Response.json(
      { error: "Malformed or invalid JSON body", code: "INVALID_JSON" },
      { status: 400 },
    );
  }
  if (err instanceof CodexError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
