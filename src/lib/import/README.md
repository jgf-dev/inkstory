# Manuscript Import (`src/lib/import`)

## Purpose

Streaming-capped `.docx`, `.md`, and `.html` manuscript parsing, structure preview/override, and transactional insertion into an owned novel's Act → Chapter → Scene tree.

## Modules

| Module                         | Role                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `index.ts`                     | Public barrel exports                                                                              |
| `types.ts`                     | `ImportFormat`, `ImportManuscript`, `ImportPreview`, and `ImportError`                             |
| `body.ts`                      | `readBodyWithLimit` streaming byte cap                                                             |
| `blocks.ts` / `parse.ts`       | Format detection (`detectFormat`), `mammoth` DOCX conversion, and Markdown/HTML block parsing      |
| `structure.ts` / `override.ts` | Heading hierarchy inference (`inferLevels`, `buildManuscript`) and manual `applyStructureOverride` |
| `preview.ts`                   | Read-only `previewManuscript` word/scene/summary rollup                                            |
| `service.ts`                   | `assertNovelOwner`, `detectedTitleUpdate`, and transactional `importManuscript`                    |

## Public Contracts & Invariants

- **Streaming Size Cap**: Enforces `MAX_IMPORT_BYTES` (10 MB) on both declared `Content-Length` and streamed request chunks (`readBodyWithLimit`, HTTP `413 VALIDATION_FAILED`) so oversized or spoofed uploads are never fully buffered.
- **Heading & Summary Mapping**: Mirrors export headings — `#`/`h1` novel title, `##`/`h2` act, `###`/`h3` chapter, `####`/`h4` scene; blockquotes map to scene summaries unless `summaries=false`.
- **Ownership Privacy**: `assertNovelOwner` reports missing, soft-deleted, and foreign-owned novels identically as `404 NOT_FOUND`.
- **Transactional Locking**: `importManuscript` runs in one `db.transaction`, calls `await lockNovelStructure(tx, novelId)` as its **first statement**, appends imported acts after existing `position`s, and updates `Novel.title`/`subtitle` only when `applyTitle: true`.
- **Error Contract**: `ImportError` codes (`NOT_FOUND` 404, `VALIDATION_FAILED` 400/413).

## API Route

- `POST /api/books/[id]/import` (`multipart/form-data`: `file`, optional `format`, `summaries`, `confirm`, `applyTitle`, `structure`).

## Verification

- **Unit (`bun run test:no-db`)**: `tests/import-override.test.ts`, `tests/import-manuscript-dialog-dom.test.tsx`.
- **DB Integration (`bun run test`)**: `tests/import.test.ts`.
