import { describe, expect, it } from "vite-plus/test";
import {
  PORTABLE_COMPONENT_MAX_BYTES,
  PromptError,
  classifyBodyTokens,
  parsePortableEnvelope,
  parsePortableText,
  previewPortableComponent,
  readPortableJson,
  toPortableEnvelope,
  validatePromptContract,
  type PromptComponentDto,
} from "../src/lib/prompts";

const contract = validatePromptContract({
  schemaVersion: 1,
  inputs: [
    { key: "craft.selection", type: "text", required: true },
    { key: "craft.rewrite_preset", type: "enum", options: ["more_vivid", "simpler"] },
  ],
  contextSlices: ["selection", "scene.pov"],
  output: { mode: "prose", suggestedAction: "replace_selection" },
  attribution: { author: "Jane Writer", license: "CC-BY-4.0", source: "Workshop notes" },
});

const dto: PromptComponentDto = {
  id: "11111111-2222-3333-4444-555555555555",
  name: "Rewrite helper",
  description: "Rewrites a passage",
  body: "Rewrite {{craft.selection}} ({{craft.rewrite_preset}}) in {{scene.pov}}.",
  role: "USER",
  contract,
  ownerId: "user-secret-owner",
  updatedAt: "2026-11-10T09:00:00",
};

function envelope(component: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { format: "inkstory.prompt-component", formatVersion: 1, component, ...extra };
}

function expectError(fn: () => unknown, code: string, status: number, message?: RegExp) {
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

describe("portable prompt components (STO-1275)", () => {
  it("exports component data only — no ids, owner, timestamps", () => {
    const exported = toPortableEnvelope(dto);
    expect(exported).toEqual({
      format: "inkstory.prompt-component",
      formatVersion: 1,
      component: {
        name: dto.name,
        description: dto.description,
        body: dto.body,
        role: "USER",
        contract,
      },
    });
    const json = JSON.stringify(exported);
    expect(json).not.toContain(dto.id);
    expect(json).not.toContain("user-secret-owner");
    expect(json).not.toContain("updatedAt");
    expect(json).not.toContain("ownerId");
  });

  it("exports legacy components with a null contract", () => {
    const exported = toPortableEnvelope({ ...dto, contract: null, description: null });
    expect(exported.component.contract).toBeNull();
    expect(exported.component.description).toBeNull();
  });

  it("round-trips declared semantics and attribution", () => {
    const text = JSON.stringify(toPortableEnvelope(dto));
    const parsed = parsePortableText(text);
    expect(parsed).toEqual({
      name: dto.name,
      description: dto.description,
      body: dto.body,
      role: "USER",
      contract,
    });
    expect(JSON.stringify(toPortableEnvelope({ ...parsed }))).toBe(text);
  });

  it("defaults role to SYSTEM and description/contract to null", () => {
    expect(parsePortableEnvelope(envelope({ name: "  Plain  ", body: "Hi" }))).toEqual({
      name: "Plain",
      description: null,
      body: "Hi",
      role: "SYSTEM",
      contract: null,
    });
  });

  it.each([
    [null, /expected a JSON object/],
    [[], /expected a JSON object/],
    [{ format: "sillytavern", formatVersion: 1, component: {} }, /format must be/],
    [{ format: "inkstory.prompt-component", component: {} }, /formatVersion must be a positive/],
    [envelope({ name: "x", body: "y" }, { exportedBy: "me@example.com" }), /top-level field/],
    [{ format: "inkstory.prompt-component", formatVersion: 1, component: "x" }, /component must/],
    [envelope({ name: "", body: "y" }), /component\.name is required/],
    [envelope({ name: 5, body: "y" }), /component\.name is required/],
    [envelope({ name: "x" }), /component\.body must be a string/],
    [envelope({ name: "x", body: "y", description: 3 }), /description must be a string or null/],
    [envelope({ name: "x", body: "y", role: "ADMIN" }), /role must be one of: SYSTEM, USER/],
    [envelope({ name: "x", body: "y", id: "abc" }), /component\.id is not allowed/],
    [envelope({ name: "x", body: "y", ownerId: null }), /component\.ownerId is not allowed/],
    [envelope({ name: "x", body: "y", novelId: "n1" }), /component\.novelId is not allowed/],
    [envelope({ name: "x", body: "y", scope: "SYSTEM_DEFAULT" }), /component\.scope/],
    [envelope({ name: "x", body: "y", apiKey: "sk-123" }), /component\.apiKey is not allowed/],
  ])("rejects invalid envelope %#", (raw, message) => {
    expectError(() => parsePortableEnvelope(raw), "INVALID_PORTABLE", 422, message);
  });

  it("rejects unknown envelope major versions with a precise error", () => {
    expectError(
      () => parsePortableEnvelope({ ...envelope({ name: "x", body: "y" }), formatVersion: 2 }),
      "UNSUPPORTED_VERSION",
      422,
      /Unsupported inkstory\.prompt-component formatVersion 2; .*supports formatVersion 1/,
    );
  });

  it("rejects contracts smuggling URLs, secrets or unknown capabilities", () => {
    expectError(
      () =>
        parsePortableEnvelope(
          envelope({
            name: "x",
            body: "y",
            contract: {
              schemaVersion: 1,
              inputs: [{ key: "craft.selection", type: "text", binding: "env.OPENAI_API_KEY" }],
            },
          }),
        ),
      "INVALID_CONTRACT",
      422,
      /inputs\[0\]\.binding: unsupported field/,
    );
    expectError(
      () =>
        parsePortableEnvelope(
          envelope({
            name: "x",
            body: "y",
            contract: { schemaVersion: 1, fetch: { url: "https://evil.example" } },
          }),
        ),
      "INVALID_CONTRACT",
      422,
      /contract\.fetch: unsupported field/,
    );
    expectError(
      () =>
        parsePortableEnvelope(envelope({ name: "x", body: "y", contract: { schemaVersion: 3 } })),
      "UNSUPPORTED_VERSION",
      422,
    );
  });

  it("enforces the whole-file size cap and surfaces JSON syntax errors", () => {
    const huge = JSON.stringify(
      envelope({ name: "x", body: "y".repeat(PORTABLE_COMPONENT_MAX_BYTES) }),
    );
    expectError(() => readPortableJson(huge), "PAYLOAD_TOO_LARGE", 413, /maximum is 262144/);
    expect(() => parsePortableText("{not json")).toThrow(SyntaxError);
  });

  it("classifies body tokens", () => {
    expect(
      classifyBodyTokens("{{scene.title}} {{craft.selection}} {{custom.var}} {{scene.title}}"),
    ).toEqual({
      catalog: ["scene.title"],
      craftInputs: ["craft.selection"],
      unknown: ["custom.var"],
    });
  });

  it("previews features and warnings without persisting", () => {
    const parsed = parsePortableEnvelope(
      envelope({
        name: "Preview me",
        body: "Use {{craft.selection}} and {{craft.instructions}} and {{secret.key}}",
        role: "USER",
        contract: {
          schemaVersion: 1,
          inputs: [
            { key: "craft.selection", type: "text", required: true },
            { key: "craft.target_words", type: "integer" },
          ],
          contextSlices: ["selection"],
          output: { mode: "options", suggestedAction: "copy_only" },
          attribution: { author: "A" },
        },
      }),
    );
    const preview = previewPortableComponent(parsed);
    expect(preview.features).toEqual({
      inputs: [
        { key: "craft.selection", type: "text", required: true },
        { key: "craft.target_words", type: "integer", required: false },
      ],
      contextSlices: ["selection"],
      output: { mode: "options", suggestedAction: "copy_only" },
      attribution: { author: "A", license: null, source: null },
    });
    expect(preview.bodyTokens).toEqual({
      catalog: [],
      craftInputs: ["craft.selection", "craft.instructions"],
      unknown: ["secret.key"],
    });
    expect(preview.warnings).toEqual([
      "{{craft.instructions}} is used in the body but not declared as a contract input; it will be left as literal text",
      "{{secret.key}} is not a supported variable; it will be left as literal text",
      "Declared input craft.target_words is not referenced in the body",
    ]);
  });

  it("previews a legacy component without a contract", () => {
    const preview = previewPortableComponent(
      parsePortableEnvelope(envelope({ name: "Legacy", body: "{{novel.title}}" })),
    );
    expect(preview.features).toEqual({
      inputs: [],
      contextSlices: [],
      output: null,
      attribution: null,
    });
    expect(preview.bodyTokens.catalog).toEqual(["novel.title"]);
    expect(preview.warnings).toEqual([]);
  });
});
