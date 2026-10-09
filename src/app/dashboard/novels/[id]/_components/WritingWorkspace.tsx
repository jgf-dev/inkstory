"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { EditorScene, NovelOutline, OutlineKind } from "@/lib/writing/service";
import type { MentionDetectionResult } from "@/lib/codex/mention-detection";
import { apiDelete, apiGet, apiPatch, apiPost, ApiRequestError } from "./api";
import { Outliner } from "./Outliner";
import { SceneEditor } from "./SceneEditor";
import { MentionsPanel } from "./MentionsPanel";
import { SceneContextDrawer } from "./SceneContextDrawer";
import { AiAssistantDrawer } from "./AiAssistantDrawer";

export interface WritingWorkspaceProps {
  outline: NovelOutline;
  initialSceneId: string | null;
}

export interface InsertRequest {
  seq: number;
  text: string;
}

type RightDrawer = "context" | "ai" | null;

const MENTION_SCAN_DEBOUNCE_MS = 1200;

/**
 * Author writing surface (launch phase 3): outliner sidebar + detected
 * mentions on the left, distraction-free scene editor center, and the
 * Scene Context / AI Assistant drawers on the right.
 */
export function WritingWorkspace({
  outline: initialOutline,
  initialSceneId,
}: WritingWorkspaceProps) {
  const [outline, setOutline] = useState<NovelOutline>(initialOutline);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(initialSceneId);
  const [scene, setScene] = useState<EditorScene | null>(null);
  const [sceneLoading, setSceneLoading] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [rightDrawer, setRightDrawer] = useState<RightDrawer>(null);
  const [prose, setProse] = useState("");
  const [detection, setDetection] = useState<MentionDetectionResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [insertRequest, setInsertRequest] = useState<InsertRequest | null>(null);

  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const novelId = initialOutline.novel.id;

  const refreshOutline = useCallback(async () => {
    const res = await apiGet<{ outline: NovelOutline }>(`/api/novels/${novelId}/outline`);
    setOutline(res.outline);
  }, [novelId]);

  const loadScene = useCallback(async (sceneId: string) => {
    setSceneLoading(true);
    setSceneError(null);
    try {
      const res = await apiGet<{ scene: EditorScene }>(`/api/scenes/${sceneId}`);
      setScene(res.scene);
      setProse(res.scene.content);
    } catch (err) {
      setScene(null);
      setSceneError(err instanceof ApiRequestError ? err.message : "Failed to load scene");
    } finally {
      setSceneLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialSceneId) {
      void loadScene(initialSceneId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced live mention scan over the current prose (sidebar chips).
  const proseRef = useRef(prose);
  proseRef.current = prose;
  useEffect(() => {
    if (!selectedSceneId) return;
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    scanTimerRef.current = setTimeout(async () => {
      setScanning(true);
      try {
        const text = proseRef.current.trim();
        if (!text) {
          setDetection({ matchedEntryIds: [], matches: [] });
        } else {
          const res = await apiPost<MentionDetectionResult>("/api/codex/mentions", {
            sceneId: selectedSceneId,
            text: proseRef.current,
          });
          setDetection(res);
        }
      } catch {
        setDetection(null);
      } finally {
        setScanning(false);
      }
    }, MENTION_SCAN_DEBOUNCE_MS);
    return () => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    };
  }, [prose, selectedSceneId]);

  // ── Outline mutations ───────────────────────────────────────────────────

  async function createNode(kind: OutlineKind, parentId?: string) {
    setBusy(true);
    try {
      const res = await apiPost<{ kind: OutlineKind; node: { id: string } }>(
        `/api/novels/${novelId}/outline`,
        { kind, parentId },
      );
      await refreshOutline();
      if (kind === "scene") {
        setSelectedSceneId(res.node.id);
        await loadScene(res.node.id);
        setRightDrawer(null);
      }
    } catch (err) {
      setSceneError(err instanceof ApiRequestError ? err.message : "Failed to create node");
    } finally {
      setBusy(false);
    }
  }

  async function renameNode(kind: OutlineKind, id: string, title: string) {
    setBusy(true);
    try {
      await apiPatch(`/api/novels/${novelId}/outline`, { kind, id, title });
      await refreshOutline();
      if (kind === "scene" && scene?.id === id) {
        setScene((prev) => (prev ? { ...prev, title } : prev));
      }
    } catch (err) {
      setSceneError(err instanceof ApiRequestError ? err.message : "Failed to rename");
    } finally {
      setBusy(false);
    }
  }

  async function moveNode(kind: OutlineKind, id: string, direction: "up" | "down") {
    setBusy(true);
    try {
      await apiPatch(`/api/novels/${novelId}/outline`, { kind, id, direction });
      await refreshOutline();
    } catch (err) {
      setSceneError(err instanceof ApiRequestError ? err.message : "Failed to move");
    } finally {
      setBusy(false);
    }
  }

  async function deleteNode(kind: OutlineKind, id: string, title: string) {
    const confirmed =
      kind === "scene"
        ? window.confirm(`Delete scene "${title}"? Its text will be removed from the outline.`)
        : window.confirm(
            `Delete ${kind} "${title}"${kind !== "act" ? "" : " and everything inside it"}?`,
          );
    if (!confirmed) return;

    setBusy(true);
    try {
      await apiDelete(
        `/api/novels/${novelId}/outline?kind=${kind}&nodeId=${encodeURIComponent(id)}`,
      );
      if (kind === "scene" && scene?.id === id) {
        setScene(null);
        setSelectedSceneId(null);
      }
      await refreshOutline();
    } catch (err) {
      setSceneError(err instanceof ApiRequestError ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  // ── Editor callbacks ────────────────────────────────────────────────────

  function handleSceneSaved(updated: EditorScene) {
    setScene((prev) => (prev && prev.id === updated.id ? updated : prev));
    // Roll the persisted word count into the outliner without a refetch.
    setOutline((prev) => {
      let found = false;
      let totalWords = 0;
      const acts = prev.acts.map((act) => ({
        ...act,
        chapters: act.chapters.map((chapter) => ({
          ...chapter,
          scenes: chapter.scenes.map((s) => {
            if (s.id === updated.id) {
              found = true;
              return { ...s, wordCount: updated.wordCount, title: updated.title };
            }
            return s;
          }),
        })),
      }));
      if (!found) return prev;
      for (const act of acts) {
        for (const chapter of act.chapters) {
          for (const s of chapter.scenes) totalWords += s.wordCount;
        }
      }
      return { ...prev, acts, totals: { ...prev.totals, words: totalWords } };
    });
  }

  function handleInsertIntoScene(text: string) {
    if (!text.trim()) return;
    setInsertRequest((prev) => ({ seq: (prev?.seq ?? 0) + 1, text }));
  }

  return (
    <div
      className="bg-ink-50 flex h-screen flex-col overflow-hidden"
      data-testid="writing-workspace"
    >
      <header className="border-ink-200 flex items-center justify-between gap-3 border-b bg-white px-4 py-2">
        <div className="min-w-0">
          <div className="text-ink-500 flex items-center gap-1.5 text-[11px]">
            <Link href="/dashboard" className="hover:underline">
              Dashboard
            </Link>
            <span>/</span>
            <span className="truncate font-medium text-ink-700">{outline.novel.title}</span>
          </div>
          <h1 className="truncate text-sm font-semibold text-ink-900">{outline.novel.title}</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRightDrawer((v) => (v === "context" ? null : "context"))}
            aria-pressed={rightDrawer === "context"}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
              rightDrawer === "context"
                ? "bg-ink-800 text-ink-50"
                : "border border-ink-200 text-ink-700 hover:bg-ink-50"
            }`}
          >
            Context
          </button>
          <button
            type="button"
            onClick={() => setRightDrawer((v) => (v === "ai" ? null : "ai"))}
            aria-pressed={rightDrawer === "ai"}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
              rightDrawer === "ai"
                ? "bg-ink-800 text-ink-50"
                : "border border-ink-200 text-ink-700 hover:bg-ink-50"
            }`}
          >
            AI Assistant
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left rail: outliner + detected mentions */}
        <aside className="border-ink-200 flex w-72 shrink-0 flex-col overflow-y-auto border-r bg-white">
          <Outliner
            outline={outline}
            selectedSceneId={selectedSceneId}
            busy={busy}
            onSelectScene={(id) => {
              setSelectedSceneId(id);
              void loadScene(id);
            }}
            onCreateNode={(kind, parentId) => void createNode(kind, parentId)}
            onRenameNode={(kind, id, title) => void renameNode(kind, id, title)}
            onMoveNode={(kind, id, direction) => void moveNode(kind, id, direction)}
            onDeleteNode={(kind, id, title) => void deleteNode(kind, id, title)}
          />
          <MentionsPanel detection={detection} scanning={scanning} />
        </aside>

        {/* Center: editor */}
        <main className="min-w-0 flex-1 bg-white">
          {sceneError && (
            <div className="border-red-200 bg-red-50 border-b px-6 py-2">
              <p className="text-xs text-red-700">{sceneError}</p>
            </div>
          )}
          {sceneLoading && <p className="text-ink-400 px-6 py-8 text-sm">Loading scene…</p>}
          {!sceneLoading && !scene && !sceneError && (
            <div className="border-ink-200 m-8 rounded-lg border border-dashed p-10 text-center">
              <p className="text-ink-600 font-medium">No scene selected</p>
              <p className="text-ink-500 mt-1 text-sm">
                Pick a scene in the outline, or create one to start writing.
              </p>
              {outline.acts.length === 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void createNode("act")}
                  className="mt-3 rounded bg-ink-800 px-3 py-1.5 text-xs font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-50"
                >
                  Create first act
                </button>
              )}
            </div>
          )}
          {!sceneLoading && scene && (
            <SceneEditor
              key={scene.id}
              scene={scene}
              onSaved={handleSceneSaved}
              onProseChange={setProse}
              insertRequest={insertRequest}
            />
          )}
        </main>

        {/* Right rail: drawers */}
        {rightDrawer && scene && (
          <aside className="border-ink-200 w-80 shrink-0 overflow-hidden border-l bg-white">
            {rightDrawer === "context" && (
              <SceneContextDrawer sceneId={scene.id} onClose={() => setRightDrawer(null)} />
            )}
            {rightDrawer === "ai" && (
              <AiAssistantDrawer
                sceneId={scene.id}
                content={prose}
                onClose={() => setRightDrawer(null)}
                onInsertText={handleInsertIntoScene}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
