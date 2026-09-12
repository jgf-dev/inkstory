import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { syncAuthUser } from "@/lib/supabase/auth";
import { db } from "@/lib/prisma";
import { LogoutButton } from "./_components/LogoutButton";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Mirror Supabase auth → local users row (idempotent).
  await syncAuthUser(user);

  // Surface series, novel, and codex metrics
  const [seriesRes, novelRes, codexRes] = await Promise.all([
    db.orm.public.Series.where((s) => s.ownerId.eq(user.id))
      .where((s) => s.deletedAt.isNull())
      .aggregate((a) => ({ count: a.count() })),
    db.orm.public.Novel.where((n) => n.ownerId.eq(user.id))
      .where((n) => n.deletedAt.isNull())
      .aggregate((a) => ({ count: a.count() })),
    db.orm.public.CodexEntry.where((e) => e.ownerId.eq(user.id))
      .where((e) => e.deletedAt.isNull())
      .aggregate((a) => ({ count: a.count() })),
  ]);

  const seriesCount = seriesRes.count;
  const novelCount = novelRes.count;
  const codexCount = codexRes.count;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="text-ink-500 text-sm">{user.email}</p>
        </div>
        <LogoutButton />
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="border-ink-200 bg-ink-50 rounded-lg border p-5">
          <p className="text-ink-500 text-sm tracking-wide uppercase">Series</p>
          <p className="mt-1 text-3xl font-semibold">{seriesCount}</p>
        </div>
        <div className="border-ink-200 bg-ink-50 rounded-lg border p-5">
          <p className="text-ink-500 text-sm tracking-wide uppercase">Novels</p>
          <p className="mt-1 text-3xl font-semibold">{novelCount}</p>
        </div>
        <Link
          href="/dashboard/codex"
          className="border-ink-200 bg-ink-50 hover:bg-ink-100/70 group block rounded-lg border p-5 transition-colors"
        >
          <div className="flex items-center justify-between">
            <p className="text-ink-500 text-sm tracking-wide uppercase">Codex</p>
            <span className="text-ink-400 group-hover:text-ink-700 text-xs font-medium">
              Manage →
            </span>
          </div>
          <p className="mt-1 text-3xl font-semibold">{codexCount}</p>
        </Link>
      </section>

      <section className="border-ink-300 text-ink-500 mt-10 rounded-lg border border-dashed p-8 text-center">
        <p className="font-medium">No novels yet.</p>
        <p className="mt-1 text-sm">
          The &ldquo;Create Novel&rdquo; flow ships in Epic 2 (STO-1160). For now you can{" "}
          <code className="bg-ink-100 rounded px-1 py-0.5 text-xs">npm run db:seed</code> to load
          demo data, or manage world-building elements in the{" "}
          <Link href="/dashboard/codex" className="text-ink-800 font-semibold underline">
            Story Codex
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
