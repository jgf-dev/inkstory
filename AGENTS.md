# AGENTS.md

## Available skills

- [design-md](.agents/skills/design-md/SKILL.md)
- [design-taste-frontend](.agents/skills/design-taste-frontend/SKILL.md)
- [high-end-visual-design](.agents/skills/high-end-visual-design/SKILL.md)
- [impeccable](.agents/skills/impeccable/SKILL.md)
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
