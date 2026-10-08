"use client";

import { useState } from "react";
import type { GenerationMode } from "@/lib/ai/generate";
import { apiPost, ApiRequestError } from "./api";

export interface AiAssistantDrawerProps {
  sceneId: string;
  /** Current (possibly unsaved) scene prose, used for prompt freshness. */
  content: string;
  onClose: () => void;
  onInsertText: (text: string) => void;
}

interface PromptPreview {
  system: string;
  user: string;
}

interface GenerateSuccess {
  text: string;
  model: string;
}

type GenerateOutcome =
  | { kind: "generated"; result: GenerateSuccess }
  | { kind: "not-configured"; prompt: PromptPreview; message: string };

const MODE_LABELS: Record<GenerationMode, string> = {
  continuation: "Continue scene",
  beat_expansion: "Expand beat",
};

/**
 * AI Assistant drawer (launch phase 3): generates scene continuations or beat
 * expansions from the assembled Codex context. Without a configured gateway
 * the drawer degrades gracefully to a copyable prompt builder (503
 * `AI_NOT_CONFIGURED` still returns the assembled prompt).
 */
export function AiAssistantDrawer({
  sceneId,
  content,
  onClose,
  onInsertText,
}: AiAssistantDrawerProps) {
  const [mode, setMode] = useState<GenerationMode>("continuation");
  const [beatText, setBeatText] = useState("");
  const [outcome, setOutcome] = useState<GenerateOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<GenerateSuccess & { prompt?: PromptPreview; code?: string }>(
        "/api/ai/generate",
        { sceneId, mode, beatText: beatText || undefined, content: content || undefined },
      );
      setOutcome({ kind: "generated", result: { text: res.text, model: res.model } });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.status === 503 && err.code === "AI_NOT_CONFIGURED") {
          const body = (err.body ?? {}) as { prompt?: PromptPreview };
          setOutcome({
            kind: "not-configured",
            prompt: body.prompt ?? { system: "", user: "" },
            message: err.message,
          });
        } else {
          setError(err.message);
        }
      } else {
        setError("Generation failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Copy failed — select the text manually.");
    }
  }

  const promptPreview: PromptPreview | null =
    outcome?.kind === "not-configured" ? outcome.prompt : null;

  return (
    <div className="flex h-full flex-col" data-testid="ai-assistant-drawer">
      <header className="border-ink-200 flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold text-ink-900">AI Assistant</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI assistant drawer"
          className="rounded px-2 py-1 text-xs text-ink-500 hover:bg-ink-100"
        >
          ✕
        </button>
      </header>

      <div className="border-ink-200 space-y-3 border-b px-4 py-3">
        <div className="flex gap-1" role="tablist" aria-label="Generation mode">
          {(Object.keys(MODE_LABELS) as GenerationMode[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                mode === value
                  ? "bg-ink-800 text-ink-50"
                  : "bg-ink-100 text-ink-600 hover:bg-ink-200"
              }`}
            >
              {MODE_LABELS[value]}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="text-ink-500 block text-xs font-medium">
            {mode === "beat_expansion" ? "Beat to expand" : "Beat hint (optional)"}
          </span>
          <textarea
            value={beatText}
            onChange={(e) => setBeatText(e.target.value)}
            rows={3}
            placeholder={
              mode === "beat_expansion"
                ? "e.g. Mara confronts the harbormaster about the missing shipment"
                : "Optional direction, e.g. keep it tense, end on a decision"
            }
            className="border-ink-300 mt-1 w-full rounded-md border bg-white px-2 py-1.5 text-sm text-ink-900"
          />
        </label>

        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy}
          className="w-full rounded-md bg-ink-800 px-3 py-2 text-sm font-medium text-ink-50 shadow-xs hover:bg-ink-900 disabled:opacity-50"
        >
          {busy ? "Generating…" : "Generate"}
        </button>

        <p className="text-ink-400 text-[11px]">
          Uses the assembled story bible (token-budgeted) plus your scene. The saved scene content
          and any edits you have typed are both considered.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        {outcome?.kind === "generated" && (
          <div data-testid="ai-result" className="space-y-2">
            <p className="text-ink-400 text-[11px]">Generated with {outcome.result.model}</p>
            <textarea
              value={outcome.result.text}
              readOnly
              rows={10}
              className="border-ink-300 w-full rounded-md border bg-ink-50 px-2 py-1.5 font-serif text-sm text-ink-900"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void copy(outcome.result.text, "result")}
                className="rounded border border-ink-300 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
              >
                {copied === "result" ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => onInsertText(outcome.result.text)}
                className="rounded bg-ink-800 px-2 py-1 text-xs font-medium text-ink-50 hover:bg-ink-900"
              >
                Append to scene
              </button>
            </div>
          </div>
        )}

        {outcome?.kind === "not-configured" && (
          <div data-testid="ai-not-configured" className="space-y-2">
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {outcome.message} — the fully assembled prompt is below; copy it into any LLM chat to
              keep writing.
            </p>
            {(["system", "user"] as const).map((role) => (
              <div key={role}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-ink-500 text-[11px] font-semibold uppercase">
                    {role} message
                  </span>
                  <button
                    type="button"
                    onClick={() => void copy(promptPreview?.[role] ?? "", role)}
                    className="rounded border border-ink-300 px-2 py-0.5 text-[11px] font-medium text-ink-700 hover:bg-ink-50"
                  >
                    {copied === role ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="border-ink-200 max-h-60 overflow-y-auto rounded border bg-ink-50 p-2 text-[11px] whitespace-pre-wrap text-ink-700">
                  {promptPreview?.[role] ?? ""}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
