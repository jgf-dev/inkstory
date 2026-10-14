"use client";

import { useState } from "react";
import Link from "next/link";
import type { NovelOutline, OutlineKind } from "@/lib/writing/service";
import { formatWordCount } from "@/lib/writing/word-count";

export interface OutlinerProps {
  outline: NovelOutline;
  selectedSceneId: string | null;
  busy: boolean;
  onSelectScene: (sceneId: string) => void;
  onCreateNode: (kind: OutlineKind, parentId?: string) => void;
  onRenameNode: (kind: OutlineKind, id: string, title: string) => void;
  onMoveNode: (kind: OutlineKind, id: string, direction: "up" | "down") => void;
  onDeleteNode: (kind: OutlineKind, id: string, title: string) => void;
}

interface Renaming {
  kind: OutlineKind;
  id: string;
  value: string;
}

/**
 * Novel & Chapter Outliner (launch phase 3): acts → chapters → scenes tree
 * with quick create, inline rename, up/down reorder, delete, and word-count
 * rollups. Keyboard-friendly: rename commits on Enter, cancels on Escape.
 */
export function Outliner(props: OutlinerProps) {
  const { outline, selectedSceneId, busy } = props;
  const [renaming, setRenaming] = useState<Renaming | null>(null);

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

        {outline.acts.map((act) => (
          <div key={act.id} className="group/node mb-1">
            <div className="flex items-center justify-between rounded px-2 py-1 hover:bg-ink-50">
              <span className="truncate text-sm font-semibold text-ink-900">{act.title}</span>
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

            {act.chapters.map((chapter) => (
              <div key={chapter.id} className="group/node mb-0.5 pl-4">
                <div className="flex items-center justify-between rounded px-2 py-1 hover:bg-ink-50">
                  <span className="truncate text-sm font-medium text-ink-700">{chapter.title}</span>
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

                {chapter.scenes.length === 0 && (
                  <p className="text-ink-400 px-2 py-0.5 pl-6 text-[11px] italic">Empty chapter</p>
                )}

                {chapter.scenes.map((scene) => {
                  const isSelected = scene.id === selectedSceneId;
                  const isRenaming =
                    renaming !== null && renaming.kind === "scene" && renaming.id === scene.id;

                  if (isRenaming && renaming) {
                    return (
                      <div
                        key={scene.id}
                        className="group/node flex items-center rounded px-2 py-1 pl-6"
                      >
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
                      </div>
                    );
                  }

                  return (
                    <div
                      key={scene.id}
                      className={`group/node flex items-center justify-between rounded px-2 py-1 pl-6 ${
                        isSelected ? "bg-ink-100" : "hover:bg-ink-50"
                      }`}
                    >
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
                      {renderNodeActions("scene", scene.id, scene.title)}
                    </div>
                  );
                })}
              </div>
            ))}

            {act.chapters.length === 0 && (
              <p className="text-ink-400 px-2 py-0.5 pl-4 text-[11px] italic">No chapters</p>
            )}
          </div>
        ))}
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
