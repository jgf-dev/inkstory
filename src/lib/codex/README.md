# Story Codex (`src/lib/codex`)

## Purpose

Domain service, pure context-assembly engines, token budgeting, prompt formatting, and third-party interchange for InkStory's AI-aware story bible.

## Modules

| Module                                                                                         | Role                                                                                                                                    |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `service.ts`                                                                                   | Tenant-isolated CRUD, batched scene reading-order loader, mention scans, `resolveCodexEntryAtScene`, and `assembleCodexContextForScene` |
| `actions.ts`                                                                                   | Authenticated Server Actions returning discriminated `ActionResult<T>` payloads                                                         |
| `types.ts`                                                                                     | Input types and enums (`CodexType`, `CodexTrackingMode`, `ProgressionMode`)                                                             |
| `errors.ts`                                                                                    | `CodexError` and `handleCodexApiError` REST error mapping                                                                               |
| `mention-detection.ts`                                                                         | Pure `detectMentionsInText` scanner                                                                                                     |
| `progression-engine.ts`                                                                        | Pure `ProgressionEngine` for scene-ordered temporal state evolution                                                                     |
| `relation-engine.ts` / `relation-predicates.ts`                                                | Pure `RelationEngine` BFS graph expansion and edge helpers                                                                              |
| `context-assembler.ts`                                                                         | Pure `assembleContext` seeding, relation expansion, ranking, and progression application                                                |
| `context-inspection.ts` / `context-request.ts`                                                 | Request parsing and post-budget inspection telemetry                                                                                    |
| `token-budgeter.ts` / `tokens.ts`                                                              | Pure `applyTokenBudget` truncation/dropping and token estimation                                                                        |
| `prompt-formatter.ts`                                                                          | Deterministic `<codex_context><story_bible>` XML serialization                                                                          |
| `budget-segments.ts`                                                                           | Stacked bar segment math for `TokenBudgetBar`                                                                                           |
| `interchange/{types,matrix,lorebook,character-card,png,validate,http,service,card-service}.ts` | SillyTavern Lorebook and Character Card v2 (JSON/YAML/PNG) matrix, validation, codecs, and persistence                                  |

## Public Contracts & Invariants

- **Scoping & Isolation**: Book-scoped entries inherit `novel.seriesId` and isolate to a single novel; series-scoped entries set `novelId: null` and are shared across novels in the series. All reads/writes check `ownerId` and `deletedAt === null`.
- **Soft Deletes**: Deleting an entry cascades `deletedAt` across aliases, tags, relations, and progressions (`?hard=true` hard-deletes).
- **DB-Agnostic Engines**:
  - `detectMentionsInText`: case-insensitive, word-boundary matching where longer matches win.
  - `ProgressionEngine`: evaluates progressions up to the current scene in `Act.position → Chapter.position → Scene.position` reading order (`ADDITION` appends; `REPLACEMENT` replaces).
  - `RelationEngine`: BFS graph expansion with cycle detection, depth cap (default `2`), and deduplication.
  - `assembleContext`: seeds from `manual` attachments → `ALWAYS` entries → detected `mention`s, expands relations, ranks/truncates (default `40` entries), and applies progressions.
  - `applyTokenBudget`: enforces hard token budgets (default `DEFAULT_MAX_TOKENS = 4000`), preserving rank order and subadditivity over `formatAssembledContext` output.
- **Batched Reading Order**: `loadNovelSceneReadingOrder` batches Act, Chapter, and Scene queries with `in` filters (at most 3 queries; no N+1 roundtrips).
- **Interchange Envelope**: Third-party metadata is stored under `CodexEntry.customFields._inkstoryInterchange` (`schemaVersion: 1`). Never strip or overwrite `_inkstoryInterchange` outside `interchange/validate.ts`. Unsupported Lorebook activation features import as `NEVER`.
- **Error Contract**: `CodexError` codes (`NOT_FOUND`, `FORBIDDEN`, `VALIDATION_FAILED`, `SCOPING_ERROR`, `CONFLICT`, `QUOTA_EXCEEDED` HTTP 402) and `handleCodexApiError` (`INVALID_JSON` 400 on `SyntaxError`, `CONTEXT_ASSEMBLY_FAILED` 422 on `ContextAssemblyError`).

## API Routes

- `/api/codex/entries`, `/api/codex/entries/[id]`
- `/api/codex/entries/[id]/aliases`, `/api/codex/aliases/[id]`
- `/api/codex/entries/[id]/tags`, `/api/codex/tags/[id]`
- `/api/codex/relations`, `/api/codex/relations/[id]`
- `/api/codex/progressions`, `/api/codex/progressions/[id]`
- `/api/codex/mentions`, `/api/context/assemble`
- `/api/codex/interchange/matrix`, `/api/codex/interchange/lorebook/{preview,import,export}`, `/api/codex/interchange/card/{preview,import,export}`

## Verification

- **Unit (`bun run test:no-db`)**: `tests/mention-detection.test.ts`, `tests/progression-engine.test.ts`, `tests/relation-engine.test.ts`, `tests/relation-predicates.test.ts`, `tests/context-assembler.test.ts`, `tests/context-inspection.test.ts`, `tests/context-request.test.ts`, `tests/token-budgeter.test.ts`, `tests/tokens.test.ts`, `tests/prompt-formatter.test.ts`, `tests/budget-segments.test.ts`, `tests/codex-actions.test.ts`, `tests/codex-api.test.ts`, `tests/codex-interchange-{lorebook,card,matrix,png,api,card-api,matrix-api}.test.ts`.
- **DB Integration (`bun run test`)**: `tests/codex-service.test.ts`, `tests/codex-interchange-{service,card-service,coordination}.test.ts`.
