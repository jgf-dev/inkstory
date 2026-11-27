/**
 * Shared OpenRouter client for the free public tools' AI modes. Only free
 * models are ever requested, output is capped and must match a JSON schema,
 * and every failure resolves to a short reason code so callers can fall back
 * to their algorithmic result. The API key is sent only in the Authorization
 * header and never logged or returned.
 */

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
/** OpenRouter's Free Models Router: only ever routes to zero-cost models. */
export const DEFAULT_FREE_MODEL = "openrouter/free";
export const DEFAULT_AI_TIMEOUT_MS = 8000;

/** Why an AI attempt produced nothing; safe to log (never contains the key). */
export type AiFailureReason =
  | "quota"
  | "rate_limited"
  | "http_error"
  | "timeout"
  | "network"
  | "invalid_output";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export type OpenRouterOutcome<T> =
  | { ok: true; value: T; model: string | null }
  | { ok: false; reason: AiFailureReason };

/** Connection options shared by every tool's AI call. */
export interface OpenRouterOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  appUrl?: string;
}

export interface OpenRouterJsonRequest<T> extends OpenRouterOptions {
  /** Sent as `x-title` so usage shows up per tool on OpenRouter. */
  title: string;
  messages: readonly ChatMessage[];
  maxTokens: number;
  temperature: number;
  jsonSchema: { name: string; strict: boolean; schema: object };
  /** Validates the model's message content; `null` means invalid output. */
  parse: (content: unknown) => T | null;
}

/** Only `openrouter/free` and `:free` variants are allowed, so a typo can't bill. */
export function isFreeModel(model: string | undefined): model is string {
  const trimmed = model?.trim() ?? "";
  return trimmed === DEFAULT_FREE_MODEL || /^[\w.-]+\/[\w.:-]+:free$/.test(trimmed);
}

export function resolveFreeModel(model: string | undefined): string {
  return isFreeModel(model) ? model.trim() : DEFAULT_FREE_MODEL;
}

/** URLs, currency symbols and HTML tags are never rendered from AI output. */
export const DISALLOWED_OUTPUT = /https?:\/\/|www\.|\p{Sc}|<\/?[a-z]/iu;

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

export interface StringFieldRules {
  field: string;
  minLength: number;
  maxLength: number;
}

/**
 * Parses content shaped as `{ [field]: string }` with no other keys, returns
 * the whitespace-normalized string when it fits the length bounds and has no
 * links, prices or markup, otherwise `null`.
 */
export function parseStringFieldContent(content: unknown, rules: StringFieldRules): string | null {
  if (typeof content !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(content));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed);
  const value = (parsed as Record<string, unknown>)[rules.field];
  if (keys.length !== 1 || typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < rules.minLength || text.length > rules.maxLength) return null;
  if (DISALLOWED_OUTPUT.test(text)) return null;
  return text;
}

function reasonForStatus(status: number): AiFailureReason {
  if (status === 402) return "quota";
  if (status === 429) return "rate_limited";
  return "http_error";
}

interface ChatCompletionBody {
  model?: unknown;
  choices?: { message?: { content?: unknown } }[];
}

export async function requestOpenRouterJson<T>(
  request: OpenRouterJsonRequest<T>,
): Promise<OpenRouterOutcome<T>> {
  const fetchImpl = request.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS);
  const headers: Record<string, string> = {
    authorization: `Bearer ${request.apiKey}`,
    "content-type": "application/json",
    "x-title": request.title,
  };
  if (request.appUrl) headers["http-referer"] = request.appUrl;

  try {
    const response = await fetchImpl(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: resolveFreeModel(request.model),
        messages: request.messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        response_format: { type: "json_schema", json_schema: request.jsonSchema },
      }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, reason: reasonForStatus(response.status) };
    }
    let body: ChatCompletionBody;
    try {
      body = (await response.json()) as ChatCompletionBody;
    } catch {
      return { ok: false, reason: controller.signal.aborted ? "timeout" : "invalid_output" };
    }
    const value = request.parse(body.choices?.[0]?.message?.content);
    if (value === null) return { ok: false, reason: "invalid_output" };
    return { ok: true, value, model: typeof body.model === "string" ? body.model : null };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
