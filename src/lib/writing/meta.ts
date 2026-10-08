/** POV values accepted by scene metadata updates (mirrors the `Pov` enum). */
export const POV_VALUES = ["FIRST", "SECOND", "THIRD_LIMITED", "THIRD_OMNISCIENT"] as const;

/** Tense values accepted by scene metadata updates (mirrors the `Tense` enum). */
export const TENSE_VALUES = ["PAST", "PRESENT", "FUTURE"] as const;

export type PovValue = (typeof POV_VALUES)[number];
export type TenseValue = (typeof TENSE_VALUES)[number];

/**
 * Human-readable labels for the POV and Tense enums, shared by the editor
 * metadata drawer and prompt directives.
 */
export const POV_LABELS: Record<PovValue, string> = {
  FIRST: "First person",
  SECOND: "Second person",
  THIRD_LIMITED: "Third person limited",
  THIRD_OMNISCIENT: "Third person omniscient",
};

export const TENSE_LABELS: Record<TenseValue, string> = {
  PAST: "Past",
  PRESENT: "Present",
  FUTURE: "Future",
};

/** Type guard for POV values coming from untrusted request bodies. */
export function isPovValue(value: unknown): value is PovValue {
  return typeof value === "string" && (POV_VALUES as readonly string[]).includes(value);
}

/** Type guard for Tense values coming from untrusted request bodies. */
export function isTenseValue(value: unknown): value is TenseValue {
  return typeof value === "string" && (TENSE_VALUES as readonly string[]).includes(value);
}
