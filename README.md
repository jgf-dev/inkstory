# InkStory

A novel-writing and world-building platform with an AI-aware Codex (story bible).

Linear project: [novel-writing-app](https://linear.app/jgfdev/project/novel-writing-app-3c3f658f0d44).

## Stack

| Layer     | Choice                                      | Why                                              |
| --------- | ------------------------------------------- | ------------------------------------------------ |
| Framework | Next.js 16 (App Router) + React 19          | Server Components, Server Actions, `src/proxy.ts` session refresh |
| Language  | TypeScript (strict)                         | Type safety across the Codex domain model        |
| Database  | Supabase Postgres                           | Auth + Postgres; Prisma 8 talks to it via `DIRECT_URL` |
| ORM       | Prisma 8 (Prisma Next, contract-first)      | `prisma/contract.prisma` + `@prisma/orm-postgres` |
| Auth      | Supabase Auth (cookie session)              | Email + password; Codex APIs require a session   |
| Styling   | Tailwind CSS 4                              | Utility-first                                    |
| Tooling   | bun + vite-plus (`vp`)                      | CI/Vercel install with bun; lint/format/test via `vp` |
| Hosting   | Vercel                                      | `vercel.json` runs `bun install` / `bun run build` |

## Acceptance criteria covered

- [x] App boots successfully (`bun run dev` or `npm run dev`)
- [x] User can sign up and log in (Supabase email + password)
- [x] Dashboard renders after login (series / novel / Codex counts; Codex manager at `/dashboard/codex`)
- [x] Core tables exist: `User`, `Series`, `Novel`, `Act`, `Chapter`, `Scene` (STO-1150)
- [x] Codex tables exist: `CodexEntry`, `CodexAlias`, `CodexTag`, `CodexRelation`, `CodexProgression` (STO-1167)
- [x] Can create a Novel with hierarchical structure and Codex entries via seed script (`bun run db:seed`)

Signup/login still has an open tracking issue ([#60](https://github.com/jgf-dev/inkstory/issues/60)); confirm email settings in the Supabase project if local auth fails.

## Local setup

### 1. Install

CI and Vercel use **bun**. npm scripts in `package.json` are equivalent.

```bash
bun install
```

`postinstall` runs `prisma contract emit`. If install used `--ignore-scripts` (as CI does), emit manually:

```bash
bun run contract:emit
```

### 2. Create a Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a project.
2. In **Settings → Database**, copy the **session pooler** URL (port **5432**, IPv4, DDL-safe) → `DIRECT_URL`.
3. Copy the **transaction pooler** URL (port **6543**) → `DATABASE_URL` for runtime queries.
4. In **Settings → API**, copy **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` and **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. Copy the **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`. Never expose this to the browser.
6. Copy `.env.example` to `.env` (or `.env.local`) and fill in the values.

`prisma.config.ts` prefers `DIRECT_URL`, then `DATABASE_URL`.

### 3. Initialize the database

Prisma 8 is contract-first. There is no `db:migrate` or `db:studio` script.

```bash
bun run db:update   # apply the contract to the database (use DIRECT_URL)
bun run db:seed     # optional: demo series / novel / Codex fixtures
```

Related: `bun run db:verify`, `bun run db:sign`, `bun run contract:emit`.

### 4. Start the dev server

```bash
bun run dev
```

Visit [http://localhost:3000](http://localhost:3000), sign up, and you should land on `/dashboard`. Codex UI: `/dashboard/codex`.

## Project layout

```
src/
├── app/
│   ├── api/health/              # GET /api/health
│   ├── api/codex/               # Session-authed Codex REST
│   ├── dashboard/               # Authed dashboard + Codex UI
│   ├── login/ / signup/
│   ├── layout.tsx / page.tsx
│   └── globals.css
├── lib/
│   ├── prisma.ts                # Prisma 8 client (`db.orm.public.*`)
│   ├── codex/                   # Domain service, actions, engines, types
│   └── supabase/                # Browser/server clients, session helper, user sync
└── proxy.ts                     # Next 16 session refresh (not middleware.ts)
prisma/
├── contract.prisma              # Prisma 8 data contract (source of truth)
├── schema.prisma                # Legacy Prisma 7 schema (not the runtime contract)
└── seed.ts
```

## Codex

Hierarchical story model: `User → Series → Novel → Act → Chapter → Scene`.

Codex entries are the story bible: character / location / item / lore / faction / concept / other. Book-scoped entries bind to one novel; series-scoped entries are shared across books in that series. Soft-delete via `deletedAt` (pass `?hard=true` to hard-delete).

| Concern | Where |
| ------- | ----- |
| Domain API | `src/lib/codex/service.ts` (`CodexError`, CRUD, mentions, `resolveCodexEntryAtScene`) |
| Server Actions | `src/lib/codex/actions.ts` (`{ success, data }` or `{ success: false, error, code, status }`) |
| Types | `src/lib/codex/types.ts` (`CodexType`, `CodexTrackingMode`, `ProgressionMode`) |
| Mentions | `src/lib/codex/mention-detection.ts` — case-insensitive, word-boundary, longer-match wins |
| Progressions | `src/lib/codex/progression-engine.ts` (STO-1153) — reading order Act→Chapter→Scene; `ADDITION` appends, `REPLACEMENT` replaces |

Tracking modes: `ALWAYS`, `DETECTED`, `NEVER`.

There is **no** HTTP endpoint for “resolve entry at scene”; use `resolveCodexEntryAtScene` in the service layer. Relation **CRUD** is on the API; the graph expansion engine (STO-1154) is not on `main`.

### REST (cookie session required; 401 if missing)

| Method | Path | Role |
| ------ | ---- | ---- |
| GET | `/api/health` | Liveness `{ status, service, version, time }` |
| GET | `/api/codex/entries?novelId\|seriesId&type&trackingMode&search&seriesOnly` | List |
| POST | `/api/codex/entries` | Create (`CreateCodexEntryInput`) |
| GET/PATCH/DELETE | `/api/codex/entries/[id]` | Read / update / delete (`?hard=true`) |
| POST | `/api/codex/entries/[id]/aliases` | Add alias |
| DELETE | `/api/codex/aliases/[id]` | Remove alias |
| POST | `/api/codex/entries/[id]/tags` | Add tag |
| DELETE | `/api/codex/tags/[id]` | Remove tag |
| POST | `/api/codex/relations` | Create relation |
| PATCH/DELETE | `/api/codex/relations/[id]` | Update / delete |
| POST | `/api/codex/progressions` | Create progression |
| PATCH/DELETE | `/api/codex/progressions/[id]` | Update / delete |
| POST | `/api/codex/mentions` | `{ text, novelId? \| sceneId? }` |

Error payload: `{ error, code }`. Codes: `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_FAILED`, `SCOPING_ERROR`, `CONFLICT`, `INVALID_JSON` (malformed body → 400, not 500).

## Scripts

| Script | Purpose |
| ------ | ------- |
| `bun run dev` | Next.js dev server |
| `bun run build` / `start` | Production build / serve |
| `bun run lint` | oxlint via `vp lint --fix` |
| `bun run format` / `format:check` | `vp fmt` |
| `bun run typecheck` | `vp check --no-fmt --no-lint` |
| `bun run test` / `test:cov` | Vitest via `vp test` |
| `bun run test:e2e` | Playwright (`tests/e2e`, Chrome at `/usr/bin/google-chrome`) |
| `bun run contract:emit` | `prisma contract emit` |
| `bun run db:update` / `db:verify` / `db:sign` | Prisma 8 schema apply / verify / sign |
| `bun run db:seed` | Demo data |

## Tests

```bash
bun run test          # unit / integration (Vitest)
bun run test:e2e      # Playwright; sets NEXT_PUBLIC_E2E=true and starts `npm run dev`
```

E2E launches Chromium with `executablePath: /usr/bin/google-chrome`. Codex tests that share a database can race; isolate fixtures rather than pointing every suite at one live DB.

## Troubleshooting

| Symptom | Likely cause |
| ------- | ------------ |
| `db:update` / seed hangs | Transaction pooler (port 6543) blocks DDL. Point `DIRECT_URL` at the **session** pooler (port 5432). Direct hostnames can be IPv6-only. |
| `command not found: db:migrate` / `db:studio` | Those Prisma 7 scripts were removed. Use `db:update` and the contract files. |
| Seed never exits | Historical: undrained `pg.Pool`. Current `prisma/seed.ts` should exit; if it hangs, check the pooler URL first. |
| Server Components look logged-out | `src/proxy.ts` must refresh the Supabase cookie; do not reintroduce a separate `middleware.ts` that skips `@supabase/ssr`. |
| Codex API 401 | No session cookie. Sign in via `/login`; there is no API-key auth. |
| Playwright cannot find Chrome | Config expects `/usr/bin/google-chrome`. |
| `prisma contract emit` missing after install | CI uses `bun install --ignore-scripts`; run `bun run contract:emit`. |

## What's next (Epic 1)

- [x] Codex database schema & models ([STO-1167](https://linear.app/jgfdev/issue/STO-1167))
- [x] Codex CRUD API & Server Actions ([STO-1168](https://linear.app/jgfdev/issue/STO-1168))
- [x] Basic Codex UI List + Editor ([STO-1169](https://linear.app/jgfdev/issue/STO-1169))
- [x] Mention Detection Service ([STO-1152](https://linear.app/jgfdev/issue/STO-1152))
- [x] Temporal Progressions ([STO-1153](https://linear.app/jgfdev/issue/STO-1153))
- [ ] Relations Graph Engine ([STO-1154](https://linear.app/jgfdev/issue/STO-1154))
- [ ] Context Assembler ([STO-1170](https://linear.app/jgfdev/issue/STO-1170) / [STO-1171](https://linear.app/jgfdev/issue/STO-1171))
