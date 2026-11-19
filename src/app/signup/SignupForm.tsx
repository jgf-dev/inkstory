"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/app/_components/TurnstileWidget";
import { getTurnstileSiteKey, TURNSTILE_TOKEN_FIELD } from "@/lib/turnstile";
import { AuthTextField } from "@/lib/ui/AuthTextField";

export function SignupForm({ siteKey }: { siteKey?: string } = {}) {
  const router = useRouter();
  const turnstileRef = useRef<TurnstileWidgetHandle | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resolvedSiteKey = siteKey ?? getTurnstileSiteKey();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!turnstileToken) {
      setError("Please complete the verification challenge.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          [TURNSTILE_TOKEN_FIELD]: turnstileToken,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        hasSession?: boolean;
      } | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to create account. Please try again.");
        turnstileRef.current?.reset();
        setLoading(false);
        return;
      }

      if (payload?.hasSession) {
        router.push("/dashboard");
        router.refresh();
        return;
      }

      // Supabase prompts email confirmation when immediate session creation is off.
      setMessage("Check your email to confirm your account, then log in.");
      turnstileRef.current?.reset();
      setLoading(false);
    } catch {
      setError("Unable to reach the server. Please try again.");
      turnstileRef.current?.reset();
      setLoading(false);
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

      <TurnstileWidget
        ref={turnstileRef}
        siteKey={resolvedSiteKey}
        action="signup"
        onTokenChange={setTurnstileToken}
      />

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
