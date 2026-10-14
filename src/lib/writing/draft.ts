/**
 * Local-storage draft fallback for the scene editor (launch-phase-3 risk
 * mitigation: "author data loss during long writing sessions"). Drafts are
 * written on every debounced save attempt and cleared on a successful save;
 * if the server save failed, the draft remains and is offered for restore on
 * the next visit to the scene.
 *
 * All storage access is guarded so SSR and private-mode browsers are safe.
 */

export interface SceneDraft {
  sceneId: string;
  title: string;
  content: string;
  summary: string;
  /** Client timestamp (ms) of the last draft edit. */
  savedAt: number;
  /** True when the last matching server save attempt failed or never ran. */
  unsaved: boolean;
}

function draftKey(sceneId: string): string {
  return `inkstory.scene-draft.${sceneId}`;
}

export function isDraftStorageAvailable(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function saveDraft(draft: SceneDraft): void {
  if (!isDraftStorageAvailable()) {
    return;
  }
  try {
    window.localStorage.setItem(draftKey(draft.sceneId), JSON.stringify(draft));
  } catch {
    // Quota exceeded or storage disabled: the in-memory editor state is still
    // the source of truth, so a failed local backup is non-fatal.
  }
}

export function loadDraft(sceneId: string): SceneDraft | null {
  if (!isDraftStorageAvailable()) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(draftKey(sceneId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<SceneDraft>;
    if (
      !parsed ||
      parsed.sceneId !== sceneId ||
      typeof parsed.savedAt !== "number" ||
      typeof parsed.content !== "string"
    ) {
      window.localStorage.removeItem(draftKey(sceneId));
      return null;
    }
    return {
      sceneId,
      title: typeof parsed.title === "string" ? parsed.title : "",
      content: parsed.content,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      savedAt: parsed.savedAt,
      unsaved: parsed.unsaved === true,
    };
  } catch {
    return null;
  }
}

export function clearDraft(sceneId: string): void {
  if (!isDraftStorageAvailable()) {
    return;
  }
  try {
    window.localStorage.removeItem(draftKey(sceneId));
  } catch {
    // Non-fatal; see saveDraft.
  }
}

/**
 * A stored draft is worth offering only when it is newer than the server row
 * and was actually marked unsaved (the server save never confirmed it).
 */
export function isDraftRecoverable(draft: SceneDraft | null, serverUpdatedAtMs: number): boolean {
  if (!draft || !draft.unsaved) {
    return false;
  }
  return draft.savedAt > serverUpdatedAtMs;
}
