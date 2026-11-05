// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SystemPromptsPanel } from "../src/app/dashboard/settings/_components/SystemPromptsPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SystemPromptsPanel (STO-1158)", () => {
  it("loads and displays system prompts", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/prompts?includeSystem=true")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            prompts: [
              {
                id: "sys-1",
                name: "Scene continuation (system default)",
                mode: "continuation",
                scope: "SYSTEM_DEFAULT",
                description: "Default continuation",
              },
              {
                id: "user-1",
                name: "User Prompt",
                mode: "continuation",
                scope: "USER",
                description: null,
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error("Unknown route"));
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<SystemPromptsPanel />);

    await screen.findByText("Scene continuation (system default)");
    expect(screen.getByText(/Default continuation/)).toBeTruthy();
    // User prompt should be filtered out
    expect(screen.queryByText("User Prompt")).toBeNull();
  });

  it("duplicates a system prompt into user library", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/prompts?includeSystem=true")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            prompts: [
              {
                id: "sys-1",
                name: "Scene continuation (system default)",
                mode: "continuation",
                scope: "SYSTEM_DEFAULT",
                description: null,
              },
            ],
          }),
        });
      }
      if (url.includes("/api/prompts/sys-1/duplicate") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            prompt: {
              id: "copy-1",
              name: "Scene continuation (system default) (copy)",
              mode: "continuation",
              scope: "USER",
            },
          }),
        });
      }
      return Promise.reject(new Error("Unknown route"));
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<SystemPromptsPanel />);

    const btn = await screen.findByRole("button", { name: "Duplicate to my library" });
    fireEvent.click(btn);

    await screen.findByRole("status");
    expect(
      screen.getByText(
        /Duplicated “Scene continuation \(system default\) \(copy\)” into your library\./,
      ),
    ).toBeTruthy();
  });

  it("handles duplicate API errors", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, _init?: RequestInit) => {
      if (url.includes("/api/prompts?includeSystem=true")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            prompts: [
              {
                id: "sys-1",
                name: "Scene continuation",
                mode: "continuation",
                scope: "SYSTEM_DEFAULT",
                description: null,
              },
            ],
          }),
        });
      }
      if (url.includes("/api/prompts/sys-1/duplicate")) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: "Duplicate limit reached" }),
        });
      }
      return Promise.reject(new Error("Unknown route"));
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<SystemPromptsPanel />);

    const btn = await screen.findByRole("button", { name: "Duplicate to my library" });
    fireEvent.click(btn);

    await screen.findByText("Duplicate limit reached");
  });

  it("handles prompt list load failure", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Server error" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<SystemPromptsPanel />);

    await screen.findByText("Server error");
  });
});
