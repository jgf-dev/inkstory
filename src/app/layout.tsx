import { buildBetterStackInitScript } from "@/lib/analytics/betterstack";
import { PREFERENCES_BOOTSTRAP_SCRIPT } from "@/lib/ui/preferences";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InkStory",
  description: "A novel-writing and world-building platform with an AI-aware Codex.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const betterStackScript = buildBetterStackInitScript({
    token: process.env.NEXT_PUBLIC_BETTERSTACK_TOKEN,
    environment: process.env.NEXT_PUBLIC_BETTERSTACK_ENV,
    nodeEnv: process.env.NODE_ENV,
    isE2e: process.env.NEXT_PUBLIC_E2E === "true",
  });

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies stored theme/prose-font before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: PREFERENCES_BOOTSTRAP_SCRIPT }} />
        {/* Better Stack analytics; loads its SDK async in deployed builds only. */}
        {betterStackScript ? (
          <script id="betterstack-init" dangerouslySetInnerHTML={{ __html: betterStackScript }} />
        ) : null}
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
