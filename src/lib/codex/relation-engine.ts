/**
 * Pure relations expansion engine (STO-1154).
 *
 * Resolves a Codex relation graph from a seed entry using an adjacency list
 * of directed edges. Detects cycles, enforces a depth limit, and never
 * duplicates already-included entries.
 *
 * The engine is DB-agnostic: callers load CodexRelation rows (or any edge
 * list) and pass them in. Prefer these static methods over ad-hoc helpers so
 * expansion rules stay in one place and remain easy to unit-test.
 */

/** Minimal directed relation edge the engine needs (DB-agnostic). */
export interface RelationEdge {
  id: string;
  sourceEntryId: string;
  targetEntryId: string;
  relationType: string;
  reverseType?: string | null;
  description?: string | null;
}

/** Which way to walk directed edges from each visited entry. */
export type RelationTraversalDirection = "outgoing" | "incoming" | "both";

export interface ExpandFromSeedInput {
  /** Entry id to expand from (always included at depth 0). */
  seedEntryId: string;
  /** Directed relation edges forming the graph. */
  edges: readonly RelationEdge[];
  /**
   * Maximum hop distance from the seed.
   * Depth 0 = seed only; depth 1 = direct neighbors; etc.
   * Defaults to {@link RelationEngine.DEFAULT_MAX_DEPTH}.
   */
  maxDepth?: number;
  /**
   * Edge walk direction. Defaults to `"both"` so reverse edges
   * (target -> source) are included when expanding context.
   */
  direction?: RelationTraversalDirection;
}

/** One included entry in expansion order (BFS by depth, then edge id). */
export interface ExpandedEntry {
  entryId: string;
  /** Hop distance from the seed (0 for the seed itself). */
  depth: number;
  /** Relation that first discovered this entry; null for the seed. */
  viaRelationId: string | null;
  /** Neighbor entry that discovered this one; null for the seed. */
  fromEntryId: string | null;
  /** How the discovering edge was traversed; `"seed"` for the seed. */
  traversedAs: "seed" | "outgoing" | "incoming";
}

/** A skipped edge that would re-enter an already-visited entry (cycle / diamond). */
export interface SkippedCycleEdge {
  relationId: string;
  fromEntryId: string;
  toEntryId: string;
  depth: number;
}

export interface ExpandFromSeedResult {
  seedEntryId: string;
  maxDepth: number;
  /** Unique entry ids in BFS discovery order (seed first). */
  entryIds: string[];
  /** Per-entry discovery metadata aligned with `entryIds`. */
  entries: ExpandedEntry[];
  /** Relation ids that contributed a first-time discovery. */
  includedRelationIds: string[];
  /** Edges skipped because the destination was already included. */
  skippedCycles: SkippedCycleEdge[];
  /** True when some neighbor sat past `maxDepth` and was not expanded. */
  truncatedByDepth: boolean;
}

interface AdjacencyHop {
  neighborId: string;
  relation: RelationEdge;
  traversedAs: "outgoing" | "incoming";
}

/**
 * Codex relation-graph expansion engine.
 *
 * Prefer these static methods over ad-hoc helpers so cycle / depth / dedupe
 * rules stay centralized and unit-testable without a database.
 */
export class RelationEngine {
  /** Default max hop depth when callers omit `maxDepth` (keeps context bounded). */
  static readonly DEFAULT_MAX_DEPTH = 2;

  /**
   * Build an adjacency list from directed edges.
   * - `outgoing`: source -> target
   * - `incoming`: target -> source (walk reverse)
   * - `both`: both directions (default for context expansion)
   *
   * Self-edges and edges missing endpoints are ignored.
   */
  static buildAdjacency(
    edges: readonly RelationEdge[],
    direction: RelationTraversalDirection = "both",
  ): Map<string, AdjacencyHop[]> {
    const adjacency = new Map<string, AdjacencyHop[]>();

    const push = (fromId: string, hop: AdjacencyHop): void => {
      const list = adjacency.get(fromId);
      if (list) {
        list.push(hop);
      } else {
        adjacency.set(fromId, [hop]);
      }
    };

    for (const edge of edges) {
      const sourceId = edge.sourceEntryId;
      const targetId = edge.targetEntryId;
      if (!sourceId || !targetId || sourceId === targetId) {
        continue;
      }

      if (direction === "outgoing" || direction === "both") {
        push(sourceId, {
          neighborId: targetId,
          relation: edge,
          traversedAs: "outgoing",
        });
      }
      if (direction === "incoming" || direction === "both") {
        push(targetId, {
          neighborId: sourceId,
          relation: edge,
          traversedAs: "incoming",
        });
      }
    }

    for (const hops of adjacency.values()) {
      hops.sort((a, b) => {
        const byRelation = a.relation.id.localeCompare(b.relation.id);
        if (byRelation !== 0) {
          return byRelation;
        }
        return a.traversedAs.localeCompare(b.traversedAs);
      });
    }

    return adjacency;
  }

  /**
   * Expand the relation graph from `seedEntryId` with depth limiting,
   * cycle detection, and deduplication of already-included entries.
   *
   * Uses BFS so nearer neighbors win discovery order. When an edge points at
   * an entry already in the result set it is recorded in `skippedCycles`
   * (covers both true cycles and diamond reconvergence) and is not followed
   * again — preventing infinite loops.
   */
  static expandFromSeed(input: ExpandFromSeedInput): ExpandFromSeedResult {
    const seedEntryId = input.seedEntryId;
    const maxDepth =
      input.maxDepth === undefined ? RelationEngine.DEFAULT_MAX_DEPTH : input.maxDepth;
    const direction = input.direction ?? "both";

    if (!seedEntryId) {
      return {
        seedEntryId: seedEntryId ?? "",
        maxDepth,
        entryIds: [],
        entries: [],
        includedRelationIds: [],
        skippedCycles: [],
        truncatedByDepth: false,
      };
    }

    if (maxDepth < 0) {
      return {
        seedEntryId,
        maxDepth,
        entryIds: [],
        entries: [],
        includedRelationIds: [],
        skippedCycles: [],
        truncatedByDepth: false,
      };
    }

    const adjacency = RelationEngine.buildAdjacency(input.edges, direction);

    const seedNode: ExpandedEntry = {
      entryId: seedEntryId,
      depth: 0,
      viaRelationId: null,
      fromEntryId: null,
      traversedAs: "seed",
    };

    const entries: ExpandedEntry[] = [seedNode];
    const entryIds: string[] = [seedEntryId];
    const visited = new Set<string>([seedEntryId]);
    const includedRelationIds: string[] = [];
    const skippedCycles: SkippedCycleEdge[] = [];
    let truncatedByDepth = false;

    // Queue of entry ids to expand; depth is taken from the discovered node.
    const queue: string[] = [seedEntryId];
    const depthByEntry = new Map<string, number>([[seedEntryId, 0]]);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentDepth = depthByEntry.get(currentId) ?? 0;

      if (currentDepth >= maxDepth) {
        const hops = adjacency.get(currentId);
        if (hops && hops.length > 0) {
          // Neighbors exist past the limit — mark truncation, but still
          // record cycle skips among already-visited neighbors at this frontier.
          for (const hop of hops) {
            if (visited.has(hop.neighborId)) {
              skippedCycles.push({
                relationId: hop.relation.id,
                fromEntryId: currentId,
                toEntryId: hop.neighborId,
                depth: currentDepth,
              });
            } else {
              truncatedByDepth = true;
            }
          }
        }
        continue;
      }

      const hops = adjacency.get(currentId) ?? [];
      for (const hop of hops) {
        if (visited.has(hop.neighborId)) {
          skippedCycles.push({
            relationId: hop.relation.id,
            fromEntryId: currentId,
            toEntryId: hop.neighborId,
            depth: currentDepth + 1,
          });
          continue;
        }

        visited.add(hop.neighborId);
        const nextDepth = currentDepth + 1;
        depthByEntry.set(hop.neighborId, nextDepth);
        entryIds.push(hop.neighborId);
        entries.push({
          entryId: hop.neighborId,
          depth: nextDepth,
          viaRelationId: hop.relation.id,
          fromEntryId: currentId,
          traversedAs: hop.traversedAs,
        });
        includedRelationIds.push(hop.relation.id);
        queue.push(hop.neighborId);
      }
    }

    return {
      seedEntryId,
      maxDepth,
      entryIds,
      entries,
      includedRelationIds,
      skippedCycles,
      truncatedByDepth,
    };
  }

  /**
   * Convenience: unique related entry ids within `maxDepth` (excluding seed).
   */
  static relatedEntryIds(input: ExpandFromSeedInput): string[] {
    const result = RelationEngine.expandFromSeed(input);
    return result.entryIds.filter((id) => id !== result.seedEntryId);
  }

  /**
   * True when the directed edge list contains a cycle reachable from `seedEntryId`
   * under the given traversal direction (ignores depth limits).
   */
  static hasCycleFromSeed(
    seedEntryId: string,
    edges: readonly RelationEdge[],
    direction: RelationTraversalDirection = "both",
  ): boolean {
    if (!seedEntryId) {
      return false;
    }

    const adjacency = RelationEngine.buildAdjacency(edges, direction);
    const visiting = new Set<string>();
    const done = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) {
        return true;
      }
      if (done.has(nodeId)) {
        return false;
      }
      visiting.add(nodeId);
      for (const hop of adjacency.get(nodeId) ?? []) {
        if (dfs(hop.neighborId)) {
          return true;
        }
      }
      visiting.delete(nodeId);
      done.add(nodeId);
      return false;
    };

    return dfs(seedEntryId);
  }
}
