/**
 * Shared WCAG AA focus-ring and touch-target class strings (JGF-115).
 * Kept as full Tailwind literals so content scanning still emits the utilities.
 */
export const a11yClasses = {
  /** Codex create-modal text inputs and selects (focus border ink-600). */
  codexCreateField:
    "border-ink-200 bg-ink-100 focus:border-ink-600 mt-1 w-full rounded-md border p-2 text-sm focus:outline-hidden",

  /** Codex editor text inputs and selects (focus border ink-600). */
  codexEditorField:
    "mt-1 w-full rounded-md border border-ink-200 bg-ink-100 p-2 text-sm focus:border-ink-600 focus:outline-hidden",

  /** Compact custom-field inputs in the editor (width added at call site). */
  codexCompactField:
    "rounded border border-ink-200 bg-ink-100 px-2 py-1 text-xs focus:border-ink-600 focus:outline-hidden",

  /** Codex manager search input. */
  codexSearch:
    "w-full rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:border-ink-600 focus:outline-hidden",

  /** Login / signup email and password inputs. */
  authField:
    "border-ink-300 mt-1 block w-full rounded-md border px-3 py-2 text-sm focus:border-ink-600",

  /** 36px min touch target for chip remove (alias / tag) buttons. */
  iconRemoveButton:
    "ml-1 flex min-h-9 min-w-9 items-center justify-center text-ink-500 hover:text-ink-700",

  /** 36px min touch target for dialog close. */
  dialogCloseButton:
    "text-ink-600 hover:text-ink-800 flex min-h-9 min-w-9 items-center justify-center text-sm",

  /** Color preset swatch base (36px). */
  colorSwatchBase: "h-9 w-9 rounded-full transition-transform",
  colorSwatchSelected: "scale-110 ring-2 ring-ink-800 ring-offset-1",
  colorSwatchIdle: "hover:scale-105",
} as const;
