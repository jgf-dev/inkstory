# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Long-form fiction, fantasy, and sci-fi novelists—particularly multi-book series authors—who build expansive worlds and write multi-act manuscripts. They are working across chapters, scenes, and worldbuilding lore, trying to maintain narrative continuity across tens or hundreds of thousands of words without losing creative flow or drowning AI assistants in irrelevant context.

## Product Purpose

InkStory is a novel-writing and worldbuilding platform built around an AI-aware Story Codex (story bible). It exists so authors can draft, structure, and revise novels while their story bible evolves alongside their manuscript and automatically supplies accurate, scene-relevant context to AI writing tools. Success means authors can write from page one of a standalone novel through book three of a series with consistent characters, locations, lore, and chronology—without manual prompt copy-pasting or runaway token costs.

## Positioning

Unlike general-purpose writing tools that ignore worldbuilding or dump an entire outline into every prompt, InkStory assembles a deterministic, token-budgeted slice of the Story Codex for the exact scene being written: seeding from manual attachments, `ALWAYS`-tracked entries, and word-boundary mention detection (`DETECTED`), expanding relationships via breadth-first graph traversal (`RelationEngine`), resolving chronological state changes in `Act → Chapter → Scene` reading order (`ProgressionEngine` with `ADDITION` and `REPLACEMENT` modes), and ranking/truncating to fit the active plan's token budget (`ContextAssembler`).

## Operating Context

- **Manuscript hierarchy**: `Series → Novel → Act → Chapter → Scene`, with scene-level metadata (`pov`, `tense`, `summary`, `excludeFromAi`, word counts) and autosaving prose editing.
- **Codex entities**: `CHARACTER`, `LOCATION`, `ITEM`, `LORE`, `FACTION`, `CONCEPT`, and `OTHER`, scoped either to a single novel or shared across a multi-book series (`seriesScoped`).
- **Interoperability**: Authors import existing manuscripts and export drafts in `.docx` and Markdown formats, and inspect the exact assembled prompt context (`POST /api/context/assemble` and the writing desk context drawer) before generating prose or scene beats.

## Capabilities and Constraints

- **Core capabilities**:
  - Hierarchical novel outliner and distraction-free scene writing desk (`src/app/dashboard/novels/[id]`).
  - Story Codex manager and editor (`src/app/dashboard/codex`) with aliases, tags, typed bidirectional relations, and scene-anchored progressions.
  - Pure, deterministic domain engines for mention detection (`src/lib/codex/mention-detection.ts`), relation graph traversal (`src/lib/codex/relation-engine.ts`), chronological progressions (`src/lib/codex/progression-engine.ts`), token budgeting (`src/lib/codex/token-budgeter.ts`), and context assembly (`src/lib/codex/context-assembler.ts`).
  - Multi-provider AI generation (`src/lib/ai/providers`) supporting both hosted cloud models and local/BYOK endpoints: Anthropic, OpenAI, OpenRouter, Ollama, LM Studio, and OpenAI-compatible servers.
  - Manuscript import and export (`.docx` via `mammoth`/`docx` and Markdown).
- **Commercial tiers & limits** (`src/lib/billing/plans.ts`, managed via Stripe Checkout and Customer Portal):
  - **Free**: 1 novel, 30 Codex entries, 4,000 max context tokens.
  - **Author Pro** ($15/mo or $144/yr): Unlimited novels, unlimited Codex entries, 6,000 max context tokens.
  - **Studio** ($35/mo): Unlimited novels and Codex entries, 6,000 max context tokens, plus opt-in multi-series sharing.
- **Technical constraints**:
  - Next.js 16 App Router + React 19 with session refresh in `src/proxy.ts`.
  - Supabase Auth (`@supabase/ssr` cookie session) + Supabase Postgres accessed through contract-first Prisma 8 (`prisma/contract.prisma`, `@prisma/orm-postgres`). Does not use InsForge.

## Brand Commitments

- **Name**: InkStory.
- **Privacy & authorship**: Manuscripts and Codex entries belong exclusively to the author, are private to their account (with Studio series sharing strictly opt-in per series), and are never used to train AI models.
- **Provider freedom**: First-class support for both hosted AI and local/BYOK model providers (Anthropic, OpenAI, OpenRouter, Ollama, LM Studio).

## Evidence on Hand

- Live marketing landing page (`src/app/page.tsx`) with stylized Glass Weaver novel/Codex product preview and live pricing table (`src/app/_components/PricingTable.tsx`).
- Seeded and onboarding sample fantasy world fixtures (`prisma/seed.ts`, `src/app/dashboard/_components/OnboardingWizard.tsx`).
- Verified domain engine and API test suites under `tests/` and Playwright E2E coverage under `tests/e2e/`.
- **Explicit absences**: No customer testimonials, user count claims, external press quotes, or third-party endorsements exist in the repository; future surfaces must not fabricate social proof or benchmarks.

## Product Principles

1. **The story bible is a living graph, not a static wiki**: Every Codex entry, alias, relation, and scene progression exists to actively inform the manuscript at the exact point in reading order where the author is working.
2. **Transparent, bounded AI context**: Authors should always see and control which Codex entries, relations, and progressions enter the AI prompt, bounded by predictable token budgets rather than opaque full-book dumps.
3. **Uncompromised author ownership and model choice**: Author prose and lore remain private and never train models, while the generation layer supports both cloud frontier models and local/self-hosted BYOK setups.
4. **Distraction-free literary focus**: Writing and worldbuilding surfaces prioritize calm readability, low cognitive friction, and rapid keyboard navigation over decorative clutter.

## Accessibility & Inclusion

- **WCAG AA compliance**: All marketing, dashboard, Codex, and writing desk surfaces must meet WCAG 2.1 AA contrast, focus visibility, and semantic markup standards.
- **Keyboard-first authoring ergonomics**: The writing desk, outliner, and Codex manager must support fluent keyboard navigation and shortcuts for long-session drafting and worldbuilding.
