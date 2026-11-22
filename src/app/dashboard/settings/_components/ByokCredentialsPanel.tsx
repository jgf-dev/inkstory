"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { a11yClasses } from "@/lib/ui/a11y-classes";
import type { AiProviderName, CredentialDto } from "@/lib/ai/credentials";

const PROVIDERS: { value: AiProviderName; label: string; needsKey: boolean }[] = [
  { value: "OPENROUTER", label: "OpenRouter", needsKey: true },
  { value: "OPENAI", label: "OpenAI", needsKey: true },
  { value: "ANTHROPIC", label: "Anthropic", needsKey: true },
  { value: "OLLAMA", label: "Ollama (local)", needsKey: false },
  { value: "LMSTUDIO", label: "LM Studio (local)", needsKey: false },
];

function hintDisplay(c: CredentialDto): string {
  if (!c.hasKey) return "no key";
  return c.keyHint ? `••••${c.keyHint}` : "••••";
}

/**
 * Minimal BYOK settings panel (STO-1178). Password input for the key; after
 * save only the last-4 hint is shown. Never echoes the submitted key back.
 */
export function ByokCredentialsPanel() {
  const [credentials, setCredentials] = useState<CredentialDto[]>([]);
  const [provider, setProvider] = useState<AiProviderName>("OPENROUTER");
  const [label, setLabel] = useState("default");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const needsKey = PROVIDERS.find((p) => p.value === provider)?.needsKey ?? true;

  const reload = useCallback(async () => {
    const res = await fetch("/api/ai/credentials");
    if (!res.ok) {
      setError("Could not load credentials");
      return;
    }
    const data = (await res.json()) as { credentials: CredentialDto[] };
    setCredentials(data.credentials);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      const res = await fetch("/api/ai/credentials", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          label: label.trim() || "default",
          apiKey: apiKey.trim() ? apiKey : needsKey ? apiKey : undefined,
          baseUrl: baseUrl.trim() ? baseUrl.trim() : undefined,
        }),
      });
      const data = (await res.json()) as {
        credential?: CredentialDto;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      // Clear the password field immediately — never keep plaintext in state.
      setApiKey("");
      setStatus(
        data.credential
          ? `Saved ${data.credential.provider} (${hintDisplay(data.credential)})`
          : "Saved",
      );
      await reload();
    } catch {
      setError("Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(id: string) {
    setError(null);
    const res = await fetch(`/api/ai/credentials/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Delete failed");
      return;
    }
    await reload();
  }

  return (
    <section className="border-ink-200 bg-ink-50 rounded-lg border p-5">
      <h2 className="text-lg font-semibold">API keys (BYOK)</h2>
      <p className="text-ink-500 mt-1 text-sm">
        Keys are encrypted at rest. After saving, only a short hint is shown — the key is never sent
        back to the browser.
      </p>

      <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="byok-provider" className="block text-sm font-medium">
            Provider
          </label>
          <select
            id="byok-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as AiProviderName)}
            className={a11yClasses.authField}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="byok-label" className="block text-sm font-medium">
            Label
          </label>
          <input
            id="byok-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={a11yClasses.authField}
            autoComplete="off"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="byok-key" className="block text-sm font-medium">
            API key {needsKey ? "" : "(optional)"}
          </label>
          <input
            id="byok-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={a11yClasses.authField}
            autoComplete="new-password"
            required={needsKey}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="byok-base" className="block text-sm font-medium">
            Base URL (optional)
          </label>
          <input
            id="byok-base"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className={a11yClasses.authField}
            placeholder={needsKey ? "" : "http://127.0.0.1:11434/v1"}
            autoComplete="off"
          />
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={loading}
            className="bg-ink-900 text-ink-50 hover:bg-ink-800 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {loading ? "Saving…" : "Save key"}
          </button>
        </div>
      </form>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      {status ? <p className="mt-3 text-sm text-green-800">{status}</p> : null}

      <ul className="mt-6 divide-y divide-ink-200">
        {credentials.length === 0 ? (
          <li className="text-ink-500 py-2 text-sm">No keys saved yet.</li>
        ) : (
          credentials.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <span className="font-medium">{c.provider}</span>
                <span className="text-ink-500"> · {c.label}</span>
                <span className="text-ink-500"> · {hintDisplay(c)}</span>
                {c.baseUrl ? (
                  <span className="text-ink-400 block truncate text-xs">{c.baseUrl}</span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void onDelete(c.id)}
                className="text-ink-600 hover:text-red-700 text-xs font-medium underline"
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
