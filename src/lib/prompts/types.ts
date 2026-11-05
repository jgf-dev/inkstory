import type { GenerationMode } from "@/lib/ai/generate";
import type { PromptBindings, PromptVariableToken } from "./catalog";

export type PromptRoleName = "SYSTEM" | "USER";
export type PromptScopeName = "SYSTEM_DEFAULT" | "USER" | "NOVEL";

export interface PromptPart {
  role: "system" | "user";
  body: string;
  /** Optional label for debugging (component/prompt name). */
  name?: string;
}

export interface RenderedPrompt {
  messages: Array<{ role: "system" | "user"; content: string }>;
  /** Debug concatenation of messages in order. */
  joined: string;
  unresolved: PromptVariableToken[];
  /** Tokens that appeared but are not in the closed catalog. */
  unknownTokens: string[];
}

export interface PromptDto {
  id: string;
  name: string;
  description: string | null;
  mode: string;
  scope: PromptScopeName;
  body: string;
  role: PromptRoleName;
  position: number;
  isActive: boolean;
  ownerId: string | null;
  novelId: string | null;
  updatedAt: string;
  components?: PromptComponentLinkDto[];
}

export interface PromptComponentDto {
  id: string;
  name: string;
  description: string | null;
  body: string;
  role: PromptRoleName;
  ownerId: string | null;
  updatedAt: string;
}

export interface PromptComponentLinkDto {
  id: string;
  promptId: string;
  componentId: string;
  position: number;
  enabled: boolean;
  component?: PromptComponentDto;
}

export interface CreatePromptInput {
  name: string;
  description?: string | null;
  mode: GenerationMode | string;
  body?: string;
  role?: PromptRoleName;
  position?: number;
  isActive?: boolean;
  /** When set, scope becomes NOVEL and novelId is required. */
  novelId?: string | null;
  scope?: Exclude<PromptScopeName, "SYSTEM_DEFAULT">;
  componentIds?: string[];
}

export interface UpdatePromptInput {
  name?: string;
  description?: string | null;
  body?: string;
  role?: PromptRoleName;
  position?: number;
  isActive?: boolean;
  componentIds?: string[];
}

export interface CreateComponentInput {
  name: string;
  description?: string | null;
  body: string;
  role?: PromptRoleName;
}

export interface UpdateComponentInput {
  name?: string;
  description?: string | null;
  body?: string;
  role?: PromptRoleName;
}

export interface ScenePromptBindingInput {
  mode: GenerationMode | string;
  novelTitle: string;
  chapterTitle: string;
  sceneTitle: string;
  /** Lowercased or display POV label — passed through to {{scene.pov}}. */
  povLabel: string;
  tenseLabel: string;
  sceneContent: string;
  summary: string | null;
  beatText?: string | null;
  /** Already-formatted `<codex_context>` XML from formatAssembledContext. */
  codexPrompt: string;
  /** Optional lighter description-only block for {{codex.description}}. */
  codexDescription?: string;
  maxContentChars?: number;
}

export type { PromptBindings, PromptVariableToken };
