import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST as runCraft } from "../src/app/api/craft/[tool]/route";
import {
  TRANSITION_DEFAULT_TARGET_WORDS,
  applyCraftDefaults,
  contractReadsSlice,
  filterBindingsBySlices,
  getCraftTool,
  isCraftToolId,
  maxTokensForTargetWords,
  renderCraftPrompt,
  resolveToolInputs,
  toCraftToolDto,
} from "../src/lib/craft";
import { retrievalText } from "../src/lib/craft/service";
import { validatePromptContract } from "../src/lib/prompts/contracts";
import { buildSceneBindings } from "../src/lib/prompts/render";

const { getUser, getScene, assemble } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getScene: vi.fn(),
  assemble: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => ({ db: { orm: { public: {} } } }));
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
}));
vi.mock("../src/lib/writing/service", () => ({ getSceneForEditor: getScene }));
vi.mock("../src/lib/codex/service", () => ({ assembleCodexContextForScene: assemble }));
vi.mock("../src/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ maxContextTokens: 8000 }),
  resolveContextTokenBudget: () => 8000,
}));

const transitionTool = getCraftTool("transition");
const describeTool = getCraftTool("describe");

const BEFORE = "Mara slammed the hatch shut as the storm broke over the harbor.";
const AFTER = "By the time the Kestrel reached Vell, the bruises had gone yellow.";

function sceneBindings() {
  return buildSceneBindings({
    mode: "transition",
    novelTitle: "The Salt Road",
    chapterTitle: "Harbor",
    sceneTitle: "Docks at Dawn",
    povLabel: "Third Limited",
    tenseLabel: "Past",
    sceneContent: "Mara walked to the pier. The boat was late.",
    summary: "Mara waits for the boat.",
    beatText: "ignored beat",
    codexPrompt: "<codex_context>Mara: smuggler</codex_context>",
  });
}

describe("Transition tool (STO-1271)", () => {
  it("is a valid built-in component within the tool policy ceiling", () => {
    expect(isCraftToolId("transition")).toBe(true);
    expect(validatePromptContract(transitionTool.contract)).toEqual(transitionTool.contract);
    for (const slice of transitionTool.contract.contextSlices) {
      expect(transitionTool.allowedContextSlices).toContain(slice);
    }
    expect(transitionTool.contract.output).toEqual({
      mode: "prose",
      suggestedAction: "insert_between",
    });
    expect(transitionTool.contract.inputs.map((i) => [i.key, i.required])).toEqual([
      ["craft.before_passage", true],
      ["craft.after_passage", true],
      ["craft.target_words", false],
      ["craft.instructions", false],
    ]);
    expect(contractReadsSlice(transitionTool.contract, "codex.context")).toBe(true);
    expect(contractReadsSlice(transitionTool.contract, "scene.content")).toBe(true);
    expect(contractReadsSlice(transitionTool.contract, "selection")).toBe(false);
    expect(contractReadsSlice(transitionTool.contract, "scene.summary")).toBe(false);
  });

  it("reuses the Describe system prompt and slice policy", () => {
    expect(transitionTool.parts[0].body).toBe(describeTool.parts[0].body);
    expect(transitionTool.allowedContextSlices).toEqual(describeTool.allowedContextSlices);
    expect(transitionTool.contract.contextSlices).toEqual(
      describeTool.contract.contextSlices.filter((s) => s !== "selection"),
    );
  });

  it("exposes its defaults in the DTO", () => {
    const dto = toCraftToolDto(transitionTool);
    expect(dto).toMatchObject({ id: "transition", name: "Transition" });
    expect(dto.defaults["craft.target_words"]).toBe(TRANSITION_DEFAULT_TARGET_WORDS);
    expect(dto).not.toHaveProperty("parts");
  });

  it("fills defaults and maps the length target to a token budget", () => {
    expect(
      applyCraftDefaults(transitionTool, {
        "craft.before_passage": "a",
        "craft.after_passage": "b",
      }),
    ).toEqual({
      "craft.before_passage": "a",
      "craft.after_passage": "b",
      "craft.target_words": TRANSITION_DEFAULT_TARGET_WORDS,
      "craft.instructions": "None.",
    });
    expect(TRANSITION_DEFAULT_TARGET_WORDS).toBe(150);
    expect(maxTokensForTargetWords(TRANSITION_DEFAULT_TARGET_WORDS)).toBe(300);
  });

  it("validates inputs before spend", () => {
    expect(() => resolveToolInputs(transitionTool, {})).toThrow(
      expect.objectContaining({ code: "MISSING_INPUT", status: 422 }),
    );
    expect(() => resolveToolInputs(transitionTool, { "craft.before_passage": "a" })).toThrow(
      expect.objectContaining({ code: "MISSING_INPUT", status: 422 }),
    );
    expect(() => resolveToolInputs(transitionTool, { "craft.after_passage": "b" })).toThrow(
      expect.objectContaining({ code: "MISSING_INPUT", status: 422 }),
    );
    expect(() =>
      resolveToolInputs(transitionTool, {
        "craft.before_passage": "a",
        "craft.after_passage": "b",
        "craft.target_words": 2000,
      }),
    ).toThrow(expect.objectContaining({ status: 422 }));
    expect(() =>
      resolveToolInputs(transitionTool, {
        "craft.before_passage": "a",
        "craft.after_passage": "b",
        "craft.selection": "x",
      }),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED", status: 422 }));
  });

  it("renders both passages, the length target and story context", () => {
    const inputs = resolveToolInputs(transitionTool, {
      "craft.before_passage": BEFORE,
      "craft.after_passage": `${AFTER} {{scene.title}}`,
      "craft.target_words": 220,
      "craft.instructions": "Skip three days.",
    });
    const rendered = renderCraftPrompt(
      transitionTool,
      filterBindingsBySlices(sceneBindings(), transitionTool.contract.contextSlices),
      inputs,
    );
    const [system, user] = rendered.messages.map((m) => m.content);
    expect(system).toContain("The Salt Road — Harbor / Docks at Dawn");
    expect(system).toContain("<codex_context>Mara: smuggler</codex_context>");
    expect(user).toContain("bridging passage");
    expect(user).toContain("time, place, point of view or mood");
    expect(user).toContain("Do not repeat, summarize or rewrite either passage");
    expect(user).toContain("roughly 220 words");
    expect(user).toContain("Skip three days.");
    expect(user).toContain("Mara walked to the pier.");
    expect(user).toContain(BEFORE);
    expect(user).toContain(`${AFTER} {{scene.title}}`);
    expect(user.indexOf(BEFORE)).toBeLessThan(user.indexOf(AFTER));
    expect(user).not.toContain("Mara waits for the boat.");
  });

  it("drives Codex retrieval from the selection or the joined passages", () => {
    expect(retrievalText({ "craft.selection": "sel", "craft.before_passage": "a" })).toBe("sel");
    expect(retrievalText({ "craft.before_passage": "a", "craft.after_passage": "b" })).toBe(
      "a\n\nb",
    );
    expect(retrievalText({})).toBe("");
  });
});

function craft(body: unknown) {
  return runCraft(
    new NextRequest("http://localhost/api/craft/transition", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tool: "transition" }) },
  );
}

function chatFetch() {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({
      model: "served",
      choices: [{ message: { content: "Three days of grey water later…" } }],
    }),
  );
}

describe("POST /api/craft/transition", () => {
  beforeEach(() => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "platform-key");
    vi.stubEnv("AI_MODEL", "");
    getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
    assemble.mockResolvedValue({ entries: [], meta: {} });
    getScene.mockResolvedValue({
      id: "scene",
      novelId: "novel",
      novelTitle: "The Salt Road",
      chapterTitle: "Harbor",
      title: "Docks at Dawn",
      content: "Mara walked to the pier. The boat was late.",
      summary: "Mara waits.",
      excludeFromAi: false,
      pov: "THIRD_LIMITED",
      tense: "PAST",
    });
  });
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("422 MISSING_INPUT when the after passage is missing, before any scene lookup", async () => {
    const fetchMock = chatFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await craft({ sceneId: "scene", inputs: { "craft.before_passage": BEFORE } });
    expect(res.status).toBe(422);
    const json = await res.json<any>();
    expect(json.code).toBe("MISSING_INPUT");
    expect(json.error).toContain("craft.after_passage");
    expect(getScene).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("422 MISSING_INPUT when the before passage is missing", async () => {
    const res = await craft({ sceneId: "scene", inputs: { "craft.after_passage": AFTER } });
    expect(res.status).toBe(422);
    const json = await res.json<any>();
    expect(json.code).toBe("MISSING_INPUT");
    expect(json.error).toContain("craft.before_passage");
    expect(getScene).not.toHaveBeenCalled();
  });

  it("dryRun renders both passages with the default length target", async () => {
    const fetchMock = chatFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await craft({
      sceneId: "scene",
      dryRun: true,
      inputs: { "craft.before_passage": BEFORE, "craft.after_passage": AFTER },
    });
    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(json.tool).toBe("transition");
    expect(json.output).toEqual({ mode: "prose", suggestedAction: "insert_between" });
    expect(json.prompt.maxTokens).toBe(300);
    const user = json.prompt.messages[1].content as string;
    expect(user).toContain("roughly 150 words");
    expect(user).toContain(BEFORE);
    expect(user).toContain(AFTER);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assemble).toHaveBeenCalledWith(
      "owner",
      expect.objectContaining({ beatText: `${BEFORE}\n\n${AFTER}` }),
    );
  });

  it("returns the bridge prose from the platform provider", async () => {
    const fetchMock = chatFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await craft({
      sceneId: "scene",
      inputs: {
        "craft.before_passage": BEFORE,
        "craft.after_passage": AFTER,
        "craft.target_words": 200,
      },
    });
    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(json).toMatchObject({
      tool: "transition",
      text: "Three days of grey water later…",
      output: { mode: "prose", suggestedAction: "insert_between" },
      applied: { provider: "platform-gateway", parameters: { max_tokens: 400 } },
    });
    const [[, init]] = fetchMock.mock.calls;
    const sent = JSON.parse(init!.body as string);
    expect(sent.messages[1].content).toContain("roughly 200 words");
    expect(sent.messages[1].content).toContain(AFTER);
  });
});
