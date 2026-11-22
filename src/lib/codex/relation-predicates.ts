/**
 * Relation Linker predicate catalog (JGF-128, design rev 4 §1.1 item 2).
 *
 * Pure, DB-agnostic predicate/symmetry rules so the RelationLinkerModal and
 * its tests share one source of truth. Predicates use the lowercase snake
 * labels from the spec (`allies_with`, `rivals`, `parent_of`,
 * `in_conflict_with`); `custom` lets the author type their own label.
 */

export type RelationPredicateId =
  | "allies_with"
  | "rivals"
  | "parent_of"
  | "in_conflict_with"
  | "custom";

export interface RelationPredicate {
  id: RelationPredicateId;
  /** Human label for the selector. */
  label: string;
  /**
   * Symmetric predicates read identically in both directions
   * (A rivals B ⇔ B rivals A). For those, enabling the bidirectional toggle
   * stores the same type as the reverse label.
   */
  symmetric: boolean;
  /**
   * Inverse label stored when the relation is asymmetric and the author
   * still wants the reverse edge labelled (e.g. parent_of → child_of).
   * Null when no canonical inverse exists.
   */
  inverseType: string | null;
}

export const RELATION_PREDICATES: readonly RelationPredicate[] = [
  { id: "allies_with", label: "Allies with", symmetric: true, inverseType: "allies_with" },
  { id: "rivals", label: "Rivals", symmetric: true, inverseType: "rivals" },
  { id: "parent_of", label: "Parent of", symmetric: false, inverseType: "child_of" },
  {
    id: "in_conflict_with",
    label: "In conflict with",
    symmetric: true,
    inverseType: "in_conflict_with",
  },
  { id: "custom", label: "Custom…", symmetric: false, inverseType: null },
] as const;

export function getPredicate(id: RelationPredicateId): RelationPredicate {
  return RELATION_PREDICATES.find((p) => p.id === id) ?? RELATION_PREDICATES[4];
}

export interface ResolvedRelationTypes {
  /** Forward edge label stored on the relation row. */
  relationType: string;
  /**
   * Reverse edge label, or null when the author did not ask for a
   * bidirectional edge.
   */
  reverseType: string | null;
}

/**
 * Resolves the stored relation/reverse labels from the modal's predicate
 * selector, custom label, and bidirectional symmetry toggle.
 *
 * Rules:
 * - `custom` uses the author's trimmed label as the forward type.
 * - Bidirectional + symmetric predicate → reverse mirrors the forward label.
 * - Bidirectional + asymmetric predicate with a canonical inverse
 *   (parent_of) → reverse is the inverse label (child_of).
 * - Bidirectional + custom → reverse mirrors the custom label (the toggle
 *   asserts the author's custom relation reads the same both ways).
 * - Toggle off → no reverse label, regardless of predicate.
 */
export function resolveRelationTypes(
  predicateId: RelationPredicateId,
  options: { bidirectional: boolean; customLabel?: string },
): ResolvedRelationTypes {
  const predicate = getPredicate(predicateId);
  const customLabel = (options.customLabel ?? "").trim();
  const relationType = predicate.id === "custom" ? customLabel : predicate.id;

  if (!options.bidirectional || !relationType) {
    return { relationType, reverseType: null };
  }
  if (predicate.symmetric || predicate.id === "custom") {
    return { relationType, reverseType: relationType };
  }
  return { relationType, reverseType: predicate.inverseType };
}

/** Validates modal state; returns an author-readable error or null. */
export function validateRelationDraft(input: {
  predicateId: RelationPredicateId;
  customLabel?: string;
  targetEntryId: string;
}): string | null {
  if (!input.targetEntryId) {
    return "Please choose the target entity.";
  }
  if (input.predicateId === "custom" && !(input.customLabel ?? "").trim()) {
    return "Please name the custom relation.";
  }
  return null;
}
