"use client";

import { useState } from "react";
import {
  createCodexProgressionAction,
  deleteCodexProgressionAction,
  updateCodexProgressionAction,
} from "@/lib/codex/actions";
import type { ProgressionMode } from "@/lib/codex/types";
import { Modal, modalInputClasses, modalLabelClasses } from "./Modal";

export interface ProgressionDraft {
  id: string;
  sceneId: string;
  mode: ProgressionMode;
  description: string;
  notes: string | null;
}

interface ProgressionEditorModalProps {
  isOpen: boolean;
  entryId: string;
  /** Existing progression to edit; null opens create mode. */
  progression: ProgressionDraft | null;
  /** Scenes in reading order, labeled "Novel · Act → Chapter → Scene". */
  sceneOptions: Array<{ id: string; label: string }>;
  onClose: () => void;
  /** Called after a successful create, update, or delete. */
  onSaved: () => void;
}

/**
 * Create / edit / delete modal for temporal progressions. The scene is chosen
 * from the novel reading order at creation and fixed afterwards (the service
 * does not support re-pointing a progression at another scene).
 */
export function ProgressionEditorModal({
  isOpen,
  entryId,
  progression,
  sceneOptions,
  onClose,
  onSaved,
}: ProgressionEditorModalProps) {
  const [sceneId, setSceneId] = useState(progression?.sceneId ?? "");
  const [mode, setMode] = useState<ProgressionMode>(progression?.mode ?? "ADDITION");
  const [description, setDescription] = useState(progression?.description ?? "");
  const [notes, setNotes] = useState(progression?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const isEdit = progression !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isEdit && !sceneId) {
      setError("Please choose the scene where this state becomes active.");
      return;
    }

    const trimmedDesc = description.trim();
    if (!trimmedDesc) {
      setError("Please describe the evolved state.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        mode,
        description: trimmedDesc,
        notes: notes.trim() || null,
      };

      const res = isEdit
        ? await updateCodexProgressionAction(progression.id, payload)
        : await createCodexProgressionAction({
            entryId,
            sceneId,
            ...payload,
          });

      if (!res.success) {
        setError(res.error || "Failed to save progression.");
        setSaving(false);
        return;
      }

      setSaving(false);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!progression || !confirm("Delete this progression?")) {
      return;
    }
    setSaving(true);
    try {
      const res = await deleteCodexProgressionAction(progression.id);
      if (!res.success) {
        setError(res.error || "Failed to delete progression.");
        setSaving(false);
        return;
      }
      setSaving(false);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setSaving(false);
    }
  }

  const sceneLabel = isEdit
    ? (sceneOptions.find((s) => s.id === progression.sceneId)?.label ?? progression.sceneId)
    : "";

  return (
    <Modal
      title={isEdit ? "Edit Progression" : "Add Progression"}
      onClose={onClose}
      testId="progression-editor-modal"
    >
      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {isEdit ? (
          <div>
            <label className={modalLabelClasses}>Scene (fixed)</label>
            <p className="mt-1 text-sm text-ink-700">{sceneLabel}</p>
          </div>
        ) : (
          <div>
            <label className={modalLabelClasses}>Scene (reading order) *</label>
            {sceneOptions.length > 0 ? (
              <select
                value={sceneId}
                onChange={(e) => setSceneId(e.target.value)}
                className={modalInputClasses}
                autoFocus
              >
                <option value="">Choose a scene…</option>
                {sceneOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-1 text-xs text-amber-700">
                No scenes found for this entry's scope yet. Create acts, chapters, and scenes in the
                writing workspace first.
              </p>
            )}
          </div>
        )}

        <div>
          <label className={modalLabelClasses}>Mode *</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ProgressionMode)}
            className={modalInputClasses}
          >
            <option value="ADDITION">ADDITION — appends to the description</option>
            <option value="REPLACEMENT">REPLACEMENT — replaces the description</option>
          </select>
        </div>

        <div>
          <label className={modalLabelClasses}>Evolved Description *</label>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is true about this entry from this scene onward?"
            className={modalInputClasses}
          />
        </div>

        <div>
          <label className={modalLabelClasses}>Private Notes (optional)</label>
          <textarea
            rows={2}
            value={notes ?? ""}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Author reminders for this beat..."
            className={modalInputClasses}
          />
        </div>

        <div className="flex items-center justify-between border-t border-ink-200 pt-4">
          {isEdit ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="rounded-md border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Delete Progression
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-ink-800 px-4 py-2 text-sm font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-50"
            >
              {saving ? "Saving..." : isEdit ? "Save Progression" : "Add Progression"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
