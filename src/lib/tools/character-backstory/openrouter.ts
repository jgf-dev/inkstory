/**
 * OpenRouter call for AI-mode backstories. Only free models are ever
 * requested, the output is capped and must match a JSON schema, and every
 * failure resolves to `null` so callers can fall back to the template. The
 * API key is sent only in the Authorization header and never logged.
 */
import { GENRE_DEFINITIONS } from "../name-generator/wordlists";
import type { BackstoryInput } from "./types";

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
/** OpenRouter's Free Models Router: only ever routes to zero-cost models. */
export const DEFAULT_FREE_MODEL = "openrouter/free";
export const BACKSTORY_MAX_TOKENS = 220;
export const BACKSTORY_TIMEOUT_MS = 8000;
export const BACKSTORY_MIN_LENGTH = 40;
export const BACKSTORY_MAX_LENGTH = 700;

export const BACKSTORY_JSON_SCHEMA = {
  name: "character_backstory",
  strict: true,
  schema: {
    type: "object",
    properties: {
      backstory: {
        type: "string",
        description: "Two to four sentences of character backstory, plain prose.",
      },
    },
    required: ["backstory"],
    additionalProperties: false,
  },
} as const;

/** Why an AI attempt produced nothing; safe to log (never contains the key). */
export type AiFailureReason =
  | "quota"
  | "rate_limited"
  | "http_error"
  | "timeout"
  | "network"
  | "invalid_output";

export type AiBackstoryOutcome =
  | { ok: true; backstory: string; model: string | null }
  | { ok: false; reason: AiFailureReason };

export interface AiBackstoryOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  appUrl?: string;
}

/** Only `openrouter/free` and `:free` variants are allowed, so a typo can't bill. */
export function isFreeModel(model: string | undefined): model is string {
  const trimmed = model?.trim() ?? "";
  return trimmed === DEFAULT_FREE_MODEL || /^[\w.-]+\/[\w.:-]+:free$/.test(trimmed);
}

export function resolveFreeModel(model: string | undefined): string {
  return isFreeModel(model) ? model.trim() : DEFAULT_FREE_MODEL;
}

function flavorLabel(input: BackstoryInput): string | null {
  const genre = GENRE_DEFINITIONS.find((entry) => entry.id === input.genre);
  return genre?.flavors.find((flavor) => flavor.id === input.flavor)?.label ?? null;
}

export function buildBackstoryMessages(input: BackstoryInput) {
  const flavor = flavorLabel(input);
  const setting = flavor ? `${input.genre} (${flavor})` : input.genre;
  return [
    {
      role: "system" as const,
      content:
        "You write short fictional character backstories for novelists. Reply with JSON only, " +
        'shaped as {"backstory": "..."}. Write two to four sentences of plain prose: an origin, ' +
        "a defining wound or secret, and what the character wants now. No lists, headings, " +
        "links, prices, real-world dates, products or brand names. Keep it suitable for all " +
        "audiences.",
    },
    {
      role: "user" as const,
      content: `Character name: ${input.name}\nGenre: ${setting}\nGender presentation: ${input.gender}`,
    },
  ];
}

const DISALLOWED_OUTPUT = /https?:\/\/|www\.|[$€£¥]|<\/?[a-z]/i;

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

/** Validates the model's message content against the backstory schema. */
export function parseBackstoryContent(content: unknown): string | null {
  if (typeof content !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(content));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed);
  const backstory = (parsed as { backstory?: unknown }).backstory;
  if (keys.length !== 1 || typeof backstory !== "string") return null;
  const text = backstory.replace(/\s+/g, " ").trim();
  if (text.length < BACKSTORY_MIN_LENGTH || text.length > BACKSTORY_MAX_LENGTH) return null;
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

export async function requestAiBackstory(
  input: BackstoryInput,
  options: AiBackstoryOptions,
): Promise<AiBackstoryOutcome> {
  const fetchImpl = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? BACKSTORY_TIMEOUT_MS);
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.apiKey}`,
    "content-type": "application/json",
    "x-title": "Character name generator",
  };
  if (options.appUrl) headers["http-referer"] = options.appUrl;

  try {
    const response = await fetchImpl(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: resolveFreeModel(options.model),
        messages: buildBackstoryMessages(input),
        max_tokens: BACKSTORY_MAX_TOKENS,
        temperature: 0.9,
        response_format: { type: "json_schema", json_schema: BACKSTORY_JSON_SCHEMA },
      }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, reason: reasonForStatus(response.status) };
    }
    const body = (await response.json()) as ChatCompletionBody;
    const backstory = parseBackstoryContent(body.choices?.[0]?.message?.content);
    if (!backstory) return { ok: false, reason: "invalid_output" };
    return { ok: true, backstory, model: typeof body.model === "string" ? body.model : null };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
