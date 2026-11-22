# Writing & Outline Structure (`src/lib/writing`)

## Purpose

Hierarchical novel outliner (`Act → Chapter → Scene`), advisory-locked sibling ordering, TipTap 3 rich-text/plain-text synchronization, scene revision snapshots, and local draft recovery.

## Modules

| Module                                   | Role                                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `service.ts`                             | Ownership-checked outline CRUD/reordering, `getSceneForEditor`, `updateScene`, `checkpointScene`, and `restoreSceneRevision`                   |
| `novel-lock.ts`                          | `lockNovelStructure(tx, novelId)` PostgreSQL transaction advisory lock                                                                         |
| `sibling-reorder.ts`                     | Pure `applySiblingReorder` index shifting for acts, chapters, and scenes                                                                       |
| `outline-tree.ts` / `reading-order.ts`   | Pure outline tree lookups (`isSceneUnderNode`) and `flattenScenesInReadingOrder`                                                               |
| `tiptap.ts`                              | Shared TipTap 3 extensions (`createEditorExtensions`), JSON validation (`normalizeContentDoc`), and plain-text extraction (`plainTextFromDoc`) |
| `meta.ts` / `word-count.ts` / `dates.ts` | `POV_VALUES`, `TENSE_VALUES`, `countWords`, and Temporal epoch conversion                                                                      |
| `draft.ts`                               | SSR-safe `localStorage` draft backup (`saveDraft`, `loadDraft`, `clearDraft`)                                                                  |

## Public Contracts & Invariants

- **Canonical Ordering**: `byPositionThenCreated` sorts siblings deterministically by `position`, then `createdAt` epoch ms, then `id` (shared with `src/lib/export/service.ts`).
- **Advisory Structure Lock**: Every transaction mutating Act, Chapter, or Scene positions (manual create/reorder or manuscript import) must call `await lockNovelStructure(tx, novelId)` (`pg_advisory_xact_lock(hashtext('novel-import:<novelId>'))`) as its **first statement** before reading existing positions.
- **Dual Content Model**: `Scene.content` holds the authoritative plain-text extract (used by AI prompts, word counts, mention detection, and export); `Scene.contentDoc` holds optional TipTap 3 JSON (`ContentFormat`: `PLAIN` | `TIPTAP_JSON`). Client and server share `createEditorExtensions()` (`StarterKit` headings `1–3` + `Highlight`).
- **Scene Revisions**: Snapshots stored in `SceneRevision` carry `SceneRevisionReason` (`AUTOSAVE`, `MANUAL`, `RESTORE`, `IMPORT`). Restoring a revision snapshots the live scene with reason `RESTORE` before applying the target snapshot.
- **Local Draft Recovery**: `draft.ts` writes `inkstory.scene-draft.<sceneId>` in `localStorage` on debounced save attempts and clears it once server save succeeds.

## API Routes

- `GET|POST|PATCH|DELETE /api/novels/[id]/outline`
- `GET|PATCH /api/scenes/[id]`
- `GET|POST /api/scenes/[id]/revisions`
- `POST /api/scenes/[id]/revisions/[revisionId]/restore`

## Verification

- **Unit (`bun run test:no-db`)**: `tests/writing-helpers.test.ts`, `tests/writing-tiptap.test.ts`, `tests/writing-outline-tree.test.ts`, `tests/sibling-reorder.test.ts`, `tests/writing-api.test.ts`, `tests/writing-checkpoint.test.ts`, `tests/writing-ui.test.ts`.
- **DB Integration (`bun run test`)**: `tests/writing-service.test.ts`, `tests/novel-structure-lock.test.ts`.
