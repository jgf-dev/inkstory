import { describe, expect, it } from "vite-plus/test";
import type {
  AssembledContext,
  AssembledContextEntry,
  ContextEntrySource,
} from "../src/lib/codex/context-assembler";
import { inspectAssembledContext } from "../src/lib/codex/context-inspection";
import {
  estimateFormattedEntryTokens,
  estimateWrapperTokens,
  formatAssembledContext,
} from "../src/lib/codex/prompt-formatter";
import { applyTokenBudget } from "../src/lib/codex/token-budgeter";

function entry(
  id: string,
  source: ContextEntrySource,
  description = "Hero & <friend> 漢字",
): AssembledContextEntry {
  return {
    id,
    source,
    name: id,
    type: "CHARACTER",
    description,
    aliases: ["Alias"],
    trackingMode: "detected",
    appliedProgressionIds: ["progression-1"],
    ...(source === "relation" ? { relationDepth: 2 } : {}),
  };
}
function context(entries: AssembledContextEntry[]): AssembledContext {
  return {
    entries,
    meta: {
      sceneId: "scene-1",
      finalCount: entries.length,
      totalCandidates: entries.length,
      truncated: false,
    },
  };
}

describe("request-time post-budget inspection telemetry", () => {
  it("accounts for all sources using formatted, resolved entries, with wrapper separate", () => {
    const input = context([
      entry("m", "manual"),
      entry("a", "always"),
      entry("d", "mention"),
      entry("r", "relation"),
      entry("d2", "mention"),
    ]);
    const original = structuredClone(input);
    const result = inspectAssembledContext(input, 4000);
    const { telemetry } = result.inspection;
    expect(result.entries).toEqual(input.entries);
    expect(input).toEqual(original);
    expect(telemetry.method).toBe("approximate");
    expect(telemetry.entries).toEqual(
      input.entries.map((e) => ({
        id: e.id,
        source: e.source,
        tokens: estimateFormattedEntryTokens(e),
      })),
    );
    for (const source of ["manual", "always", "mention", "relation"] as const) {
      expect(telemetry.bySource[source]).toBe(
        input.entries
          .filter((e) => e.source === source)
          .reduce((sum, e) => sum + estimateFormattedEntryTokens(e), 0),
      );
    }
    expect(telemetry.wrapperTokens).toBe(estimateWrapperTokens());
    expect(telemetry.totalTokens).toBe(
      Object.values(telemetry.bySource).reduce((a, b) => a + b, telemetry.wrapperTokens),
    );
    expect(telemetry.formattedTokens).toBeLessThanOrEqual(telemetry.totalTokens);
    expect(result.inspection.formattedContext).toContain("&amp; &lt;friend&gt; 漢字");
  });

  it("measures precisely the post-budget blocks Generate formats, never dropped or pre-truncation text", () => {
    const input = context([
      entry("huge", "always", "Long description. ".repeat(2000)),
      entry("dropped", "relation"),
    ]);
    const { inspection } = inspectAssembledContext(input, 300);
    const generated = applyTokenBudget(input, { maxTokens: 300 });
    expect(inspection.context).toEqual(generated);
    expect(inspection.formattedContext).toBe(formatAssembledContext(generated));
    expect(inspection.context.meta.truncatedEntryIds).toEqual(["huge"]);
    expect(inspection.context.meta.droppedEntryIds).toEqual(["dropped"]);
    expect(inspection.telemetry.bySource.relation).toBe(0);
    expect(inspection.telemetry.entries).toEqual([
      { id: "huge", source: "always", tokens: estimateFormattedEntryTokens(generated.entries[0]) },
    ]);
    expect(inspection.telemetry.formattedTokens).toBe(generated.meta.estimatedTokensAfter);
    expect(inspection.telemetry.formattedTokens).toBeLessThanOrEqual(300);
    expect(input.entries[0].description.length).toBeGreaterThan(
      generated.entries[0].description.length,
    );
  });

  it("keeps zero source counts and wrapper overhead for empty contexts and too-small budgets", () => {
    for (const input of [context([]), context([entry("a", "always")])]) {
      const { inspection } = inspectAssembledContext(input, 0);
      expect(inspection.context.entries).toEqual([]);
      expect(inspection.telemetry.entries).toEqual([]);
      expect(inspection.telemetry.bySource).toEqual({
        manual: 0,
        always: 0,
        mention: 0,
        relation: 0,
      });
      expect(inspection.telemetry.totalTokens).toBe(estimateWrapperTokens());
      expect(inspection.formattedContext).toBe(formatAssembledContext(context([])));
    }
  });
});
