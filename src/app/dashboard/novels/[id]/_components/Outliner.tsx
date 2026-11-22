"use client";

import { useState, type DragEvent } from "react";
import Link from "next/link";
import type { NovelOutline, OutlineKind } from "@/lib/writing/service";
import { formatWordCount } from "@/lib/writing/word-count";
import { dropIndexForSibling } from "@/lib/writing/sibling-reorder";

export interface OutlinerProps {
  outline: NovelOutline;
  selectedSceneId: string | null;
  busy: boolean;
  onSelectScene: (sceneId: string) => void;
  onCreateNode: (kind: OutlineKind, parentId?: string) => void;
  onRenameNode: (kind: OutlineKind, id: string, title: string) => void;
  onMoveNode: (kind: OutlineKind, id: string, direction: "up" | "down") => void;
  /** Sibling drag-drop: move node to absolute sibling index (0-based). */
  onReorderNode: (kind: OutlineKind, id: string, toIndex: number) => void;
  onDeleteNode: (kind: OutlineKind, id: string, title: string) => void;
}

interface Renaming {
  kind: OutlineKind;
  id: string;
  value: string;
}

interface DragPayload {
  kind: OutlineKind;
  id: string;
  parentId: string;
  index: number;
}

interface DropHint {
  kind: OutlineKind;
  parentId: string;
  targetId: string;
  place: "before" | "after";
}

const DRAG_MIME = "application/x-inkstory-outline";

/**
 * Novel & Chapter Outliner (launch phase 3 / STO-1161 polish): acts → chapters
 * → scenes tree with quick create, inline rename, up/down buttons, sibling
 * drag-and-drop reorder, delete, and word-count rollups. Keyboard-friendly:
 * rename commits on Enter, cancels on Escape. Grid/Matrix views are deferred.
 */
export function Outliner(props: OutlinerProps) {
  const { outline, selectedSceneId, busy } = props;
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);

  function startRenaming(kind: OutlineKind, id: string, currentTitle: string) {
    setRenaming({ kind, id, value: currentTitle });
  }

  function commitRenaming() {
    if (!renaming) return;
    const title = renaming.value.trim();
    if (title) {
      props.onRenameNode(renaming.kind, renaming.id, title);
    }
    setRenaming(null);
  }

  function clearDrag() {
    setDragging(null);
    setDropHint(null);
  }

  function parseDrag(event: DragEvent): DragPayload | null {
    try {
      const raw =
        event.dataTransfer?.getData(DRAG_MIME) || event.dataTransfer?.getData("text/plain");
      if (raw) {
        return JSON.parse(raw) as DragPayload;
      }
    } catch {
      // fall through to in-memory drag state (happy-dom / some browsers)
    }
    return dragging;
  }

  function beginDrag(
    event: DragEvent,
    kind: OutlineKind,
    id: string,
    parentId: string,
    index: number,
  ) {
    if (busy) {
      event.preventDefault();
      return;
    }
    const payload: DragPayload = { kind, id, parentId, index };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    // Fallback for environments that only expose text/plain on drop.
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
    setDragging(payload);
  }

  function updateDropHint(
    event: DragEvent,
    kind: OutlineKind,
    parentId: string,
    targetId: string,
    targetIndex: number,
  ) {
    const payload = dragging;
    if (
      !payload ||
      payload.kind !== kind ||
      payload.parentId !== parentId ||
      payload.id === targetId
    ) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const place: "before" | "after" =
      event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    const nextTo = dropIndexForSibling(payload.index, targetIndex, place);
    if (nextTo === payload.index) {
      setDropHint(null);
      return;
    }
    setDropHint({ kind, parentId, targetId, place });
  }

  function finishDrop(
    event: DragEvent,
    kind: OutlineKind,
    parentId: string,
    targetId: string,
    targetIndex: number,
  ) {
    event.preventDefault();
    const payload = parseDrag(event);
    clearDrag();
    if (
      !payload ||
      payload.kind !== kind ||
      payload.parentId !== parentId ||
      payload.id === targetId
    ) {
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const place: "before" | "after" =
      event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    const toIndex = dropIndexForSibling(payload.index, targetIndex, place);
    if (toIndex === payload.index) return;
    props.onReorderNode(kind, payload.id, toIndex);
  }

  function dropClass(kind: OutlineKind, parentId: string, id: string): string {
    if (
      !dropHint ||
      dropHint.kind !== kind ||
      dropHint.parentId !== parentId ||
      dropHint.targetId !== id
    ) {
      return "";
    }
    return dropHint.place === "before"
      ? "border-t-2 border-t-ink-800"
      : "border-b-2 border-b-ink-800";
  }

  function renderRenameInput() {
    if (!renaming) return null;
    return (
      <input
        type="text"
        autoFocus
        value={renaming.value}
        onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
        onBlur={commitRenaming}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitRenaming();
          if (e.key === "Escape") setRenaming(null);
        }}
        className="w-full rounded border border-ink-300 px-1 py-0.5 text-xs text-ink-900 focus:outline-hidden"
      />
    );
  }

  function renderNodeActions(kind: OutlineKind, id: string, title: string) {
    return (
      <span className="inline-flex items-center gap-0.5 opacity-0 transition-opacity group-hover/node:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          aria-label={`Rename ${title}`}
          title="Rename"
          disabled={busy}
          onClick={() => startRenaming(kind, id, title)}
          className="rounded px-1 text-xs text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        >
          ✎
        </button>
        <button
          type="button"
          aria-label={`Move ${title} up`}
          title="Move up"
          disabled={busy}
          onClick={() => props.onMoveNode(kind, id, "up")}
          className="rounded px-1 text-xs text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`Move ${title} down`}
          title="Move down"
          disabled={busy}
          onClick={() => props.onMoveNode(kind, id, "down")}
          className="rounded px-1 text-xs text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        >
          ↓
        </button>
        <button
          type="button"
          aria-label={`Delete ${title}`}
          title="Delete"
          disabled={busy}
          onClick={() => props.onDeleteNode(kind, id, title)}
          className="rounded px-1 text-xs text-ink-400 hover:bg-red-50 hover:text-red-600"
        >
          ✕
        </button>
      </span>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="outliner">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <h2 className="text-ink-500 text-xs font-semibold uppercase tracking-wide">Outline</h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => props.onCreateNode("act")}
          className="rounded bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700 hover:bg-ink-200 disabled:opacity-50"
        >
          + Act
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {outline.acts.length === 0 && (
          <div className="border-ink-200 mx-1 mt-2 rounded-lg border border-dashed p-4 text-center">
            <p className="text-ink-600 text-xs font-medium">No acts yet</p>
            <p className="text-ink-400 mt-1 text-[11px]">
              Create an act, then chapters and scenes inside it.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => props.onCreateNode("act")}
              className="mt-2 rounded bg-ink-800 px-3 py-1 text-xs font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-50"
            >
              Create first act
            </button>
          </div>
        )}

        {outline.acts.map((act, actIndex) => {
          const isActRenaming =
            renaming !== null && renaming.kind === "act" && renaming.id === act.id;
          const actParentId = outline.novel.id;

          return (
            <div key={act.id} className="group/node mb-1">
              {isActRenaming ? (
                <div className="group/node flex items-center rounded px-2 py-1">
                  {renderRenameInput()}
                </div>
              ) : (
                <div
                  className={`flex items-center justify-between rounded px-2 py-1 hover:bg-ink-50 ${dropClass("act", actParentId, act.id)}`}
                  data-testid={`outline-row-act-${act.id}`}
                  onDragOver={(e) => updateDropHint(e, "act", actParentId, act.id, actIndex)}
                  onDragLeave={() => {
                    if (dropHint?.targetId === act.id) setDropHint(null);
                  }}
                  onDrop={(e) => finishDrop(e, "act", actParentId, act.id, actIndex)}
                >
                  <span className="flex min-w-0 items-center gap-1">
                    <span
                      role="button"
                      tabIndex={busy ? -1 : 0}
                      draggable={!busy}
                      aria-label={`Drag to reorder ${act.title}`}
                      title="Drag to reorder"
                      data-testid={`outline-drag-act-${act.id}`}
                      data-parent-id={actParentId}
                      data-index={actIndex}
                      onDragStart={(e) => beginDrag(e, "act", act.id, actParentId, actIndex)}
                      onDragEnd={clearDrag}
                      className="cursor-grab rounded px-1 text-xs text-ink-300 hover:bg-ink-100 hover:text-ink-600 active:cursor-grabbing"
                    >
                      ⋮⋮
                    </span>
                    <span className="truncate text-sm font-semibold text-ink-900">{act.title}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => props.onCreateNode("chapter", act.id)}
                      className="rounded px-1 text-xs text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                      title="Add chapter"
                    >
                      ＋
                    </button>
                    {renderNodeActions("act", act.id, act.title)}
                  </span>
                </div>
              )}

              {act.chapters.map((chapter, chapterIndex) => {
                const isChapterRenaming =
                  renaming !== null && renaming.kind === "chapter" && renaming.id === chapter.id;

                return (
                  <div key={chapter.id} className="group/node mb-0.5 pl-4">
                    {isChapterRenaming ? (
                      <div className="group/node flex items-center rounded px-2 py-1">
                        {renderRenameInput()}
                      </div>
                    ) : (
                      <div
                        className={`flex items-center justify-between rounded px-2 py-1 hover:bg-ink-50 ${dropClass("chapter", act.id, chapter.id)}`}
                        data-testid={`outline-row-chapter-${chapter.id}`}
                        onDragOver={(e) =>
                          updateDropHint(e, "chapter", act.id, chapter.id, chapterIndex)
                        }
                        onDragLeave={() => {
                          if (dropHint?.targetId === chapter.id) setDropHint(null);
                        }}
                        onDrop={(e) => finishDrop(e, "chapter", act.id, chapter.id, chapterIndex)}
                      >
                        <span className="flex min-w-0 items-center gap-1">
                          <span
                            role="button"
                            tabIndex={busy ? -1 : 0}
                            draggable={!busy}
                            aria-label={`Drag to reorder ${chapter.title}`}
                            title="Drag to reorder"
                            data-testid={`outline-drag-chapter-${chapter.id}`}
                            data-parent-id={act.id}
                            data-index={chapterIndex}
                            onDragStart={(e) =>
                              beginDrag(e, "chapter", chapter.id, act.id, chapterIndex)
                            }
                            onDragEnd={clearDrag}
                            className="cursor-grab rounded px-1 text-xs text-ink-300 hover:bg-ink-100 hover:text-ink-600 active:cursor-grabbing"
                          >
                            ⋮⋮
                          </span>
                          <span className="truncate text-sm font-medium text-ink-700">
                            {chapter.title}
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => props.onCreateNode("scene", chapter.id)}
                            className="rounded px-1 text-xs text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                            title="Add scene"
                          >
                            ＋
                          </button>
                          {renderNodeActions("chapter", chapter.id, chapter.title)}
                        </span>
                      </div>
                    )}

                    {chapter.scenes.length === 0 && (
                      <p className="text-ink-400 px-2 py-0.5 pl-6 text-[11px] italic">
                        Empty chapter
                      </p>
                    )}

                    {chapter.scenes.map((scene, sceneIndex) => {
                      const isSelected = scene.id === selectedSceneId;
                      const isRenaming =
                        renaming !== null && renaming.kind === "scene" && renaming.id === scene.id;

                      if (isRenaming) {
                        return (
                          <div
                            key={scene.id}
                            className="group/node flex items-center rounded px-2 py-1 pl-6"
                          >
                            {renderRenameInput()}
                          </div>
                        );
                      }

                      return (
                        <div
                          key={scene.id}
                          className={`group/node flex items-center justify-between rounded px-2 py-1 pl-6 ${
                            isSelected ? "bg-ink-100" : "hover:bg-ink-50"
                          } ${dropClass("scene", chapter.id, scene.id)}`}
                          data-testid={`outline-row-scene-${scene.id}`}
                          onDragOver={(e) =>
                            updateDropHint(e, "scene", chapter.id, scene.id, sceneIndex)
                          }
                          onDragLeave={() => {
                            if (dropHint?.targetId === scene.id) setDropHint(null);
                          }}
                          onDrop={(e) => finishDrop(e, "scene", chapter.id, scene.id, sceneIndex)}
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-1">
                            <span
                              role="button"
                              tabIndex={busy ? -1 : 0}
                              draggable={!busy}
                              aria-label={`Drag to reorder ${scene.title}`}
                              title="Drag to reorder"
                              data-testid={`outline-drag-scene-${scene.id}`}
                              data-parent-id={chapter.id}
                              data-index={sceneIndex}
                              onDragStart={(e) =>
                                beginDrag(e, "scene", scene.id, chapter.id, sceneIndex)
                              }
                              onDragEnd={clearDrag}
                              className="cursor-grab rounded px-1 text-xs text-ink-300 hover:bg-ink-100 hover:text-ink-600 active:cursor-grabbing"
                            >
                              ⋮⋮
                            </span>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => props.onSelectScene(scene.id)}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                              data-testid={`scene-link-${scene.id}`}
                              data-selected={isSelected ? "true" : "false"}
                            >
                              <span
                                className={`truncate text-sm ${
                                  isSelected ? "font-semibold text-ink-900" : "text-ink-600"
                                }`}
                              >
                                {scene.title}
                              </span>
                              <span className="text-ink-400 shrink-0 text-[11px] tabular-nums">
                                {scene.wordCount > 0
                                  ? formatWordCount(scene.wordCount).split(" ")[0]
                                  : "—"}
                              </span>
                            </button>
                          </span>
                          {renderNodeActions("scene", scene.id, scene.title)}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {act.chapters.length === 0 && (
                <p className="text-ink-400 px-2 py-0.5 pl-4 text-[11px] italic">No chapters</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-ink-200 border-t px-3 py-2">
        <p className="text-ink-500 text-[11px] tabular-nums">
          {outline.totals.scenes} {outline.totals.scenes === 1 ? "scene" : "scenes"} ·{" "}
          {formatWordCount(outline.totals.words)}
        </p>
        <Link
          href="/dashboard/codex"
          className="text-ink-600 hover:text-ink-900 mt-1 inline-block text-[11px] font-medium underline"
        >
          Open Story Codex →
        </Link>
      </div>
    </div>
  );
}
