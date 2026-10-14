"use client";

import { useMemo } from "react";
import type { MentionDetectionResult } from "@/lib/codex/mention-detection";

export interface MentionsPanelProps {
  detection: MentionDetectionResult | null;
  scanning: boolean;
}

interface MentionGroup {
  entryId: string;
  label: string;
  count: number;
}

/**
 * Live mention detection panel (launch phase 3): groups the debounced scan
 * result per entry with occurrence counts so the author can see which codex
 * entries this scene touches at a glance.
 */
export function MentionsPanel({ detection, scanning }: MentionsPanelProps) {
  const groups = useMemo<MentionGroup[]>(() => {
    if (!detection) return [];
    const byEntry = new Map<string, MentionGroup>();
    for (const match of detection.matches) {
      const existing = byEntry.get(match.entryId);
      if (existing) {
        existing.count += 1;
        if (match.matchType === "name") {
          existing.label = match.matchedText;
        }
      } else {
        byEntry.set(match.entryId, {
          entryId: match.entryId,
          label: match.matchedText,
          count: 1,
        });
      }
    }
    return Array.from(byEntry.values()).sort(
      (a, b) => b.count - countFor(a) || a.label.localeCompare(b.label),
    );

    function countFor(group: MentionGroup): number {
      return group.count;
    }
  }, [detection]);

  const isEmpty = !scanning && groups.length === 0;

  return (
    <div className="border-ink-200 border-t" data-testid="mentions-panel">
      <div className="flex items-center justify-between px-3 pt-3">
        <h2 className="text-ink-500 text-xs font-semibold uppercase tracking-wide">
          Detected in this scene
        </h2>
        {scanning && <span className="text-ink-400 text-[11px]">scanning…</span>}
      </div>
      <div className="px-3 pb-3 pt-2">
        {isEmpty && (
          <p className="text-ink-400 text-[11px] italic">
            {detection === null
              ? "Mentions appear here as you write."
              : "No codex entries detected in this scene."}
          </p>
        )}
        <ul className="space-y-1">
          {groups.map((group) => (
            <li key={group.entryId}>
              <span className="border-ink-200 bg-ink-50 text-ink-700 flex items-center justify-between rounded border px-2 py-1 text-xs">
                <span className="truncate font-medium">{group.label}</span>
                <span className="text-ink-400 tabular-nums">×{group.count}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
