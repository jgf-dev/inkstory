# Changelog

All notable changes to InkStory are tracked here. This file follows [Keep a Changelog](https://keepachangelog.com/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased] - 2026-11-21

### Summary

Migrated InkStory from Next.js/Vercel to `vinext` on Cloudflare Workers and added Turnstile-gated authentication, Stripe billing and entitlements, encrypted BYOK credentials with server-resolved capabilities, Craft Studio, portable prompt contracts, SillyTavern Codex interchange, TipTap rich-text editing with scene revisions,
manuscript import, and Obsidian Desk theming with workspace operating modes.

### Added

- **Cloudflare Workers & `vinext` runtime**:
  - `cloudflare.config.ts`: configured the primary `inkstory` Worker (`vinext/server/fetch-handler`) and auxiliary `inkstory-response-store` cache Worker (`@cloudflare/workers-response-store`, `@vinext/cloudflare`, `nodejs_compat`, `global_fetch_strictly_public`).
  - `package.json`: added `preview`, `deploy`, `deploy:response-store`, `cf-typegen`, `test:no-db`, and `prepare` scripts.
- **Cloudflare Turnstile auth protection**:
  - `src/lib/turnstile.ts`, `src/app/_components/TurnstileWidget.tsx`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/signup/route.ts`: added fail-closed server-side Turnstile verification on login and signup gated by `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES`, and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `NEXT_PUBLIC_TURNSTILE_KEY`.
- **Stripe billing & plan entitlements ([STO-1180](https://linear.app/jgfdev/issue/STO-1180), [STO-1210](https://linear.app/jgfdev/issue/STO-1210))**:
  - `prisma/contract.prisma`: added `PlanTier` (`FREE`, `PRO`, `STUDIO`), `User` billing columns (`stripeCustomerId`, `stripeSubscriptionId`, `planTier`, `subscriptionStatus`, `currentPeriodEnd`), and `StripeWebhookEvent`.
  - `src/lib/stripe.ts`, `src/lib/billing/{plans,entitlements,subscription-sync}.ts`, `src/app/api/billing/{checkout,portal,webhook}/route.ts`, `src/app/_components/PricingTable.tsx`: added tier quotas (`402 QUOTA_EXCEEDED`), Checkout and Billing Portal routes, and idempotent webhook claim/release sync (`STRIPE_SECRET_KEY`,
    `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`, `STRIPE_PRICE_STUDIO_MONTHLY`).
- **BYOK encrypted credentials & capability resolution ([STO-1178](https://linear.app/jgfdev/issue/STO-1178), [STO-1265](https://linear.app/jgfdev/issue/STO-1265))**:
  - `prisma/contract.prisma`: added `UserProviderCredential` and `AiProvider` (`OPENROUTER`, `OPENAI`, `ANTHROPIC`, `OLLAMA`, `LMSTUDIO`).
  - `src/lib/ai/credentials/{crypto,host-resolver,service,auth,index}.ts`, `src/app/api/ai/credentials/route.ts`, `src/app/api/ai/credentials/[id]/route.ts`, `src/app/dashboard/settings/_components/ByokCredentialsPanel.tsx`: added AES-256-GCM key storage (`BYOK_ENCRYPTION_KEY`), hint-only DTOs, and Workers-compatible DoH SSRF
    validation (`dns.resolve4`/`dns.resolve6`).
  - `src/lib/ai/execute.ts`, `src/lib/ai/capabilities/*`, `src/app/api/ai/capabilities/route.ts`, `src/app/api/ai/preview/route.ts`: added shared platform/BYOK chat execution (never falling back to platform spend on explicit BYOK failure), prompt preview, and server-resolved advanced controls (`minP`, `avoidanceGuidance`, OpenRouter
    `endpoint`).
- **Prompt templates, portable contracts & Craft Studio ([STO-1158](https://linear.app/jgfdev/issue/STO-1158), [STO-1266](https://linear.app/jgfdev/issue/STO-1266)–[STO-1269](https://linear.app/jgfdev/issue/STO-1269), [STO-1275](https://linear.app/jgfdev/issue/STO-1275))**:
  - `prisma/contract.prisma`: added `Prompt`, `PromptComponent`, `PromptComponentLink`, `PromptRole`, and `PromptScope`.
  - `src/lib/prompts/{service,contracts,portable,render,catalog,defaults,errors,types}.ts`, `src/app/api/prompts/**`, `src/app/dashboard/settings/_components/SystemPromptsPanel.tsx`: added layered prompt resolution (`novel active → user default → SYSTEM_DEFAULT`), closed-catalog variable interpolation, versioned pure-data component
    contracts, and portable JSON preview/import/export.
  - `src/lib/craft/{tools,prompt,service,index}.ts`, `src/app/api/craft/tools/route.ts`, `src/app/api/craft/[tool]/route.ts`: added Craft Studio tools (`describe`, `expand`, `rewrite`) with `dryRun` prompt preview and non-destructive results.
- **Codex interchange ([STO-1261](https://linear.app/jgfdev/issue/STO-1261)–[STO-1263](https://linear.app/jgfdev/issue/STO-1263))**:
  - `src/lib/codex/interchange/{types,service,card-service,matrix,png,validate,http}.ts`, `src/app/api/codex/interchange/{matrix,lorebook/*,card/*}/route.ts`: added SillyTavern Lorebook and Character Card v2 (JSON/YAML/PNG) preview, import, and export, preserving third-party metadata under
    `CodexEntry.customFields._inkstoryInterchange`.
- **Context assembly & inspection ([STO-1170](https://linear.app/jgfdev/issue/STO-1170), [STO-1171](https://linear.app/jgfdev/issue/STO-1171))**:
  - `src/lib/codex/{context-assembler,context-inspection,context-request,budget-segments}.ts`, `src/app/api/context/assemble/route.ts`: added deterministic context assembly (manual attachments → `ALWAYS` → detected mentions → relation expansion → scene progressions) with post-budget token telemetry.
- **TipTap rich-text editing, scene revisions & workspace modes ([STO-1156](https://linear.app/jgfdev/issue/STO-1156), [STO-1214](https://linear.app/jgfdev/issue/STO-1214), [JGF-128](https://linear.app/jgfdev/issue/JGF-128))**:
  - `prisma/contract.prisma`: added `Scene.contentDoc`, `Scene.contentFormat` (`ContentFormat`), `Scene.label`, `Scene.subtitle`, `Scene.excludeFromAi`, and `SceneRevision` (`SceneRevisionReason`).
  - `src/lib/writing/{service,tiptap,novel-lock,sibling-reorder,outline-tree,reading-order,draft,meta,word-count}.ts`, `src/app/api/novels/[id]/outline/route.ts`, `src/app/api/scenes/[id]/route.ts`, `src/app/api/scenes/[id]/revisions/**`: added TipTap 3 JSON + plain-text editing, `pg_advisory_xact_lock` structure locking
    (`lockNovelStructure`), autosave/draft recovery, and scene revision snapshots/restore.
  - `src/app/globals.css`, `src/lib/ui/preferences.ts`, `src/app/_components/ThemeToggle.tsx`, `src/app/dashboard/novels/[id]/_components/{WritingWorkspace,RichTextEditor,ModeSwitcher,ProseFontToggle,StatusPill,StageConsolePanel,ArchitectRail,ProgressionTimelineDrawer}.tsx`: added OKLCH "Obsidian Desk" dark theme, prose font toggle,
    and progressive-disclosure Writer / Stage (fixture preview) / Architect operating modes (`NEXT_PUBLIC_INKSTORY_OPERATING_MODES`).
- **Manuscript import & library onboarding ([STO-1211](https://linear.app/jgfdev/issue/STO-1211), [STO-1213](https://linear.app/jgfdev/issue/STO-1213))**:
  - `src/lib/import/*`, `src/app/api/books/[id]/import/route.ts`, `src/app/dashboard/novels/[id]/_components/ImportManuscriptDialog.tsx`: added streaming 10 MB-capped `.docx`/`.md`/`.html` import with preview, manual structure overrides, and optional title adoption.
  - `src/lib/library/{service,actions}.ts`, `src/app/dashboard/_components/{LibraryCreator,OnboardingWizard}.tsx`: added quota-enforced novel/series creation and starter bible onboarding.
- **Disposable test database runner & safety guard**:
  - `scripts/test-db.ts`, `docker-compose.test.yml`, `.env.test`, `tests/setup-env.ts`, `src/lib/{database-env,test-database-guard,test-database-port}.ts`: added local Postgres 17 test bootstrap and `INKSTORY_UNSAFE_TEST_DATABASE` guard blocking hosted Supabase refs (`INKSTORY_TEST_POSTGRES_PORT`, `INKSTORY_TEST_POSTGRES_IMAGE`,
    `INKSTORY_NO_DB`).

### Changed

- `vite.config.ts`, `tsconfig.json`, `next-env.d.ts`: configured `vinext` and `@cloudflare/vite-plugin` for build/dev while aliasing `next/*` imports to `vinext/shims/*` under Vitest.
- `src/app/api/ai/generate/route.ts`: integrated prompt template resolution, BYOK credential execution, server-resolved capability checks, and plan-tier context token limits.
- `src/app/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/dashboard/settings/page.tsx`: updated landing page with pricing, FAQ, and theme toggle; added novel creation/onboarding to `/dashboard` and BYOK/prompt panels to `/dashboard/settings`.
- `playwright.config.ts`: added fallback to Playwright's bundled Chromium when `/usr/bin/google-chrome` is absent.

### Removed

- Removed `next`, `next.config.ts`, and `vercel.json` following the migration from Next.js/Vercel to `vinext` on Cloudflare Workers.

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
