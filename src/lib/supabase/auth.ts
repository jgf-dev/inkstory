/**
 * Mirrors a Supabase auth user into the local `users` table on first sign-in.
 *
 * Called from the dashboard page (or any post-auth server boundary). Idempotent —
 * upserts so re-runs are safe.
 */
import { prisma } from "@/lib/prisma";
import type { User as SupabaseUser } from "@supabase/supabase-js";

export async function syncAuthUser(supabaseUser: SupabaseUser) {
  if (!supabaseUser.email) {
    throw new Error("Supabase user has no email — cannot sync to local users table.");
  }

  return prisma.user.upsert({
    where: { id: supabaseUser.id },
    update: {
      email: supabaseUser.email,
      name: fullNameFromUser(supabaseUser),
      avatarUrl: avatarUrlFromUser(supabaseUser),
    },
    create: {
      id: supabaseUser.id,
      email: supabaseUser.email,
      name: fullNameFromUser(supabaseUser),
      avatarUrl: avatarUrlFromUser(supabaseUser),
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
