# Prompts & Portable Component Contracts (`src/lib/prompts`)

## Purpose

Layered prompt template management, closed-catalog variable interpolation, versioned pure-data component contracts, and portable JSON import/export.

## Modules

| Module                         | Role                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                     | Public barrel exports                                                                                                                        |
| `service.ts`                   | Prompt and component CRUD, layered resolution, `duplicatePromptToLibrary`, and contract/portable persistence                                 |
| `types.ts`                     | DTOs and input contracts (`PromptDto`, `PromptComponentDto`, `PromptRoleName`, `PromptScopeName`)                                            |
| `errors.ts`                    | `PromptError` and `handlePromptApiError`                                                                                                     |
| `catalog.ts`                   | Frozen closed variable token catalog (`PROMPT_VARIABLE_TOKENS`)                                                                              |
| `defaults.ts`                  | Seeded `SYSTEM_DEFAULT` continuation and beat-expansion prompt parts                                                                         |
| `interpolate.ts` / `render.ts` | Template interpolation (`{{token}}`), scene binding builder, and prompt rendering                                                            |
| `contracts.ts`                 | Versioned (`schemaVersion: 1`) pure-data contract validation (`CRAFT_INPUT_REGISTRY`, `CONTEXT_SLICES`, `OUTPUT_MODES`, `SUGGESTED_ACTIONS`) |
| `portable.ts`                  | Portable component JSON envelope (`inkstory.prompt-component`, `formatVersion: 1`) export and strict import                                  |

## Public Contracts & Invariants

- **Layered Resolution**: Resolves prompts in order `novel active → user default for mode → SYSTEM_DEFAULT`.
- **Read-Only Defaults**: `SYSTEM_DEFAULT` rows cannot be edited or deleted directly (`PromptError(..., "READ_ONLY")`); authors customize by duplicating via `duplicatePromptToLibrary`.
- **Frozen Closed Variable Catalog**: `catalog.ts` restricts interpolation to 11 `{{token}}` keys: `codex.context`, `codex.description`, `scene.summary`, `scene.content`, `scene.title`, `scene.pov`, `scene.tense`, `chapter.title`, `novel.title`, `beat.text`, and `mode`.
- **Pure-Data Contracts**: `contracts.ts` (`schemaVersion: 1`) caps serialized contracts at `PROMPT_CONTRACT_MAX_BYTES` (64 KB) and `PROMPT_CONTRACT_MAX_DEPTH` (`8`), allowing only registered craft input keys and context slices (no expressions, paths, URLs, or secrets). `null` preserves legacy STO-1158 behavior.
- **Portable Interchange**: `portable.ts` strips IDs, `ownerId`, `novelId`, timestamps, and credentials on export. Import strictly rejects unknown fields or unsupported versions and always creates a new component owned by the importing user.
- **Error Contract**: `PromptError` codes (`NOT_FOUND`, `FORBIDDEN`, `VALIDATION_FAILED`, `CONFLICT`, `READ_ONLY`, `UNRESOLVED_VARS`, `INVALID_CONTRACT`, `UNSUPPORTED_VERSION`, `PAYLOAD_TOO_LARGE`, `INVALID_PORTABLE`, `MISSING_INPUT`) plus `INVALID_JSON` (400) in `handlePromptApiError`.

## API Routes

- `GET|POST /api/prompts`, `GET|PATCH|DELETE /api/prompts/[id]`, `POST /api/prompts/[id]/duplicate`
- `GET|POST /api/prompts/components`, `PATCH|DELETE /api/prompts/components/[id]`
- `GET /api/prompts/components/[id]/export`, `POST /api/prompts/components/import`, `POST /api/prompts/components/import/preview`

## Verification

- **Unit (`bun run test:no-db`)**: `tests/prompts-interpolate.test.ts`, `tests/prompts-contracts.test.ts`, `tests/prompts-portable.test.ts`, `tests/prompts-api.test.ts`, `tests/prompts-portable-api.test.ts`.
- **DB Integration (`bun run test`)**: `tests/prompts-service.test.ts`, `tests/prompts-contracts-service.test.ts`.
