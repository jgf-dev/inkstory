"use client";

import { COPY_BUTTON_CLASS, ResultActions } from "@/app/_components/tools/ResultActions";
import { useCopyFeedback } from "@/app/_components/tools/useCopyFeedback";

export { COPIED_FEEDBACK_MS } from "@/app/_components/tools/useCopyFeedback";

export interface NameResultsProps {
  names: readonly string[];
  /** Relative URL that reproduces this exact batch. */
  shareHref: string;
  /** Relative URL for the next batch with the same filters. */
  moreHref: string;
}

/**
 * Generated name list with copy controls. The list and the "Generate more"
 * link are server-rendered, so they work without JavaScript; copying needs it.
 */
export function NameResults({ names, shareHref, moreHref }: NameResultsProps) {
  const { copied, error, copy } = useCopyFeedback();

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
                className={COPY_BUTTON_CLASS}
                aria-label={`Copy ${name}`}
                onClick={() => void copy(name, name)}
              >
                {copied === name ? "Copied" : "Copy"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ResultActions
        allText={names.length > 0 ? names.join("\n") : null}
        shareHref={shareHref}
        moreHref={moreHref}
        moreLabel="Generate more"
        copied={copied}
        error={error}
        copy={copy}
      />
    </section>
  );
}
