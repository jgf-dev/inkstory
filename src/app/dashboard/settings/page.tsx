import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ByokCredentialsPanel } from "./_components/ByokCredentialsPanel";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Settings</h1>
          <p className="text-ink-500 text-sm">{user.email}</p>
        </div>
        <Link href={"/dashboard" as Route} className="text-ink-700 text-sm font-medium underline">
          ← Dashboard
        </Link>
      </header>

      <ByokCredentialsPanel />
    </main>
  );
}
