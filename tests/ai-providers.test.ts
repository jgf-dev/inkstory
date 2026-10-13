import { describe, expect, it, vi } from "vite-plus/test";
import {
  ANTHROPIC_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  ANTHROPIC_DEFAULT_VERSION,
  LMSTUDIO_DEFAULT_BASE_URL,
  LOCAL_PROVIDERS,
  OLLAMA_DEFAULT_BASE_URL,
  OPENAI_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_BASE_URL,
  ProviderError,
  SUPPORTED_PROVIDERS,
  createAnthropicProvider,
  createLMStudioProvider,
  createOllamaProvider,
  createOpenAICompatibleProvider,
  createOpenAIProvider,
  createOpenRouterProvider,
  createProvider,
  isLocalProvider,
  isProviderId,
  redactSecret,
  toAnthropicMessages,
} from "../src/lib/ai/providers";
import { errorCodeForStatus } from "../src/lib/ai/providers/openrouter";
import { errorCodeForStatus as openAICompatibleErrorCode } from "../src/lib/ai/providers/openai-compatible";
import type { LlmProvider } from "../src/lib/ai/providers";

const KEY = "sk-or-v1-test-secret-key";
const OPENAI_KEY = "sk-openai-test-secret-key";
const ANTHROPIC_KEY = "sk-ant-test-secret-key";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(response: Response | (() => Promise<Response>)) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    typeof response === "function" ? response() : response,
  );
}

const okCompletion = {
  id: "gen-123",
  model: "anthropic/claude-sonnet-4.6",
  choices: [
    { message: { role: "assistant", content: "The lighthouse blinked." }, finish_reason: "stop" },
  ],
  usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
};

const okOpenAICompletion = {
  id: "chatcmpl-123",
  model: "gpt-4o",
  choices: [
    { message: { role: "assistant", content: "The lighthouse blinked." }, finish_reason: "stop" },
  ],
  usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
};

const okAnthropicCompletion = {
  id: "msg_123",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-20250514",
  content: [{ type: "text", text: "The lighthouse blinked." }],
  stop_reason: "end_turn",
  usage: { input_tokens: 12, output_tokens: 5 },
};

async function catchError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ProviderError);
    return err as ProviderError;
  }
  throw new Error("expected promise to reject");
}

describe("OpenRouter provider: chat", () => {
  it("posts an OpenAI-compatible request and normalizes the result", async () => {
    const fetchMock = mockFetch(jsonResponse(okCompletion));
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: fetchMock as unknown as typeof fetch,
      appUrl: "https://inkstory.app",
      appTitle: "Inkstory",
    });

    const result = await provider.chat({
      model: "anthropic/claude-sonnet-4.6",
      messages: [
        { role: "system", content: "You are a novelist." },
        { role: "user", content: "Continue." },
      ],
      maxOutputTokens: 256,
      temperature: 0.7,
      topP: 0.9,
      stop: ["###"],
    });

    expect(provider.id).toBe("openrouter");
    expect(result).toEqual({
      providerId: "openrouter",
      model: "anthropic/claude-sonnet-4.6",
      text: "The lighthouse blinked.",
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
      id: "gen-123",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${OPENROUTER_DEFAULT_BASE_URL}/chat/completions`);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["HTTP-Referer"]).toBe("https://inkstory.app");
    expect(headers["X-Title"]).toBe("Inkstory");
    expect(JSON.parse(init?.body as string)).toEqual({
      model: "anthropic/claude-sonnet-4.6",
      messages: [
        { role: "system", content: "You are a novelist." },
        { role: "user", content: "Continue." },
      ],
      stream: false,
      max_tokens: 256,
      temperature: 0.7,
      top_p: 0.9,
      stop: ["###"],
    });
  });

  it("omits optional params, trims the base URL, and falls back on missing fields", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ choices: [{ message: { content: "Hi" }, finish_reason: "weird" }] }),
    );
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      baseUrl: "https://proxy.example.com/v1///",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] });

    expect(result).toMatchObject({ model: "m", finishReason: "unknown", usage: null, id: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proxy.example.com/v1/chat/completions");
    const headers = init?.headers as Record<string, string>;
    expect(headers["HTTP-Referer"]).toBeUndefined();
    expect(headers["X-Title"]).toBeUndefined();
    expect(JSON.parse(init?.body as string)).toEqual({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      stream: false,
    });
  });

  it("derives total tokens when the provider omits it", async () => {
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: mockFetch(
        jsonResponse({
          choices: [{ message: { content: "ok" }, finish_reason: "length" }],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
      ) as unknown as typeof fetch,
    });
    const result = await provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] });
    expect(result.finishReason).toBe("length");
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: 7 });
  });

  it.each([
    [{ model: "", messages: [{ role: "user" as const, content: "x" }] }, "model id"],
    [{ model: "m", messages: [] }, "At least one message"],
    [
      { model: "m", messages: [{ role: "user" as const, content: "x" }], maxOutputTokens: 0 },
      "positive integer",
    ],
    [
      { model: "m", messages: [{ role: "user" as const, content: "x" }], maxOutputTokens: 1.5 },
      "positive integer",
    ],
  ])("rejects invalid requests before calling the network (%#)", async (request, message) => {
    const fetchMock = mockFetch(jsonResponse(okCompletion));
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const err = await catchError(provider.chat(request));
    expect(err.code).toBe("INVALID_REQUEST");
    expect(err.message).toContain(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires an API key", () => {
    expect(() => createOpenRouterProvider({ apiKey: "  " })).toThrow(ProviderError);
  });

  it("maps HTTP errors to normalized codes and redacts the key from messages", async () => {
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: mockFetch(
        jsonResponse({ error: { message: `Invalid key ${KEY}`, code: 401 } }, 401),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("AUTH_FAILED");
    expect(err.status).toBe(401);
    expect(err.retryable).toBe(false);
    expect(err.message).not.toContain(KEY);
    expect(err.message).toContain("[REDACTED]");
  });

  it("uses a generic message when the error body is not JSON", async () => {
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: mockFetch(
        new Response("<html>bad gateway</html>", { status: 502 }),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.retryable).toBe(true);
    expect(err.message).toBe("OpenRouter request failed with status 502");
  });

  it("treats a 200 carrying an error object as an upstream failure", async () => {
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: mockFetch(
        jsonResponse({ error: { message: "model overloaded" } }),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.message).toBe("model overloaded");
  });

  it("handles a 200 error object without a message", async () => {
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: mockFetch(jsonResponse({ error: { code: 500 } })) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.message).toBe("Upstream error");
  });

  it("rejects responses with no completion text", async () => {
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: mockFetch(jsonResponse({ choices: [] })) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("INVALID_RESPONSE");
  });

  it("rejects successful non-JSON and empty bodies", async () => {
    const nonJson = createOpenRouterProvider({
      apiKey: KEY,
      fetch: mockFetch(new Response("not json", { status: 200 })) as unknown as typeof fetch,
    });
    expect(
      (await catchError(nonJson.chat({ model: "m", messages: [{ role: "user", content: "x" }] })))
        .code,
    ).toBe("INVALID_RESPONSE");
    const empty = createOpenRouterProvider({
      apiKey: KEY,
      fetch: mockFetch(new Response("", { status: 200 })) as unknown as typeof fetch,
    });
    expect(
      (await catchError(empty.chat({ model: "m", messages: [{ role: "user", content: "x" }] })))
        .code,
    ).toBe("INVALID_RESPONSE");
  });

  it("wraps network failures without leaking the key", async () => {
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: mockFetch(() =>
        Promise.reject(new TypeError(`fetch failed for ${KEY}`)),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.retryable).toBe(true);
    expect(err.message).not.toContain(KEY);
  });

  it("wraps non-Error rejections", async () => {
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: mockFetch(() => Promise.reject("socket hang up")) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.message).toContain("socket hang up");
  });

  it("reports aborted requests as timeouts and forwards the signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException("The operation was aborted", "AbortError");
    });
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({
        model: "m",
        messages: [{ role: "user", content: "x" }],
        signal: controller.signal,
      }),
    );
    expect(err.code).toBe("TIMEOUT");
  });

  it("reports AbortSignal.timeout rejections as timeouts", async () => {
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: mockFetch(() =>
        Promise.reject(new DOMException("The operation timed out", "TimeoutError")),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("TIMEOUT");
  });

  it("normalizes response body read failures without leaking the key", async () => {
    const broken = new Response("{}", { status: 200 });
    vi.spyOn(broken, "text").mockRejectedValue(new TypeError(`stream reset for ${KEY}`));
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: mockFetch(broken) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.status).toBe(200);
    expect(err.message).not.toContain(KEY);
  });
});

describe("OpenRouter provider: listModels", () => {
  it("normalizes the model catalog", async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        data: [
          { id: "openai/gpt-5", name: "GPT-5", context_length: 400000 },
          { id: "meta/llama", context_length: "big" },
          { name: "missing id" },
        ],
      }),
    );
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const models = await provider.listModels();
    expect(models).toEqual([
      { id: "openai/gpt-5", name: "GPT-5", contextLength: 400000 },
      { id: "meta/llama", name: "meta/llama", contextLength: null },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${OPENROUTER_DEFAULT_BASE_URL}/models`);
    expect(init?.method).toBe("GET");
  });

  it("rejects a malformed catalog", async () => {
    const provider = createOpenRouterProvider({
      apiKey: KEY,
      fetch: mockFetch(jsonResponse({ models: [] })) as unknown as typeof fetch,
    });
    expect((await catchError(provider.listModels())).code).toBe("INVALID_RESPONSE");
  });
});

describe("OpenAI provider: chat", () => {
  it("posts a Chat Completions request and normalizes the result", async () => {
    const fetchMock = mockFetch(jsonResponse(okOpenAICompletion));
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await provider.chat({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a novelist." },
        { role: "user", content: "Continue." },
      ],
      maxOutputTokens: 256,
      temperature: 0.7,
      topP: 0.9,
      stop: ["###"],
    });

    expect(provider.id).toBe("openai");
    expect(result).toEqual({
      providerId: "openai",
      model: "gpt-4o",
      text: "The lighthouse blinked.",
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
      id: "chatcmpl-123",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${OPENAI_DEFAULT_BASE_URL}/chat/completions`);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(JSON.parse(init?.body as string)).toEqual({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a novelist." },
        { role: "user", content: "Continue." },
      ],
      stream: false,
      max_tokens: 256,
      temperature: 0.7,
      top_p: 0.9,
      stop: ["###"],
    });
  });

  it("omits optional params, trims the base URL, and falls back on missing fields", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ choices: [{ message: { content: "Hi" }, finish_reason: "weird" }] }),
    );
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      baseUrl: "https://proxy.example.com/v1///",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] });

    expect(result).toMatchObject({ model: "m", finishReason: "unknown", usage: null, id: null });
    expect(fetchMock.mock.calls[0][0]).toBe("https://proxy.example.com/v1/chat/completions");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      stream: false,
    });
  });

  it("derives total tokens when the provider omits it", async () => {
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: mockFetch(
        jsonResponse({
          choices: [{ message: { content: "ok" }, finish_reason: "length" }],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
      ) as unknown as typeof fetch,
    });
    const result = await provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] });
    expect(result.finishReason).toBe("length");
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: 7 });
  });

  it.each([
    [{ model: "", messages: [{ role: "user" as const, content: "x" }] }, "model id"],
    [{ model: "m", messages: [] }, "At least one message"],
    [
      { model: "m", messages: [{ role: "user" as const, content: "x" }], maxOutputTokens: 0 },
      "positive integer",
    ],
  ])("rejects invalid requests before calling the network (%#)", async (request, message) => {
    const fetchMock = mockFetch(jsonResponse(okOpenAICompletion));
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const err = await catchError(provider.chat(request));
    expect(err.code).toBe("INVALID_REQUEST");
    expect(err.message).toContain(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires an API key", () => {
    expect(() => createOpenAIProvider({ apiKey: "  " })).toThrow(ProviderError);
  });

  it("maps HTTP errors and redacts the key", async () => {
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: mockFetch(
        jsonResponse(
          { error: { message: `Invalid key ${OPENAI_KEY}`, type: "invalid_request_error" } },
          401,
        ),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("AUTH_FAILED");
    expect(err.status).toBe(401);
    expect(err.message).not.toContain(OPENAI_KEY);
    expect(err.message).toContain("[REDACTED]");
  });

  it("uses a generic message when the error body is not JSON", async () => {
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: mockFetch(
        new Response("<html>bad gateway</html>", { status: 502 }),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.message).toBe("OpenAI request failed with status 502");
  });

  it("treats a 200 carrying an error object as an upstream failure", async () => {
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: mockFetch(
        jsonResponse({ error: { message: "model overloaded" } }),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.message).toBe("model overloaded");
  });

  it("handles a 200 error object without a message", async () => {
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: mockFetch(
        jsonResponse({ error: { type: "server_error" } }),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.message).toBe("Upstream error");
  });

  it("rejects responses with no completion text", async () => {
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: mockFetch(jsonResponse({ choices: [] })) as unknown as typeof fetch,
    });
    expect(
      (await catchError(provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] })))
        .code,
    ).toBe("INVALID_RESPONSE");
  });

  it("rejects successful non-JSON bodies", async () => {
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: mockFetch(new Response("not json", { status: 200 })) as unknown as typeof fetch,
    });
    expect(
      (await catchError(provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] })))
        .code,
    ).toBe("INVALID_RESPONSE");
  });

  it("wraps network failures without leaking the key", async () => {
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: mockFetch(() =>
        Promise.reject(new TypeError(`fetch failed for ${OPENAI_KEY}`)),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.message).not.toContain(OPENAI_KEY);
  });

  it("reports aborted requests as timeouts", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException("The operation was aborted", "AbortError");
    });
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({
        model: "m",
        messages: [{ role: "user", content: "x" }],
        signal: controller.signal,
      }),
    );
    expect(err.code).toBe("TIMEOUT");
  });

  it("normalizes response body read failures", async () => {
    const broken = new Response("{}", { status: 200 });
    vi.spyOn(broken, "text").mockRejectedValue(new TypeError(`stream reset for ${OPENAI_KEY}`));
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: mockFetch(broken) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.message).not.toContain(OPENAI_KEY);
  });
});

describe("OpenAI provider: listModels", () => {
  it("normalizes the model catalog", async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        data: [{ id: "gpt-4o", owned_by: "openai" }, { id: "gpt-4o-mini" }, { owned_by: "system" }],
      }),
    );
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const models = await provider.listModels();
    expect(models).toEqual([
      { id: "gpt-4o", name: "gpt-4o", contextLength: null },
      { id: "gpt-4o-mini", name: "gpt-4o-mini", contextLength: null },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${OPENAI_DEFAULT_BASE_URL}/models`);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });

  it("rejects a malformed catalog", async () => {
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: mockFetch(jsonResponse({ models: [] })) as unknown as typeof fetch,
    });
    expect((await catchError(provider.listModels())).code).toBe("INVALID_RESPONSE");
  });
});

describe("Anthropic message mapping", () => {
  it("lifts system messages and merges consecutive same-role turns", () => {
    expect(
      toAnthropicMessages([
        { role: "system", content: "Be concise." },
        { role: "system", content: "Stay in voice." },
        { role: "user", content: "Hi" },
        { role: "user", content: "Again" },
        { role: "assistant", content: "Hello" },
      ]),
    ).toEqual({
      system: "Be concise.\n\nStay in voice.",
      messages: [
        { role: "user", content: "Hi\n\nAgain" },
        { role: "assistant", content: "Hello" },
      ],
    });
  });

  it("rejects system-only conversations", () => {
    expect(() => toAnthropicMessages([{ role: "system", content: "only" }])).toThrow(
      /at least one user or assistant/,
    );
  });

  it("prepends a user turn when the conversation starts with the assistant", () => {
    expect(
      toAnthropicMessages([
        { role: "assistant", content: "Earlier reply" },
        { role: "user", content: "Continue" },
      ]),
    ).toEqual({
      system: undefined,
      messages: [
        { role: "user", content: "(continued)" },
        { role: "assistant", content: "Earlier reply" },
        { role: "user", content: "Continue" },
      ],
    });
  });
});

describe("Anthropic provider: chat", () => {
  it("posts a Messages API request and normalizes the result", async () => {
    const fetchMock = mockFetch(jsonResponse(okAnthropicCompletion));
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await provider.chat({
      model: "claude-sonnet-4-20250514",
      messages: [
        { role: "system", content: "You are a novelist." },
        { role: "user", content: "Continue." },
      ],
      maxOutputTokens: 256,
      temperature: 0.7,
      topP: 0.9,
      stop: ["###"],
    });

    expect(provider.id).toBe("anthropic");
    expect(result).toEqual({
      providerId: "anthropic",
      model: "claude-sonnet-4-20250514",
      text: "The lighthouse blinked.",
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
      id: "msg_123",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${ANTHROPIC_DEFAULT_BASE_URL}/messages`);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(ANTHROPIC_KEY);
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_DEFAULT_VERSION);
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(init?.body as string)).toEqual({
      model: "claude-sonnet-4-20250514",
      system: "You are a novelist.",
      messages: [{ role: "user", content: "Continue." }],
      max_tokens: 256,
      stream: false,
      temperature: 0.7,
      top_p: 0.9,
      stop_sequences: ["###"],
    });
  });

  it("defaults max_tokens, joins multiple text blocks, and maps stop reasons", async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        content: [
          { type: "text", text: "Part A" },
          { type: "tool_use", id: "t1" },
          { type: "text", text: "Part B" },
        ],
        stop_reason: "max_tokens",
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    );
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      baseUrl: "https://proxy.example.com/v1///",
      apiVersion: "2024-01-01",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] });

    expect(result).toEqual({
      providerId: "anthropic",
      model: "m",
      text: "Part APart B",
      finishReason: "length",
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      id: null,
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://proxy.example.com/v1/messages");
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["anthropic-version"]).toBe("2024-01-01");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
      stream: false,
    });
  });

  it.each([
    ["end_turn", "stop"],
    ["stop_sequence", "stop"],
    ["tool_use", "tool_calls"],
    ["refusal", "content_filter"],
    ["weird", "unknown"],
  ] as const)("maps stop_reason %s to %s", async (stopReason, finishReason) => {
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: mockFetch(
        jsonResponse({
          content: [{ type: "text", text: "ok" }],
          stop_reason: stopReason,
        }),
      ) as unknown as typeof fetch,
    });
    const result = await provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] });
    expect(result.finishReason).toBe(finishReason);
  });

  it.each([
    [{ model: "", messages: [{ role: "user" as const, content: "x" }] }, "model id"],
    [{ model: "m", messages: [] }, "At least one message"],
    [
      { model: "m", messages: [{ role: "user" as const, content: "x" }], maxOutputTokens: 0 },
      "positive integer",
    ],
    [{ model: "m", messages: [{ role: "system" as const, content: "only" }] }, "user or assistant"],
  ])("rejects invalid requests before calling the network (%#)", async (request, message) => {
    const fetchMock = mockFetch(jsonResponse(okAnthropicCompletion));
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const err = await catchError(provider.chat(request));
    expect(err.code).toBe("INVALID_REQUEST");
    expect(err.message).toContain(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires an API key", () => {
    expect(() => createAnthropicProvider({ apiKey: "  " })).toThrow(ProviderError);
  });

  it("maps HTTP errors and redacts the key", async () => {
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: mockFetch(
        jsonResponse(
          {
            type: "error",
            error: { type: "authentication_error", message: `bad ${ANTHROPIC_KEY}` },
          },
          401,
        ),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("AUTH_FAILED");
    expect(err.status).toBe(401);
    expect(err.message).not.toContain(ANTHROPIC_KEY);
    expect(err.message).toContain("[REDACTED]");
  });

  it("uses a generic message when the error body is not JSON", async () => {
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: mockFetch(
        new Response("<html>bad gateway</html>", { status: 502 }),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.message).toBe("Anthropic request failed with status 502");
  });

  it("treats a 200 carrying an error object as an upstream failure", async () => {
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: mockFetch(
        jsonResponse({ type: "error", error: { message: "overloaded" } }),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.message).toBe("overloaded");
  });

  it("handles a 200 error object without a message", async () => {
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: mockFetch(jsonResponse({ type: "error", error: {} })) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.message).toBe("Upstream error");
  });

  it("rejects responses with no text content", async () => {
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: mockFetch(
        jsonResponse({ content: [{ type: "tool_use", id: "t1" }] }),
      ) as unknown as typeof fetch,
    });
    expect(
      (await catchError(provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] })))
        .code,
    ).toBe("INVALID_RESPONSE");
  });

  it("rejects successful non-JSON bodies", async () => {
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: mockFetch(new Response("not json", { status: 200 })) as unknown as typeof fetch,
    });
    expect(
      (await catchError(provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] })))
        .code,
    ).toBe("INVALID_RESPONSE");
  });

  it("wraps network failures without leaking the key", async () => {
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: mockFetch(() =>
        Promise.reject(new TypeError(`fetch failed for ${ANTHROPIC_KEY}`)),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.message).not.toContain(ANTHROPIC_KEY);
  });

  it("wraps non-Error rejections", async () => {
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: mockFetch(() => Promise.reject("socket hang up")) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.message).toContain("socket hang up");
  });

  it("reports aborted requests as timeouts", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException("The operation was aborted", "AbortError");
    });
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({
        model: "m",
        messages: [{ role: "user", content: "x" }],
        signal: controller.signal,
      }),
    );
    expect(err.code).toBe("TIMEOUT");
  });

  it("reports TimeoutError as timeouts", async () => {
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: mockFetch(() =>
        Promise.reject(new DOMException("The operation timed out", "TimeoutError")),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(
      provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(err.code).toBe("TIMEOUT");
  });
});

describe("Anthropic provider: listModels", () => {
  it("normalizes the model catalog", async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        data: [
          { id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4" },
          { id: "claude-haiku" },
          { display_name: "missing id" },
        ],
      }),
    );
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const models = await provider.listModels();
    expect(models).toEqual([
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", contextLength: null },
      { id: "claude-haiku", name: "claude-haiku", contextLength: null },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${ANTHROPIC_DEFAULT_BASE_URL}/models`);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });

  it("rejects a malformed catalog", async () => {
    const provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: mockFetch(jsonResponse({ models: [] })) as unknown as typeof fetch,
    });
    expect((await catchError(provider.listModels())).code).toBe("INVALID_RESPONSE");
  });
});

const LOCAL_KEY = "lm-local-test-secret-token";

const LOCAL_ADAPTERS = [
  {
    id: "ollama" as const,
    label: "Ollama",
    defaultBaseUrl: OLLAMA_DEFAULT_BASE_URL,
    expectedDefault: "http://127.0.0.1:11434/v1",
    create: (opts?: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch }) =>
      createOllamaProvider(opts),
    model: "llama3.2:3b",
  },
  {
    id: "lmstudio" as const,
    label: "LM Studio",
    defaultBaseUrl: LMSTUDIO_DEFAULT_BASE_URL,
    expectedDefault: "http://127.0.0.1:1234/v1",
    create: (opts?: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch }) =>
      createLMStudioProvider(opts),
    model: "qwen2.5-7b-instruct",
  },
];

const userTurn = [{ role: "user" as const, content: "x" }];

describe.each(LOCAL_ADAPTERS)("$label provider: chat", (adapter) => {
  function make(fetchImpl: unknown, extra: { apiKey?: string; baseUrl?: string } = {}) {
    return adapter.create({ ...extra, fetch: fetchImpl as typeof fetch });
  }

  it("uses the documented local default base URL", () => {
    expect(adapter.defaultBaseUrl).toBe(adapter.expectedDefault);
  });

  it("calls a local model without any API key and normalizes the result", async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        id: "chatcmpl-local",
        model: adapter.model,
        choices: [
          { message: { role: "assistant", content: "Fog rolled in." }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
      }),
    );
    const provider = make(fetchMock);

    const result = await provider.chat({
      model: adapter.model,
      messages: [
        { role: "system", content: "You are a novelist." },
        { role: "user", content: "Continue." },
      ],
      maxOutputTokens: 128,
      temperature: 0.5,
      topP: 0.8,
      stop: ["###"],
    });

    expect(provider.id).toBe(adapter.id);
    expect(result).toEqual({
      providerId: adapter.id,
      model: adapter.model,
      text: "Fog rolled in.",
      finishReason: "stop",
      usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 },
      id: "chatcmpl-local",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${adapter.expectedDefault}/chat/completions`);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({
      model: adapter.model,
      messages: [
        { role: "system", content: "You are a novelist." },
        { role: "user", content: "Continue." },
      ],
      stream: false,
      max_tokens: 128,
      temperature: 0.5,
      top_p: 0.8,
      stop: ["###"],
    });
  });

  it("sends an optional key as a bearer token and honors a custom base URL", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ choices: [{ message: { content: "Hi" }, finish_reason: "length" }] }),
    );
    const provider = make(fetchMock, {
      apiKey: `  ${LOCAL_KEY}  `,
      baseUrl: " http://gpu-box.lan:9000/v1/// ",
    });
    const result = await provider.chat({ model: "m", messages: userTurn });

    expect(result).toMatchObject({
      providerId: adapter.id,
      model: "m",
      finishReason: "length",
      usage: null,
      id: null,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://gpu-box.lan:9000/v1/chat/completions");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${LOCAL_KEY}`);
    expect(JSON.parse(init?.body as string)).toEqual({
      model: "m",
      messages: userTurn,
      stream: false,
    });
  });

  it("treats blank keys and base URLs as unset", async () => {
    const fetchMock = mockFetch(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    const provider = make(fetchMock, { apiKey: "   ", baseUrl: "  " });
    await provider.chat({ model: "m", messages: userTurn });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${adapter.expectedDefault}/chat/completions`);
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("can be constructed with no options at all", () => {
    expect(adapter.create().id).toBe(adapter.id);
  });

  it("derives total tokens when the server omits it", async () => {
    const provider = make(
      mockFetch(
        jsonResponse({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        }),
      ),
    );
    const result = await provider.chat({ model: "m", messages: userTurn });
    expect(result.usage).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 });
  });

  it.each([
    [{ model: " ", messages: userTurn }, "model id"],
    [{ model: "m", messages: [] }, "At least one message"],
    [{ model: "m", messages: userTurn, maxOutputTokens: 1.5 }, "positive integer"],
  ])("rejects invalid requests before calling the server (%#)", async (request, message) => {
    const fetchMock = mockFetch(jsonResponse({}));
    const err = await catchError(make(fetchMock).chat(request));
    expect(err.code).toBe("INVALID_REQUEST");
    expect(err.providerId).toBe(adapter.id);
    expect(err.message).toContain(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a missing model as MODEL_UNAVAILABLE with the server's message", async () => {
    const provider = make(
      mockFetch(
        jsonResponse(
          { error: { message: 'model "nope" not found, try pulling it first', type: "api_error" } },
          404,
        ),
      ),
    );
    const err = await catchError(provider.chat({ model: "nope", messages: userTurn }));
    expect(err.code).toBe("MODEL_UNAVAILABLE");
    expect(err.status).toBe(404);
    expect(err.providerId).toBe(adapter.id);
    expect(err.message).toContain("not found");
  });

  it("accepts bare-string error bodies", async () => {
    const provider = make(
      mockFetch(jsonResponse({ error: "Unexpected endpoint or method." }, 400)),
    );
    const err = await catchError(provider.chat({ model: "m", messages: userTurn }));
    expect(err.code).toBe("INVALID_REQUEST");
    expect(err.message).toBe("Unexpected endpoint or method.");
  });

  it("maps auth failures and redacts a configured key", async () => {
    const provider = make(
      mockFetch(jsonResponse({ error: { message: `Bad token ${LOCAL_KEY}` } }, 401)),
      { apiKey: LOCAL_KEY },
    );
    const err = await catchError(provider.chat({ model: "m", messages: userTurn }));
    expect(err.code).toBe("AUTH_FAILED");
    expect(err.message).not.toContain(LOCAL_KEY);
    expect(err.message).toContain("[REDACTED]");
  });

  it("uses a generic message for non-JSON or empty error bodies", async () => {
    const htmlErr = await catchError(
      make(mockFetch(new Response("<html>oops</html>", { status: 500 }))).chat({
        model: "m",
        messages: userTurn,
      }),
    );
    expect(htmlErr.code).toBe("UPSTREAM_ERROR");
    expect(htmlErr.message).toBe(`${adapter.label} request failed with status 500`);

    const emptyErr = await catchError(
      make(mockFetch(jsonResponse({ error: "" }, 503))).chat({ model: "m", messages: userTurn }),
    );
    expect(emptyErr.message).toBe(`${adapter.label} request failed with status 503`);
  });

  it("treats a 200 carrying an error as an upstream failure", async () => {
    const withMessage = await catchError(
      make(mockFetch(jsonResponse({ error: "model is loading" }))).chat({
        model: "m",
        messages: userTurn,
      }),
    );
    expect(withMessage).toMatchObject({ code: "UPSTREAM_ERROR", message: "model is loading" });

    const withoutMessage = await catchError(
      make(mockFetch(jsonResponse({ error: { type: "server_error" } }))).chat({
        model: "m",
        messages: userTurn,
      }),
    );
    expect(withoutMessage.message).toBe("Upstream error");
  });

  it("rejects responses with no completion text or a non-JSON body", async () => {
    const noText = await catchError(
      make(mockFetch(jsonResponse({ choices: [] }))).chat({ model: "m", messages: userTurn }),
    );
    expect(noText.code).toBe("INVALID_RESPONSE");
    expect(noText.message).toBe(`${adapter.label} response did not include a completion`);

    const notJson = await catchError(
      make(mockFetch(new Response("not json", { status: 200 }))).chat({
        model: "m",
        messages: userTurn,
      }),
    );
    expect(notJson.code).toBe("INVALID_RESPONSE");

    const empty = await catchError(
      make(mockFetch(new Response("", { status: 200 }))).chat({ model: "m", messages: userTurn }),
    );
    expect(empty.code).toBe("INVALID_RESPONSE");
  });

  it("explains unreachable local servers with the base URL, without leaking the key", async () => {
    const provider = make(
      mockFetch(() => Promise.reject(new TypeError(`connect ECONNREFUSED ${LOCAL_KEY}`))),
      { apiKey: LOCAL_KEY },
    );
    const err = await catchError(provider.chat({ model: "m", messages: userTurn }));
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.retryable).toBe(true);
    expect(err.message).toContain(`Could not reach ${adapter.label} at ${adapter.expectedDefault}`);
    expect(err.message).not.toContain(LOCAL_KEY);
  });

  it("wraps non-Error rejections", async () => {
    const err = await catchError(
      make(mockFetch(() => Promise.reject("socket hang up"))).chat({
        model: "m",
        messages: userTurn,
      }),
    );
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.message).toContain("socket hang up");
  });

  it("reports aborted requests as timeouts and forwards the signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException("The operation timed out", "TimeoutError");
    });
    const err = await catchError(
      make(fetchMock).chat({ model: "m", messages: userTurn, signal: controller.signal }),
    );
    expect(err.code).toBe("TIMEOUT");
    expect(err.message).toBe(`${adapter.label} request was aborted`);
  });

  it("normalizes response body read failures", async () => {
    const broken = new Response("{}", { status: 200 });
    vi.spyOn(broken, "text").mockRejectedValue(new TypeError(`stream reset ${LOCAL_KEY}`));
    const err = await catchError(
      make(mockFetch(broken), { apiKey: LOCAL_KEY }).chat({ model: "m", messages: userTurn }),
    );
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.status).toBe(200);
    expect(err.message).not.toContain(LOCAL_KEY);
  });
});

describe.each(LOCAL_ADAPTERS)("$label provider: listModels", (adapter) => {
  it("lists locally installed models", async () => {
    const controller = new AbortController();
    const fetchMock = mockFetch(
      jsonResponse({
        object: "list",
        data: [
          { id: adapter.model, object: "model", owned_by: "library" },
          { id: "nomic-embed-text", object: "model" },
          { object: "model" },
          null,
        ],
      }),
    );
    const provider = adapter.create({ fetch: fetchMock as unknown as typeof fetch });
    const models = await provider.listModels({ signal: controller.signal });
    expect(models).toEqual([
      { id: adapter.model, name: adapter.model, contextLength: null },
      { id: "nomic-embed-text", name: "nomic-embed-text", contextLength: null },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${adapter.expectedDefault}/models`);
    expect(init?.method).toBe("GET");
    expect(init?.signal).toBe(controller.signal);
  });

  it("rejects a malformed catalog", async () => {
    const provider = adapter.create({
      fetch: mockFetch(jsonResponse({ models: [] })) as unknown as typeof fetch,
    });
    const err = await catchError(provider.listModels());
    expect(err.code).toBe("INVALID_RESPONSE");
    expect(err.message).toBe(`${adapter.label} model list was malformed`);
  });

  it("surfaces an unreachable server", async () => {
    const provider = adapter.create({
      fetch: mockFetch(() =>
        Promise.reject(new TypeError("fetch failed")),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(provider.listModels());
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.providerId).toBe(adapter.id);
  });
});

describe("OpenAI-compatible core", () => {
  it("omits the base URL from network errors unless asked", async () => {
    const provider: LlmProvider = createOpenAICompatibleProvider({
      providerId: "openai",
      label: "OpenAI",
      apiKey: OPENAI_KEY,
      baseUrl: "https://internal.example.com/v1",
      fetch: mockFetch(() =>
        Promise.reject(new TypeError("fetch failed")),
      ) as unknown as typeof fetch,
    });
    const err = await catchError(provider.chat({ model: "m", messages: userTurn }));
    expect(err.message).toBe("Could not reach OpenAI: fetch failed");
  });

  it("shares the HTTP status mapping", () => {
    expect(openAICompatibleErrorCode(404)).toBe("MODEL_UNAVAILABLE");
    expect(openAICompatibleErrorCode(429)).toBe("RATE_LIMITED");
  });
});

describe("provider registry and helpers", () => {
  it("creates providers from config", () => {
    expect(createProvider({ provider: "openrouter", apiKey: KEY }).id).toBe("openrouter");
    expect(createProvider({ provider: "openai", apiKey: OPENAI_KEY }).id).toBe("openai");
    expect(createProvider({ provider: "anthropic", apiKey: ANTHROPIC_KEY }).id).toBe("anthropic");
    expect(createProvider({ provider: "ollama" }).id).toBe("ollama");
    expect(createProvider({ provider: "lmstudio", apiKey: LOCAL_KEY }).id).toBe("lmstudio");
  });

  it("selects and calls a local model end-to-end through the registry", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ choices: [{ message: { content: "Local hello" }, finish_reason: "stop" }] }),
    );
    const provider = createProvider({
      provider: "ollama",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await provider.chat({ model: "llama3.2:3b", messages: userTurn });
    expect(result).toMatchObject({
      providerId: "ollama",
      model: "llama3.2:3b",
      text: "Local hello",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`${OLLAMA_DEFAULT_BASE_URL}/chat/completions`);
  });

  it("flags local providers", () => {
    expect(LOCAL_PROVIDERS).toEqual(["ollama", "lmstudio"]);
    expect(isLocalProvider("ollama")).toBe(true);
    expect(isLocalProvider("lmstudio")).toBe(true);
    expect(isLocalProvider("openai")).toBe(false);
  });

  it("rejects unknown providers", () => {
    expect(() => createProvider({ provider: "nope", apiKey: KEY } as never)).toThrow(
      /Unsupported provider/,
    );
  });

  it("recognizes supported provider ids", () => {
    expect(SUPPORTED_PROVIDERS).toEqual([
      "openrouter",
      "openai",
      "anthropic",
      "ollama",
      "lmstudio",
    ]);
    expect(isProviderId("openrouter")).toBe(true);
    expect(isProviderId("openai")).toBe(true);
    expect(isProviderId("anthropic")).toBe(true);
    expect(isProviderId("ollama")).toBe(true);
    expect(isProviderId("lmstudio")).toBe(true);
    expect(isProviderId("local")).toBe(false);
    expect(isProviderId(42)).toBe(false);
  });

  it.each([
    [400, "INVALID_REQUEST"],
    [422, "INVALID_REQUEST"],
    [401, "AUTH_FAILED"],
    [403, "AUTH_FAILED"],
    [402, "INSUFFICIENT_CREDITS"],
    [404, "MODEL_UNAVAILABLE"],
    [408, "TIMEOUT"],
    [429, "RATE_LIMITED"],
    [500, "UPSTREAM_ERROR"],
    [503, "UPSTREAM_ERROR"],
  ])("maps HTTP %i to %s", (status, code) => {
    expect(errorCodeForStatus(status)).toBe(code);
  });

  it("redacts every occurrence of a secret and ignores empty secrets", () => {
    expect(redactSecret("a KEY b KEY", "KEY")).toBe("a [REDACTED] b [REDACTED]");
    expect(redactSecret("unchanged", "")).toBe("unchanged");
  });

  it("marks only transient failures as retryable", () => {
    expect(new ProviderError("x", "RATE_LIMITED", "openrouter").retryable).toBe(true);
    expect(new ProviderError("x", "TIMEOUT", "openai").retryable).toBe(true);
    expect(new ProviderError("x", "INSUFFICIENT_CREDITS", "anthropic").retryable).toBe(false);
    expect(new ProviderError("x", "INVALID_RESPONSE", "openrouter").status).toBeNull();
  });
});
