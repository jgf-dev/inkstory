<!-- @format -->

# AGENTS.md

## Canonical stack (read this first)

InkStory runs on **`vinext` + Cloudflare Workers**, **Supabase Auth**, and
**Prisma 8 (Prisma Next) against Supabase Postgres**. It does **not** use
Next.js/Vercel hosting or InsForge (`@insforge/sdk`); do not add `next`,
`vercel.json`, InsForge clients, or RLS boilerplate unless explicitly asked.

| Layer                     | Actual code                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App & Hosting             | `vinext` (`^1.4.4`), React 19, Cloudflare Workers (`cloudflare.config.ts`, `vite.config.ts`), `src/proxy.ts` session refresh                                                               |
| Data                      | `prisma/contract.prisma` (source of truth; ignore legacy `prisma/schema.prisma`), `@prisma/orm-postgres`, `db.orm.public.*` in `src/lib/prisma.ts`, `temporal-polyfill`                    |
| Auth & Anti-Abuse         | `@supabase/ssr` cookie session (`src/lib/supabase/*`), fail-closed Cloudflare Turnstile on `/api/auth/{login,signup}` (`src/lib/turnstile.ts`)                                             |
| Writing & Library         | `src/lib/library/*`, `src/lib/writing/*` (TipTap 3 JSON + plain extract, `pg_advisory_xact_lock`, scene revisions)                                                                         |
| Story Codex               | `src/lib/codex/{service,actions,types,errors,mention-detection,progression-engine,relation-engine,context-assembler,token-budgeter,prompt-formatter,budget-segments}.ts` + `interchange/*` |
| AI, Prompts & Craft       | `src/lib/ai/{generate,execute}.ts`, `src/lib/ai/{providers,credentials,capabilities}/*`, `src/lib/prompts/*`, `src/lib/craft/*`                                                            |
| Import / Export & Billing | `src/lib/import/*`, `src/lib/export/*`, `src/lib/stripe.ts`, `src/lib/billing/{plans,entitlements,subscription-sync}.ts`                                                                   |
| UI Routes                 | `/`, `/login`, `/signup`, `/dashboard`, `/dashboard/codex`, `/dashboard/novels/[id]`, `/dashboard/settings`                                                                                |
| Tooling                   | Bun (`bun@1.4.4`, `bun.lock`), Vite+ (`vp build` / `vp dev` / `vp lint` / `vp fmt` / `vp test` / `vp check`), Playwright E2E                                                               |

## `vinext` & Cloudflare Workers runtime rules

- **App Router via `vinext`**: Application code imports `next/server`,
  `next/headers`, `next/link`, and `next/navigation`, which `vinext` serves at
  build/runtime and `vite.config.ts` aliases to `vinext/shims/*` when
  `process.env.VITEST` is set (the `vinext` and `cloudflare` Vite plugins are
  intentionally disabled under Vitest).
- **Workers topology**: `cloudflare.config.ts` deploys the `inkstory` worker
  (`vinext/server/fetch-handler`) paired with the auxiliary `inkstory-response-store`
  cache worker, with `compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"]`.
- **Workers API constraints**:
  - Do **not** use `node:dns` `lookup` (unsupported in Workers); use
    `dns.resolve4`/`dns.resolve6` (DNS over HTTPS, see `src/lib/ai/credentials/host-resolver.ts`).
  - Keep `src/proxy.ts` as the session-refresh boundary; do not add a separate
    `middleware.ts` that skips `@supabase/ssr`.
  - Never put secrets in `cloudflare.config.ts` plaintext `bindings.text(...)`
    or `NEXT_PUBLIC_*` variables. Store `DATABASE_URL`, `DIRECT_URL`,
    `SUPABASE_SERVICE_ROLE_KEY`, `BYOK_ENCRYPTION_KEY`, `AI_GATEWAY_API_KEY`,
    `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `TURNSTILE_SECRET` as
    Worker secrets (prod) or in local
    `.env.local`.
- **AI Gateway note**: Although hosting moved from Vercel to Cloudflare Workers,
  the default platform generation route still calls the OpenAI-compatible Vercel AI
  Gateway (`AI_GATEWAY_BASE_URL`, default `https://ai-gateway.vercel.sh/v1`,
  model `AI_MODEL`, default `anthropic/claude-sonnet-4.6`). Verify model IDs via
  `https://ai-gateway.vercel.sh/v1/models` rather than guessing from memory.
  When `AI_GATEWAY_API_KEY` is unset and no BYOK credential is selected,
  `/api/ai/generate` returns `503 AI_NOT_CONFIGURED` along with the assembled
  prompt so zero spend occurs.

## Subsystem map & invariants

- **Auth & Turnstile**: API routes require `supabase.auth.getUser()` and return
  `401` when unauthenticated. `POST /api/auth/login` and `POST /api/auth/signup`
  verify Cloudflare Turnstile tokens server-side (`verifyTurnstileToken` in
  `src/lib/turnstile.ts`) and fail closed when `TURNSTILE_SECRET` or
  `TURNSTILE_HOSTNAMES` is missing.
  E2E mock auth (`e2e-user` cookie) is strictly gated behind
  `NODE_ENV !== "production" && NEXT_PUBLIC_E2E === "true"`.
- **Writing, TipTap & Revisions (STO-1156, STO-1214)**: `Scene.content` holds
  the authoritative plain-text extract (used by AI, word counts, mention
  detection, and export); `Scene.contentDoc` holds optional TipTap
  JSON (`ContentFormat`: `PLAIN` | `TIPTAP_JSON`). Any transaction mutating
  Act/Chapter/Scene ordering (manual
  create/reorder or manuscript import) must acquire `lockNovelStructure(tx, novelId)`
  (`src/lib/writing/novel-lock.ts`) as its **first statement**. Snapshots
  live in `SceneRevision` (`/api/scenes/[id]/revisions`,
  `/api/scenes/[id]/revisions/[revisionId]/restore`).
- **Story Codex & Context Assembly (STO-1152–1154, STO-1170–1171)**:
  - Progressions resolve descriptions in Act → Chapter → Scene order
    (`ADDITION` / `REPLACEMENT`) via `ProgressionEngine` / `resolveCodexEntryAtScene`.
  - Relations graph expansion ships as the pure `RelationEngine`
    (`src/lib/codex/relation-engine.ts` — BFS, cycle detection, default max depth
    2, dedupe) with no dedicated expansion endpoint.
  - `assembleContext` (`src/lib/codex/context-assembler.ts`) seeds from manual
    attachments → `ALWAYS` entries → detected mentions, expands relations,
    ranks/truncates (default 40), and applies progressions at the scene.
  - DB loading lives in `assembleCodexContextForScene`
    (`src/lib/codex/service.ts`); `POST /api/context/assemble`,
    `/api/ai/generate`, and `/api/ai/preview` share this path plus
    `applyTokenBudget` and `formatAssembledContext`.
- **Codex Interchange (STO-1261–1263)**:
  - `src/lib/codex/interchange/*` and `/api/codex/interchange/{lorebook,card,matrix}/*`
    handle SillyTavern Lorebook and Character Card v2 (PNG/JSON) preview/import/export.
    Third-party metadata is preserved inside `CodexEntry.customFields._inkstoryInterchange`
    (no extra tables); never strip or
    overwrite `_inkstoryInterchange` outside interchange helpers.
- **BYOK, Capabilities & Craft Studio (STO-1175–1178, STO-1265–1269, STO-1158, STO-1275)**:
  - `UserProviderCredential` encrypts keys with AES-256-GCM (`BYOK_ENCRYPTION_KEY`,
    `src/lib/ai/credentials/crypto.ts`). API DTOs must never expose `ciphertext`,
    `iv`, `authTag`, or plaintext keys. Explicit BYOK execution
    (`src/lib/ai/execute.ts`) must **never** fall back to platform spend on failure.
  - Adapters (`src/lib/ai/providers/*`): `openrouter`, `openai`, `anthropic`,
    `ollama`, `lmstudio` (local providers do not require an API key).
    Server-resolved advanced controls (`minP`, `avoidanceGuidance`, OpenRouter
    `endpoint`) are gated by `src/lib/ai/capabilities/*` and `GET /api/ai/capabilities`;
    ignore client-supplied capability maps.
  - Prompt templates (`Prompt`, `PromptComponent`, `PromptComponentLink`)
    resolve in order `novel active → user default → SYSTEM_DEFAULT` (read-only;
    duplicate to customize) and support versioned pure-data craft/portability
    contracts (`src/lib/prompts/contracts.ts`, `/api/prompts/components/*`).
  - Craft Studio (`src/lib/craft/*`, `/api/craft/tools`, `/api/craft/[tool]`)
    currently registers `describe`, `expand`, and `rewrite`; results are never
    auto-written to the manuscript.
- **Import / Export & Billing (STO-1163, STO-1180, STO-1210–1213)**:
  - Manuscript import (`POST /api/books/[id]/import`) enforces a 10 MB
    streaming cap on `.docx`/`.md`/`.html` with preview/confirm and optional
    `structure` override / `applyTitle`. Export (`GET /api/books/[id]/export`)
    outputs Markdown or DOCX using `byPositionThenCreated` ordering.
  - Plan tiers (`FREE`: 1 novel, 30 codex entries, 4k context tokens; `PRO`:
    unlimited, 6k tokens; `STUDIO`: unlimited, 6k tokens, series sharing) are
    enforced in `src/lib/billing/entitlements.ts`, throwing `CodexError("...",
    "QUOTA_EXCEEDED", 402)`. Stripe webhook processing (`/api/billing/webhook`)
    deduplicates via claim/release
    rows in `StripeWebhookEvent`.
- **Theming & Workspace Modes (JGF-128)**:
  - The `ink-*` ramp is defined as CSS
    variables in `src/app/globals.css` and registered via `@theme inline`;
    `[data-theme="dark"]` ("Obsidian Desk") is an OKLCH lightness inversion of
    the same map. Components must use token classes (`bg-app`, `bg-card`,
    `text-primary`, `text-muted`,
    `border-subtle`, `bg-budget-*`) rather than hardcoded hex.
  - Theme, prose font (`[data-prose-font]`), and workspace mode persist in `localStorage`
    (`src/lib/ui/preferences.ts`) with a pre-paint bootstrap in
    `src/app/layout.tsx`. `WritingWorkspace.tsx` ships three progressive-disclosure
    modes (Writer / Stage [fixture preview] / Architect), gated by `NEXT_PUBLIC_INKSTORY_OPERATING_MODES=0`;
    `RelationLinkerModal`, `ProgressionTimelineDrawer`, and `TokenBudgetBar`
    (`src/lib/codex/budget-segments.ts`) live under the novel workspace.

## Commands & testing

Use **Bun** for package management and scripts (`bun.lock` is canonical; do not
run `npm install` or `vp install`). If installing with `--ignore-scripts`, run
`bun run contract:emit` afterward.

- **Dev & Build**: `bun run dev` (`vp dev --port 3000`), `bun run build`
  (`vp build`), `bun run preview`, `bun run cf-typegen`
- **Deploy (Cloudflare Workers)**: `bun run deploy` (`vinext-cloudflare deploy`),
  `bun run deploy:response-store`
- **Quality gates**: `bun run lint` (`vp lint --fix`), `bun run typecheck`
  (`vp check --no-fmt --no-lint`), `bun run format:check` (`vp fmt --check`),
  or `vp check`
- **Database (Prisma 8)**: `bun run contract:emit`, `bun run db:update`,
  `bun run db:verify`, `bun run db:sign`, `bun run db:seed` (`vpx prisma/seed.ts`).
  There is no `db:migrate` or `db:studio`.
- **Tests**:
  - `bun run test` (same as `bun run test:db`): runs `scripts/test-db.ts` —
    reuses or starts disposable Postgres 17 (`docker-compose.test.yml`), runs
    `prisma db update`, then runs `vp test`. Override port
    with `INKSTORY_TEST_POSTGRES_PORT` or
    `bun run test -- --port 55432`; override image with
    `INKSTORY_TEST_POSTGRES_IMAGE=postgres:17`.
  - `bun run test:no-db`: runs non-DB unit tests (`INKSTORY_NO_DB=1 vp test`,
    skipping `DB_TEST_FILES` in `vite.config.ts`).
  - `bun run test:cov`: runs `vp test --coverage` (requires a running local
    test Postgres).
  - `bun run test:e2e`: runs Playwright (`tests/e2e`, sets `NEXT_PUBLIC_E2E=true`).
- **Test DB safety guard**: `tests/setup-env.ts` loads `.env.test` only
  (never `.env` or `.env.local`) and `src/lib/test-database-guard.ts`
  aborts (`INKSTORY_UNSAFE_TEST_DATABASE`) on non-loopback hosts or Supabase
  project refs (`wntgnjrrzfndunqaiobo`, `oobhhexdoufnwdltoren`).

## UI & Accessibility Rules

- Any front-end form input or interactive element that can have the `disabled` state must also have a tool-tip on hover or annotation indicating the reason why.

## Available skills

- [design-md](.agents/skills/design-md/SKILL.md)
- [design-taste-frontend](.agents/skills/design-taste-frontend/SKILL.md)
- [high-end-visual-design](.agents/skills/high-end-visual-design/SKILL.md)
- [impeccable](.agents/skills/impeccable/SKILL.md)
- [inkstory](./.agents/skills/inkstory-conventions/SKILL.md)
- [migrate-to-vinext](.agents/skills/migrate-to-vinext/SKILL.md)
- [prisma-8](.agents/skills/prisma-8/SKILL.md)
- [prisma-composer-core-concepts](.agents/skills/prisma-composer-core-concepts/SKILL.md)
- [prisma-compute](.agents/skills/prisma-compute/SKILL.md)
- [prisma-platform-core-concepts](.agents/skills/prisma-platform-core-concepts/SKILL.md)
- [redesign-existing-projects](.agents/skills/redesign-existing-projects/SKILL.md)
- [stitch-generate-design](.agents/skills/stitch-generate-design/SKILL.md)
- [stitch-loop](.agents/skills/stitch-loop/SKILL.md)
- [supabase](.agents/skills/supabase/SKILL.md)
- [supabase-postgres-best-practices](.agents/skills/supabase-postgres-best-practices/SKILL.md)
- [taste-design](.agents/skills/taste-design/SKILL.md)
- [vitest](.agents/skills/vitest/SKILL.md)

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
