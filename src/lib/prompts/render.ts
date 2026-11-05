import type { PromptBindings } from "./catalog";
import { DEFAULT_MAX_CONTENT_CHARS, systemDefaultParts } from "./defaults";
import { interpolate, tidyInterpolatedText } from "./interpolate";
import type { PromptPart, RenderedPrompt, ScenePromptBindingInput } from "./types";

/**
 * Builds closed-catalog bindings from scene generation inputs.
 * Truncates scene prose the same way historical buildSceneMessages did.
 */
export function buildSceneBindings(input: ScenePromptBindingInput): PromptBindings {
  const maxChars = input.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
  const prose =
    input.sceneContent.length > maxChars
      ? `[…earlier text omitted…]\n${input.sceneContent.slice(-maxChars)}`
      : input.sceneContent;

  return {
    "codex.context": input.codexPrompt,
    "codex.description": input.codexDescription ?? "",
    "scene.summary": input.summary ?? "",
    "scene.content": prose,
    "scene.title": input.sceneTitle,
    "chapter.title": input.chapterTitle,
    "novel.title": input.novelTitle,
    // Match historical buildSceneMessages which lowercased POV/tense labels.
    "scene.pov": input.povLabel.toLowerCase(),
    "scene.tense": input.tenseLabel.toLowerCase(),
    "beat.text": input.beatText?.trim() ?? "",
    mode: input.mode,
  };
}

/**
 * Renders ordered prompt parts into chat messages. Parts with the same role
 * that are adjacent are concatenated with a blank line; role changes start a
 * new message. Preview and Generate share this function.
 */
export function renderPrompt(parts: PromptPart[], bindings: PromptBindings): RenderedPrompt {
  const unresolved = new Set<ReturnType<typeof interpolate>["unresolved"][number]>();
  const unknownTokens = new Set<string>();
  const messages: RenderedPrompt["messages"] = [];

  for (const part of parts) {
    const result = interpolate(part.body, bindings);
    for (const token of result.unresolved) unresolved.add(token);
    for (const token of result.unknownTokens) unknownTokens.add(token);
    const content = tidyInterpolatedText(result.text);
    if (!content) continue;

    const last = messages[messages.length - 1];
    if (last && last.role === part.role) {
      last.content = tidyInterpolatedText(`${last.content}\n\n${content}`);
    } else {
      messages.push({ role: part.role, content });
    }
  }

  const joined = messages.map((m) => `--- ${m.role} ---\n${m.content}`).join("\n\n");

  return {
    messages,
    joined,
    unresolved: [...unresolved],
    unknownTokens: [...unknownTokens],
  };
}

/** Offline render using shipped SYSTEM_DEFAULT templates (no DB). */
export function renderDefaultScenePrompt(input: ScenePromptBindingInput): RenderedPrompt {
  return renderPrompt(systemDefaultParts(input.mode), buildSceneBindings(input));
}
