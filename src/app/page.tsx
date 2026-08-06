import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 text-center">
      <header className="space-y-2">
        <h1 className="text-5xl font-semibold tracking-tight">InkStory</h1>
        <p className="text-lg text-ink-500">
          A novel-writing and world-building platform with an AI-aware Codex.
        </p>
      </header>

      <section className="rounded-lg border border-ink-200 bg-ink-50 p-6 text-left text-sm leading-relaxed text-ink-700 shadow-sm">
        <h2 className="mb-2 font-semibold text-ink-800">Epic 0 — Foundation</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Next.js 15 + TypeScript + Tailwind</li>
          <li>Supabase Postgres + Auth + Storage</li>
          <li>Prisma ORM with User → Series → Novel → Act → Chapter → Scene</li>
        </ul>
      </section>

      <nav className="flex gap-4">
        {user ? (
          <Link
            href="/dashboard"
            className="rounded-md bg-ink-700 px-5 py-2 text-sm font-medium text-ink-50 hover:bg-ink-800"
          >
            Go to dashboard →
          </Link>
        ) : (
          <>
            <Link
              href="/login"
              className="rounded-md border border-ink-300 px-5 py-2 text-sm font-medium hover:bg-ink-100"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-md bg-ink-700 px-5 py-2 text-sm font-medium text-ink-50 hover:bg-ink-800"
            >
              Sign up
            </Link>
          </>
        )}
      </nav>
    </main>
  );
}
