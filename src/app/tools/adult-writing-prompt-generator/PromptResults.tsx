"use client";

import Link from "next/link";
import { COPY_BUTTON_CLASS, ResultActions } from "@/app/_components/tools/ResultActions";
import { useCopyFeedback } from "@/app/_components/tools/useCopyFeedback";

export interface PromptPartItem {
  id: string;
  /** Slot label, e.g. "Setting". */
  label: string;
  text: string;
  locked: boolean;
  /** Relative URL with this fragment's lock toggled and everything else unchanged. */
  toggleHref: string;
}

export interface PromptResultsProps {
  /** The assembled prompt. */
  prompt: string;
  parts: readonly PromptPartItem[];
  /** Relative URL that reproduces this exact prompt. */
  shareHref: string;
  /** Relative URL that rerolls the unlocked parts. */
  moreHref: string;
}

/**
 * Generated prompt with per-part lock links and copy controls. The prompt,
 * lock links and "Generate more" are server-rendered and work without
 * JavaScript; copying needs it.
 */
export function PromptResults({ prompt, parts, shareHref, moreHref }: PromptResultsProps) {
  const feedback = useCopyFeedback();
  const { copied, copy } = feedback;

  return (
    <section aria-labelledby="generated-prompt-heading" className="mt-6">
      <h2 id="generated-prompt-heading" className="mb-3 text-lg font-semibold">
        Your writing prompt
      </h2>
      <div className="border-ink-200 bg-card rounded-lg border px-4 py-3">
        <p className="text-ink-900" data-testid="generated-prompt">
          {prompt}
        </p>
        <button
          type="button"
          className={`${COPY_BUTTON_CLASS} mt-3`}
          onClick={() => void copy("prompt", prompt)}
        >
          {copied === "prompt" ? "Copied prompt" : "Copy prompt"}
        </button>
      </div>
      <ul className="mt-4 grid gap-2" data-testid="prompt-parts">
        {parts.map((part) => (
          <li
            key={part.id}
            data-fragment-id={part.id}
            className="border-ink-200 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
          >
            <p className="text-sm">
              <span className="text-ink-500 mr-2 text-xs tracking-wide uppercase">
                {part.label}
              </span>
              {part.text}
              {part.locked ? <span className="text-ink-700 ml-2 text-xs">Locked</span> : null}
            </p>
            <Link
              href={part.toggleHref}
              className={COPY_BUTTON_CLASS}
              aria-label={`${part.locked ? "Unlock" : "Lock"} ${part.label.toLowerCase()}: ${part.text}`}
            >
              {part.locked ? "Unlock" : "Lock"}
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-ink-500 mt-3 text-sm">
        Lock the parts you like, then generate more to reroll the rest.
      </p>
      <ResultActions
        allText={null}
        shareHref={shareHref}
        moreHref={moreHref}
        moreLabel="Generate more"
        feedback={feedback}
      />
    </section>
  );
}
