/**
 * OpenRouter call for the trope generator's AI mode (STO-1314), on the shared
 * free-tools client. Output must match a one-field JSON schema and the copy
 * rules below before it is ever rendered.
 */
import {
  parseStringFieldContent,
  requestOpenRouterJson,
  type ChatMessage,
  type OpenRouterOptions,
  type OpenRouterOutcome,
} from "@/lib/tools/shared/openrouter";
import { ANY } from "@/lib/tools/story-tropes/types";
import type { PremiseInput } from "./types";

export const PREMISE_MAX_TOKENS = 180;
export const PREMISE_TIMEOUT_MS = 8000;
export const PREMISE_MIN_LENGTH = 60;
export const PREMISE_MAX_LENGTH = 600;

export const PREMISE_JSON_SCHEMA = {
  name: "trope_premise",
  strict: true,
  schema: {
    type: "object",
    properties: {
      premise: {
        type: "string",
        description: "Two or three sentences of story premise, plain prose.",
      },
    },
    required: ["premise"],
    additionalProperties: false,
  },
} as const;

/**
 * Copy rules on top of the shared link/currency/markup filter: no pricing,
 * no promises or guarantees, no real dates, years or launch timelines, and
 * no product names.
 */
const COPY_RULE_VIOLATIONS = [
  /\b(?:prices?|pricing|priced|discounts?|subscriptions?|subscribe|free trial|refunds?)\b/i,
  /\b(?:guarantee[sd]?|guaranteed|we promise|you will love|money back)\b/i,
  /\b(?:1\d|20)\d{2}\b/,
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\.? \d{1,2}(?:st|nd|rd|th)?\b/i,
  /\b(?:launch(?:es|ing)? (?:date|day|soon)|coming soon|release date|available now|sign up|pre-?order)\b/i,
  /\b(?:syncodex|inkstory|openrouter)\b/i,
];

export function violatesCopyRules(text: string): boolean {
  return COPY_RULE_VIOLATIONS.some((pattern) => pattern.test(text));
}

export function buildPremiseMessages(input: PremiseInput): ChatMessage[] {
  const tropeLines = input.tropes.map((trope) => `- ${trope.name}: ${trope.description}`);
  const genre = input.genre === ANY ? "any genre" : input.genre;
  return [
    {
      role: "system",
      content:
        "You write short original story premises for novelists. Reply with JSON only, shaped " +
        'as {"premise": "..."}. Write two or three sentences of plain prose that combine every ' +
        "listed trope into one story setup: who, what they want, and what stands in the way. " +
        "No lists, headings, links, prices, promises, guarantees, real-world dates, years, " +
        "release or launch timelines, products or brand names. Keep it suitable for all audiences.",
    },
    { role: "user", content: `Genre: ${genre}\nTropes:\n${tropeLines.join("\n")}` },
  ];
}

/** Validates the model's message content against the premise schema and copy rules. */
export function parsePremiseContent(content: unknown): string | null {
  const text = parseStringFieldContent(content, {
    field: "premise",
    minLength: PREMISE_MIN_LENGTH,
    maxLength: PREMISE_MAX_LENGTH,
  });
  return text && !violatesCopyRules(text) ? text : null;
}

export function requestAiPremise(
  input: PremiseInput,
  options: OpenRouterOptions,
): Promise<OpenRouterOutcome<string>> {
  return requestOpenRouterJson({
    ...options,
    timeoutMs: options.timeoutMs ?? PREMISE_TIMEOUT_MS,
    title: "Story trope generator",
    messages: buildPremiseMessages(input),
    maxTokens: PREMISE_MAX_TOKENS,
    temperature: 0.9,
    jsonSchema: PREMISE_JSON_SCHEMA,
    parse: parsePremiseContent,
  });
}
