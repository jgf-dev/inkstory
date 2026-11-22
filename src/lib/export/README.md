# Manuscript Export (`src/lib/export`)

## Purpose

Read-only, ownership-checked manuscript export to Markdown (`.md`) and Word (`.docx`) with act/chapter/scene filtering and heading toggles.

## Modules

| Module                    | Role                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `index.ts`                | Public barrel exports                                                                  |
| `types.ts`                | `ExportFormat`, `ExportContentMode`, `ExportOptions`, `ExportNovel`, and `ExportError` |
| `options.ts`              | Query-string parser (`parseExportOptions`)                                             |
| `select.ts`               | Selection filter (`selectExportTree`) over acts, chapters, and scenes                  |
| `markdown.ts` / `docx.ts` | Markdown (`renderMarkdown`, `SCENE_BREAK`) and DOCX (`renderDocx`) renderers           |
| `service.ts`              | `loadNovelForExport`, `renderExport`, `exportFilename`, and `exportNovel`              |

## Public Contracts & Invariants

- **Ownership & Privacy**: `loadNovelForExport` verifies the novel is non-deleted and owned by `userId`, throwing `ExportError("Novel not found", "NOT_FOUND", 404)` otherwise.
- **Batched Loading & Outline Parity**: Loads acts, chapters (`actId.in(...)`), and scenes (`chapterId.in(...)`) in at most 3 queries (no N+1 roundtrips) and sorts every level with `byPositionThenCreated` (`src/lib/writing/service.ts`) so exported order matches the writing outliner.
- **Selection & Output**: Empty `actIds`/`chapterIds`/`sceneIds` export the full novel; supports `content=prose|summary|both`, toggleable `actTitles`/`chapterTitles`/`sceneTitles`/`subtitles`, and normalized ASCII filenames (`exportFilename`).

## API Route

- `GET /api/books/[id]/export?format=md|docx`

## Verification

- **DB Integration (`bun run test`)**: `tests/export.test.ts`.
