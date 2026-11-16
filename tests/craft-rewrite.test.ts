import { describe, expect, it } from "vite-plus/test";
import {
  REWRITE_DEFAULT_PRESET,
  REWRITE_DEFAULT_TARGET_WORDS,
  REWRITE_PRESET_GUIDANCE,
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
import { REWRITE_PRESETS, validatePromptContract } from "../src/lib/prompts/contracts";

const rewriteTool = getCraftTool("rewrite");
const describeTool = getCraftTool("describe");

function sceneBindings() {
  return buildSceneBindings({
    mode: "rewrite",
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

function render(raw: Record<string, unknown>) {
  const inputs = resolveToolInputs(rewriteTool, raw);
  const rendered = renderCraftPrompt(
    rewriteTool,
    filterBindingsBySlices(sceneBindings(), rewriteTool.contract.contextSlices),
    inputs,
  );
  return rendered.messages.map((m) => m.content);
}

describe("Rewrite tool (STO-1269)", () => {
  it("is a valid built-in component within the tool policy ceiling", () => {
    expect(isCraftToolId("rewrite")).toBe(true);
    expect(validatePromptContract(rewriteTool.contract)).toEqual(rewriteTool.contract);
    for (const slice of rewriteTool.contract.contextSlices) {
      expect(rewriteTool.allowedContextSlices).toContain(slice);
    }
    expect(rewriteTool.contract.output).toEqual({
      mode: "prose",
      suggestedAction: "replace_selection",
    });
    expect(rewriteTool.contract.inputs.map((i) => i.key)).toEqual([
      "craft.selection",
      "craft.rewrite_preset",
      "craft.target_words",
      "craft.instructions",
    ]);
    const preset = rewriteTool.contract.inputs[1];
    expect(preset).toMatchObject({ type: "enum", required: false, options: [...REWRITE_PRESETS] });
    expect(contractReadsSlice(rewriteTool.contract, "codex.context")).toBe(true);
    expect(contractReadsSlice(rewriteTool.contract, "scene.summary")).toBe(false);
  });

  it("reuses the shared system prompt and slices (scaffold unchanged)", () => {
    expect(rewriteTool.parts[0].body).toBe(describeTool.parts[0].body);
    expect(rewriteTool.contract.contextSlices).toEqual(describeTool.contract.contextSlices);
    expect(rewriteTool.allowedContextSlices).toEqual(describeTool.allowedContextSlices);
  });

  it("documents every code-owned preset", () => {
    expect(Object.keys(REWRITE_PRESET_GUIDANCE).sort()).toEqual([...REWRITE_PRESETS].sort());
    expect(REWRITE_PRESETS).toContain(REWRITE_DEFAULT_PRESET);
  });

  it("exposes its catalog entry for the editor panel", () => {
    const dto = toCraftToolDto(rewriteTool);
    expect(dto).toMatchObject({ id: "rewrite", name: "Rewrite" });
    expect(dto.summary).toMatch(/preset or your own instructions/);
    expect(dto.defaults["craft.rewrite_preset"]).toBe(REWRITE_DEFAULT_PRESET);
    expect(dto.defaults["craft.target_words"]).toBe(REWRITE_DEFAULT_TARGET_WORDS);
  });

  it("fills defaults and maps the length target to a token budget", () => {
    expect(applyCraftDefaults(rewriteTool, { "craft.selection": "x" })).toEqual({
      "craft.selection": "x",
      "craft.rewrite_preset": REWRITE_DEFAULT_PRESET,
      "craft.target_words": REWRITE_DEFAULT_TARGET_WORDS,
      "craft.instructions": "None.",
    });
    expect(maxTokensForTargetWords(REWRITE_DEFAULT_TARGET_WORDS)).toBe(400);
  });

  it("validates inputs before spend", () => {
    expect(() => resolveToolInputs(rewriteTool, {})).toThrow(
      expect.objectContaining({ code: "MISSING_INPUT", status: 422 }),
    );
    expect(() =>
      resolveToolInputs(rewriteTool, { "craft.selection": "x", "craft.rewrite_preset": "pop" }),
    ).toThrow(expect.objectContaining({ status: 422 }));
    expect(() =>
      resolveToolInputs(rewriteTool, { "craft.selection": "x", "craft.target_words": 5 }),
    ).toThrow(expect.objectContaining({ status: 422 }));
    expect(() =>
      resolveToolInputs(rewriteTool, { "craft.selection": "x", "craft.target_words": 2001 }),
    ).toThrow(expect.objectContaining({ status: 422 }));
    expect(() =>
      resolveToolInputs(rewriteTool, { "craft.selection": "x", "craft.sensory_focus": "sound" }),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED", status: 422 }));
  });

  it("renders the chosen preset with its guidance, selection and story context", () => {
    const [system, user] = render({
      "craft.selection": "The boat was late. {{scene.title}}",
      "craft.rewrite_preset": "more_concise",
      "craft.target_words": 80,
    });
    expect(system).toContain("The Salt Road — Harbor / Docks at Dawn");
    expect(system).toContain("<codex_context>Mara: smuggler</codex_context>");
    expect(user).toContain("Rewrite preset: more_concise.");
    expect(user).toContain(`- more_concise: ${REWRITE_PRESET_GUIDANCE.more_concise}.`);
    expect(user).toContain("roughly 80 words");
    expect(user).toContain("The boat was late. {{scene.title}}");
    expect(user).toContain("Mara walked to the pier.");
    expect(user).not.toContain("Mara waits for the boat.");
  });

  it("lets custom instructions drive the rewrite with the default preset", () => {
    const [, user] = render({
      "craft.selection": "The boat was late.",
      "craft.instructions": "Make it sound like a sea shanty.",
    });
    expect(user).toContain(`Rewrite preset: ${REWRITE_DEFAULT_PRESET}.`);
    expect(user).toContain("takes priority over the preset");
    expect(user).toContain("Make it sound like a sea shanty.");
    expect(user).toContain(`roughly ${REWRITE_DEFAULT_TARGET_WORDS} words`);
  });
});
