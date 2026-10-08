"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createNovelAction, createSeriesAction } from "@/lib/library/actions";

interface LibraryCreatorProps {
  series: Array<{ id: string; title: string }>;
}

const inputClasses =
  "mt-1 w-full rounded-md border border-ink-200 bg-ink-100 p-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-ink-400 focus:outline-hidden";
const labelClasses = "block text-xs font-semibold uppercase tracking-wider text-ink-600";

/** Dashboard "+ New Novel" / "+ New Series" controls with creation modals. */
export function LibraryCreator({ series }: LibraryCreatorProps) {
  const router = useRouter();
  const [novelOpen, setNovelOpen] = useState(false);
  const [seriesOpen, setSeriesOpen] = useState(false);

  return (
    <div className="flex items-center gap-2" data-testid="library-creator">
      <button
        type="button"
        onClick={() => setNovelOpen(true)}
        className="rounded-lg bg-ink-800 px-3 py-2 text-sm font-medium text-ink-50 shadow-xs hover:bg-ink-900"
      >
        + New Novel
      </button>
      <button
        type="button"
        onClick={() => setSeriesOpen(true)}
        className="rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100"
      >
        + New Series
      </button>

      {novelOpen && (
        <NovelModal
          series={series}
          onClose={() => setNovelOpen(false)}
          onCreated={() => {
            setNovelOpen(false);
            router.refresh();
          }}
        />
      )}
      {seriesOpen && (
        <SeriesModal
          onClose={() => setSeriesOpen(false)}
          onCreated={() => {
            setSeriesOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

interface NovelModalProps {
  series: Array<{ id: string; title: string }>;
  onClose: () => void;
  onCreated: () => void;
}

function NovelModal({ series, onClose, onCreated }: NovelModalProps) {
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = title.trim();
    if (!trimmed) {
      setError("Please provide a novel title.");
      return;
    }

    setLoading(true);
    try {
      const res = await createNovelAction({
        title: trimmed,
        subtitle: subtitle.trim() || null,
        description: description.trim() || null,
        seriesId: selectedSeriesId || null,
      });

      if (!res.success) {
        setError(res.error || "Failed to create novel.");
        setLoading(false);
        return;
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      data-testid="novel-create-modal"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-ink-200 bg-ink-50 p-6 text-ink-900 shadow-xl">
        <div className="mb-4 flex items-center justify-between border-b border-ink-200 pb-3">
          <h2 className="text-xl font-semibold">New Novel</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-400 hover:text-ink-700"
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
            <label className={labelClasses}>Title *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. The Glass Weaver"
              className={inputClasses}
              autoFocus
            />
          </div>

          <div>
            <label className={labelClasses}>Subtitle</label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="e.g. Book One of the Ashfall Cycle"
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>Series</label>
            <select
              value={selectedSeriesId}
              onChange={(e) => setSelectedSeriesId(e.target.value)}
              className={inputClasses}
            >
              <option value="">Standalone (no series)</option>
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClasses}>Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Premise, genre notes, working blurb..."
              className={inputClasses}
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-ink-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-ink-800 px-4 py-2 text-sm font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Novel"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface SeriesModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function SeriesModal({ onClose, onCreated }: SeriesModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = title.trim();
    if (!trimmed) {
      setError("Please provide a series title.");
      return;
    }

    setLoading(true);
    try {
      const res = await createSeriesAction({
        title: trimmed,
        description: description.trim() || null,
      });

      if (!res.success) {
        setError(res.error || "Failed to create series.");
        setLoading(false);
        return;
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      data-testid="series-create-modal"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-ink-200 bg-ink-50 p-6 text-ink-900 shadow-xl">
        <div className="mb-4 flex items-center justify-between border-b border-ink-200 pb-3">
          <h2 className="text-xl font-semibold">New Series</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-400 hover:text-ink-700"
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
            <label className={labelClasses}>Title *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. The Ashfall Cycle"
              className={inputClasses}
              autoFocus
            />
          </div>

          <div>
            <label className={labelClasses}>Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What ties these books together?"
              className={inputClasses}
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-ink-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-ink-800 px-4 py-2 text-sm font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Series"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
