/**
 * OpenRouter call for AI-mode backstories, on the shared free-tools client
 * (see `@/lib/tools/shared/openrouter`). Every failure resolves to a reason
 * code so callers can fall back to the template.
 */
import { GENRE_DEFINITIONS } from "@/lib/tools/name-generator/wordlists";
import {
  parseStringFieldContent,
  requestOpenRouterJson,
  type AiFailureReason,
  type OpenRouterOptions,
} from "@/lib/tools/shared/openrouter";
import type { BackstoryInput } from "./types";

export {
  DEFAULT_FREE_MODEL,
  OPENROUTER_CHAT_URL,
  isFreeModel,
  resolveFreeModel,
  type AiFailureReason,
} from "@/lib/tools/shared/openrouter";

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

export type AiBackstoryOutcome =
  | { ok: true; backstory: string; model: string | null }
  | { ok: false; reason: AiFailureReason };

export type AiBackstoryOptions = OpenRouterOptions;

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

/** Validates the model's message content against the backstory schema. */
export function parseBackstoryContent(content: unknown): string | null {
  return parseStringFieldContent(content, {
    field: "backstory",
    minLength: BACKSTORY_MIN_LENGTH,
    maxLength: BACKSTORY_MAX_LENGTH,
  });
}

export async function requestAiBackstory(
  input: BackstoryInput,
  options: AiBackstoryOptions,
): Promise<AiBackstoryOutcome> {
  const outcome = await requestOpenRouterJson({
    ...options,
    timeoutMs: options.timeoutMs ?? BACKSTORY_TIMEOUT_MS,
    title: "Character name generator",
    messages: buildBackstoryMessages(input),
    maxTokens: BACKSTORY_MAX_TOKENS,
    temperature: 0.9,
    jsonSchema: BACKSTORY_JSON_SCHEMA,
    parse: parseBackstoryContent,
  });
  if (!outcome.ok) return outcome;
  return { ok: true, backstory: outcome.value, model: outcome.model };
}
