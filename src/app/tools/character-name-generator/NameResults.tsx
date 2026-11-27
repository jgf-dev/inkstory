"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export const COPIED_FEEDBACK_MS = 1500;

export interface NameResultsProps {
  names: readonly string[];
  /** Relative URL that reproduces this exact batch. */
  shareHref: string;
  /** Relative URL for the next batch with the same filters. */
  moreHref: string;
}

type CopiedTarget = { kind: "item"; name: string } | { kind: "all" } | { kind: "link" };

/**
 * Generated name list with copy controls. The list and the "Generate more"
 * link are server-rendered, so they work without JavaScript; copying needs it.
 */
export function NameResults({ names, shareHref, moreHref }: NameResultsProps) {
  const [copied, setCopied] = useState<CopiedTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

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
              <button
                type="button"
                className={buttonClass}
                aria-label={`Copy ${name}`}
                onClick={() => void copy({ kind: "item", name }, name)}
              >
                {copied?.kind === "item" && copied.name === name ? "Copied" : "Copy"}
              </button>
            </li>
          ))}
        </ul>
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
