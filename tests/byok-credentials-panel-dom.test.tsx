// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ByokCredentialsPanel } from "../src/app/dashboard/settings/_components/ByokCredentialsPanel";
import type { CredentialDto } from "../src/lib/ai/credentials";

const mockCredentials: CredentialDto[] = [
  {
    id: "cred-1",
    provider: "OPENROUTER",
    label: "default",
    keyHint: "abcd",
    hasKey: true,
    baseUrl: "https://openrouter.ai/api/v1",
    updatedAt: "2026-11-05T00:00:00Z",
  },
  {
    id: "cred-2",
    provider: "OLLAMA",
    label: "local",
    keyHint: null,
    hasKey: false,
    baseUrl: "http://127.0.0.1:11434/v1",
    updatedAt: "2026-11-05T00:00:00Z",
  },
];

describe("ByokCredentialsPanel (STO-1178)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it("renders empty state when no credentials exist", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ credentials: [] }),
    });

    render(React.createElement(ByokCredentialsPanel));

    expect(screen.getByText("API keys (BYOK)")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("No keys saved yet.")).toBeTruthy();
    });
  });

  it("renders credentials list with hint display and baseUrl", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ credentials: mockCredentials }),
    });

    render(React.createElement(ByokCredentialsPanel));

    await waitFor(() => {
      expect(screen.getByText("OPENROUTER")).toBeTruthy();
      expect(screen.getByText("OLLAMA")).toBeTruthy();
      expect(screen.getByText(/••••abcd/)).toBeTruthy();
      expect(screen.getByText(/no key/)).toBeTruthy();
      expect(screen.getByText("https://openrouter.ai/api/v1")).toBeTruthy();
    });
  });

  it("shows error if loading credentials fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Server error" }),
    });

    render(React.createElement(ByokCredentialsPanel));

    await waitFor(() => {
      expect(screen.getByText("Could not load credentials")).toBeTruthy();
    });
  });

  it("submits a new cloud provider credential and clears key input on success", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            credential: {
              id: "cred-new",
              provider: "OPENAI",
              label: "custom-label",
              keyHint: "9999",
              hasKey: true,
              baseUrl: null,
              updatedAt: "2026-11-05T00:00:00Z",
            },
          }),
        });
      }
      callCount++;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          credentials:
            callCount > 1
              ? [
                  ...mockCredentials,
                  {
                    id: "cred-new",
                    provider: "OPENAI",
                    label: "custom-label",
                    keyHint: "9999",
                    hasKey: true,
                    baseUrl: null,
                    updatedAt: "2026-11-05T00:00:00Z",
                  },
                ]
              : mockCredentials,
        }),
      });
    });
    globalThis.fetch = fetchMock;

    render(React.createElement(ByokCredentialsPanel));

    await waitFor(() => {
      expect(screen.getByText("OPENROUTER")).toBeTruthy();
    });

    // Select OPENAI
    const providerSelect = screen.getByLabelText("Provider");
    fireEvent.change(providerSelect, { target: { value: "OPENAI" } });

    // Enter label
    const labelInput = screen.getByLabelText("Label") as HTMLInputElement;
    fireEvent.change(labelInput, { target: { value: "custom-label" } });

    // Enter API key
    const keyInput = screen.getByLabelText(/API key/) as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "sk-openai-secret-9999" } });

    // Submit form
    const submitBtn = screen.getByRole("button", { name: "Save key" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(keyInput.value).toBe("");
      expect(screen.getByText(/Saved OPENAI \(••••9999\)/)).toBeTruthy();
    });
  });

  it("allows saving a local provider without an API key", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            credential: {
              id: "cred-ollama",
              provider: "OLLAMA",
              label: "default",
              keyHint: null,
              hasKey: false,
              baseUrl: "http://localhost:11434/v1",
              updatedAt: "2026-11-05T00:00:00Z",
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ credentials: [] }),
      });
    });
    globalThis.fetch = fetchMock;

    render(React.createElement(ByokCredentialsPanel));

    await waitFor(() => {
      expect(screen.getByText("No keys saved yet.")).toBeTruthy();
    });

    // Switch to OLLAMA
    const providerSelect = screen.getByLabelText("Provider");
    fireEvent.change(providerSelect, { target: { value: "OLLAMA" } });

    // Key input should have (optional) in label
    expect(screen.getByLabelText(/API key \(optional\)/)).toBeTruthy();

    const baseUrlInput = screen.getByLabelText(/Base URL/) as HTMLInputElement;
    fireEvent.change(baseUrlInput, { target: { value: "http://localhost:11434/v1" } });

    const submitBtn = screen.getByRole("button", { name: "Save key" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Saved OLLAMA \(no key\)/)).toBeTruthy();
    });
  });

  it("displays error message when saving fails", async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: "Invalid key format" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ credentials: [] }),
      });
    });

    render(React.createElement(ByokCredentialsPanel));

    await waitFor(() => {
      expect(screen.getByText("No keys saved yet.")).toBeTruthy();
    });

    const keyInput = screen.getByLabelText(/API key/) as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "bad-key" } });

    const submitBtn = screen.getByRole("button", { name: "Save key" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Invalid key format")).toBeTruthy();
    });
  });

  it("handles network error when saving", async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Promise.reject(new Error("Network disconnect"));
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ credentials: [] }),
      });
    });

    render(React.createElement(ByokCredentialsPanel));

    await waitFor(() => {
      expect(screen.getByText("No keys saved yet.")).toBeTruthy();
    });

    const keyInput = screen.getByLabelText(/API key/) as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "some-key" } });

    const submitBtn = screen.getByRole("button", { name: "Save key" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Save failed")).toBeTruthy();
    });
  });

  it("removes a credential when delete button is clicked", async () => {
    let credentials = [...mockCredentials];
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        credentials = credentials.filter((c) => !url.includes(c.id));
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "cred-1", deleted: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ credentials }),
      });
    });

    render(React.createElement(ByokCredentialsPanel));

    await waitFor(() => {
      expect(screen.getByText("OPENROUTER")).toBeTruthy();
    });

    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText("OPENROUTER")).toBeNull();
      expect(screen.getByText("OLLAMA")).toBeTruthy();
    });
  });

  it("displays error banner when delete fails", async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: "Cannot delete" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ credentials: mockCredentials }),
      });
    });

    render(React.createElement(ByokCredentialsPanel));

    await waitFor(() => {
      expect(screen.getByText("OPENROUTER")).toBeTruthy();
    });

    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Cannot delete")).toBeTruthy();
    });
  });
});
