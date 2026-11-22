"use client";

import { formatWordCount } from "@/lib/writing/word-count";

export type SaveStateLabel = "saved" | "dirty" | "saving" | "error";

const SAVE_LABELS: Record<SaveStateLabel, string> = {
  saved: "All changes saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  error: "Save failed — draft kept locally",
};

export interface StatusPillProps {
  words: number;
  saveState: SaveStateLabel;
}

/**
 * Writer Mode status pill (JGF-128): subtle bottom-anchored pill carrying the
 * live word count and save state so the prose column stays chrome-free.
 */
export function StatusPill({ words, saveState }: Readonly<StatusPillProps>) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="writer-status-pill"
      className="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2"
    >
      <p className="rounded-full border border-ink-200 bg-card px-4 py-1.5 text-xs text-muted shadow-sm">
        <span className="tabular-nums">{formatWordCount(words)}</span>
        <span aria-hidden="true" className="mx-2 text-ink-300">
          ·
        </span>
        <span className={saveState === "error" ? "font-medium text-red-600" : undefined}>
          {SAVE_LABELS[saveState]}
        </span>
      </p>
    </div>
  );
}
