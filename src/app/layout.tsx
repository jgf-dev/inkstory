import type { Metadata } from "next";
import { PREFERENCES_BOOTSTRAP_SCRIPT } from "@/lib/ui/preferences";
import "./globals.css";

export const metadata: Metadata = {
  title: "InkStory",
  description: "A novel-writing and world-building platform with an AI-aware Codex.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies stored theme/prose-font before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: PREFERENCES_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
