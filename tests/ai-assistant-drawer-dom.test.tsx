// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AiAssistantDrawer } from "../src/app/dashboard/novels/[id]/_components/AiAssistantDrawer";

type Reply = { status: number; body: unknown };

function stubFetch(...replies: Reply[]) {
  const bodies: unknown[] = [];
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
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
});
