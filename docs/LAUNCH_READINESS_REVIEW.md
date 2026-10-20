# InkStory (Project B: Worldbuilder) — Launch Readiness Review & Technical Roadmap

**Date:** October 8, 2026  
**Auditor / Author:** App Engineer — Worldbuilder (Project B)  
**Target Audience:** Chief of Staff, Board, Engineering Team  
**Repository:** `jgf-dev/inkstory`  
**Current State:** Epic 0 (Foundation) & Epic 1 (Codex Core) Complete (~35–40% Launch Ready)  
**Estimated Time to Paid Live Launch:** 3.5 – 4 Weeks (~18 Engineering Days)

---

## 1. Executive Summary

InkStory is an author-centric novel writing and worldbuilding platform designed to compete in the **Novelcrafter / Sudowrite class**. Its core differentiator is an **AI-aware Codex (story bible)** that automatically surfaces characters, locations, items, lore, relations, and temporal scene progressions into AI context windows.

This codebase audit evaluates InkStory against the requirements of a **paid author launch**. While the core algorithmic engines (mention detection, relation graph traversal, temporal scene progressions, and DB-agnostic context assembly) are remarkably well-architected and tested, the application is currently in an **internal alpha state**:
1. **No Author Writing Interface:** The database schema supports `Act`, `Chapter`, and `Scene`, but there is zero rich-text editor or writing surface in the frontend.
2. **Zero Billing Infrastructure:** No Stripe integration, subscription models, webhook receivers, or paywall enforcement exists.
3. **Incomplete Codex UI:** The web UI displays relations and progressions as read-only cards; authors cannot add, edit, or configure relationships or progressions through the UI.
4. **Context Assembler Unmerged:** STO-1170 (`assembleContext`) resides on a PR branch (`sto-1170-context-assembly-core`) and lacks token-budgeting and LLM prompt formatting.
5. **No Onboarding or Marketing Funnel:** The landing page is a developer placeholder, and there is no author onboarding wizard or starter template.

With focused execution across five sequential implementation phases, InkStory can reach a **polished, revenue-generating live launch in ~18 working days**.

---

## 2. Existing Architecture & Codebase Health

### 2.1 Technology Stack Summary
| Layer | Technology | Assessment & Health |
|---|---|---|
| **Framework** | Next.js 16.3.5 (App Router), React 19.3.0 | Modern, performant; leverages Server Components & Server Actions. |
| **Authentication** | Supabase Auth (`@supabase/ssr` 0.12.7) | Cookie sessions managed via `src/proxy.ts` (Next 16 standard). Robust. |
| **Database & ORM** | Supabase Postgres + Prisma 8 (`@prisma/orm-postgres` 8.0.0-rc.10) | Contract-first via `prisma/contract.prisma`. Strong type safety; strict schema. |
| **Domain Logic** | Pure TypeScript domain engines | Exceptional separation of concerns: pure algorithms decoupled from DB. |
| **Styling** | Tailwind CSS 4.3.3 (`@tailwindcss/postcss`) | Clean utility styles; typography and colors aligned with ink aesthetic. |
| **Tooling & CI** | Bun 1.4.2, Vite-plus (`vp`), Playwright, GitHub Actions | Fast test runner (`vp test`), SonarQube integration, and E2E coverage. |

### 2.2 Architectural Strengths
1. **Decoupled Domain Engines:**
   - `ProgressionEngine` (`src/lib/codex/progression-engine.ts`): Resolves scene-aware chronological entry descriptions using novel reading order (`Act → Chapter → Scene`) with `ADDITION` and `REPLACEMENT` modes.
   - `RelationEngine` (`src/lib/codex/relation-engine.ts`): Performs breadth-first search (BFS) graph traversal with cycle prevention, direction filters, and depth caps.
   - `MentionDetection` (`src/lib/codex/mention-detection.ts`): Unicode-aware, word-boundary-respecting mention parser with longest-match precedence.
   - `ContextAssembler` (`src/lib/codex/context-assembler.ts` on PR #91): Combines manual attachments, always-tracked seeds, mentions, relation expansion, and progressions into deterministic structured output.
2. **Automated Test Quality:**
   - 100% pure unit test suites for all domain engines. Tests are fast, isolated, and deterministic.
3. **Contract-First Data Layer:**
   - Prisma 8 contract generation enforces strict compile-time types for SQL schemas without legacy migration overhead.

### 2.3 Technical Debt & Architecture Risks
- **Prisma 8 Release Candidate:** `@prisma/orm-postgres: 8.0.0-rc.10` is pre-release software. Occasional pooler timeouts have been observed in shared CI environments.
- **Client State Fragmentation:** No unified client-side state store (e.g. Zustand) or cache (e.g. TanStack Query/SWR). State is managed via local `useState` and imperative server action calls, risking state desynchronization in complex multi-panel editor views.
- **Application-Level Authorization:** Postgres Row Level Security (RLS) is deferred. Authorization relies entirely on application queries checking `ownerId === userId`.
- **Display-Only Frontend Components:** Multiple backend CRUD capabilities (relations, progressions, custom fields) lack interactive UI forms.

---

## 3. Gap Analysis: Novelcrafter / Sudowrite Benchmark

To command recurring subscription revenue ($15–$35/month), InkStory must satisfy the expectations of fantasy, sci-fi, and fiction authors:

### 3.1 Codex / Worldbuilding Features
| Feature | Current State | Target Launch Requirement | Gap Severity |
|---|---|---|---|
| **Entry Types** | 7 enum types (`CHARACTER`, `LOCATION`, `ITEM`, `LORE`, `FACTION`, `CONCEPT`, `OTHER`) | Custom entity templates with specialized prompts & attributes | Low |
| **Custom Fields** | `customFields Json?` in DB; no UI | Dynamic key-value / attribute editor in `CodexEditor.tsx` | Medium |
| **Aliases & Tags** | Full API + UI editing | Working, reliable | None |
| **Relation Graph UI** | API supports CRUD; UI is read-only | Interactive relation linker (`Add Relation`, target selector, type, reverse type) | High |
| **Progression UI** | API supports CRUD; UI is read-only | Scene-linked progression creator modal / drawer | High |
| **Series-Scoped Bible** | Schema support (`seriesScoped`); UI shows badge | Global vs Book toggle in manager; series inheritance filter | Low |
| **Import / Export** | None | Import from Novelcrafter / World Anvil / JSON; Export to JSON/Markdown | Medium |

### 3.2 Editor & Authoring Ergonomics
| Feature | Current State | Target Launch Requirement | Gap Severity |
|---|---|---|---|
| **Novel / Chapter / Scene Creation** | Schema only; dashboard has placeholder message | Outliner / project tree UI for Acts, Chapters, and Scenes | **Critical (P0)** |
| **Prose Writing Surface** | Non-existent | Distraction-free, fast text/markdown editor with autosave & word count | **Critical (P0)** |
| **Live Mention Highlighting** | Service exists; unintegrated | Inline visual highlighting of detected Codex entries in editor with hover cards | High |
| **Codex Quick-Insert** | None | `@mention` autocomplete menu within the editor | Medium |
| **Scene Metadata Drawer** | In DB (`pov`, `tense`, `summary`, `excludeFromAi`) | Sidebar drawer to adjust scene POV, tense, and notes | Medium |

### 3.3 AI Context Injection & Context Window Economy
| Feature | Current State | Target Launch Requirement | Gap Severity |
|---|---|---|---|
| **Context Assembler Core** | Implemented on branch `sto-1170-context-assembly-core` | Merge PR #91 into `main` | **Critical (P0)** |
| **Token Budgeting** | Entry count truncation only (`maxEntries: 40`) | Hard token-budget limit (e.g. 2,000–6,000 tokens) with intelligent truncation | **Critical (P0)** |
| **Context Compression** | Injects full descriptions | Tiered density: full text for seeds, concise summaries for relations | Medium |
| **LLM Prompt Formatting** | Returns raw JSON data structure | Formatted XML/Markdown prompt blocks (`<codex_context>`) for Claude/GPT-4o | High |
| **LLM Generation Hook** | None | Streaming generation API for Scene Prose, Scene Beats, and "Ask Codex" | High |

### 3.4 Stripe Billing & Subscription Management
| Feature | Current State | Target Launch Requirement | Gap Severity |
|---|---|---|---|
| **Stripe SDK & Keys** | Not installed | `stripe` and `@stripe/stripe-js` dependencies and configuration | **Critical (P0)** |
| **Subscription DB Model** | None | User subscription fields (`stripeCustomerId`, `planTier`, `status`, `periodEnd`) | **Critical (P0)** |
| **Tier Architecture** | None | Three tiers: **Free** (1 book, 30 entries), **Author Pro** ($15/mo), **Studio** ($35/mo) | **Critical (P0)** |
| **Stripe Webhook Handler** | None | `/api/billing/webhook` with signature verification | **Critical (P0)** |
| **Self-Serve Customer Portal**| None | `/api/billing/portal` redirecting to Stripe Billing Portal | High |
| **Paywall & Quota Enforcement**| None | API and UI guards restricting books, entries, and AI generation by tier | High |

### 3.5 Author Onboarding & Marketing Funnel
| Feature | Current State | Target Launch Requirement | Gap Severity |
|---|---|---|---|
| **Landing Page** | Minimal Epic 0 bullet-point card | High-converting landing page: Hero, interactive feature cards, pricing table, FAQ | High |
| **Onboarding Wizard** | Redirects to empty dashboard | 3-step setup modal: Novel title, genre archetype, optional sample lorebook | High |
| **Starter Lorebook Fixtures**| Seed script exists; not self-serve | "Clone Starter World" button (Fantasy / Sci-Fi starter lorebook) | Medium |
| **Keyboard Shortcuts** | None | `Cmd+K` Quick Search, `Cmd+S` manual save, `@` mention autocomplete | Low |

---

## 4. Ranked Blocker List for Paid Launch

### P0 — Launch Blockers (Must Have for MVP)
1. **[P0-1] Missing Novel & Scene Outliner / Writing Surface:** Authors cannot create books, chapters, or scenes via the UI, nor write novel prose.
2. **[P0-2] Zero Stripe Billing & Subscription Infrastructure:** Cannot accept credit cards, manage subscriptions, or enforce tier paywalls.
3. **[P0-3] Unmerged Context Assembler & Missing Token Budgeter:** PR #91 (`sto-1170-context-assembly-core`) must be merged into `main`, and token budgeting must be implemented to prevent context-window blowup.
4. **[P0-4] Placeholder Landing Page:** Current homepage cannot convert traffic or explain value propositions.

### P1 — Essential Launch Features (Required for Retention & Value)
5. **[P1-1] Read-Only Codex UI:** Add interactive modals/drawers for creating and editing Relations and Progressions.
6. **[P1-2] AI Prompt Formatter & LLM Generation Interface:** Transform assembled context into structured system prompts and provide an inline AI generation drawer (prose generation / beat expansion).
7. **[P1-3] Self-Serve Author Onboarding:** First-time user tour with genre archetypes and a pre-populated sample lorebook.
8. **[P1-4] Custom Fields & Attributes UI:** Allow authors to define traits (Appearance, Motivation, Wand Core, etc.) on entries.

### P2 — Polish & Growth Features (Post-Launch Fast Follow)
9. **[P2-1] Import / Export Support:** Novelcrafter JSON and Markdown export/import.
10. **[P2-2] Visual Relationship Graph Canvas:** Node-link visualizer for entry networks.
11. **[P2-3] Semantic Vector Search (pgvector):** Concept-level lorebook retrieval alongside lexical mention detection.

---

## 5. Technical Implementation Roadmap (18-Day Delivery Plan)

```
[Phase 1: Days 1-3]  ───▶ [Phase 2: Days 4-7]  ───▶ [Phase 3: Days 8-12] ───▶ [Phase 4: Days 13-15] ───▶ [Phase 5: Days 16-18]
Context Core & Tokens     Stripe Billing Engine     Author Writing Surface      Codex UI Polish            Landing & Launch QA
```

### Phase 1: Context Assembler Core & Token Economy (Days 1–3)
- **Goal:** Unify AI context assembly in `main` with strict token budget enforcement.
- **Tasks:**
  1. Review and merge `sto-1170-context-assembly-core` (PR #91) to `main`.
  2. Implement `TokenBudgeter`: approximate token counting and hard token limits (`maxTokens`, default 4,000 tokens) with priority-based truncation.
  3. Implement `PromptFormatter`: format `AssembledContext` into clean XML blocks (`<story_bible><entity ...>`) optimized for Claude 3.5 Sonnet and GPT-4o.
  4. Expose `POST /api/codex/assemble-context` endpoint with comprehensive integration tests.

### Phase 2: Stripe Billing & Subscription Infrastructure (Days 4–7)
- **Goal:** Enable end-to-end self-serve monetization and tier enforcement.
- **Tasks:**
  1. Add `Subscription` fields to User model in `prisma/contract.prisma`: `stripeCustomerId`, `stripeSubscriptionId`, `planTier` (FREE, PRO, STUDIO), `subscriptionStatus`, `currentPeriodEnd`.
  2. Emit and apply Prisma contract changes (`bun run contract:emit && bun run db:update`).
  3. Implement Stripe client in `src/lib/stripe.ts` with tier configurations:
     - **Free:** 1 Novel, 30 Entries, basic context assembly.
     - **Author Pro ($15/mo or $144/yr):** Unlimited Novels & Entries, full relation graph expansion, 6,000 token context assembly.
     - **Studio ($35/mo):** Multi-series sharing, priority support.
  4. Build checkout session route (`/api/billing/checkout`) and customer portal route (`/api/billing/portal`).
  5. Implement webhook handler (`/api/billing/webhook`) covering `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
  6. Add tier entitlement helper (`src/lib/billing/entitlements.ts`) and wrap creation endpoints with quota guards.

### Phase 3: Author Writing Surface & Editor Integration (Days 8–12)
- **Goal:** Deliver an intuitive, distraction-free writing environment connected to the Codex.
- **Tasks:**
  1. Build Novel & Chapter Outliner sidebar on `/dashboard/novels/[id]`.
  2. Implement Scene Editor with clean typography, word count, autosave debounce, and scene metadata drawer (POV, Tense, Summary).
  3. Connect live mention detection: debounced mention scan highlighting detected characters/locations in the sidebar or gutter.
  4. Add Scene Context drawer: view active Codex entries attached to the current scene with quick-toggle attachments.
  5. Add AI Assistant drawer: generate scene continuation or beat expansion utilizing the assembled context.

### Phase 4: Codex UI Polish & Advanced Worldbuilding (Days 13–15)
- **Goal:** Transform Codex into a fully editable, author-grade story bible.
- **Tasks:**
  1. Add Relation Editor modal in `CodexEditor.tsx`: select target entry, relation type, reverse type, and description.
  2. Add Progression Editor modal in `CodexEditor.tsx`: select scene from novel reading order, mode (`ADDITION` / `REPLACEMENT`), and evolved description.
  3. Implement dynamic `customFields` editor for key-value entry attributes.
  4. Add Novel & Series creation modals on the dashboard.

### Phase 5: High-Converting Landing Page, Onboarding & Launch QA (Days 16–18)
- **Goal:** Public-ready landing page, seamless author onboarding, and production verification.
- **Tasks:**
  1. Build modern landing page on `/`: Hero with demo screenshot, feature showcase (AI Codex, Progressions, Relations), interactive pricing table with monthly/annual toggle, and FAQ.
  2. Implement 3-step First-Time Author Onboarding modal upon initial login.
  3. Add "Seed Sample Fantasy Bible" button for instant exploration.
  4. Run full Playwright E2E suite covering Signup → Onboarding → Novel Creation → Codex Linking → Stripe Checkout redirect.
  5. Audit security: verify secrets, CSRF protection, and webhook signatures.

---

## 6. Risk Matrix & Mitigations

| Risk | Impact | Likelihood | Mitigation Strategy |
|---|---|---|---|
| **LLM Token Overuse & Context Window Overflow** | High (Cost / Degradation) | High | Enforce strict `maxTokens` budget in `TokenBudgeter`; prioritize seeds > depth 1 > depth 2; truncate entry descriptions gracefully. |
| **Stripe Webhook Desync / Missed Events** | High (Revenue / Access) | Low | Implement idempotent webhook processing with database logging of event IDs; provide manual "Restore Purchases" button in billing settings. |
| **Prisma 8 RC Stability in Production** | Medium (Runtime Errors) | Medium | Pin `@prisma/orm-postgres` and CLI versions; isolate connection pools via Supabase Session Pooler (port 5432) for migrations and Transaction Pooler (port 6543) for queries. |
| **Author Data Loss During Long Writing Sessions** | Critical (Author Trust) | Low | Local storage autosave fallback in the editor; optimistic updates with visual "Saving / All changes saved" indicator. |

---

## 7. Immediate Next Actions

1. **Acknowledge & Submit Audit to Paperclip:** Store this launch review document as the durable artifact on issue `JGF-3`.
2. **Merge PR #91 (`sto-1170-context-assembly-core`):** Bring `assembleContext` into `main` and wire up the token budgeter.
3. **Execute Phase 1 & Phase 2:** Begin Stripe integration and Novel/Scene writing UI scaffolding.
