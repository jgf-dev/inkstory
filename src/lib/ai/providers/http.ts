import { ProviderError, redactSecret, type ProviderId } from "./types";

/**
 * Build a normalized {@link ProviderError} for transport and network failures.
 * Abort and timeout signals map to `TIMEOUT`; all other errors map to
 * `NETWORK_ERROR` with the API key redacted from the message.
 */
export function createTransportError(
  err: unknown,
  prefix: string,
  label: string,
  providerId: ProviderId,
  apiKey?: string,
  status?: number,
): ProviderError {
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return new ProviderError(`${label} request was aborted`, "TIMEOUT", providerId, status);
  }
  const detail = err instanceof Error ? err.message : String(err);
  const text = `${prefix}: ${detail}`;
  const safeText = apiKey ? redactSecret(text, apiKey) : text;
  return new ProviderError(safeText, "NETWORK_ERROR", providerId, status);
}

/**
 * Read and JSON-parse a fetch {@link Response}. Wraps body read failures in a
 * redacted `NETWORK_ERROR` and rejects successful non-JSON responses with
 * `INVALID_RESPONSE`.
 */
export async function readJsonResponse(
  response: Response,
  label: string,
  providerId: ProviderId,
  apiKey?: string,
): Promise<unknown> {
  let raw: string;
  try {
    raw = await response.text();
  } catch (err) {
    throw createTransportError(
      err,
      `Could not read ${label} response`,
      label,
      providerId,
      apiKey,
      response.status,
    );
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    if (response.ok) {
      throw new ProviderError(
        `${label} returned a non-JSON response`,
        "INVALID_RESPONSE",
        providerId,
        response.status,
      );
    }
    return null;
  }
}
