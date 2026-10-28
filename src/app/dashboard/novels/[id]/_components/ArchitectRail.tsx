"use client";

import { useState } from "react";
import type { CodexBudgetData } from "./useCodexBudget";
import { TokenBudgetBar } from "./TokenBudgetBar";

export interface ArchitectRailProps {
  budget: CodexBudgetData;
  /** Opens the Relation Linker for the given source entry. */
  onOpenLinker: (entry: { id: string; name: string }) => void;
  /** Opens the Progression Timeline drawer. */
  onOpenTimeline: () => void;
}

/**
 * Architect Mode right rail (JGF-128, design rev 4 §1.1 item 1): hosts the
 * Relation Linker entry point, the Progression Timeline entry point, and the
 * persistent Token Budget Bar.
 */
export function ArchitectRail({ budget, onOpenLinker, onOpenTimeline }: ArchitectRailProps) {
  const [sourceEntryId, setSourceEntryId] = useState("");

  const progressionCount = Array.from(budget.details.values()).reduce(
    (sum, d) => sum + (d.progressions?.length ?? 0),
    0,
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="architect-rail">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <section
          aria-labelledby="architect-rail-linker"
          className="rounded-lg border border-ink-200 bg-card p-3"
        >
          <h2
            id="architect-rail-linker"
            className="text-xs font-semibold uppercase tracking-wide text-muted"
          >
            Relation Linker
          </h2>
          <label className="mt-2 block">
            <span className="text-[11px] font-medium text-muted">Source entry</span>
            <select
              value={sourceEntryId}
              onChange={(e) => setSourceEntryId(e.target.value)}
              className="mt-1 w-full rounded-md border border-ink-200 bg-elevated p-2 text-sm text-primary"
              data-testid="linker-source-select"
            >
              <option value="">Choose an entry…</option>
              {budget.entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.type})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!sourceEntryId}
            onClick={() => {
              const entry = budget.entries.find((e) => e.id === sourceEntryId);
              if (entry) onOpenLinker({ id: entry.id, name: entry.name });
            }}
            className="mt-2 min-h-11 w-full rounded-md bg-ink-800 px-3 text-xs font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-50"
          >
            Open Relation Linker
          </button>
          <p className="mt-1 text-[11px] text-muted">
            Tip: detected mentions in the outliner rail can also open the linker directly.
          </p>
        </section>

        <section
          aria-labelledby="architect-rail-timeline"
          className="rounded-lg border border-ink-200 bg-card p-3"
        >
          <h2
            id="architect-rail-timeline"
            className="text-xs font-semibold uppercase tracking-wide text-muted"
          >
            Progression Timeline
          </h2>
          <p className="mt-1 text-[11px] text-muted">
            {progressionCount > 0
              ? `${progressionCount} progression${progressionCount === 1 ? "" : "s"} across mentioned entries.`
              : "Scene-level overrides in reading order."}
          </p>
          <button
            type="button"
            onClick={onOpenTimeline}
            className="mt-2 min-h-11 w-full rounded-md border border-ink-200 px-3 text-xs font-medium text-secondary hover:bg-ink-100"
          >
            Open Timeline
          </button>
        </section>
      </div>

      <footer className="border-t border-ink-200 px-4 py-3">
        <TokenBudgetBar
          segments={budget.segments}
          breakdown={budget.breakdown}
          loading={budget.loading}
          error={budget.error}
        />
      </footer>
    </div>
  );
}
