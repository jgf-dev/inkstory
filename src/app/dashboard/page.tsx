import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { syncAuthUser } from "@/lib/supabase/auth";
import { db } from "@/lib/prisma";
import { LogoutButton } from "./_components/LogoutButton";
import { LibraryCreator } from "./_components/LibraryCreator";
import { OnboardingWizard } from "./_components/OnboardingWizard";

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
  const [seriesRes, novelRes, codexRes, novels, seriesRows] = await Promise.all([
    db.orm.public.Series.where((s) => s.ownerId.eq(user.id))
      .where((s) => s.deletedAt.isNull())
      .aggregate((a) => ({ count: a.count() })),
    db.orm.public.Novel.where((n) => n.ownerId.eq(user.id))
      .where((n) => n.deletedAt.isNull())
      .aggregate((a) => ({ count: a.count() })),
    db.orm.public.CodexEntry.where((e) => e.ownerId.eq(user.id))
      .where((e) => e.deletedAt.isNull())
      .aggregate((a) => ({ count: a.count() })),
    db.orm.public.Novel.where((n) => n.ownerId.eq(user.id))
      .where((n) => n.deletedAt.isNull())
      .all(),
    db.orm.public.Series.where((s) => s.ownerId.eq(user.id))
      .where((s) => s.deletedAt.isNull())
      .all(),
  ]);

  const seriesCount = seriesRes.count;
  const novelCount = novelRes.count;
  const codexCount = codexRes.count;
  const seriesOptions = JSON.parse(JSON.stringify(seriesRows)).map(
    (s: { id: string; title: string }) => ({ id: s.id, title: s.title }),
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <OnboardingWizard hasNovels={novels.length > 0} series={seriesOptions} />
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

      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-ink-500 text-sm font-semibold tracking-wide uppercase">
            Your novels
          </h2>
          <LibraryCreator series={seriesOptions} />
        </div>
        {novels.length === 0 ? (
          <div className="border-ink-300 text-ink-500 rounded-lg border border-dashed p-8 text-center">
            <p className="font-medium">No novels yet.</p>
            <p className="mt-1 text-sm">
              Use <span className="font-semibold text-ink-700">+ New Novel</span> above to start
              your first book, or manage world-building elements in the{" "}
              <Link href="/dashboard/codex" className="text-ink-800 font-semibold underline">
                Story Codex
              </Link>
              . A sample fantasy bible is available from the onboarding tour.
            </p>
          </div>
        ) : (
          <ul className="grid gap-2">
            {JSON.parse(JSON.stringify(novels)).map(
              (novel: { id: string; title: string; subtitle: string | null }) => (
                <li key={novel.id}>
                  <Link
                    href={`/dashboard/novels/${novel.id}`}
                    className="border-ink-200 hover:border-ink-300 hover:bg-ink-50 flex items-center justify-between rounded-lg border px-4 py-3 transition-colors"
                  >
                    <span>
                      <span className="text-ink-900 block font-medium">{novel.title}</span>
                      {novel.subtitle && (
                        <span className="text-ink-500 block text-xs">{novel.subtitle}</span>
                      )}
                    </span>
                    <span className="text-ink-400 text-xs font-medium">Open writing desk →</span>
                  </Link>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </main>
  );
}
