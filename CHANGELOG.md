# Changelog

All notable changes to InkStory are tracked here. This file follows [Keep a Changelog](https://keepachangelog.com/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Summary

Implemented the complete database schema for the Codex system (Epic 1 / [STO-1167](https://linear.app/jgfdev/issue/STO-1167)), introducing entities for story bible entries, aliases, tags, directed graph relations, and scene-linked temporal progressions.

### Added

- Prisma models:
  - `CodexEntry`: story bible entities (Character, Location, Item, Lore, Faction, Concept, Other) supporting book vs. series scoping, tracking modes (`ALWAYS`, `DETECTED`, `NEVER`), custom JSON fields, colors, and thumbnails.
  - `CodexAlias`: entity aliases and monikers for mention detection.
  - `CodexTag`: tag categorization.
  - `CodexRelation`: directed graph relationships with labels/reverse labels and cycle prevention support.
  - `CodexProgression`: temporal narrative state evolutions linked to specific scenes with addition/replacement modes.
- Enums: `CodexType`, `CodexTrackingMode`, `ProgressionMode`.
- Extended seed script (`prisma/seed.ts`) with rich demo Codex fixtures (Mara Vance, Master Corvus, Sunken Archives, Glass Weaver's Quill, The Great Fracture lore, relations, and scene progression).

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
