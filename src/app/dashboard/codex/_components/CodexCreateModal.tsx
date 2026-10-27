"use client";

import React from "react";
import type { CodexTrackingMode, CodexType } from "@/lib/codex/types";
import { useCodexCreateForm } from "./useCodexCreateForm";

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
  const { formState, actions } = useCodexCreateForm({
    novels,
    series,
    onCreated,
    onClose,
  });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      data-testid="codex-create-modal"
    >
      <div className="border-ink-200 bg-ink-50 text-ink-900 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border p-6 shadow-xl">
        <ModalHeader onClose={onClose} />

        {formState.error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {formState.error}
          </div>
        )}

        <form onSubmit={actions.handleSubmit} className="space-y-4">
          <div>
            <label className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
              Name *
            </label>
            <input
              type="text"
              required
              value={formState.name}
              onChange={(e) => actions.setName(e.target.value)}
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
                value={formState.type}
                onChange={(e) => actions.setType(e.target.value as CodexType)}
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
                value={formState.trackingMode}
                onChange={(e) => actions.setTrackingMode(e.target.value as CodexTrackingMode)}
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

          <ScopeSelector
            seriesScoped={formState.seriesScoped}
            onScopeChange={actions.setSeriesScoped}
          />

          <TargetSelector
            seriesScoped={formState.seriesScoped}
            series={series}
            novels={novels}
            selectedSeriesId={formState.selectedSeriesId}
            selectedNovelId={formState.selectedNovelId}
            onSeriesChange={actions.setSelectedSeriesId}
            onNovelChange={actions.setSelectedNovelId}
          />

          <ColorPresetPicker
            currentColor={formState.color}
            onSelectColor={actions.setColor}
          />

          <div>
            <label className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
              Aliases (comma separated)
            </label>
            <input
              type="text"
              value={formState.aliasesText}
              onChange={(e) => actions.setAliasesText(e.target.value)}
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
              value={formState.description}
              onChange={(e) => actions.setDescription(e.target.value)}
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
              value={formState.notes}
              onChange={(e) => actions.setNotes(e.target.value)}
              placeholder="Secret backstory, plot triggers, author reminders..."
              className="border-ink-200 bg-ink-100 focus:border-ink-400 mt-1 w-full rounded-md border p-2 text-sm focus:outline-hidden"
            />
          </div>

          <ModalFooter
            onClose={onClose}
            loading={formState.loading}
          />
        </form>
      </div>
    </div>
  );
}

function ModalHeader({ onClose }: { onClose: () => void }) {
  return (
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
  );
}

function ScopeSelector({
  seriesScoped,
  onScopeChange,
}: {
  seriesScoped: boolean;
  onScopeChange: (scoped: boolean) => void;
}) {
  return (
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
            onChange={() => onScopeChange(false)}
          />
          Book-specific
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            name="scope"
            checked={seriesScoped}
            onChange={() => onScopeChange(true)}
          />
          Series-wide
        </label>
      </div>
    </div>
  );
}

function TargetSelector({
  seriesScoped,
  series,
  novels,
  selectedSeriesId,
  selectedNovelId,
  onSeriesChange,
  onNovelChange,
}: {
  seriesScoped: boolean;
  series: Array<{ id: string; title: string }>;
  novels: Array<{ id: string; title: string; seriesId: string | null }>;
  selectedSeriesId: string;
  selectedNovelId: string;
  onSeriesChange: (id: string) => void;
  onNovelChange: (id: string) => void;
}) {
  if (seriesScoped) {
    return (
      <div>
        <label className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
          Target Series *
        </label>
        {series.length > 0 ? (
          <select
            value={selectedSeriesId}
            onChange={(e) => onSeriesChange(e.target.value)}
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
    );
  }

  return (
    <div>
      <label className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
        Target Novel *
      </label>
      {novels.length > 0 ? (
        <select
          value={selectedNovelId}
          onChange={(e) => onNovelChange(e.target.value)}
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
  );
}

function ColorPresetPicker({
  currentColor,
  onSelectColor,
}: {
  currentColor: string;
  onSelectColor: (color: string) => void;
}) {
  return (
    <div>
      <label className="text-ink-600 block text-xs font-semibold uppercase tracking-wider">
        Color Theme
      </label>
      <div className="mt-1 flex items-center gap-2">
        {COLOR_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onSelectColor(preset)}
            className={`h-6 w-6 rounded-full transition-transform ${
              currentColor === preset
                ? "scale-110 ring-2 ring-ink-800 ring-offset-1"
                : "hover:scale-105"
            }`}
            style={{ backgroundColor: preset }}
          />
        ))}
      </div>
    </div>
  );
}

function ModalFooter({
  onClose,
  loading,
}: {
  onClose: () => void;
  loading: boolean;
}) {
  return (
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
  );
}
