import { describe, expect, it } from "vite-plus/test";
import {
  DIAGNOSIS_MARKER,
  MAX_CRAFT_OUTPUT_CHARS,
  REWRITE_MARKER,
  SHOW_DONT_TELL_DEFAULT_TARGET_WORDS,
  applyCraftDefaults,
  contractReadsSlice,
  filterBindingsBySlices,
  getCraftTool,
  isCraftToolId,
  parseDiagnosisAndProse,
  renderCraftPrompt,
  resolveToolInputs,
  shapeCraftResult,
  toCraftToolDto,
} from "../src/lib/craft";
import { CRAFT_PROSE_FORMAT_RULE, CRAFT_SECTIONED_FORMAT_RULE } from "../src/lib/craft/tools";
import { AiError } from "../src/lib/ai/generate";
import { buildSceneBindings } from "../src/lib/prompts/render";
import { validatePromptContract } from "../src/lib/prompts/contracts";

const tool = getCraftTool("show_dont_tell");
const describeTool = getCraftTool("describe");

function render(raw: Record<string, unknown>) {
  const bindings = buildSceneBindings({
    mode: "show_dont_tell",
    novelTitle: "The Salt Road",
    chapterTitle: "Harbor",
    sceneTitle: "Docks at Dawn",
    povLabel: "Third Limited",
    tenseLabel: "Past",
    sceneContent: "Mara walked to the pier. She was nervous.",
    summary: "Mara waits for the boat.",
    codexPrompt: "<codex_context>Mara: smuggler</codex_context>",
  });
  return renderCraftPrompt(
    tool,
    filterBindingsBySlices(bindings, tool.contract.contextSlices),
    resolveToolInputs(tool, raw),
  ).messages.map((m) => m.content);
}

function expectMalformed(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("AI_INVALID_RESPONSE");
    expect((err as AiError).status).toBe(502);
    return;
  }
  throw new Error("expected a malformed-output error");
}

describe("Show Don't Tell tool (STO-1270)", () => {
  it("is a valid built-in component inside its policy ceiling", () => {
    expect(isCraftToolId("show_dont_tell")).toBe(true);
    expect(validatePromptContract(tool.contract)).toEqual(tool.contract);
    for (const slice of tool.contract.contextSlices) {
      expect(tool.allowedContextSlices).toContain(slice);
    }
    expect(tool.contract.output).toEqual({
      mode: "diagnosis_and_prose",
      suggestedAction: "replace_selection",
    });
    expect(tool.contract.inputs.map((i) => i.key)).toEqual([
      "craft.selection",
      "craft.target_words",
      "craft.instructions",
    ]);
    expect(contractReadsSlice(tool.contract, "scene.summary")).toBe(false);
  });

  it("reuses the shared scaffold system prompt and slices", () => {
    const sectioned = tool.parts[0].body.replace(
      CRAFT_SECTIONED_FORMAT_RULE,
      CRAFT_PROSE_FORMAT_RULE,
    );
    expect(sectioned).toBe(describeTool.parts[0].body);
    expect(tool.contract.contextSlices).toEqual(describeTool.contract.contextSlices);
    expect(tool.allowedContextSlices).toEqual(describeTool.allowedContextSlices);
  });

  it("exposes defaults for the editor panel", () => {
    const dto = toCraftToolDto(tool);
    expect(dto).toMatchObject({ id: "show_dont_tell", name: "Show Don't Tell" });
    expect(dto.defaults["craft.target_words"]).toBe(SHOW_DONT_TELL_DEFAULT_TARGET_WORDS);
    expect(applyCraftDefaults(tool, { "craft.selection": "x" })).toEqual({
      "craft.selection": "x",
      "craft.target_words": SHOW_DONT_TELL_DEFAULT_TARGET_WORDS,
      "craft.instructions": "None.",
    });
  });

  it("renders the diagnosis/rewrite format with selection, scene and guidance", () => {
    const [system, user] = render({
      "craft.selection": "She was nervous.",
      "craft.target_words": 80,
      "craft.instructions": "Keep it physical.",
    });
    expect(system).toContain("third limited");
    expect(system).toContain("Mara: smuggler");
    expect(user).toContain(DIAGNOSIS_MARKER);
    expect(user).toContain(REWRITE_MARKER);
    expect(user).toContain("roughly 80 words");
    expect(user).toContain("Keep it physical.");
    expect(user).toContain("She was nervous.");
    expect(user).toContain("Mara walked to the pier.");
    expect(user).not.toContain("Mara waits for the boat.");
  });

  it("keeps system and user format rules aligned (STO-1297)", () => {
    const [system, user] = render({ "craft.selection": "She was nervous." });
    expect(system).toContain(CRAFT_SECTIONED_FORMAT_RULE);
    expect(system).not.toContain(CRAFT_PROSE_FORMAT_RULE);
    expect(system.toLowerCase()).not.toContain("prose only");
    expect(user.toLowerCase()).not.toContain("prose-only");
    expect(user).not.toContain("replaces the");
    for (const id of ["describe", "expand", "rewrite"] as const) {
      const prose = getCraftTool(id);
      expect(prose.contract.output?.mode).toBe("prose");
      expect(prose.parts[0].body).toContain(CRAFT_PROSE_FORMAT_RULE);
      expect(prose.parts[0].body).not.toContain(CRAFT_SECTIONED_FORMAT_RULE);
    }
  });
});

describe("diagnosis_and_prose output parsing", () => {
  it("splits diagnosis from the applyable rewrite", () => {
    expect(
      parseDiagnosisAndProse(
        'DIAGNOSIS:\n- "nervous" is told.\n\nREWRITE:\nHer heel tapped the planks.\n',
      ),
    ).toEqual({ diagnosis: '- "nervous" is told.', text: "Her heel tapped the planks." });
  });

  it("tolerates markdown markers, preamble, fences and triple quotes", () => {
    expect(
      parseDiagnosisAndProse("Sure!\n**Diagnosis:**\n- told\n## Rewrite:\n```\nShown.\n```"),
    ).toEqual({ diagnosis: "- told", text: "Shown." });
    expect(parseDiagnosisAndProse('DIAGNOSIS: - told\nREWRITE: """Shown."""')).toEqual({
      diagnosis: "- told",
      text: "Shown.",
    });
  });

  it("drops the closing fence when the model fences the whole reply", () => {
    expect(
      parseDiagnosisAndProse("```markdown\nDIAGNOSIS:\n- told\nREWRITE:\nShown.\n```"),
    ).toEqual({ diagnosis: "- told", text: "Shown." });
  });

  it("rejects missing, duplicated, reordered, empty or oversized sections", () => {
    expectMalformed(() => parseDiagnosisAndProse("Her heel tapped."));
    expectMalformed(() => parseDiagnosisAndProse("DIAGNOSIS:\n- told\nHer heel tapped."));
    expectMalformed(() => parseDiagnosisAndProse("DIAGNOSIS:\na\nREWRITE:\nb\nREWRITE:\nc"));
    expectMalformed(() => parseDiagnosisAndProse("REWRITE:\nb\nDIAGNOSIS:\na"));
    expectMalformed(() => parseDiagnosisAndProse("DIAGNOSIS:\n\nREWRITE:\nb"));
    expectMalformed(() => parseDiagnosisAndProse("DIAGNOSIS:\na\nREWRITE:\n  "));
    expectMalformed(() =>
      parseDiagnosisAndProse(`DIAGNOSIS:\na\nREWRITE:\n${"x".repeat(MAX_CRAFT_OUTPUT_CHARS)}`),
    );
  });

  it("does not treat a mid-line mention as a section marker", () => {
    expectMalformed(() => parseDiagnosisAndProse("The diagnosis: none. REWRITE: x"));
  });

  it("shapes results per output mode", () => {
    expect(shapeCraftResult({ mode: "prose", suggestedAction: null }, " Salt. ")).toEqual({
      kind: "prose",
      text: " Salt. ",
    });
    expect(shapeCraftResult(null, "Salt.")).toEqual({ kind: "prose", text: "Salt." });
    expect(
      shapeCraftResult(
        { mode: "diagnosis_and_prose", suggestedAction: "replace_selection" },
        "DIAGNOSIS:\nd\nREWRITE:\nt",
      ),
    ).toEqual({ kind: "diagnosis_and_prose", diagnosis: "d", text: "t" });
  });
});
