"use client";

import { useRef, useState } from "react";
import { WAITLIST_EMAIL_MAX_LENGTH, WAITLIST_HONEYPOT_FIELD } from "@/lib/waitlist/validation";
import { AuthTextField } from "@/lib/ui/AuthTextField";

const FALLBACK_ERROR = "Something went wrong. Please try again.";

export function WaitlistForm({ source }: { source?: string | null } = {}) {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setMessage(null);
    setLoading(true);

    const referrer = document.referrer;

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          source: source ?? undefined,
          referrer: referrer || undefined,
          [WAITLIST_HONEYPOT_FIELD]: honeypot,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;

      if (response.ok) {
        setMessage(payload?.message ?? "Thanks! You're on the list.");
        setEmail("");
      } else {
        setError(payload?.error ?? FALLBACK_ERROR);
      }
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <AuthTextField
        id="waitlist-email"
        label="Email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value.slice(0, WAITLIST_EMAIL_MAX_LENGTH))}
      />

      {/* Honeypot: hidden from people and assistive tech; bots that fill it are ignored. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={WAITLIST_HONEYPOT_FIELD}>Website</label>
        <input
          id={WAITLIST_HONEYPOT_FIELD}
          name={WAITLIST_HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="new-password"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="bg-ink-100 text-ink-800 rounded-md px-3 py-2 text-sm">
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        title={loading ? "Submitting your email…" : undefined}
        className="bg-ink-700 text-ink-50 hover:bg-ink-800 w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? "Joining…" : "Join the waitlist"}
      </button>
    </form>
  );
}
