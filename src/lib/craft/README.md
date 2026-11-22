# Craft Studio (`src/lib/craft`)

## Purpose

Code-owned fiction craft tool definitions and request preparation built atop `src/lib/prompts` contracts and the shared `executeChat` pipeline.

## Modules

| Module       | Role                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`   | Public barrel exports                                                                                                    |
| `tools.ts`   | Code-owned `CraftToolDefinition` registry (`describe`, `expand`, `rewrite`), input defaults, and rewrite preset guidance |
| `prompt.ts`  | Input validation/defaults, context-slice filtering, target-word output token calculation, and prompt rendering           |
| `service.ts` | `prepareCraftPrompt` — ownership-checked scene loading, Codex context assembly, and contract-scoped prompt rendering     |

## Public Contracts & Invariants

- **Code-Owned Registry**: `CRAFT_TOOL_IDS` registers `describe`, `expand`, and `rewrite` (validated at module load via `validatePromptContract`; no extra DB tables). Remaining v1 tools (`show_dont_tell`, `transition`, `brainstorm`) register in `tools.ts`.
- **Context Slice Policy Ceiling**: `prepareCraftPrompt` only populates context slices allowed by the tool's contract and policy (`filterBindingsBySlices`), enforces `scene.excludeFromAi` (`SCENE_EXCLUDED_FROM_AI` 403), and clamps Codex context to the user's plan token ceiling (`resolveContextTokenBudget`).
- **Non-Destructive Execution**: Craft tools never write to the manuscript automatically. Applying generated prose is an explicit client action preceded by a `MANUAL` scene revision checkpoint (`POST /api/scenes/[id]/revisions`).
- **Zero-Spend Dry Run**: `POST /api/craft/[tool]` with `dryRun: true` returns the rendered prompt, context slices, and output metadata without invoking a provider.

## API Routes

- `GET /api/craft/tools`
- `POST /api/craft/[tool]`

## Verification

- **Unit (`bun run test:no-db`)**: `tests/craft-tools.test.ts`, `tests/craft-expand.test.ts`, `tests/craft-rewrite.test.ts`, `tests/craft-api.test.ts`.
