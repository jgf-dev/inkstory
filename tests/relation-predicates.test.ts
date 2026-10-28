import { describe, expect, it } from "vite-plus/test";
import {
  getPredicate,
  RELATION_PREDICATES,
  resolveRelationTypes,
  validateRelationDraft,
} from "../src/lib/codex/relation-predicates";

describe("relation predicates (JGF-128)", () => {
  it("catalogs exactly the spec predicates", () => {
    expect(RELATION_PREDICATES.map((p) => p.id)).toEqual([
      "allies_with",
      "rivals",
      "parent_of",
      "in_conflict_with",
      "custom",
    ]);
  });

  it("resolves symmetric predicates with the bidirectional toggle on", () => {
    expect(resolveRelationTypes("rivals", { bidirectional: true })).toEqual({
      relationType: "rivals",
      reverseType: "rivals",
    });
    expect(resolveRelationTypes("allies_with", { bidirectional: true })).toEqual({
      relationType: "allies_with",
      reverseType: "allies_with",
    });
    expect(resolveRelationTypes("in_conflict_with", { bidirectional: true })).toEqual({
      relationType: "in_conflict_with",
      reverseType: "in_conflict_with",
    });
  });

  it("stores no reverse label when the toggle is off, even for symmetric predicates", () => {
    expect(resolveRelationTypes("rivals", { bidirectional: false })).toEqual({
      relationType: "rivals",
      reverseType: null,
    });
    expect(resolveRelationTypes("parent_of", { bidirectional: false })).toEqual({
      relationType: "parent_of",
      reverseType: null,
    });
  });

  it("resolves asymmetric parent_of to child_of when bidirectional", () => {
    expect(resolveRelationTypes("parent_of", { bidirectional: true })).toEqual({
      relationType: "parent_of",
      reverseType: "child_of",
    });
  });

  it("resolves custom labels, trimming whitespace, and mirrors them when bidirectional", () => {
    expect(
      resolveRelationTypes("custom", { bidirectional: true, customLabel: "  bound_to  " }),
    ).toEqual({ relationType: "bound_to", reverseType: "bound_to" });
    expect(
      resolveRelationTypes("custom", { bidirectional: false, customLabel: "sworn_enemy_of" }),
    ).toEqual({ relationType: "sworn_enemy_of", reverseType: null });
  });

  it("never emits a reverse label for an empty custom label", () => {
    expect(resolveRelationTypes("custom", { bidirectional: true, customLabel: "   " })).toEqual({
      relationType: "",
      reverseType: null,
    });
  });

  it("getPredicate falls back to custom for unknown ids", () => {
    expect(getPredicate("custom").id).toBe("custom");
  });

  it("validates target and custom label", () => {
    expect(validateRelationDraft({ predicateId: "rivals", targetEntryId: "" })).toBe(
      "Please choose the target entity.",
    );
    expect(
      validateRelationDraft({ predicateId: "custom", targetEntryId: "b", customLabel: " " }),
    ).toBe("Please name the custom relation.");
    expect(validateRelationDraft({ predicateId: "rivals", targetEntryId: "b" })).toBeNull();
  });
});
