"use client";

import { useEffect, useRef, useState } from "react";
import type { ContextEntrySource } from "@/lib/codex/context-assembler";
import type { ContextInspection } from "@/lib/codex/context-inspection";
import { apiPost } from "./api";

export interface ContextInspectorDrawerProps {
  sceneId: string;
  recentProse: string;
  /** Scene summary, matching Generate's fallback beat when no direction is supplied. */
  beatText: string;
  onClose: () => void;
}

const SOURCES: { id: ContextEntrySource; label: string; color: string }[] = [
  { id: "manual", label: "Manual", color: "bg-budget-seed" },
  { id: "always", label: "Always", color: "bg-budget-seed" },
  { id: "mention", label: "Mention", color: "bg-budget-mentions" },
  { id: "relation", label: "Relation", color: "bg-budget-relations" },
];

/** Read-only request-time view; it never saves context or invokes generation. */
export function ContextInspectorDrawer({
  sceneId,
  recentProse,
  beatText,
  onClose,
}: Readonly<ContextInspectorDrawerProps>) {
  const [result, setResult] = useState<ContextInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setResult(null);
    setError(null);
    // Debounce live prose changes; cleanup also ignores stale request responses.
    const timer = setTimeout(() => {
      void apiPost<ContextInspection>("/api/context/assemble", {
        sceneId,
        recentProse: recentProse || undefined,
        beatText: beatText || undefined,
      }).then(
        (response) => {
          if (active) setResult(response);
        },
        (err: unknown) => {
          if (active) setError(err instanceof Error ? err.message : "Could not inspect context");
        },
      );
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [sceneId, recentProse, beatText, revision]);

  const inspection = result?.inspection;
  const telemetry = inspection?.telemetry;
  const segments = telemetry
    ? [
        ...SOURCES.map((source) => ({ ...source, tokens: telemetry.bySource[source.id] })),
        {
          id: "wrapper",
          label: "XML wrapper",
          color: "bg-budget-buffer",
          tokens: telemetry.wrapperTokens,
        },
      ]
    : [];

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      data-testid="context-inspector-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Context Inspector"
        className="flex h-full w-full max-w-lg flex-col border-l border-subtle bg-app text-primary shadow-xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
          if (event.key !== "Tab") return;
          const targets = panelRef.current?.querySelectorAll<HTMLElement>(
            "button, summary, [tabindex='0']",
          );
          if (!targets?.length) return;
          const first = targets[0];
          const last = targets[targets.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="flex items-center justify-between border-b border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold">Context Inspector</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close context inspector"
            className="min-h-11 min-w-11 rounded text-muted hover:bg-elevated"
          >
            ✕
          </button>
        </header>
        <div className="space-y-4 overflow-y-auto p-4 text-sm" tabIndex={0}>
          <p className="text-xs text-muted">
            Read-only Codex context for the current prose and scene summary. Uses Generate’s token
            budget, before prompt templates. Custom AI direction is not included here. Estimates are
            model-independent, not provider usage. Scene prose, instructions and output tokens are
            not part of this stack.
          </p>
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
            className="min-h-11 rounded border border-subtle px-3 text-xs hover:bg-elevated"
          >
            Refresh context
          </button>
          {!inspection && !error && <p role="status">Assembling context…</p>}
          {error && <p role="alert">{error}</p>}
          {inspection && telemetry && (
            <>
              <section aria-label="Token stack" className="space-y-2">
                <h3 className="font-semibold">Approximate token stack · {telemetry.totalTokens}</h3>
                <div
                  role="img"
                  aria-label={segments.map((s) => `${s.label}: ${s.tokens} tokens`).join(", ")}
                  className="flex h-3 overflow-hidden rounded bg-elevated"
                >
                  {segments
                    .filter((s) => s.tokens > 0)
                    .map((segment) => (
                      <span
                        key={segment.id}
                        className={segment.color}
                        style={{ width: `${(segment.tokens / telemetry.totalTokens) * 100}%` }}
                        title={`${segment.label}: ${segment.tokens} estimated tokens`}
                      />
                    ))}
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  {segments.map((segment) => (
                    <div key={segment.id} className="flex justify-between gap-2">
                      <dt>{segment.label}</dt>
                      <dd>{segment.tokens} tokens</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-muted">
                  Formatted XML: ~{telemetry.formattedTokens} tokens /{" "}
                  {inspection.context.meta.maxTokens} budget. Stack rounds each block separately, so
                  its sum can be slightly higher. Progressions are included in their resolved entry,
                  not counted twice.
                </p>
              </section>
              {result.meta.truncated && (
                <p role="status">
                  Assembly entry limit reached: {result.meta.finalCount} of{" "}
                  {result.meta.totalCandidates} candidates.
                </p>
              )}
              {(inspection.context.meta.droppedEntryIds.length > 0 ||
                inspection.context.meta.truncatedEntryIds.length > 0) && (
                <p role="status">
                  Token budget: {inspection.context.meta.droppedEntryIds.length} entries dropped;{" "}
                  {inspection.context.meta.truncatedEntryIds.length} descriptions shortened.
                </p>
              )}
              <section aria-label="Assembled entries" className="space-y-3">
                <h3 className="font-semibold">
                  Assembled context · {inspection.context.entries.length} entries
                </h3>
                {inspection.context.entries.length === 0 && (
                  <p className="text-muted">No Codex entries in this context.</p>
                )}
                {inspection.context.entries.map((entry, index) => (
                  <article
                    key={entry.id}
                    className="space-y-2 rounded border border-subtle bg-card p-3"
                  >
                    <h4 className="font-semibold">
                      {entry.name}{" "}
                      <span className="text-xs font-normal text-muted">{entry.type}</span>
                    </h4>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded border border-subtle px-2 py-1">
                        {SOURCES.find((s) => s.id === entry.source)?.label}
                      </span>
                      <span>~{telemetry.entries[index].tokens} tokens</span>
                      {entry.relationDepth !== undefined && (
                        <span>Depth {entry.relationDepth}</span>
                      )}
                      {entry.appliedProgressionIds.length > 0 && (
                        <span>{entry.appliedProgressionIds.length} progressions applied</span>
                      )}
                      {inspection.context.meta.truncatedEntryIds.includes(entry.id) && (
                        <span>Shortened to fit</span>
                      )}
                    </div>
                    {entry.aliases.length > 0 && (
                      <p className="text-xs text-muted">Aliases: {entry.aliases.join(", ")}</p>
                    )}
                    <p className="whitespace-pre-wrap break-words">
                      {entry.description || "No description."}
                    </p>
                  </article>
                ))}
              </section>
              <details>
                <summary className="min-h-11 cursor-pointer text-xs font-semibold">
                  Formatted Codex context
                </summary>
                <pre className="whitespace-pre-wrap break-all rounded bg-card p-3 text-xs">
                  {inspection.formattedContext}
                </pre>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
