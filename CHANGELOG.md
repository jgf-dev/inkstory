# Changelog

All notable changes to InkStory are tracked here. This file follows [Keep a Changelog](https://keepachangelog.com/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [PR-234](https://github.com/jgf-dev/inkstory/pull/234) - 2026-11-26

### Summary

Made `ensureSystemDefaultPrompts()` safe under concurrent callers (parallel Vitest DB workers and simultaneous production requests) by switching seed inserts to atomic Postgres `ON CONFLICT DO NOTHING` via Prisma 8's `createAndCount(..., { onConflict: "skip", conflictOn: ["id"] })`.

### Fixed

- `src/lib/prompts/service.ts`: extracted `ensureSeedPrompt`, `ensureSeedComponent`, and `ensureSeedLink` helpers using `createAndCount([...], { onConflict: "skip", conflictOn: ["id"] })` so concurrent `ensureSystemDefaultPrompts()` calls against an unseeded database no longer fail with primary-key violations (`23505`), while preserving read-first lookups and self-healing of soft-deleted or disabled rows.

### Added

- `tests/prompts-seed-race.test.ts` and `vite.config.ts`: added a concurrency DB regression test (registered in `DB_TEST_FILES`) using a UUID-scoped fixture seed to verify simultaneous empty-table seeding and concurrent self-healing of soft-deleted/disabled rows.

## [PR-233](https://github.com/jgf-dev/inkstory/pull/233) - 2026-11-26

### Summary

Made Craft Studio's Rewrite target length adapt to the selected passage and active preset (`1×` by default, `0.6×` for `more_concise`), with inline condensing warnings aligned to the preset's suggested length.

### Added

- `tests/craft-rewrite-target.test.ts`: added unit tests covering per-preset adaptive target seeding, floor/ceiling bounds, re-seeding and touched-lock behavior, prototype-key safety, blank-target defaults, and condensing/ceiling warning thresholds.

### Changed

- `src/lib/craft/client.ts`: extended `AdaptiveTargetRule` with `ReadonlyMap`-backed `growthBy` overrides and registered Rewrite (`REWRITE_TARGET_GROWTH = 1`, `REWRITE_CONCISE_TARGET_GROWTH = 0.6`, `REWRITE_MIN_TARGET_WORDS = 20`, `REWRITE_CONDENSE_RATIO = 0.5`); updated `condensingWarning` to compare the ceiling against the growth-adjusted length and clarify warning copy when a preset intentionally shortens prose.
- `tests/craft-panel-dom.test.tsx`: added DOM coverage for Rewrite preset-aware target seeding, selection-clear reset, touched-lock persistence, and condensing warnings.
- `src/lib/craft/README.md`: documented Rewrite's preset-aware adaptive target behavior and added the Rewrite and Show Don't Tell target test suites to the verification list.

## [PR-232](https://github.com/jgf-dev/inkstory/pull/232) - 2026-11-26

### Summary

Expanded Cloudflare Workers observability to export production logs and traces to Sentry alongside New Relic, with query-string redaction, 20% trace sampling, Cloudflare persistence disabled in production, and preview/non-production mode overrides.

### Added

- `cloudflare.config.ts`: exported `resolveObservabilityConfig`, `PRODUCTION_LOG_DESTINATIONS`, and `PRODUCTION_TRACE_DESTINATIONS`, adding Sentry destinations (`sentry` for logs, `sentry-traces` for traces), `invocationLogs: true`, `redactQueryString: true`, `traces.headSamplingRate: 0.2`, and mode/preview isolation so only production exports to external destinations (`persist: false`) while previews and non-production modes persist locally in Cloudflare (`persist: true`, `destinations: []`).
- `tests/cloudflare-config.test.ts`: added unit tests verifying production, preview, and non-production observability configuration resolution.
- `README.md`: documented the Cloudflare Observability destination slugs (`newr`, `sentry`, `sentry-traces`), redaction, sampling, and environment mode override behavior.

## [PR-239](https://github.com/jgf-dev/inkstory/pull/239) - 2026-11-25

### Summary

Added a reliable, isolated live-browser Playwright E2E workflow for both local development and GitHub Actions CI, sharing the loopback-guarded disposable Postgres 17 bootstrap with the Vitest database suite.

### Added

- `scripts/prepare-test-database.ts` and `scripts/test-e2e.ts`: extracted shared `.env.test` loading, loopback DB safety guard enforcement, Docker Compose Postgres 17 startup (via an absolute-path allowlist), and `prisma db update` setup; added the E2E entrypoint that seeds `SYSTEM_DEFAULT` prompts (`prisma/seed.ts`) and launches Playwright.
- `.github/workflows/ci.yml`: added an `e2e` job backed by `ghcr.io/jgf-dev/postgres:17`, Playwright Chromium browser caching (`~/.cache/ms-playwright`), and failure artifact uploads for `playwright-report/` and `test-results/`.
- `package.json`: added `test:e2e:install` (`playwright install chromium`) and routed `test:e2e` / `test:e2e:ui` through `scripts/test-e2e.ts`.

### Changed

- `playwright.config.ts` and `.env.test`: enforced `INKSTORY_E2E_DATABASE_READY=1` and `assertSafeTestDatabaseEnv`, switched to Playwright's bundled Chromium on dedicated port `3100` (`reuseExistingServer: false`, `VINEXT_NO_DEV_LOCK=1`), supplied placeholder `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and explicitly blanked external/secret env vars so local `.env.local` credentials never leak into E2E runs.
- `vite.config.ts`: omitted the Cloudflare Vite plugin only when `command === "serve" && process.env.INKSTORY_E2E === "1"` so local browser E2E uses `vinext`'s Node dev runtime without affecting production builds.
- `scripts/test-db.ts`: refactored to reuse `scripts/prepare-test-database.ts`.
- `prisma/seed.ts`: switched manual env loading to `loadAppDatabaseEnv()` so `.env.local` and `.env` are skipped under `INKSTORY_TEST_ENV=1`.
- `README.md` and `AGENTS.md`: documented the local and CI live-browser E2E workflow, scripts layout, and one-time Chromium installation.

### Fixed

- `src/app/dashboard/_components/OnboardingWizard.tsx`, `src/app/dashboard/codex/_components/CodexManager.tsx`, `tests/e2e/helpers.ts`, `tests/e2e/codex-qa.spec.ts`, and `tests/e2e/launch.spec.ts`: exposed `data-hydrated` on `OnboardingWizard` to prevent lost pre-hydration clicks, added `data-testid="codex-entry-list"` on the Codex entries container, migrated E2E specs to fresh per-test UUID identities (`authenticateAndSeedSample`), and aligned assertions with current onboarding starter-bible fixtures (`Kaelen Ashwright`, `Glass Needles`).

## [PR-230](https://github.com/jgf-dev/inkstory/pull/230) - 2026-11-23

### Summary

Scoped the Prisma 8 Postgres client per request on Cloudflare Workers to prevent warm-isolate `/dashboard` hangs caused by cross-request `pg` socket reuse, while preserving a lazy module singleton outside Workers.

### Added

- `tests/prisma-request-scope.test.ts`: added unit tests (no DB required) covering Workers runtime detection, non-Workers singleton/HMR behavior, per-request client isolation and reuse, `db` proxy forwarding and method binding, post-response `client.close()` scheduling, and missing-scope fallback warnings.

### Fixed

- `src/lib/prisma.ts`: resolved per-request clients on Cloudflare Workers (`isWorkersRuntime()`) via `cacheForRequest` (`vinext/cache`) and scheduled `client.close()` on response completion via `after()` (`vinext/shims/server`); kept a lazily initialized module singleton elsewhere and exposed `db` (and `prisma`) as a typed `Proxy` over `getDbClient()` so existing callers remain unchanged.

### Notes

- **Unified request scope requirement**: `db` should only be accessed inside App Router request scopes (`runWithRequestContext`), not middleware/ExecutionContext-only scopes such as `src/proxy.ts`, where `vinext`'s `after()` runs on the next microtask instead of waiting for response close.
- **Concurrent `after()` callbacks**: `vinext` runs queued `after()` callbacks concurrently once the response body closes, so future routes scheduling `after()` work that queries `db` must coordinate with per-request `client.close()`.
- **Proxy introspection**: `db` forwards `get`, `set`, and `has` traps (`db.orm.public.*` spies continue to work), whereas direct `vi.spyOn(db, ...)` or own-key introspection (`Object.keys(db)`, `{ ...db }`) would require descriptor/key traps.
- **Connection concurrency**: routes fanning out parallel queries (such as `src/app/dashboard/page.tsx` issuing 5 queries in `Promise.all` against a per-request `pg.Pool` when `DIRECT_URL` is preferred over `DATABASE_URL`) approach Workers' 6-outgoing-connection limit; monitor Supabase pool saturation and consider Hyperdrive or concurrency capping as a follow-up.

## [PR-208](https://github.com/jgf-dev/inkstory/pull/208) - 2026-11-22

### Summary

Upgraded Prisma 8 RC packages (`TimestampTemporal(3)` contract migration), hardened GitHub Actions workflows for Bun 1.4.4 and Prisma 8 DB verification/dry-run/update, retired legacy `prisma/schema.prisma` and `prisma-deploy.yml`, added subsystem READMEs, and reconciled repository documentation (including backfilling unlogged releases since 2026-10-19).

### Added

- **Subsystem documentation & generated-file hygiene**:
  - `src/lib/{ai,billing,codex,craft,export,import,prompts,writing}/README.md`: added module maps, public invariants, API route inventories, and test commands for core domain packages.
  - `.gitattributes`: marked emitted Prisma 8 contract and migration artifacts (`prisma/contract.json`, `prisma/contract.d.ts`, `prisma/ops.json`, `prisma/migration.json`, `migrations/snapshots/**`) as `linguist-generated`.
- **Cloudflare Workers & `vinext` runtime** _(backfilled)_:
  - `cloudflare.config.ts`: configured the primary `inkstory` Worker (`vinext/server/fetch-handler`) and auxiliary `inkstory-response-store` cache Worker (`@cloudflare/workers-response-store`, `@vinext/cloudflare`, `nodejs_compat`, `global_fetch_strictly_public`), added `pre.syncodex.xyz` to `TURNSTILE_HOSTNAMES`, and enabled observability log/trace persistence.
  - `package.json`: added `preview`, `deploy`, `deploy:response-store`, `cf-typegen`, `test:no-db`, and `prepare` scripts, plus explicit `@prisma/cli-engine` devDependency for `prisma.config.ts`.
- **Cloudflare Turnstile auth protection** _(backfilled)_:
  - `src/lib/turnstile.ts`, `src/app/_components/TurnstileWidget.tsx`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/signup/route.ts`, `src/app/auth/callback/route.ts`: added fail-closed server-side Turnstile verification on login and signup gated by `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES`, and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `NEXT_PUBLIC_TURNSTILE_KEY`.
- **Stripe billing & plan entitlements ([STO-1180](https://linear.app/jgfdev/issue/STO-1180), [STO-1210](https://linear.app/jgfdev/issue/STO-1210))** _(backfilled)_:
  - `prisma/contract.prisma`: added `PlanTier` (`FREE`, `PRO`, `STUDIO`), `User` billing columns (`stripeCustomerId`, `stripeSubscriptionId`, `planTier`, `subscriptionStatus`, `currentPeriodEnd`), and `StripeWebhookEvent`.
  - `src/lib/stripe.ts`, `src/lib/billing/{plans,entitlements,subscription-sync}.ts`, `src/app/api/billing/{checkout,portal,webhook}/route.ts`, `src/app/_components/PricingTable.tsx`: added tier quotas (`402 QUOTA_EXCEEDED`), Checkout and Billing Portal routes, and idempotent webhook claim/release sync (`STRIPE_SECRET_KEY`,
    `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`, `STRIPE_PRICE_STUDIO_MONTHLY`).
- **BYOK encrypted credentials & capability resolution ([STO-1178](https://linear.app/jgfdev/issue/STO-1178), [STO-1265](https://linear.app/jgfdev/issue/STO-1265))** _(backfilled)_:
  - `prisma/contract.prisma`: added `UserProviderCredential` and `AiProvider` (`OPENROUTER`, `OPENAI`, `ANTHROPIC`, `OLLAMA`, `LMSTUDIO`).
  - `src/lib/ai/credentials/{crypto,host-resolver,service,auth,index}.ts`, `src/app/api/ai/credentials/route.ts`, `src/app/api/ai/credentials/[id]/route.ts`, `src/app/dashboard/settings/_components/ByokCredentialsPanel.tsx`: added AES-256-GCM key storage (`BYOK_ENCRYPTION_KEY`), hint-only DTOs, and Workers-compatible DoH SSRF
    validation (`dns.resolve4`/`dns.resolve6`).
  - `src/lib/ai/execute.ts`, `src/lib/ai/capabilities/*`, `src/app/api/ai/capabilities/route.ts`, `src/app/api/ai/preview/route.ts`: added shared platform/BYOK chat execution (never falling back to platform spend on explicit BYOK failure), prompt preview, and server-resolved advanced controls (`minP`, `avoidanceGuidance`, OpenRouter
    `endpoint`).
- **Prompt templates, portable contracts & Craft Studio ([STO-1158](https://linear.app/jgfdev/issue/STO-1158), [STO-1266](https://linear.app/jgfdev/issue/STO-1266)–[STO-1269](https://linear.app/jgfdev/issue/STO-1269), [STO-1275](https://linear.app/jgfdev/issue/STO-1275))** _(backfilled)_:
  - `prisma/contract.prisma`: added `Prompt`, `PromptComponent`, `PromptComponentLink`, `PromptRole`, and `PromptScope`.
  - `src/lib/prompts/{service,contracts,portable,render,catalog,defaults,errors,types}.ts`, `src/app/api/prompts/**`, `src/app/dashboard/settings/_components/SystemPromptsPanel.tsx`: added layered prompt resolution (`novel active → user default → SYSTEM_DEFAULT`), closed-catalog variable interpolation, versioned pure-data component
    contracts, and portable JSON preview/import/export.
  - `src/lib/craft/{tools,prompt,service,output,client,index}.ts`, `src/app/api/craft/tools/route.ts`, `src/app/api/craft/[tool]/route.ts`, `src/app/dashboard/novels/[id]/_components/CraftPanel.tsx`: added Craft Studio tools (`describe`, `expand`, `rewrite`, `show_dont_tell`, `transition`) with `dryRun` prompt preview and non-destructive results.
- **Codex interchange ([STO-1261](https://linear.app/jgfdev/issue/STO-1261)–[STO-1263](https://linear.app/jgfdev/issue/STO-1263))** _(backfilled)_:
  - `src/lib/codex/interchange/{types,service,card-service,matrix,png,validate,http}.ts`, `src/app/api/codex/interchange/{matrix,lorebook/*,card/*}/route.ts`: added SillyTavern Lorebook and Character Card v2 (JSON/YAML/PNG) preview, import, and export, preserving third-party metadata under
    `CodexEntry.customFields._inkstoryInterchange`.
- **Context assembly & inspection ([STO-1170](https://linear.app/jgfdev/issue/STO-1170), [STO-1171](https://linear.app/jgfdev/issue/STO-1171))** _(backfilled)_:
  - `src/lib/codex/{context-assembler,context-inspection,context-request,budget-segments}.ts`, `src/app/api/context/assemble/route.ts`: added deterministic context assembly (manual attachments → `ALWAYS` → detected mentions → relation expansion → scene progressions) with post-budget token telemetry.
- **TipTap rich-text editing, scene revisions & workspace modes ([STO-1156](https://linear.app/jgfdev/issue/STO-1156), [STO-1214](https://linear.app/jgfdev/issue/STO-1214), [JGF-128](https://linear.app/jgfdev/issue/JGF-128))** _(backfilled)_:
  - `prisma/contract.prisma`: added `Scene.contentDoc`, `Scene.contentFormat` (`ContentFormat`), `Scene.label`, `Scene.subtitle`, `Scene.excludeFromAi`, and `SceneRevision` (`SceneRevisionReason`).
  - `src/lib/writing/{service,tiptap,novel-lock,sibling-reorder,outline-tree,reading-order,draft,meta,word-count}.ts`, `src/app/api/novels/[id]/outline/route.ts`, `src/app/api/scenes/[id]/route.ts`, `src/app/api/scenes/[id]/revisions/**`: added TipTap 3 JSON + plain-text editing, `pg_advisory_xact_lock` structure locking
    (`lockNovelStructure`), autosave/draft recovery, and scene revision snapshots/restore.
  - `src/app/globals.css`, `src/lib/ui/preferences.ts`, `src/app/_components/ThemeToggle.tsx`, `src/app/dashboard/novels/[id]/_components/{WritingWorkspace,RichTextEditor,ModeSwitcher,ProseFontToggle,StatusPill,StageConsolePanel,ArchitectRail,ProgressionTimelineDrawer}.tsx`: added OKLCH "Obsidian Desk" dark theme, prose font toggle,
    and progressive-disclosure Writer / Stage (fixture preview) / Architect operating modes (`NEXT_PUBLIC_INKSTORY_OPERATING_MODES`).
- **Manuscript import & library onboarding ([STO-1211](https://linear.app/jgfdev/issue/STO-1211), [STO-1213](https://linear.app/jgfdev/issue/STO-1213))** _(backfilled)_:
  - `src/lib/import/*`, `src/app/api/books/[id]/import/route.ts`, `src/app/dashboard/novels/[id]/_components/ImportManuscriptDialog.tsx`: added streaming 10 MB-capped `.docx`/`.md`/`.html` import with preview, manual structure overrides, and optional title adoption.
  - `src/lib/library/{service,actions}.ts`, `src/app/dashboard/_components/{LibraryCreator,OnboardingWizard}.tsx`: added quota-enforced novel/series creation and starter bible onboarding.
- **Disposable test database runner & safety guard** _(backfilled)_:
  - `scripts/test-db.ts`, `docker-compose.test.yml`, `.env.test`, `tests/setup-env.ts`, `src/lib/{database-env,test-database-guard,test-database-port}.ts`: added local Postgres 17 test bootstrap and `INKSTORY_UNSAFE_TEST_DATABASE` guard blocking hosted Supabase refs (`INKSTORY_TEST_POSTGRES_PORT`, `INKSTORY_TEST_POSTGRES_IMAGE`,
    `INKSTORY_NO_DB`).

### Changed

- **Prisma 8 RC upgrade & contract regeneration**: bumped `@prisma/orm-postgres` to `8.0.0-rc.24` and `@prisma/cli` / `prisma` to `8.0.0-rc.34`; updated `prisma/contract.prisma` header to `// use prisma-8` and migrated timestamp fields from `Timestamp(3)` to `TimestampTemporal(3)` to preserve the `pg/timestamp-temporal@1` codec; re-emitted `prisma/contract.json` and `prisma/contract.d.ts`.
- **GitHub Actions & tooling**: updated `.github/workflows/{ci,prisma,sonarqube}.yml` to Bun `1.4.4`; added `concurrency`, `permissions: contents: read`, non-mutating `./node_modules/.bin/vp lint`, and `bun run test:no-db` to `ci.yml`; rewrote `.github/workflows/prisma.yml` for manual `verify` / `dry-run` / `update` against `DIRECT_URL` with secret-presence guards; updated `playwright.config.ts` webServer command to `bun run dev`.
- **Documentation & onboarding**: reconciled `README.md`, `AGENTS.md`, `.env.example`, `prisma/seed.ts`, `src/app/api/health/route.ts`, and `src/proxy.ts` with the `vinext` + Cloudflare Workers + Prisma 8 stack and fail-closed Turnstile configuration.
- `vite.config.ts`, `tsconfig.json`, `next-env.d.ts`: configured `vinext` and `@cloudflare/vite-plugin` for build/dev while aliasing `next/*` imports to `vinext/shims/*` under Vitest _(backfilled)_.
- `src/app/api/ai/generate/route.ts`: integrated prompt template resolution, BYOK credential execution, server-resolved capability checks, and plan-tier context token limits _(backfilled)_.
- `src/app/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/dashboard/settings/page.tsx`: updated landing page with pricing, FAQ, and theme toggle; added novel creation/onboarding to `/dashboard` and BYOK/prompt panels to `/dashboard/settings` _(backfilled)_.
- `playwright.config.ts`: added fallback to Playwright's bundled Chromium when `/usr/bin/google-chrome` is absent _(backfilled)_.

### Removed

- Removed legacy `prisma/schema.prisma`, unused `.github/workflows/prisma-deploy.yml`, and stale Prisma 7 `allowScripts` entries in `package.json`.
- Removed `next`, `next.config.ts`, and `vercel.json` following the migration from Next.js/Vercel to `vinext` on Cloudflare Workers _(backfilled)_.

## [PR-124](https://github.com/jgf-dev/inkstory/pull/124) - 2026-10-19

### Summary

Batched act, chapter, and scene queries during reading order loading to eliminate an N+1 database roundtrip waterfall in Codex context assembly and temporal progression resolution.

### Added

- `tests/codex-api.test.ts`: added unit tests verifying batched scene order mapping and empty entity edge cases.

### Fixed

- `src/lib/codex/service.ts`: batched chapter and scene queries in `loadNovelSceneReadingOrder` using `in` filters and in-memory parent position mapping, reducing sequential queries from $O(A + C)$ to at most 3.

## [PR-122](https://github.com/jgf-dev/inkstory/pull/122) - 2026-10-19

### Summary

Gated E2E mock authentication and session refresh bypass behind a `NODE_ENV !== "production"` check.

### Fixed

- `src/lib/supabase/server.ts`: disabled `e2e-user` cookie authentication stub in production environments.
- `src/lib/supabase/middleware.ts`: prevented skipping Supabase session refresh in production when `e2e-user` cookie is present.

## [PR-119](https://github.com/jgf-dev/inkstory/pull/119) - 2026-10-19

### Summary

Refactored nested JSX lists in `CodexEditor` into modular subcomponents and hardened accessibility and title reactivity.

### Added

- `src/app/dashboard/codex/_components/CodexEditorSections.tsx`: modular subcomponents (`CodexAliasesSection`, `CodexTagsSection`, `CodexRelationsSection`, `CodexProgressionsSection`, and child items) with accessible labels and strict typing.
- `tests/codex-editor-sections.test.ts`: component tests verifying rendering, empty states, and accessibility attributes for all section subcomponents.

### Changed

- `src/app/dashboard/codex/_components/CodexEditor.tsx`: replaced nested JSX structures with extracted subcomponents while preserving reactive title updates, scope badges, tracking mode indicator, and test attributes.
- `tests/codex-ui.test.ts`: asserted `data-testid="codex-editor"`, title reactivity, and metadata badges in editor tests.

## [PR-107](https://github.com/jgf-dev/inkstory/pull/107) - 2026-10-19

### Summary

Added manuscript export in Markdown and DOCX formats with reading order resolution and selection filtering ([STO-1163](https://linear.app/jgfdev/issue/STO-1163)).

### Added

- `src/lib/export/`: manuscript export pipeline supporting Markdown and DOCX generation with act, chapter, and scene selection and configurable heading levels.
- `src/app/api/books/[id]/export/route.ts`: ownership-checked export endpoint returning formatted manuscript downloads.
- `tests/export.test.ts`: test suite covering Markdown rendering, DOCX packaging, query batching, and sibling order resolution.

### Fixed

- `src/lib/export/service.ts`: batched chapter and scene queries to eliminate N+1 round trips and aligned sibling ordering with `byPositionThenCreated`.

## [PR-104](https://github.com/jgf-dev/inkstory/pull/104) - 2026-10-19

### Summary

Added scene AI prose generation endpoint powered by Codex context assembly and token budgeting, along with an AI assistant drawer in the novel writing workspace ([STO-1172](https://linear.app/jgfdev/issue/STO-1172/launch-phase-3-scene-ai-generation-and-assistant-drawer)).

### Added

- `src/app/api/ai/generate/route.ts`: `POST /api/ai/generate` endpoint assembling scene context from Codex, formatting prompt blocks with token budgeting, and invoking the AI gateway or returning assembled prompts when unconfigured.
- `src/lib/ai/generate.ts`: Vercel AI Gateway chat completion client, prompt builder (`buildSceneMessages`), generation mode guards, error mappings, and token limits (`MAX_OUTPUT_TOKENS = 4096`).
- `src/lib/codex/prompt-formatter.ts`: XML prompt formatter wrapping assembled story bible entities into `<codex_context><story_bible>`.
- `src/lib/codex/token-budgeter.ts`: token budgeter truncating context entries to fit within prompt token budgets.
- `src/lib/codex/tokens.ts`: approximate token estimation based on character and whitespace counts.
- `src/app/dashboard/novels/[id]/_components/AiAssistantDrawer.tsx`: slide-out AI assistant drawer supporting scene continuation and beat expansion with copy and direct-insert actions.
- `tests/ai-generate.test.ts`, `tests/prompt-formatter.test.ts`, `tests/token-budgeter.test.ts`, `tests/tokens.test.ts`: test suites covering prompt assembly, token budgeting, gateway interactions, error states, and route validation.

### Changed

- `src/app/dashboard/novels/[id]/_components/WritingWorkspace.tsx`: integrated `AiAssistantDrawer` with hotkey toggling and scene insert dispatching.
- `src/app/dashboard/novels/[id]/_components/SceneEditor.tsx`: hooked editor into pending AI prose insertion events.

## [PR-102](https://github.com/jgf-dev/inkstory/pull/102) - 2026-10-19

### Summary

Added interactive relation and progression editor modals, custom fields editor, and reading-order scene selector to the Codex manager and editor UI.

### Added

- `src/app/dashboard/codex/_components/Modal.tsx`: accessible dialog modal with focus trapping and backdrop dismissal.
- `src/app/dashboard/codex/_components/RelationEditorModal.tsx`: modal to create and edit directed Codex entry relationships.
- `src/app/dashboard/codex/_components/ProgressionEditorModal.tsx`: modal to create and edit scene-specific Codex entry progressions with reading-order resolution.
- `tests/codex-ui-dom.test.tsx`: DOM test suite covering modal interactions, relation and progression creation, custom field validation, and manager filters.

### Changed

- `src/app/dashboard/codex/_components/CodexEditor.tsx`: integrated custom fields dynamic editor, relation and progression modal triggers, and inline deletion.
- `src/app/dashboard/codex/_components/CodexManager.tsx`: wired entry selection and update callbacks with the refreshed editor.
- `tests/codex-ui.test.ts`: added test coverage for custom fields and sub-modal component rendering.

## [PR-101](https://github.com/jgf-dev/inkstory/pull/101) - 2026-10-18

### Summary

Added Ollama and LM Studio local BYOK provider adapters with optional API key handling ([STO-1177](https://linear.app/jgfdev/issue/STO-1177/423-local-providers-ollama-lm-studio)).

### Added

- `src/lib/ai/providers/ollama.ts`: Ollama adapter connecting to local Ollama instances (`http://127.0.0.1:11434/v1`) with optional API key authentication.
- `src/lib/ai/providers/lmstudio.ts`: LM Studio adapter connecting to local LM Studio instances (`http://127.0.0.1:1234/v1`) with optional token authentication and bare-string error message handling.
- `src/lib/ai/providers/index.ts`: added `LOCAL_PROVIDERS` and `isLocalProvider` helper for UI key requirement checks.
- `tests/ai-providers.test.ts`: parameterized test suites for Ollama and LM Studio covering local server connection errors, catalog parsing, and auth proxy configurations.

### Changed

- `src/lib/ai/providers/types.ts`: added `ollama` and `lmstudio` to `ProviderId`.
- `src/lib/ai/providers/index.ts`: registered `ollama` and `lmstudio` in `ProviderId`, `SUPPORTED_PROVIDERS`, `ProviderConfig`, and `createProvider`.

## [PR-100](https://github.com/jgf-dev/inkstory/pull/100) - 2026-10-18

### Summary

Added OpenAI and Anthropic BYOK provider adapters and unified shared OpenAI-compatible and HTTP transport clients ([STO-1176](https://linear.app/jgfdev/issue/STO-1176/422-openai-anthropic-adapters)).

### Added

- `src/lib/ai/providers/openai-compatible.ts`: shared client implementing OpenAI Chat Completions and model catalog protocols, used across OpenRouter and OpenAI.
- `src/lib/ai/providers/http.ts`: normalized transport error handling and JSON response parsing with automated API key redaction.
- `src/lib/ai/providers/openai.ts`: OpenAI adapter supporting Chat Completions and `/v1/models` catalog lookups.
- `src/lib/ai/providers/anthropic.ts`: Anthropic adapter mapping chat requests onto the Messages API, supporting top-level system prompts, consecutive-turn merging, and stop reason normalization.
- `tests/ai-providers.test.ts`: test coverage expanded with 47 tests covering OpenAI and Anthropic success paths, message transformation, error mappings, abort handling, and catalog querying.

### Changed

- `src/lib/ai/providers/openrouter.ts`: refactored to delegate OpenAI wire protocol logic to `createOpenAICompatibleProvider`.
- `src/lib/ai/providers/index.ts`: added `openai` and `anthropic` to `ProviderId`, `SUPPORTED_PROVIDERS`, `ProviderConfig`, and `createProvider`.

## [PR-95](https://github.com/jgf-dev/inkstory/pull/95) - 2026-10-18

### Summary

Implemented the BYOK provider layer with a vendor-neutral LLM interface, normalized error model, and OpenRouter adapter ([STO-1175](https://linear.app/jgfdev/issue/STO-1175/421-provider-interface-openrouter-adapter)).

### Added

- `src/lib/ai/providers/types.ts`: vendor-neutral `LlmProvider` interface, chat completion request/result types, token usage normalization, retryable `ProviderError` classification, and `redactSecret` helper to prevent API key leakage.
- `src/lib/ai/providers/openrouter.ts`: OpenRouter adapter supporting OpenAI-compatible chat completions and model catalog querying, attribution headers (`HTTP-Referer`, `X-Title`), handling for 200-with-error bodies, and normalized abort/timeout error handling.
- `src/lib/ai/providers/index.ts`: `createProvider` factory and provider registry supporting configuration-driven provider initialization.
- `tests/ai-providers.test.ts`: test suite covering request serialization, response normalization, catalog parsing, timeout/abort propagation, HTTP status mappings, and API key redaction.

## [Epic 1 — Codex Core] - 2026-09-21

### Summary

Implemented the Story Codex domain service, REST API, Server Actions, interactive UI, mention detection, temporal progressions, and relations expansion engine ([STO-1152](https://linear.app/jgfdev/issue/STO-1152), [STO-1153](https://linear.app/jgfdev/issue/STO-1153), [STO-1154](https://linear.app/jgfdev/issue/STO-1154),
[STO-1168](https://linear.app/jgfdev/issue/STO-1168), [STO-1169](https://linear.app/jgfdev/issue/STO-1169)), and synced operator documentation.

### Added

- **Relations engine ([STO-1154](https://linear.app/jgfdev/issue/STO-1154))**: pure `RelationEngine` (`src/lib/codex/relation-engine.ts`) with BFS discovery, cycle detection, depth limiting (default max depth 2), and deduplication; unit-tested in `tests/relation-engine.test.ts`.
- **Progressions engine ([STO-1153](https://linear.app/jgfdev/issue/STO-1153))**: pure `ProgressionEngine` (`src/lib/codex/progression-engine.ts`) applying scene-linked progressions in Act → Chapter → Scene reading order (`ADDITION` / `REPLACEMENT`), plus `loadNovelSceneReadingOrder` and `resolveCodexEntryAtScene`; unit-tested in
  `tests/progression-engine.test.ts`.
- **Mention detection ([STO-1152](https://linear.app/jgfdev/issue/STO-1152))**: `src/lib/codex/mention-detection.ts` scanning Codex names and aliases with case-insensitive word-boundary matching and longer-match precedence, wired to `scanMentionsInNovel`, `scanMentionsInScene`, `detectMentionsAction`, and `POST /api/codex/mentions`.
- **Codex domain service & Server Actions ([STO-1168](https://linear.app/jgfdev/issue/STO-1168))**: full CRUD, book vs. series scoping enforcement, cross-novel relation/progression validation, and soft/hard delete in `src/lib/codex/service.ts` and `src/lib/codex/actions.ts`.
- **Codex REST routes (`src/app/api/codex/**`)**: CRUD endpoints for entries, aliases, tags, relations, progressions, and mentions.
- **Codex UI (`src/app/dashboard/codex/**`)**: `CodexManager`, `CodexEditor`, and `CodexCreateModal` with real-time search, type filter pills, scoping indicators, and dashboard metrics.
- **Automated tests**: `tests/codex-service.test.ts`, `tests/codex-actions.test.ts`, `tests/codex-api.test.ts`, `tests/codex-ui.test.ts`, plus Playwright E2E QA (`playwright.config.ts`, `tests/e2e/auth.spec.ts`, `tests/e2e/codex-qa.spec.ts`).

### Changed

- `README.md`, `AGENTS.md`: aligned stack, setup, layout, scripts, Codex API table, and troubleshooting docs with Prisma 8, `src/proxy.ts`, and `bun`/`vp` tooling.

### Fixed

- `src/lib/codex/service.ts`: replaced full-table scans on `CodexAlias` and `CodexTag` with `.in(candidateIds)` SQL filtering, enforced strict tenant isolation (`ownerId.eq(userId)`), sanitized `seriesId` inheritance on book-scoped entries, fixed `scanMentionsInScene` offset calculation, unified novel/series entry list payloads, and
  cascaded soft-deletes across child rows.
- `src/app/api/codex/**`: handled `SyntaxError` on malformed JSON bodies as HTTP 400 (`INVALID_JSON`) instead of HTTP 500.

## [a7eb5b6](https://github.com/jgf-dev/inkstory/commit/a7eb5b62b083c213426e2e505500e572049e0e37) - 2026-09-10

### Summary

Implemented complete test coverage across the application using Vitest and Vite+, establishing 37 persistent unit and integration tests and reaching 100% line coverage and 99.25% statement coverage across all application source modules.

### Added

- `tests/api-health.test.ts`: automated tests for `GET /api/health` endpoint, checking 200 HTTP response, payload schema, dynamic flag, and version fallback.
- `tests/supabase-auth.test.ts`: unit and integration tests for `syncAuthUser`, covering validation errors, metadata resolution (`full_name`/`name`, `avatar_url`/`picture`), and database upserts.
- `tests/supabase-clients.test.ts`: tests for `createSupabaseBrowserClient` and `createSupabaseServerClient`, including cookie store adapters and server component error handling.
- `tests/supabase-middleware.test.ts`: tests for session cookie refreshes in `updateSession` and static route filtering in `proxy` middleware matcher.
- `tests/pages.test.ts`: server component and page tests covering `RootLayout`, `HomePage`, `DashboardPage` auth redirects and metrics rendering, and `LoginPage`/`SignupPage` auth gates.
- `tests/auth-components.test.ts`: client component tests for `LoginForm`, `SignupForm`, and `LogoutButton` covering input events, loading states, auth error handling, and redirection.
- Vitest coverage and resolve alias configurations in `vite.config.ts`.

### Fixed

- Added test coverage for database URL parsing edge cases (`[SENSITIVE]`, non-postgres schemes, fallback envs) in `src/lib/prisma.ts`.

## [ecf4397](https://github.com/jgf-dev/inkstory/commit/ecf4397e639905f508bd134a457bfebeda3a08a5) - 2026-09-09

### Summary

Fixed the `oven-sh/setup-bun` GitHub action reference in the CI workflow by updating it to a valid commit SHA matching `v2.2.0`.

### Fixed

- Replaced non-existent commit SHA `4c1f1ad0c1c6b8cd5dc9b4da65fa6e6b1019fd5c` with valid `v2.2.0` commit SHA `0c5077e51419868618aeaa5fe8019c62421857d6` in `.github/workflows/ci.yml`.

## [PR-44](https://github.com/jgf-dev/inkstory/pull/44) - 2026-09-09

### Summary

Synchronized and updated GitHub Actions workflows to align with Node.js 24, Vite+, and Prisma 8 (Prisma Next).

### Added

- Migration triggers for `migrations/**` and `prisma/contract.prisma` in `.github/workflows/prisma.yml`.
- Explicit `prisma contract emit` step before database migration execution in `.github/workflows/prisma.yml`.
- OIDC token exchange and Prisma Compute deployment steps restored in `.github/workflows/prisma-deploy.yml`.

### Removed

- Deprecated `./node_modules/.bin/prisma migrate deploy` Prisma 7 command in `.github/workflows/prisma.yml`.
- Outdated Node.js 22 pin in `.github/workflows/ci.yml`.

### Fixed

- Replaced obsolete `prisma migrate deploy` with Prisma 8 `prisma db migrate` in `.github/workflows/prisma.yml`.
- Standardized Node.js 24 and npm 12 across `.github/workflows/{ci,prisma,prisma-deploy}.yml`.
- Restored truncated GitHub OIDC authentication and Compute deployment steps in `.github/workflows/prisma-deploy.yml`.

## [PR-43](https://github.com/jgf-dev/inkstory/pull/43) - 2026-09-09

### Summary

Full upgrade to Prisma 8 (Prisma Next) and `@prisma/orm-postgres`. Migrated from Prisma 7 schema to Prisma 8 contract-first data contract (`prisma/contract.prisma`), emitted contract artifacts, signed database marker, updated database client singleton and ORM queries across the app, and added an automated test suite.

### Added

- `@prisma/orm-postgres` and `@prisma/cli-engine` runtime and toolchain packages.
- `prisma/contract.prisma` data contract declaring all public models, native enums, and foreign key relations.
- Emitted artifacts `prisma/contract.json` and `prisma/contract.d.ts`.
- `temporal-polyfill` for Temporal representations on timestamp fields.
- `tests/prisma-8.test.ts` persistent integration test suite verifying Prisma 8 ORM queries.
- Package scripts: `contract:emit`, `db:verify`, `db:sign`, `db:update`, and `test`.

### Removed

- `@prisma/client` and `@prisma/adapter-pg` Prisma 7 dependencies.
- Deprecated Prisma 7 CLI scripts (`prisma generate`, `prisma db push`).

### Fixed

- Resolved `[CLI.CONFIG_MISSING_MARKER]` error during `prisma skills sync`.
- Replaced legacy `@prisma/client` queries in `src/lib/supabase/auth.ts`, `src/app/dashboard/page.tsx`, and `prisma/seed.ts` with Prisma 8 `db.orm.public.*` query API.

## [STO-1167](https://linear.app/jgfdev/issue/STO-1167) — Codex Database Schema

### Summary

Implemented the database schema for the Codex system (Epic 1 / [STO-1167](https://linear.app/jgfdev/issue/STO-1167)), introducing entities for story bible entries, aliases, tags, directed graph relations, and scene-linked temporal progressions.

### Added

- Prisma models: `CodexEntry`, `CodexAlias`, `CodexTag`, `CodexRelation`, and `CodexProgression`.
- Enums: `CodexType`, `CodexTrackingMode`, `ProgressionMode`.
- Extended seed script (`prisma/seed.ts`) with demo Codex fixtures (Mara Vance, Master Corvus, Sunken Archives, Glass Weaver's Quill, The Great Fracture lore, relations, and scene progression).

## [PR-42](https://github.com/jgf-dev/inkstory/pull/42) - 2026-08-22

### Summary

Fixed failing Prisma Compute Deploy check by regenerating and syncing `package-lock.json` with updated Prisma 7 dependencies and formatted settings.

### Fixed

- Re-synchronized `package-lock.json` so that `npm ci` succeeds during Prisma Compute deployment without missing dependency errors.
- Formatted `.vscode/settings.json` with Prettier.

## [8b2c604](https://github.com/jgf-dev/inkstory/commit/8b2c604) - 2026-08-10

### Summary

Fixed `db:push`, `db:migrate`, and `db:seed` hanging indefinitely. Root cause: Supabase's transaction pooler (port 6543) blocks DDL; the direct DB hostname resolves IPv6-only (unreachable on this network); and the seed process never exited due to an undrained `pg.Pool`.

### Added

- `dotenv-cli` dev dependency (used in `db:push`/`db:migrate` scripts to extract `DIRECT_URL`).

### Fixed

- `db:push` / `db:migrate`: routed through Supabase **session pooler** (port 5432, IPv4, DDL-safe) via `--url $(dotenv -p DIRECT_URL)`.
- `prisma.config.ts`: removed invalid `directUrl` field (not in Prisma 7's `Datasource` type).
- `prisma/seed.ts`: explicit `pg.Pool` creation + `pool.end()` in `finally` block so process exits; added dotenv loading so env vars are available when run directly.
- `.env`: updated `DIRECT_URL` from unreachable IPv6 direct host to IPv4 session pooler URL.

## [dc4b09f](https://github.com/jgf-dev/inkstory/commit/dc4b09f) - 2026-08-09

### Summary

Fixed `next build` type error caused by Prisma 7 removing `datasourceUrl` from `PrismaClient` constructor. Migrated to `PrismaPg` driver adapter pattern and loaded `.env.local` in `prisma.config.ts`.

### Added

- `@prisma/adapter-pg`, `pg`, `@types/pg` dependencies for driver adapter pattern.

### Fixed

- TypeScript error `Type 'string' is not assignable to type 'never'` on `datasourceUrl`.
- `db:migrate` / `db:push` error `datasource.url property is required` by loading dotenv in `prisma.config.ts`.

## [e092919](https://github.com/jgf-dev/inkstory/commit/e092919) - 2026-08-09

### Summary

Initialized the InkStory application scaffold with Supabase Auth, hierarchical story schema, dashboard, seed script, and CI, and migrated to Prisma 7 `prisma.config.ts` to fix `P1012`.

### Added

- `prisma.config.ts`, Supabase `@supabase/ssr` browser/server/middleware clients, and core models (`User`, `Series`, `Novel`, `Act`, `Chapter`, `Scene`, `Pov`, `Tense`).
- Email/password signup and login pages, authed dashboard mirroring Supabase auth users into `users`, idempotent seed script (`prisma/seed.ts`), and `GET /api/health` liveness probe.
- GitHub Actions CI, `README.md`, and `.env.example`.

### Fixed

- Resolved `P1012` (`The datasource property url is no longer supported in schema files`) by removing `url = env("DATABASE_URL")` from `prisma/schema.prisma`.
