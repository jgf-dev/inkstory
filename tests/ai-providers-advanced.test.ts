import { describe, expect, it, vi } from "vite-plus/test";
import {
  ProviderError,
  createAnthropicProvider,
  createLMStudioProvider,
  createOllamaProvider,
  createOpenAIProvider,
  createOpenRouterProvider,
  isCustomOpenRouterBaseUrl,
  OPENROUTER_DEFAULT_BASE_URL,
} from "../src/lib/ai/providers";

function completion() {
  return vi
    .fn()
    .mockImplementation(async () =>
      Response.json({ model: "m", choices: [{ message: { content: "ok" } }] }),
    );
}

const base = {
  model: "meta-llama/llama-3.3-70b-instruct",
  messages: [{ role: "user" as const, content: "hi" }],
};

function sent(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

describe("OpenRouter Min-P mapping (STO-1265)", () => {
  it("sends min_p with provider.require_parameters:true", async () => {
    const fetchMock = completion();
    const p = createOpenRouterProvider({ apiKey: "k", fetch: fetchMock });
    await p.chat({ ...base, minP: 0.05 });
    const body = sent(fetchMock);
    expect(body.min_p).toBe(0.05);
    expect(body.provider).toEqual({ require_parameters: true });
  });

  it("sends explicit zero, but omits everything when untouched", async () => {
    const zero = completion();
    await createOpenRouterProvider({ apiKey: "k", fetch: zero }).chat({ ...base, minP: 0 });
    expect(sent(zero)).toMatchObject({ min_p: 0, provider: { require_parameters: true } });

    const omitted = completion();
    await createOpenRouterProvider({ apiKey: "k", fetch: omitted }).chat(base);
    expect(sent(omitted)).not.toHaveProperty("min_p");
    expect(sent(omitted)).not.toHaveProperty("provider");
  });

  it("pins a verified endpoint without fallbacks", async () => {
    const fetchMock = completion();
    await createOpenRouterProvider({ apiKey: "k", fetch: fetchMock }).chat({
      ...base,
      minP: 0.1,
      endpoint: " deepinfra/turbo ",
    });
    expect(sent(fetchMock).provider).toEqual({
      require_parameters: true,
      only: ["deepinfra/turbo"],
      allow_fallbacks: false,
    });
    const pinOnly = completion();
    await createOpenRouterProvider({ apiKey: "k", fetch: pinOnly }).chat({
      ...base,
      endpoint: "groq",
    });
    expect(sent(pinOnly).provider).toEqual({ only: ["groq"], allow_fallbacks: false });
  });

  it.each([-1, 2, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects minP=%s before fetching",
    async (minP) => {
      const fetchMock = completion();
      await expect(
        createOpenRouterProvider({ apiKey: "k", fetch: fetchMock }).chat({ ...base, minP }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects blank endpoints", async () => {
    const fetchMock = completion();
    await expect(
      createOpenRouterProvider({ apiKey: "k", fetch: fetchMock }).chat({ ...base, endpoint: " " }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flags custom base URLs without exposing them", () => {
    expect(isCustomOpenRouterBaseUrl(undefined)).toBe(false);
    expect(isCustomOpenRouterBaseUrl(null)).toBe(false);
    expect(isCustomOpenRouterBaseUrl("")).toBe(false);
    expect(isCustomOpenRouterBaseUrl(`${OPENROUTER_DEFAULT_BASE_URL}/`)).toBe(false);
    expect(isCustomOpenRouterBaseUrl("https://proxy.example.com/v1")).toBe(true);
    expect(createOpenRouterProvider({ apiKey: "k" }).customBaseUrl).toBe(false);
    expect(
      createOpenRouterProvider({ apiKey: "k", baseUrl: "https://proxy.example.com/v1" })
        .customBaseUrl,
    ).toBe(true);
  });
});

describe("adapters without a Min-P mapping never send it", () => {
  const adapters = {
    openai: (f: typeof fetch) => createOpenAIProvider({ apiKey: "k", fetch: f }),
    ollama: (f: typeof fetch) => createOllamaProvider({ fetch: f }),
    lmstudio: (f: typeof fetch) => createLMStudioProvider({ fetch: f }),
    anthropic: (f: typeof fetch) => createAnthropicProvider({ apiKey: "k", fetch: f }),
  };

  it.each(Object.keys(adapters) as Array<keyof typeof adapters>)(
    "%s rejects minP and endpoint instead of forwarding or dropping",
    async (name) => {
      const fetchMock = completion();
      const p = adapters[name](fetchMock);
      await expect(p.chat({ ...base, minP: 0.1 })).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        message: expect.stringMatching(/Min-P is not available/),
      });
      await expect(p.chat({ ...base, minP: 0 })).rejects.toBeInstanceOf(ProviderError);
      await expect(p.chat({ ...base, endpoint: "groq" })).rejects.toMatchObject({
        message: expect.stringMatching(/Endpoint routing is not available/),
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["ollama", "lmstudio", "openai"] as const)(
    "%s stays on /v1/chat/completions without min_p",
    async (name) => {
      const fetchMock = completion();
      await adapters[name](fetchMock).chat(base);
      expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/chat\/completions$/);
      expect(sent(fetchMock)).not.toHaveProperty("min_p");
      expect(sent(fetchMock)).not.toHaveProperty("provider");
    },
  );
});
