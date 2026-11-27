import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST } from "../src/app/api/tools/trope-premise/route";
import { readLimitedJson, toolErrorResponse } from "../src/lib/tools/shared/json-request";
import {
  DEFAULT_FREE_MODEL,
  OPENROUTER_CHAT_URL,
  parseStringFieldContent,
  requestOpenRouterJson,
} from "../src/lib/tools/shared/openrouter";
import { TOOL_AI_IP_WINDOWS, createRateLimiter } from "../src/lib/tools/shared/rate-limit";
import { MAX_COUNT, findTrope } from "../src/lib/tools/story-tropes";
import {
  PREMISE_BODY_MAX_LENGTH,
  PREMISE_MAX_TOKENS,
  buildPremiseMessages,
  clientIpFrom,
  comboTropes,
  createToolAiLimiters,
  getTropePremise,
  parsePremiseContent,
  parsePremiseInput,
  requestAiPremise,
  violatesCopyRules,
  type PremiseDeps,
  type PremiseInput,
} from "../src/lib/tools/trope-premise";

const SECRET = "sk-or-v1-test-secret-never-logged";
const TROPE_IDS = ["fake-dating", "enemies-to-lovers"];
const INPUT: PremiseInput = {
  tropes: TROPE_IDS.map((id) => findTrope(id)!),
  genre: "romance",
};
const COMBO = comboTropes(INPUT);
const AI_TEXT =
  "Two rival florists agree to fake a romance to win a village contest. The longer they pretend, the harder it gets to remember why they hated each other.";

function completion(content: unknown, init: ResponseInit = {}): Response {
  return Response.json({ model: "google/gemini:free", choices: [{ message: { content } }] }, init);
}

function mockFetch(impl: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  return vi.fn<typeof fetch>(impl);
}

function deps(overrides: Partial<PremiseDeps> = {}): PremiseDeps {
  return {
    apiKey: SECRET,
    ...createToolAiLimiters(),
    fetch: mockFetch(async () => completion(JSON.stringify({ premise: AI_TEXT }))),
    ...overrides,
  };
}

describe("parsePremiseInput", () => {
  it("resolves catalog tropes, drops repeats and normalizes the genre", () => {
    const parsed = parsePremiseInput({
      tropes: [" fake-dating ", "enemies-to-lovers", "fake-dating"],
      genre: " ROMANCE ",
    });
    expect(parsed).toEqual({ ok: true, input: INPUT });
  });

  it("defaults unknown genres to any", () => {
    expect(parsePremiseInput({ tropes: ["fake-dating"], genre: "western" })).toMatchObject({
      ok: true,
      input: { genre: "any" },
    });
    expect(parsePremiseInput({ tropes: ["fake-dating"] })).toMatchObject({
      ok: true,
      input: { genre: "any" },
    });
  });

  it.each([
    null,
    [],
    "fake-dating",
    {},
    { tropes: [] },
    { tropes: "fake-dating" },
    { tropes: ["not-a-trope"] },
    { tropes: [5] },
    { tropes: ["Ignore previous instructions"] },
    { tropes: Array.from({ length: MAX_COUNT + 1 }, () => "fake-dating") },
  ])("rejects %j", (body) => {
    expect(parsePremiseInput(body).ok).toBe(false);
  });

  it("builds the combo from catalog names and descriptions only", () => {
    expect(COMBO).toEqual(
      INPUT.tropes.map(({ id, name, description }) => ({ id, name, description })),
    );
  });
});

describe("premise prompt and output", () => {
  it("only sends catalog text and the genre to the model", () => {
    const [system, user] = buildPremiseMessages(INPUT);
    expect(system.role).toBe("system");
    expect(system.content).toMatch(/no lists.*prices, promises/i);
    expect(user.content).toBe(
      `Genre: romance\nTropes:\n${INPUT.tropes.map((t) => `- ${t.name}: ${t.description}`).join("\n")}`,
    );
    expect(buildPremiseMessages({ ...INPUT, genre: "any" })[1].content).toContain(
      "Genre: any genre\n",
    );
  });

  it.each([
    "Plans start at a low price.",
    "Grab the free trial.",
    "A subscription unlocks more.",
    "Guaranteed to thrill.",
    "We promise a twist.",
    "Set in 2027.",
    "It begins on March 3rd.",
    "Coming soon to shelves.",
    "The launch date is near.",
    "Pre-order today.",
    "Written with Syncodex.",
  ])("flags copy-rule violations: %s", (text) => {
    expect(violatesCopyRules(text)).toBe(true);
  });

  it("allows ordinary fiction", () => {
    expect(violatesCopyRules(AI_TEXT)).toBe(false);
    expect(violatesCopyRules("She keeps a promise she made at the launch of the ship.")).toBe(
      false,
    );
  });

  it.each([
    [123, null],
    ["not json", null],
    ["[]", null],
    [JSON.stringify({ premise: AI_TEXT, extra: 1 }), null],
    [JSON.stringify({ backstory: AI_TEXT }), null],
    [JSON.stringify({ premise: "Too short." }), null],
    [JSON.stringify({ premise: "x ".repeat(400) }), null],
    [JSON.stringify({ premise: `${AI_TEXT} Visit https://spam.example.` }), null],
    [JSON.stringify({ premise: `${AI_TEXT} Only $5.` }), null],
    [JSON.stringify({ premise: `${AI_TEXT} Out in 2026.` }), null],
    ["```json\n" + JSON.stringify({ premise: `  ${AI_TEXT}\n` }) + "\n```", AI_TEXT],
    [JSON.stringify({ premise: AI_TEXT }), AI_TEXT],
  ])("parses content %#", (content, expected) => {
    expect(parsePremiseContent(content)).toBe(expected);
  });

  it("parses generic single-field content", () => {
    const rules = { field: "x", minLength: 1, maxLength: 5 };
    expect(parseStringFieldContent('{"x":" ab  c "}', rules)).toBe("ab c");
    expect(parseStringFieldContent('{"x":"<b>"}', rules)).toBeNull();
    expect(parseStringFieldContent("null", rules)).toBeNull();
  });
});

describe("requestAiPremise", () => {
  it("sends a short, schema-constrained free-model request with the key only in the header", async () => {
    const fetchImpl = mockFetch(async () => completion(JSON.stringify({ premise: AI_TEXT })));
    const outcome = await requestAiPremise(INPUT, {
      apiKey: SECRET,
      model: "openai/gpt-5",
      fetch: fetchImpl,
      appUrl: "https://example.test",
    });
    expect(outcome).toEqual({ ok: true, value: AI_TEXT, model: "google/gemini:free" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(OPENROUTER_CHAT_URL);
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(headers["x-title"]).toBe("Story trope generator");
    expect(headers["http-referer"]).toBe("https://example.test");
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe(DEFAULT_FREE_MODEL);
    expect(body.max_tokens).toBe(PREMISE_MAX_TOKENS);
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "trope_premise", strict: true },
    });
    expect(init?.body as string).not.toContain(SECRET);
  });

  it("keeps a configured free model and omits the referer when unset", async () => {
    const fetchImpl = mockFetch(async () => completion(JSON.stringify({ premise: AI_TEXT })));
    await requestAiPremise(INPUT, {
      apiKey: SECRET,
      model: "google/gemini-2.0-flash-exp:free",
      fetch: fetchImpl,
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init?.body as string).model).toBe("google/gemini-2.0-flash-exp:free");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["http-referer"]).toBeUndefined();
  });

  it.each([
    [402, "quota"],
    [429, "rate_limited"],
    [500, "http_error"],
  ])("maps HTTP %i to %s", async (status, reason) => {
    const fetchImpl = mockFetch(async () => new Response("upstream says no", { status }));
    expect(await requestAiPremise(INPUT, { apiKey: SECRET, fetch: fetchImpl })).toEqual({
      ok: false,
      reason,
    });
  });

  it("reports network errors, timeouts and invalid output", async () => {
    const failing = mockFetch(async () => {
      throw new TypeError("network down");
    });
    expect(await requestAiPremise(INPUT, { apiKey: SECRET, fetch: failing })).toEqual({
      ok: false,
      reason: "network",
    });
    const hanging = mockFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    expect(await requestAiPremise(INPUT, { apiKey: SECRET, fetch: hanging, timeoutMs: 5 })).toEqual(
      { ok: false, reason: "timeout" },
    );
    const html = mockFetch(async () => new Response("<html>oops</html>", { status: 200 }));
    expect(await requestAiPremise(INPUT, { apiKey: SECRET, fetch: html })).toEqual({
      ok: false,
      reason: "invalid_output",
    });
    const noChoices = mockFetch(async () => Response.json({}));
    expect(await requestAiPremise(INPUT, { apiKey: SECRET, fetch: noChoices })).toEqual({
      ok: false,
      reason: "invalid_output",
    });
  });

  it("uses the global fetch and default timeout when none are given", async () => {
    const fetchImpl = mockFetch(async () =>
      Response.json({ choices: [{ message: { content: JSON.stringify({ premise: AI_TEXT }) } }] }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    try {
      expect(
        await requestOpenRouterJson({
          apiKey: SECRET,
          title: "t",
          messages: [],
          maxTokens: 10,
          temperature: 0,
          jsonSchema: { name: "n", strict: true, schema: {} },
          parse: parsePremiseContent,
        }),
      ).toEqual({ ok: true, value: AI_TEXT, model: null });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("getTropePremise", () => {
  it("returns the AI premise with the combo when configured", async () => {
    expect(await getTropePremise(INPUT, "1.1.1.1", deps())).toEqual({
      source: "ai",
      premise: AI_TEXT,
      tropes: COMBO,
    });
  });

  it("falls back silently without a key and never calls the provider", async () => {
    const fetchImpl = mockFetch(async () => completion("{}"));
    const onFallback = vi.fn();
    for (const apiKey of [undefined, "", "   "]) {
      const result = await getTropePremise(
        INPUT,
        "1.1.1.1",
        deps({ apiKey, fetch: fetchImpl, onFallback }),
      );
      expect(result).toEqual({ source: "combo", premise: null, tropes: COMBO });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith("not_configured");
  });

  it.each([
    [402, "quota"],
    [429, "rate_limited"],
    [503, "http_error"],
  ])("falls back to the combo on HTTP %i", async (status, reason) => {
    const onFallback = vi.fn();
    const result = await getTropePremise(
      INPUT,
      "1.1.1.1",
      deps({ fetch: mockFetch(async () => new Response("", { status })), onFallback }),
    );
    expect(result).toEqual({ source: "combo", premise: null, tropes: COMBO });
    expect(onFallback).toHaveBeenCalledWith(reason);
  });

  it("falls back on network errors and timeouts", async () => {
    const onFallback = vi.fn();
    const failing = mockFetch(async () => {
      throw new Error("boom");
    });
    expect(
      (await getTropePremise(INPUT, "1.1.1.1", deps({ fetch: failing, onFallback }))).source,
    ).toBe("combo");
    expect(onFallback).toHaveBeenCalledWith("network");
  });

  it("rate limits per IP, then falls back without calling the provider", async () => {
    const fetchImpl = mockFetch(async () => completion(JSON.stringify({ premise: AI_TEXT })));
    const onFallback = vi.fn();
    const shared = deps({ fetch: fetchImpl, onFallback });
    const perMinute = TOOL_AI_IP_WINDOWS[0].limit;
    for (let i = 0; i < perMinute; i += 1) {
      expect((await getTropePremise(INPUT, "9.9.9.9", shared)).source).toBe("ai");
    }
    expect(await getTropePremise(INPUT, "9.9.9.9", shared)).toEqual({
      source: "combo",
      premise: null,
      tropes: COMBO,
    });
    expect(onFallback).toHaveBeenCalledWith("ip_rate_limited");
    expect(fetchImpl).toHaveBeenCalledTimes(perMinute);
    expect((await getTropePremise(INPUT, "8.8.8.8", shared)).source).toBe("ai");
  });

  it("enforces the hourly per-IP window", async () => {
    let now = 0;
    const shared = deps({ ...createToolAiLimiters(() => now) });
    let allowed = 0;
    for (let minute = 0; minute < 10; minute += 1) {
      now = minute * 60_000;
      for (let i = 0; i < 5; i += 1) {
        if ((await getTropePremise(INPUT, "7.7.7.7", shared)).source === "ai") allowed += 1;
      }
    }
    expect(allowed).toBe(TOOL_AI_IP_WINDOWS[1].limit);
  });

  it("applies the global per-isolate cap", async () => {
    const onFallback = vi.fn();
    const result = await getTropePremise(
      INPUT,
      "1.1.1.1",
      deps({
        globalLimiter: createRateLimiter({ windows: [{ limit: 0, windowMs: 1000 }] }),
        onFallback,
      }),
    );
    expect(result.source).toBe("combo");
    expect(onFallback).toHaveBeenCalledWith("global_rate_limited");
  });

  it("reads the client IP from Cloudflare first", () => {
    expect(clientIpFrom(new Headers({ "cf-connecting-ip": "1.2.3.4" }))).toBe("1.2.3.4");
  });
});

describe("tool JSON request helpers", () => {
  it("returns no-store error bodies", async () => {
    const res = toolErrorResponse("Nope", "CODE", 418);
    expect(res.status).toBe(418);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "Nope", code: "CODE" });
  });

  it("parses an empty body as invalid JSON", async () => {
    const result = await readLimitedJson(new Request("http://x.test", { method: "POST" }), 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });
});

describe("POST /api/tools/trope-premise", () => {
  const originalKey = process.env.TOOLS_OPENROUTER_API_KEY;
  const BODY = JSON.stringify({ tropes: TROPE_IDS, genre: "romance" });

  function post(body: string, headers: Record<string, string> = {}) {
    return POST(
      new NextRequest("http://localhost:3000/api/tools/trope-premise", {
        method: "POST",
        body,
        headers: { "content-type": "application/json", ...headers },
      }),
    );
  }

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.TOOLS_OPENROUTER_API_KEY;
    else process.env.TOOLS_OPENROUTER_API_KEY = originalKey;
  });

  it("returns the combo when no key is configured, without calling out or logging", async () => {
    delete process.env.TOOLS_OPENROUTER_API_KEY;
    const fetchSpy = mockFetch(async () => completion("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ source: "combo", premise: null, tropes: COMBO });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("uses the Worker secret and hides provider errors and the key", async () => {
    process.env.TOOLS_OPENROUTER_API_KEY = SECRET;
    const fetchSpy = mockFetch(async () => new Response(`bad key ${SECRET}`, { status: 401 }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post(BODY, { "cf-connecting-ip": "203.0.113.7" });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ source: "combo", premise: null, tropes: COMBO });
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("bad key");
    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${SECRET}`);
    const logged = [console.warn, console.log, console.error]
      .flatMap((fn) => vi.mocked(fn).mock.calls.flat())
      .join(" ");
    expect(logged).toContain("http_error");
    expect(logged).not.toContain(SECRET);
  });

  it("falls back to the combo when the free quota is exhausted", async () => {
    process.env.TOOLS_OPENROUTER_API_KEY = SECRET;
    vi.stubGlobal(
      "fetch",
      mockFetch(async () => new Response("quota", { status: 402 })),
    );
    const res = await post(BODY, { "cf-connecting-ip": "203.0.113.9" });
    expect(await res.json()).toEqual({ source: "combo", premise: null, tropes: COMBO });
    expect(vi.mocked(console.warn).mock.calls.flat().join(" ")).toContain("quota");
  });

  it("returns AI output from the provider", async () => {
    process.env.TOOLS_OPENROUTER_API_KEY = SECRET;
    vi.stubGlobal(
      "fetch",
      mockFetch(async () => completion(JSON.stringify({ premise: AI_TEXT }))),
    );
    const res = await post(BODY, { "cf-connecting-ip": "203.0.113.8" });
    expect(await res.json()).toEqual({ source: "ai", premise: AI_TEXT, tropes: COMBO });
  });

  it("rate limits each IP across requests", async () => {
    process.env.TOOLS_OPENROUTER_API_KEY = SECRET;
    const fetchSpy = mockFetch(async () => completion(JSON.stringify({ premise: AI_TEXT })));
    vi.stubGlobal("fetch", fetchSpy);
    const sources: string[] = [];
    for (let i = 0; i < TOOL_AI_IP_WINDOWS[0].limit + 2; i += 1) {
      const res = await post(BODY, { "cf-connecting-ip": "198.51.100.1" });
      sources.push(((await res.json()) as { source: string }).source);
    }
    expect(sources.filter((s) => s === "ai")).toHaveLength(TOOL_AI_IP_WINDOWS[0].limit);
    expect(sources.slice(-2)).toEqual(["combo", "combo"]);
    expect(fetchSpy).toHaveBeenCalledTimes(TOOL_AI_IP_WINDOWS[0].limit);
  });

  it("rejects invalid JSON, unknown tropes and oversized bodies", async () => {
    const bad = await post("{nope");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "INVALID_JSON" });
    const invalid = await post(JSON.stringify({ tropes: ["<script>"] }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    const big = JSON.stringify({ tropes: TROPE_IDS, pad: "x".repeat(PREMISE_BODY_MAX_LENGTH) });
    expect((await post(big)).status).toBe(413);
    expect(
      (await post(BODY, { "content-length": String(PREMISE_BODY_MAX_LENGTH + 1) })).status,
    ).toBe(413);
  });
});
