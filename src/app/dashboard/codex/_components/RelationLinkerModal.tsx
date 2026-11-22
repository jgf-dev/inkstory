"use client";

import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createCodexRelationAction } from "@/lib/codex/actions";
import {
  RELATION_PREDICATES,
  resolveRelationTypes,
  validateRelationDraft,
  type RelationPredicateId,
} from "@/lib/codex/relation-predicates";
import { Modal, modalInputClasses, modalLabelClasses } from "./Modal";

/** Directional relation chip data (existing relations of the source entry). */
export interface RelationChipData {
  id: string;
  /** Name of the entry at the other end of the edge. */
  otherName: string;
  relationType: string;
  reverseType: string | null;
  /** "outgoing": source → other. "incoming": other → source. */
  direction: "outgoing" | "incoming";
}

export interface RelationLinkerModalProps {
  isOpen: boolean;
  /** Read-only entity the relation starts from (Codex entry or @mention). */
  sourceEntry: { id: string; name: string };
  /** Candidate target entities for the combobox. */
  entries: Array<{ id: string; name: string; type: string }>;
  /** Existing relations rendered as directional chips. */
  existingRelations?: RelationChipData[];
  onClose: () => void;
  /** Called after a successful link so parents can refresh. */
  onSaved?: () => void;
}

/**
 * Relation Linker (JGF-128, design rev 4 §1.1 item 2): link a Codex entry to
 * another entity with a spec predicate (or custom label) and an optional
 * bidirectional symmetry toggle. Existing relations render as directional
 * chips (`A ──[rivals]──▶ B`).
 */
export function RelationLinkerModal({
  isOpen,
  sourceEntry,
  entries,
  existingRelations = [],
  onClose,
  onSaved,
}: Readonly<RelationLinkerModalProps>) {
  const fieldId = useId();
  const [predicateId, setPredicateId] = useState<RelationPredicateId>("allies_with");
  const [customLabel, setCustomLabel] = useState("");
  const [bidirectional, setBidirectional] = useState(true);
  const [targetEntryId, setTargetEntryId] = useState("");
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const candidates = useMemo(
    () => entries.filter((e) => e.id !== sourceEntry.id),
    [entries, sourceEntry.id],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (e) => e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q),
    );
  }, [candidates, query]);

  const listboxId = `${fieldId}-target-listbox`;

  if (!isOpen) return null;

  function pick(entryId: string) {
    setTargetEntryId(entryId);
    const entry = candidates.find((e) => e.id === entryId);
    setQuery(entry?.name ?? "");
    setListOpen(false);
    setHighlighted(0);
  }

  function onTargetKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setListOpen(true);
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && listOpen && filtered[highlighted]) {
      e.preventDefault();
      pick(filtered[highlighted].id);
    } else if (e.key === "Escape") {
      setListOpen(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const validationError = validateRelationDraft({
      predicateId,
      customLabel,
      targetEntryId,
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    const { relationType, reverseType } = resolveRelationTypes(predicateId, {
      bidirectional,
      customLabel,
    });

    setSaving(true);
    try {
      const res = await createCodexRelationAction({
        sourceEntryId: sourceEntry.id,
        targetEntryId,
        relationType,
        reverseType,
      });
      if (!res.success) {
        setError(res.error || "Failed to create relation.");
        setSaving(false);
        return;
      }
      setSaving(false);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setSaving(false);
    }
  }

  return (
    <Modal title="Link Relation" onClose={onClose} testId="relation-linker-modal">
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {existingRelations.length > 0 && (
        <div className="mb-4">
          <h3 className={modalLabelClasses}>Existing relations</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="relation-chips">
            {existingRelations.map((chip) => (
              <li
                key={chip.id}
                className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-elevated px-2.5 py-1 text-xs text-secondary"
              >
                {chip.direction === "outgoing" ? (
                  <>
                    <span className="font-semibold text-primary">{sourceEntry.name}</span>
                    <span className="rounded bg-ink-200 px-1.5 py-0.5 font-medium text-ink-700">
                      ──[{chip.relationType}]──▶
                    </span>
                    <span>{chip.otherName}</span>
                  </>
                ) : (
                  <>
                    <span>{chip.otherName}</span>
                    <span className="rounded bg-ink-200 px-1.5 py-0.5 font-medium text-ink-700">
                      ──[{chip.reverseType ?? chip.relationType}]──▶
                    </span>
                    <span className="font-semibold text-primary">{sourceEntry.name}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <span className={modalLabelClasses} id={`${fieldId}-source-label`}>
            Entity Source
          </span>
          <p
            aria-labelledby={`${fieldId}-source-label`}
            data-testid="relation-source"
            className="mt-1 w-full rounded-md border border-ink-200 bg-elevated p-2 text-sm font-medium text-secondary"
          >
            {sourceEntry.name}
          </p>
        </div>

        <div>
          <label className={modalLabelClasses} htmlFor={`${fieldId}-predicate`}>
            Predicate *
          </label>
          <select
            id={`${fieldId}-predicate`}
            value={predicateId}
            onChange={(e) => setPredicateId(e.target.value as RelationPredicateId)}
            className={modalInputClasses}
            data-testid="relation-predicate"
          >
            {RELATION_PREDICATES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {predicateId === "custom" && (
          <div>
            <label className={modalLabelClasses} htmlFor={`${fieldId}-custom-label`}>
              Custom relation label *
            </label>
            <input
              id={`${fieldId}-custom-label`}
              type="text"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="e.g. bound_by_oath_to"
              className={modalInputClasses}
            />
          </div>
        )}

        <div className="relative">
          <label className={modalLabelClasses} htmlFor={`${fieldId}-target`}>
            Target Entity *
          </label>
          <input
            ref={inputRef}
            id={`${fieldId}-target`}
            type="text"
            role="combobox"
            aria-expanded={listOpen}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              listOpen && filtered[highlighted]
                ? `${fieldId}-option-${filtered[highlighted].id}`
                : undefined
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setTargetEntryId("");
              setListOpen(true);
              setHighlighted(0);
            }}
            onFocus={() => setListOpen(true)}
            onKeyDown={onTargetKeyDown}
            placeholder="Search entries…"
            className={modalInputClasses}
            data-testid="relation-target"
          />
          {listOpen && (
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Target entity options"
              className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-ink-200 bg-card shadow-lg"
            >
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-xs text-muted">No entries match “{query}”.</li>
              )}
              {filtered.map((entry, index) => (
                <li
                  key={entry.id}
                  id={`${fieldId}-option-${entry.id}`}
                  role="option"
                  aria-selected={entry.id === targetEntryId}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(entry.id);
                  }}
                  onMouseEnter={() => setHighlighted(index)}
                  className={`cursor-pointer px-3 py-2 text-sm ${
                    index === highlighted ? "bg-ink-100 text-primary" : "text-secondary"
                  }`}
                >
                  {entry.name}
                  <span className="ml-2 text-[11px] uppercase tracking-wide text-muted">
                    {entry.type}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={bidirectional}
            onChange={(e) => setBidirectional(e.target.checked)}
            className="h-4 w-4 rounded border-ink-300"
            data-testid="relation-bidirectional"
          />
          <span className="text-xs text-secondary">
            Bidirectional — the relation reads both ways
            {predicateId === "parent_of" && bidirectional ? " (reverse: child_of)" : ""}
          </span>
        </label>

        <div className="flex items-center justify-end gap-2 border-t border-ink-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-md border border-ink-200 px-4 text-sm font-medium text-secondary hover:bg-ink-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || candidates.length === 0}
            className="min-h-11 rounded-md bg-ink-800 px-4 text-sm font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-50"
          >
            {saving ? "Linking…" : "Link Relation"}
          </button>
        </div>
        {candidates.length === 0 && (
          <p className="text-xs text-amber-700">
            No other entries yet. Create another Codex entry to link {sourceEntry.name} to.
          </p>
        )}
      </form>
    </Modal>
  );
}
