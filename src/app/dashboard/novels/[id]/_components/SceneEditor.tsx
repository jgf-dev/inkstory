"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorScene, SceneRevisionListItem } from "@/lib/writing/service";
import { POV_LABELS, POV_VALUES, TENSE_LABELS, TENSE_VALUES } from "@/lib/writing/meta";
import type { PovValue, TenseValue } from "@/lib/writing/meta";
import { countWords, formatWordCount } from "@/lib/writing/word-count";
import { clearDraft, isDraftRecoverable, loadDraft, saveDraft } from "@/lib/writing/draft";
import { docFromPlainText, plainTextFromDoc, type TiptapDoc } from "@/lib/writing/tiptap";
import { apiGet, apiPatch, apiPost, ApiRequestError } from "./api";
import { RichTextEditor } from "./RichTextEditor";

export interface SceneEditorProps {
  scene: EditorScene;
  /** Parent is notified with the persisted scene after every successful save. */
  onSaved: (scene: EditorScene) => void;
  /** Live prose stream for the parent's debounced mention scan. */
  onProseChange: (prose: string) => void;
  /**
   * Text pushed into the editor from the AI drawer (sequence-numbered so
   * repeated inserts of the same text still apply).
   */
  insertRequest?: { seq: number; text: string; sceneId: string } | null;
  /**
   * Live save-state/word-count stream for the Writer Mode status pill
   * (JGF-128).
   */
  onStatusChange?: (status: SaveStatus, words: number) => void;
  /**
   * `"full"` renders the word count / save state / details cluster in the
   * header; `"focus"` (Writer Mode) moves them to the workspace status pill.
   */
  chrome?: "full" | "focus";
}

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

interface SceneSnapshot {
  title: string;
  content: string;
  contentDoc: TiptapDoc | null;
  summary: string;
  pov: PovValue;
  tense: TenseValue;
  excludeFromAi: boolean;
}

const AUTOSAVE_DEBOUNCE_MS = 800;

function snapshotOf(scene: EditorScene): SceneSnapshot {
  return {
    title: scene.title,
    content: scene.content,
    contentDoc: scene.contentDoc ?? null,
    summary: scene.summary ?? "",
    pov: scene.pov,
    tense: scene.tense,
    excludeFromAi: scene.excludeFromAi,
  };
}

/**
 * Scene Editor (STO-1156): Tiptap rich-text surface with debounced autosave
 * (Cmd/Ctrl+S flushes), live word count, metadata drawer, localStorage draft
 * fallback, and a minimal revision history / restore panel.
 */
export function SceneEditor(props: SceneEditorProps) {
  const { scene } = props;

  const [title, setTitle] = useState(scene.title);
  const [content, setContent] = useState(scene.content);
  const [contentDoc, setContentDoc] = useState<TiptapDoc | null>(scene.contentDoc ?? null);
  const [summary, setSummary] = useState(scene.summary ?? "");
  const [pov, setPov] = useState<PovValue>(scene.pov);
  const [tense, setTense] = useState<TenseValue>(scene.tense);
  const [excludeFromAi, setExcludeFromAi] = useState(scene.excludeFromAi);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [showMeta, setShowMeta] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<SceneRevisionListItem[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [revisionsError, setRevisionsError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoreOffer, setRestoreOffer] = useState<{
    savedAt: number;
    content: string;
    title: string;
    summary: string;
    pov?: PovValue;
    tense?: TenseValue;
    excludeFromAi?: boolean;
  } | null>(null);

  const savedRef = useRef<SceneSnapshot>(snapshotOf(scene));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  const queuedSaveRef = useRef(false);
  const manualFlushRef = useRef(false);

  // Local draft fallback check (per-scene mount; the workspace remounts the
  // editor with a key on scene switch).
  useEffect(() => {
    const draft = loadDraft(scene.id);
    if (isDraftRecoverable(draft, Date.parse(scene.updatedAt))) {
      setRestoreOffer({
        savedAt: draft!.savedAt,
        content: draft!.content,
        title: draft!.title,
        summary: draft!.summary,
        pov: draft!.pov,
        tense: draft!.tense,
        excludeFromAi: draft!.excludeFromAi,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const current: SceneSnapshot = useMemo(
    () => ({ title, content, contentDoc, summary, pov, tense, excludeFromAi }),
    [title, content, contentDoc, summary, pov, tense, excludeFromAi],
  );

  const currentRef = useRef<SceneSnapshot>(current);
  currentRef.current = current;

  function isSnapshotDirty(a: SceneSnapshot, b: SceneSnapshot): boolean {
    return (
      a.title !== b.title ||
      a.content !== b.content ||
      JSON.stringify(a.contentDoc) !== JSON.stringify(b.contentDoc) ||
      a.summary !== b.summary ||
      a.pov !== b.pov ||
      a.tense !== b.tense ||
      a.excludeFromAi !== b.excludeFromAi
    );
  }

  function scheduleSave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void persist();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  function diffAgainstSaved(target: SceneSnapshot): Partial<{
    title: string;
    content: string;
    contentDoc: TiptapDoc;
    summary: string;
    pov: PovValue;
    tense: TenseValue;
    excludeFromAi: boolean;
    revisionReason: "AUTOSAVE" | "MANUAL";
  }> {
    const saved = savedRef.current;
    const patch: Record<string, unknown> = {};
    if (target.title !== saved.title) patch.title = target.title;
    const contentChanged =
      target.content !== saved.content ||
      JSON.stringify(target.contentDoc) !== JSON.stringify(saved.contentDoc);
    if (contentChanged) {
      const doc = target.contentDoc ?? docFromPlainText(target.content);
      patch.contentDoc = doc;
      patch.content = plainTextFromDoc(doc);
    }
    if (target.summary !== saved.summary) patch.summary = target.summary || null;
    if (target.pov !== saved.pov) patch.pov = target.pov;
    if (target.tense !== saved.tense) patch.tense = target.tense;
    if (target.excludeFromAi !== saved.excludeFromAi) patch.excludeFromAi = target.excludeFromAi;
    if (Object.keys(patch).length > 0) {
      patch.revisionReason = manualFlushRef.current ? "MANUAL" : "AUTOSAVE";
    }
    return patch;
  }

  async function persist(): Promise<void> {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (isSavingRef.current) {
      queuedSaveRef.current = true;
      return;
    }
    const snapshotToPersist = currentRef.current;
    const patch = diffAgainstSaved(snapshotToPersist);
    if (Object.keys(patch).length === 0) {
      setStatus("saved");
      manualFlushRef.current = false;
      return;
    }

    isSavingRef.current = true;
    setStatus("saving");
    setError(null);
    try {
      const res = await apiPatch<{ scene: EditorScene }>(`/api/scenes/${scene.id}`, patch);
      // The working snapshot we sent is authoritative for dirty tracking; the
      // parent gets the server row via onSaved for outline rollups / breadcrumbs.
      savedRef.current = { ...snapshotToPersist };
      const stillDirty = isSnapshotDirty(currentRef.current, savedRef.current);
      if (!stillDirty) {
        clearDraft(scene.id);
        setStatus("saved");
      } else {
        saveDraft({
          sceneId: scene.id,
          title: currentRef.current.title,
          content: currentRef.current.content,
          summary: currentRef.current.summary,
          pov: currentRef.current.pov,
          tense: currentRef.current.tense,
          excludeFromAi: currentRef.current.excludeFromAi,
          savedAt: Date.now(),
          unsaved: true,
        });
        setStatus("dirty");
      }
      props.onSaved(res.scene);
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiRequestError ? err.message : "Save failed");
      saveDraft({
        sceneId: scene.id,
        title: currentRef.current.title,
        content: currentRef.current.content,
        summary: currentRef.current.summary,
        pov: currentRef.current.pov,
        tense: currentRef.current.tense,
        excludeFromAi: currentRef.current.excludeFromAi,
        savedAt: Date.now(),
        unsaved: true,
      });
    } finally {
      isSavingRef.current = false;
      manualFlushRef.current = false;
      if (queuedSaveRef.current) {
        queuedSaveRef.current = false;
        void persist();
      }
    }
  }

  // Autosave loop: mark dirty and (re)schedule the debounced save whenever the
  // working snapshot drifts from the persisted one.
  useEffect(() => {
    const dirty = isSnapshotDirty(current, savedRef.current);

    props.onProseChange(content);

    if (!dirty) {
      return;
    }
    setStatus("dirty");
    saveDraft({
      sceneId: scene.id,
      title: current.title,
      content: current.content,
      summary: current.summary,
      pov: current.pov,
      tense: current.tense,
      excludeFromAi: current.excludeFromAi,
      savedAt: Date.now(),
      unsaved: true,
    });
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // Apply AI-drawer insertions to the working prose.
  const appliedInsertSeqRef = useRef<number>(0);
  useEffect(() => {
    if (
      !props.insertRequest ||
      props.insertRequest.sceneId !== scene.id ||
      props.insertRequest.seq <= appliedInsertSeqRef.current
    ) {
      return;
    }
    appliedInsertSeqRef.current = props.insertRequest.seq;
    setContent((prev) => {
      const separator = prev && !prev.endsWith("\n") ? "\n\n" : prev ? "\n\n" : "";
      const next = prev
        ? `${prev}${separator}${props.insertRequest!.text}`
        : props.insertRequest!.text;
      setContentDoc(docFromPlainText(next));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.insertRequest?.seq]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      manualFlushRef.current = true;
      void persist();
    }
  }

  function restoreDraft() {
    if (!restoreOffer) return;
    setTitle(restoreOffer.title);
    setContent(restoreOffer.content);
    setContentDoc(docFromPlainText(restoreOffer.content));
    setSummary(restoreOffer.summary);
    if (restoreOffer.pov !== undefined) setPov(restoreOffer.pov);
    if (restoreOffer.tense !== undefined) setTense(restoreOffer.tense);
    if (restoreOffer.excludeFromAi !== undefined) setExcludeFromAi(restoreOffer.excludeFromAi);
    setRestoreOffer(null);
  }

  function discardDraft() {
    clearDraft(scene.id);
    setRestoreOffer(null);
  }

  const onRichChange = useCallback((next: { contentDoc: TiptapDoc; content: string }) => {
    setContentDoc(next.contentDoc);
    setContent(next.content);
  }, []);

  const loadRevisions = useCallback(async () => {
    setRevisionsLoading(true);
    setRevisionsError(null);
    try {
      const res = await apiGet<{ revisions: SceneRevisionListItem[] }>(
        `/api/scenes/${scene.id}/revisions?limit=20`,
      );
      setRevisions(res.revisions);
    } catch (err) {
      setRevisionsError(err instanceof ApiRequestError ? err.message : "Failed to load history");
    } finally {
      setRevisionsLoading(false);
    }
  }, [scene.id]);

  useEffect(() => {
    if (showHistory) {
      void loadRevisions();
    }
  }, [showHistory, loadRevisions]);

  async function handleRestoreRevision(revisionId: string) {
    setRestoringId(revisionId);
    setRevisionsError(null);
    try {
      const res = await apiPost<{ scene: EditorScene }>(
        `/api/scenes/${scene.id}/revisions/${revisionId}/restore`,
        {},
      );
      setTitle(res.scene.title);
      setContent(res.scene.content);
      setContentDoc(res.scene.contentDoc ?? null);
      setSummary(res.scene.summary ?? "");
      setPov(res.scene.pov);
      setTense(res.scene.tense);
      setExcludeFromAi(res.scene.excludeFromAi);
      savedRef.current = snapshotOf(res.scene);
      clearDraft(scene.id);
      setStatus("saved");
      props.onSaved(res.scene);
      await loadRevisions();
    } catch (err) {
      setRevisionsError(err instanceof ApiRequestError ? err.message : "Restore failed");
    } finally {
      setRestoringId(null);
    }
  }

  const words = countWords(content);

  // Stream save state + word count to the workspace (Writer Mode status pill).
  const onStatusChangeRef = useRef(props.onStatusChange);
  onStatusChangeRef.current = props.onStatusChange;
  useEffect(() => {
    onStatusChangeRef.current?.(status, words);
  }, [status, words]);

  return (
    <div className="flex h-full min-w-0 flex-col" data-testid="scene-editor">
      <div className="border-ink-200 flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-muted truncate text-xs">
            {scene.actTitle} / {scene.chapterTitle}
          </p>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Scene title"
            className="w-full bg-transparent text-lg font-semibold text-primary focus:outline-none"
          />
        </div>
        {props.chrome !== "focus" && (
          <div className="flex items-center gap-3">
            <span className="text-muted text-xs tabular-nums" data-testid="word-count">
              {formatWordCount(words)}
            </span>
            <span
              data-testid="save-status"
              className={`text-xs font-medium ${
                status === "error"
                  ? "text-red-600"
                  : status === "saving"
                    ? "text-ink-500"
                    : status === "dirty"
                      ? "text-ink-400"
                      : "text-emerald-600"
              }`}
            >
              {status === "error"
                ? "Save failed — draft kept locally"
                : status === "saving"
                  ? "Saving…"
                  : status === "dirty"
                    ? "Unsaved changes"
                    : "All changes saved"}
            </span>
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              className="rounded-md border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              {showHistory ? "Hide history" : "History"}
            </button>
            <button
              type="button"
              onClick={() => setShowMeta((v) => !v)}
              aria-expanded={showMeta}
              className="rounded-md border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              {showMeta ? "Hide details" : "Details"}
            </button>
          </div>
        )}
      </div>

      {restoreOffer && (
        <div
          className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2"
          data-testid="draft-restore"
        >
          <p className="text-xs text-amber-800">
            Unsaved draft from {new Date(restoreOffer.savedAt).toLocaleTimeString()} found (the last
            server save failed).
          </p>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={restoreDraft}
              className="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700"
            >
              Restore draft
            </button>
            <button
              type="button"
              onClick={discardDraft}
              className="rounded border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              Discard
            </button>
          </span>
        </div>
      )}

      {error && status === "error" && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-1.5">
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {showMeta && (
        <div
          className="border-ink-200 grid gap-4 border-b bg-ink-50/60 px-6 py-4 sm:grid-cols-3"
          data-testid="scene-meta"
        >
          <label className="block">
            <span className="text-ink-500 block text-xs font-medium">Point of view</span>
            <select
              value={pov}
              onChange={(e) => setPov(e.target.value as PovValue)}
              className="border-ink-300 mt-1 w-full rounded-md border bg-white px-2 py-1.5 text-sm text-ink-900"
            >
              {POV_VALUES.map((value) => (
                <option key={value} value={value}>
                  {POV_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-500 block text-xs font-medium">Tense</span>
            <select
              value={tense}
              onChange={(e) => setTense(e.target.value as TenseValue)}
              className="border-ink-300 mt-1 w-full rounded-md border bg-white px-2 py-1.5 text-sm text-ink-900"
            >
              {TENSE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {TENSE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-500 block text-xs font-medium">Summary (beat)</span>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              placeholder="What happens in this scene?"
              className="border-ink-300 mt-1 w-full rounded-md border bg-white px-2 py-1.5 text-sm text-ink-900"
            />
          </label>
          <label className="flex items-center gap-2 sm:col-span-3">
            <input
              type="checkbox"
              checked={excludeFromAi}
              onChange={(e) => setExcludeFromAi(e.target.checked)}
              className="border-ink-300 h-4 w-4 rounded"
            />
            <span className="text-ink-700 text-xs">
              Exclude this scene from AI assistance (it will not be sent to the model)
            </span>
          </label>
        </div>
      )}

      {showHistory && (
        <div
          className="border-ink-200 max-h-48 overflow-y-auto border-b bg-ink-50/40 px-6 py-3"
          data-testid="scene-history"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-ink-600 text-xs font-medium">Version history</p>
            <button
              type="button"
              onClick={() => void loadRevisions()}
              className="text-ink-500 text-xs hover:text-ink-800"
            >
              Refresh
            </button>
          </div>
          {revisionsLoading && <p className="text-muted text-xs">Loading…</p>}
          {revisionsError && <p className="text-xs text-red-600">{revisionsError}</p>}
          {!revisionsLoading && revisions.length === 0 && (
            <p className="text-muted text-xs">No versions yet — they appear after saves.</p>
          )}
          <ul className="space-y-2">
            {revisions.map((rev) => (
              <li
                key={rev.id}
                className="border-ink-200 flex items-start justify-between gap-3 rounded-md border bg-white px-3 py-2"
                data-testid="revision-row"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink-900">
                    {rev.title}{" "}
                    <span className="text-ink-400 font-normal">
                      · {rev.reason.toLowerCase()} · {formatWordCount(rev.wordCount)}
                    </span>
                  </p>
                  <p className="text-muted truncate text-[11px]">
                    {new Date(rev.createdAt).toLocaleString()} — {rev.contentPreview || "(empty)"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={restoringId === rev.id}
                  onClick={() => void handleRestoreRevision(rev.id)}
                  className="shrink-0 rounded border border-ink-200 px-2 py-1 text-[11px] font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
                >
                  {restoringId === rev.id ? "Restoring…" : "Restore"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <RichTextEditor
        contentDoc={contentDoc}
        plainContent={content}
        onChange={onRichChange}
        onKeyDown={handleKeyDown}
        placeholder="Start writing…"
      />
    </div>
  );
}
