import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST as runCraft } from "../src/app/api/craft/[tool]/route";
import { AiError } from "../src/lib/ai/generate";
import {
  BRAINSTORM_DEFAULT_COUNT,
  BRAINSTORM_DEFAULT_TARGET_WORDS,
  BRAINSTORM_KINDS,
  BRAINSTORM_NO_SELECTION,
  MAX_CRAFT_OUTPUT_CHARS,
  applyCraftDefaults,
  completionBudgetWords,
  contractReadsSlice,
  filterBindingsBySlices,
  getCraftTool,
  parseOptions,
  renderCraftPrompt,
  resolveToolInputs,
  retrievalSelection,
  shapeCraftResult,
  toCraftToolDto,
} from "../src/lib/craft";
import { validatePromptContract } from "../src/lib/prompts/contracts";
import { buildSceneBindings } from "../src/lib/prompts/render";
import { primeCraftRoute, resetCraftRoute } from "./helpers/craft-route";

const { assemble, getScene, getUser } = vi.hoisted(() => ({
  assemble: vi.fn(),
  getScene: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("../src/lib/billing/entitlements", async () =>
  (await import("./helpers/craft-route")).craftEntitlementsMock(),
);
vi.mock("../src/lib/codex/service", () => ({ assembleCodexContextForScene: assemble }));
vi.mock("../src/lib/writing/service", () => ({ getSceneForEditor: getScene }));
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
}));
vi.mock("../src/lib/prisma", () => ({ db: { orm: { public: {} } } }));

const tool = getCraftTool("brainstorm");
const describeTool = getCraftTool("describe");

function render(raw: Record<string, unknown>) {
  const bindings = buildSceneBindings({
    mode: "brainstorm",
    novelTitle: "The Salt Road",
    chapterTitle: "Harbor",
    sceneTitle: "Docks at Dawn",
    povLabel: "Third Limited",
    tenseLabel: "Past",
    sceneContent: "Mara walked to the pier. The boat was late.",
    summary: "Mara waits for the boat.",
    codexPrompt: "<codex_context>Mara: smuggler</codex_context>",
  });
  return renderCraftPrompt(
    tool,
    filterBindingsBySlices(bindings, tool.contract.contextSlices),
    resolveToolInputs(tool, raw),
  )
    .messages.map((m) => m.content)
    .join("\n---\n");
}

describe("Brainstorm tool (STO-1272)", () => {
  it("is a valid copy-only options component inside the tool policy ceiling", () => {
    expect(validatePromptContract(tool.contract)).toEqual(tool.contract);
    for (const slice of tool.contract.contextSlices) {
      expect(tool.allowedContextSlices).toContain(slice);
    }
    expect(tool.allowedContextSlices).toEqual(describeTool.allowedContextSlices);
    expect(tool.parts[0].body).toBe(describeTool.parts[0].body);
    expect(tool.contract.output).toEqual({ mode: "options", suggestedAction: "copy_only" });
    expect(tool.contract.inputs.every((input) => !input.required)).toBe(true);
    expect(contractReadsSlice(tool.contract, "scene.summary")).toBe(true);
    expect(contractReadsSlice(tool.contract, "codex.context")).toBe(true);
    expect(contractReadsSlice(tool.contract, "scene.content")).toBe(false);
    const kind = tool.contract.inputs.find((i) => i.key === "craft.brainstorm_kind");
    expect(kind).toMatchObject({ type: "enum", options: [...BRAINSTORM_KINDS] });
  });

  it("exposes defaults in the DTO and fills blanks", () => {
    const dto = toCraftToolDto(tool);
    expect(dto).toMatchObject({ id: "brainstorm", name: "Brainstorm" });
    expect(dto.defaults["craft.brainstorm_count"]).toBe(BRAINSTORM_DEFAULT_COUNT);
    expect(applyCraftDefaults(tool, { "craft.selection": "  " })).toEqual({
      "craft.brainstorm_kind": "names",
      "craft.brainstorm_count": BRAINSTORM_DEFAULT_COUNT,
      "craft.instructions": "None.",
      "craft.selection": BRAINSTORM_NO_SELECTION,
      "craft.target_words": BRAINSTORM_DEFAULT_TARGET_WORDS,
    });
  });

  it("validates kind and count before spend", () => {
    expect(() => resolveToolInputs(tool, { "craft.brainstorm_kind": "villains" })).toThrow(
      expect.objectContaining({ status: 422 }),
    );
    expect(() => resolveToolInputs(tool, { "craft.brainstorm_count": 50 })).toThrow(
      expect.objectContaining({ status: 422 }),
    );
    expect(() => resolveToolInputs(tool, { "craft.before_passage": "x" })).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED", status: 422 }),
    );
  });

  it("renders kind, count, brief, summary and the optional selection", () => {
    const text = render({
      "craft.brainstorm_kind": "plot_twists",
      "craft.brainstorm_count": 3,
      "craft.instructions": "Something about the missing cargo.",
      "craft.selection": "The boat was late. {{scene.title}}",
      "craft.target_words": 25,
    });
    expect(text).toContain("<codex_context>Mara: smuggler</codex_context>");
    expect(text).toContain("Kind: plot_twists.");
    expect(text).toContain("exactly 3 options as a numbered list");
    expect(text).toContain("roughly 25 words or fewer");
    expect(text).toContain("Something about the missing cargo.");
    expect(text).toContain("Mara waits for the boat.");
    expect(text).toContain("The boat was late. {{scene.title}}");
    expect(text).not.toContain("Mara walked to the pier.");
    for (const kind of BRAINSTORM_KINDS) expect(text).toContain(`- ${kind}:`);
    expect(render({})).toContain(BRAINSTORM_NO_SELECTION);
  });

  it("budgets per option and ignores the no-selection placeholder for retrieval", () => {
    const inputs = resolveToolInputs(tool, { "craft.brainstorm_count": 4 });
    expect(completionBudgetWords(tool, inputs)).toBe(BRAINSTORM_DEFAULT_TARGET_WORDS * 4);
    expect(completionBudgetWords(tool, { "craft.target_words": "10" })).toBe(10);
    expect(completionBudgetWords(tool, {})).toBeUndefined();
    expect(completionBudgetWords(describeTool, { "craft.target_words": "80" })).toBe(80);
    expect(retrievalSelection(tool, inputs)).toBeUndefined();
    expect(retrievalSelection(tool, { "craft.selection": "Real text" })).toBe("Real text");
    expect(retrievalSelection(describeTool, { "craft.selection": "Sel" })).toBe("Sel");
  });
});

describe("parseOptions", () => {
  it("splits a numbered list, dropping an intro and keeping continuations", () => {
    const raw =
      "Here are some ideas:\n1. Corvin Ashe\n2) **Teodor Vell**\n   a dockmaster\n\n3. Isk";
    expect(parseOptions(raw)).toEqual(["Corvin Ashe", "**Teodor Vell**\n   a dockmaster", "Isk"]);
  });

  it("caps to the requested count and unwraps a fenced reply", () => {
    expect(parseOptions("```\n1. a\n2. b\n3. c\n```", 2)).toEqual(["a", "b"]);
  });

  it("fails recoverably on unnumbered or oversized output", () => {
    expect(() => parseOptions("Just one long paragraph.")).toThrow(AiError);
    expect(() => parseOptions("1.   \n2. ")).toThrow(
      expect.objectContaining({ code: "AI_INVALID_RESPONSE", status: 502 }),
    );
    expect(() => parseOptions(`1. ${"x".repeat(MAX_CRAFT_OUTPUT_CHARS)}`)).toThrow(/too long/);
  });

  it("shapes options results with a copyable list as text", () => {
    expect(shapeCraftResult(tool.contract.output, "1. a\n2. b", 5)).toEqual({
      kind: "options",
      options: ["a", "b"],
      text: "1. a\n2. b",
    });
  });
});

function craft(body: unknown) {
  return runCraft(
    new NextRequest("http://localhost/api/craft/brainstorm", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tool: "brainstorm" }) },
  );
}

function chatFetch(content: string) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({ model: "served", choices: [{ message: { content } }] }),
  );
}

describe("POST /api/craft/brainstorm", () => {
  beforeEach(() =>
    primeCraftRoute({ getUser, assemble, getScene }, { content: "Mara walked to the pier." }),
  );
  afterEach(resetCraftRoute);

  it("dryRun works with no inputs and retrieves by scene summary", async () => {
    const fetchMock = chatFetch("");
    vi.stubGlobal("fetch", fetchMock);
    const res = await craft({ sceneId: "scene", dryRun: true });
    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(json.output).toEqual({ mode: "options", suggestedAction: "copy_only" });
    expect(json.prompt.maxTokens).toBe(
      BRAINSTORM_DEFAULT_TARGET_WORDS * BRAINSTORM_DEFAULT_COUNT * 2,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assemble).toHaveBeenCalledWith(
      "owner",
      expect.objectContaining({ beatText: "Mara waits." }),
    );
  });

  it("returns parsed options capped at the requested count", async () => {
    const fetchMock = chatFetch("1. Corvin\n2. Teodor\n3. Isk\n4. Extra");
    vi.stubGlobal("fetch", fetchMock);
    const res = await craft({
      sceneId: "scene",
      inputs: { "craft.brainstorm_count": 3, "craft.selection": "The boat was late." },
    });
    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(json).toMatchObject({
      tool: "brainstorm",
      options: ["Corvin", "Teodor", "Isk"],
      text: "1. Corvin\n2. Teodor\n3. Isk",
      result: { kind: "options" },
    });
    expect(json).not.toHaveProperty("diagnosis");
    expect(assemble).toHaveBeenCalledWith(
      "owner",
      expect.objectContaining({ beatText: "The boat was late." }),
    );
  });

  it("502 AI_INVALID_RESPONSE when the model ignores the list format", async () => {
    vi.stubGlobal("fetch", chatFetch("I would suggest a few names, such as Corvin."));
    const res = await craft({ sceneId: "scene" });
    expect(res.status).toBe(502);
    expect((await res.json<any>()).code).toBe("AI_INVALID_RESPONSE");
  });
});
