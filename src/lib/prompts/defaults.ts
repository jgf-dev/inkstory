/**
 * SYSTEM_DEFAULT prompt bodies matching historical `buildSceneMessages`
 * (STO-1158). Seeded into the DB and also used offline by the deprecated
 * wrapper so unit tests need no network/DB.
 */

import type { GenerationMode } from "@/lib/ai/generate";
import type { PromptPart } from "./types";

export const DEFAULT_MAX_CONTENT_CHARS = 8000;

export const SYSTEM_DEFAULT_CONTINUATION_SYSTEM = [
  "You are a skilled fiction co-writer embedded in InkStory, a novel-writing workspace.",
  "Story: {{novel.title}} — {{chapter.title}} / {{scene.title}}.",
  "Write in {{scene.pov}} and {{scene.tense}} tense.",
  "Continue the author's voice: match tone, diction, and pacing already present in the scene.",
  "Story bible entries that apply to this scene are provided below. Respect their facts and current state; never contradict them.",
  "Return prose only — no headings, no commentary, no markdown fences.",
  "",
  "{{codex.context}}",
].join("\n");

export const SYSTEM_DEFAULT_CONTINUATION_USER = [
  "Continue this scene from exactly where it leaves off, writing roughly 150–400 words of prose that flow naturally from the final line.",
  "",
  'Beat to realize:\n"""\n{{beat.text}}\n"""\n',
  "Scene so far:",
  '"""',
  "{{scene.content}}",
  '"""',
].join("\n");

export const SYSTEM_DEFAULT_BEAT_EXPANSION_SYSTEM = SYSTEM_DEFAULT_CONTINUATION_SYSTEM;

export const SYSTEM_DEFAULT_BEAT_EXPANSION_USER = [
  "Expand the beat below into full scene prose (roughly 150–400 words). Ground it in the scene context already established.",
  "",
  'Beat to realize:\n"""\n{{beat.text}}\n"""\n',
  'Scene summary:\n"""\n{{scene.summary}}\n"""\n',
  'Existing scene prose:\n"""\n{{scene.content}}\n"""',
].join("\n");

export function systemDefaultParts(mode: GenerationMode | string): PromptPart[] {
  if (mode === "beat_expansion") {
    return [
      {
        role: "system",
        body: SYSTEM_DEFAULT_BEAT_EXPANSION_SYSTEM,
        name: "system-default-beat-system",
      },
      { role: "user", body: SYSTEM_DEFAULT_BEAT_EXPANSION_USER, name: "system-default-beat-user" },
    ];
  }
  return [
    {
      role: "system",
      body: SYSTEM_DEFAULT_CONTINUATION_SYSTEM,
      name: "system-default-continuation-system",
    },
    {
      role: "user",
      body: SYSTEM_DEFAULT_CONTINUATION_USER,
      name: "system-default-continuation-user",
    },
  ];
}

export const SYSTEM_DEFAULT_SEED = [
  {
    id: "sys-prompt-continuation",
    name: "Scene continuation (system default)",
    description: "Shipped default matching InkStory's original continuation prompt.",
    mode: "continuation",
    systemBody: SYSTEM_DEFAULT_CONTINUATION_SYSTEM,
    userBody: SYSTEM_DEFAULT_CONTINUATION_USER,
  },
  {
    id: "sys-prompt-beat-expansion",
    name: "Beat expansion (system default)",
    description: "Shipped default matching InkStory's original beat-expansion prompt.",
    mode: "beat_expansion",
    systemBody: SYSTEM_DEFAULT_BEAT_EXPANSION_SYSTEM,
    userBody: SYSTEM_DEFAULT_BEAT_EXPANSION_USER,
  },
] as const;
