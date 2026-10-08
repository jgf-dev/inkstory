import { Temporal } from "temporal-polyfill";

/**
 * Timestamp coercion for rows read through the Prisma 8 contract codec.
 * The ORM returns timestamps as `Temporal.PlainDateTime` (no timezone), while
 * request payloads and serialized props use epoch millis / ISO strings; this
 * helper normalizes both so ordering and serialization stay consistent.
 *
 * Wall-clock values are anchored to UTC (the app writes
 * `Temporal.Now.plainDateTimeISO()` on a UTC server), which keeps ordering
 * monotonic and client display deterministic.
 */
export function toEpochMs(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (value instanceof Temporal.PlainDateTime) {
    return value.toZonedDateTime("UTC").epochMilliseconds;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/** ISO-8601 string (UTC) for client serialization of a row timestamp. */
export function toIsoString(value: unknown): string {
  return new Date(toEpochMs(value)).toISOString();
}
