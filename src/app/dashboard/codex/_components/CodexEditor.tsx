"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createCodexAliasAction,
  createCodexTagAction,
  deleteCodexAliasAction,
  deleteCodexEntryAction,
  deleteCodexProgressionAction,
  deleteCodexRelationAction,
  deleteCodexTagAction,
  getCodexEntryAction,
  updateCodexEntryAction,
} from "@/lib/codex/actions";
import type { CodexTrackingMode, CodexType, JsonValue } from "@/lib/codex/types";
import type { RelationDraft } from "./RelationEditorModal";
import { RelationEditorModal } from "./RelationEditorModal";
import type { ProgressionDraft } from "./ProgressionEditorModal";
import { ProgressionEditorModal } from "./ProgressionEditorModal";

interface CodexEditorProps {
  entryId: string;
  initialEntry?: Record<string, any> | null;
  /** All entries in the codex, for relation-target selection. */
  entries?: Array<{ id: string; name: string; type: string }>;
  /** Novels of the author, for progression scene loading (reading order). */
  novels?: Array<{ id: string; title: string; seriesId: string | null }>;
  onEntryUpdated: (entry: any) => void;
  onEntryDeleted: (entryId: string) => void;
}

interface SceneOption {
  id: string;
  label: string;
}

interface CustomFieldRow {
  key: string;
  value: string;
}

const CODEX_TYPES: CodexType[] = [
  "CHARACTER",
  "LOCATION",
  "ITEM",
  "LORE",
  "FACTION",
  "CONCEPT",
  "OTHER",
];

const TRACKING_MODES: CodexTrackingMode[] = ["ALWAYS", "DETECTED", "NEVER"];

/** Flattens an outline into scene options in reading order. */
function sceneOptionsFromOutline(outline: any, novelTitle: string | null): SceneOption[] {
  const options: SceneOption[] = [];
  for (const act of outline.acts ?? []) {
    for (const chapter of act.chapters ?? []) {
      for (const scene of chapter.scenes ?? []) {
        options.push({
          id: scene.id,
          label: `${novelTitle ? `${novelTitle} · ` : ""}${act.title} → ${chapter.title} → ${scene.title}`,
        });
      }
    }
  }
  return options;
}

/**
 * Renders a custom-field value for editing: strings stay raw, other JSON
 * scalars/structures are shown as JSON text.
 */
function fieldRowValue(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Parses an edited field value back into JSON: valid JSON literals win,
 * everything else is stored as a plain string.
 */
function parseFieldValue(raw: string): JsonValue {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return "";
  }
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return raw;
  }
}

export function CodexEditor({
  entryId,
  initialEntry,
  entries = [],
  novels = [],
  onEntryUpdated,
  onEntryDeleted,
}: CodexEditorProps) {
  const [entry, setEntry] = useState<Record<string, any> | null>(initialEntry ?? null);
  const [loading, setLoading] = useState(!initialEntry);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState(initialEntry?.name ?? "");
  const [type, setType] = useState<CodexType>(initialEntry?.type ?? "CHARACTER");
  const [trackingMode, setTrackingMode] = useState<CodexTrackingMode>(
    initialEntry?.trackingMode ?? "DETECTED",
  );
  const [description, setDescription] = useState(initialEntry?.description ?? "");
  const [notes, setNotes] = useState(initialEntry?.notes ?? "");
  const [color, setColor] = useState(initialEntry?.color ?? "#3b82f6");
  const [customFields, setCustomFields] = useState<CustomFieldRow[]>(() =>
    Object.entries(initialEntry?.customFields ?? {}).map(([key, value]) => ({
      key,
      value: fieldRowValue(value as JsonValue),
    })),
  );

  // Sub-entity inputs
  const [newAliasName, setNewAliasName] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [addingAlias, setAddingAlias] = useState(false);
  const [addingTag, setAddingTag] = useState(false);

  // Modal state (mounted only while open so form state resets per open).
  const [relationModal, setRelationModal] = useState<{
    open: boolean;
    relation: RelationDraft | null;
  }>({ open: false, relation: null });
  const [progressionModal, setProgressionModal] = useState<{
    open: boolean;
    progression: ProgressionDraft | null;
  }>({ open: false, progression: null });

  // Scene options in reading order (progression picker + row labels).
  const [sceneOptions, setSceneOptions] = useState<SceneOption[]>([]);
  const [sceneOptionsLoading, setSceneOptionsLoading] = useState(false);

  const applyEntry = useCallback((data: Record<string, any>) => {
    setEntry(data);
    setName(data.name);
    setType(data.type as CodexType);
    setTrackingMode(data.trackingMode as CodexTrackingMode);
    setDescription(data.description || "");
    setNotes(data.notes || "");
    setColor(data.color || "#3b82f6");
    setCustomFields(
      Object.entries(data.customFields ?? {}).map(([key, value]) => ({
        key,
        value: fieldRowValue(value as JsonValue),
      })),
    );
  }, []);

  const refreshEntry = useCallback(async () => {
    const res = await getCodexEntryAction(entryId);
    if (!res.success) {
      setError(res.error || "Failed to refresh entry");
      return;
    }
    applyEntry(res.data as Record<string, any>);
  }, [entryId, applyEntry]);

  useEffect(() => {
    let active = true;
    if (!initialEntry || initialEntry.id !== entryId) {
      setLoading(true);
    }
    setError(null);
    setSuccessMsg(null);

    getCodexEntryAction(entryId)
      .then((res) => {
        if (!active) return;
        if (!res.success) {
          setError(res.error || "Failed to load entry");
          return;
        }
        applyEntry(res.data as Record<string, any>);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [entryId, initialEntry, applyEntry]);

  // Load scene options for the entry's scope (book or series) whenever the
  // loaded entry changes. Degrades gracefully when the fetch fails.
  useEffect(() => {
    if (!entry) {
      return;
    }

    const outlineNovelIds = entry.seriesScoped
      ? novels.filter((n) => n.seriesId && n.seriesId === entry.seriesId).map((n) => n.id)
      : entry.novelId
        ? [entry.novelId as string]
        : [];

    if (outlineNovelIds.length === 0) {
      setSceneOptions([]);
      return;
    }

    let active = true;
    setSceneOptionsLoading(true);
    void Promise.all(
      outlineNovelIds.map((novelId) =>
        fetch(`/api/novels/${novelId}/outline`)
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null),
      ),
    )
      .catch(() => outlineNovelIds.map(() => null))
      .then((results) => {
        if (!active) return;
        const options: SceneOption[] = [];
        results.forEach((payload, index) => {
          if (!payload?.outline) return;
          options.push(
            ...sceneOptionsFromOutline(
              payload.outline,
              novels.find((n) => n.id === outlineNovelIds[index])?.title ?? null,
            ),
          );
        });
        setSceneOptions(options);
      })
      .finally(() => {
        if (active) setSceneOptionsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [entry?.id, entry?.seriesScoped, entry?.seriesId, entry?.novelId, novels]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    // Validate custom field rows before building the payload.
    const trimmedFields: CustomFieldRow[] = [];
    for (const row of customFields) {
      const key = row.key.trim();
      if (!key && !row.value.trim()) {
        continue; // drop fully-empty rows
      }
      if (!key) {
        setError("Every custom field needs a name (or clear the row).");
        setSaving(false);
        return;
      }
      if (trimmedFields.some((r) => r.key === key)) {
        setError(`Duplicate custom field name: "${key}".`);
        setSaving(false);
        return;
      }
      trimmedFields.push({ key, value: row.value });
    }

    const fieldRecord: Record<string, JsonValue> = {};
    for (const row of trimmedFields) {
      fieldRecord[row.key] = parseFieldValue(row.value);
    }

    try {
      const res = await updateCodexEntryAction(entryId, {
        name: name.trim(),
        type,
        trackingMode,
        description,
        notes: notes.trim() || null,
        color,
        customFields: fieldRecord,
      });

      if (!res.success) {
        setError(res.error || "Failed to update entry.");
        setSaving(false);
        return;
      }

      applyEntry(res.data as Record<string, any>);
      onEntryUpdated(res.data);
      setSuccessMsg("Changes saved successfully.");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!entry || !confirm(`Are you sure you want to delete "${entry.name}"?`)) {
      return;
    }

    try {
      const res = await deleteCodexEntryAction(entryId);
      if (!res.success) {
        setError(res.error || "Failed to delete entry.");
        return;
      }
      onEntryDeleted(entryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error deleting entry.");
    }
  }

  async function handleAddAlias(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newAliasName.trim();
    if (!trimmed) return;

    setAddingAlias(true);
    try {
      const res = await createCodexAliasAction({ entryId, name: trimmed });
      if (!res.success) {
        setError(res.error || "Failed to add alias");
        return;
      }
      setEntry((prev: any) => ({
        ...prev,
        aliases: [...(prev?.aliases || []), res.data],
      }));
      setNewAliasName("");
    } finally {
      setAddingAlias(false);
    }
  }

  async function handleDeleteAlias(aliasId: string) {
    try {
      await deleteCodexAliasAction(aliasId);
      setEntry((prev: any) => ({
        ...prev,
        aliases: prev?.aliases?.filter((a: any) => a.id !== aliasId) || [],
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete alias");
    }
  }

  async function handleAddTag(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newTagName.trim();
    if (!trimmed) return;

    setAddingTag(true);
    try {
      const res = await createCodexTagAction({ entryId, name: trimmed });
      if (!res.success) {
        setError(res.error || "Failed to add tag");
        return;
      }
      setEntry((prev: any) => ({
        ...prev,
        tags: [...(prev?.tags || []), res.data],
      }));
      setNewTagName("");
    } finally {
      setAddingTag(false);
    }
  }

  async function handleDeleteTag(tagId: string) {
    try {
      await deleteCodexTagAction(tagId);
      setEntry((prev: any) => ({
        ...prev,
        tags: prev?.tags?.filter((t: any) => t.id !== tagId) || [],
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete tag");
    }
  }

  function updateFieldRow(index: number, patch: Partial<CustomFieldRow>) {
    setCustomFields((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-ink-500">
        Loading entry details...
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-ink-500">
        {error || "Entry not found."}
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="codex-editor">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-200 pb-4">
        <div className="flex items-center gap-3">
          <div
            className="h-5 w-5 rounded-full ring-2 ring-ink-200"
            style={{ backgroundColor: color || "#3b82f6" }}
          />
          <div>
            <h2 className="text-2xl font-semibold text-ink-900">{name || "Untitled Entry"}</h2>
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded bg-ink-200 px-2 py-0.5 text-xs font-medium text-ink-700">
                {type}
              </span>
              <span className="rounded bg-ink-100 px-2 py-0.5 text-xs text-ink-600">
                {entry.seriesScoped ? "Series-Scoped" : "Book-Scoped"}
              </span>
              <span className="rounded bg-ink-100 px-2 py-0.5 text-xs text-ink-600">
                {trackingMode}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-ink-800 px-4 py-1.5 text-xs font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-700">
          {successMsg}
        </div>
      )}

      {/* Main Form Fields */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-600">
              Entry Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-ink-200 bg-ink-100 p-2 text-sm focus:border-ink-400 focus:outline-hidden"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-600">
                Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CodexType)}
                className="mt-1 w-full rounded-md border border-ink-200 bg-ink-100 p-2 text-sm focus:border-ink-400 focus:outline-hidden"
              >
                {CODEX_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-600">
                Tracking Mode
              </label>
              <select
                value={trackingMode}
                onChange={(e) => setTrackingMode(e.target.value as CodexTrackingMode)}
                className="mt-1 w-full rounded-md border border-ink-200 bg-ink-100 p-2 text-sm focus:border-ink-400 focus:outline-hidden"
              >
                {TRACKING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-600">
              Description
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-ink-200 bg-ink-100 p-2 text-sm focus:border-ink-400 focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-600">
              Private Author Notes
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-md border border-ink-200 bg-ink-100 p-2 text-sm focus:border-ink-400 focus:outline-hidden"
            />
          </div>

          {/* Custom Fields */}
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-600">
              Custom Fields
            </h3>
            <p className="mt-0.5 text-[11px] text-ink-400">
              Key-value attributes injected into AI context. Values may be plain text, numbers, or
              booleans.
            </p>
            <div className="mt-2 space-y-2" data-testid="custom-fields-editor">
              {customFields.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.key}
                    onChange={(e) => updateFieldRow(index, { key: e.target.value })}
                    placeholder="Field name (e.g. Age)"
                    aria-label={`Custom field ${index + 1} name`}
                    className="w-2/5 rounded border border-ink-200 bg-ink-100 px-2 py-1 text-xs focus:border-ink-400 focus:outline-hidden"
                  />
                  <input
                    type="text"
                    value={row.value}
                    onChange={(e) => updateFieldRow(index, { value: e.target.value })}
                    placeholder="Value"
                    aria-label={`Custom field ${index + 1} value`}
                    className="w-full rounded border border-ink-200 bg-ink-100 px-2 py-1 text-xs focus:border-ink-400 focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setCustomFields((prev) => prev.filter((_, i) => i !== index))}
                    aria-label={`Remove custom field ${index + 1}`}
                    className="text-ink-400 hover:text-ink-700"
                  >
                    ×
                  </button>
                </div>
              ))}
              {customFields.length === 0 && (
                <p className="text-xs text-ink-400">No custom fields yet.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCustomFields((prev) => [...prev, { key: "", value: "" }])}
              className="mt-2 rounded bg-ink-700 px-3 py-1 text-xs font-medium text-ink-50 hover:bg-ink-800"
            >
              + Add Field
            </button>
          </div>
        </div>

        {/* Right column: Aliases, Tags, Relations, Progressions */}
        <div className="space-y-6">
          {/* Aliases */}
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-600">
              Aliases (Mention Detection)
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entry.aliases?.map((a: any) => (
                <span
                  key={a.id}
                  className="flex items-center gap-1 rounded bg-ink-100 px-2 py-0.5 text-xs text-ink-800"
                >
                  {a.name}
                  <button
                    type="button"
                    onClick={() => handleDeleteAlias(a.id)}
                    className="text-ink-400 hover:text-ink-700 ml-1"
                  >
                    ×
                  </button>
                </span>
              ))}
              {(!entry.aliases || entry.aliases.length === 0) && (
                <p className="text-xs text-ink-400">No aliases added yet.</p>
              )}
            </div>

            <form onSubmit={handleAddAlias} className="mt-3 flex gap-2">
              <input
                type="text"
                placeholder="New alias name..."
                value={newAliasName}
                onChange={(e) => setNewAliasName(e.target.value)}
                className="w-full rounded border border-ink-200 bg-ink-100 px-2 py-1 text-xs focus:border-ink-400 focus:outline-hidden"
              />
              <button
                type="submit"
                disabled={addingAlias || !newAliasName.trim()}
                className="rounded bg-ink-700 px-3 py-1 text-xs font-medium text-ink-50 hover:bg-ink-800 disabled:opacity-50"
              >
                Add
              </button>
            </form>
          </div>

          {/* Tags */}
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-600">Tags</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entry.tags?.map((t: any) => (
                <span
                  key={t.id}
                  className="flex items-center gap-1 rounded bg-ink-100 px-2 py-0.5 text-xs text-ink-800"
                >
                  {t.name}
                  <button
                    type="button"
                    onClick={() => handleDeleteTag(t.id)}
                    className="text-ink-400 hover:text-ink-700 ml-1"
                  >
                    ×
                  </button>
                </span>
              ))}
              {(!entry.tags || entry.tags.length === 0) && (
                <p className="text-xs text-ink-400">No tags added yet.</p>
              )}
            </div>

            <form onSubmit={handleAddTag} className="mt-3 flex gap-2">
              <input
                type="text"
                placeholder="New tag..."
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                className="w-full rounded border border-ink-200 bg-ink-100 px-2 py-1 text-xs focus:border-ink-400 focus:outline-hidden"
              />
              <button
                type="submit"
                disabled={addingTag || !newTagName.trim()}
                className="rounded bg-ink-700 px-3 py-1 text-xs font-medium text-ink-50 hover:bg-ink-800 disabled:opacity-50"
              >
                Add
              </button>
            </form>
          </div>

          {/* Graph Relations */}
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-600">
                Relations Graph
              </h3>
              <button
                type="button"
                onClick={() => setRelationModal({ open: true, relation: null })}
                className="rounded bg-ink-700 px-2.5 py-1 text-xs font-medium text-ink-50 hover:bg-ink-800"
              >
                + Add Relation
              </button>
            </div>
            <div className="mt-2 space-y-1.5" data-testid="relations-list">
              {entry.sourceRelations?.map((r: any) => (
                <div
                  key={r.id}
                  className="rounded border border-ink-200 bg-ink-100 p-2 text-xs text-ink-700"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink-900">{r.relationType}</span>
                    <span className="flex items-center gap-2 font-medium text-ink-600">
                      → {r.targetEntry?.name ?? r.targetEntryId}
                      <button
                        type="button"
                        aria-label={`Edit relation to ${r.targetEntry?.name ?? r.targetEntryId}`}
                        onClick={() =>
                          setRelationModal({
                            open: true,
                            relation: {
                              id: r.id,
                              relationType: r.relationType,
                              reverseType: r.reverseType,
                              description: r.description,
                              direction: "source",
                              otherName: r.targetEntry?.name ?? r.targetEntryId,
                            },
                          })
                        }
                        className="text-ink-400 hover:text-ink-700"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete relation to ${r.targetEntry?.name ?? r.targetEntryId}`}
                        onClick={async () => {
                          if (!confirm("Delete this relation?")) return;
                          await updateCodexRelationGuard(r.id);
                        }}
                        className="text-ink-400 hover:text-red-600"
                      >
                        ×
                      </button>
                    </span>
                  </div>
                  {r.description && <p className="mt-0.5 text-ink-500">{r.description}</p>}
                </div>
              ))}
              {entry.targetRelations?.map((r: any) => (
                <div
                  key={r.id}
                  className="rounded border border-ink-200 bg-ink-100 p-2 text-xs text-ink-700"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink-900">
                      {r.reverseType || r.relationType}
                    </span>
                    <span className="flex items-center gap-2 font-medium text-ink-600">
                      ← {r.sourceEntry?.name ?? r.sourceEntryId}
                      <button
                        type="button"
                        aria-label={`Edit relation from ${r.sourceEntry?.name ?? r.sourceEntryId}`}
                        onClick={() =>
                          setRelationModal({
                            open: true,
                            relation: {
                              id: r.id,
                              relationType: r.relationType,
                              reverseType: r.reverseType,
                              description: r.description,
                              direction: "target",
                              otherName: r.sourceEntry?.name ?? r.sourceEntryId,
                            },
                          })
                        }
                        className="text-ink-400 hover:text-ink-700"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete relation from ${r.sourceEntry?.name ?? r.sourceEntryId}`}
                        onClick={async () => {
                          if (!confirm("Delete this relation?")) return;
                          await updateCodexRelationGuard(r.id);
                        }}
                        className="text-ink-400 hover:text-red-600"
                      >
                        ×
                      </button>
                    </span>
                  </div>
                  {r.description && <p className="mt-0.5 text-ink-500">{r.description}</p>}
                </div>
              ))}
              {(!entry.sourceRelations || entry.sourceRelations.length === 0) &&
                (!entry.targetRelations || entry.targetRelations.length === 0) && (
                  <p className="text-xs text-ink-400">No relations established yet.</p>
                )}
            </div>
          </div>

          {/* Temporal Progressions */}
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-600">
                Temporal Progressions
              </h3>
              <button
                type="button"
                onClick={() => setProgressionModal({ open: true, progression: null })}
                disabled={sceneOptionsLoading}
                className="rounded bg-ink-700 px-2.5 py-1 text-xs font-medium text-ink-50 hover:bg-ink-800 disabled:opacity-50"
              >
                {sceneOptionsLoading ? "Loading scenes…" : "+ Add Progression"}
              </button>
            </div>
            <div className="mt-2 space-y-1.5" data-testid="progressions-list">
              {entry.progressions?.map((p: any) => {
                const sceneLabel = sceneOptions.find((s) => s.id === p.sceneId)?.label ?? p.sceneId;
                return (
                  <div
                    key={p.id}
                    className="rounded border border-ink-200 bg-ink-100 p-2 text-xs text-ink-700"
                  >
                    <div className="flex items-center justify-between">
                      <span className="rounded bg-ink-200 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-ink-700">
                        {p.mode}
                      </span>
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label="Edit progression"
                          onClick={() =>
                            setProgressionModal({
                              open: true,
                              progression: {
                                id: p.id,
                                sceneId: p.sceneId,
                                mode: p.mode,
                                description: p.description,
                                notes: p.notes,
                              },
                            })
                          }
                          className="text-ink-400 hover:text-ink-700"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label="Delete progression"
                          onClick={async () => {
                            if (!confirm("Delete this progression?")) return;
                            await deleteProgressionGuard(p.id);
                          }}
                          className="text-ink-400 hover:text-red-600"
                        >
                          ×
                        </button>
                      </span>
                    </div>
                    <p className="mt-1 text-ink-800">{p.description}</p>
                    <p className="mt-0.5 text-[11px] text-ink-500">At: {sceneLabel}</p>
                  </div>
                );
              })}
              {(!entry.progressions || entry.progressions.length === 0) && (
                <p className="text-xs text-ink-400">No progressions recorded yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sub-editors (mounted only while open so their form state resets) */}
      {relationModal.open && (
        <RelationEditorModal
          isOpen
          entryId={entryId}
          entryName={entry.name}
          entries={entries}
          relation={relationModal.relation}
          onClose={() => setRelationModal({ open: false, relation: null })}
          onSaved={refreshEntry}
        />
      )}
      {progressionModal.open && (
        <ProgressionEditorModal
          isOpen
          entryId={entryId}
          progression={progressionModal.progression}
          sceneOptions={sceneOptions}
          onClose={() => setProgressionModal({ open: false, progression: null })}
          onSaved={refreshEntry}
        />
      )}
    </div>
  );

  /** Inline delete for relation rows (kept near the rows for clarity). */
  async function updateCodexRelationGuard(relationId: string) {
    try {
      const res = await deleteCodexRelationAction(relationId);
      if (!res.success) {
        setError(res.error || "Failed to delete relation");
        return;
      }
      await refreshEntry();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete relation");
    }
  }

  /** Inline delete for progression rows. */
  async function deleteProgressionGuard(progressionId: string) {
    try {
      const res = await deleteCodexProgressionAction(progressionId);
      if (!res.success) {
        setError(res.error || "Failed to delete progression");
        return;
      }
      await refreshEntry();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete progression");
    }
  }
}
