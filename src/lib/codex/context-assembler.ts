/**
 * Pure Codex context assembler (STO-1170).
 *
 * Combines manual attachments, always-tracked entries, detected mentions,
 * relation expansion, and scene-aware progressions into one deterministic,
 * structured context object for AI generation.
 *
 * The assembler is DB-agnostic: callers load Codex entries, relations,
 * progressions, and the novel's scene reading order, then pass them in.
 * Mention detection, relation expansion, and progression rules are delegated
 * to `detectMentionsInText`, `RelationEngine`, and `ProgressionEngine` so each
 * rule stays in one place.
 */

import { detectMentionsInText } from "./mention-detection";
import {
  ProgressionEngine,
  type ProgressionCandidate,
  type SceneReadingOrderKey,
} from "./progression-engine";
import { RelationEngine, type RelationEdge } from "./relation-engine";
import type { CodexTrackingMode, CodexType } from "./types";

export interface ContextAssemblyOptions {
  /** Maximum entries returned after ranking. Defaults to {@link DEFAULT_MAX_CONTEXT_ENTRIES}. */
  maxEntries?: number;
  /** Maximum relation hops from any seed. Defaults to `RelationEngine.DEFAULT_MAX_DEPTH`. */
  maxRelationDepth?: number;
  /** Include series-scoped entries of the novel's series. Defaults to `true`. */
  includeSeriesCodex?: boolean;
}

export interface ContextAssemblyRequest {
  novelId: string;
  sceneId: string;
  beatText?: string;
  recentProse?: string;
  manualAttachmentIds?: string[];
  options?: ContextAssemblyOptions;
}

/** Minimal Codex entry shape the assembler needs (DB-agnostic). */
export interface ContextCandidateEntry {
  id: string;
  type: CodexType;
  name: string;
  aliases: readonly string[];
  /** Base description before progressions. */
  description: string;
  trackingMode: CodexTrackingMode;
  seriesScoped: boolean;
  novelId: string | null;
  seriesId: string | null;
  /** Manual ordering; used as a deterministic tie-break. Defaults to 0. */
  position?: number;
}

/** A progression row linked to its entry. */
export interface ContextProgression extends ProgressionCandidate {
  entryId: string;
}

/** Pre-loaded data the assembler works over. */
export interface ContextAssemblyData {
  /** Candidate Codex entries (book and series scoped; out-of-scope rows are ignored). */
  entries: readonly ContextCandidateEntry[];
  /** Directed relation edges between entries. */
  relations: readonly RelationEdge[];
  /** Progressions for any of the entries. */
  progressions: readonly ContextProgression[];
  /** Reading-order keys for the novel's scenes (must include `request.sceneId`). */
  sceneOrderById: ReadonlyMap<string, SceneReadingOrderKey>;
  /** Series of the requested novel, if any (enables series-scoped entries). */
  seriesId?: string | null;
}

export type ContextEntrySource = "always" | "mention" | "relation" | "manual";

export interface AssembledContextEntry {
  id: string;
  type: string;
  name: string;
  aliases: string[];
  /** Description after progressions up to the current scene. */
  description: string;
  trackingMode: "always" | "detected" | "never";
  source: ContextEntrySource;
  /** Hop distance from the nearest seed; only set for `source === "relation"`. */
  relationDepth?: number;
  /** Progressions applied to `description`, in application order. */
  appliedProgressionIds: string[];
}

export interface AssembledContext {
  entries: AssembledContextEntry[];
  meta: {
    totalCandidates: number;
    finalCount: number;
    truncated: boolean;
    sceneId: string;
  };
}

/** Default cap on assembled entries when callers omit `maxEntries`. */
export const DEFAULT_MAX_CONTEXT_ENTRIES = 40;

export class ContextAssemblyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextAssemblyError";
  }
}

interface SelectedEntry {
  entry: ContextCandidateEntry;
  source: ContextEntrySource;
  relationDepth?: number;
}

const SOURCE_RANK: Record<Exclude<ContextEntrySource, "relation">, number> = {
  manual: 0,
  always: 1,
  mention: 2,
};

function normalizeCount(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function compareEntries(a: ContextCandidateEntry, b: ContextCandidateEntry): number {
  const byPosition = (a.position ?? 0) - (b.position ?? 0);
  if (byPosition !== 0) {
    return byPosition;
  }
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) {
    return byName;
  }
  return a.id.localeCompare(b.id);
}

/** True when the entry belongs to the requested novel (or its series, when enabled). */
function isInScope(
  entry: ContextCandidateEntry,
  novelId: string,
  seriesId: string | null,
  includeSeriesCodex: boolean,
): boolean {
  if (entry.seriesScoped) {
    return includeSeriesCodex && seriesId !== null && entry.seriesId === seriesId;
  }
  return entry.novelId === novelId;
}

function rankOf(selected: SelectedEntry): number {
  if (selected.source === "relation") {
    // Depth 1 ranks right after mentions; deeper hops follow in depth order.
    return SOURCE_RANK.mention + (selected.relationDepth ?? 1);
  }
  return SOURCE_RANK[selected.source];
}

function toTrackingMode(mode: CodexTrackingMode): AssembledContextEntry["trackingMode"] {
  if (mode === "ALWAYS") {
    return "always";
  }
  if (mode === "NEVER") {
    return "never";
  }
  return "detected";
}

/**
 * Collect seed entries in priority order: manual attachments, always-tracked,
 * then detected mentions. An entry keeps its highest-priority source.
 */
function collectSeeds(
  request: ContextAssemblyRequest,
  scoped: readonly ContextCandidateEntry[],
  byId: ReadonlyMap<string, ContextCandidateEntry>,
): SelectedEntry[] {
  const seeds: SelectedEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: ContextCandidateEntry, source: ContextEntrySource): void => {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      seeds.push({ entry, source });
    }
  };

  // Manual attachments win even for NEVER-tracked entries: the writer asked for them.
  for (const id of request.manualAttachmentIds ?? []) {
    const entry = byId.get(id);
    if (entry) {
      add(entry, "manual");
    }
  }

  for (const entry of scoped) {
    if (entry.trackingMode === "ALWAYS") {
      add(entry, "always");
    }
  }

  // Separate the two texts so a name cannot match across their boundary.
  const text = [request.beatText, request.recentProse]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n\n");
  if (text) {
    const detectable = scoped
      .filter((entry) => entry.trackingMode !== "NEVER")
      .map((entry) => ({ id: entry.id, name: entry.name, aliases: [...entry.aliases] }));
    for (const id of detectMentionsInText(text, detectable).matchedEntryIds) {
      const entry = byId.get(id);
      if (entry) {
        add(entry, "mention");
      }
    }
  }

  return seeds;
}

/**
 * Expand seeds through the relation graph, keeping the minimum hop depth per
 * entry. Cycles are handled by `RelationEngine` (visited set + depth limit).
 * NEVER-tracked entries are neither added nor traversed through.
 */
function expandRelations(
  seeds: readonly SelectedEntry[],
  relations: readonly RelationEdge[],
  byId: ReadonlyMap<string, ContextCandidateEntry>,
  maxDepth: number,
): SelectedEntry[] {
  if (maxDepth === 0 || seeds.length === 0) {
    return [];
  }

  const seedIds = new Set(seeds.map((seed) => seed.entry.id));
  const traversable = (id: string): boolean => {
    const entry = byId.get(id);
    return entry !== undefined && (entry.trackingMode !== "NEVER" || seedIds.has(id));
  };
  const edges = relations.filter(
    (edge) => traversable(edge.sourceEntryId) && traversable(edge.targetEntryId),
  );

  const depthById = new Map<string, number>();
  const discoveryOrder: string[] = [];
  for (const seed of seeds) {
    const expanded = RelationEngine.expandFromSeed({
      seedEntryId: seed.entry.id,
      edges,
      maxDepth,
    });
    for (const node of expanded.entries) {
      if (node.depth === 0 || seedIds.has(node.entryId)) {
        continue;
      }
      const known = depthById.get(node.entryId);
      if (known === undefined) {
        discoveryOrder.push(node.entryId);
        depthById.set(node.entryId, node.depth);
      } else if (node.depth < known) {
        depthById.set(node.entryId, node.depth);
      }
    }
  }

  return discoveryOrder.map((id) => ({
    entry: byId.get(id)!,
    source: "relation" as const,
    relationDepth: depthById.get(id)!,
  }));
}

/**
 * Assemble the Codex context for a scene.
 *
 * Steps: scope filter -> seeds (manual, always, mentions) -> relation
 * expansion -> rank + truncate -> progressions at the current scene.
 * Output is deterministic for the same inputs regardless of input row order.
 *
 * @throws {ContextAssemblyError} when `request.sceneId` is missing from
 *   `data.sceneOrderById` (progressions cannot be filtered safely).
 */
export function assembleContext(
  request: ContextAssemblyRequest,
  data: ContextAssemblyData,
): AssembledContext {
  const currentScene = data.sceneOrderById.get(request.sceneId);
  if (!currentScene) {
    throw new ContextAssemblyError(`Scene ${request.sceneId} not found in novel reading order`);
  }

  const options = request.options ?? {};
  const maxEntries = normalizeCount(options.maxEntries, DEFAULT_MAX_CONTEXT_ENTRIES);
  const maxRelationDepth = normalizeCount(
    options.maxRelationDepth,
    RelationEngine.DEFAULT_MAX_DEPTH,
  );
  const includeSeriesCodex = options.includeSeriesCodex ?? true;
  const seriesId = data.seriesId ?? null;

  const byId = new Map<string, ContextCandidateEntry>();
  for (const entry of data.entries) {
    if (!byId.has(entry.id) && isInScope(entry, request.novelId, seriesId, includeSeriesCodex)) {
      byId.set(entry.id, entry);
    }
  }
  const scoped = [...byId.values()].sort(compareEntries);

  const seeds = collectSeeds(request, scoped, byId);
  const related = expandRelations(seeds, data.relations, byId, maxRelationDepth);

  // Stable sort keeps seed / discovery order within each rank tier.
  const ranked = [...seeds, ...related].sort((a, b) => rankOf(a) - rankOf(b));
  const selected = ranked.slice(0, maxEntries);

  const progressionsByEntry = new Map<string, ContextProgression[]>();
  for (const progression of data.progressions) {
    const list = progressionsByEntry.get(progression.entryId);
    if (list) {
      list.push(progression);
    } else {
      progressionsByEntry.set(progression.entryId, [progression]);
    }
  }

  const entries = selected.map(({ entry, source, relationDepth }): AssembledContextEntry => {
    const resolved = ProgressionEngine.resolveAtScene({
      baseDescription: entry.description,
      currentScene,
      sceneOrderById: data.sceneOrderById,
      progressions: progressionsByEntry.get(entry.id) ?? [],
    });
    return {
      id: entry.id,
      type: entry.type,
      name: entry.name,
      aliases: [...entry.aliases],
      description: resolved.description,
      trackingMode: toTrackingMode(entry.trackingMode),
      source,
      ...(relationDepth === undefined ? {} : { relationDepth }),
      appliedProgressionIds: resolved.appliedProgressionIds,
    };
  });

  return {
    entries,
    meta: {
      totalCandidates: ranked.length,
      finalCount: entries.length,
      truncated: ranked.length > entries.length,
      sceneId: request.sceneId,
    },
  };
}
