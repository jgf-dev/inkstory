# Changelog

All notable changes to InkStory are tracked here. This file follows [Keep a Changelog](https://keepachangelog.com/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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

### Notes

- Codex tables (CodexEntry, CodexAlias, CodexTag, CodexRelation, CodexProgression) intentionally NOT included; they ship in Epic 1 (STO-1167).
- `npm audit` reports 3 transitive high-severity advisories (PostCSS / sharp via Next 15). Fixing requires bumping to Next 16 (breaking); tracked as a follow-up.
