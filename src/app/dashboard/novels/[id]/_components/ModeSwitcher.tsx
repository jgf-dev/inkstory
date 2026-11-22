"use client";

import type { WorkspaceMode } from "@/lib/ui/preferences";

const MODES: Array<{ id: WorkspaceMode; label: string; hint: string }> = [
  { id: "writer", label: "Writer", hint: "Distraction-free prose column" },
  { id: "stage", label: "Stage", hint: "Scene + enactment console" },
  { id: "architect", label: "Architect", hint: "Outliner, prose and Codex cockpit" },
];

export interface ModeSwitcherProps {
  mode: WorkspaceMode;
  onChange: (mode: WorkspaceMode) => void;
}

/**
 * Progressive-disclosure operating mode switcher (JGF-128 scope item 2).
 * Segmented control with 44px targets; the active mode is announced via
 * aria-pressed.
 */
export function ModeSwitcher({ mode, onChange }: Readonly<ModeSwitcherProps>) {
  return (
    <div
      role="group"
      aria-label="Workspace mode"
      data-testid="mode-switcher"
      className="flex items-center overflow-hidden rounded-md border border-ink-200"
    >
      {MODES.map((option) => {
        const active = mode === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            title={option.hint}
            onClick={() => onChange(option.id)}
            data-testid={`mode-${option.id}`}
            className={`min-h-11 px-3 text-xs font-medium ${
              active ? "bg-ink-800 text-ink-50" : "text-ink-600 hover:bg-ink-100"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
