/** Client-safe display helpers for the AI drawer's advanced panel (STO-1265). */

import type { AppliedGenerationMetadata } from "./applied";
import type { AvailabilityReason } from "./types";

export const AVAILABILITY_LABELS: Record<AvailabilityReason, string> = {
  available: "Available",
  unsupported: "Not supported by this API/model",
  unverified: "Support not verified for this route",
  not_integrated: "Provider supports this; inkstory integration not available yet",
};

/** Parses the Min-P draft; null when empty or out of range. */
export function parseMinPDraft(raw: string): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

export function describeApplied(applied: AppliedGenerationMetadata): string {
  const parts = Object.entries(applied.parameters).map(([k, v]) => `${k} ${v}`);
  if (applied.endpoint) parts.push(`endpoint ${applied.endpoint}`);
  if (applied.routing?.requireParameters) parts.push("require_parameters");
  parts.push(
    applied.avoidanceGuidance === "included"
      ? "avoidance guidance included (not enforced)"
      : "no avoidance guidance",
  );
  return parts.join(" · ");
}
