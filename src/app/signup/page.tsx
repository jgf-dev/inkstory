import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SignupForm } from "./SignupForm";

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

      <SignupForm />

      <p className="text-ink-500 mt-6 text-center text-sm">
        Already have one?{" "}
        <Link href="/login" className="text-ink-700 font-medium underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
