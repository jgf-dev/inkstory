# AGENTS.md

## Canonical stack (read this first)

InkStory application code uses **Supabase Auth + Prisma 8 (Prisma Next) against Supabase Postgres**. It does **not** use InsForge or `@insforge/sdk`; do not add InsForge clients or RLS patterns unless explicitly asked.

| Layer   | Actual code                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| App     | Next.js 16 App Router, React 19, `src/proxy.ts` session refresh                                                   |
| Data    | `prisma/contract.prisma`, `@prisma/orm-postgres`, `db.orm.public.*` in `src/lib/prisma.ts`                        |
| Auth    | `@supabase/ssr` cookie session; Codex routes 401 without `getUser()`                                              |
| Codex   | `src/lib/codex/{service,actions,types,mention-detection,progression-engine,relation-engine,context-assembler}.ts` |
| UI      | `/dashboard` metrics, `/dashboard/codex` manager/editor                                                           |
| Tooling | bun (CI/Vercel), vite-plus (`vp lint` / `vp fmt` / `vp test` / `vp check`)                                        |

Commands: `bun run dev`, `bun run test`, `bun run test:e2e`, `bun run db:update`, `bun run db:seed`, `bun run contract:emit`. There is no `db:migrate` or `db:studio`.

Progressions (STO-1153) resolve descriptions with Act→Chapter→Scene order (`ADDITION` / `REPLACEMENT`) via `resolveCodexEntryAtScene`. Relation CRUD is on the API; graph expansion (STO-1154) ships on `main` as the pure `RelationEngine` (`src/lib/codex/relation-engine.ts`) — BFS, cycle detection, depth limit (default 2), dedupe — with no dedicated HTTP endpoint.

Context assembly (STO-1170) is the pure `assembleContext` in `src/lib/codex/context-assembler.ts`: it takes pre-loaded entries, relations, progressions, and scene reading order, seeds from manual attachments → `ALWAYS` entries → detected mentions, expands relations (default depth 2), ranks/truncates (default 40), then applies progressions at the current scene. DB loading lives in `assembleCodexContextForScene` (`src/lib/codex/service.ts`), and `POST /api/context/assemble` returns the full `AssembledContext` for inspection (STO-1171); generation flows and Prompt Preview should call the same service function.

Theming (JGF-128): the `ink-*` ramp is defined as CSS variables in `src/app/globals.css` and registered via `@theme inline`; `[data-theme="dark"]` ("Obsidian Desk") is an OKLCH lightness inversion of the same map, so components must use token classes (`bg-app`, `bg-card`, `text-primary`, `text-muted`, `border-subtle`, `bg-budget-*`) rather than hardcoded hex. Theme, prose font (`[data-prose-font]`), and workspace mode persist in localStorage (`src/lib/ui/preferences.ts`) with a pre-paint bootstrap in `src/app/layout.tsx`. The writing workspace ships three progressive-disclosure modes (Writer / Stage / Architect) in `WritingWorkspace.tsx`, gated by `NEXT_PUBLIC_INKSTORY_OPERATING_MODES=0` as a kill switch; the Relation Linker (`RelationLinkerModal`), Progression Timeline (`ProgressionTimelineDrawer`), and Token Budget Bar (`TokenBudgetBar` + `src/lib/codex/budget-segments.ts`) live under the novel workspace.

## Available skills

- [design-md](.agents/skills/design-md/SKILL.md)
- [design-taste-frontend](.agents/skills/design-taste-frontend/SKILL.md)
- [high-end-visual-design](.agents/skills/high-end-visual-design/SKILL.md)
- [impeccable](.agents/skills/impeccable/SKILL.md)
- [inkstory](.agents/skills/inkstory/SKILL.md)
- [prisma-8](.agents/skills/prisma-8/SKILL.md)
- [prisma-composer-core-concepts](.agents/skills/prisma-composer-core-concepts/SKILL.md)
- [prisma-compute](.agents/skills/prisma-compute/SKILL.md)
- [redesign-existing-projects](.agents/skills/redesign-existing-projects/SKILL.md)
- [stitch-loop](.agents/skills/stitch-loop/SKILL.md)
- [stitch::generate-design](.agents/skills/stitch-generate-design/SKILL.md)
- [supabase](.agents/skills/supabase/SKILL.md)
- [supabase-postgres-best-practices](.agents/skills/supabase-postgres-best-practices/SKILL.md)
- [taste-design](.agents/skills/taste-design/SKILL.md)

<!-- VERCEL BEST PRACTICES START -->

## Best practices for developing on Vercel

These defaults are optimized for AI coding agents (and humans) working on apps that deploy to Vercel.

- Treat Vercel Functions as stateless + ephemeral (no durable RAM/FS, no background daemons), use Blob or marketplace integrations for preserving state
- Edge Functions (standalone) are deprecated; prefer Vercel Functions
- Don't start new projects on Vercel KV/Postgres (both discontinued); use Marketplace Redis/Postgres instead
- Store secrets in Vercel Env Variables; not in git or `NEXT_PUBLIC_*`
- Provision Marketplace native integrations with `vercel integration add` (CI/agent-friendly)
- Sync env + project settings with `vercel env pull` / `vercel pull` when you need local/offline parity
- Use `waitUntil` for post-response work; avoid the deprecated Function `context` parameter
- Set Function regions near your primary data source; avoid cross-region DB/service roundtrips
- Tune Fluid Compute knobs (e.g., `maxDuration`, memory/CPU) for long I/O-heavy calls (LLMs, APIs)
- Use Runtime Cache for fast **regional** caching + tag invalidation (don't treat it as global KV)
- Use Cron Jobs for schedules; cron runs in UTC and triggers your production URL via HTTP GET
- Use Vercel Blob for uploads/media; Use Edge Config for small, globally-read config
- If a deployment URL returns a Vercel Deployment Protection 401/403, retry the same URL with `vercel curl <url>`; don't disable protection or manage bypass secrets manually
- Add OpenTelemetry via `@vercel/otel` on Node; don't expect OTEL support on the Edge runtime
- Enable Web Analytics + Speed Insights early
- Use AI Gateway for model routing, set AI_GATEWAY_API_KEY, using a model string (e.g. 'anthropic/claude-sonnet-4.6'), Gateway is already default in AI SDK
  needed. Always curl <https://ai-gateway.vercel.sh/v1/models> first; never trust model IDs from memory
- For durable agent loops or untrusted code: use Workflow (pause/resume/state) + Sandbox; use Vercel MCP for secure infra access

<!-- VERCEL BEST PRACTICES END -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
