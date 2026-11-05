"use client";

import { useState } from "react";
import type { ImportPreview } from "@/lib/import/types";
import {
  structureOverrideFromPreview,
  type ImportSceneOverride,
  type ImportStructureOverride,
} from "@/lib/import/override";
import { Modal, modalLabelClasses } from "@/app/dashboard/codex/_components/Modal";
import { apiPostForm, ApiRequestError } from "./api";

export interface ImportManuscriptResult {
  preview: ImportPreview;
  actIds: string[];
  titleApplied: boolean;
}

export interface ImportManuscriptDialogProps {
  novelId: string;
  /** The book's current title, shown next to the detected one. */
  novelTitle: string;
  onClose: () => void;
  /** Called after a confirmed import has been written. */
  onImported: (result: ImportManuscriptResult) => void | Promise<void>;
}

/** File types the import API accepts (`POST /api/books/[id]/import`). */
export const IMPORT_ACCEPT = ".md,.markdown,.html,.htm,.docx";

const buttonClasses =
  "min-h-11 rounded-md border border-ink-200 px-4 text-sm font-medium text-secondary hover:bg-ink-100 disabled:opacity-50";
const primaryButtonClasses =
  "min-h-11 rounded-md bg-ink-800 px-4 text-sm font-medium text-ink-50 hover:bg-ink-700 disabled:opacity-50";

function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

const inputClasses =
  "min-h-11 w-full rounded-md border border-ink-200 bg-transparent px-2 text-sm text-primary";

function blankTitle(value: string | null): boolean {
  return value !== null && !value.trim();
}

/** Whether any title in the draft override is blank. */
function hasBlankTitle(draft: ImportStructureOverride): boolean {
  return draft.scenes.some((s) => !s.title.trim() || blankTitle(s.chapter) || blankTitle(s.act));
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  return err instanceof Error ? err.message : "Import failed";
}

/**
 * Upload → preview → confirm flow for manuscript import (STO-1213). Nothing
 * is written until the author confirms the previewed structure; imported acts
 * are appended after the book's existing acts.
 */
export function ImportManuscriptDialog({
  novelId,
  novelTitle,
  onClose,
  onImported,
}: ImportManuscriptDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [summaries, setSummaries] = useState(true);
  const [applyTitle, setApplyTitle] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  /** Preview as detected from the file, before any manual override. */
  const [detected, setDetected] = useState<ImportPreview | null>(null);
  /** Applied manual override (STO-1211), sent with the confirm request. */
  const [structure, setStructure] = useState<ImportStructureOverride | null>(null);
  /** Override being edited; confirm is blocked until it is applied or dropped. */
  const [draft, setDraft] = useState<ImportStructureOverride | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = `/api/books/${novelId}/import`;

  function buildForm(confirm: boolean, override = structure): FormData {
    const form = new FormData();
    form.append("file", file as File);
    form.append("summaries", String(summaries));
    if (override) form.append("structure", JSON.stringify(override));
    if (confirm) {
      form.append("confirm", "true");
      form.append("applyTitle", String(applyTitle));
    }
    return form;
  }

  async function handlePreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPostForm<{ preview: ImportPreview }>(url, buildForm(false, null));
      setPreview(res.preview);
      setDetected(res.preview);
      setStructure(null);
      setDraft(null);
      setApplyTitle(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!file || !preview) return;
    setBusy(true);
    setError(null);
    let result: ImportManuscriptResult;
    try {
      result = await apiPostForm<ImportManuscriptResult>(url, buildForm(true));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      return;
    }
    // The import is committed; a failed refresh must not invite a duplicate
    // re-import, so close regardless (a page reload shows the new acts).
    try {
      await onImported(result);
    } catch {
      // Ignored: the outline refresh is best-effort after a committed import.
    }
    onClose();
  }

  async function handleApplyStructure() {
    if (!file || !draft) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPostForm<{ preview: ImportPreview }>(url, buildForm(false, draft));
      setPreview(res.preview);
      setStructure(draft);
      setDraft(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function resetStructure() {
    setPreview(detected);
    setStructure(null);
    setDraft(null);
    setError(null);
  }

  function updateScene(index: number, patch: Partial<ImportSceneOverride>) {
    setDraft((current) =>
      current
        ? {
            scenes: current.scenes.map((scene, i) =>
              i === index ? { ...scene, ...patch } : scene,
            ),
          }
        : current,
    );
  }

  // Number a new act/chapter from the ones already started before this scene,
  // matching how the server numbers them, not from the scene position.
  function nextNumber(index: number, key: "act" | "chapter"): number {
    const scenes = draft?.scenes ?? [];
    return scenes.slice(0, index).filter((s) => s[key] !== null).length + 1;
  }

  function toggleChapter(index: number, on: boolean) {
    // Dropping a chapter start also drops the act start it carried.
    updateScene(
      index,
      on ? { chapter: `Chapter ${nextNumber(index, "chapter")}` } : { chapter: null, act: null },
    );
  }

  function toggleAct(index: number, on: boolean, scene: ImportSceneOverride) {
    updateScene(
      index,
      on
        ? {
            act: `Act ${nextNumber(index, "act")}`,
            chapter: scene.chapter ?? `Chapter ${nextNumber(index, "chapter")}`,
          }
        : { act: null },
    );
  }

  function resetPreview() {
    setPreview(null);
    setDetected(null);
    setStructure(null);
    setDraft(null);
    setError(null);
  }

  const hasDetectedTitle = !!(preview?.title?.trim() || preview?.subtitle?.trim());

  return (
    <Modal title="Import manuscript" onClose={onClose} testId="import-manuscript-dialog">
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {preview ? (
        <div className="space-y-4" data-testid="import-preview">
          <p className="text-sm text-secondary" data-testid="import-totals">
            {plural(preview.totals.acts, "act")}, {plural(preview.totals.chapters, "chapter")},{" "}
            {plural(preview.totals.scenes, "scene")} · {plural(preview.totals.words, "word")}
          </p>

          <ul className="max-h-60 space-y-2 overflow-y-auto rounded-md border border-ink-200 p-3 text-sm">
            {preview.acts.map((act, ai) => (
              <li key={`act-${ai}`}>
                <span className="font-semibold text-primary">{act.title}</span>
                <ul className="ml-4 mt-1 space-y-1">
                  {act.chapters.map((chapter, ci) => (
                    <li key={`chapter-${ai}-${ci}`}>
                      <span className="font-medium text-ink-700">{chapter.title}</span>
                      <span className="text-muted ml-2 text-xs">
                        {plural(chapter.scenes.length, "scene")} ·{" "}
                        {plural(chapter.wordCount, "word")}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          {draft ? (
            <fieldset
              className="space-y-3 rounded-md border border-ink-200 p-3"
              data-testid="import-structure-editor"
            >
              <legend className="px-1 text-xs font-medium text-secondary">Adjust structure</legend>
              <p className="text-muted text-xs">
                Mark where acts and chapters start and rename anything. Scenes keep their order and
                text.
              </p>
              <ol className="max-h-72 space-y-3 overflow-y-auto">
                {draft.scenes.map((scene, i) => (
                  <li
                    key={`scene-${i}`}
                    className="space-y-2 border-b border-ink-100 pb-3 last:border-0"
                  >
                    <div className="flex flex-wrap gap-4 text-xs text-secondary">
                      <label className="flex min-h-11 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={scene.act !== null}
                          disabled={i === 0}
                          onChange={(e) => toggleAct(i, e.target.checked, scene)}
                          className="h-4 w-4 rounded border-ink-300"
                        />
                        <span>New act</span>
                      </label>
                      <label className="flex min-h-11 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={scene.chapter !== null}
                          disabled={i === 0}
                          onChange={(e) => toggleChapter(i, e.target.checked)}
                          className="h-4 w-4 rounded border-ink-300"
                        />
                        <span>New chapter</span>
                      </label>
                    </div>
                    {scene.act !== null && (
                      <input
                        type="text"
                        aria-label={`Act title at scene ${i + 1}`}
                        value={scene.act}
                        onChange={(e) => updateScene(i, { act: e.target.value })}
                        className={inputClasses}
                      />
                    )}
                    {scene.chapter !== null && (
                      <input
                        type="text"
                        aria-label={`Chapter title at scene ${i + 1}`}
                        value={scene.chapter}
                        onChange={(e) => updateScene(i, { chapter: e.target.value })}
                        className={inputClasses}
                      />
                    )}
                    <input
                      type="text"
                      aria-label={`Scene ${i + 1} title`}
                      value={scene.title}
                      onChange={(e) => updateScene(i, { title: e.target.value })}
                      className={inputClasses}
                    />
                  </li>
                ))}
              </ol>
              {hasBlankTitle(draft) && (
                <p className="text-xs text-red-700" data-testid="import-structure-blank">
                  Titles cannot be empty.
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  disabled={busy}
                  className={buttonClasses}
                >
                  Discard changes
                </button>
                <button
                  type="button"
                  onClick={handleApplyStructure}
                  disabled={busy || hasBlankTitle(draft)}
                  className={primaryButtonClasses}
                >
                  {busy ? "Updating…" : "Apply structure"}
                </button>
              </div>
            </fieldset>
          ) : (
            preview.totals.scenes > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDraft(structureOverrideFromPreview(preview))}
                  disabled={busy}
                  className={buttonClasses}
                >
                  Adjust structure
                </button>
                {structure && (
                  <button
                    type="button"
                    onClick={resetStructure}
                    disabled={busy}
                    className={buttonClasses}
                  >
                    Use detected structure
                  </button>
                )}
              </div>
            )
          )}

          {preview.warnings.length > 0 && (
            <ul
              className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800"
              data-testid="import-warnings"
            >
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          {hasDetectedTitle && (
            <label className="flex min-h-11 items-start gap-3">
              <input
                type="checkbox"
                checked={applyTitle}
                onChange={(e) => setApplyTitle(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-ink-300"
                data-testid="import-apply-title"
              />
              <span className="text-xs text-secondary">
                Apply the detected title
                {preview.title ? (
                  <>
                    {" "}
                    “<strong>{preview.title}</strong>”
                  </>
                ) : null}
                {preview.subtitle ? (
                  <>
                    {" "}
                    and subtitle “<strong>{preview.subtitle}</strong>”
                  </>
                ) : null}{" "}
                to this book (currently “{novelTitle}”).
              </span>
            </label>
          )}

          <p className="text-muted text-xs">
            Imported acts are added after the book&apos;s existing acts.
          </p>

          <div className="flex items-center justify-end gap-2 border-t border-ink-200 pt-4">
            <button type="button" onClick={resetPreview} disabled={busy} className={buttonClasses}>
              Back
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy || draft !== null || preview.totals.scenes === 0}
              className={primaryButtonClasses}
            >
              {busy ? "Importing…" : "Confirm import"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor="import-file" className={modalLabelClasses}>
              Manuscript file
            </label>
            <input
              id="import-file"
              type="file"
              accept={IMPORT_ACCEPT}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
              className="mt-1 block w-full text-sm text-secondary"
            />
            <p className="text-muted mt-1 text-xs">
              .docx, Markdown or HTML, up to 10 MB. Headings map to acts, chapters and scenes.
            </p>
          </div>

          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={summaries}
              onChange={(e) => setSummaries(e.target.checked)}
              className="h-4 w-4 rounded border-ink-300"
              data-testid="import-summaries"
            />
            <span className="text-xs text-secondary">Use blockquotes as scene summaries</span>
          </label>

          <div className="flex items-center justify-end gap-2 border-t border-ink-200 pt-4">
            <button type="button" onClick={onClose} className={buttonClasses}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePreview}
              disabled={!file || busy}
              className={primaryButtonClasses}
            >
              {busy ? "Reading…" : "Preview"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
