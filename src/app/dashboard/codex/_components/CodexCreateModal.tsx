"use client";

import { useState } from "react";
import { createCodexEntryAction } from "@/lib/codex/actions";
import type { CodexTrackingMode, CodexType } from "@/lib/codex/types";

interface CodexCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  novels: Array<{ id: string; title: string; seriesId: string | null }>;
  series: Array<{ id: string; title: string }>;
  onCreated: (entry: any) => void;
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

const COLOR_PRESETS = [
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#8b5cf6", // Purple
  "#f59e0b", // Amber
  "#ef4444", // Red
  "#ec4899", // Pink
  "#6b7280", // Gray
];

export function CodexCreateModal({
  isOpen,
  onClose,
  novels,
  series,
  onCreated,
}: CodexCreateModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<CodexType>("CHARACTER");
  const [trackingMode, setTrackingMode] = useState<CodexTrackingMode>("DETECTED");
  const [seriesScoped, setSeriesScoped] = useState(false);
  const [selectedNovelId, setSelectedNovelId] = useState(novels[0]?.id || "");
  const [selectedSeriesId, setSelectedSeriesId] = useState(series[0]?.id || "");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [aliasesText, setAliasesText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please provide an entry name.");
      return;
    }

    if (!seriesScoped && !selectedNovelId) {
      setError("Book-scoped entries must be associated with a novel.");
      return;
    }

    if (seriesScoped && !selectedSeriesId) {
      setError("Series-scoped entries must be associated with a series.");
      return;
    }

    setLoading(true);

    try {
      const aliases = aliasesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await createCodexEntryAction({
        name: trimmedName,
        type,
        trackingMode,
        seriesScoped,
        novelId: seriesScoped ? null : selectedNovelId,
        seriesId: seriesScoped ? selectedSeriesId : null,
        description,
        notes: notes.trim() || null,
        color,
        aliases,
      });

      if (!res.success) {
        setError(res.error || "Failed to create entry.");
        setLoading(false);
        return;
      }

      onCreated(res.data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      data-testid="codex-create-modal"
    >
      <div className="border-ink-200 bg-ink-50 text-ink-900 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between border-b border-ink-200 pb-3">
          <h2 className="text-xl font-semibold">New Codex Entry</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-700 text-sm"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
              Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mara Vance, Sunken Archives"
              className="border-ink-200 bg-ink-100 focus:border-ink-400 mt-1 w-full rounded-md border p-2 text-sm focus:outline-hidden"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
                Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CodexType)}
                className="border-ink-200 bg-ink-100 focus:border-ink-400 mt-1 w-full rounded-md border p-2 text-sm focus:outline-hidden"
              >
                {CODEX_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
                Tracking Mode
              </label>
              <select
                value={trackingMode}
                onChange={(e) => setTrackingMode(e.target.value as CodexTrackingMode)}
                className="border-ink-200 bg-ink-100 focus:border-ink-400 mt-1 w-full rounded-md border p-2 text-sm focus:outline-hidden"
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
            <span className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
              Scope
            </span>
            <div className="mt-1 flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="scope"
                  checked={!seriesScoped}
                  onChange={() => setSeriesScoped(false)}
                />
                Book-specific
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="scope"
                  checked={seriesScoped}
                  onChange={() => setSeriesScoped(true)}
                />
                Series-wide
              </label>
            </div>
          </div>

          {seriesScoped ? (
            <div>
              <label className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
                Target Series *
              </label>
              {series.length > 0 ? (
                <select
                  value={selectedSeriesId}
                  onChange={(e) => setSelectedSeriesId(e.target.value)}
                  className="border-ink-200 bg-ink-100 focus:border-ink-400 mt-1 w-full rounded-md border p-2 text-sm focus:outline-hidden"
                >
                  {series.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-1 text-xs text-amber-700">
                  No series created yet. Please create a series first.
                </p>
              )}
            </div>
          ) : (
            <div>
              <label className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
                Target Novel *
              </label>
              {novels.length > 0 ? (
                <select
                  value={selectedNovelId}
                  onChange={(e) => setSelectedNovelId(e.target.value)}
                  className="border-ink-200 bg-ink-100 focus:border-ink-400 mt-1 w-full rounded-md border p-2 text-sm focus:outline-hidden"
                >
                  {novels.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-1 text-xs text-amber-700">
                  No novels created yet. Seed demo data or create a novel.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
              Color Theme
            </label>
            <div className="mt-1 flex items-center gap-2">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setColor(preset)}
                  className={`h-6 w-6 rounded-full transition-transform ${
                    color === preset
                      ? "scale-110 ring-2 ring-ink-800 ring-offset-1"
                      : "hover:scale-105"
                  }`}
                  style={{ backgroundColor: preset }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
              Aliases (comma separated)
            </label>
            <input
              type="text"
              value={aliasesText}
              onChange={(e) => setAliasesText(e.target.value)}
              placeholder="e.g. The Glass Weaver, Mara"
              className="border-ink-200 bg-ink-100 focus:border-ink-400 mt-1 w-full rounded-md border p-2 text-sm focus:outline-hidden"
            />
          </div>

          <div>
            <label className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
              Description
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Primary world bible description..."
              className="border-ink-200 bg-ink-100 focus:border-ink-400 mt-1 w-full rounded-md border p-2 text-sm focus:outline-hidden"
            />
          </div>

          <div>
            <label className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
              Private Author Notes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Secret backstory, plot triggers, author reminders..."
              className="border-ink-200 bg-ink-100 focus:border-ink-400 mt-1 w-full rounded-md border p-2 text-sm focus:outline-hidden"
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-ink-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="border-ink-200 text-ink-600 hover:bg-ink-100 rounded-md border px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-ink-800 hover:bg-ink-900 text-ink-50 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
