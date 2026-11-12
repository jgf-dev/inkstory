# Context Inspector (STO-1264)

The writing workspace header opens a read-only Context Inspector in every mode.
It sends live (including unsaved) prose plus the scene summary to the existing
`POST /api/context/assemble` endpoint. It does not generate text or save telemetry.

## Additive inspection response

The existing top-level `entries` and `meta` remain the assembler output for
backward compatibility. New `inspection` contains:

- `context`: post-budget entries and existing budget metadata, including dropped
  and shortened entry IDs;
- `formattedContext`: the exact XML produced by the shared Codex prompt formatter;
- `telemetry.entries`: formatted token estimates per retained entry (ID/source);
- `telemetry.bySource`: manual, always, mention, and relation totals;
- `telemetry.wrapperTokens`: fixed XML envelope overhead;
- `telemetry.totalTokens`: additive stack (per-entry estimates plus wrapper);
- `telemetry.formattedTokens`: estimate of the concatenated XML;
- `telemetry.method`: `approximate`.

Inspection uses the same `getEntitlements` / `resolveContextTokenBudget`,
`applyTokenBudget`, and formatter as Generate. Counts are computed **after** the
existing budgeter's pruning/truncation and after progression resolution. Each
entry belongs to its assembler-selected source; progression text is part of that
entry, not a second allocation. Model-independent estimates use the existing
CJK-aware approximation. Independently rounded blocks can sum slightly higher
than the estimate of the combined XML; both numbers are labeled in the drawer.

The inspection API accepts the existing explicit assembly inputs (including
`beatText`, `recentProse`, manual IDs, and assembler options). For identical inputs
and entitlements, inspection XML matches the Codex block used by Generate. The
workspace view uses the scene summary as Generate's default beat. Custom direction
entered in AI Assistant is not part of this view; this limitation is shown in the
UI. Prompt templates, scene prose, chat framing, and output tokens are outside
this **Codex-only** stack. Prompt Preview remains the full-message inspection tool.

Loading/error/empty states, refresh, source badges, relation depth, progression
counts, assembler limit notices, and budget drop/truncation notices are provided.
Live edits debounce requests; superseded/unmounted requests cannot replace the
current result. The drawer supports keyboard focus containment, Escape, backdrop
close, and focus restoration.

No tables, schema changes, new storage, allocation editing, or new per-block caps.
No changes to Generate's behavior or the context selection algorithm.
