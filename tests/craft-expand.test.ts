import { describe, expect, it } from "vite-plus/test";
import {
  EXPAND_DEFAULT_TARGET_WORDS,
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
import { buildSceneBindings } from "../src/lib/prompts/render";
import { validatePromptContract } from "../src/lib/prompts/contracts";

const expandTool = getCraftTool("expand");
const describeTool = getCraftTool("describe");

function sceneBindings() {
  return buildSceneBindings({
    mode: "expand",
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

describe("Expand tool (STO-1268)", () => {
  it("is a valid built-in component within the tool policy ceiling", () => {
    expect(isCraftToolId("expand")).toBe(true);
    expect(validatePromptContract(expandTool.contract)).toEqual(expandTool.contract);
    for (const slice of expandTool.contract.contextSlices) {
      expect(expandTool.allowedContextSlices).toContain(slice);
    }
    expect(expandTool.contract.output).toEqual({
      mode: "prose",
      suggestedAction: "replace_selection",
    });
    expect(expandTool.contract.inputs.map((i) => i.key)).toEqual([
      "craft.selection",
      "craft.target_words",
      "craft.instructions",
    ]);
    expect(expandTool.contract.inputs[0].required).toBe(true);
    expect(contractReadsSlice(expandTool.contract, "codex.context")).toBe(true);
    expect(contractReadsSlice(expandTool.contract, "scene.summary")).toBe(false);
  });

  it("reuses the Describe system prompt and slices (scaffold unchanged)", () => {
    expect(expandTool.parts[0].body).toBe(describeTool.parts[0].body);
    expect(expandTool.contract.contextSlices).toEqual(describeTool.contract.contextSlices);
    expect(expandTool.allowedContextSlices).toEqual(describeTool.allowedContextSlices);
  });

  it("exposes its catalog entry for the editor panel", () => {
    const dto = toCraftToolDto(expandTool);
    expect(dto).toMatchObject({ id: "expand", name: "Expand" });
    expect(dto.summary).toMatch(/atmosphere and inner monologue/);
    expect(dto.defaults["craft.target_words"]).toBe(EXPAND_DEFAULT_TARGET_WORDS);
  });

  it("fills defaults and maps the length target to a token budget", () => {
    expect(applyCraftDefaults(expandTool, { "craft.selection": "x" })).toEqual({
      "craft.selection": "x",
      "craft.target_words": EXPAND_DEFAULT_TARGET_WORDS,
      "craft.instructions": "None.",
    });
    expect(maxTokensForTargetWords(EXPAND_DEFAULT_TARGET_WORDS)).toBe(600);
  });

  it("validates inputs before spend", () => {
    expect(() => resolveToolInputs(expandTool, {})).toThrow(
      expect.objectContaining({ code: "MISSING_INPUT", status: 422 }),
    );
    expect(() =>
      resolveToolInputs(expandTool, { "craft.selection": "x", "craft.target_words": 10 }),
    ).toThrow(expect.objectContaining({ status: 422 }));
    expect(() =>
      resolveToolInputs(expandTool, { "craft.selection": "x", "craft.target_words": 2001 }),
    ).toThrow(expect.objectContaining({ status: 422 }));
    expect(() =>
      resolveToolInputs(expandTool, { "craft.selection": "x", "craft.sensory_focus": "sound" }),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED", status: 422 }));
  });

  it("renders atmosphere + inner monologue guidance with selection and story context", () => {
    const inputs = resolveToolInputs(expandTool, {
      "craft.selection": "The boat was late. {{scene.title}}",
      "craft.target_words": 450,
      "craft.instructions": "Lean into her dread.",
    });
    const rendered = renderCraftPrompt(
      expandTool,
      filterBindingsBySlices(sceneBindings(), expandTool.contract.contextSlices),
      inputs,
    );
    const [system, user] = rendered.messages.map((m) => m.content);
    expect(system).toContain("The Salt Road — Harbor / Docks at Dawn");
    expect(system).toContain("<codex_context>Mara: smuggler</codex_context>");
    expect(user).toContain("atmosphere");
    expect(user).toContain("inner monologue");
    expect(user).toContain("roughly 450 words");
    expect(user).toContain("Lean into her dread.");
    expect(user).toContain("Mara walked to the pier.");
    expect(user).toContain("The boat was late. {{scene.title}}");
    expect(user).not.toContain("Mara waits for the boat.");
  });
});
