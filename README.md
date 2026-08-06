# InkStory

A novel-writing and world-building platform with an AI-aware Codex.

This is **Epic 0 — Project Foundation** ([Linear project](https://linear.app/jgfdev/project/novel-writing-app-3c3f658f0d44), tickets **STO-1149** and **STO-1150**).

## Stack

| Layer     | Choice                                | Why                                              |
| --------- | ------------------------------------- | ------------------------------------------------ |
| Framework | Next.js 15 (App Router) + React 19 RC | Server Components, Server Actions, edge-ready    |
| Language  | TypeScript (strict)                   | Type safety across the Codex domain model        |
| Database  | Supabase Postgres (free tier)         | Free, generous limits, integrated Auth + Storage |
| ORM       | Prisma                                | Schema migrations + Prisma Studio for Codex data |
| Auth      | Supabase Auth                         | Bundled with DB, supports RLS, email + OAuth     |
| Styling   | Tailwind CSS                          | Utility-first, dark-mode friendly                |
| Hosting   | Vercel                                | Native Next.js support, free tier                |

## Acceptance criteria covered (Epic 0)

- [x] App boots successfully (`npm run dev`)
- [x] User can sign up and log in (Supabase email + password)
- [x] Empty dashboard renders after login
- [x] Core tables exist: `User`, `Series`, `Novel`, `Act`, `Chapter`, `Scene`
- [x] Can create a Novel with hierarchical structure via seed script (`npm run db:seed`)

## Local setup

### 1. Install

```bash
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a project (free tier).
2. In **Settings → Database**, copy the **Connection string** (Transaction mode) → `DATABASE_URL`.
3. Copy the **Direct connection string** → `DIRECT_URL`.
4. In **Settings → API**, copy the **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` and the **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. In **Settings → API**, copy the **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`. ⚠️ Never expose this to the browser.
6. Copy `.env.example` to `.env` and fill in the values.

### 3. Initialize the database

```bash
npm run db:migrate      # runs Prisma migrations against Supabase Postgres
npm run db:seed         # optional: loads a demo series/novel/scene
```

### 4. Start the dev server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000), sign up, and you should land on `/dashboard`.

## Project layout

```
src/
├── app/
│   ├── api/health/         # GET /api/health — liveness probe
│   ├── dashboard/          # Authed dashboard (syncs Supabase → local user)
│   ├── login/              # Email + password sign-in
│   ├── signup/             # Email + password sign-up
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Landing page
│   └── globals.css
├── lib/
│   ├── prisma.ts           # Prisma client singleton
│   └── supabase/
│       ├── client.ts       # Browser client
│       ├── server.ts       # Server client (RSC, Route Handlers)
│       ├── middleware.ts   # Session refresh helper
│       ├── auth.ts         # Supabase → local user sync
│       └── types.ts        # Database type (stub — regenerate later)
└── middleware.ts           # Refreshes Supabase session cookie
prisma/
├── schema.prisma           # User → Series → Novel → Act → Chapter → Scene
└── seed.ts                 # Demo data loader
```

## Scripts

| Script               | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `npm run dev`        | Start dev server                                     |
| `npm run build`      | Production build                                     |
| `npm run start`      | Run production build                                 |
| `npm run lint`       | ESLint (Next.js config)                              |
| `npm run typecheck`  | TypeScript strict mode                               |
| `npm run format`     | Prettier write                                       |
| `npm run db:migrate` | Apply Prisma migrations to dev DB                    |
| `npm run db:studio`  | Open Prisma Studio (great for inspecting Codex data) |
| `npm run db:seed`    | Seed demo data                                       |

## What's next (Epic 1)

Codex data model (`CodexEntry`, `CodexAlias`, `CodexTag`, `CodexRelation`, `CodexProgression`) ships in [STO-1167](https://linear.app/jgfdev/issue/STO-1167).
