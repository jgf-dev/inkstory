---
name: inkstory-conventions
description: Development conventions and patterns for InkStory (TypeScript, vinext on Cloudflare Workers, Prisma 8, Supabase Auth, Vite+ / Bun).
---

# InkStory Conventions

> Updated for [jgf-dev/inkstory](https://github.com/jgf-dev/inkstory) on 2026-11-21

## Overview

This skill captures the active development conventions, module layout, error contracts, testing rules, and commit style used in InkStory.

## Tech Stack

- **Language**: TypeScript (strict)
- **Framework & Hosting**: `vinext` (`^1.4.4`) + React 19 on Cloudflare Workers (`cloudflare.config.ts`, `vite.config.ts`)
- **Database & ORM**: Supabase Postgres 17 + Prisma 8 (`prisma/contract.prisma`, `@prisma/orm-postgres`, `temporal-polyfill`)
- **Auth & Anti-Abuse**: Supabase Auth (`@supabase/ssr`, `src/proxy.ts`) + Cloudflare Turnstile (`src/lib/turnstile.ts`)
- **Editor & Styling**: TipTap 3 + Tailwind CSS 4 (CSS-variable OKLCH tokens in `src/app/globals.css`)
- **Tooling**: Bun (`bun.lock`) + Vite+ (`vp`) + Playwright E2E

## When to Use This Skill

Activate this skill when:

- Adding or modifying domain services, API route handlers, Server Actions, or UI components
- Writing Vitest unit/integration tests or Playwright E2E specs
- Formatting commits and PRs for this repository

## Architecture & Source Layout

InkStory is a single-package repository organized by **domain under `src/lib/`** and **App Router routes under `src/app/`**:

```text
src/
├── proxy.ts                   # Supabase session refresh boundary (do not add middleware.ts)
├── app/
│   ├── _components/           # Shared UI (PricingTable, ThemeToggle, TurnstileWidget)
│   ├── api/                   # Route Handlers (46 endpoints across auth, codex, ai, craft, prompts, books, novels, scenes, billing)
│   ├── dashboard/             # Authed pages + colocated _components/ (dashboard, codex, novels/[id], settings)
│   └── login/ / signup/
└── lib/
    ├── prisma.ts              # Prisma 8 singleton (`db.orm.public.*`)
    ├── ai/                    # generate, execute, providers/, credentials/, capabilities/
    ├── billing/               # plans, entitlements, subscription-sync
    ├── codex/                 # service, actions, errors, engines, context-assembler, interchange/
    ├── craft/                 # Craft Studio tool registry (`describe`, `expand`, `rewrite`)
    ├── export/ / import/      # Manuscript MD/DOCX/HTML import & export
    ├── library/               # Novel & series CRUD + onboarding starter bible
    ├── prompts/               # Templates, interpolation, versioned contracts, portable JSON
    ├── supabase/              # Browser/server/middleware clients + syncAuthUser
    ├── ui/                    # Theme/font/mode preferences & shared helpers
    └── writing/               # Outline tree, TipTap helpers, scene revisions, novel-lock
tests/                         # Vitest unit/integration suites + tests/e2e/ Playwright specs
prisma/                        # contract.prisma (source of truth), contract.{json,d.ts}, seed.ts
```

### Configuration Files

- `package.json` & `bun.lock` (canonical lockfile; use `bun install`, not `npm` or `vp install`)
- `vite.config.ts` (Vite+, `vinext`, `@cloudflare/vite-plugin`, Vitest, Oxlint, Oxfmt)
- `cloudflare.config.ts` (`inkstory` Worker + `inkstory-response-store` cache Worker)
- `prisma.config.ts` & `prisma/contract.prisma` (ignore legacy `prisma/schema.prisma`)
- `tsconfig.json`, `tailwind.config.ts`, `playwright.config.ts`
- `docker-compose.test.yml`, `.env.test`, `.env.example`
- `.github/workflows/{ci,sonarqube,mirror-postgres-image,prisma,prisma-deploy}.yml`

### Architectural Guidelines

- **Separate pure logic from DB/IO**: Keep pure engines, parsers, validators, and formatters (e.g., `mention-detection.ts`, `relation-engine.ts`, `progression-engine.ts`, `context-assembler.ts`, `prompts/contracts.ts`) DB-agnostic so they run under `bun run test:no-db`.
- **Workers compatibility**: Never use `node:dns` `lookup` (use `dns.resolve4`/`dns.resolve6` as in `src/lib/ai/credentials/host-resolver.ts`). Never expose secrets in `cloudflare.config.ts` plaintext `bindings.text(...)` or `NEXT_PUBLIC_*`.
- **Ownership & soft deletes**: Every authenticated API route sets `export const dynamic = "force-dynamic"`, verifies `supabase.auth.getUser()` (`401` if missing), and filters by `ownerId` + `deletedAt === null` in the service layer.
- **Structural concurrency**: Transactions mutating Act/Chapter/Scene ordering must call `await lockNovelStructure(tx, novelId)` (`src/lib/writing/novel-lock.ts`) as their first statement.
- **Prisma 8 timestamps**: Use `Temporal.Now.plainDateTimeISO()` from `temporal-polyfill` for writes, and serialize Prisma rows before crossing RSC → Client Component or Server Action boundaries.
- **Theming**: Use semantic CSS-variable token classes (`bg-app`, `bg-card`, `text-primary`, `text-muted`, `border-subtle`, `ink-*`, `bg-budget-*`) rather than hardcoded hex so "Parchment Desk" (light) and "Obsidian Desk" (dark) both render accurately.

## Code Style & Naming

| Element | Convention | Examples |
| --- | --- | --- |
| Domain modules (`src/lib/**`) | `kebab-case.ts` | `context-assembler.ts`, `novel-lock.ts` |
| React components | `PascalCase.tsx` | `WritingWorkspace.tsx`, `CodexEditor.tsx` |
| React hooks | `camelCase.ts` | `useCodexBudget.ts` |
| Tests (`tests/**`) | `kebab-case.test.ts(x)` | `codex-service.test.ts`, `codex-ui-dom.test.tsx` |
| Functions & variables | `camelCase` | `assembleCodexContextForScene` |
| Types, interfaces, classes | `PascalCase` | `CodexError`, `AssembledContext` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_OUTPUT_TOKENS`, `DEFAULT_PLAN_TIER` |

- **Imports**: Use the `@/` alias (`./src/*`) inside `src/`. In tests and Vite config, import from **`vite-plus/test`** and **`vite-plus`** (enforced by `vite-plus/prefer-vite-plus-imports` in `vite.config.ts` — do not import directly from `vitest` or `vite`).
- **Exports**: Prefer named exports everywhere except App Router entry files (`page.tsx`, `layout.tsx`) and default config files.

## Error Handling Pattern

Domains expose a typed `*Error` class (`CodexError`, `PromptError`, `AiError`, `CredentialError`, `ImportError`, `ExportError`, `CapabilityError`) carrying `(message, code, status)` alongside a shared API error handler that maps malformed JSON (`SyntaxError`) to HTTP `400 INVALID_JSON` instead of `500`:

```typescript
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION_FAILED" | "QUOTA_EXCEEDED",
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function handleDomainApiError(err: unknown): Response {
  if (err instanceof SyntaxError) {
    return Response.json(
      { error: "Malformed or invalid JSON body", code: "INVALID_JSON" },
      { status: 400 },
    );
  }
  if (err instanceof DomainError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
```

Server Actions return a discriminated `ActionResult<T>` (`{ success: true, data } | { success: false, error, code, status }`) rather than throwing across the client boundary.

## Testing Conventions

- Place all Vitest tests in top-level `tests/` (never inside `src/`).
- If a test issues live Prisma queries, add its path to `DB_TEST_FILES` in `vite.config.ts` so `bun run test:no-db` skips it cleanly.
- Tests load `.env.test` only (`tests/setup-env.ts`) and are guarded by `src/lib/test-database-guard.ts` against hosted Supabase URLs. Run `bun run test` (full DB-backed suite) or `bun run test:no-db` (fast unit path), and verify with `vp check` before committing.

## Commit Conventions

Use **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`), imperative mood, concise subject line (~60 chars):

```text
feat: add Craft Studio describe tool and dry-run prompt preview
fix: batch chapter and scene queries in loadNovelSceneReadingOrder
docs: reconcile AGENTS.md and README.md with vinext and Workers
```

## Best Practices

### Do

- Run `bun run contract:emit` after changing `prisma/contract.prisma` (or after `bun install --ignore-scripts`).
- Keep third-party interchange metadata intact under `CodexEntry.customFields._inkstoryInterchange`.
- Never fall back to platform AI spend when an explicit BYOK credential fails.

### Don't

- Don't import from `vitest` directly in tests (use `vite-plus/test`).
- Don't add `next`, `vercel.json`, `@insforge/sdk`, or a separate `middleware.ts`.
- Don't edit legacy `prisma/schema.prisma` or point tests at `.env` / `.env.local`.
