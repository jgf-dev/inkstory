/**
 * Scene AI generation (launch phase 3). Calls the Vercel AI Gateway
 * (OpenAI-compatible `/v1/chat/completions`) with the assembled Codex context
 * embedded in the system message.
 *
 * Cost safety: the gateway client is lazily built from `AI_GATEWAY_API_KEY`.
 * With no key configured (dev/CI), generation answers 503 `AI_NOT_CONFIGURED`
 * and the route still returns the fully assembled prompt so the author can
 * copy it into any LLM — no spend can occur without explicit configuration.
 */

export const DEFAULT_AI_MODEL = "anthropic/claude-sonnet-4.6";
export const DEFAULT_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

/** Default completion cap for a single generation request. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

export type GenerationMode = "continuation" | "beat_expansion";

export const GENERATION_MODES: readonly GenerationMode[] = ["continuation", "beat_expansion"];

export function isGenerationMode(value: unknown): value is GenerationMode {
  return typeof value === "string" && (GENERATION_MODES as readonly string[]).includes(value);
}

export class AiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "AI_NOT_CONFIGURED"
      | "AI_GATEWAY_ERROR"
      | "AI_INVALID_RESPONSE"
      | "SCENE_EXCLUDED_FROM_AI",
    public readonly status: number = 500,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** Standard AI error handler mirroring `handleCodexApiError`. */
export function handleAiApiError(err: unknown): Response {
  if (err instanceof SyntaxError) {
    return Response.json(
      { error: "Malformed or invalid JSON body", code: "INVALID_JSON" },
      { status: 400 },
    );
  }
  if (err instanceof AiError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY);
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface BuildScenePromptInput {
  mode: GenerationMode;
  novelTitle: string;
  chapterTitle: string;
  sceneTitle: string;
  povLabel: string;
  tenseLabel: string;
  sceneContent: string;
  summary: string | null;
  beatText?: string | null;
  /** Formatted `<codex_context>` XML block from the context assembler. */
  codexPrompt: string;
  maxContentChars?: number;
}

/** How much of the scene prose is replayed to the model (cost guard). */
const DEFAULT_MAX_CONTENT_CHARS = 8000;

/**
 * Builds the chat messages for a scene generation request. Pure so prompt
 * construction is unit-testable without any network access.
 */
export function buildSceneMessages(input: BuildScenePromptInput): ChatMessage[] {
  const maxChars = input.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
  const prose =
    input.sceneContent.length > maxChars
      ? `[…earlier text omitted…]\n${input.sceneContent.slice(-maxChars)}`
      : input.sceneContent;

  const system = [
    "You are a skilled fiction co-writer embedded in InkStory, a novel-writing workspace.",
    `Story: ${input.novelTitle} — ${input.chapterTitle} / ${input.sceneTitle}.`,
    `Write in ${input.povLabel.toLowerCase()} and ${input.tenseLabel.toLowerCase()} tense.`,
    "Continue the author's voice: match tone, diction, and pacing already present in the scene.",
    "Story bible entries that apply to this scene are provided below. Respect their facts and current state; never contradict them.",
    "Return prose only — no headings, no commentary, no markdown fences.",
    "",
    "<story_bible>",
    input.codexPrompt,
    "</story_bible>",
  ].join("\n");

  const beatLine = input.beatText?.trim()
    ? `Beat to realize:\n"""\n${input.beatText.trim()}\n"""\n`
    : "";

  const user =
    input.mode === "continuation"
      ? [
          "Continue this scene from exactly where it leaves off, writing roughly 150–400 words of prose that flow naturally from the final line.",
          "",
          beatLine,
          "Scene so far:",
          '"""',
          prose,
          '"""',
        ]
          .filter(Boolean)
          .join("\n")
      : [
          "Expand the beat below into full scene prose (roughly 150–400 words). Ground it in the scene context already established.",
          "",
          beatLine,
          input.summary ? `Scene summary:\n"""\n${input.summary}\n"""\n` : "",
          prose ? `Existing scene prose:\n"""\n${prose}\n"""` : "",
        ]
          .filter(Boolean)
          .join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export interface GenerateTextOptions {
  messages: ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
}

interface GatewayChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

/**
 * Calls the AI Gateway chat-completions endpoint and returns the completion
 * text. Throws `AiError` (503) when no key is configured.
 */
export async function generateText(
  options: GenerateTextOptions,
): Promise<{ text: string; model: string }> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new AiError(
      "AI generation is not configured on this deployment (missing AI_GATEWAY_API_KEY)",
      "AI_NOT_CONFIGURED",
      503,
    );
  }

  const baseUrl = (process.env.AI_GATEWAY_BASE_URL || DEFAULT_AI_GATEWAY_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const model = process.env.AI_MODEL || DEFAULT_AI_MODEL;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        temperature: 0.7,
        stream: false,
      }),
      signal: options.signal,
    });
  } catch (err) {
    throw new AiError(
      `AI gateway request failed: ${err instanceof Error ? err.message : "network error"}`,
      "AI_GATEWAY_ERROR",
      502,
    );
  }

  if (!response.ok) {
    let detail = `status ${response.status}`;
    try {
      const body = (await response.json()) as GatewayChatResponse;
      if (body?.error?.message) {
        detail = body.error.message;
      }
    } catch {
      // Non-JSON error body; keep the status-based detail.
    }
    throw new AiError(`AI gateway request failed (${detail})`, "AI_GATEWAY_ERROR", 502);
  }

  let payload: GatewayChatResponse;
  try {
    payload = (await response.json()) as GatewayChatResponse;
  } catch {
    throw new AiError("AI gateway returned an unparseable response", "AI_INVALID_RESPONSE", 502);
  }

  const text = payload.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new AiError("AI gateway returned an empty completion", "AI_INVALID_RESPONSE", 502);
  }

  return { text, model };
}
