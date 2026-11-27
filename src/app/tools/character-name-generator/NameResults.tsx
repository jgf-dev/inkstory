"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { templateBackstory } from "@/lib/tools/character-backstory/template";
import type { BackstoryInput } from "@/lib/tools/character-backstory/types";

export const BACKSTORY_ENDPOINT = "/api/tools/character-backstory";

export const COPIED_FEEDBACK_MS = 1500;

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
  flavor: string;
  /** Resolved gender per generated name. */
  genders: Readonly<Record<string, BackstoryInput["gender"]>>;
}

type BackstoryState =
  | { status: "idle" }
  | { status: "loading"; name: string }
  | { status: "done"; name: string; text: string };

async function fetchBackstory(input: BackstoryInput): Promise<string> {
  try {
    const response = await fetch(BACKSTORY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
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

type CopiedTarget = { kind: "item"; name: string } | { kind: "all" } | { kind: "link" };

/**
 * Generated name list with copy controls. The list and the "Generate more"
 * link are server-rendered, so they work without JavaScript; copying needs it.
 */
export function NameResults({ names, shareHref, moreHref, backstory }: Readonly<NameResultsProps>) {
  const [copied, setCopied] = useState<CopiedTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [story, setStory] = useState<BackstoryState>({ status: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setHydrated(true);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function writeBackstory(context: BackstoryContext, name: string) {
    // Backstory buttons are disabled while loading, so requests never overlap.
    setStory({ status: "loading", name });
    const text = await fetchBackstory({
      name,
      genre: context.genre,
      flavor: context.flavor,
      gender: context.genders[name] ?? "neutral",
    });
    setStory({ status: "done", name, text });
  }

  async function copy(target: CopiedTarget, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
      setCopied(target);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        setCopied(null);
      }, COPIED_FEEDBACK_MS);
    } catch {
      setCopied(null);
      setError("Copy failed. Select the text and copy it manually.");
    }
  }

  const buttonClass =
    "rounded-md border border-ink-200 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100";

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
                    className={buttonClass}
                    aria-label={`Write a backstory for ${name}`}
                    disabled={story.status === "loading"}
                    onClick={() => void writeBackstory(backstory, name)}
                  >
                    Backstory
                  </button>
                ) : null}
                <button
                  type="button"
                  className={buttonClass}
                  aria-label={`Copy ${name}`}
                  onClick={() => void copy({ kind: "item", name }, name)}
                >
                  {copied?.kind === "item" && copied.name === name ? "Copied" : "Copy"}
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
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          href={moreHref}
          className="bg-ink-900 text-ink-50 rounded-md px-4 py-2 text-sm font-medium"
          data-testid="generate-more"
        >
          Generate more
        </Link>
        {names.length > 0 ? (
          <button
            type="button"
            className={buttonClass}
            onClick={() => void copy({ kind: "all" }, names.join("\n"))}
          >
            {copied?.kind === "all" ? "Copied all" : "Copy all"}
          </button>
        ) : null}
        <button
          type="button"
          className={buttonClass}
          onClick={() =>
            void copy({ kind: "link" }, new URL(shareHref, window.location.origin).toString())
          }
        >
          {copied?.kind === "link" ? "Link copied" : "Copy share link"}
        </button>
      </div>
      <p role="status" aria-live="polite" className="text-ink-500 mt-2 min-h-5 text-sm">
        {error ?? (copied ? "Copied to clipboard." : "")}
      </p>
    </section>
  );
}
