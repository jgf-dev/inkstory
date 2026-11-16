import { describe, expect, it } from "vite-plus/test";
import {
  SELECTION_INPUT_KEY,
  buildCraftInputs,
  formInputs,
  initialFormValues,
  integerBounds,
  optionLabel,
  textMaxLength,
  usesSelection,
  validateCraftForm,
  type CraftToolDto,
} from "../src/lib/craft/client";
import { listCraftTools, toCraftToolDto } from "../src/lib/craft";
import { plainTextToInsertContent } from "../src/lib/writing/tiptap";

const describeTool = toCraftToolDto(listCraftTools()[0]) as CraftToolDto;

/** Synthetic tool exercising every input type (future tools reuse the same form). */
const kitchenSink: CraftToolDto = {
  id: "sink",
  name: "Sink",
  summary: "All input types",
  contract: {
    schemaVersion: 1,
    inputs: [
      { key: "craft.instructions", type: "text", required: true, label: "Guidance" },
      { key: "craft.brainstorm_count", type: "integer", required: true },
      { key: "craft.rewrite_preset", type: "enum", required: false, options: ["simpler"] },
      { key: "craft.brainstorm_kind", type: "boolean" as never, required: false },
      { key: "craft.before_passage", type: "text", required: false, maxLength: 5 },
    ] as CraftToolDto["contract"]["inputs"],
    contextSlices: ["scene.content"],
    output: { mode: "options", suggestedAction: "copy_only" },
    attribution: null,
  },
  defaults: { "craft.rewrite_preset": "unknown", "craft.brainstorm_kind": true },
  allowedContextSlices: ["scene.content"],
};

describe("craft client helpers (STO-1290)", () => {
  it("reads the Describe contract from the served DTO", () => {
    expect(describeTool.id).toBe("describe");
    expect(usesSelection(describeTool)).toBe(true);
    expect(usesSelection(kitchenSink)).toBe(false);
    expect(formInputs(describeTool).map((i) => i.key)).toEqual([
      "craft.sensory_focus",
      "craft.target_words",
      "craft.instructions",
    ]);
  });

  it("prefills enum/integer defaults but leaves free text blank", () => {
    expect(initialFormValues(describeTool)).toEqual({
      "craft.sensory_focus": "any",
      "craft.target_words": "150",
      "craft.instructions": "",
    });
    expect(initialFormValues(kitchenSink)).toEqual({
      "craft.instructions": "",
      "craft.brainstorm_count": "",
      "craft.rewrite_preset": "simpler",
      "craft.brainstorm_kind": true,
      "craft.before_passage": "",
    });
  });

  it("falls back to an empty enum when there are no options", () => {
    const tool = {
      ...kitchenSink,
      contract: {
        ...kitchenSink.contract,
        inputs: [{ key: "craft.rewrite_preset", type: "enum", required: false, options: [] }],
      },
      defaults: {},
    } as CraftToolDto;
    expect(initialFormValues(tool)).toEqual({ "craft.rewrite_preset": "" });
  });

  it("derives bounds from the contract inside the registry ceiling", () => {
    const [, target, guidance] = formInputs(describeTool);
    expect(integerBounds(target)).toEqual({ min: 10, max: 1000 });
    expect(integerBounds(kitchenSink.contract.inputs[1])).toEqual({ min: 1, max: 20 });
    expect(textMaxLength(guidance)).toBe(1000);
    expect(textMaxLength(kitchenSink.contract.inputs[0])).toBe(2000);
    expect(textMaxLength(kitchenSink.contract.inputs[4])).toBe(5);
    expect(textMaxLength(describeTool.contract.inputs[0])).toBe(20_000);
    expect(integerBounds(describeTool.contract.inputs[0])).toEqual({
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });
  });

  it("validates selection, required, bounds, enum and length like the server", () => {
    const values = initialFormValues(describeTool);
    expect(validateCraftForm(describeTool, values, "  ")).toEqual([
      { key: SELECTION_INPUT_KEY, message: "Select some prose in the scene first." },
    ]);
    expect(validateCraftForm(describeTool, values, "The rain fell.")).toEqual([]);
    // Blank optional integer is fine (server default applies).
    expect(validateCraftForm(describeTool, { ...values, "craft.target_words": "" }, "x")).toEqual(
      [],
    );
    for (const bad of ["9", "1001", "12.5", "lots"]) {
      const problems = validateCraftForm(
        describeTool,
        { ...values, "craft.target_words": bad },
        "x",
      );
      expect(problems[0].message).toBe(
        "Target length (words) must be a whole number from 10 to 1,000.",
      );
    }
    expect(
      validateCraftForm(describeTool, { ...values, "craft.sensory_focus": "telepathy" }, "x")[0]
        .message,
    ).toBe("Sensory focus has an unknown option.");
    expect(
      validateCraftForm(describeTool, { ...values, "craft.instructions": "a".repeat(1001) }, "x")[0]
        .message,
    ).toBe("Extra guidance is too long (1,001 / 1,000 characters).");
    expect(validateCraftForm(describeTool, values, "a".repeat(20_001))[0].key).toBe(
      SELECTION_INPUT_KEY,
    );

    const sinkProblems = validateCraftForm(kitchenSink, initialFormValues(kitchenSink), "");
    expect(sinkProblems.map((p) => p.message)).toEqual([
      "Guidance is required.",
      "craft.brainstorm_count is required.",
    ]);
  });

  it("builds request inputs: verbatim selection, numbers, trimmed text, blanks omitted", () => {
    const values = {
      ...initialFormValues(describeTool),
      "craft.target_words": " 220 ",
      "craft.instructions": "  lean on smell  ",
    };
    expect(buildCraftInputs(describeTool, values, " The rain fell. ")).toEqual({
      "craft.selection": " The rain fell. ",
      "craft.sensory_focus": "any",
      "craft.target_words": 220,
      "craft.instructions": "lean on smell",
    });
    expect(buildCraftInputs(describeTool, { "craft.instructions": "" }, "x")).toEqual({
      "craft.selection": "x",
    });
    expect(
      buildCraftInputs(
        kitchenSink,
        { "craft.brainstorm_kind": false, "craft.before_passage": "b" },
        "",
      ),
    ).toEqual({ "craft.brainstorm_kind": false, "craft.before_passage": "b" });
  });

  it("labels enum options for display", () => {
    expect(optionLabel("sight")).toBe("Sight");
    expect(optionLabel("more_vivid")).toBe("More vivid");
    expect(optionLabel("__")).toBe("__");
  });
});

describe("plainTextToInsertContent", () => {
  it("keeps one block inline (with hard breaks) and splits blank-line blocks", () => {
    expect(plainTextToInsertContent("")).toEqual([]);
    expect(plainTextToInsertContent(42 as unknown as string)).toEqual([]);
    expect(plainTextToInsertContent("  Rain hissed.\n")).toEqual([
      { type: "text", text: "Rain hissed." },
    ]);
    expect(plainTextToInsertContent("One\r\nTwo")).toEqual([
      { type: "text", text: "One" },
      { type: "hardBreak" },
      { type: "text", text: "Two" },
    ]);
    expect(plainTextToInsertContent("First.\n\nSecond.")).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "First." }] },
      { type: "paragraph", content: [{ type: "text", text: "Second." }] },
    ]);
  });
});
