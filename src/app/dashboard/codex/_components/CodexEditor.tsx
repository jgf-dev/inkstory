"use client";

import { useEffect, useState } from "react";
import {
  createCodexAliasAction,
  createCodexTagAction,
  deleteCodexAliasAction,
  deleteCodexEntryAction,
  deleteCodexTagAction,
  getCodexEntryAction,
  updateCodexEntryAction,
} from "@/lib/codex/actions";
import type { CodexTrackingMode, CodexType } from "@/lib/codex/types";

interface CodexEditorProps {
  entryId: string;
  initialEntry?: Record<string, any> | null;
  onEntryUpdated: (entry: any) => void;
  onEntryDeleted: (entryId: string) => void;
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

export function CodexEditor({
  entryId,
  initialEntry,
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

  // Sub-entity inputs
  const [newAliasName, setNewAliasName] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [addingAlias, setAddingAlias] = useState(false);
  const [addingTag, setAddingTag] = useState(false);

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
        setEntry(res.data);
        setName(res.data.name);
        setType(res.data.type as CodexType);
        setTrackingMode(res.data.trackingMode as CodexTrackingMode);
        setDescription(res.data.description || "");
        setNotes(res.data.notes || "");
        setColor(res.data.color || "#3b82f6");
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
  }, [entryId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await updateCodexEntryAction(entryId, {
        name: name.trim(),
        type,
        trackingMode,
        description,
        notes: notes.trim() || null,
        color,
      });

      if (!res.success) {
        setError(res.error || "Failed to update entry.");
        setSaving(false);
        return;
      }

      setEntry(res.data);
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
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-600">
              Relations Graph
            </h3>
            <div className="mt-2 space-y-1.5">
              {entry.sourceRelations?.map((r: any) => (
                <div
                  key={r.id}
                  className="rounded border border-ink-200 bg-ink-100 p-2 text-xs text-ink-700"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink-900">{r.relationType}</span>
                    <span className="font-medium text-ink-600">
                      → {r.targetEntry?.name ?? r.targetEntryId}
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
                    <span className="font-medium text-ink-600">
                      ← {r.sourceEntry?.name ?? r.sourceEntryId}
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
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-600">
              Temporal Progressions
            </h3>
            <div className="mt-2 space-y-1.5">
              {entry.progressions?.map((p: any) => (
                <div
                  key={p.id}
                  className="rounded border border-ink-200 bg-ink-100 p-2 text-xs text-ink-700"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold uppercase tracking-wide text-ink-600">
                      {p.mode}
                    </span>
                  </div>
                  <p className="mt-0.5 text-ink-800">{p.description}</p>
                </div>
              ))}
              {(!entry.progressions || entry.progressions.length === 0) && (
                <p className="text-xs text-ink-400">No progressions recorded yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
