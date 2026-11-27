"use client";

import { useMemo, useState, type DragEvent } from "react";
import type { NovelOutline, OutlineKind } from "@/lib/writing/service";
import { formatWordCount } from "@/lib/writing/word-count";
import { dropIndexForSibling } from "@/lib/writing/sibling-reorder";
import { buildPlanningGrid } from "@/lib/writing/planning-grid";

export interface PlanningGridProps {
  outline: NovelOutline;
  selectedSceneId: string | null;
  busy: boolean;
  onSelectScene: (sceneId: string) => void;
  onCreateNode: (kind: OutlineKind, parentId?: string) => void;
  onMoveNode: (kind: OutlineKind, id: string, direction: "up" | "down") => void;
  /** Sibling drag-drop: move a scene to an absolute index within its chapter. */
  onReorderNode: (kind: OutlineKind, id: string, toIndex: number) => void;
}

interface SceneDrag {
  id: string;
  chapterId: string;
  index: number;
}

interface DropHint {
  chapterId: string;
  targetId: string;
  place: "before" | "after";
}

const DRAG_MIME = "application/x-inkstory-grid-scene";

function dropPlace(event: DragEvent): "before" | "after" {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

/**
 * Grid planning view (STO-1257): acts as bands, chapters as columns and
 * scenes as cards. Cards open the scene in the editor; scenes reorder within
 * their chapter by drag-and-drop or the up/down buttons, and chapters move
 * left/right within their act. Uses the same outline API as the Outliner, so
 * changes persist and show up in every view.
 */
export function PlanningGrid(props: Readonly<PlanningGridProps>) {
  const { outline, selectedSceneId, busy } = props;
  const acts = useMemo(() => buildPlanningGrid(outline), [outline]);
  const [dragging, setDragging] = useState<SceneDrag | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);

  function clearDrag() {
    setDragging(null);
    setDropHint(null);
  }

  function readDrag(event: DragEvent): SceneDrag | null {
    try {
      const raw = event.dataTransfer?.getData(DRAG_MIME);
      if (raw) return JSON.parse(raw) as SceneDrag;
    } catch {
      // fall back to in-memory drag state
    }
    return dragging;
  }

  function beginDrag(event: DragEvent, payload: SceneDrag) {
    if (busy) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    setDragging(payload);
  }

  function hover(event: DragEvent, chapterId: string, targetId: string, targetIndex: number) {
    if (dragging?.chapterId !== chapterId || dragging?.id === targetId) {
      setDropHint(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const place = dropPlace(event);
    if (dropIndexForSibling(dragging.index, targetIndex, place) === dragging.index) {
      setDropHint(null);
      return;
    }
    setDropHint({ chapterId, targetId, place });
  }

  function drop(event: DragEvent, chapterId: string, targetId: string, targetIndex: number) {
    event.preventDefault();
    const payload = readDrag(event);
    clearDrag();
    if (payload?.chapterId !== chapterId || payload?.id === targetId) return;
    const toIndex = dropIndexForSibling(payload.index, targetIndex, dropPlace(event));
    if (toIndex === payload.index) return;
    props.onReorderNode("scene", payload.id, toIndex);
  }

  function hintClass(chapterId: string, sceneId: string): string {
    if (dropHint?.chapterId !== chapterId || dropHint?.targetId !== sceneId) return "";
    return dropHint.place === "before"
      ? "border-t-2 border-t-ink-800"
      : "border-b-2 border-b-ink-800";
  }

  const busyTitle = busy ? "Saving outline changes…" : undefined;

  function moveTitle(actionLabel: string, atBoundary: boolean, boundaryReason: string): string {
    if (busy) return "Saving outline changes…";
    if (atBoundary) return boundaryReason;
    return actionLabel;
  }

  const iconButton =
    "min-h-7 min-w-7 rounded text-xs text-ink-500 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-30";

  if (acts.length === 0) {
    return (
      <div className="border-ink-200 m-8 rounded-lg border border-dashed p-10 text-center">
        <p className="text-secondary font-medium">Nothing to plan yet</p>
        <p className="text-muted mt-1 text-sm">Create an act to start laying out the story.</p>
        <button
          type="button"
          disabled={busy}
          title={busyTitle}
          onClick={() => props.onCreateNode("act")}
          className="mt-3 min-h-11 rounded bg-ink-800 px-3 py-1.5 text-xs font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-50"
        >
          Create first act
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-4" data-testid="planning-grid">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-ink-500 text-xs tabular-nums">
          {outline.totals.scenes} {outline.totals.scenes === 1 ? "scene" : "scenes"} ·{" "}
          {formatWordCount(outline.totals.words)}
        </p>
        <button
          type="button"
          disabled={busy}
          title={busyTitle}
          onClick={() => props.onCreateNode("act")}
          className="min-h-9 rounded border border-ink-200 px-2.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
        >
          + Act
        </button>
      </div>

      {acts.map((act) => (
        <section
          key={act.id}
          aria-label={act.title}
          data-testid={`grid-act-${act.id}`}
          className="mb-6"
        >
          <header className="mb-2 flex items-baseline gap-2">
            <h2 className="text-sm font-semibold text-ink-900">{act.title}</h2>
            <span className="text-muted text-[11px] tabular-nums">
              {act.sceneCount} {act.sceneCount === 1 ? "scene" : "scenes"} ·{" "}
              {formatWordCount(act.wordCount)}
            </span>
            <button
              type="button"
              disabled={busy}
              title={busyTitle}
              onClick={() => props.onCreateNode("chapter", act.id)}
              className="text-ink-500 hover:text-ink-900 ml-auto text-[11px] font-medium disabled:opacity-50"
            >
              + Chapter
            </button>
          </header>

          {act.chapters.length === 0 ? (
            <p className="text-muted text-[11px] italic">No chapters</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {act.chapters.map((chapter) => {
                const isFirstChapter = chapter.siblingIndex === 0;
                const isLastChapter = chapter.siblingIndex === chapter.siblingCount - 1;
                return (
                  <div
                    key={chapter.id}
                    data-testid={`grid-chapter-${chapter.id}`}
                    className="border-ink-200 flex w-60 shrink-0 flex-col rounded-lg border bg-elevated"
                  >
                    <div className="border-ink-200 flex items-center gap-1 border-b px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-ink-800">
                          {chapter.title}
                        </p>
                        <p className="text-muted text-[11px] tabular-nums">
                          {formatWordCount(chapter.wordCount)}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Move ${chapter.title} left`}
                        title={moveTitle("Move left", isFirstChapter, "Already first chapter")}
                        disabled={busy || isFirstChapter}
                        onClick={() => props.onMoveNode("chapter", chapter.id, "up")}
                        className={iconButton}
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${chapter.title} right`}
                        title={moveTitle("Move right", isLastChapter, "Already last chapter")}
                        disabled={busy || isLastChapter}
                        onClick={() => props.onMoveNode("chapter", chapter.id, "down")}
                        className={iconButton}
                      >
                        →
                      </button>
                    </div>

                    <ol className="flex flex-col gap-2 p-2">
                      {chapter.scenes.map((scene) => {
                        const selected = scene.id === selectedSceneId;
                        const isFirstScene = scene.siblingIndex === 0;
                        const isLastScene = scene.siblingIndex === chapter.scenes.length - 1;
                        return (
                          <li
                            key={scene.id}
                            draggable={!busy}
                            data-testid={`grid-scene-${scene.id}`}
                            onDragStart={(e) =>
                              beginDrag(e, {
                                id: scene.id,
                                chapterId: chapter.id,
                                index: scene.siblingIndex,
                              })
                            }
                            onDragEnd={clearDrag}
                            onDragOver={(e) => hover(e, chapter.id, scene.id, scene.siblingIndex)}
                            onDrop={(e) => drop(e, chapter.id, scene.id, scene.siblingIndex)}
                            className={`rounded-md border bg-card p-2 shadow-xs ${
                              selected ? "border-ink-800" : "border-ink-200"
                            } ${dragging?.id === scene.id ? "opacity-50" : ""} ${hintClass(
                              chapter.id,
                              scene.id,
                            )}`}
                          >
                            <button
                              type="button"
                              onClick={() => props.onSelectScene(scene.id)}
                              aria-current={selected ? "true" : undefined}
                              className="block w-full text-left"
                            >
                              <span className="text-muted block text-[10px] font-medium tabular-nums">
                                Scene {scene.number}
                              </span>
                              <span className="block truncate text-sm font-medium text-ink-900">
                                {scene.title}
                              </span>
                              {scene.label && (
                                <span className="mt-1 inline-block rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">
                                  {scene.label}
                                </span>
                              )}
                              <span className="text-muted mt-1 block text-[11px] tabular-nums">
                                {scene.wordCount > 0 ? formatWordCount(scene.wordCount) : "Empty"}
                              </span>
                            </button>
                            <div className="mt-1 flex justify-end gap-0.5">
                              <button
                                type="button"
                                aria-label={`Move ${scene.title} up`}
                                title={moveTitle("Move up", isFirstScene, "Already first scene")}
                                disabled={busy || isFirstScene}
                                onClick={() => props.onMoveNode("scene", scene.id, "up")}
                                className={iconButton}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${scene.title} down`}
                                title={moveTitle("Move down", isLastScene, "Already last scene")}
                                disabled={busy || isLastScene}
                                onClick={() => props.onMoveNode("scene", scene.id, "down")}
                                className={iconButton}
                              >
                                ↓
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                    {chapter.scenes.length === 0 && (
                      <p className="text-muted px-2 text-[11px] italic">Empty chapter</p>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      title={busyTitle}
                      onClick={() => props.onCreateNode("scene", chapter.id)}
                      className="text-ink-500 hover:text-ink-900 m-2 mt-auto rounded border border-dashed border-ink-200 py-1.5 text-[11px] font-medium disabled:opacity-50"
                    >
                      + Scene
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
