<!-- @format -->

Here is the detailed, file-by-file breakdown of the documentation drift across the repository, ordered by developer/agent impact.
──────

1. README.md — Stale Stack, Broken Local Setup, Missing 70%+ of API Surface

Section & Lines │ What README.md says │ Actual codebase reality
───────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Stack (L9–L18) │ Next.js 16 (App Router) + Vercel (vercel.json) │ Migrated to vinext (^1.4.4) + Cloudflare Workers (cloudflare.config.ts, vite.config.ts). next, next.config.ts, and vercel.json no longer exist.
Local setup (L47–L76) │ Copy .env.example, fill Supabase vars, run bun run dev, sign up. │ Will fail with HTTP 403 on login/signup. Both /api/auth/login and /api/auth/signup fail closed without TURNSTILE_SECRET and TURNSTILE_HOSTNAMES (src/lib/turnstile.ts:66-77). Also omits
│ │ BYOK_ENCRYPTION_KEY, AI_GATEWAY_API_KEY, and STRIPE__.
Acceptance criteria (L20–L29) │ Lists 11 tables (core + Codex); attributes auth failures to old issue #60. │ prisma/contract.prisma has 17 models & 11 enums (adds SceneRevision, UserProviderCredential, Prompt, PromptComponent, PromptComponentLink, StripeWebhookEvent).
Project layout (L77–L97) │ Only lists /api/health, /api/codex, /dashboard, src/lib/{codex,supabase}. │ Missing cloudflare.config.ts, /dashboard/novels/[id], /dashboard/settings, and src/lib/{ai,billing,craft,export,import,library,prompts,stage,ui,writing,turnstile.ts}.
Codex & REST (L99–L136) │ Lists 13 endpoints; omits QUOTA_EXCEEDED & CONTEXT_ASSEMBLY_FAILED. │ Actual app has 46 API routes (.next/types/routes.d.ts:25): missing /api/context/assemble, /api/ai/_, /api/auth/_, /api/billing/_, /api/books/[id]/{import,export}, /api/codex/interchange/_,
│ │ /api/craft/_, /api/novels/[id]/outline, /api/prompts/_, /api/scenes/[id]/_. Error contract (src/lib/codex/errors.ts:22-46) also emits QUOTA_EXCEEDED (402) and CONTEXT_ASSEMBLY_FAILED (422).
Scripts & Tests (L138–L163, L211) │ bun run dev = "Next.js dev server"; bun run test = vp test; Playwright requires /usr/bin/google-chrome. │ package.json:6-31: dev is vp dev --port 3000; test is bun scripts/test-db.ts (same as test:db); test:no-db, preview, deploy, deploy:response-store, cf-typegen, prepare are undocumented.
│ │ playwright.config.ts:5-26 now falls back to bundled Chromium when system Chrome is absent.
What's next (L217–L225) │ [ ] Context Assembler (STO-1170 / STO-1171). │ Both shipped (context-assembler.ts + POST /api/context/assemble).
────── 2. AGENTS.md — Conflicting Agent Instructions & Dead Boilerplate

• Stale framework & partial architecture (L7–L16): Still tells agents the app runs on Next.js 16, only lists /dashboard and /dashboard/codex under UI, and omits writing, ai/BYOK/capabilities, craft, prompts/contracts, billing, import/export, interchange, turnstile, and vinext/Workers constraints (e.g., nodejs_compat, DoH DNS instead
of dns.lookup as noted in src/lib/ai/credentials/host-resolver.ts:4-6).
• Struck-through Vercel section with broken URL (L14, L41–L66): 26 lines of ~~vercel~~ best practices remain in the file, and the global replacement mangled the still-active Vercel AI Gateway URL on L63 (<https://ai-gateway.~~vercel~~.sh/v1/models>, which is still used in cloudflare.config.ts:31 and src/lib/ai/generate.ts:15).
• Dead Next.js agent-rules block (L68–L76): Tells agents to read node_modules/next/dist/docs/ and claims next dev re-adds the block — next is no longer installed.
• Incomplete skill index (L24–L39): Missing .agents/skills/migrate-to-vinext/SKILL.md and .agents/skills/vitest/SKILL.md.
• Conflicting Vite+ checklist (L101–L106): Recommends vp install (repo uses bun install + bun.lock) and raw vp test (which fails DB tests without Postgres running; repo wraps it in bun run test / bun run test:no-db).
────── 3. CHANGELOG.md — Stopped at 2026-10-19

• Missing ~1 month of major releases: Stops at PR-119 / PR-124 (2026-10-19). Unlogged shipped subsystems include:
• vinext + Cloudflare Workers + response-store cache migration
• Cloudflare Turnstile auth verification
• Stripe billing, webhooks, and plan entitlements (STO-1180, STO-1210)
• BYOK encrypted credentials (STO-1178) & server-resolved model capabilities (STO-1265)
• Prompt templates & versioned portable prompt contracts (STO-1158, STO-1275)
• Craft Studio (describe, expand, rewrite — STO-1266–STO-1269)
• Codex SillyTavern Lorebook & Character Card v2 interchange (STO-1261–STO-1263)
• TipTap rich-text editor & scene revisions (STO-1156)
• Manuscript import (STO-1211, STO-1213) & novel structure advisory lock (STO-1214)
• Obsidian Desk dark theme & Writer/Stage/Architect operating modes (JGF-128)
• Structural blemishes: Three legacy ## [Unreleased] blocks sit below dated PR entries (L152, L163, L312), and older links still point to jgf2/story-builder instead of jgf-dev/inkstory.
────── 4. .agents/skills/inkstory/SKILL.md — Stale Repo-Conventions Skill

• Generated 2026-09-14 (L8): Still lists Framework: Next.js (L17) and removed config files next.config.ts and vercel.json (L117, L121), while omitting cloudflare.config.ts and prisma.config.ts.
• Claims Files: camelCase (L138), whereas actual code uses kebab-case under src/lib/ and PascalCase for React components.
────── 5. .env.example, Legacy Schema & Inline Comments

• Turnstile env var mismatch: .env.example:41-42 documents NEXT_PUBLIC_TURNSTILE_KEY, while cloudflare.config.ts:43-44 sets NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SITE_KEY. (src/lib/turnstile.ts:21-26 falls back across the first two, so it works, but the names diverge.)
• Undocumented env vars: NEXT_PUBLIC_SUPABASE_JWKS_URL (in cloudflare.config.ts), NEXT_PUBLIC_INKSTORY_OPERATING_MODES (kill switch in src/app/dashboard/novels/[id]/_components/WritingWorkspace.tsx:53), NEXT_PUBLIC_E2E, INKSTORY_NO_DB, INKSTORY_TEST_POSTGRES_PORT, and INKSTORY_TEST_POSTGRES_IMAGE.
• **Legacy prisma/schema.prisma**: Still kept in the repo and partially maintained (has SceneRevision, UserProviderCredential, Prompt*), yet missing Stripe billing models/fields (PlanTier, User.stripe*/planTier, StripeWebhookEvent) that exist in prisma/contract.prisma. Should either be deleted (if Prisma 7 is fully retired) or
explicitly marked frozen/unmaintained.
• Stale inline comments:
• prisma/seed.ts:3-9: still references npm run db:seed and tsx (now vpx prisma/seed.ts).
• src/app/api/health/route.ts:3: references Vercel health checks.
• src/proxy.ts:2: references Next.js middleware.
• src/app/page.tsx:158: mockup URL shows inkstory.app/... while Workers config uses syncodex.xyz / inkstory.jgeof.workers.dev.
• No module/package docs: There are currently no README.md or contract docs in docs/, src/lib/*, prisma/, or tests/.
──────
Suggested Reconciliation Order

1. AGENTS.md — Highest leverage: remove dead ~~vercel~~ + nextjs-agent-rules blocks, fix the mangled AI Gateway URL, document vinext + Cloudflare Workers runtime rules, full subsystem map, and accurate bun/vp test commands.
2. README.md + .env.example — Fix the broken local-auth onboarding (add Turnstile setup & standardize NEXT_PUBLIC_TURNSTILE_SITE_KEY), update stack/scripts/routes/schema inventory, and check off completed Epic 1 items.
3. .agents/skills/inkstory/SKILL.md & prisma/schema.prisma — Regenerate/update the conventions skill and decide whether to retire prisma/schema.prisma.
4. CHANGELOG.md — Consolidate the orphaned [Unreleased] blocks and backfill post-2026-10-19 releases.
5. Subsystem READMEs (optional) — Add concise contract README.md files for the core domain packages (src/lib/{codex,ai,craft,prompts,writing,billing,import,export}) so future changes stay localized and easier to keep in sync.
