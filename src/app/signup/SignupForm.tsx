"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AuthTextField } from "@/lib/ui/AuthTextField";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    const supabase = createSupabaseBrowserClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Where to send the user after they click the confirmation link.
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Supabase returns a session immediately if email confirmation is off,
    // otherwise prompts the user to check their inbox.
    setMessage("Check your email to confirm your account, then log in.");
    setLoading(false);

    // If confirmation is disabled in Supabase, redirect straight to the dashboard.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <AuthTextField
        id="email"
        label="Email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <AuthTextField
        id="password"
        label="Password"
        type="password"
        required
        minLength={6}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      >
        <p className="text-ink-500 mt-1 text-xs">Minimum 6 characters.</p>
      </AuthTextField>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && <p className="bg-ink-100 text-ink-800 rounded-md px-3 py-2 text-sm">{message}</p>}

      <button
        type="submit"
        disabled={loading}
        className="bg-ink-700 text-ink-50 hover:bg-ink-800 w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
