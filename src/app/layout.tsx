import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InkStory",
  description: "A novel-writing and world-building platform with an AI-aware Codex.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
