"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/app/_components/TurnstileWidget";
import { getTurnstileSiteKey, TURNSTILE_TOKEN_FIELD } from "@/lib/turnstile";
import { AuthTextField } from "@/lib/ui/AuthTextField";

export function LoginForm({
  siteKey,
  initialError = null,
}: {
  siteKey?: string;
  initialError?: string | null;
} = {}) {
  const router = useRouter();
  const turnstileRef = useRef<TurnstileWidgetHandle | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);

  const resolvedSiteKey = siteKey ?? getTurnstileSiteKey();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!turnstileToken) {
      setError("Please complete the verification challenge.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          [TURNSTILE_TOKEN_FIELD]: turnstileToken,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to log in. Please try again.");
        turnstileRef.current?.reset();
        setLoading(false);
        return;
      }

      router.push("/dashboard");
      router.refresh();
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
      />

      <TurnstileWidget
        ref={turnstileRef}
        siteKey={resolvedSiteKey}
        action="login"
        onTokenChange={setTurnstileToken}
      />

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="bg-ink-700 text-ink-50 hover:bg-ink-800 w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}
