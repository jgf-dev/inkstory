import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { publicPageSeo } from "@/lib/seo/site";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTurnstileSiteKey } from "@/lib/turnstile";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = {
  title: "Create Your Writing Workspace Account | InkStory",
  description:
    "Create an InkStory account to start planning your novel and organizing characters, locations, and lore in your story Codex.",
  ...publicPageSeo("/signup"),
};

export default async function SignupPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="mb-2 text-3xl font-semibold">Create your account</h1>
      <p className="text-ink-500 mb-8">Start writing with an AI-aware Codex.</p>

      <SignupForm siteKey={getTurnstileSiteKey()} />

      <p className="text-ink-500 mt-6 text-center text-sm">
        Already have one?{" "}
        <Link href="/login" className="text-ink-700 font-medium underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
