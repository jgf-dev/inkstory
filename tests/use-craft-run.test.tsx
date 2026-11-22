// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as api from "../src/app/dashboard/novels/[id]/_components/api";
import { useCraftRun } from "../src/app/dashboard/novels/[id]/_components/useCraftRun";
import { useCraftTools } from "../src/app/dashboard/novels/[id]/_components/useCraftTools";

vi.mock("../src/app/dashboard/novels/[id]/_components/api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() };
});

const apiGet = vi.mocked(api.apiGet);
const apiPost = vi.mocked(api.apiPost);
const { ApiRequestError } = api;

const selection = { from: 1, to: 15, text: "The rain fell." };
const request = {
  toolId: "describe",
  sceneId: "scene-1",
  inputs: { "craft.selection": "The rain fell." },
  content: "The rain fell. Mara ran.",
  selection,
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("useCraftTools", () => {
  it("loads the catalog and tolerates a malformed body", async () => {
    apiGet.mockResolvedValueOnce({ tools: [{ id: "describe" }] });
    const { result } = renderHook(() => useCraftTools());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiGet).toHaveBeenCalledWith("/api/craft/tools");
    expect(result.current.tools).toEqual([{ id: "describe" }]);

    apiGet.mockResolvedValueOnce({});
    act(() => result.current.reload());
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tools).toEqual([]);
  });

  it("reports API and generic errors", async () => {
    apiGet.mockRejectedValueOnce(new ApiRequestError("Unauthorized", 401, null));
    const { result } = renderHook(() => useCraftTools());
    await waitFor(() => expect(result.current.error).toBe("Unauthorized"));

    apiGet.mockRejectedValueOnce(new Error("boom"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe("Failed to load craft tools"));
  });

  it("ignores a response that lands after unmount", async () => {
    let resolve!: (v: unknown) => void;
    apiGet.mockReturnValueOnce(new Promise((r) => (resolve = r)) as never);
    const { result, unmount } = renderHook(() => useCraftTools());
    unmount();
    resolve({ tools: [{ id: "late" }] });
    await Promise.resolve();
    expect(result.current.tools).toEqual([]);
  });
});

describe("useCraftRun", () => {
  it("posts the run and keeps the transient result with its selection", async () => {
    apiPost.mockResolvedValueOnce({
      tool: "describe",
      text: "Rain needled the tin roof.",
      model: "m1",
      output: { mode: "prose", suggestedAction: "replace_selection" },
    });
    const { result } = renderHook(() => useCraftRun());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.run(request);
    });
    expect(result.current.state.kind).toBe("running");
    await act(async () => pending);
    expect(apiPost).toHaveBeenCalledWith("/api/craft/describe", {
      sceneId: "scene-1",
      inputs: { "craft.selection": "The rain fell." },
      content: "The rain fell. Mara ran.",
    });
    expect(result.current.state).toEqual({
      kind: "done",
      request,
      result: {
        toolId: "describe",
        text: "Rain needled the tin roof.",
        model: "m1",
        output: { mode: "prose", suggestedAction: "replace_selection" },
        selection,
      },
    });

    act(() => result.current.reset());
    expect(result.current.state.kind).toBe("idle");
  });

  it("sends BYOK selection and normalizes a sparse response", async () => {
    apiPost.mockResolvedValueOnce({});
    const { result } = renderHook(() => useCraftRun());
    await act(() => result.current.run({ ...request, credentialId: "cred-1", model: " gpt " }));
    expect(apiPost.mock.calls[0][1]).toMatchObject({ credentialId: "cred-1", model: "gpt" });
    expect(result.current.state).toMatchObject({
      kind: "done",
      result: { toolId: "describe", text: "", model: "", output: null },
    });
  });

  it("surfaces the copyable prompt when AI is not configured", async () => {
    apiPost.mockRejectedValueOnce(
      new ApiRequestError("not configured", 503, "AI_NOT_CONFIGURED", {
        prompt: { joined: "SYSTEM…" },
      }),
    );
    const { result } = renderHook(() => useCraftRun());
    await act(() => result.current.run(request));
    expect(result.current.state).toEqual({
      kind: "not-configured",
      request,
      message: "not configured",
      prompt: "SYSTEM…",
    });

    apiPost.mockRejectedValueOnce(new ApiRequestError("nc", 503, "AI_NOT_CONFIGURED"));
    await act(() => result.current.run(request));
    expect(result.current.state).toMatchObject({ kind: "not-configured", prompt: "" });
  });

  it("maps contract and unknown errors", async () => {
    apiPost.mockRejectedValueOnce(
      new ApiRequestError("Missing required craft input: craft.selection", 422, "MISSING_INPUT"),
    );
    const { result } = renderHook(() => useCraftRun());
    await act(() => result.current.run(request));
    expect(result.current.state).toMatchObject({
      kind: "error",
      code: "MISSING_INPUT",
      message: "Missing required craft input: craft.selection",
    });

    apiPost.mockRejectedValueOnce(new TypeError("x"));
    await act(() => result.current.run(request));
    expect(result.current.state).toMatchObject({
      kind: "error",
      code: null,
      message: "Craft request failed",
    });
  });

  it("drops a superseded response or error", async () => {
    let resolveFirst!: (v: unknown) => void;
    let rejectSecond!: (e: unknown) => void;
    apiPost
      .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)) as never)
      .mockReturnValueOnce(new Promise((_r, j) => (rejectSecond = j)) as never);
    const { result } = renderHook(() => useCraftRun());
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.run(request);
    });
    act(() => {
      second = result.current.run({ ...request, toolId: "describe2" });
    });
    act(() => result.current.reset());
    await act(async () => {
      resolveFirst({ text: "stale" });
      rejectSecond(new Error("stale"));
      await first;
      await second;
    });
    expect(result.current.state.kind).toBe("idle");
  });
});
