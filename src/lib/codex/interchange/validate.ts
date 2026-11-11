/**
 * Bounded JSON parsing and envelope validation for Codex interchange.
 * Pure: no DB, auth or network access.
 */

import { CodexError } from "../errors";
import type { JsonValue } from "../types";
import {
  INTERCHANGE_ENVELOPE_KEY,
  INTERCHANGE_SCHEMA_VERSION,
  LOREBOOK_FORMAT,
  type InterchangeEnvelope,
  type InterchangeObject,
} from "./types";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TRACKING_MODES = new Set(["ALWAYS", "DETECTED", "NEVER"]);

export function invalid(message: string): CodexError {
  return new CodexError(message, "VALIDATION_FAILED", 422);
}

export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function isPlainObject(value: unknown): value is InterchangeObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface JsonLimits {
  maxFileBytes: number;
  maxDepth: number;
  maxStringLength: number;
}

function assertSafeJson(value: unknown, limits: JsonLimits, depth: number, path: string): void {
  if (depth > limits.maxDepth) {
    throw invalid(`File is nested too deeply (limit ${limits.maxDepth}) at ${path}`);
  }
  if (typeof value === "string") {
    if (value.length > limits.maxStringLength) {
      throw invalid(`Text at ${path} exceeds ${limits.maxStringLength} characters`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertSafeJson(item, limits, depth + 1, `${path}[${i}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw invalid(`Forbidden key "${key}" at ${path}`);
      }
      assertSafeJson(value[key], limits, depth + 1, `${path}.${key}`);
    }
  }
}

/**
 * Parses untrusted file text as JSON within size, depth and string limits,
 * rejecting prototype-pollution keys. Throws 422 VALIDATION_FAILED.
 */
export function parseBoundedJson(raw: unknown, limits: JsonLimits): JsonValue {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw invalid("File content is required");
  }
  if (new TextEncoder().encode(raw).length > limits.maxFileBytes) {
    throw invalid(`File exceeds ${limits.maxFileBytes} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalid("File is not valid JSON");
  }
  assertSafeJson(parsed, limits, 0, "$");
  return parsed as JsonValue;
}

export type EnvelopeRead =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "ok"; envelope: InterchangeEnvelope };

/**
 * Reads and validates the reserved interchange envelope from customFields.
 * Anything malformed (e.g. hand-edited) is reported as invalid, never trusted.
 */
export function readInterchangeEnvelope(customFields: unknown): EnvelopeRead {
  if (!isPlainObject(customFields) || !(INTERCHANGE_ENVELOPE_KEY in customFields)) {
    return { status: "absent" };
  }
  const env = customFields[INTERCHANGE_ENVELOPE_KEY];
  if (
    !isPlainObject(env) ||
    env.schemaVersion !== INTERCHANGE_SCHEMA_VERSION ||
    env.format !== LOREBOOK_FORMAT ||
    typeof env.sourceVersion !== "string" ||
    typeof env.groupId !== "string" ||
    typeof env.sourceEntryKey !== "string" ||
    typeof env.sourceOrder !== "number" ||
    !isPlainObject(env.originalEntry) ||
    !isPlainObject(env.bookMetadata) ||
    typeof env.mappingVersion !== "number" ||
    typeof env.importedTrackingMode !== "string" ||
    !TRACKING_MODES.has(env.importedTrackingMode) ||
    !Array.isArray(env.unsupportedFeatures) ||
    !env.unsupportedFeatures.every((f) => typeof f === "string")
  ) {
    return { status: "invalid" };
  }
  return { status: "ok", envelope: env as unknown as InterchangeEnvelope };
}

/** Returns a copy of customFields without the reserved envelope key. */
export function stripReservedEnvelope(
  customFields: Record<string, JsonValue> | null | undefined,
): Record<string, JsonValue> | null | undefined {
  if (!isPlainObject(customFields) || !(INTERCHANGE_ENVELOPE_KEY in customFields)) {
    return customFields;
  }
  const { [INTERCHANGE_ENVELOPE_KEY]: _reserved, ...rest } = customFields;
  return rest;
}

/**
 * Generic Codex writes may not create or change the reserved envelope: drop
 * any client-supplied value and carry over the server's stored one.
 */
export function protectReservedEnvelope(
  incoming: Record<string, JsonValue> | null,
  stored: unknown,
): Record<string, JsonValue> | null {
  const cleaned = stripReservedEnvelope(incoming) ?? null;
  if (!isPlainObject(stored) || !(INTERCHANGE_ENVELOPE_KEY in stored)) {
    return cleaned;
  }
  return { ...cleaned, [INTERCHANGE_ENVELOPE_KEY]: stored[INTERCHANGE_ENVELOPE_KEY] };
}
