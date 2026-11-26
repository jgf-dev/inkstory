"use client";

import Link from "next/link";

export const COPY_BUTTON_CLASS =
  "rounded-md border border-ink-200 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100";

export interface ResultActionsProps {
  /** Text for "Copy all"; the button is hidden when `null`. */
  allText: string | null;
  shareHref: string;
  moreHref: string;
  moreLabel: string;
  copied: string | null;
  error: string | null;
  copy: (key: string, text: string) => Promise<void>;
}

/** "Generate more" link plus copy-all / copy-link buttons and a live status line. */
export function ResultActions(props: ResultActionsProps) {
  const { allText, copied, copy } = props;
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          href={props.moreHref}
          className="bg-ink-900 rounded-md px-4 py-2 text-sm font-medium text-white"
          data-testid="generate-more"
        >
          {props.moreLabel}
        </Link>
        {allText === null ? null : (
          <button
            type="button"
            className={COPY_BUTTON_CLASS}
            onClick={() => void copy("all", allText)}
          >
            {copied === "all" ? "Copied all" : "Copy all"}
          </button>
        )}
        <button
          type="button"
          className={COPY_BUTTON_CLASS}
          onClick={() =>
            void copy("link", new URL(props.shareHref, window.location.origin).toString())
          }
        >
          {copied === "link" ? "Link copied" : "Copy share link"}
        </button>
      </div>
      <p role="status" aria-live="polite" className="text-ink-500 mt-2 min-h-5 text-sm">
        {props.error ?? (copied ? "Copied to clipboard." : "")}
      </p>
    </>
  );
}
