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
        <p className="text-ink-500 text-lg">
          A novel-writing and world-building platform with an AI-aware Codex.
        </p>
      </header>

      <section className="border-ink-200 bg-ink-50 text-ink-700 rounded-lg border p-6 text-left text-sm leading-relaxed shadow-sm">
        <h2 className="text-ink-800 mb-2 font-semibold">Epic 0 — Foundation</h2>
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
            className="bg-ink-700 text-ink-50 hover:bg-ink-800 rounded-md px-5 py-2 text-sm font-medium"
          >
            Go to dashboard →
          </Link>
        ) : (
          <>
            <Link
              href="/login"
              className="border-ink-300 hover:bg-ink-100 rounded-md border px-5 py-2 text-sm font-medium"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="bg-ink-700 text-ink-50 hover:bg-ink-800 rounded-md px-5 py-2 text-sm font-medium"
            >
              Sign up
            </Link>
          </>
        )}
      </nav>
    </main>
  );
}
