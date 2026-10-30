"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { EditorScene, NovelOutline, OutlineKind } from "@/lib/writing/service";
import { isSceneUnderNode } from "@/lib/writing/outline-tree";
import { flattenScenesInReadingOrder } from "@/lib/writing/reading-order";
import type { MentionDetectionResult } from "@/lib/codex/mention-detection";
import { persistWorkspaceMode, readWorkspaceMode, type WorkspaceMode } from "@/lib/ui/preferences";
import { ThemeToggle } from "@/app/_components/ThemeToggle";
import { apiDelete, apiGet, apiPatch, apiPost, ApiRequestError } from "./api";
import { Outliner } from "./Outliner";
import { SceneEditor, type SaveStatus } from "./SceneEditor";
import { MentionsPanel } from "./MentionsPanel";
import { AiAssistantDrawer } from "./AiAssistantDrawer";
import { ModeSwitcher } from "./ModeSwitcher";
import { ProseFontToggle } from "./ProseFontToggle";
import { StatusPill } from "./StatusPill";
import { StageConsolePanel } from "./StageConsolePanel";
import { ArchitectRail } from "./ArchitectRail";
import { ProgressionTimelineDrawer } from "./ProgressionTimelineDrawer";
import { ImportManuscriptDialog } from "./ImportManuscriptDialog";
import {
  RelationLinkerModal,
  type RelationChipData,
} from "@/app/dashboard/codex/_components/RelationLinkerModal";
import { useCodexBudget } from "./useCodexBudget";

export interface WritingWorkspaceProps {
  outline: NovelOutline;
  initialSceneId: string | null;
}

export interface InsertRequest {
  seq: number;
  text: string;
  /** Scene the text was meant for; the editor ignores requests for other scenes. */
  sceneId: string;
}

type RightDrawer = "ai" | null;

type MobilePanel = "outline" | "tools" | null;

const MENTION_SCAN_DEBOUNCE_MS = 1200;

/**
 * Kill switch for the progressive-disclosure operating modes (JGF-128 rule:
 * "Do not slow the launch line"). Set NEXT_PUBLIC_INKSTORY_OPERATING_MODES=0
 * to fall back to the pre-modes layout without a code change.
 */
const OPERATING_MODES_ENABLED = process.env.NEXT_PUBLIC_INKSTORY_OPERATING_MODES !== "0";

/**
 * Author writing surface (launch phase 3 + JGF-128): progressive-disclosure
 * operating modes — Writer (distraction-free prose column with hover rails),
 * Stage (50/50 scene + enactment console), Architect (outliner + prose +
 * Codex cockpit rail with Relation Linker, Progression Timeline and the
 * Token Budget Bar).
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

  // ── JGF-128: operating modes, overlays, and editor status ───────────────
  // Mode initializes to the SSR-safe default and adopts the persisted choice
  // after hydration (localStorage must not diverge the hydration tree).
  const [mode, setMode] = useState<WorkspaceMode>("architect");
  useEffect(() => {
    setMode(readWorkspaceMode());
  }, []);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [editorStatus, setEditorStatus] = useState<SaveStatus>("saved");
  const [editorWords, setEditorWords] = useState(0);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [linkerSource, setLinkerSource] = useState<{ id: string; name: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSceneIdRef = useRef<string | null>(initialSceneId);
  const novelId = initialOutline.novel.id;

  const effectiveMode: WorkspaceMode = OPERATING_MODES_ENABLED ? mode : "architect";

  const sceneCoordinates = useMemo(() => flattenScenesInReadingOrder(outline), [outline]);
  const sceneIndexById = useMemo(
    () => new Map(sceneCoordinates.map((c) => [c.sceneId, c.index])),
    [sceneCoordinates],
  );
  const openSceneId = scene?.id ?? selectedSceneId;
  const currentSceneIndex = openSceneId ? (sceneIndexById.get(openSceneId) ?? null) : null;

  const budget = useCodexBudget(novelId, detection, currentSceneIndex, sceneIndexById);

  function switchMode(next: WorkspaceMode) {
    setMode(next);
    persistWorkspaceMode(next);
    setMobilePanel(null);
  }

  const openLinker = useCallback(
    (entry: { id: string; name: string }) => {
      budget.ensureDetail(entry.id);
      setLinkerSource(entry);
    },
    [budget],
  );

  const linkerDetail = linkerSource ? budget.details.get(linkerSource.id) : undefined;
  const linkerChips: RelationChipData[] = linkerDetail
    ? [
        ...(linkerDetail.sourceRelations ?? []).map((r) => ({
          id: r.id,
          otherName: r.targetEntry?.name ?? r.targetEntryId,
          relationType: r.relationType,
          reverseType: r.reverseType,
          direction: "outgoing" as const,
        })),
        ...(linkerDetail.targetRelations ?? []).map((r) => ({
          id: r.id,
          otherName: r.sourceEntry?.name ?? r.sourceEntryId,
          relationType: r.relationType,
          reverseType: r.reverseType,
          direction: "incoming" as const,
        })),
      ]
    : [];

  const refreshOutline = useCallback(async () => {
    const res = await apiGet<{ outline: NovelOutline }>(`/api/novels/${novelId}/outline`);
    setOutline(res.outline);
  }, [novelId]);

  const loadScene = useCallback(async (sceneId: string) => {
    activeSceneIdRef.current = sceneId;
    setSceneLoading(true);
    setSceneError(null);
    // A pending AI insert belongs to the scene it was made for.
    setInsertRequest(null);
    try {
      const res = await apiGet<{ scene: EditorScene }>(`/api/scenes/${sceneId}`);
      if (activeSceneIdRef.current !== sceneId) return;
      setScene(res.scene);
      setProse(res.scene.content);
    } catch (err) {
      if (activeSceneIdRef.current !== sceneId) return;
      setScene(null);
      setSceneError(err instanceof ApiRequestError ? err.message : "Failed to load scene");
    } finally {
      if (activeSceneIdRef.current === sceneId) {
        setSceneLoading(false);
      }
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

    const openScene = scene?.id ?? selectedSceneId;
    const clearsOpenScene = openScene !== null && isSceneUnderNode(outline, kind, id, openScene);

    setBusy(true);
    try {
      await apiDelete(
        `/api/novels/${novelId}/outline?kind=${kind}&nodeId=${encodeURIComponent(id)}`,
      );
      if (clearsOpenScene) {
        activeSceneIdRef.current = null;
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
    if (!text.trim() || !scene) return;
    const sceneId = scene.id;
    setInsertRequest((prev) => ({ seq: (prev?.seq ?? 0) + 1, text, sceneId }));
  }

  const handleEditorStatus = useCallback((status: SaveStatus, words: number) => {
    setEditorStatus(status);
    setEditorWords(words);
  }, []);

  // ── Shared region renderers ─────────────────────────────────────────────

  function renderOutlineRail() {
    return (
      <>
        <Outliner
          outline={outline}
          selectedSceneId={selectedSceneId}
          busy={busy}
          onSelectScene={(id) => {
            setSelectedSceneId(id);
            void loadScene(id);
            setMobilePanel(null);
          }}
          onCreateNode={(kind, parentId) => void createNode(kind, parentId)}
          onRenameNode={(kind, id, title) => void renameNode(kind, id, title)}
          onMoveNode={(kind, id, direction) => void moveNode(kind, id, direction)}
          onDeleteNode={(kind, id, title) => void deleteNode(kind, id, title)}
        />
        <MentionsPanel detection={detection} scanning={scanning} onLinkRelation={openLinker} />
      </>
    );
  }

  function renderCenter(chrome: "full" | "focus") {
    return (
      <>
        {sceneError && (
          <div className="border-red-200 bg-red-50 border-b px-6 py-2">
            <p className="text-xs text-red-700">{sceneError}</p>
          </div>
        )}
        {sceneLoading && <p className="text-muted px-6 py-8 text-sm">Loading scene…</p>}
        {!sceneLoading && !scene && !sceneError && (
          <div className="border-ink-200 m-8 rounded-lg border border-dashed p-10 text-center">
            <p className="text-secondary font-medium">No scene selected</p>
            <p className="text-muted mt-1 text-sm">
              Pick a scene in the outline, or create one to start writing.
            </p>
            {outline.acts.length === 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void createNode("act")}
                className="mt-3 min-h-11 rounded bg-ink-800 px-3 py-1.5 text-xs font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-50"
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
            onStatusChange={handleEditorStatus}
            chrome={chrome}
          />
        )}
      </>
    );
  }

  // ── Layout ──────────────────────────────────────────────────────────────

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-app"
      data-testid="writing-workspace"
      data-mode={effectiveMode}
    >
      <header className="border-ink-200 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {OPERATING_MODES_ENABLED && effectiveMode === "architect" && (
            <button
              type="button"
              onClick={() => setMobilePanel((v) => (v === "outline" ? null : "outline"))}
              aria-expanded={mobilePanel === "outline"}
              className="min-h-11 rounded-md border border-ink-200 px-3 text-xs font-medium text-ink-700 hover:bg-ink-50 md:hidden"
            >
              Outline
            </button>
          )}
          <div className="min-w-0">
            <div className="text-muted flex items-center gap-1.5 text-[11px]">
              <Link href="/dashboard" className="hover:underline">
                Dashboard
              </Link>
              <span>/</span>
              <span className="truncate font-medium text-ink-700">{outline.novel.title}</span>
            </div>
            <h1 className="truncate text-sm font-semibold text-primary">{outline.novel.title}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {OPERATING_MODES_ENABLED && <ModeSwitcher mode={effectiveMode} onChange={switchMode} />}
          <ProseFontToggle />
          <ThemeToggle />
          {OPERATING_MODES_ENABLED && effectiveMode === "architect" && (
            <button
              type="button"
              onClick={() => setMobilePanel((v) => (v === "tools" ? null : "tools"))}
              aria-expanded={mobilePanel === "tools"}
              className="min-h-11 rounded-md border border-ink-200 px-3 text-xs font-medium text-ink-700 hover:bg-ink-50 lg:hidden"
            >
              Tools
            </button>
          )}
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="min-h-11 rounded-md border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
          >
            Import
          </button>
          <button
            type="button"
            onClick={() => setRightDrawer((v) => (v === "ai" ? null : "ai"))}
            aria-pressed={rightDrawer === "ai"}
            className={`min-h-11 rounded-md px-2.5 py-1.5 text-xs font-medium ${
              rightDrawer === "ai"
                ? "bg-ink-800 text-ink-50"
                : "border border-ink-200 text-ink-700 hover:bg-ink-50"
            }`}
          >
            AI Assistant
          </button>
        </div>
      </header>

      {/* ── Writer Mode: centered 750px prose column + 16px hover rails ── */}
      {effectiveMode === "writer" && (
        <div className="relative min-h-0 flex-1">
          <aside
            aria-label="Outline rail"
            data-testid="writer-outline-rail"
            className="group absolute inset-y-0 left-0 z-20 w-4 overflow-hidden border-r border-subtle bg-card transition-[width] duration-150 hover:w-72 focus-within:w-72"
          >
            <div className="flex h-full w-72 flex-col opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              {renderOutlineRail()}
            </div>
          </aside>

          <aside
            aria-label="Assistant rail"
            data-testid="writer-assistant-rail"
            className="group absolute inset-y-0 right-0 z-20 w-4 overflow-hidden border-l border-subtle bg-card transition-[width] duration-150 hover:w-56 focus-within:w-56"
          >
            <div className="flex h-full w-56 flex-col items-stretch justify-center gap-2 px-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              <button
                type="button"
                onClick={() => setRightDrawer("ai")}
                disabled={!scene}
                className="min-h-11 rounded-md border border-ink-200 px-3 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
              >
                AI Assistant
              </button>
              <button
                type="button"
                onClick={() => setTimelineOpen(true)}
                className="min-h-11 rounded-md border border-ink-200 px-3 text-xs font-medium text-ink-700 hover:bg-ink-50"
              >
                Timeline
              </button>
            </div>
          </aside>

          <main className="h-full min-w-0 px-6">
            <div className="mx-auto flex h-full w-full max-w-[750px] flex-col">
              {renderCenter("focus")}
            </div>
          </main>

          {scene && !sceneLoading && <StatusPill words={editorWords} saveState={editorStatus} />}
        </div>
      )}

      {/* ── Stage Mode: 50/50 scene prose + enactment console ── */}
      {effectiveMode === "stage" && (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row" data-testid="stage-mode">
          <main className="min-h-0 min-w-0 flex-1 border-b border-ink-200 bg-card md:border-b-0 md:border-r">
            {renderCenter("full")}
          </main>
          <section className="min-h-0 min-w-0 flex-1 bg-elevated">
            <StageConsolePanel onInsertBeat={handleInsertIntoScene} />
          </section>
        </div>
      )}

      {/* ── Architect Mode: outliner + prose + Codex cockpit rail ── */}
      {effectiveMode === "architect" && (
        <div className="flex min-h-0 flex-1" data-testid="architect-mode">
          {/* Left rail: outliner + detected mentions (overlay on mobile). */}
          <aside
            data-testid="outline-sidebar"
            className={`flex-col overflow-y-auto border-ink-200 border-r bg-card ${
              mobilePanel === "outline"
                ? "fixed inset-y-0 left-0 z-30 flex w-72 shadow-xl"
                : "hidden"
            } md:static md:z-auto md:flex md:w-72 md:shrink-0 md:shadow-none`}
          >
            {renderOutlineRail()}
          </aside>
          {mobilePanel === "outline" && (
            <button
              type="button"
              aria-label="Close outline panel"
              onClick={() => setMobilePanel(null)}
              className="fixed inset-0 z-20 bg-black/40 md:hidden"
            />
          )}

          {/* Center: editor */}
          <main className="min-w-0 flex-1 bg-card">{renderCenter("full")}</main>

          {/* Right rail: drawers */}
          {rightDrawer && scene && (
            <aside className="border-ink-200 w-80 shrink-0 overflow-hidden border-l bg-card">
              {rightDrawer === "ai" && (
                <AiAssistantDrawer
                  key={scene.id}
                  sceneId={scene.id}
                  content={prose}
                  onClose={() => setRightDrawer(null)}
                  onInsertText={handleInsertIntoScene}
                />
              )}
            </aside>
          )}

          {/* Architect rail: Relation Linker + Timeline + Token Budget Bar. */}
          {OPERATING_MODES_ENABLED && (
            <aside
              data-testid="architect-rail-aside"
              className={`flex-col overflow-hidden border-ink-200 border-l bg-elevated ${
                mobilePanel === "tools"
                  ? "fixed inset-y-0 right-0 z-30 flex w-80 shadow-xl"
                  : "hidden"
              } lg:static lg:z-auto lg:flex lg:w-80 lg:shrink-0 lg:shadow-none`}
            >
              <ArchitectRail
                budget={budget}
                onOpenLinker={openLinker}
                onOpenTimeline={() => {
                  setTimelineOpen(true);
                  setMobilePanel(null);
                }}
              />
            </aside>
          )}
          {mobilePanel === "tools" && (
            <button
              type="button"
              aria-label="Close tools panel"
              onClick={() => setMobilePanel(null)}
              className="fixed inset-0 z-20 bg-black/40 lg:hidden"
            />
          )}
        </div>
      )}

      {/* AI drawer is an overlay in Writer/Stage modes (Architect docks it). */}
      {effectiveMode !== "architect" && rightDrawer === "ai" && scene && (
        <aside className="fixed inset-y-0 right-0 z-30 w-80 overflow-hidden border-l border-ink-200 bg-card shadow-xl">
          <AiAssistantDrawer
            key={scene.id}
            sceneId={scene.id}
            content={prose}
            onClose={() => setRightDrawer(null)}
            onInsertText={handleInsertIntoScene}
          />
        </aside>
      )}

      {/* Overlays shared by all modes */}
      <ProgressionTimelineDrawer
        isOpen={timelineOpen}
        novelId={novelId}
        outline={outline}
        currentSceneId={openSceneId}
        onClose={() => setTimelineOpen(false)}
      />
      {importOpen && (
        <ImportManuscriptDialog
          novelId={novelId}
          novelTitle={outline.novel.title}
          onClose={() => setImportOpen(false)}
          onImported={refreshOutline}
        />
      )}
      {linkerSource && (
        <RelationLinkerModal
          isOpen
          sourceEntry={linkerSource}
          entries={budget.entries.map((e) => ({ id: e.id, name: e.name, type: e.type }))}
          existingRelations={linkerChips}
          onClose={() => setLinkerSource(null)}
          onSaved={() => {
            if (linkerSource) budget.invalidateDetail(linkerSource.id);
          }}
        />
      )}
    </div>
  );
}
