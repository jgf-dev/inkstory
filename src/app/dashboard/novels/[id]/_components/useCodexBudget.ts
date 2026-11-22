"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MentionDetectionResult } from "@/lib/codex/mention-detection";
import type { BudgetSegmentInput } from "@/lib/codex/budget-segments";
import { estimateTokens } from "@/lib/codex/tokens";
import { estimateFormattedEntryTokens, estimateWrapperTokens } from "@/lib/codex/prompt-formatter";
import type { AssembledContextEntry } from "@/lib/codex/context-assembler";
import { apiGet } from "./api";
import type { BudgetBreakdownItem } from "./TokenBudgetBar";

export interface CodexEntrySummary {
  id: string;
  name: string;
  type: string;
  description: string;
  trackingMode: string;
}

/** Per-entry detail as returned by GET /api/codex/entries/[id]. */
export interface CodexEntryDetail {
  id: string;
  name: string;
  sourceRelations?: Array<{
    id: string;
    relationType: string;
    reverseType: string | null;
    targetEntryId: string;
    targetEntry?: { name: string } | null;
  }>;
  targetRelations?: Array<{
    id: string;
    relationType: string;
    reverseType: string | null;
    sourceEntryId: string;
    sourceEntry?: { name: string } | null;
  }>;
  progressions?: Array<{
    id: string;
    sceneId: string;
    mode: string;
    description: string;
  }>;
}

export interface CodexBudgetData {
  loading: boolean;
  error: string | null;
  segments: BudgetSegmentInput[];
  breakdown: Partial<Record<BudgetSegmentInput["id"], BudgetBreakdownItem[]>>;
  /** All novel entries (Relation Linker target candidates). */
  entries: CodexEntrySummary[];
  /** Detail rows loaded so far (relations/progressions), keyed by entry id. */
  details: ReadonlyMap<string, CodexEntryDetail>;
  /** Load (and cache) a single entry's detail row. */
  ensureDetail: (entryId: string) => void;
  /** Drop a cached detail row so the next ensureDetail refetches it. */
  invalidateDetail: (entryId: string) => void;
  reload: () => void;
}

function toAssembledEntry(
  entry: Pick<CodexEntrySummary, "id" | "name" | "type" | "description">,
  source: AssembledContextEntry["source"],
): AssembledContextEntry {
  return {
    id: entry.id,
    type: entry.type,
    name: entry.name,
    aliases: [],
    description: entry.description ?? "",
    trackingMode: "detected",
    source,
    appliedProgressionIds: [],
  };
}

function sumTokens(items: BudgetBreakdownItem[]): number {
  return items.reduce((s, i) => s + i.tokens, 0);
}

function buildSeedItems(alwaysEntries: CodexEntrySummary[]): BudgetBreakdownItem[] {
  return [
    { label: "System prompt & core rules", tokens: estimateWrapperTokens() },
    ...alwaysEntries.map((e) => ({
      label: e.name,
      tokens: estimateFormattedEntryTokens(toAssembledEntry(e, "always")),
    })),
  ];
}

function buildMentionItems(mentionedEntries: CodexEntrySummary[]): BudgetBreakdownItem[] {
  return mentionedEntries.map((e) => ({
    label: e.name,
    tokens: estimateFormattedEntryTokens(toAssembledEntry(e, "mention")),
  }));
}

/** 1st-degree relation neighbors of mentioned entries (not already counted). */
function buildRelationItems(
  mentionedIds: readonly string[],
  entries: readonly CodexEntrySummary[],
  details: ReadonlyMap<string, CodexEntryDetail>,
  counted: ReadonlySet<string>,
): BudgetBreakdownItem[] {
  const relationItems: BudgetBreakdownItem[] = [];
  const seenNeighbors = new Set<string>();
  for (const id of mentionedIds) {
    const detail = details.get(id);
    if (!detail) continue;
    const neighborIds = [
      ...(detail.sourceRelations ?? []).map((r) => r.targetEntryId),
      ...(detail.targetRelations ?? []).map((r) => r.sourceEntryId),
    ];
    for (const neighborId of neighborIds) {
      if (counted.has(neighborId) || seenNeighbors.has(neighborId)) continue;
      seenNeighbors.add(neighborId);
      const neighbor = entries.find((e) => e.id === neighborId);
      if (!neighbor) continue;
      relationItems.push({
        label: neighbor.name,
        tokens: estimateFormattedEntryTokens(toAssembledEntry(neighbor, "relation")),
      });
    }
  }
  return relationItems;
}

/** Progressions applicable at the open scene, for entries already in context. */
function buildProgressionItems(
  details: ReadonlyMap<string, CodexEntryDetail>,
  counted: ReadonlySet<string>,
  mentionedSet: ReadonlySet<string>,
  currentSceneIndex: number | null,
  sceneIndexById: ReadonlyMap<string, number>,
): BudgetBreakdownItem[] {
  if (currentSceneIndex === null) return [];
  const progressionItems: BudgetBreakdownItem[] = [];
  for (const [entryId, detail] of details) {
    if (!counted.has(entryId) && !mentionedSet.has(entryId)) continue;
    for (const p of detail.progressions ?? []) {
      const sceneIndex = sceneIndexById.get(p.sceneId);
      if (sceneIndex === undefined || sceneIndex > currentSceneIndex) continue;
      progressionItems.push({
        label: `${detail.name} — ${p.mode === "REPLACEMENT" ? "replaces" : "adds"}`,
        tokens: estimateTokens(p.description ?? ""),
      });
    }
  }
  return progressionItems;
}

function deriveBudgetBreakdown(
  entries: readonly CodexEntrySummary[],
  details: ReadonlyMap<string, CodexEntryDetail>,
  mentionedIds: readonly string[],
  currentSceneIndex: number | null,
  sceneIndexById: ReadonlyMap<string, number>,
): Pick<CodexBudgetData, "segments" | "breakdown"> {
  const mentionedSet = new Set(mentionedIds);
  const alwaysEntries = entries.filter((e) => e.trackingMode === "ALWAYS");
  const mentionedEntries = entries.filter(
    (e) => mentionedSet.has(e.id) && e.trackingMode !== "ALWAYS",
  );
  const counted = new Set([...alwaysEntries.map((e) => e.id), ...mentionedSet]);

  const seedItems = buildSeedItems(alwaysEntries);
  const mentionItems = buildMentionItems(mentionedEntries);
  const relationItems = buildRelationItems(mentionedIds, entries, details, counted);
  const progressionItems = buildProgressionItems(
    details,
    counted,
    mentionedSet,
    currentSceneIndex,
    sceneIndexById,
  );

  return {
    segments: [
      { id: "seed", tokens: sumTokens(seedItems) },
      { id: "mentions", tokens: sumTokens(mentionItems) },
      { id: "relations", tokens: sumTokens(relationItems) },
      { id: "progressions", tokens: sumTokens(progressionItems) },
    ],
    breakdown: {
      seed: seedItems,
      mentions: mentionItems,
      relations: relationItems,
      progressions: progressionItems,
    },
  };
}

/**
 * Loads the novel's Codex entries plus details for mentioned entries, and
 * derives the Token Budget Bar segments. Mirrors the Context Assembler's
 * composition (always-on seed + detected mentions + 1st-degree relations +
 * applicable progressions) using the same estimateTokens approximation the
 * server-side budgeter uses.
 */
export function useCodexBudget(
  novelId: string,
  detection: MentionDetectionResult | null,
  /** Reading-order index of the open scene; null when no scene is open. */
  currentSceneIndex: number | null,
  /** Maps a scene id to its reading-order index. */
  sceneIndexById: ReadonlyMap<string, number>,
): CodexBudgetData {
  const [entries, setEntries] = useState<CodexEntrySummary[]>([]);
  const [details, setDetails] = useState<Map<string, CodexEntryDetail>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const detailsRef = useRef(details);
  detailsRef.current = details;

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiGet<{ entries?: CodexEntrySummary[] }>(
      `/api/codex/entries?novelId=${encodeURIComponent(novelId)}`,
    )
      .then((res) => {
        if (!active) return;
        setEntries(Array.isArray(res.entries) ? res.entries : []);
        setError(null);
      })
      .catch(() => {
        if (!active) return;
        setError("Couldn't estimate the context budget.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [novelId, reloadKey]);

  const mentionedIds = useMemo(() => (detection ? detection.matchedEntryIds : []), [detection]);

  const fetchDetail = useCallback((entryId: string) => {
    apiGet<{ entry: CodexEntryDetail }>(`/api/codex/entries/${encodeURIComponent(entryId)}`)
      .then((res) => {
        if (!res?.entry) return;
        setDetails((prev) => {
          const next = new Map(prev);
          next.set(entryId, res.entry);
          return next;
        });
      })
      .catch(() => {
        /* details are best-effort; the bar degrades to seed+mentions */
      });
  }, []);

  const ensureDetail = useCallback(
    (entryId: string) => {
      if (detailsRef.current.has(entryId)) return;
      fetchDetail(entryId);
    },
    [fetchDetail],
  );

  // Load details for mentioned entries (relations + progressions feed the bar).
  useEffect(() => {
    for (const id of mentionedIds) ensureDetail(id);
  }, [mentionedIds, ensureDetail]);

  /** Drops the cached row and refetches it (e.g. after a relation save). */
  const invalidateDetail = useCallback(
    (entryId: string) => {
      setDetails((prev) => {
        if (!prev.has(entryId)) return prev;
        const next = new Map(prev);
        next.delete(entryId);
        return next;
      });
      fetchDetail(entryId);
    },
    [fetchDetail],
  );

  const derived = useMemo(
    () => deriveBudgetBreakdown(entries, details, mentionedIds, currentSceneIndex, sceneIndexById),
    [entries, details, mentionedIds, currentSceneIndex, sceneIndexById],
  );

  return useMemo(
    () => ({
      loading,
      error,
      entries,
      details,
      ensureDetail,
      invalidateDetail,
      reload: () => setReloadKey((k) => k + 1),
      ...derived,
    }),
    [loading, error, entries, details, ensureDetail, invalidateDetail, derived],
  );
}
