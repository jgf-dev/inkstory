"use client";

import { useEffect, useState } from "react";
import { applyProseFont, readProseFont, type ProseFont } from "@/lib/ui/preferences";

const OPTIONS: Array<{ id: ProseFont; label: string }> = [
  { id: "serif", label: "Classical Serif" },
  { id: "sans", label: "Modern Sans" },
];

/**
 * Prose font toggle (JGF-128 scope item 6): author-selectable Classical Serif
 * vs Modern Sans for the prose canvas only — UI chrome stays on the UI font.
 * Persisted via localStorage and applied through `<html data-prose-font>`.
 */
export function ProseFontToggle() {
  const [font, setFont] = useState<ProseFont | null>(null);

  useEffect(() => {
    setFont(readProseFont());
  }, []);

  function select(next: ProseFont) {
    setFont(next);
    applyProseFont(next);
  }

  return (
    <div
      role="group"
      aria-label="Prose font"
      data-testid="prose-font-toggle"
      className="flex items-center overflow-hidden rounded-md border border-ink-200"
    >
      {OPTIONS.map((option) => {
        const active = font === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => select(option.id)}
            className={`min-h-11 px-3 text-xs font-medium ${
              active ? "bg-ink-800 text-ink-50" : "text-ink-600 hover:bg-ink-100"
            }`}
          >
            {option.id === "serif" ? "Serif" : "Sans"}
            <span className="sr-only">{` — ${option.label} prose font`}</span>
          </button>
        );
      })}
    </div>
  );
}
