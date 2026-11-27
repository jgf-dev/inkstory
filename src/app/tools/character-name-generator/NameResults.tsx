"use client";

import { useEffect, useRef, useState } from "react";
import { COPY_BUTTON_CLASS, ResultActions } from "@/app/_components/tools/ResultActions";
import { useCopyFeedback } from "@/app/_components/tools/useCopyFeedback";
import { templateBackstory } from "@/lib/tools/character-backstory/template";
import type { BackstoryInput } from "@/lib/tools/character-backstory/types";

export const BACKSTORY_ENDPOINT = "/api/tools/character-backstory";

export { COPIED_FEEDBACK_MS } from "@/app/_components/tools/useCopyFeedback";

export interface NameResultsProps {
  names: readonly string[];
  /** Relative URL that reproduces this exact batch. */
  shareHref: string;
  /** Relative URL for the next batch with the same filters. */
  moreHref: string;
  /** Enables the optional AI backstory controls (progressive enhancement). */
  backstory?: BackstoryContext;
}

export interface BackstoryContext {
  genre: BackstoryInput["genre"];
  flavor: BackstoryInput["flavor"];
  /** Resolved gender per generated name. */
  genders: Readonly<Record<string, BackstoryInput["gender"]>>;
}

type BackstoryState =
  | { status: "idle" }
  | { status: "loading"; name: string }
  | { status: "done"; name: string; text: string };

async function fetchBackstory(input: BackstoryInput, signal?: AbortSignal): Promise<string> {
  try {
    const response = await fetch(BACKSTORY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
    if (response.ok) {
      const body = (await response.json()) as { backstory?: unknown };
      if (typeof body.backstory === "string" && body.backstory.trim()) return body.backstory;
    }
  } catch {
    // Fall through to the algorithmic backstory; never surface provider errors.
  }
  return templateBackstory(input);
}

/**
 * Generated name list with copy controls. The list and the "Generate more"
 * link are server-rendered, so they work without JavaScript; copying needs it.
 */
export function NameResults({ names, shareHref, moreHref, backstory }: Readonly<NameResultsProps>) {
  const feedback = useCopyFeedback();
  const [hydrated, setHydrated] = useState(false);
  const [story, setStory] = useState<BackstoryState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setHydrated(true);
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function writeBackstory(context: BackstoryContext, name: string) {
    // Backstory buttons are disabled while loading, so requests never overlap.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStory({ status: "loading", name });
    const text = await fetchBackstory(
      {
        name,
        genre: context.genre,
        flavor: context.flavor,
        gender: context.genders[name] ?? "neutral",
      },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    setStory({ status: "done", name, text });
  }

  return (
    <section aria-labelledby="generated-names-heading" className="mt-6">
      <h2 id="generated-names-heading" className="mb-3 text-lg font-semibold">
        Generated names
      </h2>
      {names.length === 0 ? (
        <p className="text-ink-600">No names matched these filters. Try another combination.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="generated-names">
          {names.map((name) => (
            <li
              key={name}
              className="border-ink-200 bg-card flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <span className="font-medium">{name}</span>
              <span className="flex gap-1">
                {hydrated && backstory ? (
                  <button
                    type="button"
                    className={`${COPY_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                    aria-label={`Write a backstory for ${name}`}
                    disabled={story.status === "loading"}
                    title={
                      story.status === "loading"
                        ? "Waiting for the current backstory to finish"
                        : undefined
                    }
                    onClick={() => void writeBackstory(backstory, name)}
                  >
                    Backstory
                  </button>
                ) : null}
                <button
                  type="button"
                  className={COPY_BUTTON_CLASS}
                  aria-label={`Copy ${name}`}
                  onClick={() => void feedback.copy(`item:${name}`, name)}
                >
                  {feedback.copied === `item:${name}` ? "Copied" : "Copy"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {story.status === "idle" ? null : (
        <div
          className="border-ink-200 bg-card mt-4 rounded-lg border p-4"
          aria-live="polite"
          data-testid="name-backstory"
        >
          <h3 className="mb-1 text-sm font-semibold">Backstory: {story.name}</h3>
          <p className="text-ink-600 text-sm">
            {story.status === "loading" ? "Writing a backstory…" : story.text}
          </p>
        </div>
      )}
      <ResultActions
        allText={names.length > 0 ? names.join("\n") : null}
        shareHref={shareHref}
        moreHref={moreHref}
        moreLabel="Generate more"
        feedback={feedback}
      />
    </section>
  );
}
