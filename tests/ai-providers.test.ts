import { describe, expect, it, vi } from "vite-plus/test";
import {
  ANTHROPIC_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  ANTHROPIC_DEFAULT_VERSION,
  OPENAI_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_BASE_URL,
  ProviderError,
  SUPPORTED_PROVIDERS,
  createAnthropicProvider,
  createOpenAIProvider,
  createOpenRouterProvider,
  createProvider,
  isProviderId,
  redactSecret,
  toAnthropicMessages,
} from "../src/lib/ai/providers";
import { errorCodeForStatus } from "../src/lib/ai/providers/openrouter";

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

describe("provider registry and helpers", () => {
  it("creates providers from config", () => {
    expect(createProvider({ provider: "openrouter", apiKey: KEY }).id).toBe("openrouter");
    expect(createProvider({ provider: "openai", apiKey: OPENAI_KEY }).id).toBe("openai");
    expect(createProvider({ provider: "anthropic", apiKey: ANTHROPIC_KEY }).id).toBe("anthropic");
  });

  it("rejects unknown providers", () => {
    expect(() => createProvider({ provider: "nope", apiKey: KEY } as never)).toThrow(
      /Unsupported provider/,
    );
  });

  it("recognizes supported provider ids", () => {
    expect(SUPPORTED_PROVIDERS).toEqual(["openrouter", "openai", "anthropic"]);
    expect(isProviderId("openrouter")).toBe(true);
    expect(isProviderId("openai")).toBe(true);
    expect(isProviderId("anthropic")).toBe(true);
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
