# Craft Studio (`src/lib/craft`)

## Purpose

Code-owned fiction craft tool definitions and request preparation built atop `src/lib/prompts` contracts and the shared `executeChat` pipeline.

## Modules

| Module       | Role                                                                                                                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`   | Public barrel exports                                                                                                                                                                                                                        |
| `tools.ts`   | Code-owned `CraftToolDefinition` registry (`describe`, `expand`, `rewrite`, `show_dont_tell`, `transition`), input defaults, and rewrite guidance                                                                                            |
| `prompt.ts`  | Input validation/defaults, context-slice filtering, target-word output token calculation, and prompt rendering                                                                                                                               |
| `service.ts` | `prepareCraftPrompt` — ownership-checked scene loading, Codex context assembly, and contract-scoped prompt rendering                                                                                                                         |
| `output.ts`  | Output shaping (`shapeCraftResult`), `DIAGNOSIS` / `REWRITE` marker parsing (`parseDiagnosisAndProse`), and length caps                                                                                                                      |
| `client.ts`  | Client-side contract form validation, adaptive target-word calculation for Expand, Show Don't Tell and Rewrite (preset-aware: `more_concise` aims at 0.6× the selection) (`suggestedTargetWords`, `withAdaptiveTarget`), and request helpers |

## Public Contracts & Invariants

- **Code-Owned Registry**: `CRAFT_TOOL_IDS` registers `describe`, `expand`, `rewrite`, `show_dont_tell`, and `transition` (validated at module load via `validatePromptContract`; no extra DB tables). Remaining v1 tool (`brainstorm`) registers in `tools.ts`.
- **Context Slice Policy Ceiling**: `prepareCraftPrompt` only populates context slices allowed by the tool's contract and policy (`filterBindingsBySlices`), enforces `scene.excludeFromAi` (`SCENE_EXCLUDED_FROM_AI` 403), and clamps Codex context to the user's plan token ceiling (`resolveContextTokenBudget`).
- **Non-Destructive Execution**: Craft tools never write to the manuscript automatically. Applying generated prose via `CraftPanel` is an explicit client action preceded by flushing pending saves, taking a `MANUAL` scene revision checkpoint (`POST /api/scenes/[id]/revisions`), and verifying the selected passage has not changed.
- **Zero-Spend Dry Run**: `POST /api/craft/[tool]` with `dryRun: true` returns the rendered prompt, context slices, and output metadata without invoking a provider.

## API Routes

- `GET /api/craft/tools`
- `POST /api/craft/[tool]`

## Verification

- **Unit (`bun run test:no-db`)**: `tests/craft-tools.test.ts`, `tests/craft-expand.test.ts`, `tests/craft-expand-target.test.ts`, `tests/craft-rewrite.test.ts`, `tests/craft-rewrite-target.test.ts`, `tests/craft-show-dont-tell.test.ts`, `tests/craft-show-dont-tell-target.test.ts`, `tests/craft-transition.test.ts`, `tests/craft-client.test.ts`, `tests/craft-api.test.ts`, `tests/craft-panel-dom.test.tsx`, `tests/scene-editor-craft-dom.test.tsx`, `tests/rich-text-editor-selection-dom.test.tsx`, `tests/use-craft-run.test.tsx`.
