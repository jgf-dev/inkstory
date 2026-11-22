/**
 * Frozen closed variable catalog for prompt interpolation (STO-1158).
 * Authors cannot invent custom {{vars}} in v1.
 */

export const PROMPT_VARIABLE_TOKENS = [
  "codex.context",
  "codex.description",
  "scene.summary",
  "scene.content",
  "scene.title",
  "chapter.title",
  "novel.title",
  "scene.pov",
  "scene.tense",
  "beat.text",
  "mode",
] as const;

export type PromptVariableToken = (typeof PROMPT_VARIABLE_TOKENS)[number];

export type PromptBindings = Record<PromptVariableToken, string>;

/** Matches `{{token}}` with optional surrounding whitespace inside braces. */
export const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function isPromptVariableToken(value: string): value is PromptVariableToken {
  return (PROMPT_VARIABLE_TOKENS as readonly string[]).includes(value);
}

export function emptyBindings(): PromptBindings {
  return {
    "codex.context": "",
    "codex.description": "",
    "scene.summary": "",
    "scene.content": "",
    "scene.title": "",
    "chapter.title": "",
    "novel.title": "",
    "scene.pov": "",
    "scene.tense": "",
    "beat.text": "",
    mode: "",
  };
}
