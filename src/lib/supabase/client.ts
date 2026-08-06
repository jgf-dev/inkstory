/**
 * Browser-side Supabase client.
 *
 * Use this in Client Components for auth flows (sign in / up / out) and any
 * direct, public, RLS-safe reads/writes against Supabase Storage later.
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
