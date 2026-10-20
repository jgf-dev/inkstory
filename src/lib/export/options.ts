import {
  ExportError,
  type ExportContentMode,
  type ExportFormat,
  type ExportOptions,
} from "./types";

const FORMATS: readonly ExportFormat[] = ["md", "docx"];
const CONTENT_MODES: readonly ExportContentMode[] = ["prose", "summary", "both"];

function parseBool(value: string | null, fallback: boolean, name: string): boolean {
  if (value === null || value === "") return fallback;
  const v = value.toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  throw new ExportError(`Invalid boolean for ${name}: ${value}`, "VALIDATION_FAILED", 400);
}

function parseIdList(params: URLSearchParams, name: string): string[] {
  return params
    .getAll(name)
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Parses export options from query parameters.
 *
 * `format=md|docx` (default md), `content=prose|summary|both` (default prose),
 * `actTitles`, `chapterTitles`, `sceneTitles`, `subtitles` (booleans, default
 * true), and `actIds`, `chapterIds`, `sceneIds` (comma-separated or repeated).
 */
export function parseExportOptions(params: URLSearchParams): ExportOptions {
  const format = (params.get("format") ?? "md").toLowerCase();
  if (!FORMATS.includes(format as ExportFormat)) {
    throw new ExportError(
      `Unsupported format: ${format}. Use md or docx.`,
      "VALIDATION_FAILED",
      400,
    );
  }
  const content = (params.get("content") ?? "prose").toLowerCase();
  if (!CONTENT_MODES.includes(content as ExportContentMode)) {
    throw new ExportError(
      `Unsupported content: ${content}. Use prose, summary or both.`,
      "VALIDATION_FAILED",
      400,
    );
  }
  return {
    format: format as ExportFormat,
    content: content as ExportContentMode,
    includeActTitles: parseBool(params.get("actTitles"), true, "actTitles"),
    includeChapterTitles: parseBool(params.get("chapterTitles"), true, "chapterTitles"),
    includeSceneTitles: parseBool(params.get("sceneTitles"), true, "sceneTitles"),
    includeSubtitles: parseBool(params.get("subtitles"), true, "subtitles"),
    actIds: parseIdList(params, "actIds"),
    chapterIds: parseIdList(params, "chapterIds"),
    sceneIds: parseIdList(params, "sceneIds"),
  };
}
