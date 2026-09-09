import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="mb-2 text-3xl font-semibold">Welcome back</h1>
      <p className="text-ink-500 mb-8">Log in to continue writing.</p>

      <LoginForm />

      <p className="text-ink-500 mt-6 text-center text-sm">
        New here?{" "}
        <Link href="/signup" className="text-ink-700 font-medium underline">
          Create an account
        </Link>
      </p>
    </main>
  );
}
