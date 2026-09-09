/**
 * Mirrors a Supabase auth user into the local `users` table on first sign-in.
 *
 * Called from the dashboard page (or any post-auth server boundary). Idempotent —
 * upserts so re-runs are safe.
 */
import { db } from "@/lib/prisma";
import { Temporal } from "temporal-polyfill";
import type { User as SupabaseUser } from "@supabase/supabase-js";

export async function syncAuthUser(supabaseUser: SupabaseUser) {
  if (!supabaseUser.email) {
    throw new Error("Supabase user has no email — cannot sync to local users table.");
  }

  const name = fullNameFromUser(supabaseUser);
  const avatarUrl = avatarUrlFromUser(supabaseUser);
  const now = Temporal.Now.plainDateTimeISO();

  return db.orm.public.User.upsert({
    create: {
      id: supabaseUser.id,
      email: supabaseUser.email,
      name,
      avatarUrl,
      updatedAt: now,
    },
    update: {
      email: supabaseUser.email,
      name,
      avatarUrl,
      updatedAt: now,
    },
  });
}

function fullNameFromUser(user: SupabaseUser): string | null {
  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
  return meta?.full_name ?? meta?.name ?? null;
}

function avatarUrlFromUser(user: SupabaseUser): string | null {
  const meta = user.user_metadata as { avatar_url?: string; picture?: string } | undefined;
  return meta?.avatar_url ?? meta?.picture ?? null;
}
