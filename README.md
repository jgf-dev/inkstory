# InkStory

A novel-writing and world-building platform with an AI-aware Story Codex (story bible).

Linear project: [novel-writing-app](https://linear.app/jgfdev/project/novel-writing-app-3c3f658f0d44).

## Stack

| Layer               | Choice                                                 | Details                                                                                                                                    |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Framework & Hosting | `vinext` (`^1.4.4`) + React 19 on Cloudflare Workers   | App Router served via Vite+ & `cloudflare.config.ts` (`inkstory` + `inkstory-response-store` cache worker); `src/proxy.ts` session refresh |
| Language            | TypeScript (strict)                                    | Type-checked via Vite+ (`vp check`)                                                                                                        |
| Database            | Supabase Postgres 17                                   | Prisma 8 talks to DDL via `DIRECT_URL` (port 5432) and runtime via `DATABASE_URL` (port 6543)                                              |
| ORM                 | Prisma 8 (Prisma Next, contract-first)                 | `prisma/contract.prisma` (source of truth) + `@prisma/orm-postgres` (`db.orm.public.*`) + `temporal-polyfill`                              |
| Auth & Anti-Abuse   | Supabase Auth (`@supabase/ssr`) + Cloudflare Turnstile | Cookie sessions refreshed in `src/proxy.ts`; login/signup verify Turnstile tokens server-side (fail-closed)                                |
| Editor & Styling    | TipTap 3 + Tailwind CSS 4                              | Rich-text JSON + plain-text extract; OKLCH "Parchment Desk" (light) / "Obsidian Desk" (dark) CSS token ramp                                |
| AI, BYOK & Craft    | Vercel AI Gateway + 5 BYOK providers                   | OpenRouter, OpenAI, Anthropic, Ollama, LM Studio (AES-256-GCM credentials, server-resolved capabilities, Craft Studio tools)               |
| Billing             | Stripe                                                 | `FREE` / `PRO` / `STUDIO` tiers with quota enforcement and idempotent webhook processing                                                   |
| Tooling             | Bun (`1.4.4`) + Vite+ (`vp`) + Playwright              | `bun.lock` is canonical; lint/format/typecheck/build/Vitest via `vp`                                                                       |

## What's implemented

- **Auth & Accounts**: Email/password signup and login gated by Cloudflare Turnstile, Supabase cookie sessions, and automatic sync into `public.users`.
- **Library & Writing Desk (`/dashboard`, `/dashboard/novels/[id]`)**: Series/novel creation, onboarding starter bible, hierarchical outliner (`Act → Chapter → Scene`) with advisory-locked concurrent ordering (`pg_advisory_xact_lock`), TipTap 3 scene editor with debounced autosave, localStorage draft recovery, scene revision
  snapshots & restore, and three operating modes (`Writer`, `Stage` [fixture preview], `Architect`).
- **Story Codex & Context Assembly (`/dashboard/codex`, `/api/context/assemble`)**: Book- and series-scoped entries, aliases, tags, directed relations (`RelationEngine` BFS with cycle detection), scene-ordered temporal progressions (`ProgressionEngine`), word-boundary mention detection, deterministic context assembly, token
  budgeting (`TokenBudgetBar`), and `<codex_context>` XML prompt formatting.
- **Codex Interchange APIs (`/api/codex/interchange/*`)**: Preview, import, and export for SillyTavern Lorebooks and Character Card v2 (JSON/YAML/PNG), preserving third-party metadata under `CodexEntry.customFields._inkstoryInterchange`. _(Import/export UI dialog is not yet wired into `CodexManager`.)_
- **AI Generation, BYOK, Prompts & Craft Studio (`/dashboard/settings`, `/api/ai/*`, `/api/prompts/*`, `/api/craft/*`)**: Scene continuation and beat expansion with zero-spend prompt-builder fallback when unconfigured; encrypted BYOK credentials (`UserProviderCredential`) for OpenRouter, OpenAI, Anthropic, Ollama, and LM Studio;
  server-resolved model capabilities (`minP`, `avoidanceGuidance`, OpenRouter endpoint pinning); reusable prompt templates & portable versioned contracts; Craft Studio tools (`describe`, `expand`, `rewrite`).
- **Manuscript Import & Export (`/api/books/[id]/{import,export}`)**: 10 MB streaming `.docx`/`.md`/`.html` import with preview, structure override, and title adoption; Markdown and DOCX manuscript export.
- **Stripe Billing (`/api/billing/*`)**: Free (1 novel, 30 codex entries, 4k context tokens), Author Pro ($15/mo or $144/yr, unlimited, 6k tokens), and Studio ($35/mo, unlimited, 6k tokens, series sharing) enforced with `402 QUOTA_EXCEEDED`.

### In progress / partial UI parity

- **Stage Mode**: Enactment console currently runs typed static fixtures (`src/lib/stage/fixtures.ts`); multi-agent backend is not wired yet.
- **Craft Studio**: `describe`, `expand`, and `rewrite` are registered; remaining v1 tools (`show_dont_tell`, `transition`, `brainstorm`) are pending.
- **Codex Interchange & Prompts UI**: Backend APIs are complete; `CodexManager` does not yet expose an interchange dialog, and `/dashboard/settings` currently only duplicates `SYSTEM_DEFAULT` prompts (no full prompt/component editor).

## Local setup

### 1. Install dependencies

Use **Bun** (`bun.lock` is canonical; avoid `npm install` or `vp install`):

```bash
bun install
```

`postinstall` runs `prisma contract emit`. If you installed with `--ignore-scripts` (as CI does), emit the contract manually:

```bash
bun run contract:emit
```

### 2. Configure Supabase & environment variables

1. Create a project at <https://supabase.com/dashboard>.
2. In **Settings → Database**, copy:

- **Session pooler** URL (port **5432**, IPv4, DDL-safe) → `DIRECT_URL`
- **Transaction pooler** URL (port **6543**) → `DATABASE_URL`

3. In **Settings → API**, copy:

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **Publishable / anon key** → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- **Service role key** → `SUPABASE_SERVICE_ROLE_KEY` _(server-only; never expose to the browser)_

4. Copy `.env.example` to `.env.local` and fill in the Supabase values.

`prisma.config.ts` loads `.env.local` then `.env` (skipped under Vitest) and prefers `DIRECT_URL`, then `DATABASE_URL`.

### 3. Configure Cloudflare Turnstile (required for login & signup)

`POST /api/auth/login` and `POST /api/auth/signup` verify Turnstile tokens server-side and **fail closed with HTTP 403** if `TURNSTILE_SECRET` or `TURNSTILE_HOSTNAMES` is empty.

In `.env.local`, set:

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` (from your Cloudflare Turnstile widget or Cloudflare's official Turnstile testing keys for local development)
- `TURNSTILE_HOSTNAMES="localhost,127.0.0.1"` _(local dev only — never allow localhost in production)_

> **Optional services:** Leaving `AI_GATEWAY_API_KEY`, `BYOK_ENCRYPTION_KEY`, and `STRIPE_*` empty is safe for local development: AI generation returns `503 AI_NOT_CONFIGURED` with the copyable assembled prompt, and billing routes return `503 BILLING_NOT_CONFIGURED`.

### 4. Initialize the database

Prisma 8 is contract-first (`prisma/contract.prisma`). There is no `db:migrate` or `db:studio` script.

```bash
bun run db:update   # apply prisma/contract.prisma to the database (uses DIRECT_URL)
bun run db:seed     # optional: demo series, novel, Codex entries, and system prompts
```

Related commands: `bun run contract:emit`, `bun run db:verify`, `bun run db:sign`.

### 5. Start the dev server

```bash
bun run dev
```

Visit <http://localhost:3000>, sign up, and explore `/dashboard`, `/dashboard/codex`, `/dashboard/novels/[id]`, and `/dashboard/settings`.

## Cloudflare Workers deployment

`cloudflare.config.ts` defines the primary `inkstory` Worker (`vinext/server/fetch-handler`) and the auxiliary `inkstory-response-store` cache Worker (`compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"]`).

```bash
bun run build                   # Vite+ production build
bun run preview                 # local production preview
bun run deploy:response-store   # deploy auxiliary cache Worker
bun run deploy                  # deploy primary app via vinext-cloudflare
bun run cf-typegen              # regenerate .cloudflare/types
```

Store all secrets (`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BYOK_ENCRYPTION_KEY`, `AI_GATEWAY_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TURNSTILE_SECRET`) as Cloudflare Worker secrets — never in plaintext `cloudflare.config.ts` bindings or `NEXT_PUBLIC_*` variables.

## Project layout

```text
cloudflare.config.ts              # Cloudflare Workers + response-store config
vite.config.ts                    # Vite+ / vinext / Vitest / Oxlint / Oxfmt config
prisma.config.ts                  # Prisma 8 contract & DB connection config
prisma/
├── contract.prisma               # Prisma 8 data contract (17 models, 11 enums — source of truth)
├── contract.json / contract.d.ts # Emitted contract artifacts
├── schema.prisma                 # Legacy Prisma 7 schema (unused at runtime; ignore)
└── seed.ts                       # Demo fixtures + SYSTEM_DEFAULT prompts
scripts/
└── test-db.ts                    # Disposable Postgres 17 + Prisma update + Vitest runner
src/
├── proxy.ts                      # Supabase session refresh boundary (not middleware.ts)
├── app/
│   ├── page.tsx / layout.tsx / globals.css
│   ├── login/ / signup/
│   ├── dashboard/
│   │   ├── page.tsx              # Library metrics, LibraryCreator, OnboardingWizard
│   │   ├── codex/                # CodexManager, CodexEditor, relation/progression modals
│   │   ├── novels/[id]/          # WritingWorkspace (Writer/Stage/Architect), TipTap SceneEditor, AI drawer
│   │   └── settings/             # BYOK credentials & system prompt duplication
│   └── api/                      # 46 route handlers (health, auth, codex, context, ai, craft, prompts, books, novels, scenes, billing)
└── lib/
 ├── prisma.ts                 # Prisma 8 client singleton (`db.orm.public.*`)
 ├── database-env.ts           # Non-test `.env.local`/`.env` loader
 ├── test-database-guard.ts    # Blocks tests from touching hosted Supabase DBs
 ├── turnstile.ts              # Server-side Cloudflare Turnstile verification
 ├── stripe.ts                 # Lazy Stripe SDK client
 ├── supabase/                 # Browser/server/middleware clients + syncAuthUser
 ├── library/                  # Novel/series creation + starter bible onboarding
 ├── writing/                  # Outline tree, TipTap helpers, scene revisions, advisory lock
 ├── codex/                    # Domain service, actions, errors, engines, context assembler, interchange/
 ├── ai/                       # Gateway generation, shared execution, providers/, credentials/, capabilities/
 ├── prompts/                  # Prompt templates, variable interpolation, portable contracts
 ├── craft/                    # Craft Studio registry (`describe`, `expand`, `rewrite`)
 ├── import/ / export/         # Manuscript `.docx`/`.md`/`.html` import and MD/DOCX export
 ├── billing/                  # Plan limits, quota guards, Stripe subscription sync
 ├── stage/                    # Stage mode fixture rehearsal beats
 └── ui/                       # Theme/font/mode preferences & shared UI helpers
tests/                            # Vitest unit/integration suites + tests/e2e/ Playwright specs
```

## Story Codex & core engines

Hierarchical story model: `User → Series → Novel → Act → Chapter → Scene (→ SceneRevision)`.

Codex entries represent story-bible elements (`CHARACTER`, `LOCATION`, `ITEM`, `LORE`, `FACTION`, `CONCEPT`, `OTHER`) scoped to either a single novel or an entire series, with tracking modes `ALWAYS`, `DETECTED`, or `NEVER` and soft-delete (`deletedAt`; pass `?hard=true` to hard-delete).

| Concern                          | Module                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Domain service & context loading | `src/lib/codex/service.ts` (CRUD, mentions, `resolveCodexEntryAtScene`, `assembleCodexContextForScene`)   |
| Server Actions                   | `src/lib/codex/actions.ts` (`{ success: true, data }` \| `{ success: false, error, code, status }`)       |
| Error contract                   | `src/lib/codex/errors.ts` (`CodexError`, `handleCodexApiError`)                                           |
| Mention detection                | `src/lib/codex/mention-detection.ts` — case-insensitive, word-boundary, longer-match wins                 |
| Temporal progressions            | `src/lib/codex/progression-engine.ts` — Act → Chapter → Scene reading order; `ADDITION` / `REPLACEMENT`   |
| Relations graph                  | `src/lib/codex/relation-engine.ts` — pure BFS expansion, cycle detection, depth limit (default 2), dedupe |
| Context assembly & budgeting     | `src/lib/codex/context-assembler.ts`, `token-budgeter.ts`, `prompt-formatter.ts`, `budget-segments.ts`    |
| Third-party interchange          | `src/lib/codex/interchange/*` — SillyTavern Lorebook & Character Card v2 PNG/JSON                         |

## REST API overview

All routes except `/api/health`, `/api/auth/*`, and `/api/billing/webhook` require an authenticated Supabase session cookie (returning `401` otherwise).

### Health & Auth

| Method | Path               | Role                                                           |
| ------ | ------------------ | -------------------------------------------------------------- |
| `GET`  | `/api/health`      | Liveness `{ status, service, version, time }` (no DB required) |
| `POST` | `/api/auth/login`  | Turnstile-verified email/password sign-in                      |
| `POST` | `/api/auth/signup` | Turnstile-verified email/password sign-up                      |

### Writing, Scenes & Manuscript Import/Export

| Method                        | Path                                              | Role                                                                                                    |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET`/`POST`/`PATCH`/`DELETE` | `/api/novels/[id]/outline`                        | Read, create, rename/reorder (advisory-locked), or delete Act/Chapter/Scene nodes                       |
| `GET`/`PATCH`                 | `/api/scenes/[id]`                                | Read scene for editor; autosave prose/TipTap doc/metadata (recomputes word count)                       |
| `GET`/`POST`                  | `/api/scenes/[id]/revisions`                      | List revisions or create a `MANUAL` checkpoint                                                          |
| `POST`                        | `/api/scenes/[id]/revisions/[revisionId]/restore` | Snapshot live scene (`RESTORE`) and restore revision                                                    |
| `POST`                        | `/api/books/[id]/import`                          | Multipart `.docx`/`.md`/`.html` preview or confirm (`confirm=true`, optional `structure`, `applyTitle`) |
| `GET`                         | `/api/books/[id]/export`                          | Download manuscript as Markdown (`format=md`) or DOCX (`format=docx`)                                   |

### Story Codex, Context & Interchange

| Method                    | Path                                                         | Role                                                          |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| `GET`/`POST`              | `/api/codex/entries`                                         | List (`novelId` \| `seriesId`, filters) or create Codex entry |
| `GET`/`PATCH`/`DELETE`    | `/api/codex/entries/[id]`                                    | Read, update, or delete (`?hard=true`) entry                  |
| `POST` / `DELETE`         | `/api/codex/entries/[id]/aliases`, `/api/codex/aliases/[id]` | Add / remove alias                                            |
| `POST` / `DELETE`         | `/api/codex/entries/[id]/tags`, `/api/codex/tags/[id]`       | Add / remove tag                                              |
| `POST` / `PATCH`/`DELETE` | `/api/codex/relations`, `/api/codex/relations/[id]`          | Manage directed relations                                     |
| `POST` / `PATCH`/`DELETE` | `/api/codex/progressions`, `/api/codex/progressions/[id]`    | Manage scene-linked progressions                              |
| `POST`                    | `/api/codex/mentions`                                        | Detect Codex mentions in `{ text, novelId? \| sceneId? }`     |
| `POST`                    | `/api/context/assemble`                                      | Assemble & inspect token-budgeted Codex context for a scene   |
| `GET`                     | `/api/codex/interchange/matrix`                              | V1 interchange support matrix & policy                        |
| `POST`                    | `/api/codex/interchange/lorebook/{preview,import,export}`    | SillyTavern Lorebook preview / import / export                |
| `POST`                    | `/api/codex/interchange/card/{preview,import,export}`        | Character Card v2 (JSON/YAML/PNG) preview / import / export   |

### AI, BYOK, Craft Studio, Prompts & Billing

| Method                                         | Path                                                                               | Role                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `POST`                                         | `/api/ai/generate`                                                                 | Generate continuation or beat expansion (platform gateway or explicit BYOK)            |
| `POST`                                         | `/api/ai/preview`                                                                  | Render exact `messages[]` without calling a provider                                   |
| `GET`                                          | `/api/ai/capabilities`                                                             | Server-resolved advanced control capabilities for platform or BYOK route               |
| `GET`/`PUT` / `GET`/`PATCH`/`DELETE`           | `/api/ai/credentials`, `/api/ai/credentials/[id]`                                  | Manage encrypted BYOK provider credentials (key hints only; never exposes secrets)     |
| `GET` / `POST`                                 | `/api/craft/tools`, `/api/craft/[tool]`                                            | List Craft Studio tools and run `describe`, `expand`, or `rewrite` (supports `dryRun`) |
| `GET`/`POST` / `GET`/`PATCH`/`DELETE` / `POST` | `/api/prompts`, `/api/prompts/[id]`, `/api/prompts/[id]/duplicate`                 | Manage prompt templates and duplicate read-only `SYSTEM_DEFAULT` rows                  |
| `GET`/`POST` / `PATCH`/`DELETE`                | `/api/prompts/components`, `/api/prompts/components/[id]`                          | Manage reusable prompt components and contracts                                        |
| `GET` / `POST`                                 | `/api/prompts/components/[id]/export`, `/api/prompts/components/import{,/preview}` | Export, preview, and import portable prompt component JSON                             |
| `POST`                                         | `/api/billing/{checkout,portal,webhook}`                                           | Stripe Checkout session, Billing Portal session, and signed webhook handler            |

Standard error payload: `{ error, code }`. Codex/domain error codes include `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_FAILED`, `SCOPING_ERROR`, `CONFLICT`, `QUOTA_EXCEEDED` (402), `CONTEXT_ASSEMBLY_FAILED` (422), and `INVALID_JSON` (400).

## Scripts

| Script                                        | Purpose                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `bun run dev`                                 | Start Vite+ / `vinext` dev server on port 3000 (`vp dev --port 3000`)                  |
| `bun run build` / `preview` / `start`         | Production build and local preview (`vp build` / `vp preview`)                         |
| `bun run deploy` / `deploy:response-store`    | Deploy primary app (`vinext-cloudflare deploy`) and cache Worker                       |
| `bun run cf-typegen`                          | Generate Cloudflare Workers TypeScript definitions (`cf workers types`)                |
| `bun run lint`                                | Type-aware oxlint with autofix (`vp lint --fix`)                                       |
| `bun run format` / `format:check`             | Format / check formatting (`vp fmt`)                                                   |
| `bun run typecheck`                           | Type-check (`vp check --no-fmt --no-lint`)                                             |
| `bun run test` / `test:db`                    | Start or reuse disposable local Postgres 17, apply contract, run full Vitest suite     |
| `bun run test:no-db`                          | Fast unit-only Vitest run (`INKSTORY_NO_DB=1 vp test`, skipping DB integration suites) |
| `bun run test:cov`                            | Vitest with V8 coverage (requires a running local test Postgres)                       |
| `bun run test:e2e` / `test:e2e:ui`            | Playwright E2E suite (`tests/e2e`, sets `NEXT_PUBLIC_E2E=true`)                        |
| `bun run contract:emit`                       | Emit `prisma/contract.json` and `prisma/contract.d.ts`                                 |
| `bun run db:update` / `db:verify` / `db:sign` | Prisma 8 schema apply / verify / sign                                                  |
| `bun run db:seed`                             | Seed demo fixtures and `SYSTEM_DEFAULT` prompts (`vpx prisma/seed.ts`)                 |

## Tests

```bash
bun run test          # full suite: ensures local Postgres 17, runs `prisma db update`, runs Vitest
bun run test:no-db    # unit tests only (no Postgres required)
bun run test:e2e      # Playwright E2E; sets NEXT_PUBLIC_E2E=true
```

Playwright uses `/usr/bin/google-chrome` when present (CI) and falls back to Playwright's bundled Chromium locally.

### Local test database

Integration tests issue live Prisma queries and must use a disposable local Postgres — never `.env`, `.env.local`, or a hosted Supabase project (prod ref `wntgnjrrzfndunqaiobo`, preview ref `oobhhexdoufnwdltoren`).

The setup matches CI (`.github/workflows/sonarqube.yml`): Postgres 17, database `inkstory_test`, user/password `postgres`/`postgres` on `localhost:5432` by default.

```bash
# One command: start/reuse local Postgres, apply contract, run full Vitest suite
bun run test

# Use a different host port when 5432 is already taken
INKSTORY_TEST_POSTGRES_PORT=55432 bun run test
# or: bun run test -- --port 55432

# If pulling ghcr.io/jgf-dev/postgres:17 fails without GHCR auth, use official postgres:17
INKSTORY_TEST_POSTGRES_IMAGE=postgres:17 bun run test

# Stop the disposable container when finished
docker compose -f docker-compose.test.yml down
```

`tests/setup-env.ts` loads **only** `.env.test` (never `.env` or `.env.local`), and `src/lib/test-database-guard.ts` aborts (`INKSTORY_UNSAFE_TEST_DATABASE`) if `DATABASE_URL` or `DIRECT_URL` contains a blocked Supabase ref or any host other than `localhost`, `127.0.0.1`, or `::1`. Committed `.env.test` contains only these local
credentials — never point it at a remote database.

## Troubleshooting

| Symptom                                                         | Likely cause & fix                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login / signup returns `403 Security verification failed`       | `TURNSTILE_SECRET` or `TURNSTILE_HOSTNAMES` is missing/mismatched in `.env.local`. Set valid Turnstile keys and `TURNSTILE_HOSTNAMES="localhost,127.0.0.1"` locally. |
| `POST /api/ai/generate` returns `503 AI_NOT_CONFIGURED`         | Expected when `AI_GATEWAY_API_KEY` is unset and no BYOK credential is selected; the response still returns the assembled prompt for copy/paste.                      |
| `/api/billing/*` returns `503 BILLING_NOT_CONFIGURED`           | Expected when `STRIPE_SECRET_KEY` (or `STRIPE_WEBHOOK_SECRET` for webhooks) is unset.                                                                                |
| `db:update` / seed hangs                                        | Transaction pooler (port 6543) blocks DDL. Point `DIRECT_URL` at the **session** pooler (port 5432). Direct DB hostnames can be IPv6-only.                           |
| `command not found: db:migrate` / `db:studio`                   | Removed in Prisma 8. Use `bun run db:update` and `prisma/contract.prisma`.                                                                                           |
| Server Components look logged-out                               | `src/proxy.ts` must refresh the Supabase cookie; do not add a separate `middleware.ts` that skips `@supabase/ssr`.                                                   |
| API returns `401 Unauthorized`                                  | Missing Supabase session cookie. Sign in via `/login`.                                                                                                               |
| Missing `prisma/contract.json` or `contract.d.ts` after install | Install ran with `--ignore-scripts`; run `bun run contract:emit`.                                                                                                    |
| Tests abort with `INKSTORY_UNSAFE_TEST_DATABASE`                | `DATABASE_URL` or `DIRECT_URL` in your shell points at a remote or Supabase host. Unset them and use `bun run test` / `.env.test`.                                   |
| `bun run test` cannot pull the GHCR Postgres image              | Run `INKSTORY_TEST_POSTGRES_IMAGE=postgres:17 bun run test`.                                                                                                         |
| `bun run test` fails because port 5432 is in use                | Run `INKSTORY_TEST_POSTGRES_PORT=55432 bun run test` or `bun run test -- --port 55432`.                                                                              |
