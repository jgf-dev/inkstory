"use client";

import { useCallback, useEffect, useState } from "react";
import type { SceneContextData } from "@/lib/writing/service";
import { apiGet, apiPost, ApiRequestError } from "./api";

export interface SceneContextDrawerProps {
  sceneId: string;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  CHARACTER: "Character",
  LOCATION: "Location",
  ITEM: "Item",
  LORE: "Lore",
  FACTION: "Faction",
  CONCEPT: "Concept",
  OTHER: "Other",
};

/**
 * Scene Context drawer (launch phase 3): shows which Codex entries are
 * attached to the current scene — pinned, ALWAYS-tracked, and detected — with
 * quick pin/unpin toggles and a live assembly/token estimate.
 */
export function SceneContextDrawer({ sceneId, onClose }: SceneContextDrawerProps) {
  const [data, setData] = useState<SceneContextData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingEntryId, setTogglingEntryId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<SceneContextData>(`/api/scenes/${sceneId}/context`);
      setData(res);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to load scene context");
    } finally {
      setLoading(false);
    }
  }, [sceneId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(entryId: string, attach: boolean) {
    setTogglingEntryId(entryId);
    try {
      await apiPost(`/api/scenes/${sceneId}/attachments`, { entryId, attach });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to update attachment");
    } finally {
      setTogglingEntryId(null);
    }
  }

  function renderRow(
    entry: { entryId: string; name: string; type: string; trackingMode: string },
    action: "unpin" | "pin",
  ) {
    return (
      <li
        key={entry.entryId}
        className="border-ink-200 flex items-center justify-between rounded border px-2.5 py-1.5"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink-900">{entry.name}</span>
          <span className="text-ink-400 block text-[11px]">
            {TYPE_LABELS[entry.type] ?? entry.type}
            {entry.trackingMode === "ALWAYS" ? " · always tracked" : ""}
          </span>
        </span>
        <button
          type="button"
          disabled={togglingEntryId !== null}
          onClick={() => void toggle(entry.entryId, action === "pin")}
          className={`shrink-0 rounded px-2 py-1 text-xs font-medium disabled:opacity-50 ${
            action === "unpin"
              ? "border border-ink-300 text-ink-700 hover:bg-ink-50"
              : "bg-ink-800 text-ink-50 hover:bg-ink-900"
          }`}
        >
          {action === "unpin" ? "Unpin" : "Pin"}
        </button>
      </li>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="scene-context-drawer">
      <header className="border-ink-200 flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold text-ink-900">Scene Context</h2>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded px-2 py-1 text-xs font-medium text-ink-600 hover:bg-ink-100"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scene context drawer"
            className="rounded px-2 py-1 text-xs text-ink-500 hover:bg-ink-100"
          >
            ✕
          </button>
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {loading && !data && <p className="text-ink-400 text-xs">Loading scene context…</p>}

        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        {data && (
          <>
            <div
              className="border-ink-200 rounded-lg border bg-ink-50 px-3 py-2 text-xs text-ink-700"
              data-testid="context-estimate"
            >
              <p className="font-medium">
                ≈{data.estimate.estimatedTokens.toLocaleString("en-US")} of{" "}
                {data.estimate.maxTokens.toLocaleString("en-US")} tokens
              </p>
              <p className="text-ink-500 mt-0.5">
                {data.estimate.selectedEntries} of {data.estimate.candidateEntries} candidate
                entries in the assembled context.
              </p>
              {data.estimate.droppedEntryIds.length > 0 && (
                <p className="mt-1 text-amber-700">
                  {data.estimate.droppedEntryIds.length} entr
                  {data.estimate.droppedEntryIds.length === 1 ? "y" : "ies"} dropped by the token
                  budget.
                </p>
              )}
              {data.estimate.truncatedEntryIds.length > 0 && (
                <p className="mt-0.5 text-amber-700">
                  {data.estimate.truncatedEntryIds.length} description
                  {data.estimate.truncatedEntryIds.length === 1 ? "" : "s"} truncated to fit.
                </p>
              )}
            </div>

            <section>
              <h3 className="text-ink-500 mb-1.5 text-[11px] font-semibold uppercase tracking-wide">
                Pinned to this scene
              </h3>
              {data.attachments.length === 0 ? (
                <p className="text-ink-400 text-[11px] italic">
                  Nothing pinned yet — pin detected or always-tracked entries below.
                </p>
              ) : (
                <ul className="space-y-1">{data.attachments.map((a) => renderRow(a, "unpin"))}</ul>
              )}
            </section>

            {data.alwaysIncluded.length > 0 && (
              <section>
                <h3 className="text-ink-500 mb-1.5 text-[11px] font-semibold uppercase tracking-wide">
                  Always included
                </h3>
                <ul className="space-y-1">
                  {data.alwaysIncluded.map((e) => renderRow(e, "unpin"))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="text-ink-500 mb-1.5 text-[11px] font-semibold uppercase tracking-wide">
                Detected in scene text
              </h3>
              {data.detected.matchedEntryIds.length === 0 ? (
                <p className="text-ink-400 text-[11px] italic">
                  No codex entries detected in the saved scene text.
                </p>
              ) : (
                <ul className="space-y-1">
                  {data.detectedEntries.map((entry) => {
                    const pinned = data.attachments.some((a) => a.entryId === entry.entryId);
                    return renderRow(entry, pinned ? "unpin" : "pin");
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
