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

  // Epic 0 acceptance: empty dashboard renders. We'll add "create novel" UI in
  // Epic 2 (STO-1160). For now, show the seed data if present.
  const [seriesRes, novelRes] = await Promise.all([
    db.orm.public.Series.where((s) => s.ownerId.eq(user.id))
      .where((s) => s.deletedAt.isNull())
      .aggregate((a) => ({ count: a.count() })),
    db.orm.public.Novel.where((n) => n.ownerId.eq(user.id))
      .where((n) => n.deletedAt.isNull())
      .aggregate((a) => ({ count: a.count() })),
  ]);

  const seriesCount = seriesRes.count;
  const novelCount = novelRes.count;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="text-sm text-ink-500">{user.email}</p>
        </div>
        <LogoutButton />
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-ink-200 bg-ink-50 p-5">
          <p className="text-sm uppercase tracking-wide text-ink-500">Series</p>
          <p className="mt-1 text-3xl font-semibold">{seriesCount}</p>
        </div>
        <div className="rounded-lg border border-ink-200 bg-ink-50 p-5">
          <p className="text-sm uppercase tracking-wide text-ink-500">Novels</p>
          <p className="mt-1 text-3xl font-semibold">{novelCount}</p>
        </div>
      </section>

      <section className="mt-10 rounded-lg border border-dashed border-ink-300 p-8 text-center text-ink-500">
        <p className="font-medium">No novels yet.</p>
        <p className="mt-1 text-sm">
          The &ldquo;Create Novel&rdquo; flow ships in Epic 2 (STO-1160). For now you can{" "}
          <code className="rounded bg-ink-100 px-1 py-0.5 text-xs">npm run db:seed</code> to load
          demo data, or wait for the next iteration.
        </p>
      </section>
    </main>
  );
}
