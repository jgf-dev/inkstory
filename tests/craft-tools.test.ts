import { describe, expect, it } from "vite-plus/test";
import {
  CRAFT_TOOL_IDS,
  DESCRIBE_DEFAULT_TARGET_WORDS,
  MIN_CRAFT_OUTPUT_TOKENS,
  applyCraftDefaults,
  contractReadsSlice,
  filterBindingsBySlices,
  getCraftTool,
  isCraftToolId,
  listCraftTools,
  maxTokensForTargetWords,
  renderCraftPrompt,
  resolveToolInputs,
  toCraftToolDto,
  type CraftToolDefinition,
} from "../src/lib/craft";
import { MAX_OUTPUT_TOKENS } from "../src/lib/ai/generate";
import { buildSceneBindings } from "../src/lib/prompts/render";
import { validatePromptContract } from "../src/lib/prompts/contracts";

const describeTool = getCraftTool("describe");

function sceneBindings() {
  return buildSceneBindings({
    mode: "describe",
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

describe("craft tool registry", () => {
  it("registers Describe first, with a valid contract inside its policy ceiling", () => {
    expect(CRAFT_TOOL_IDS).toEqual(["describe"]);
    expect(listCraftTools().map((t) => t.id)).toEqual(["describe"]);
    expect(validatePromptContract(describeTool.contract)).toEqual(describeTool.contract);
    for (const slice of describeTool.contract.contextSlices) {
      expect(describeTool.allowedContextSlices).toContain(slice);
    }
    expect(describeTool.contract.output).toEqual({
      mode: "prose",
      suggestedAction: "replace_selection",
    });
    expect(describeTool.contract.inputs.find((i) => i.key === "craft.selection")?.required).toBe(
      true,
    );
  });

  it("rejects unknown tools with 404", () => {
    expect(isCraftToolId("describe")).toBe(true);
    expect(isCraftToolId("expand")).toBe(false);
    expect(isCraftToolId(42)).toBe(false);
    expect(() => getCraftTool("nope")).toThrow(
      expect.objectContaining({ code: "NOT_FOUND", status: 404 }),
    );
  });

  it("exposes a DTO without prompt bodies", () => {
    const dto = toCraftToolDto(describeTool);
    expect(dto).toMatchObject({ id: "describe", name: "Describe" });
    expect(dto.defaults["craft.target_words"]).toBe(DESCRIBE_DEFAULT_TARGET_WORDS);
    expect(dto).not.toHaveProperty("parts");
    expect(dto.allowedContextSlices).not.toBe(describeTool.allowedContextSlices);
  });
});

describe("craft inputs", () => {
  it("fills blank declared inputs from tool defaults but keeps explicit values", () => {
    expect(applyCraftDefaults(describeTool, undefined)).toEqual({
      "craft.sensory_focus": "any",
      "craft.target_words": DESCRIBE_DEFAULT_TARGET_WORDS,
      "craft.instructions": "None.",
    });
    expect(
      applyCraftDefaults(describeTool, {
        "craft.selection": "x",
        "craft.sensory_focus": "smell",
        "craft.instructions": "   ",
      }),
    ).toMatchObject({
      "craft.selection": "x",
      "craft.sensory_focus": "smell",
      "craft.instructions": "None.",
    });
    // Non-objects pass through so the contract check rejects them.
    expect(applyCraftDefaults(describeTool, "text")).toBe("text");
    expect(applyCraftDefaults(describeTool, [1])).toEqual([1]);
  });

  it("resolves valid inputs into inert string bindings", () => {
    const bindings = resolveToolInputs(describeTool, {
      "craft.selection": "The boat was late.",
      "craft.target_words": 80,
    });
    expect(bindings).toEqual({
      "craft.selection": "The boat was late.",
      "craft.sensory_focus": "any",
      "craft.target_words": "80",
      "craft.instructions": "None.",
    });
  });

  it("rejects missing selection, undeclared keys and out-of-range values with 422", () => {
    expect(() => resolveToolInputs(describeTool, {})).toThrow(
      expect.objectContaining({ code: "MISSING_INPUT", status: 422 }),
    );
    expect(() => resolveToolInputs(describeTool, { "craft.selection": "   " })).toThrow(
      expect.objectContaining({ code: "MISSING_INPUT" }),
    );
    expect(() =>
      resolveToolInputs(describeTool, {
        "craft.selection": "x",
        "craft.rewrite_preset": "simpler",
      }),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED", status: 422 }));
    expect(() =>
      resolveToolInputs(describeTool, { "craft.selection": "x", "craft.target_words": 5 }),
    ).toThrow(/between 10 and 1000/);
    expect(() =>
      resolveToolInputs(describeTool, { "craft.selection": "x", "craft.sensory_focus": "vibes" }),
    ).toThrow(/must be one of/);
    expect(() =>
      resolveToolInputs(describeTool, { "craft.selection": "x".repeat(20_001) }),
    ).toThrow(/at most 20000 characters/);
    expect(() => resolveToolInputs(describeTool, "nope")).toThrow(/must be an object/);
  });

  it("enforces the tool policy ceiling on context slices", () => {
    const greedy: CraftToolDefinition = {
      ...describeTool,
      allowedContextSlices: ["selection", "scene.content"],
    };
    expect(() => resolveToolInputs(greedy, { "craft.selection": "x" })).toThrow(
      expect.objectContaining({ code: "FORBIDDEN", status: 403 }),
    );
  });
});

describe("craft context slices", () => {
  it("binds only declared slices and drops beat/mode", () => {
    const filtered = filterBindingsBySlices(sceneBindings(), ["selection", "scene.title"]);
    expect(filtered).toEqual({ "scene.title": "Docks at Dawn" });
    const all = filterBindingsBySlices(sceneBindings(), describeTool.allowedContextSlices);
    expect(all).not.toHaveProperty("beat.text");
    expect(all).not.toHaveProperty("mode");
    expect(all["scene.summary"]).toBe("Mara waits for the boat.");
    expect(contractReadsSlice(describeTool.contract, "codex.context")).toBe(true);
    expect(contractReadsSlice(describeTool.contract, "scene.summary")).toBe(false);
  });
});

describe("craft output length", () => {
  it("maps the word target to a clamped completion budget", () => {
    expect(maxTokensForTargetWords(undefined)).toBeUndefined();
    expect(maxTokensForTargetWords(0)).toBeUndefined();
    expect(maxTokensForTargetWords(Number.NaN)).toBeUndefined();
    expect(maxTokensForTargetWords(10)).toBe(MIN_CRAFT_OUTPUT_TOKENS);
    expect(maxTokensForTargetWords(150)).toBe(300);
    expect(maxTokensForTargetWords(5000)).toBe(MAX_OUTPUT_TOKENS);
  });
});

describe("craft prompt rendering", () => {
  it("renders Describe with selection, focus, target and story context", () => {
    const inputs = resolveToolInputs(describeTool, {
      "craft.selection": "The boat was late. {{scene.title}}",
      "craft.sensory_focus": "sound",
      "craft.target_words": 120,
    });
    const rendered = renderCraftPrompt(
      describeTool,
      filterBindingsBySlices(sceneBindings(), describeTool.contract.contextSlices),
      inputs,
    );
    expect(rendered.messages.map((m) => m.role)).toEqual(["system", "user"]);
    const [system, user] = rendered.messages.map((m) => m.content);
    expect(system).toContain("The Salt Road — Harbor / Docks at Dawn");
    expect(system).toContain("third limited and past tense");
    expect(system).toContain("<codex_context>Mara: smuggler</codex_context>");
    expect(user).toContain("Sensory focus: sound");
    expect(user).toContain("roughly 120 words");
    expect(user).toContain("Mara walked to the pier.");
    // Supplied text is inserted literally, never re-interpolated.
    expect(user).toContain("The boat was late. {{scene.title}}");
    expect(user).not.toContain("Mara waits for the boat.");
  });

  it("rejects a body that reads an undeclared slice", () => {
    const narrow: CraftToolDefinition = {
      ...describeTool,
      contract: {
        ...describeTool.contract,
        contextSlices: describeTool.contract.contextSlices.filter((s) => s !== "codex.context"),
      },
    };
    const inputs = resolveToolInputs(narrow, { "craft.selection": "x" });
    expect(() =>
      renderCraftPrompt(
        narrow,
        filterBindingsBySlices(sceneBindings(), narrow.contract.contextSlices),
        inputs,
      ),
    ).toThrow(expect.objectContaining({ code: "UNRESOLVED_VARS", status: 422 }));
  });

  it("rejects unbound craft inputs and unknown tokens", () => {
    const sloppy: CraftToolDefinition = {
      ...describeTool,
      parts: [{ role: "user", body: "{{craft.brainstorm_count}} {{mystery}}" }],
    };
    expect(() => renderCraftPrompt(sloppy, {}, {})).toThrow(/craft\.brainstorm_count|mystery/);
  });
});
