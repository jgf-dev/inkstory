import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { syncAuthUser } from "@/lib/supabase/auth";
import { db } from "@/lib/prisma";
import { CodexManager } from "./_components/CodexManager";

export const dynamic = "force-dynamic";

export default async function CodexPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  await syncAuthUser(user);

  const [novels, series, entries] = await Promise.all([
    db.orm.public.Novel.where((n) => n.ownerId.eq(user.id))
      .where((n) => n.deletedAt.isNull())
      .all(),
    db.orm.public.Series.where((s) => s.ownerId.eq(user.id))
      .where((s) => s.deletedAt.isNull())
      .all(),
    db.orm.public.CodexEntry.where((e) => e.ownerId.eq(user.id))
      .where((e) => e.deletedAt.isNull())
      .all(),
  ]);

  return <CodexManager initialEntries={entries} novels={novels} series={series} />;
}
