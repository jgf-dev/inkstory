"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NovelOutline } from "@/lib/writing/service";
import { flattenScenesInReadingOrder, type SceneCoordinate } from "@/lib/writing/reading-order";
import type { ProgressionMode } from "@/lib/codex/types";
import { apiGet } from "./api";

export interface ProgressionTimelineDrawerProps {
  isOpen: boolean;
  novelId: string;
  outline: NovelOutline;
  /** Currently open scene; the slider starts at its coordinate. */
  currentSceneId?: string | null;
  onClose: () => void;
}

interface ProgressionCard {
  id: string;
  entryId: string;
  entryName: string;
  mode: ProgressionMode;
  description: string;
  notes: string | null;
  coordinate: SceneCoordinate;
}

type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * Progression Timeline Drawer (JGF-128, design rev 4 §1.1 item 3):
 * chronological scene milestone slider in reading order (Act → Chapter →
 * Scene). Cards show ADDITION vs REPLACEMENT overrides (demeanor, injuries,
 * status) anchored at their plot coordinate. The slider highlights the
 * selected coordinate's cards and dims the future.
 */
export function ProgressionTimelineDrawer({
  isOpen,
  novelId,
  outline,
  currentSceneId = null,
  onClose,
}: Readonly<ProgressionTimelineDrawerProps>) {
  const coordinates = useMemo(() => flattenScenesInReadingOrder(outline), [outline]);
  const indexBySceneId = useMemo(
    () => new Map(coordinates.map((c) => [c.sceneId, c.index])),
    [coordinates],
  );

  const [cards, setCards] = useState<ProgressionCard[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sliderIndex, setSliderIndex] = useState(() =>
    currentSceneId ? (indexBySceneId.get(currentSceneId) ?? 0) : 0,
  );

  const load = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const list = await apiGet<{ entries?: Array<{ id: string; name: string }> }>(
        `/api/codex/entries?novelId=${encodeURIComponent(novelId)}`,
      );
      const entries = Array.isArray(list.entries) ? list.entries : [];

      const details = await Promise.all(
        entries.map((entry) =>
          apiGet<{ entry: { id: string; name: string; progressions?: any[] } }>(
            `/api/codex/entries/${encodeURIComponent(entry.id)}`,
          ).catch(() => null),
        ),
      );

      const nextCards: ProgressionCard[] = [];
      for (const detail of details) {
        if (!detail?.entry) continue;
        for (const p of detail.entry.progressions ?? []) {
          const coordinate = coordinates.find((c) => c.sceneId === p.sceneId);
          if (!coordinate) continue; // progression anchored to another novel's scene
          nextCards.push({
            id: p.id,
            entryId: detail.entry.id,
            entryName: detail.entry.name,
            mode: p.mode === "REPLACEMENT" ? "REPLACEMENT" : "ADDITION",
            description: p.description ?? "",
            notes: p.notes ?? null,
            coordinate,
          });
        }
      }
      nextCards.sort((a, b) => a.coordinate.index - b.coordinate.index || a.id.localeCompare(b.id));
      setCards(nextCards);
      setLoadState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load progressions");
      setLoadState("error");
    }
  }, [novelId, coordinates]);

  useEffect(() => {
    if (isOpen && loadState === "idle") {
      void load();
    }
  }, [isOpen, loadState, load]);

  // Keep the slider on the open scene when the drawer opens.
  useEffect(() => {
    if (isOpen && currentSceneId) {
      setSliderIndex(indexBySceneId.get(currentSceneId) ?? 0);
    }
  }, [isOpen, currentSceneId, indexBySceneId]);

  if (!isOpen) return null;

  const selectedCoordinate = coordinates[sliderIndex] ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs"
      data-testid="progression-timeline-drawer"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Progression timeline"
        className="flex h-full w-full max-w-md flex-col border-l border-subtle bg-app text-primary shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-primary">Progression Timeline</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close progression timeline"
            className="flex min-h-11 min-w-11 items-center justify-center rounded text-muted hover:bg-ink-100 hover:text-primary"
          >
            ✕
          </button>
        </header>

        {coordinates.length > 0 && (
          <div className="border-b border-ink-200 px-4 py-3">
            <label
              htmlFor="progression-plot-coordinate"
              className="block text-xs font-semibold uppercase tracking-wider text-muted"
            >
              Plot coordinate
            </label>
            <input
              id="progression-plot-coordinate"
              type="range"
              min={0}
              max={Math.max(0, coordinates.length - 1)}
              step={1}
              value={sliderIndex}
              onChange={(e) => setSliderIndex(Number(e.target.value))}
              aria-valuetext={selectedCoordinate?.label}
              className="mt-2 w-full accent-ink-400"
              data-testid="progression-slider"
            />
            <p
              className="mt-1 truncate text-[11px] text-muted"
              data-testid="progression-coordinate"
            >
              {selectedCoordinate
                ? `${selectedCoordinate.index + 1} of ${coordinates.length} — ${selectedCoordinate.label}`
                : "No scenes in this novel yet."}
            </p>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loadState === "loading" && (
            <p className="py-8 text-center text-sm text-muted">Loading progressions…</p>
          )}

          {loadState === "error" && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <p role="alert">{error ?? "Failed to load progressions"}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-2 min-h-11 rounded border border-red-300 px-3 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                Retry
              </button>
            </div>
          )}

          {loadState === "ready" && cards.length === 0 && (
            <div className="mt-6 rounded-lg border border-dashed border-ink-200 p-6 text-center">
              <p className="text-sm text-secondary">
                No progressions yet — add one from a Codex entry.
              </p>
            </div>
          )}

          {loadState === "ready" && cards.length > 0 && (
            <ol className="relative ml-2 space-y-3 border-l border-ink-200 pl-4">
              {cards.map((card) => {
                const isAtSelection = card.coordinate.index === sliderIndex;
                const isFuture = card.coordinate.index > sliderIndex;
                return (
                  <li
                    key={card.id}
                    data-testid={`progression-card-${card.id}`}
                    aria-current={isAtSelection ? "true" : undefined}
                    className={`rounded-lg border p-3 ${
                      isAtSelection ? "border-strong bg-card shadow-sm" : "border-ink-200 bg-card"
                    } ${isFuture ? "opacity-55" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-primary">
                        {card.entryName}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          card.mode === "REPLACEMENT"
                            ? "bg-budget-relations text-ink-900"
                            : "bg-budget-progressions text-white"
                        }`}
                      >
                        {card.mode}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-secondary">{card.description}</p>
                    {card.notes && (
                      <p className="mt-1 text-[11px] italic text-muted">{card.notes}</p>
                    )}
                    <p className="mt-1.5 text-[11px] text-muted">{card.coordinate.label}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
