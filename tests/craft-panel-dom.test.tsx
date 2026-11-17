// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { CraftPanel } from "../src/app/dashboard/novels/[id]/_components/CraftPanel";
import { listCraftTools, toCraftToolDto } from "../src/lib/craft";

const DESCRIBE = toCraftToolDto(listCraftTools()[0]);
const EXPANDish = {
  ...DESCRIBE,
  id: "copyer",
  name: "Copyer",
  summary: "A second tool with a boolean and no selection",
  contract: {
    ...DESCRIBE.contract,
    inputs: [{ key: "craft.brainstorm_kind", type: "boolean", required: false, label: "Wild" }],
    output: { mode: "options", suggestedAction: "copy_only" },
  },
  defaults: {},
};

const selection = { from: 1, to: 15, text: "The rain fell." };

type Route = (url: string, init?: RequestInit) => { status: number; body: unknown } | undefined;

function stubFetch(route: Route) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const reply = route(url, init) ?? { status: 200, body: {} };
    return {
      ok: reply.status < 300,
      status: reply.status,
      text: async () => JSON.stringify(reply.body),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

function baseRoute(extra?: Route, tools: unknown[] = [DESCRIBE]): Route {
  return (url, init) => {
    const custom = extra?.(url, init);
    if (custom) return custom;
    if (url === "/api/craft/tools") return { status: 200, body: { tools } };
    if (url === "/api/ai/credentials")
      return {
        status: 200,
        body: {
          credentials: [
            { id: "cred-1", provider: "openai", label: "", keyHint: "…abcd" },
            { id: "cred-2", provider: "anthropic", label: "Work", keyHint: null },
          ],
        },
      };
    return undefined;
  };
}

function setup(overrides: Partial<React.ComponentProps<typeof CraftPanel>> = {}) {
  const props = {
    sceneId: "scene-1",
    content: "The rain fell. Mara ran.",
    selection,
    excludeFromAi: false,
    onApply: vi.fn().mockResolvedValue({ ok: true }),
    onClose: vi.fn(),
    ...overrides,
  };
  const utils = render(React.createElement(CraftPanel, props));
  return { props, ...utils };
}

const describeButton = () => screen.getByRole("button", { name: "Describe" });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CraftPanel (STO-1290)", () => {
  it("renders the Describe form from the contract with defaults", async () => {
    stubFetch(baseRoute());
    const { props } = setup();
    expect(await screen.findByTestId("craft-tool-name")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect((screen.getByLabelText("Sensory focus") as unknown as HTMLSelectElement).value).toBe(
      "any",
    );
    expect(screen.getByText("Smell")).toBeTruthy();
    expect((screen.getByLabelText("Target length (words)") as HTMLInputElement).value).toBe("150");
    expect(screen.getByText("Target length (words) (10–1,000)")).toBeTruthy();
    expect(screen.getByTestId("craft-selection").textContent).toContain("The rain fell.");
    expect(screen.getByTestId("craft-selection").textContent).toContain("3 words");
    expect(describeButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByLabelText("Close craft panel"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("asks for a selection, flags bad input and truncates long previews", async () => {
    stubFetch(baseRoute());
    const { rerender, props } = setup({ selection: null });
    await screen.findByTestId("craft-tool-name");
    expect(screen.getByText("Select a passage in the scene to describe it.")).toBeTruthy();
    expect(describeButton().hasAttribute("disabled")).toBe(true);

    const long = { from: 1, to: 400, text: "word ".repeat(80) };
    rerender(React.createElement(CraftPanel, { ...props, selection: long }));
    expect(screen.getByTestId("craft-selection").textContent).toContain("…");

    fireEvent.change(screen.getByLabelText("Target length (words)"), { target: { value: "5" } });
    expect(screen.getByText(/must be a whole number from 10 to 1,000/)).toBeTruthy();
    expect(describeButton().hasAttribute("disabled")).toBe(true);
  });

  it("disables runs when the scene is excluded from AI", async () => {
    stubFetch(baseRoute());
    setup({ excludeFromAi: true });
    await screen.findByTestId("craft-tool-name");
    expect(screen.getByText(/excluded from AI assistance/)).toBeTruthy();
    expect(describeButton().hasAttribute("disabled")).toBe(true);
  });

  it("runs Describe, lets the author edit, and applies via onApply", async () => {
    const calls = stubFetch(
      baseRoute((url) =>
        url === "/api/craft/describe"
          ? {
              status: 200,
              body: {
                tool: "describe",
                text: "Rain needled the tin roof.",
                model: "m1",
                output: { mode: "prose", suggestedAction: "replace_selection" },
              },
            }
          : undefined,
      ),
    );
    const { props } = setup();
    await screen.findByTestId("craft-tool-name");
    fireEvent.change(screen.getByLabelText("Sensory focus"), { target: { value: "sound" } });
    fireEvent.change(screen.getByLabelText("Extra guidance"), { target: { value: " cold " } });
    fireEvent.click(describeButton());
    await screen.findByTestId("craft-result");

    const post = calls.find((c) => c.url === "/api/craft/describe");
    expect(post?.body).toEqual({
      sceneId: "scene-1",
      content: "The rain fell. Mara ran.",
      inputs: {
        "craft.selection": "The rain fell.",
        "craft.sensory_focus": "sound",
        "craft.target_words": 150,
        "craft.instructions": "cold",
      },
    });
    const box = screen.getByLabelText("Craft result (editable)") as HTMLTextAreaElement;
    expect(box.value).toBe("Rain needled the tin roof.");
    expect(screen.getByText(/5 words \(target ~150\) · m1/)).toBeTruthy();

    fireEvent.change(box, { target: { value: "Rain needled the roof." } });
    expect(screen.getByText(/· edited/)).toBeTruthy();
    fireEvent.click(screen.getByText("Revert edits"));
    expect(box.value).toBe("Rain needled the tin roof.");
    fireEvent.change(box, { target: { value: "Rain needled the roof." } });

    fireEvent.click(screen.getByText("Replace selection"));
    await screen.findByTestId("craft-notice");
    expect(props.onApply).toHaveBeenCalledWith(selection, "Rain needled the roof.");
    expect(screen.getByTestId("craft-notice").textContent).toContain("checkpoint");
    expect(screen.queryByTestId("craft-result")).toBeNull();
  });

  it("keeps the result and explains when apply fails", async () => {
    stubFetch(
      baseRoute((url) =>
        url === "/api/craft/describe"
          ? {
              status: 200,
              body: {
                text: "Rain.",
                model: "m1",
                output: { mode: "prose", suggestedAction: "replace_selection" },
              },
            }
          : undefined,
      ),
    );
    setup({ onApply: vi.fn().mockResolvedValue({ ok: false, message: "Passage changed." }) });
    await screen.findByTestId("craft-tool-name");
    fireEvent.click(describeButton());
    await screen.findByTestId("craft-result");
    fireEvent.click(screen.getByText("Replace selection"));
    await waitFor(() =>
      expect(screen.getByTestId("craft-notice").textContent).toBe("Passage changed."),
    );
    expect(screen.getByTestId("craft-result")).toBeTruthy();
  });

  it("copies, regenerates the same request, and discards", async () => {
    let n = 0;
    const calls = stubFetch(
      baseRoute((url) =>
        url === "/api/craft/describe"
          ? {
              status: 200,
              body: {
                text: `Take ${++n}.`,
                model: "m",
                output: { mode: "prose", suggestedAction: "replace_selection" },
              },
            }
          : undefined,
      ),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    setup();
    await screen.findByTestId("craft-tool-name");
    fireEvent.click(describeButton());
    await screen.findByDisplayValue("Take 1.");

    await act(async () => {
      fireEvent.click(screen.getByText("Copy"));
    });
    expect(writeText).toHaveBeenCalledWith("Take 1.");
    expect(screen.getByText("Copied")).toBeTruthy();

    fireEvent.click(screen.getByText("Regenerate"));
    await screen.findByDisplayValue("Take 2.");
    const posts = calls.filter((c) => c.url === "/api/craft/describe");
    expect(posts[1].body).toEqual(posts[0].body);

    fireEvent.click(screen.getByText("Discard"));
    expect(screen.queryByTestId("craft-result")).toBeNull();
  });

  it("reports a copy failure", async () => {
    stubFetch(
      baseRoute((url) =>
        url === "/api/craft/describe"
          ? { status: 200, body: { text: "T.", model: "m", output: null } }
          : undefined,
      ),
    );
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error()) },
    });
    setup();
    await screen.findByTestId("craft-tool-name");
    fireEvent.click(describeButton());
    await screen.findByTestId("craft-result");
    // No replace action without a replace_selection hint.
    expect(screen.queryByText("Replace selection")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByText("Copy"));
    });
    expect(screen.getByTestId("craft-notice").textContent).toContain("Copy failed");
  });

  it("shows contract errors and the not-configured prompt", async () => {
    let mode: "422" | "503" = "422";
    stubFetch(
      baseRoute((url) => {
        if (url !== "/api/craft/describe") return undefined;
        return mode === "422"
          ? { status: 422, body: { error: "Invalid craft input", code: "VALIDATION_FAILED" } }
          : {
              status: 503,
              body: { error: "AI off", code: "AI_NOT_CONFIGURED", prompt: { joined: "PROMPT" } },
            };
      }),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    setup();
    await screen.findByTestId("craft-tool-name");
    fireEvent.click(describeButton());
    expect((await screen.findByTestId("craft-error")).textContent).toBe("Invalid craft input");

    mode = "503";
    fireEvent.click(describeButton());
    await screen.findByTestId("craft-not-configured");
    expect(screen.getByText("AI off")).toBeTruthy();
    expect(screen.getByText("PROMPT")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("Copy prompt"));
    });
    expect(writeText).toHaveBeenCalledWith("PROMPT");
  });

  it("uses a saved BYOK credential once a model is entered", async () => {
    const calls = stubFetch(
      baseRoute((url) =>
        url === "/api/craft/describe"
          ? { status: 200, body: { text: "T.", model: "gpt", output: null } }
          : undefined,
      ),
    );
    setup();
    await screen.findByTestId("craft-tool-name");
    await screen.findByText(/openai — Default/);
    expect(screen.getByText(/anthropic — Work/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Craft provider"), { target: { value: "cred-1" } });
    expect(describeButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("craft-byok-hint").textContent).toContain("model ID");
    fireEvent.change(screen.getByLabelText("Craft model ID"), { target: { value: " gpt " } });
    expect(screen.queryByTestId("craft-byok-hint")).toBeNull();
    fireEvent.click(describeButton());
    await screen.findByTestId("craft-result");
    expect(calls.find((c) => c.url === "/api/craft/describe")?.body).toMatchObject({
      credentialId: "cred-1",
      model: "gpt",
    });
  });

  it("keeps result/draft on failed Regenerate, disables Regenerate when excluded, and locks target header to the run", async () => {
    let failNext = false;
    stubFetch(
      baseRoute((url) => {
        if (url !== "/api/craft/describe") return undefined;
        return failNext
          ? { status: 500, body: { error: "Temporary outage" } }
          : {
              status: 200,
              body: {
                tool: "describe",
                text: "Initial rain.",
                model: "m1",
                output: { mode: "prose", suggestedAction: "replace_selection" },
              },
            };
      }),
    );
    const { rerender, props } = setup();
    await screen.findByTestId("craft-tool-name");
    fireEvent.click(describeButton());
    await screen.findByDisplayValue("Initial rain.");

    // Editing form target words later should not rewrite the result header for the prior run.
    fireEvent.change(screen.getByLabelText("Target length (words)"), { target: { value: "300" } });
    expect(screen.getByTestId("craft-result").textContent).toContain("(target ~150)");
    expect(screen.getByTestId("craft-result").textContent).not.toContain("(target ~300)");

    // Author edits the draft, then Regenerate fails -> error shows, draft & result stay intact.
    const box = screen.getByLabelText("Craft result (editable)") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Author-edited rain." } });
    failNext = true;
    fireEvent.click(screen.getByText("Regenerate"));
    expect((await screen.findByTestId("craft-error")).textContent).toBe("Temporary outage");
    expect((screen.getByLabelText("Craft result (editable)") as HTMLTextAreaElement).value).toBe(
      "Author-edited rain.",
    );

    // Turning on excludeFromAi disables Regenerate.
    rerender(React.createElement(CraftPanel, { ...props, excludeFromAi: true }));
    expect(screen.getByText("Regenerate").hasAttribute("disabled")).toBe(true);
  });

  it("uses theme-aware card/primary tokens on form controls and result textarea", async () => {
    stubFetch(
      baseRoute((url) =>
        url === "/api/craft/describe"
          ? {
              status: 200,
              body: { tool: "describe", text: "Rain.", model: "m1", output: null },
            }
          : undefined,
      ),
    );
    setup();
    await screen.findByTestId("craft-tool-name");
    expect(screen.getByLabelText("Sensory focus").className).toContain("bg-card");
    expect(screen.getByLabelText("Sensory focus").className).not.toContain("bg-white");
    fireEvent.click(describeButton());
    const box = await screen.findByLabelText("Craft result (editable)");
    expect(box.className).toContain("bg-card");
    expect(box.className).toContain("text-primary");
    expect(box.className).not.toContain("bg-white");
  });

  it("lists several tools, switches forms and renders boolean inputs", async () => {
    stubFetch(baseRoute(undefined, [DESCRIBE, EXPANDish]));
    setup();
    expect(await screen.findByRole("tablist")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Copyer" }));
    expect(screen.getByTestId("craft-tool-name").textContent).toBe("Copyer");
    expect(screen.queryByTestId("craft-selection")).toBeNull();
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(box.checked).toBe(true);
  });

  it("handles a tools load failure with retry, and an empty catalog", async () => {
    let fail = true;
    stubFetch((url) => {
      if (url === "/api/craft/tools") {
        return fail
          ? { status: 500, body: { error: "DB down" } }
          : { status: 200, body: { tools: [] } };
      }
      if (url === "/api/ai/credentials") return { status: 500, body: {} };
      return undefined;
    });
    setup();
    expect(await screen.findByText("DB down")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByText("Retry"));
    expect(await screen.findByText("No craft tools are available.")).toBeTruthy();
  });
});
