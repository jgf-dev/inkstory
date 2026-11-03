import {
  ImportError,
  type ImportAct,
  type ImportChapter,
  type ImportManuscript,
  type ImportPreview,
} from "./types";

/**
 * Manual structure override for the import preview (STO-1211).
 *
 * One entry per detected scene, in document order. A non-null `act` starts a
 * new act with that title at this scene; a non-null `chapter` starts a new
 * chapter. The first scene must start both, and a new act must also start a
 * new chapter. Scenes keep their prose, summary and order: the override only
 * regroups and renames, so it can be re-applied to a fresh parse of the same
 * file.
 */
export interface ImportStructureOverride {
  scenes: ImportSceneOverride[];
}

export interface ImportSceneOverride {
  title: string;
  act: string | null;
  chapter: string | null;
}

/** Longest act, chapter or scene title accepted in an override. */
export const MAX_OVERRIDE_TITLE_LENGTH = 500;

const invalid = (message: string) => new ImportError(message, "VALIDATION_FAILED", 400);

/**
 * The override that reproduces a preview's structure as-is (the starting
 * point for manual edits). Acts or chapters without scenes cannot be
 * represented and are dropped.
 */
export function structureOverrideFromPreview(preview: ImportPreview): ImportStructureOverride {
  const scenes: ImportSceneOverride[] = [];
  for (const act of preview.acts) {
    let actStart: string | null = act.title;
    for (const chapter of act.chapters) {
      let chapterStart: string | null = chapter.title;
      for (const scene of chapter.scenes) {
        scenes.push({ title: scene.title, act: actStart, chapter: chapterStart });
        actStart = null;
        chapterStart = null;
      }
    }
  }
  return { scenes };
}

function readTitle(value: unknown, what: string, nullable: boolean): string | null {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw invalid(`Structure override: ${what} is required`);
  }
  if (typeof value !== "string") throw invalid(`Structure override: ${what} must be a string`);
  const title = value.trim();
  if (!title) throw invalid(`Structure override: ${what} cannot be empty`);
  if (title.length > MAX_OVERRIDE_TITLE_LENGTH) {
    throw invalid(
      `Structure override: ${what} is longer than ${MAX_OVERRIDE_TITLE_LENGTH} characters`,
    );
  }
  return title;
}

/**
 * Parses and validates the `structure` form field. Returns null when the field
 * is absent or blank (keep the detected structure). Titles are trimmed.
 */
export function parseStructureOverride(raw: string | null): ImportStructureOverride | null {
  if (raw === null || !raw.trim()) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw invalid("Structure override must be valid JSON");
  }
  const list = (data as { scenes?: unknown } | null)?.scenes;
  if (!Array.isArray(list) || !list.length) {
    throw invalid("Structure override needs a non-empty scenes list");
  }
  const scenes = list.map((entry: unknown, i): ImportSceneOverride => {
    if (!entry || typeof entry !== "object") {
      throw invalid(`Structure override: scene ${i + 1} must be an object`);
    }
    const e = entry as Record<string, unknown>;
    const scene = {
      title: readTitle(e.title, `scene ${i + 1} title`, false) as string,
      act: readTitle(e.act, `scene ${i + 1} act title`, true),
      chapter: readTitle(e.chapter, `scene ${i + 1} chapter title`, true),
    };
    if (scene.act !== null && scene.chapter === null) {
      throw invalid(`Structure override: scene ${i + 1} starts an act but not a chapter`);
    }
    return scene;
  });
  if (scenes[0].act === null || scenes[0].chapter === null) {
    throw invalid("Structure override: the first scene must start an act and a chapter");
  }
  return { scenes };
}

/**
 * Regroups a parsed manuscript's scenes into the acts and chapters described
 * by the override. The override must have exactly one entry per scene (a
 * mismatch means it was built for a different parse, e.g. after toggling
 * summaries or changing the file).
 */
export function applyStructureOverride(
  manuscript: ImportManuscript,
  override: ImportStructureOverride,
): ImportManuscript {
  const sources = manuscript.acts.flatMap((a) => a.chapters.flatMap((c) => c.scenes));
  if (sources.length !== override.scenes.length) {
    throw invalid(
      `Structure override lists ${override.scenes.length} scenes but the file has ${sources.length}. Preview the file again.`,
    );
  }
  const acts: ImportAct[] = [];
  let act: ImportAct | null = null;
  let chapter: ImportChapter | null = null;
  for (const [i, entry] of override.scenes.entries()) {
    if (entry.act !== null || !act) {
      act = { title: entry.act ?? `Act ${acts.length + 1}`, chapters: [] };
      acts.push(act);
      chapter = null;
    }
    if (entry.chapter !== null || !chapter) {
      chapter = { title: entry.chapter ?? `Chapter ${act.chapters.length + 1}`, scenes: [] };
      act.chapters.push(chapter);
    }
    chapter.scenes.push({ ...sources[i], title: entry.title });
  }
  return { ...manuscript, acts };
}
