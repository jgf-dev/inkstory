"use client";

import { useCallback, useEffect, useState } from "react";

interface PromptSummary {
  id: string;
  name: string;
  mode: string;
  scope: string;
  description: string | null;
}

/**
 * Minimal SYSTEM_DEFAULT listing with Duplicate-to-library (STO-1158).
 */
export function SystemPromptsPanel() {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/prompts?includeSystem=true");
      const body = (await res.json()) as { prompts?: PromptSummary[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to load prompts");
      setPrompts((body.prompts ?? []).filter((p) => p.scope === "SYSTEM_DEFAULT"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prompts");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function duplicate(id: string) {
    setBusyId(id);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/prompts/${id}/duplicate`, { method: "POST" });
      const body = (await res.json()) as { prompt?: PromptSummary; error?: string };
      if (!res.ok) throw new Error(body.error || "Duplicate failed");
      setMessage(`Duplicated “${body.prompt?.name ?? "prompt"}” into your library.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Duplicate failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section data-testid="system-prompts-panel" className="border-ink-200 rounded-lg border p-5">
      <h2 className="text-lg font-semibold text-ink-900">System prompts</h2>
      <p className="text-ink-500 mt-1 text-sm">
        Shipped defaults are read-only. Duplicate one into your library to customize it.
      </p>

      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
        >
          {message}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {prompts.map((p) => (
          <li
            key={p.id}
            className="border-ink-200 flex items-start justify-between gap-3 rounded-md border bg-ink-50 px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-ink-900">{p.name}</p>
              <p className="text-ink-500 text-xs">
                mode: {p.mode}
                {p.description ? ` — ${p.description}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void duplicate(p.id)}
              disabled={busyId === p.id}
              className="shrink-0 rounded border border-ink-300 bg-white px-2 py-1 text-xs font-medium text-ink-800 hover:bg-ink-100 disabled:opacity-50"
            >
              {busyId === p.id ? "Duplicating…" : "Duplicate to my library"}
            </button>
          </li>
        ))}
        {prompts.length === 0 && !error && (
          <li className="text-ink-400 text-sm">No system defaults found yet.</li>
        )}
      </ul>
    </section>
  );
}
