import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTurnstileSiteKey } from "@/lib/turnstile";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Log In to Your Writing Workspace | Syncodex",
  description:
    "Log in to Syncodex to return to your story projects, Codex entries, and scene drafts.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
} = {}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  const resolvedParams = searchParams ? await searchParams : undefined;
  const initialError =
    resolvedParams?.error === "confirmation_failed"
      ? "We could not complete email verification automatically. Please log in if your email is confirmed, or sign up again."
      : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="mb-2 text-3xl font-semibold">Welcome back</h1>
      <p className="text-ink-500 mb-8">Log in to continue writing.</p>

      <LoginForm siteKey={getTurnstileSiteKey()} initialError={initialError} />

      <p className="text-ink-500 mt-6 text-center text-sm">
        New here?{" "}
        <Link href="/signup" className="text-ink-700 font-medium underline">
          Create an account
        </Link>
      </p>
    </main>
  );
}
