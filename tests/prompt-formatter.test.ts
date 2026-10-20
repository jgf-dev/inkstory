import { describe, expect, it } from "vite-plus/test";
import type { AssembledContext, AssembledContextEntry } from "../src/lib/codex/context-assembler";
import {
  estimateFormattedContextTokens,
  formatAssembledContext,
} from "../src/lib/codex/prompt-formatter";
import { estimateTokens } from "../src/lib/codex/tokens";

function makeEntry(
  overrides: Partial<AssembledContextEntry> & { id: string; name: string },
): AssembledContextEntry {
  return {
    type: "CHARACTER",
    aliases: [],
    description: "",
    trackingMode: "detected",
    source: "mention",
    appliedProgressionIds: [],
    ...overrides,
  };
}

function makeContext(entries: AssembledContextEntry[]): AssembledContext {
  return {
    entries,
    meta: {
      totalCandidates: entries.length,
      finalCount: entries.length,
      truncated: false,
      sceneId: "scene-1",
    },
  };
}

describe("PromptFormatter", () => {
  it("wraps ranked entities in <codex_context><story_bible> XML", () => {
    const context = makeContext([
      makeEntry({
        id: "entry-1",
        name: "Elara",
        type: "CHARACTER",
        trackingMode: "always",
        source: "always",
        aliases: ["El", "The Weaver"],
        description: "An archmage of the Emberfall tower.",
      }),
      makeEntry({
        id: "entry-2",
        name: "Emberfall",
        type: "LOCATION",
        source: "relation",
        relationDepth: 2,
        description: "A city built into a dormant volcano.",
      }),
    ]);

    const output = formatAssembledContext(context);

    expect(output).toContain("<codex_context>");
    expect(output).toContain("<story_bible>");
    expect(output).toContain("</story_bible>");
    expect(output).toContain("</codex_context>");
    expect(output).toContain(
      '<entity id="entry-1" type="CHARACTER" name="Elara" source="always" tracking="always">',
    );
    expect(output).toContain("<aliases>El, The Weaver</aliases>");
    expect(output).toContain("<description>An archmage of the Emberfall tower.</description>");
    expect(output).toContain('depth="2"');
    // Fixed attribute order and ranked order are preserved.
    expect(output.indexOf("entry-1")).toBeLessThan(output.indexOf("entry-2"));
  });

  it("omits empty aliases and descriptions", () => {
    const output = formatAssembledContext(makeContext([makeEntry({ id: "e", name: "Ghost" })]));
    expect(output).toContain(
      '<entity id="e" type="CHARACTER" name="Ghost" source="mention" tracking="detected">',
    );
    expect(output).not.toContain("<aliases>");
    expect(output).not.toContain("<description>");
    expect(output).toContain("</entity>\n");
  });

  it("only emits the depth attribute for relation entries", () => {
    const output = formatAssembledContext(
      makeContext([
        makeEntry({ id: "a", name: "Seed", source: "always" }),
        makeEntry({ id: "b", name: "Hop", source: "relation", relationDepth: 1 }),
      ]),
    );
    expect(output).toContain(
      '<entity id="a" type="CHARACTER" name="Seed" source="always" tracking="detected">',
    );
    expect(output).toContain(
      '<entity id="b" type="CHARACTER" name="Hop" source="relation" tracking="detected" depth="1">',
    );
    expect(output.match(/depth="/g)).toHaveLength(1);
  });

  it("escapes XML-significant characters in values", () => {
    const output = formatAssembledContext(
      makeContext([
        makeEntry({
          id: "e&1",
          name: 'A "<B>&</B>" Name',
          aliases: ["Tom's & Jerry"],
          description: 'Line with <tags> & "quotes" & apostrophe\'s.',
        }),
      ]),
    );
    expect(output).toContain('id="e&amp;1"');
    expect(output).toContain('name="A &quot;&lt;B&gt;&amp;&lt;/B&gt;&quot; Name"');
    expect(output).toContain("<aliases>Tom&apos;s &amp; Jerry</aliases>");
    expect(output).toContain(
      "<description>Line with &lt;tags&gt; &amp; &quot;quotes&quot; &amp; apostrophe&apos;s.</description>",
    );
  });

  it("is deterministic for the same context", () => {
    const context = makeContext([
      makeEntry({ id: "a", name: "Elara", description: "Archmage" }),
      makeEntry({ id: "b", name: "Emberfall", type: "LOCATION" }),
    ]);
    expect(formatAssembledContext(context)).toBe(formatAssembledContext(context));
  });

  it("renders an empty story bible without entity blocks", () => {
    const output = formatAssembledContext(makeContext([]));
    expect(output).toBe(
      `<codex_context>\n${
        "The following story bible is canonical reference for the current scene. " +
        "Honor entry names, aliases, descriptions, and relationships exactly as written."
      }\n<story_bible>\n</story_bible>\n</codex_context>`,
    );
    expect(estimateFormattedContextTokens(makeContext([]))).toBe(estimateTokens(output));
  });

  it("reports the estimated token cost of the formatted prompt", () => {
    const context = makeContext([makeEntry({ id: "a", name: "Elara", description: "Archmage" })]);
    expect(estimateFormattedContextTokens(context)).toBe(
      estimateTokens(formatAssembledContext(context)),
    );
  });
});
