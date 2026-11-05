import { describe, expect, it } from "vite-plus/test";
import {
  buildSceneBindings,
  interpolate,
  renderDefaultScenePrompt,
  renderPrompt,
  tidyInterpolatedText,
} from "../src/lib/prompts";

describe("prompt interpolate (STO-1158)", () => {
  it("substitutes closed-catalog tokens", () => {
    const result = interpolate("Hello {{novel.title}} / {{scene.title}}", {
      "novel.title": "Storm",
      "scene.title": "Quay",
    });
    expect(result.text).toBe("Hello Storm / Quay");
    expect(result.unresolved).toEqual([]);
    expect(result.unknownTokens).toEqual([]);
  });

  it("leaves unknown tokens in place and reports them", () => {
    const result = interpolate("X {{custom.var}} Y", { "novel.title": "A" });
    expect(result.text).toContain("{{custom.var}}");
    expect(result.unknownTokens).toEqual(["custom.var"]);
  });

  it("treats undefined bindings as unresolved (keeps raw token)", () => {
    const result = interpolate("{{scene.summary}}", {});
    expect(result.text).toBe("{{scene.summary}}");
    expect(result.unresolved).toContain("scene.summary");
  });

  it("allows empty-string bindings (optional sections)", () => {
    const result = interpolate("Beat:{{beat.text}}:end", { "beat.text": "" });
    expect(result.text).toBe("Beat::end");
    expect(result.unresolved).toEqual([]);
  });

  it("tidy removes empty beat/summary/prose blocks", () => {
    const raw = [
      "Intro",
      "",
      'Beat to realize:\n"""\n\n"""\n',
      'Scene summary:\n"""\n\n"""\n',
      "Outro",
    ].join("\n");
    const tidied = tidyInterpolatedText(raw);
    expect(tidied).not.toContain("Beat to realize");
    expect(tidied).not.toContain("Scene summary");
    expect(tidied).toContain("Intro");
    expect(tidied).toContain("Outro");
  });
});

describe("renderDefaultScenePrompt parity with historical prompts", () => {
  const base = {
    mode: "continuation" as const,
    novelTitle: "Storm Tide",
    chapterTitle: "Chapter 1",
    sceneTitle: "The Quay",
    povLabel: "Third person limited",
    tenseLabel: "Past",
    sceneContent: "Mara reached the quay.",
    summary: null,
    beatText: null as string | null,
    codexPrompt:
      "<codex_context>\n<story_bible>\n<entity type='CHARACTER'>Mara</entity>\n</story_bible>\n</codex_context>",
  };

  it("embeds codex + pov/tense in system message", () => {
    const { messages } = renderDefaultScenePrompt(base);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("third person limited");
    expect(messages[0].content).toContain("past tense");
    expect(messages[0].content).toContain("<entity type='CHARACTER'>Mara</entity>");
    expect(messages[1].content).toContain("Mara reached the quay.");
    expect(messages[1].content).not.toContain("Beat to realize");
  });

  it("includes beat text for beat_expansion", () => {
    const { messages, joined } = renderDefaultScenePrompt({
      ...base,
      mode: "beat_expansion",
      beatText: "Mara confronts the harbormaster.",
    });
    expect(messages[1].content).toContain("Beat to realize:");
    expect(messages[1].content).toContain("Mara confronts the harbormaster.");
    expect(joined).toContain("--- system ---");
    expect(joined).toContain("--- user ---");
  });

  it("truncates overlong prose from the tail", () => {
    const long = "a".repeat(12_000);
    const { messages } = renderDefaultScenePrompt({
      ...base,
      sceneContent: long,
      maxContentChars: 8000,
    });
    expect(messages[1].content).toContain("earlier text omitted");
    expect(messages[1].content).toContain("a".repeat(8000));
  });

  it("buildSceneBindings covers the frozen catalog", () => {
    const bindings = buildSceneBindings(base);
    expect(bindings["novel.title"]).toBe("Storm Tide");
    expect(bindings["scene.pov"]).toBe("third person limited");
    expect(bindings.mode).toBe("continuation");
  });

  it("renderPrompt concatenates adjacent same-role parts", () => {
    const rendered = renderPrompt(
      [
        { role: "system", body: "A {{novel.title}}" },
        { role: "system", body: "B" },
        { role: "user", body: "C" },
      ],
      buildSceneBindings(base),
    );
    expect(rendered.messages).toHaveLength(2);
    expect(rendered.messages[0].content).toContain("A Storm Tide");
    expect(rendered.messages[0].content).toContain("B");
    expect(rendered.messages[1].content).toBe("C");
  });

  it("treats null bindings as unresolved", () => {
    const result = interpolate("{{scene.summary}}", { "scene.summary": null as any });
    expect(result.text).toBe("{{scene.summary}}");
    expect(result.unresolved).toContain("scene.summary");
  });

  it("checks catalog tokens and emptyBindings", async () => {
    const { isPromptVariableToken, emptyBindings } = await import("../src/lib/prompts/catalog");
    expect(isPromptVariableToken("novel.title")).toBe(true);
    expect(isPromptVariableToken("invalid.token")).toBe(false);
    expect(emptyBindings()["novel.title"]).toBe("");
  });
});
