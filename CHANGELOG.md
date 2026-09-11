# Changelog

All notable changes to InkStory are tracked here. This file follows [Keep a Changelog](https://keepachangelog.com/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Summary

Implemented Mention Detection Service ([STO-1152](https://linear.app/jgfdev/issue/STO-1152)), full CRUD API and Server Actions ([STO-1168](https://linear.app/jgfdev/issue/STO-1168)), interactive Codex UI ([STO-1169](https://linear.app/jgfdev/issue/STO-1169)), and Codex database schema & migrations ([STO-1167](https://linear.app/jgfdev/issue/STO-1167)).

### Added

- **Mention Detection Service (`src/lib/codex/mention-detection.ts`)**:
  - Text scanner detecting Codex entry names and aliases inside scene text or beat prompts.
  - Case-insensitive, word-boundary aware (handling punctuation, quotes, and apostrophes without false substring matches).
  - Longer-match precedence for overlapping mentions (e.g. "The Glass Weaver" over "Glass Weaver").
  - Returns character indices (`startIndex`, `endIndex`) and unique matched entity IDs.
  - Integrated via `scanMentionsInNovel`, `scanMentionsInScene`, `detectMentionsAction`, and `POST /api/codex/mentions`.
- **Codex Domain Service (`src/lib/codex/service.ts`)**:
  - Full CRUD operations for `CodexEntry`, `CodexAlias`, `CodexTag`, `CodexRelation`, and `CodexProgression`.
  - Scoping rules enforcement: series-scoped entries are bound to series and shared across all books in that series; book-scoped entries are strictly bound to individual novels and isolated from other books.
  - Cross-novel validation for graph relations and scene-level temporal progressions.
  - Soft-delete support (`deletedAt`) across all entities with hard-delete option.
- **Server Actions (`src/lib/codex/actions.ts`)**:
  - Strongly typed Server Actions (`createCodexEntryAction`, `updateCodexEntryAction`, `deleteCodexEntryAction`, `listCodexEntriesForNovelAction`, `listCodexEntriesForSeriesAction`, etc.) for seamless React component integration.
- **Codex UI & Dashboard (`src/app/dashboard/codex/...`)**:
  - `CodexManager` interface with real-time text search, type filtering pills (Characters, Locations, Items, Lore, Factions, Concepts), and novel/series scoping indicators.
  - `CodexEditor` for editing entry names, types, tracking modes, descriptions, notes, aliases, tags, graph relations, and progressions.
  - `CodexCreateModal` for quickly authoring new Codex entries with book vs. series scoping, color themes, and initial aliases.
  - Updated `/dashboard` with Codex metrics and navigation.
- **REST Route Handlers (`src/app/api/codex/...`)**:
  - `GET /api/codex/entries`: list entries by `novelId` or `seriesId` with filters (`type`, `trackingMode`, `search`, `seriesOnly`).
  - `POST /api/codex/entries`: create new Codex entries with initial aliases and tags.
  - `GET /api/codex/entries/[id]`: retrieve entry with aliases, tags, progressions, and relations.
  - `PATCH /api/codex/entries/[id]`: update entry fields or scoping.
  - `DELETE /api/codex/entries/[id]`: delete entry (soft or `?hard=true`).
  - `POST /api/codex/entries/[id]/aliases` & `DELETE /api/codex/aliases/[id]`: manage aliases.
  - `POST /api/codex/entries/[id]/tags` & `DELETE /api/codex/tags/[id]`: manage tags.
  - `POST /api/codex/relations`, `PATCH /api/codex/relations/[id]`, `DELETE /api/codex/relations/[id]`: manage relations.
  - `POST /api/codex/progressions`, `PATCH /api/codex/progressions/[id]`, `DELETE /api/codex/progressions/[id]`: manage progressions.
- **Automated Tests**:
  - `tests/codex-service.test.ts`: 23 comprehensive tests verifying scoping enforcement, CRUD, relation graphs, progressions, and permission guards.
  - `tests/codex-actions.test.ts`: 8 tests verifying authentication guards, server action delegation, and error handling.
  - `tests/codex-api.test.ts`: 14 tests verifying route handlers, query parsing, and response formatting.
  - `tests/codex-ui.test.ts`: 7 tests verifying Codex manager list, editor details, creation modal, and auth redirects.

## [a7eb5b6](https://github.com/jgf2/story-builder/commit/a7eb5b62b083c213426e2e505500e572049e0e37) - 2026-09-10

### Summary

Implemented complete test coverage across the application using Vitest and Vite+, establishing 37 persistent unit and integration tests and reaching 100% line coverage and 99.25% statement coverage across all application source modules.

### Added

- `tests/api-health.test.ts`: automated tests for `GET /api/health` endpoint, checking 200 HTTP response, payload schema, dynamic flag, and version fallback
- `tests/supabase-auth.test.ts`: unit and integration tests for `syncAuthUser`, covering validation errors, metadata resolution (full_name/name, avatar_url/picture), and database upserts
- `tests/supabase-clients.test.ts`: tests for Supabase browser and server client factories (`createSupabaseBrowserClient`, `createSupabaseServerClient`), including cookie store adapters and server component error handling
- `tests/supabase-middleware.test.ts`: tests for session cookie refreshes in `updateSession` and static route filtering in `proxy` middleware matcher
- `tests/pages.test.ts`: server component and page tests covering `RootLayout`, `HomePage`, `DashboardPage` auth redirects and metrics rendering, and `LoginPage`/`SignupPage` auth gates
- `tests/auth-components.test.ts`: client component tests for `LoginForm`, `SignupForm`, and `LogoutButton` covering input events, loading states, auth error handling, and redirection
- Vitest coverage and resolve alias configurations in `vite.config.ts`

### Removed

### Fixed

- Added test coverage for database URL parsing edge cases (`[SENSITIVE]`, non-postgres schemes, fallback envs) in `src/lib/prisma.ts`

## [ecf4397](https://github.com/jgf2/story-builder/commit/ecf4397e639905f508bd134a457bfebeda3a08a5) - 2026-09-09

### Summary

Fixed the `oven-sh/setup-bun` GitHub action reference in the CI workflow by updating it to a valid commit SHA matching `v2.2.0`.

### Added

### Removed

### Fixed

- Replaced non-existent commit SHA `4c1f1ad0c1c6b8cd5dc9b4da65fa6e6b1019fd5c` with valid `v2.2.0` commit SHA `0c5077e51419868618aeaa5fe8019c62421857d6` in `.github/workflows/ci.yml`

## [PR-44](https://github.com/jgf2/story-builder/pull/44) - 2026-09-09

### Summary

Synchronized and updated GitHub Actions workflows to align with Node.js 24, Vite+, and Prisma 8 (Prisma Next).

### Added

- Migration triggers for `migrations/**` and `prisma/contract.prisma` in `prisma.yml`
- Explicit `prisma contract emit` step before database migration execution in `prisma.yml`
- OIDC token exchange and Next.js Prisma Compute deployment steps restored in `prisma-deploy.yml`

### Removed

- Deprecated `./node_modules/.bin/prisma migrate deploy` Prisma 7 command in `prisma.yml`
- Outdated Node.js 22 pin in `ci.yml`

### Fixed

- Replaced obsolete `prisma migrate deploy` with Prisma 8 `prisma db migrate` in `prisma.yml`
- Standardized Node.js 24 and npm 12 across `ci.yml`, `prisma.yml`, and `prisma-deploy.yml`
- Restored truncated GitHub OIDC authentication and Compute deployment steps in `prisma-deploy.yml`

## [PR-43](https://github.com/jgf2/story-builder/pull/43) - 2026-09-09

### Summary

Full upgrade to Prisma 8 (Prisma Next) and `@prisma/orm-postgres`. Migrated from Prisma 7 schema to Prisma 8 contract-first data contract (`prisma/contract.prisma`), emitted contract artifacts, signed database marker, updated database client singleton and ORM queries across the app, and added automated test suite.

### Added

- `@prisma/orm-postgres` and `@prisma/cli-engine` runtime and toolchain packages
- `prisma/contract.prisma` data contract declaring all public models, native enums, and foreign key relations
- Emitted artifacts `prisma/contract.json` and `prisma/contract.d.ts`
- `temporal-polyfill` for Temporal representations on timestamp fields
- `tests/prisma-8.test.ts` persistent integration test suite verifying Prisma 8 ORM queries
- Package scripts: `contract:emit`, `db:verify`, `db:sign`, `db:update`, and `test`

### Removed

- `@prisma/client` and `@prisma/adapter-pg` Prisma 7 dependencies
- Deprecated Prisma 7 CLI scripts (`prisma generate`, `prisma db push`)

### Fixed

- Resolved `[CLI.CONFIG_MISSING_MARKER]` error during `prisma skills sync`
- Replaced legacy `@prisma/client` queries in `src/lib/supabase/auth.ts`, `src/app/dashboard/page.tsx`, and `prisma/seed.ts` with Prisma 8 `db.orm.public.*` query API

## [Unreleased]

### Summary

Implemented the complete database schema for the Codex system (Epic 1 / [STO-1167](https://linear.app/jgfdev/issue/STO-1167)), introducing entities for story bible entries, aliases, tags, directed graph relations, and scene-linked temporal progressions.

### Added

- Prisma models:
  - `CodexEntry`: story bible entities (Character, Location, Item, Lore, Faction, Concept, Other) supporting book vs. series scoping, tracking modes (`ALWAYS`, `DETECTED`, `NEVER`), custom JSON fields, colors, and thumbnails.
  - `CodexAlias`: entity aliases and monikers for mention detection.
  - `CodexTag`: per-entry category labels (not a shared vocabulary + join; shared tag picker can come later if CRUD needs it).
  - `CodexRelation`: directed graph relationships with labels/reverse labels (cycle prevention is out of scope here; tracked separately, e.g. STO-1154).
  - `CodexProgression`: temporal narrative state evolutions linked to specific scenes with addition/replacement modes.
- Enums: `CodexType`, `CodexTrackingMode`, `ProgressionMode`.
- Extended seed script (`prisma/seed.ts`) with rich demo Codex fixtures (Mara Vance, Master Corvus, Sunken Archives, Glass Weaver's Quill, The Great Fracture lore, relations, and scene progression).

### Notes

- Prisma Compute Deploy is the source of truth for applying this schema in the Prisma-managed environment. Authz for child Codex rows is join-to-entry / Prisma service role; RLS policies are intentionally deferred.
- Novel XOR series (+ `seriesScoped` alignment), soft-delete-safe partial unique indexes, and self-relation CHECKs are parked for STO-1168 rather than half-enforced in this PR.

## [PR-42](https://github.com/jgf-dev/inkstory/pull/42) - 2026-08-22

### Summary

Fixed failing Prisma Compute Deploy check by regenerating and syncing `package-lock.json` with updated Prisma 7 dependencies and formatted settings.

### Added

### Removed

### Fixed

- Re-synchronized `package-lock.json` so that `npm ci` succeeds during Prisma Compute deployment without missing dependency errors
- Formatted `.vscode/settings.json` with Prettier

## [8b2c604](https://github.com/jgf-dev/inkstory/commit/8b2c604) - 2026-08-10

### Summary

Fixed `db:push`, `db:migrate`, and `db:seed` hanging indefinitely. Root cause: Supabase's transaction pooler (port 6543) blocks DDL; the direct DB hostname resolves IPv6-only (unreachable on this network); and the seed process never exited due to an undrained `pg.Pool`.

### Added

- `dotenv-cli` dev dependency (used in `db:push`/`db:migrate` scripts to extract `DIRECT_URL`)

### Fixed

- `db:push` / `db:migrate`: now route through Supabase **session pooler** (port 5432, IPv4, DDL-safe) via `--url $(dotenv -p DIRECT_URL)`
- `prisma.config.ts`: removed invalid `directUrl` field (not in Prisma 7's `Datasource` type)
- `prisma/seed.ts`: explicit `pg.Pool` creation + `pool.end()` in `finally` block so process exits; added dotenv loading so env vars are available when run directly via `tsx`
- `.env`: `DIRECT_URL` updated from unreachable IPv6 direct host to IPv4 session pooler URL

## [dc4b09f](https://github.com/jgf-dev/inkstory/commit/dc4b09f) - 2026-08-09

### Summary

Fixed `next build` type error caused by Prisma 7 removing `datasourceUrl` from `PrismaClient` constructor. Migrated to `PrismaPg` driver adapter pattern. Also fixed `db:migrate` / `db:push` by loading `.env.local` in `prisma.config.ts`.

### Added

- `@prisma/adapter-pg`, `pg`, `@types/pg` dependencies for driver adapter pattern

### Fixed

- TypeScript error: `Type 'string' is not assignable to type 'never'` on `datasourceUrl`
- `db:migrate` / `db:push` error: `datasource.url property is required` — fixed by loading dotenv in `prisma.config.ts`

## [e092919](https://github.com/jgf-dev/inkstory/commit/e092919) - 2026-08-09

### Summary

Migrated to Prisma 7 config format to fix `P1012` validation error (`url` property removed from `datasource` block in schema files).

### Added

- `prisma.config.ts` at project root with `defineConfig` + `datasource.url` (Prisma 7 requirement)
- InsForge backend project `inkstory` setup and link (`.insforge/project.json` and `.env.local` configuration)
- Installed `@insforge/sdk` package for Next.js app integration
- Installed InsForge CLI agent skills and added `AGENTS.md`
- Next.js 15 + React 19 + TypeScript strict + Tailwind CSS scaffold
- Supabase integration (`@supabase/ssr`): browser, server, and middleware clients; session refresh on every request
- Prisma schema with `User`, `Series`, `Novel`, `Act`, `Chapter`, `Scene` (hierarchical, soft-deletable, ordered by `position`)
- `Pov` and `Tense` enums on `Scene`
- Email/password signup and login pages with error handling
- Authed dashboard that mirrors Supabase auth users → local `users` table and surfaces counts of series/novels owned
- Idempotent seed script (`npm run db:seed`) that loads a demo series → novel → act → chapter → scene
- Health probe at `GET /api/health`
- GitHub Actions CI: lint, typecheck, format check, build, `prisma validate`
- Prettier + ESLint (Next config) + Tailwind class sorting
- README with full Supabase setup walkthrough
- `.env.example` documenting all required environment variables

### Fixed

- `P1012` error: `The datasource property url is no longer supported in schema files`
- Removed `url = env("DATABASE_URL")` from `prisma/schema.prisma` datasource block
- Updated `src/lib/prisma.ts` to pass `datasourceUrl` directly to `PrismaClient` constructor

### Notes

- Codex tables (CodexEntry, CodexAlias, CodexTag, CodexRelation, CodexProgression) intentionally NOT included; they ship in Epic 1 (STO-1167).
- `npm audit` reports 3 transitive high-severity advisories (PostCSS / sharp via Next 15). Fixing requires bumping to Next 16 (breaking); tracked as a follow-up.
