"use client";

import Link from "next/link";
import { COPY_BUTTON_CLASS, ResultActions } from "@/app/_components/tools/ResultActions";
import { useCopyFeedback } from "@/app/_components/tools/useCopyFeedback";

export interface TropeResultItem {
  id: string;
  name: string;
  description: string;
  category: string;
  locked: boolean;
  /** Relative URL with this trope's lock toggled and everything else unchanged. */
  toggleHref: string;
}

export interface TropeResultsProps {
  tropes: readonly TropeResultItem[];
  /** Relative URL that reproduces this exact combo. */
  shareHref: string;
  /** Relative URL that rerolls the unlocked tropes. */
  moreHref: string;
}

export function formatTrope(trope: Pick<TropeResultItem, "name" | "description">): string {
  return `${trope.name}: ${trope.description}`;
}

/**
 * Generated trope combo with lock links and copy controls. Cards, lock links
 * and "Generate more" are server-rendered and work without JavaScript;
 * copying needs it.
 */
export function TropeResults({ tropes, shareHref, moreHref }: TropeResultsProps) {
  const { copied, error, copy } = useCopyFeedback();

  return (
    <section aria-labelledby="generated-tropes-heading" className="mt-6">
      <h2 id="generated-tropes-heading" className="mb-3 text-lg font-semibold">
        Your trope combo
      </h2>
      {tropes.length === 0 ? (
        <p className="text-ink-600">No tropes matched these filters. Try another combination.</p>
      ) : (
        <ul className="grid gap-3" data-testid="generated-tropes">
          {tropes.map((trope) => (
            <li
              key={trope.id}
              data-trope-id={trope.id}
              className="border-ink-200 bg-card rounded-lg border px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {trope.name}{" "}
                  <span className="text-ink-500 ml-1 text-xs tracking-wide uppercase">
                    {trope.category}
                  </span>
                  {trope.locked ? <span className="text-ink-700 ml-2 text-xs">Locked</span> : null}
                </p>
                <div className="flex gap-2">
                  <Link
                    href={trope.toggleHref}
                    className={COPY_BUTTON_CLASS}
                    aria-label={`${trope.locked ? "Unlock" : "Lock"} ${trope.name}`}
                    aria-pressed={trope.locked}
                  >
                    {trope.locked ? "Unlock" : "Lock"}
                  </Link>
                  <button
                    type="button"
                    className={COPY_BUTTON_CLASS}
                    aria-label={`Copy ${trope.name}`}
                    onClick={() => void copy(trope.id, formatTrope(trope))}
                  >
                    {copied === trope.id ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <p className="text-ink-600 mt-1 text-sm">{trope.description}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-ink-500 mt-3 text-sm">
        Lock the tropes you like, then generate more to reroll the rest.
      </p>
      <ResultActions
        allText={tropes.length > 0 ? tropes.map(formatTrope).join("\n") : null}
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
