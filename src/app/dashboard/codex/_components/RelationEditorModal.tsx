"use client";

import { useState } from "react";
import {
  createCodexRelationAction,
  deleteCodexRelationAction,
  updateCodexRelationAction,
} from "@/lib/codex/actions";
import { Modal, modalInputClasses, modalLabelClasses } from "./Modal";

export interface RelationDraft {
  id: string;
  relationType: string;
  reverseType: string | null;
  description: string | null;
  direction: "source" | "target";
  otherName: string;
}

interface RelationEditorModalProps {
  isOpen: boolean;
  entryId: string;
  entryName: string;
  /** Candidate entries for the relation target (create mode). */
  entries: Array<{ id: string; name: string; type: string }>;
  /** Existing relation to edit; null opens create mode. */
  relation: RelationDraft | null;
  onClose: () => void;
  /** Called after a successful create, update, or delete. */
  onSaved: () => void;
}

const RELATION_TYPE_PRESETS = [
  "ALLY",
  "RIVAL",
  "MENTOR",
  "MEMBER_OF",
  "LOCATED_IN",
  "OWNS",
  "FAMILY",
  "ENEMY",
  "LOVES",
];

/** Create / edit / delete modal for Codex relation graph edges. */
export function RelationEditorModal({
  isOpen,
  entryId,
  entryName,
  entries,
  relation,
  onClose,
  onSaved,
}: RelationEditorModalProps) {
  const [targetEntryId, setTargetEntryId] = useState("");
  const [relationType, setRelationType] = useState(relation?.relationType ?? "");
  const [reverseType, setReverseType] = useState(relation?.reverseType ?? "");
  const [description, setDescription] = useState(relation?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const isEdit = relation !== null;
  const otherCandidates = entries.filter((e) => e.id !== entryId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedType = relationType.trim();
    if (!trimmedType) {
      setError("Please provide a relation type.");
      return;
    }

    if (!isEdit && !targetEntryId) {
      setError("Please choose the related entry.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        relationType: trimmedType,
        reverseType: reverseType.trim() || null,
        description: description.trim() || null,
      };

      const res = isEdit
        ? await updateCodexRelationAction(relation.id, payload)
        : await createCodexRelationAction({
            sourceEntryId: entryId,
            targetEntryId,
            ...payload,
          });

      if (!res.success) {
        setError(res.error || "Failed to save relation.");
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
    if (!relation || !confirm(`Delete this relation with "${relation.otherName}"?`)) {
      return;
    }
    setSaving(true);
    try {
      const res = await deleteCodexRelationAction(relation.id);
      if (!res.success) {
        setError(res.error || "Failed to delete relation.");
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

  return (
    <Modal
      title={isEdit ? "Edit Relation" : "Add Relation"}
      onClose={onClose}
      testId="relation-editor-modal"
    >
      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {isEdit ? (
          <p className="text-sm text-ink-600">
            {relation.direction === "source" ? (
              <>
                <span className="font-semibold text-ink-900">{entryName}</span> →{" "}
                {relation.otherName}
              </>
            ) : (
              <>
                {relation.otherName} →{" "}
                <span className="font-semibold text-ink-900">{entryName}</span>
              </>
            )}
          </p>
        ) : (
          <div>
            <label className={modalLabelClasses}>Related Entry *</label>
            {otherCandidates.length > 0 ? (
              <select
                value={targetEntryId}
                onChange={(e) => setTargetEntryId(e.target.value)}
                className={modalInputClasses}
                autoFocus
              >
                <option value="">Choose an entry…</option>
                {otherCandidates.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.type})
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-1 text-xs text-amber-700">
                No other entries yet. Create another entry to relate it to {entryName}.
              </p>
            )}
          </div>
        )}

        <div>
          <label className={modalLabelClasses}>Relation Type *</label>
          <input
            type="text"
            list="relation-type-presets"
            value={relationType}
            onChange={(e) => setRelationType(e.target.value)}
            placeholder="e.g. ALLY, MENTOR, LOCATED_IN"
            className={modalInputClasses}
          />
          <datalist id="relation-type-presets">
            {RELATION_TYPE_PRESETS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        <div>
          <label className={modalLabelClasses}>Reverse Type (optional)</label>
          <input
            type="text"
            value={reverseType ?? ""}
            onChange={(e) => setReverseType(e.target.value)}
            placeholder="e.g. MENTOR → MENTORED_BY"
            className={modalInputClasses}
          />
        </div>

        <div>
          <label className={modalLabelClasses}>Description (optional)</label>
          <textarea
            rows={3}
            value={description ?? ""}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="How are they connected?"
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
              Delete Relation
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
              {saving ? "Saving..." : isEdit ? "Save Relation" : "Add Relation"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
