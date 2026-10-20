import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PricingTable } from "./_components/PricingTable";

const FEATURES = [
  {
    title: "AI-aware Story Codex",
    body: "Characters, locations, items, lore, factions — one bible the AI actually reads. Tag, color, and track entries your way.",
    icon: "📖",
  },
  {
    title: "Relations that travel",
    body: "Link allies, rivals, mentors, and factions into a graph. Context assembly walks the graph so every scene keeps its cast.",
    icon: "🕸️",
  },
  {
    title: "Progressions over time",
    body: "Mark what becomes true at which scene — injuries, revelations, betrayals. The bible evolves with your reading order.",
    icon: "⏳",
  },
  {
    title: "Token-budgeted context",
    body: "Every AI prompt assembles the ranked, deduplicated, token-budgeted slice of your bible — never the whole book.",
    icon: "🎯",
  },
  {
    title: "Distraction-free writing desk",
    body: "Outliner, autosaving scene editor with word counts, and a context drawer that shows exactly what the AI will see.",
    icon: "✍️",
  },
  {
    title: "Built for series",
    body: "Series-scoped entries keep shared world elements consistent across books — one ashfall charter, every novel.",
    icon: "📚",
  },
];

const FAQS = [
  {
    q: "What exactly is the Codex?",
    a: "Your story bible: every character, location, item, faction, and piece of lore — with aliases for mention detection, relations between entries, and progressions that change entries at specific scenes.",
  },
  {
    q: "How does the AI use my Codex?",
    a: "When you ask for a scene continuation or beat expansion, InkStory assembles the relevant slice of your bible — pinned entries, always-tracked entries, and detected mentions, expanded through relations — ranked, deduplicated, and clamped to your plan's token budget so prompts stay focused and affordable.",
  },
  {
    q: "What counts as a codex entry?",
    a: "Each character, location, item, lore concept, or faction is one entry. The Free plan includes 30 entries; paid plans are unlimited.",
  },
  {
    q: "Which AI models do you use?",
    a: "Generation runs through the Vercel AI Gateway with Claude-class models by default. Your prose and bible content are used only to generate what you ask for — never to train models.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Subscriptions are managed through Stripe's customer portal — upgrade, downgrade, or cancel in two clicks. Downgrading keeps your data; over-quota novels and entries stay but creation is paused.",
  },
  {
    q: "Is my manuscript private?",
    a: "Your work is yours. Manuscripts and codex entries are private to your account, and Studio's series sharing is opt-in per series.",
  },
];

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthenticated = Boolean(user);

  return (
    <main className="bg-ink-50 text-ink-900">
      {/* Nav */}
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-xl font-semibold tracking-tight">InkStory</span>
        <div className="flex items-center gap-6 text-sm">
          <a href="#features" className="hidden text-ink-600 hover:text-ink-900 sm:block">
            Features
          </a>
          <a href="#pricing" className="hidden text-ink-600 hover:text-ink-900 sm:block">
            Pricing
          </a>
          <a href="#faq" className="hidden text-ink-600 hover:text-ink-900 sm:block">
            FAQ
          </a>
          {isAuthenticated ? (
            <Link
              href="/dashboard"
              className="rounded-md bg-ink-800 px-4 py-2 font-medium text-ink-50 hover:bg-ink-900"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-ink-600 hover:text-ink-900">
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-ink-800 px-4 py-2 font-medium text-ink-50 hover:bg-ink-900"
              >
                Start free
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-14 pb-20 text-center">
        <p className="mb-4 inline-block rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-600">
          AI-aware story bible for novelists
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Write your novel. Your story bible writes with you.
        </h1>
        <p className="text-ink-500 mx-auto mt-5 max-w-2xl text-lg">
          InkStory keeps every character, location, and plot thread in an AI-aware Codex — then
          feeds exactly the right slice to the AI as you write. Consistency, from page one to book
          three.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          {isAuthenticated ? (
            <Link
              href="/dashboard"
              className="rounded-md bg-ink-800 px-6 py-3 text-sm font-medium text-ink-50 shadow-xs hover:bg-ink-900"
            >
              Go to dashboard →
            </Link>
          ) : (
            <>
              <Link
                href="/signup"
                className="rounded-md bg-ink-800 px-6 py-3 text-sm font-medium text-ink-50 shadow-xs hover:bg-ink-900"
              >
                Start writing free
              </Link>
              <Link
                href="/login"
                className="rounded-md border border-ink-300 px-6 py-3 text-sm font-medium text-ink-700 hover:bg-ink-100"
              >
                Log in
              </Link>
            </>
          )}
        </div>

        {/* Stylized product visual (no binary asset needed) */}
        <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-xl border border-ink-200 bg-white text-left shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-ink-200 bg-ink-100 px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span className="text-ink-400 ml-3 text-xs">
              inkstory.app/dashboard/novels/the-glass-weaver
            </span>
          </div>
          <div className="grid grid-cols-12 gap-0 sm:grid-cols-12">
            <div className="col-span-4 space-y-2 border-r border-ink-200 bg-ink-50 p-4 text-xs">
              <p className="text-ink-400 text-[10px] font-semibold tracking-wider uppercase">
                Story Codex
              </p>
              <div className="rounded border border-ink-200 bg-white p-2">
                <p className="font-semibold">Mara Vance</p>
                <p className="text-ink-500">CHARACTER · ALWAYS</p>
              </div>
              <div className="rounded border border-ink-200 bg-white p-2">
                <p className="font-semibold">Sunken Archives</p>
                <p className="text-ink-500">LOCATION · DETECTED</p>
              </div>
              <div className="rounded border border-ink-200 bg-white p-2">
                <p className="font-semibold">The Ashfall Charter</p>
                <p className="text-ink-500">LORE · ALWAYS</p>
              </div>
              <div className="rounded border border-dashed border-ink-300 p-2 text-center text-ink-400">
                + New Codex Entry
              </div>
            </div>
            <div className="col-span-8 p-4">
              <p className="text-ink-400 text-[10px] font-semibold tracking-wider uppercase">
                Scene 3 — The Quay at Dusk
              </p>
              <p className="font-serif text-sm leading-relaxed text-ink-800">
                Mara spread the charter across the quay stones, glass needles catching the last
                light. Below, the tide swallowed the archives gate by gate…
              </p>
              <div className="mt-4 rounded-md border border-ink-200 bg-ink-50 p-3 text-xs">
                <p className="text-ink-500 text-[10px] font-semibold tracking-wider uppercase">
                  AI Assistant · context assembled (1,842 / 4,000 tokens)
                </p>
                <p className="text-ink-600 mt-1">
                  Mara Vance · Sunken Archives · The Ashfall Charter · 3 relations expanded ·
                  progression “lost her sight” applied at this scene
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-3xl font-semibold tracking-tight">
          A bible the AI can actually read
        </h2>
        <p className="text-ink-500 mx-auto mt-3 max-w-2xl text-center text-sm">
          Most tools dump your whole outline into the prompt. InkStory assembles a ranked,
          token-budgeted slice — so continuations stay consistent and bills stay sane.
        </p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-ink-200 bg-white p-6 shadow-xs">
              <p className="text-2xl" aria-hidden>
                {f.icon}
              </p>
              <h3 className="mt-3 font-semibold text-ink-900">{f.title}</h3>
              <p className="text-ink-500 mt-2 text-sm">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-3xl font-semibold tracking-tight">Simple pricing</h2>
        <p className="text-ink-500 mx-auto mt-3 max-w-xl text-center text-sm">
          Start free. Upgrade when your world outgrows one book.
        </p>
        <div className="mt-10">
          <PricingTable isAuthenticated={isAuthenticated} />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-6 py-16">
        <h2 className="text-center text-3xl font-semibold tracking-tight">Questions, answered</h2>
        <div className="mt-8 space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="rounded-lg border border-ink-200 bg-white p-4 shadow-xs">
              <summary className="cursor-pointer font-medium text-ink-900">{f.q}</summary>
              <p className="text-ink-500 mt-2 text-sm">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-6 pt-8 pb-20 text-center">
        <div className="rounded-2xl bg-ink-900 px-8 py-12">
          <h2 className="text-2xl font-semibold text-white sm:text-3xl">
            Your world deserves a memory.
          </h2>
          <p className="text-ink-300 mx-auto mt-3 max-w-xl text-sm">
            Build your bible in an afternoon. Write with it for the rest of the series.
          </p>
          <Link
            href={isAuthenticated ? "/dashboard" : "/signup"}
            className="mt-6 inline-block rounded-md bg-white px-6 py-3 text-sm font-semibold text-ink-900 hover:bg-ink-100"
          >
            {isAuthenticated ? "Open InkStory →" : "Start writing free →"}
          </Link>
        </div>
      </section>

      <footer className="text-ink-400 border-t border-ink-200 py-8 text-center text-xs">
        © {new Date().getFullYear()} InkStory · Novels, worldbuilding, and the AI that keeps them
        consistent.
      </footer>
    </main>
  );
}
