"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorScene } from "@/lib/writing/service";
import { POV_LABELS, POV_VALUES, TENSE_LABELS, TENSE_VALUES } from "@/lib/writing/meta";
import type { PovValue, TenseValue } from "@/lib/writing/meta";
import { countWords, formatWordCount } from "@/lib/writing/word-count";
import { clearDraft, isDraftRecoverable, loadDraft, saveDraft } from "@/lib/writing/draft";
import { apiPatch, ApiRequestError } from "./api";

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
  insertRequest?: { seq: number; text: string } | null;
}

type SaveStatus = "saved" | "dirty" | "saving" | "error";

interface SceneSnapshot {
  title: string;
  content: string;
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
    summary: scene.summary ?? "",
    pov: scene.pov,
    tense: scene.tense,
    excludeFromAi: scene.excludeFromAi,
  };
}

/**
 * Scene Editor (launch phase 3): distraction-free prose surface with a
 * debounced autosave (Cmd/Ctrl+S flushes), live word count, metadata drawer
 * (POV / Tense / Summary / exclude-from-AI), and a localStorage draft
 * fallback for failed saves.
 */
export function SceneEditor(props: SceneEditorProps) {
  const { scene } = props;

  const [title, setTitle] = useState(scene.title);
  const [content, setContent] = useState(scene.content);
  const [summary, setSummary] = useState(scene.summary ?? "");
  const [pov, setPov] = useState<PovValue>(scene.pov);
  const [tense, setTense] = useState<TenseValue>(scene.tense);
  const [excludeFromAi, setExcludeFromAi] = useState(scene.excludeFromAi);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [showMeta, setShowMeta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoreOffer, setRestoreOffer] = useState<{
    savedAt: number;
    content: string;
    title: string;
    summary: string;
  } | null>(null);

  const savedRef = useRef<SceneSnapshot>(snapshotOf(scene));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    () => ({ title, content, summary, pov, tense, excludeFromAi }),
    [title, content, summary, pov, tense, excludeFromAi],
  );

  function scheduleSave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void persist();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  function diffAgainstSaved(): Partial<{
    title: string;
    content: string;
    summary: string;
    pov: PovValue;
    tense: TenseValue;
    excludeFromAi: boolean;
  }> {
    const saved = savedRef.current;
    const patch: Record<string, unknown> = {};
    if (current.title !== saved.title) patch.title = current.title;
    if (current.content !== saved.content) patch.content = current.content;
    if (current.summary !== saved.summary) patch.summary = current.summary || null;
    if (current.pov !== saved.pov) patch.pov = current.pov;
    if (current.tense !== saved.tense) patch.tense = current.tense;
    if (current.excludeFromAi !== saved.excludeFromAi) patch.excludeFromAi = current.excludeFromAi;
    return patch;
  }

  async function persist(): Promise<void> {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = diffAgainstSaved();
    if (Object.keys(patch).length === 0) {
      setStatus("saved");
      return;
    }

    setStatus("saving");
    setError(null);
    try {
      const res = await apiPatch<{ scene: EditorScene }>(`/api/scenes/${scene.id}`, patch);
      savedRef.current = { ...current };
      clearDraft(scene.id);
      setStatus("saved");
      props.onSaved(res.scene);
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiRequestError ? err.message : "Save failed");
      saveDraft({
        sceneId: scene.id,
        title: current.title,
        content: current.content,
        summary: current.summary,
        savedAt: Date.now(),
        unsaved: true,
      });
    }
  }

  // Autosave loop: mark dirty and (re)schedule the debounced save whenever the
  // working snapshot drifts from the persisted one.
  useEffect(() => {
    const saved = savedRef.current;
    const dirty =
      current.title !== saved.title ||
      current.content !== saved.content ||
      current.summary !== saved.summary ||
      current.pov !== saved.pov ||
      current.tense !== saved.tense ||
      current.excludeFromAi !== saved.excludeFromAi;

    props.onProseChange(content);

    if (!dirty) {
      return;
    }
    setStatus("dirty");
    saveDraft({
      sceneId: scene.id,
      title,
      content,
      summary,
      savedAt: Date.now(),
      unsaved: true,
    });
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // Apply AI-drawer insertions to the working prose.
  const appliedInsertSeqRef = useRef<number>(0);
  useEffect(() => {
    if (!props.insertRequest || props.insertRequest.seq <= appliedInsertSeqRef.current) {
      return;
    }
    appliedInsertSeqRef.current = props.insertRequest.seq;
    setContent((prev) => {
      const separator = prev && !prev.endsWith("\n") ? "\n\n" : prev ? "\n\n" : "";
      return prev ? `${prev}${separator}${props.insertRequest!.text}` : props.insertRequest!.text;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.insertRequest?.seq]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void persist();
    }
  }

  function restoreDraft() {
    if (!restoreOffer) return;
    setTitle(restoreOffer.title);
    setContent(restoreOffer.content);
    setSummary(restoreOffer.summary);
    setRestoreOffer(null);
  }

  function discardDraft() {
    clearDraft(scene.id);
    setRestoreOffer(null);
  }

  const words = countWords(content);

  return (
    <div className="flex h-full min-w-0 flex-col" data-testid="scene-editor">
      <div className="border-ink-200 flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-ink-400 truncate text-xs">
            {scene.actTitle} / {scene.chapterTitle}
          </p>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Scene title"
            className="w-full bg-transparent text-lg font-semibold text-ink-900 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-ink-400 text-xs tabular-nums" data-testid="word-count">
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
            onClick={() => setShowMeta((v) => !v)}
            aria-expanded={showMeta}
            className="rounded-md border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
          >
            {showMeta ? "Hide details" : "Details"}
          </button>
        </div>
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

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Start writing…"
        aria-label="Scene text"
        spellCheck
        className="min-h-0 flex-1 resize-none bg-transparent px-6 py-5 font-serif text-[17px] leading-8 text-ink-900 placeholder:text-ink-300 focus:outline-none"
      />
    </div>
  );
}
