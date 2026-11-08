// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AiAssistantDrawer } from "../src/app/dashboard/novels/[id]/_components/AiAssistantDrawer";

type Reply = { status: number; body: unknown };

function stubFetch(...replies: Reply[]) {
  const bodies: unknown[] = [];
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === "GET")
      return { ok: true, text: async () => JSON.stringify({ credentials: [] }) } as Response;
    bodies.push(JSON.parse(init.body as string));
    const r = replies.shift() ?? { status: 200, body: { text: "fallback", model: "m" } };
    return {
      ok: r.status < 300,
      status: r.status,
      text: async () => JSON.stringify(r.body),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return { fn, bodies };
}

function setup() {
  const onInsertText = vi.fn();
  const onClose = vi.fn();
  render(
    React.createElement(AiAssistantDrawer, {
      sceneId: "scene-1",
      content: "She waited.",
      onClose,
      onInsertText,
    }),
  );
  return { onInsertText, onClose };
}

const draftBox = () => screen.getByLabelText("Generated prose (editable)") as HTMLTextAreaElement;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AiAssistantDrawer post-generation controls (STO-1174)", () => {
  it("lets the author edit the draft and accept the edited text", async () => {
    stubFetch({ status: 200, body: { text: "The tide turned.", model: "m1" } });
    const { onInsertText } = setup();
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-result");
    expect(draftBox().value).toBe("The tide turned.");
    expect(screen.queryByText("Revert edits")).toBeNull();

    fireEvent.change(draftBox(), { target: { value: "The tide turned at last." } });
    expect(screen.getByText(/· edited/)).toBeTruthy();
    fireEvent.click(screen.getByText("Accept & append"));

    expect(onInsertText).toHaveBeenCalledWith("The tide turned at last.");
    expect(screen.queryByTestId("ai-result")).toBeNull();
    expect(screen.getByTestId("ai-accepted")).toBeTruthy();
  });

  it("reverts edits back to the generated text", async () => {
    stubFetch({ status: 200, body: { text: "Original.", model: "m1" } });
    setup();
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-result");
    fireEvent.change(draftBox(), { target: { value: "Changed." } });
    fireEvent.click(screen.getByText("Revert edits"));
    expect(draftBox().value).toBe("Original.");
    expect(screen.queryByText("Revert edits")).toBeNull();
  });

  it("regenerates with the same request and replaces the draft", async () => {
    const { bodies } = stubFetch(
      { status: 200, body: { text: "First take.", model: "m1" } },
      { status: 200, body: { text: "Second take.", model: "m2" } },
    );
    setup();
    fireEvent.change(screen.getByPlaceholderText(/Optional direction/), {
      target: { value: "end on a decision" },
    });
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-result");
    fireEvent.change(draftBox(), { target: { value: "edited first" } });

    fireEvent.click(screen.getByText("Regenerate"));
    await waitFor(() => expect(draftBox().value).toBe("Second take."));
    expect(screen.getByText(/Generated with m2/)).toBeTruthy();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[0]).toMatchObject({
      sceneId: "scene-1",
      mode: "continuation",
      beatText: "end on a decision",
      content: "She waited.",
    });
  });

  it("keeps the previous draft when regeneration fails", async () => {
    stubFetch(
      { status: 200, body: { text: "Keep me.", model: "m1" } },
      { status: 502, body: { error: "AI gateway request failed", code: "AI_GATEWAY_ERROR" } },
    );
    setup();
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-result");
    fireEvent.click(screen.getByText("Regenerate"));
    await screen.findByText("AI gateway request failed");
    expect(draftBox().value).toBe("Keep me.");
  });

  it("discards the draft without inserting", async () => {
    stubFetch({ status: 200, body: { text: "Nope.", model: "m1" } });
    const { onInsertText } = setup();
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-result");
    fireEvent.click(screen.getByText("Discard"));
    expect(screen.queryByTestId("ai-result")).toBeNull();
    expect(screen.queryByTestId("ai-accepted")).toBeNull();
    expect(onInsertText).not.toHaveBeenCalled();
  });

  it("disables accept when the draft is emptied", async () => {
    stubFetch({ status: 200, body: { text: "Something.", model: "m1" } });
    const { onInsertText } = setup();
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-result");
    fireEvent.change(draftBox(), { target: { value: "   " } });
    const accept = screen.getByText("Accept & append") as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    fireEvent.click(accept);
    expect(onInsertText).not.toHaveBeenCalled();
  });

  it("copies the edited draft", async () => {
    stubFetch({ status: 200, body: { text: "Copy me.", model: "m1" } });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup();
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-result");
    fireEvent.change(draftBox(), { target: { value: "Copy me, edited." } });
    fireEvent.click(screen.getByText("Copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Copy me, edited."));
    await screen.findByText("Copied");
  });

  it("previews the prompt and renders messages, warnings, and allows copying preview", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    stubFetch({
      status: 200,
      body: {
        messages: [
          { role: "system", content: "You are an author's assistant." },
          { role: "user", content: "Continue the scene." },
        ],
        joined:
          "--- system ---\nYou are an author's assistant.\n\n--- user ---\nContinue the scene.",
        unresolved: ["novel.custom"],
        unknownTokens: ["bad.token"],
        prompt: {
          id: "sys-prompt-continuation",
          name: "Scene continuation (system default)",
          scope: "SYSTEM_DEFAULT",
          mode: "continuation",
        },
      },
    });

    setup();
    fireEvent.click(screen.getByText("Preview prompt"));

    await screen.findByTestId("ai-prompt-preview");
    expect(
      screen.getByText(/Preview of “Scene continuation \(system default\)” \(SYSTEM_DEFAULT\)/),
    ).toBeTruthy();
    expect(screen.getByText(/Unresolved: novel\.custom, bad\.token/)).toBeTruthy();
    expect(screen.getByText("You are an author's assistant.")).toBeTruthy();
    expect(screen.getByText("Continue the scene.")).toBeTruthy();

    const copyButtons = screen.getAllByRole("button", { name: "Copy" });
    fireEvent.click(copyButtons[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("You are an author's assistant."));
    await screen.findByText("Copied");
  });

  it("displays error when prompt preview fails", async () => {
    stubFetch({
      status: 500,
      body: { error: "Preview generation failed" },
    });

    setup();
    fireEvent.click(screen.getByText("Preview prompt"));

    await screen.findByText("Preview generation failed");
  });
});

describe("AiAssistantDrawer explicit BYOK selection (STO-1159)", () => {
  function withCredentials(failLoad = false) {
    const bodies: Record<string, unknown>[] = [];
    const fn = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "GET") {
        return new Response(
          JSON.stringify(
            failLoad
              ? { error: "Unavailable" }
              : {
                  credentials: [
                    { id: "saved", provider: "OPENAI", label: "Personal", keyHint: "1234" },
                    { id: "local", provider: "OLLAMA", label: "", keyHint: null },
                  ],
                },
          ),
          { status: failLoad ? 500 : 200 },
        );
      }
      bodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ text: "BYOK draft", model: "chosen-model" }));
    });
    vi.stubGlobal("fetch", fn);
    return { fn, bodies };
  }

  it("defaults to platform; sends only selected credential ID/model, including regeneration", async () => {
    const { bodies } = withCredentials();
    setup();
    await screen.findByRole("option", { name: "OPENAI — Personal 1234" });
    const provider = screen.getByLabelText("Generation provider") as HTMLSelectElement;
    expect(provider.value).toBe("");
    expect(screen.queryByLabelText("Provider model ID")).toBeNull();
    fireEvent.change(provider, { target: { value: "saved" } });
    expect((screen.getByText("Generate") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Provider model ID"), {
      target: { value: "  my-model  " },
    });
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-result");
    fireEvent.click(screen.getByText("Regenerate"));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0]).toEqual({
      sceneId: "scene-1",
      mode: "continuation",
      content: "She waited.",
      credentialId: "saved",
      model: "my-model",
    });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(JSON.stringify(bodies)).not.toContain("keyHint");
    expect(JSON.stringify(bodies)).not.toContain("apiKey");
  });

  it("resets model when switching credentials and explicitly returns to platform", async () => {
    const { bodies } = withCredentials();
    setup();
    await screen.findByRole("option", { name: "OLLAMA — Default" });
    const provider = screen.getByLabelText("Generation provider");
    fireEvent.change(provider, { target: { value: "saved" } });
    fireEvent.change(screen.getByLabelText("Provider model ID"), { target: { value: "model-a" } });
    fireEvent.change(provider, { target: { value: "local" } });
    expect((screen.getByLabelText("Provider model ID") as HTMLInputElement).value).toBe("");
    expect((screen.getByText("Generate") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(provider, { target: { value: "" } });
    expect(screen.queryByLabelText("Provider model ID")).toBeNull();
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-result");
    expect(bodies[0]).toEqual({ sceneId: "scene-1", mode: "continuation", content: "She waited." });
  });

  it("leaves platform available and explains credential-load failures", async () => {
    const { bodies } = withCredentials(true);
    setup();
    await screen.findByText(/Saved credentials could not be loaded/);
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-result");
    expect(bodies[0]).not.toHaveProperty("credentialId");
  });

  it("disables selection/model changes during generation", async () => {
    const { fn } = withCredentials();
    setup();
    await screen.findByRole("option", { name: "OPENAI — Personal 1234" });
    fireEvent.change(screen.getByLabelText("Generation provider"), { target: { value: "saved" } });
    fireEvent.change(screen.getByLabelText("Provider model ID"), { target: { value: "m" } });
    let finish!: (value: Response) => void;
    fn.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByText("Generate"));
    expect((screen.getByLabelText("Generation provider") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Provider model ID") as HTMLInputElement).disabled).toBe(true);
    finish(new Response(JSON.stringify({ text: "Done", model: "m" })));
    await screen.findByTestId("ai-result");
    expect((screen.getByLabelText("Generation provider") as HTMLSelectElement).disabled).toBe(
      false,
    );
  });
});
