"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    startTransition(() => {
      router.push("/");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isPending}
      className="border-ink-300 text-ink-700 hover:bg-ink-100 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
    >
      {isPending ? "Logging out…" : "Log out"}
    </button>
  );
}
