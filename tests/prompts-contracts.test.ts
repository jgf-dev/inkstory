import { describe, expect, it } from "vite-plus/test";
import {
  CONTEXT_SLICES,
  CRAFT_INPUT_KEYS,
  PROMPT_CONTRACT_MAX_BYTES,
  PROMPT_CONTRACT_MAX_DEPTH,
  PromptError,
  assertContextSlicesAllowed,
  bindCraftInputValue,
  buildSceneBindings,
  interpolate,
  normalizePromptContract,
  readStoredContract,
  renderDefaultScenePrompt,
  renderPrompt,
  resolveCraftInputs,
  systemDefaultParts,
  validatePromptContract,
  type PromptComponentContract,
} from "../src/lib/prompts";
import { jsonDepth } from "../src/lib/prompts/contracts";
import { handlePromptApiError } from "../src/lib/prompts/errors";

const describeContract = {
  schemaVersion: 1,
  inputs: [
    { key: "craft.selection", type: "text", required: true, label: "Selection" },
    { key: "craft.sensory_focus", type: "enum", options: ["sight", "sound", "smell"] },
    { key: "craft.target_words", type: "integer", required: true, min: 50, max: 400 },
  ],
  contextSlices: ["selection", "scene.pov", "scene.tense", "codex.context"],
  output: { mode: "prose", suggestedAction: "replace_selection" },
  attribution: { author: "Example author", license: null, source: null },
};

function expectPromptError(fn: () => unknown, code: string, status: number, message?: RegExp) {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(PromptError);
  expect(caught).toMatchObject({ code, status });
  if (message) expect((caught as Error).message).toMatch(message);
}

const sceneInput = {
  mode: "continuation" as const,
  novelTitle: "Storm Tide",
  chapterTitle: "Chapter 1",
  sceneTitle: "Quay",
  povLabel: "THIRD_LIMITED",
  tenseLabel: "PAST",
  sceneContent: "Mara reached the quay.",
  summary: "Mara arrives.",
  codexPrompt: "<codex_context/>",
};

describe("prompt component contracts (STO-1275)", () => {
  describe("registries", () => {
    it("exposes exactly the EL-approved craft inputs and context slices", () => {
      expect(CRAFT_INPUT_KEYS).toEqual([
        "craft.selection",
        "craft.instructions",
        "craft.target_words",
        "craft.sensory_focus",
        "craft.rewrite_preset",
        "craft.before_passage",
        "craft.after_passage",
        "craft.brainstorm_kind",
        "craft.brainstorm_count",
      ]);
      expect(CONTEXT_SLICES).toEqual([
        "selection",
        "scene.summary",
        "scene.content",
        "scene.title",
        "scene.pov",
        "scene.tense",
        "chapter.title",
        "novel.title",
        "codex.context",
      ]);
      expect(CONTEXT_SLICES).not.toContain("semantic");
    });
  });

  describe("validatePromptContract", () => {
    it("accepts a v1 contract and returns canonical form", () => {
      const contract = validatePromptContract(describeContract);
      expect(contract).toEqual({
        schemaVersion: 1,
        inputs: [
          { key: "craft.selection", type: "text", required: true, label: "Selection" },
          {
            key: "craft.sensory_focus",
            type: "enum",
            required: false,
            options: ["sight", "sound", "smell"],
          },
          { key: "craft.target_words", type: "integer", required: true, min: 50, max: 400 },
        ],
        contextSlices: ["selection", "scene.pov", "scene.tense", "codex.context"],
        output: { mode: "prose", suggestedAction: "replace_selection" },
        attribution: { author: "Example author", license: null, source: null },
      });
    });

    it("defaults optional sections and drops empty attribution", () => {
      expect(validatePromptContract({ schemaVersion: 1 })).toEqual({
        schemaVersion: 1,
        inputs: [],
        contextSlices: [],
        output: null,
        attribution: null,
      });
      expect(
        validatePromptContract({
          schemaVersion: 1,
          output: { mode: "options", suggestedAction: null },
          attribution: { author: "  ", license: null },
        }),
      ).toMatchObject({ output: { mode: "options", suggestedAction: null }, attribution: null });
      expect(
        validatePromptContract({ schemaVersion: 1, output: { mode: "diagnosis_and_prose" } })
          .output,
      ).toEqual({ mode: "diagnosis_and_prose", suggestedAction: null });
    });

    it("accepts every input type the registry allows", () => {
      const contract = validatePromptContract({
        schemaVersion: 1,
        inputs: [
          { key: "craft.instructions", type: "text", maxLength: 500, description: "Optional" },
          { key: "craft.rewrite_preset", type: "enum", options: ["more_vivid", "simpler"] },
          { key: "craft.brainstorm_kind", type: "text" },
          { key: "craft.brainstorm_count", type: "integer" },
          { key: "craft.before_passage", type: "text" },
          { key: "craft.after_passage", type: "text" },
        ],
      });
      expect(contract.inputs.map((i) => i.type)).toEqual([
        "text",
        "enum",
        "text",
        "integer",
        "text",
        "text",
      ]);
    });

    it("sanitizes attribution as inert display text", () => {
      const contract = validatePromptContract({
        schemaVersion: 1,
        attribution: {
          author: " Ada\u0000 Lovelace\u0007 ",
          license: "CC-BY-4.0",
          source: "https://example.com/prompts",
        },
      });
      expect(contract.attribution).toEqual({
        author: "Ada Lovelace",
        license: "CC-BY-4.0",
        source: "https://example.com/prompts",
      });
    });

    it.each([
      [null, /contract: must be an object/],
      [[], /contract: must be an object/],
      ["x", /contract: must be an object/],
      [{}, /schemaVersion: must be a positive integer/],
      [{ schemaVersion: "1" }, /schemaVersion: must be a positive integer/],
      [{ schemaVersion: 1, extra: true }, /contract\.extra: unsupported field/],
      [{ schemaVersion: 1, inputs: {} }, /inputs: must be an array/],
      [{ schemaVersion: 1, inputs: ["x"] }, /inputs\[0\]: must be an object/],
      [{ schemaVersion: 1, inputs: [{ key: "scene.content", type: "text" }] }, /inputs\[0\]\.key/],
      [
        { schemaVersion: 1, inputs: [{ key: "craft.selection", type: "url" }] },
        /inputs\[0\]\.type/,
      ],
      [
        { schemaVersion: 1, inputs: [{ key: "craft.selection", type: "integer" }] },
        /craft\.selection must be declared as: text/,
      ],
      [
        { schemaVersion: 1, inputs: [{ key: "craft.selection", type: "text", fetch: "http://x" }] },
        /inputs\[0\]\.fetch: unsupported field/,
      ],
      [
        { schemaVersion: 1, inputs: [{ key: "craft.selection", type: "text", required: "yes" }] },
        /required: must be a boolean/,
      ],
      [
        { schemaVersion: 1, inputs: [{ key: "craft.selection", type: "text", label: 5 }] },
        /label: must be a string/,
      ],
      [
        {
          schemaVersion: 1,
          inputs: [{ key: "craft.selection", type: "text", label: "x".repeat(121) }],
        },
        /label: must be at most 120/,
      ],
      [
        { schemaVersion: 1, inputs: [{ key: "craft.selection", type: "text", maxLength: 0 }] },
        /maxLength: must be between 1 and 20000/,
      ],
      [
        { schemaVersion: 1, inputs: [{ key: "craft.instructions", type: "text", maxLength: 1.5 }] },
        /maxLength: must be an integer/,
      ],
      [
        { schemaVersion: 1, inputs: [{ key: "craft.target_words", type: "integer", min: 0 }] },
        /min: must be between 1 and 5000/,
      ],
      [
        { schemaVersion: 1, inputs: [{ key: "craft.target_words", type: "integer", max: 9999 }] },
        /max: must be between 1 and 5000/,
      ],
      [
        {
          schemaVersion: 1,
          inputs: [{ key: "craft.target_words", type: "integer", min: 300, max: 100 }],
        },
        /min: must not exceed max/,
      ],
      [
        { schemaVersion: 1, inputs: [{ key: "craft.sensory_focus", type: "enum" }] },
        /options: must be a non-empty array/,
      ],
      [
        {
          schemaVersion: 1,
          inputs: [
            {
              key: "craft.sensory_focus",
              type: "enum",
              options: Array.from({ length: 33 }, (_, i) => `o${i}`),
            },
          ],
        },
        /at most 32 options/,
      ],
      [
        {
          schemaVersion: 1,
          inputs: [{ key: "craft.sensory_focus", type: "enum", options: ["{{scene.content}}"] }],
        },
        /options\[0\]: must be a lowercase identifier/,
      ],
      [
        {
          schemaVersion: 1,
          inputs: [{ key: "craft.sensory_focus", type: "enum", options: ["a", "a"] }],
        },
        /options\[1\]: duplicate option/,
      ],
      [
        {
          schemaVersion: 1,
          inputs: [{ key: "craft.rewrite_preset", type: "enum", options: ["make_it_pop"] }],
        },
        /craft\.rewrite_preset options must be from: more_vivid/,
      ],
      [
        {
          schemaVersion: 1,
          inputs: [
            { key: "craft.selection", type: "text" },
            { key: "craft.selection", type: "text" },
          ],
        },
        /inputs\[1\]\.key: duplicate input/,
      ],
      [
        {
          schemaVersion: 1,
          inputs: Array.from({ length: 10 }, () => ({ key: "craft.selection", type: "text" })),
        },
        /at most 9 inputs/,
      ],
      [{ schemaVersion: 1, contextSlices: "scene.content" }, /contextSlices: must be an array/],
      [{ schemaVersion: 1, contextSlices: ["codex.semantic"] }, /contextSlices\[0\]/],
      [{ schemaVersion: 1, contextSlices: ["selection", "selection"] }, /duplicate slice/],
      [{ schemaVersion: 1, output: "prose" }, /output: must be an object or null/],
      [{ schemaVersion: 1, output: { mode: "auto_apply" } }, /output\.mode/],
      [
        { schemaVersion: 1, output: { mode: "prose", suggestedAction: "write_scene" } },
        /output\.suggestedAction/,
      ],
      [
        { schemaVersion: 1, output: { mode: "prose", authorizeWrites: true } },
        /output\.authorizeWrites: unsupported field/,
      ],
      [{ schemaVersion: 1, attribution: "me" }, /attribution: must be an object or null/],
      [
        { schemaVersion: 1, attribution: { ownerId: "user-2" } },
        /attribution\.ownerId: unsupported field/,
      ],
      [
        { schemaVersion: 1, attribution: { source: "x".repeat(501) } },
        /attribution\.source: must be at most 500/,
      ],
    ])("rejects invalid contract %#", (raw, message) => {
      expectPromptError(() => validatePromptContract(raw), "INVALID_CONTRACT", 422, message);
    });

    it("rejects unknown schema major versions with a precise error", () => {
      expectPromptError(
        () => validatePromptContract({ schemaVersion: 2, inputs: [] }),
        "UNSUPPORTED_VERSION",
        422,
        /Unsupported contract schemaVersion 2; .*supports schemaVersion 1/,
      );
    });

    it("rejects payloads over 64 KiB before structural validation", () => {
      const big = {
        schemaVersion: 1,
        inputs: [{ key: "craft.selection", type: "text", description: "x".repeat(70_000) }],
      };
      expectPromptError(
        () => validatePromptContract(big),
        "PAYLOAD_TOO_LARGE",
        413,
        new RegExp(`maximum is ${PROMPT_CONTRACT_MAX_BYTES} bytes`),
      );
    });

    it("rejects overly deep payloads without recursing", () => {
      let deep: unknown = "leaf";
      for (let i = 0; i < 10_000; i++) deep = { nested: deep };
      expectPromptError(
        () => validatePromptContract({ schemaVersion: 1, attribution: deep }),
        "PAYLOAD_TOO_LARGE",
        413,
        /maximum depth/,
      );
      expect(jsonDepth("x")).toBe(0);
      expect(jsonDepth({ a: [1, { b: 2 }] })).toBe(3);
      expect(jsonDepth(deep)).toBe(PROMPT_CONTRACT_MAX_DEPTH + 1);
    });

    it("rejects non-serializable values", () => {
      expectPromptError(
        () => validatePromptContract({ schemaVersion: 1, n: BigInt(1) }),
        "INVALID_CONTRACT",
        422,
        /JSON-serializable/,
      );
    });

    it("rejects class instances / non-plain objects", () => {
      expectPromptError(
        () => validatePromptContract(new Date()),
        "INVALID_CONTRACT",
        422,
        /must be an object/,
      );
    });

    it("rejects prototype-polluting keys as unsupported fields", () => {
      const raw = JSON.parse('{"schemaVersion":1,"__proto__":{"admin":true}}') as unknown;
      expectPromptError(() => validatePromptContract(raw), "INVALID_CONTRACT", 422, /__proto__/);
      expect(({} as Record<string, unknown>).admin).toBeUndefined();
    });
  });

  describe("legacy null normalization", () => {
    it("normalizes undefined/null to null (legacy STO-1158 behavior)", () => {
      expect(normalizePromptContract(undefined)).toBeNull();
      expect(normalizePromptContract(null)).toBeNull();
      expect(normalizePromptContract({ schemaVersion: 1 })).not.toBeNull();
    });

    it("readStoredContract tolerates invalid stored data for display", () => {
      expect(readStoredContract(null)).toBeNull();
      expect(readStoredContract({ schemaVersion: 99 })).toBeNull();
      expect(readStoredContract(describeContract)?.inputs).toHaveLength(3);
    });
  });

  describe("resolveCraftInputs", () => {
    const contract = validatePromptContract({
      ...describeContract,
      inputs: [
        ...describeContract.inputs,
        { key: "craft.instructions", type: "text", maxLength: 10 },
      ],
    });

    it("binds supplied values as strings and optional absent inputs as empty", () => {
      expect(
        resolveCraftInputs(contract, {
          "craft.selection": "The rain.",
          "craft.target_words": 120,
          "craft.sensory_focus": "sound",
        }),
      ).toEqual({
        "craft.selection": "The rain.",
        "craft.target_words": "120",
        "craft.sensory_focus": "sound",
        "craft.instructions": "",
      });
    });

    it("fails closed with MISSING_INPUT when required inputs are missing or blank", () => {
      expectPromptError(
        () => resolveCraftInputs(contract, { "craft.selection": "   " }),
        "MISSING_INPUT",
        422,
        /Missing required craft inputs: craft\.selection, craft\.target_words/,
      );
      expectPromptError(
        () => resolveCraftInputs(contract, undefined),
        "MISSING_INPUT",
        422,
        /craft\.selection/,
      );
      const single = validatePromptContract({
        schemaVersion: 1,
        inputs: [{ key: "craft.selection", type: "text", required: true }],
      });
      expectPromptError(
        () => resolveCraftInputs(single, {}),
        "MISSING_INPUT",
        422,
        /Missing required craft input: craft\.selection$/,
      );
    });

    it("rejects undeclared keys, wrong types and out-of-range values", () => {
      expectPromptError(() => resolveCraftInputs(contract, "x"), "VALIDATION_FAILED", 422);
      expectPromptError(
        () => resolveCraftInputs(contract, { "craft.selection": "a", "scene.content": "x" }),
        "VALIDATION_FAILED",
        422,
        /scene\.content: not declared/,
      );
      const base = { "craft.selection": "a", "craft.target_words": 100 };
      for (const [patch, message] of [
        [{ "craft.selection": 5 }, /must be a string/],
        [{ "craft.target_words": "100" }, /must be an integer/],
        [{ "craft.target_words": 10 }, /between 50 and 400/],
        [{ "craft.sensory_focus": "taste" }, /must be one of: sight, sound, smell/],
        [{ "craft.instructions": "x".repeat(11) }, /at most 10 characters/],
      ] as const) {
        expectPromptError(
          () => resolveCraftInputs(contract, { ...base, ...patch }),
          "VALIDATION_FAILED",
          422,
          message,
        );
      }
    });

    it("bindCraftInputValue covers boolean and registry-default bounds", () => {
      expect(
        bindCraftInputValue({ key: "craft.selection", type: "boolean", required: false }, true),
      ).toBe("true");
      expect(
        bindCraftInputValue({ key: "craft.selection", type: "boolean", required: false }, false),
      ).toBe("false");
      expect(() =>
        bindCraftInputValue({ key: "craft.selection", type: "boolean", required: false }, "yes"),
      ).toThrow(/must be a boolean/);
      expect(() =>
        bindCraftInputValue(
          { key: "craft.brainstorm_count", type: "integer", required: false },
          21,
        ),
      ).toThrow(/between 1 and 20/);
      expect(
        bindCraftInputValue({ key: "craft.selection", type: "text", required: false }, "ok"),
      ).toBe("ok");
      expect(() =>
        bindCraftInputValue(
          { key: "craft.selection", type: "text", required: false },
          "x".repeat(20_001),
        ),
      ).toThrow(/at most 20000/);
    });
  });

  describe("context slice ceiling", () => {
    it("allows slices within the tool ceiling and rejects others", () => {
      const contract = validatePromptContract(describeContract);
      expect(() => assertContextSlicesAllowed(contract, CONTEXT_SLICES)).not.toThrow();
      expectPromptError(
        () => assertContextSlicesAllowed(contract, ["selection", "scene.pov"]),
        "FORBIDDEN",
        403,
        /slices not permitted for this tool: scene\.tense, codex\.context/,
      );
      expectPromptError(
        () => assertContextSlicesAllowed(contract, ["selection", "scene.pov", "scene.tense"]),
        "FORBIDDEN",
        403,
        /slice not permitted for this tool: codex\.context$/,
      );
    });
  });

  describe("interpolation with craft inputs", () => {
    it("leaves legacy rendering byte-for-byte unchanged without craft inputs", () => {
      const parts = systemDefaultParts("continuation");
      const bindings = buildSceneBindings(sceneInput);
      const legacy = renderPrompt(parts, bindings);
      expect(renderPrompt(parts, bindings, {})).toEqual(legacy);
      expect(legacy).not.toHaveProperty("unresolvedInputs");
      expect(renderDefaultScenePrompt(sceneInput)).toEqual(legacy);

      const result = interpolate("Rewrite {{craft.selection}} in {{novel.title}}", {
        "novel.title": "Storm",
      });
      expect(result).toEqual({
        text: "Rewrite {{craft.selection}} in Storm",
        unresolved: [],
        unknownTokens: ["craft.selection"],
      });
    });

    it("substitutes validated craft inputs and reports unbound ones", () => {
      const result = interpolate(
        "Focus {{craft.sensory_focus}} on {{ craft.selection }} ({{craft.target_words}}) {{craft.instructions}}",
        {},
        { craftInputs: { "craft.selection": "the quay", "craft.sensory_focus": "sound" } },
      );
      expect(result.text).toBe(
        "Focus sound on the quay ({{craft.target_words}}) {{craft.instructions}}",
      );
      expect(result.unresolvedInputs).toEqual(["craft.target_words", "craft.instructions"]);
      expect(result.unknownTokens).toEqual([]);
    });

    it("never recursively interpolates supplied input", () => {
      const contract = validatePromptContract({
        schemaVersion: 1,
        inputs: [{ key: "craft.selection", type: "text", required: true }],
      });
      const craftInputs = resolveCraftInputs(contract, {
        "craft.selection": "{{scene.content}} {{craft.selection}} $& $1 {{codex.context}}",
      });
      const rendered = renderPrompt(
        [{ role: "user", body: "Passage: {{craft.selection}} / {{scene.title}}" }],
        buildSceneBindings(sceneInput),
        { craftInputs },
      );
      expect(rendered.messages[0].content).toBe(
        "Passage: {{scene.content}} {{craft.selection}} $& $1 {{codex.context}} / Quay",
      );
      expect(rendered.unresolvedInputs).toEqual([]);
      expect(rendered.unknownTokens).toEqual([]);
    });

    it("renders contract-aware parts with system/user merging intact", () => {
      const contract: PromptComponentContract = validatePromptContract(describeContract);
      const craftInputs = resolveCraftInputs(contract, {
        "craft.selection": "Rain.",
        "craft.target_words": 100,
      });
      const rendered = renderPrompt(
        [
          { role: "system", body: "Write in {{scene.pov}}." },
          { role: "user", body: "Describe {{craft.selection}} in ~{{craft.target_words}} words." },
          { role: "user", body: "Missing: {{craft.brainstorm_count}}" },
        ],
        buildSceneBindings(sceneInput),
        { craftInputs },
      );
      expect(rendered.messages).toEqual([
        { role: "system", content: "Write in third_limited." },
        {
          role: "user",
          content: "Describe Rain. in ~100 words.\n\nMissing: {{craft.brainstorm_count}}",
        },
      ]);
      expect(rendered.unresolvedInputs).toEqual(["craft.brainstorm_count"]);
    });
  });

  it("handlePromptApiError maps contract errors to their status", async () => {
    const res = handlePromptApiError(
      new PromptError("Contract JSON is too large", "PAYLOAD_TOO_LARGE", 413),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: "Contract JSON is too large",
      code: "PAYLOAD_TOO_LARGE",
    });
  });
});
