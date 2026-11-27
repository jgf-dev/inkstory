"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  /** Enables the optional AI premise control (progressive enhancement). */
  premise?: PremiseContext;
}

export const PREMISE_ENDPOINT = "/api/tools/trope-premise";

export interface PremiseContext {
  /** Current genre filter, or `any`. */
  genre: string;
}

type ComboEntry = Pick<TropeResultItem, "id" | "name" | "description">;

/** What the premise panel shows: an AI blurb, or the algorithmic combo. */
export type PremiseView = { kind: "ai"; text: string } | { kind: "combo"; tropes: ComboEntry[] };

type PremiseState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; view: PremiseView };

function comboView(tropes: readonly ComboEntry[]): PremiseView {
  return {
    kind: "combo",
    tropes: tropes.map(({ id, name, description }) => ({ id, name, description })),
  };
}

/**
 * Asks the server for an AI premise. Any failure (network, bad status, bad
 * body or a server-side fallback) quietly becomes the algorithmic combo.
 */
export async function fetchPremise(
  tropes: readonly ComboEntry[],
  context: PremiseContext,
  signal?: AbortSignal,
): Promise<PremiseView> {
  try {
    const response = await fetch(PREMISE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tropes: tropes.map((trope) => trope.id), genre: context.genre }),
      signal,
    });
    if (response.ok) {
      const body = (await response.json()) as { source?: unknown; premise?: unknown };
      if (body.source === "ai" && typeof body.premise === "string" && body.premise.trim()) {
        return { kind: "ai", text: body.premise };
      }
    }
  } catch {
    // Fall through to the algorithmic combo; never surface provider errors.
  }
  return comboView(tropes);
}

function PremisePanel({ state }: Readonly<{ state: PremiseState }>) {
  if (state.status === "idle") return null;
  let content: ReactNode;
  if (state.status === "loading") {
    content = <p className="text-ink-600 text-sm">Writing a premise…</p>;
  } else if (state.view.kind === "ai") {
    content = <p className="text-ink-600 text-sm">{state.view.text}</p>;
  } else {
    content = (
      <ul className="text-ink-600 list-disc space-y-1 pl-5 text-sm">
        {state.view.tropes.map((trope) => (
          <li key={trope.id}>{formatTrope(trope)}</li>
        ))}
      </ul>
    );
  }
  return (
    <div
      className="border-ink-200 bg-card mt-4 rounded-lg border p-4"
      aria-live="polite"
      data-testid="trope-premise"
    >
      <h3 className="mb-1 text-sm font-semibold">Premise idea</h3>
      {content}
    </div>
  );
}

export function formatTrope(trope: Pick<TropeResultItem, "name" | "description">): string {
  return `${trope.name}: ${trope.description}`;
}

/**
 * Generated trope combo with lock links and copy controls. Cards, lock links
 * and "Generate more" are server-rendered and work without JavaScript;
 * copying needs it.
 */
export function TropeResults({
  tropes,
  shareHref,
  moreHref,
  premise,
}: Readonly<TropeResultsProps>) {
  const feedback = useCopyFeedback();
  const [hydrated, setHydrated] = useState(false);
  const [premiseState, setPremiseState] = useState<PremiseState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setHydrated(true);
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function writePremise(context: PremiseContext) {
    // The button is disabled while loading, so requests never overlap.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPremiseState({ status: "loading" });
    const view = await fetchPremise(tropes, context, controller.signal);
    if (controller.signal.aborted) return;
    setPremiseState({ status: "done", view });
  }

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
                  >
                    {trope.locked ? "Unlock" : "Lock"}
                  </Link>
                  <button
                    type="button"
                    className={COPY_BUTTON_CLASS}
                    aria-label={`Copy ${trope.name}`}
                    onClick={() => void feedback.copy(trope.id, formatTrope(trope))}
                  >
                    {feedback.copied === trope.id ? "Copied" : "Copy"}
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
      {hydrated && premise && tropes.length > 0 ? (
        <button
          type="button"
          className={`${COPY_BUTTON_CLASS} mt-3 disabled:cursor-not-allowed disabled:opacity-50`}
          disabled={premiseState.status === "loading"}
          title={
            premiseState.status === "loading"
              ? "Waiting for the current premise to finish"
              : "AI mode: write a short premise that combines this combo"
          }
          onClick={() => void writePremise(premise)}
        >
          Write a premise (AI)
        </button>
      ) : null}
      <PremisePanel state={premiseState} />
      <ResultActions
        allText={tropes.length > 0 ? tropes.map(formatTrope).join("\n") : null}
        shareHref={shareHref}
        moreHref={moreHref}
        moreLabel="Generate more"
        feedback={feedback}
      />
    </section>
  );
}
