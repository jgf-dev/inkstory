import type { Metadata } from "next";
import Link from "next/link";
import { normalizeSource } from "@/lib/waitlist/validation";
import { WaitlistForm } from "./WaitlistForm";

const DESCRIPTION =
  "syncodex is a writing workspace for novelists: a story bible for your characters, places and lore, and a scene editor with an AI assistant that reads it.";

export const metadata: Metadata = {
  title: "Join the waitlist · syncodex",
  description: DESCRIPTION,
  openGraph: {
    title: "Join the syncodex waitlist",
    description: DESCRIPTION,
    siteName: "syncodex",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Join the syncodex waitlist",
    description: DESCRIPTION,
  },
};

/** Public waitlist page; no auth required. */
export default async function WaitlistPage({
  searchParams,
}: {
  searchParams?: Promise<{ source?: string | string[] }>;
} = {}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const source = normalizeSource(resolvedParams?.source);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <p className="text-ink-500 mb-2 text-sm font-medium tracking-wide">syncodex</p>
      <h1 className="mb-3 text-3xl font-semibold">Join the waitlist</h1>
      <p className="text-ink-600 mb-2">
        syncodex is a writing workspace for novelists. Keep your characters, places and lore in one
        story bible, and draft scenes with an AI assistant that reads it.
      </p>
      <p className="text-ink-500 mb-8 text-sm">Leave your email to hear from us about syncodex.</p>

      <WaitlistForm source={source} />

      <p className="text-ink-500 mt-6 text-center text-sm">
        <Link href="/" className="text-ink-700 font-medium underline">
          Back to home
        </Link>
      </p>
    </main>
  );
}
