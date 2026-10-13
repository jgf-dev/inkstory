/**
 * Request validation for the context inspection API (STO-1171).
 * Kept out of the route module because Next.js route files may only export
 * HTTP handlers and route config.
 */

import type { AssembleSceneContextInput } from "./service";

export type ValidationResult =
  | { ok: true; input: AssembleSceneContextInput }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalCount(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

/** Validate the request body into an {@link AssembleSceneContextInput}. */
export function parseAssembleContextBody(body: unknown): ValidationResult {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  const { sceneId, novelId, beatText, recentProse, manualAttachmentIds, options } = body;

  if (typeof sceneId !== "string" || !sceneId.trim()) {
    return { ok: false, error: "Missing required string 'sceneId'" };
  }
  if (!isOptionalString(novelId)) {
    return { ok: false, error: "'novelId' must be a string" };
  }
  if (!isOptionalString(beatText) || !isOptionalString(recentProse)) {
    return { ok: false, error: "'beatText' and 'recentProse' must be strings" };
  }
  if (
    manualAttachmentIds !== undefined &&
    !(
      Array.isArray(manualAttachmentIds) &&
      manualAttachmentIds.every((id) => typeof id === "string")
    )
  ) {
    return { ok: false, error: "'manualAttachmentIds' must be an array of strings" };
  }
  if (options !== undefined && !isPlainObject(options)) {
    return { ok: false, error: "'options' must be an object" };
  }
  if (
    options &&
    (!isOptionalCount(options.maxEntries) || !isOptionalCount(options.maxRelationDepth))
  ) {
    return {
      ok: false,
      error: "'options.maxEntries' and 'options.maxRelationDepth' must be non-negative numbers",
    };
  }
  if (
    options &&
    options.includeSeriesCodex !== undefined &&
    typeof options.includeSeriesCodex !== "boolean"
  ) {
    return { ok: false, error: "'options.includeSeriesCodex' must be a boolean" };
  }

  return {
    ok: true,
    input: {
      sceneId,
      novelId,
      beatText,
      recentProse,
      manualAttachmentIds: manualAttachmentIds as string[] | undefined,
      options: options as AssembleSceneContextInput["options"],
    },
  };
}
