/**
 * Types for manuscript import (STO-1162).
 *
 * Import parses .md, .html or .docx into the existing Act → Chapter → Scene
 * tree. The heading levels match the export (STO-1163): `#`/h1 novel title,
 * `##`/h2 act, `###`/h3 chapter, `####`/h4 scene. No schema change.
 */

export type ImportFormat = "md" | "html" | "docx";

/** A format-independent unit of the source document. */
export type ImportBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "subtitle"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "break" };

export interface ImportScene {
  title: string;
  subtitle: string | null;
  summary: string | null;
  content: string;
  wordCount: number;
}

export interface ImportChapter {
  title: string;
  scenes: ImportScene[];
}

export interface ImportAct {
  title: string;
  chapters: ImportChapter[];
}

export interface ImportManuscript {
  title: string | null;
  /** Novel subtitle (shown in the preview; applied to the book only with `applyTitle`). */
  subtitle: string | null;
  acts: ImportAct[];
}

export interface ImportOptions {
  /** Keep blockquotes as scene summaries (default). When false they stay in the prose. */
  summaries: boolean;
}

export interface ImportPreview {
  title: string | null;
  subtitle: string | null;
  totals: { acts: number; chapters: number; scenes: number; words: number; summaries: number };
  acts: {
    title: string;
    wordCount: number;
    chapters: {
      title: string;
      wordCount: number;
      scenes: { title: string; wordCount: number; hasSummary: boolean }[];
    }[];
  }[];
  warnings: string[];
}

export class ImportError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "VALIDATION_FAILED" | "UNSUPPORTED_FORMAT",
    public readonly status: number,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

/** Largest accepted upload. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
