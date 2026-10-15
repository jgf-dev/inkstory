/**
 * Types for manuscript export (STO-1163).
 *
 * Export is read-only: it loads the novel tree, filters it by the caller's
 * selection and renders Markdown or DOCX. No schema change.
 */

export type ExportFormat = "md" | "docx";

/** What to emit for each scene. */
export type ExportContentMode = "prose" | "summary" | "both";

export interface ExportOptions {
  format: ExportFormat;
  content: ExportContentMode;
  /** Emit act headings ("# Act title"). */
  includeActTitles: boolean;
  /** Emit chapter headings. */
  includeChapterTitles: boolean;
  /** Emit scene headings. */
  includeSceneTitles: boolean;
  /** Emit novel and scene subtitles. */
  includeSubtitles: boolean;
  /**
   * Selection. When every list is empty the whole novel is exported. Otherwise a
   * scene is included if it, its chapter or its act is selected.
   */
  actIds: string[];
  chapterIds: string[];
  sceneIds: string[];
}

export interface ExportScene {
  id: string;
  title: string;
  subtitle: string | null;
  content: string;
  summary: string | null;
}

export interface ExportChapter {
  id: string;
  title: string;
  scenes: ExportScene[];
}

export interface ExportAct {
  id: string;
  title: string;
  chapters: ExportChapter[];
}

export interface ExportNovel {
  id: string;
  title: string;
  subtitle: string | null;
  acts: ExportAct[];
}

export class ExportError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION_FAILED",
    public readonly status: number,
  ) {
    super(message);
    this.name = "ExportError";
  }
}
