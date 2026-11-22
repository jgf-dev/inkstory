// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AiAssistantDrawer } from "../src/app/dashboard/novels/[id]/_components/AiAssistantDrawer";

const minP = {
  id: "minP",
  label: "Min-P",
  usable: true,
  availability: "available",
  support: "native",
  reason: "Supported by the deepinfra/turbo endpoint.",
};
const dry = {
  id: "dry",
  label: "DRY repetition penalty",
  usable: false,
  availability: "unsupported",
  support: "unsupported",
  reason: "Not supported by OpenRouter.",
};

function stub(opts: { usable: unknown[]; unavailable: unknown[]; capabilitiesFail?: boolean }) {
  const posts: Array<{ url: string; body: any }> = [];
  const gets: string[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === "GET") {
      gets.push(url);
      if (url.startsWith("/api/ai/credentials")) {
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              credentials: [{ id: "c1", provider: "OPENROUTER", label: "Mine", keyHint: "1234" }],
            }),
        } as Response;
      }
      if (opts.capabilitiesFail) {
        return { ok: false, status: 500, text: async () => "{}" } as Response;
      }
      return {
        ok: true,
        text: async () =>
          JSON.stringify({ capabilities: { usable: opts.usable, unavailable: opts.unavailable } }),
      } as Response;
    }
    posts.push({ url, body: JSON.parse(init.body as string) });
    const body = url.includes("preview")
      ? {
          messages: [{ role: "system", content: "Sys <avoidance_guidance>" }],
          joined: "",
          unresolved: [],
          unknownTokens: [],
          prompt: { id: "p", name: "Default", scope: "SYSTEM_DEFAULT", mode: "continuation" },
        }
      : {
          text: "Prose.",
          model: "served",
          applied: {
            provider: "openrouter",
            requestedModel: "x/y",
            model: "served",
            endpoint: null,
            parameters: { max_tokens: 1024, min_p: 0.1 },
            routing: { requireParameters: true, only: null },
            avoidanceGuidance: "included",
          },
        };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return { posts, gets };
}

function setup() {
  render(
    React.createElement(AiAssistantDrawer, {
      sceneId: "scene-1",
      content: "She waited.",
      onClose: vi.fn(),
      onInsertText: vi.fn(),
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AiAssistantDrawer advanced controls (STO-1265)", () => {
  it("shows Min-P only when usable, lists unavailable controls with reasons, and sends controls", async () => {
    const { posts, gets } = stub({ usable: [minP], unavailable: [dry] });
    setup();
    await waitFor(() => expect(screen.getByRole("option", { name: /OPENROUTER/ })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Generation provider"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("Provider model ID"), { target: { value: "x/y" } });
    const input = (await screen.findByLabelText(
      "Min-P",
      {},
      { timeout: 2000 },
    )) as HTMLInputElement;
    expect(gets.some((g) => g.includes("credentialId=c1") && g.includes("model=x%2Fy"))).toBe(true);
    expect(
      screen.getByText(/Not supported by this API\/model\. Not supported by OpenRouter\./),
    ).toBeTruthy();

    fireEvent.change(input, { target: { value: "5" } });
    expect(screen.getByText(/Min-P must be a number from 0 to 1\./)).toBeTruthy();
    expect((screen.getByText("Generate") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "0.1" } });
    fireEvent.change(screen.getByLabelText("Avoidance / anti-trope guidance (instructions)"), {
      target: { value: " no chosen ones " },
    });
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-applied");
    expect(screen.getByTestId("ai-applied").textContent).toMatch(
      /min_p 0\.1 .*require_parameters .*avoidance guidance included \(not enforced\)/,
    );
    expect(posts[0].body).toMatchObject({
      credentialId: "c1",
      model: "x/y",
      minP: 0.1,
      avoidanceGuidance: "no chosen ones",
    });

    fireEvent.click(screen.getByText("Preview prompt"));
    await screen.findByTestId("ai-prompt-preview");
    expect(posts[1].body.avoidanceGuidance).toBe("no chosen ones");
    expect(posts[1].body).not.toHaveProperty("minP");
  });

  it("never sends an untouched or unavailable Min-P", async () => {
    const { posts } = stub({
      usable: [],
      unavailable: [
        { ...minP, usable: false, availability: "unverified", reason: "Not verified." },
      ],
    });
    setup();
    await screen.findByTestId("ai-unavailable-controls", {}, { timeout: 2000 });
    expect(screen.queryByLabelText("Min-P")).toBeNull();
    expect(screen.getByText(/Support not verified for this route\. Not verified\./)).toBeTruthy();
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-result");
    expect(posts[0].body).not.toHaveProperty("minP");
    expect(posts[0].body).not.toHaveProperty("avoidanceGuidance");
  });

  it("marks a draft Min-P inactive when the route loses support", async () => {
    const replies = [
      { usable: [minP], unavailable: [] },
      { usable: [], unavailable: [] },
    ];
    const fn = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === "GET") {
        if (url.startsWith("/api/ai/credentials")) {
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                credentials: [{ id: "c1", provider: "OPENROUTER", label: "Mine" }],
              }),
          } as Response;
        }
        const r = replies.length > 1 ? replies.shift()! : replies[0];
        return { ok: true, text: async () => JSON.stringify({ capabilities: r }) } as Response;
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ text: "x", model: "m" }),
      } as Response;
    });
    vi.stubGlobal("fetch", fn);
    setup();
    const input = await screen.findByLabelText("Min-P", {}, { timeout: 2000 });
    fireEvent.change(input, { target: { value: "0.2" } });
    fireEvent.change(screen.getByLabelText("Generation provider"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("Provider model ID"), { target: { value: "a/b" } });
    await screen.findByText(/Min-P is set but unavailable/, {}, { timeout: 2000 });
  });

  it("degrades quietly when capabilities can't be loaded", async () => {
    stub({ usable: [], unavailable: [], capabilitiesFail: true });
    setup();
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByLabelText("Min-P")).toBeNull();
    expect(screen.queryByTestId("ai-unavailable-controls")).toBeNull();
    expect(screen.getByLabelText("Avoidance / anti-trope guidance (instructions)")).toBeTruthy();
  });
});
