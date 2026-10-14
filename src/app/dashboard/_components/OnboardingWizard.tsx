"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createNovelAction, seedStarterBibleAction } from "@/lib/library/actions";

interface OnboardingWizardProps {
  /** Rendered only when the author has no novels yet. */
  hasNovels: boolean;
  series: Array<{ id: string; title: string }>;
}

const DISMISS_KEY = "inkstory.onboarding.dismissed.v1";

/**
 * First-time author onboarding: a 3-step modal shown on initial login until
 * the author creates (or seeds) their first novel, or dismisses it. The
 * dismissal flag persists in localStorage; step 2's creations refresh the
 * server data so the wizard no longer qualifies itself.
 */
export function OnboardingWizard({ hasNovels, series }: OnboardingWizardProps) {
  const router = useRouter();
  // Visible by default for novel-less authors; a persisted dismissal closes it
  // right after mount (checked in an effect so SSR markup is stable).
  const [open, setOpen] = useState(!hasNovels);
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdNovelId, setCreatedNovelId] = useState<string | null>(null);

  useEffect(() => {
    if (hasNovels) {
      return;
    }
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      // storage unavailable (private mode) — show anyway
    }
    if (dismissed) {
      setOpen(false);
    }
  }, [hasNovels]);

  function dismiss() {
    setOpen(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  }

  if (!open) {
    return null;
  }

  async function handleSeed() {
    setBusy(true);
    setError(null);
    try {
      const res = await seedStarterBibleAction();
      if (!res.success) {
        setError(res.error || "Failed to seed the sample bible.");
        setBusy(false);
        return;
      }
      const novelId = (res.data as { novelId?: string | null }).novelId ?? null;
      setCreatedNovelId(novelId);
      setStep(3);
      setBusy(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setBusy(false);
    }
  }

  async function handleCreateNovel(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = title.trim();
    if (!trimmed) {
      setError("Please give your novel a title.");
      return;
    }

    setBusy(true);
    try {
      const res = await createNovelAction({
        title: trimmed,
        seriesId: selectedSeriesId || null,
      });
      if (!res.success) {
        setError(res.error || "Failed to create novel.");
        setBusy(false);
        return;
      }
      const novelId = (res.data as { id?: string | null }).id ?? null;
      setCreatedNovelId(novelId);
      setStep(3);
      setBusy(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      data-testid="onboarding-wizard"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-ink-200 bg-ink-50 p-6 text-ink-900 shadow-xl">
        {/* Progress dots */}
        <div className="mb-4 flex items-center gap-1.5">
          {[1, 2, 3].map((s) => (
            <span
              key={s}
              aria-hidden
              className={`h-1.5 w-8 rounded-full ${s <= step ? "bg-ink-800" : "bg-ink-200"}`}
            />
          ))}
          <span className="text-ink-400 ml-2 text-xs">Step {step} of 3</span>
        </div>

        {step === 1 && (
          <div>
            <h2 className="text-xl font-semibold">Welcome to InkStory</h2>
            <p className="text-ink-500 mt-2 text-sm">
              InkStory keeps your characters, places, and lore in an AI-aware story bible — and
              feeds exactly the right slice to the AI while you write, so continuations stay
              consistent.
            </p>
            <ul className="text-ink-600 mt-4 space-y-1.5 text-sm">
              <li>📖 A Codex of entries with aliases and tags</li>
              <li>🕸️ Relations that expand context across your cast</li>
              <li>⏳ Progressions that evolve entries scene by scene</li>
            </ul>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={dismiss}
                className="text-ink-500 text-sm hover:text-ink-700"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-md bg-ink-800 px-4 py-2 text-sm font-medium text-ink-50 hover:bg-ink-900"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-xl font-semibold">Start your first book</h2>
            <p className="text-ink-500 mt-2 text-sm">
              Create a novel, or explore with a sample fantasy bible you can edit or delete.
            </p>

            {error && (
              <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleCreateNovel} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-600">
                  Novel title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. The Glass Weaver"
                  className="mt-1 w-full rounded-md border border-ink-200 bg-ink-100 p-2 text-sm focus:border-ink-400 focus:outline-hidden"
                  autoFocus
                />
              </div>
              {series.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-ink-600">
                    Series
                  </label>
                  <select
                    value={selectedSeriesId}
                    onChange={(e) => setSelectedSeriesId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-ink-200 bg-ink-100 p-2 text-sm focus:border-ink-400 focus:outline-hidden"
                  >
                    <option value="">Standalone (no series)</option>
                    {series.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="text-ink-500 text-sm hover:text-ink-700"
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-ink-800 px-4 py-2 text-sm font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-50"
                >
                  {busy ? "Creating..." : "Create novel"}
                </button>
              </div>
            </form>

            <div className="mt-4 border-t border-ink-200 pt-4">
              <button
                type="button"
                onClick={handleSeed}
                disabled={busy}
                className="w-full rounded-md border border-ink-300 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-50"
              >
                {busy ? "Seeding..." : "🌱 Seed a sample fantasy bible instead"}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-xl font-semibold">Meet your writing desk</h2>
            <p className="text-ink-500 mt-2 text-sm">
              Your novel{"’"}s outliner and scene editor live in the writing desk. The Story Codex
              holds your characters, places, and lore — relations link them, progressions evolve
              them, and the AI draws on exactly what each scene needs.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {createdNovelId ? (
                <Link
                  href={`/dashboard/novels/${createdNovelId}`}
                  className="rounded-md bg-ink-800 px-4 py-2 text-center text-sm font-medium text-ink-50 hover:bg-ink-900"
                >
                  Open the writing desk →
                </Link>
              ) : null}
              <Link
                href="/dashboard/codex"
                className="rounded-md border border-ink-300 px-4 py-2 text-center text-sm font-medium text-ink-700 hover:bg-ink-100"
              >
                Open the Story Codex →
              </Link>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={dismiss}
                className="text-ink-500 text-sm hover:text-ink-700"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
